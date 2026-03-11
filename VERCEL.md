# Vercel deployment (Docling on Google Cloud)

When PDF→markdown is handled by a **remote Docling service** (e.g. on Google Cloud), the API on Vercel does not need the `docling` package. That keeps the serverless bundle smaller and avoids heavy local PDF conversion.

## What’s already set up

- **`requirements-vercel.txt`** – Same as `requirements.txt` but **without** `docling`. Used for Vercel installs.
- **`vercel.json`** – `installCommand` runs `pip install -r requirements-vercel.txt` so the slim dependencies are used in production.
- **`api/docling_client.py`** – If `DOCLING_MODE=remote` and `DOCLING_SERVICE_URL` are set, it calls the remote service instead of importing Docling.
- **`api/parsers/docling_statement.py`** – Docling is imported only when running the CLI (e.g. `extract_statement_fields` with a PDF path). The API path only uses markdown and never loads Docling.

## What you need to set on Vercel

In the Vercel project **Environment Variables**, add:

| Variable | Value | Notes |
|----------|--------|--------|
| `DOCLING_MODE` | `remote` | Use remote PDF conversion. |
| `DOCLING_SERVICE_URL` | Your Docling service base URL | e.g. `https://your-docling-run.app.run.app` (no trailing slash). The client will POST PDFs to `{DOCLING_SERVICE_URL}/convert` and expect JSON `{"markdown": "..."}` or plain text. |

Redeploy after changing env vars so the API uses the remote Docling service and does not require the `docling` package at runtime.

## Optional: other requirements to remove

- **`pdfplumber`** – Still in `requirements-vercel.txt` because `api/parsers/metadata.py` imports it at module load. If you never use the PDF-based helpers in `metadata.py` from the API path, you could make that import lazy and then remove `pdfplumber` from `requirements-vercel.txt` as well to further reduce bundle size.
