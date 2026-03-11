"""
Docling client: PDF -> markdown. Supports local (in-process) or remote (HTTP) via config.
Set DOCLING_MODE=remote and DOCLING_SERVICE_URL for production (e.g. Docling on Google Cloud).
"""
import os
from pathlib import Path
from typing import Union


def pdf_to_markdown(
    pdf_path_or_bytes: Union[Path, str, bytes],
    *,
    filename: str | None = None,
) -> str:
    """
    Convert a PDF to markdown. Uses local Docling when DOCLING_MODE is not 'remote'
    and DOCLING_SERVICE_URL is unset; otherwise POSTs the PDF to the remote service.
    filename: optional original filename (used by remote Docling for multipart upload).
    """
    mode = (os.environ.get("DOCLING_MODE") or "").strip().lower()
    service_url = (os.environ.get("DOCLING_SERVICE_URL") or "").strip().rstrip("/")
    use_remote = mode == "remote" and bool(service_url)

    if use_remote:
        return _pdf_to_markdown_remote(pdf_path_or_bytes, service_url, filename=filename)
    return _pdf_to_markdown_local(pdf_path_or_bytes)


def _pdf_to_markdown_local(pdf_path_or_bytes: Union[Path, str, bytes]) -> str:
    """Convert PDF to markdown using in-process Docling."""
    from docling.document_converter import DocumentConverter

    if isinstance(pdf_path_or_bytes, bytes):
        import tempfile
        with tempfile.NamedTemporaryFile(suffix=".pdf", delete=False) as tmp:
            tmp.write(pdf_path_or_bytes)
            path = Path(tmp.name)
        try:
            converter = DocumentConverter()
            result = converter.convert(path)
            doc = result.document
            return doc.export_to_markdown() or ""
        finally:
            path.unlink(missing_ok=True)
    path = Path(pdf_path_or_bytes) if isinstance(pdf_path_or_bytes, str) else pdf_path_or_bytes
    converter = DocumentConverter()
    result = converter.convert(path)
    doc = result.document
    return doc.export_to_markdown() or ""


def _pdf_to_markdown_remote(
    pdf_path_or_bytes: Union[Path, str, bytes],
    base_url: str,
    *,
    filename: str | None = None,
) -> str:
    """POST PDF to remote Docling service as multipart/form-data with filename; expect JSON { \"markdown\": \"...\" } or plain text."""
    import io
    from urllib.parse import urlparse

    import requests

    # Endpoint: use DOCLING_CONVERT_PATH if set, else if base_url has a path use it as-is, else append /convert
    path_env = (os.environ.get("DOCLING_CONVERT_PATH") or "").strip()
    if path_env:
        path = path_env if path_env.startswith("/") else f"/{path_env}"
        url = f"{base_url.rstrip('/')}{path}"
    else:
        parsed = urlparse(base_url)
        path_part = (parsed.path or "").strip("/")
        url = base_url.rstrip("/") if path_part else f"{base_url.rstrip('/')}/convert"

    if isinstance(pdf_path_or_bytes, bytes):
        body = pdf_path_or_bytes
    else:
        path = Path(pdf_path_or_bytes) if isinstance(pdf_path_or_bytes, str) else pdf_path_or_bytes
        body = path.read_bytes()

    name = filename or "statement.pdf"
    files = {"files": (name, io.BytesIO(body), "application/pdf")}
    resp = requests.post(url, files=files, timeout=120)
    resp.raise_for_status()

    content_type = (resp.headers.get("Content-Type") or "").lower()
    raw = resp.text
    if "application/json" in content_type:
        data = resp.json()
        return data.get("markdown", data.get("text", raw)) or ""
    return raw
