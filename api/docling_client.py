"""
Docling client: PDF -> markdown. Supports local (in-process) or remote (HTTP) via config.
Set DOCLING_MODE=remote and DOCLING_SERVICE_URL for production (e.g. Docling on Google Cloud).
"""
import os
from pathlib import Path
from typing import Union


def pdf_to_markdown(pdf_path_or_bytes: Union[Path, str, bytes]) -> str:
    """
    Convert a PDF to markdown. Uses local Docling when DOCLING_MODE is not 'remote'
    and DOCLING_SERVICE_URL is unset; otherwise POSTs the PDF to the remote service.
    """
    mode = (os.environ.get("DOCLING_MODE") or "").strip().lower()
    service_url = (os.environ.get("DOCLING_SERVICE_URL") or "").strip().rstrip("/")
    use_remote = mode == "remote" and bool(service_url)

    if use_remote:
        return _pdf_to_markdown_remote(pdf_path_or_bytes, service_url)
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


def _pdf_to_markdown_remote(pdf_path_or_bytes: Union[Path, str, bytes], base_url: str) -> str:
    """POST PDF to remote Docling service; expect JSON { \"markdown\": \"...\" } or plain text."""
    import urllib.request

    url = f"{base_url}/convert" if "/convert" not in base_url else base_url
    if isinstance(pdf_path_or_bytes, bytes):
        body = pdf_path_or_bytes
    else:
        path = Path(pdf_path_or_bytes) if isinstance(pdf_path_or_bytes, str) else pdf_path_or_bytes
        body = path.read_bytes()

    req = urllib.request.Request(url, data=body, method="POST")
    req.add_header("Content-Type", "application/pdf")
    with urllib.request.urlopen(req, timeout=120) as resp:
        content_type = (resp.headers.get("Content-Type") or "").lower()
        raw = resp.read().decode("utf-8", errors="replace")
        if "application/json" in content_type:
            import json
            data = json.loads(raw)
            return data.get("markdown", data.get("text", raw)) or ""
        return raw
