"""QStash dispatch and Supabase staging for statement PDF jobs (Vercel serverless)."""
from __future__ import annotations

import asyncio
import logging
import os
import uuid

from qstash import AsyncQStash

logger = logging.getLogger(__name__)

QSTASH_WORKER_PATH = "/api/internal/qstash/process_statement"


def use_qstash_dispatch() -> bool:
    if os.environ.get("USE_QSTASH", "").lower() in ("0", "false", "no"):
        return False
    return bool(os.environ.get("QSTASH_TOKEN", "").strip())


def public_callback_base_url() -> str:
    """HTTPS origin QStash will call (must match publish destination and signature verification)."""
    explicit = (os.environ.get("QSTASH_CALLBACK_BASE_URL") or os.environ.get("APP_PUBLIC_URL") or "").strip().rstrip("/")
    if explicit:
        return explicit
    if os.environ.get("VERCEL") == "1":
        host = (os.environ.get("VERCEL_URL") or "").strip()
        if host:
            return f"https://{host}"
    raise RuntimeError(
        "Set QSTASH_CALLBACK_BASE_URL or APP_PUBLIC_URL (or deploy on Vercel with VERCEL_URL) for QStash callbacks."
    )


def qstash_worker_url() -> str:
    return f"{public_callback_base_url().rstrip('/')}{QSTASH_WORKER_PATH}"


async def publish_statement_job_qstash(job_id: str) -> None:
    token = os.environ.get("QSTASH_TOKEN", "").strip()
    if not token:
        raise RuntimeError("QSTASH_TOKEN is not set")
    client = AsyncQStash(token)
    url = qstash_worker_url()
    timeout = os.environ.get("QSTASH_UPSTREAM_TIMEOUT", "300s")
    await client.message.publish_json(
        url=url,
        body={"job_id": job_id},
        timeout=timeout,
    )


def _upload_pdf_sync(supabase_client, bucket: str, object_key: str, content: bytes) -> None:
    supabase_client.storage.from_(bucket).upload(
        object_key, content, {"content-type": "application/pdf"}
    )


def _remove_objects_sync(supabase_client, bucket: str, object_keys: list[str]) -> None:
    if not object_keys:
        return
    supabase_client.storage.from_(bucket).remove(object_keys)


async def stage_statement_pdfs_for_qstash(
    supabase_client,
    file_data: list[dict],
    user_id: str | None,
) -> list[dict]:
    """
    Upload PDFs under a pending/ prefix for the worker to download.
    Each spec: filename, content_sha256, bucket, object_key, storage_path.
    """
    if not supabase_client:
        raise RuntimeError("Supabase client is not configured; cannot stage PDFs for QStash.")

    bucket = os.environ.get("STATEMENT_PDF_BUCKET", "statement-pdfs")
    try:
        await asyncio.to_thread(
            lambda: supabase_client.storage.create_bucket(bucket, options={"public": False})
        )
    except Exception:
        pass

    key_prefix = f"{str(user_id).strip()}/" if isinstance(user_id, str) and user_id.strip() else ""
    pending_prefix = f"{key_prefix}pending/"
    specs: list[dict] = []

    for f in file_data:
        fname = f["filename"]
        content = f["content"]
        sha = f["content_sha256"]
        object_key = f"{pending_prefix}{uuid.uuid4()}.pdf"
        await asyncio.to_thread(_upload_pdf_sync, supabase_client, bucket, object_key, content)
        specs.append(
            {
                "filename": fname,
                "content_sha256": sha,
                "bucket": bucket,
                "object_key": object_key,
                "storage_path": f"{bucket}/{object_key}",
            }
        )
    return specs


async def delete_pending_statement_specs(specs: list[dict]) -> None:
    """Best-effort removal of staged PDFs (e.g. job failure or publish failure)."""
    if not specs:
        return
    from .supabase_client import supabase as sb

    if not sb:
        return
    by_bucket: dict[str, list[str]] = {}
    for spec in specs:
        b = spec.get("bucket")
        k = spec.get("object_key")
        if b and k:
            by_bucket.setdefault(b, []).append(k)
    for bucket, keys in by_bucket.items():
        try:
            await asyncio.to_thread(_remove_objects_sync, sb, bucket, keys)
        except Exception as e:
            logger.warning("Failed to remove pending objects in %s: %s", bucket, e)
