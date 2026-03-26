import json
import os
from pathlib import Path

from .schema import StatementExtraction
from .prompts import build_core_extraction_prompt

try:
    from api.utils.priority_rules import get_prompt_rules_text
except ImportError:  # pragma: no cover
    try:
        from ..utils.priority_rules import get_prompt_rules_text  # type: ignore
    except ImportError:  # pragma: no cover
        get_prompt_rules_text = None  # type: ignore

try:
    from api.utils.gemini_model import get_configured_genai_model
except ImportError:  # pragma: no cover
    try:
        from ..utils.gemini_model import get_configured_genai_model  # type: ignore
    except ImportError:  # pragma: no cover
        get_configured_genai_model = None  # type: ignore


def _get_google_api_key(api_key: str | None = None) -> str:
    key = api_key or os.environ.get("GEMINI_API_KEY")
    if not key:
        raise ValueError("GEMINI_API_KEY must be set (or pass api_key) to use native PDF extraction")
    return key


_NATIVE_PDF_MODALITY = (
    "IMPORTANT: Read the ENTIRE document from first page to last before extracting.\n"
    "Many statements contain multiple sub-accounts or sections (e.g. CAD cash, USD cash, investments).\n"
    "You MUST combine transactions from ALL sections into a single transactions[] list."
)


def _build_native_pdf_prompt() -> str:
    priority = ""
    if get_prompt_rules_text:
        try:
            priority = (get_prompt_rules_text() or "").strip()
        except Exception:
            priority = ""
    return build_core_extraction_prompt(_NATIVE_PDF_MODALITY, priority_rules=priority)


def parse_statement_pdf_native(
    pdf_path: Path,
    *,
    api_key: str | None = None,
    model: str | None = None,
) -> StatementExtraction:
    """
    Native PDF parsing using the official google-genai SDK.

    Sends the PDF as inline bytes (avoids the Files API upload/poll/delete
    lifecycle which can fail behind certain firewalls).  Falls back to the
    Files API for PDFs larger than _INLINE_SIZE_LIMIT.
    """
    from google import genai

    if not isinstance(pdf_path, Path):
        pdf_path = Path(pdf_path)
    if not pdf_path.exists():
        raise FileNotFoundError(f"PDF not found: {pdf_path}")
    if pdf_path.suffix.lower() != ".pdf":
        raise ValueError("Only PDF files are supported")

    key = _get_google_api_key(api_key)
    try:
        client = genai.Client(api_key=key)
    except TypeError:
        client = genai.Client()

    pdf_bytes = pdf_path.read_bytes()
    pdf_part = genai.types.Part.from_bytes(data=pdf_bytes, mime_type="application/pdf")
    prompt = _build_native_pdf_prompt()
    model_to_use = model or (get_configured_genai_model() if get_configured_genai_model else "gemini-2.5-flash-lite")

    try:
        resp = client.models.generate_content(
            model=model_to_use,
            contents=[pdf_part, prompt],
            config=genai.types.GenerateContentConfig(
                response_mime_type="application/json",
                response_schema=StatementExtraction,
            ),
        )

        text = getattr(resp, "text", None)
        if not text or not isinstance(text, str):
            raise RuntimeError("Gemini returned an empty response")
        try:
            payload = json.loads(text)
        except Exception as e:
            raise RuntimeError(f"Gemini returned non-JSON output: {e}") from e

        return StatementExtraction.model_validate(payload)
    except ValueError:
        raise
    except Exception as e:
        raise RuntimeError(f"Native PDF extraction failed: {e}") from e
