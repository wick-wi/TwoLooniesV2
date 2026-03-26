"""
pdfplumber + LLM parser: lightweight PDF-to-structured-text conversion,
then Gemini Flash-Lite for data extraction.

Uses pdfplumber's table detection to preserve spatial context (column
associations) that plain text extraction loses, while being much faster
than Docling's deep-learning-based layout analysis.
"""

import json
import os
from pathlib import Path
from typing import Any

import pdfplumber

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


def _get_gemini_api_key(api_key: str | None = None) -> str:
    key = api_key or os.environ.get("GOOGLE_API_KEY") or os.environ.get("GEMINI_API_KEY")
    if not key:
        raise ValueError("GOOGLE_API_KEY or GEMINI_API_KEY must be set")
    return key


def _table_to_markdown(table: list[list[str | None]]) -> str:
    """Convert a pdfplumber table (list of rows) to a markdown table string."""
    if not table or not table[0]:
        return ""

    def _cell(val: Any) -> str:
        if val is None:
            return ""
        return str(val).replace("\n", " ").strip()

    header = table[0]
    col_count = len(header)
    lines = ["| " + " | ".join(_cell(c) for c in header) + " |"]
    lines.append("| " + " | ".join("---" for _ in range(col_count)) + " |")

    for row in table[1:]:
        cells = row[:col_count] if len(row) >= col_count else row + [None] * (col_count - len(row))
        lines.append("| " + " | ".join(_cell(c) for c in cells) + " |")

    return "\n".join(lines)


def _extract_page_content(page: pdfplumber.page.Page) -> str:
    """
    Extract structured content from a single PDF page.
    
    Strategy: Sort tables by vertical position, then interleave the 
    non-table text (headers/metadata) and markdown tables top-to-bottom 
    so the LLM retains contextual reading order.
    """
    parts: list[str] = []
    tables = page.find_tables()
    
    # Sort tables from top to bottom based on their y0 (top) coordinate
    tables = sorted(tables, key=lambda t: t.bbox[1])
    
    current_top = 0
    for table in tables:
        # Extract text above the current table
        # bbox = (x0, top, x1, bottom)
        bbox_above = (0, current_top, page.width, table.bbox[1])
        # Crop can sometimes fail if top >= bottom, so guard it
        if bbox_above[3] > bbox_above[1]: 
            text_above = page.crop(bbox_above).extract_text(layout=True)
            if text_above and text_above.strip():
                parts.append(text_above.strip())
        
        # Append the markdown table
        extracted = table.extract()
        if extracted:
            md = _table_to_markdown(extracted)
            if md:
                parts.append(md)
        
        # Move our top coordinate down past this table
        current_top = table.bbox[3]

    # Extract any remaining text below the very last table
    if current_top < page.height:
        bbox_below = (0, current_top, page.width, page.height)
        text_below = page.crop(bbox_below).extract_text(layout=True)
        if text_below and text_below.strip():
            parts.append(text_below.strip())

    return "\n\n".join(parts)


def pdf_to_structured_text(pdf_path: Path) -> str:
    """
    Convert a PDF to structured text using pdfplumber.
    Tables are rendered as markdown tables; non-table text is preserved with
    layout hints. Each page is labelled.
    """
    if not isinstance(pdf_path, Path):
        pdf_path = Path(pdf_path)

    sections: list[str] = []
    with pdfplumber.open(pdf_path) as pdf:
        for i, page in enumerate(pdf.pages, start=1):
            content = _extract_page_content(page)
            if content.strip():
                sections.append(f"--- Page {i} ---\n{content}")

    return "\n\n".join(sections)


_PDFPLUMBER_MODALITY = (
    "The document has been converted to text with tables preserved as markdown tables.\n"
    "\n"
    "IMPORTANT: The document may span multiple pages and contain multiple sub-accounts\n"
    "or sections (e.g. CAD cash, USD cash, investments). You MUST extract data from\n"
    "ALL pages and ALL sections, combining them into a single result.\n"
    "\n"
    "The text preserves table structure: columns in markdown tables map directly to\n"
    "data fields (e.g. Date | Description | Amount). Use column headers to determine\n"
    "which numbers are amounts, balances, quantities, etc.\n"
    "\n"
    "CRITICAL: Pay close attention to text headers immediately preceding tables "
    "(e.g. 'CAD Activity' vs 'USD Activity') or table column headers to correctly "
    "assign the currency for the transactions within that specific table."
)


def _build_pdfplumber_prompt() -> str:
    priority = ""
    if get_prompt_rules_text:
        try:
            priority = (get_prompt_rules_text() or "").strip()
        except Exception:
            priority = ""
    return build_core_extraction_prompt(_PDFPLUMBER_MODALITY, priority_rules=priority)


def extract_statement_from_structured_text(
    structured_text: str,
    *,
    api_key: str | None = None,
    model: str | None = None,
) -> StatementExtraction:
    """
    Extract statement JSON from already-computed pdfplumber structured text.

    This supports "retry with a different model" without re-running
    the pdfplumber conversion step.
    """
    from google import genai

    if not isinstance(structured_text, str):
        raise TypeError("structured_text must be a string")
    if not structured_text.strip():
        raise RuntimeError("pdfplumber structured text is empty")

    key = _get_gemini_api_key(api_key)
    try:
        client = genai.Client(api_key=key)
    except TypeError:
        client = genai.Client()

    system_instruction = _build_pdfplumber_prompt()
    user_content = f"Document:\n\n{structured_text}"
    model_to_use = model or (get_configured_genai_model() if get_configured_genai_model else "gemini-2.5-flash-lite")

    try:
        resp = client.models.generate_content(
            model=model_to_use,
            contents=[user_content],
            config=genai.types.GenerateContentConfig(
                response_mime_type="application/json",
                response_schema=StatementExtraction,
                system_instruction=system_instruction,
                temperature=0.0,
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
        raise RuntimeError(f"pdfplumber+LLM structured extraction failed: {e}") from e


def parse_statement_pdfplumber(
    pdf_path: Path,
    *,
    api_key: str | None = None,
    model: str | None = None,
) -> StatementExtraction:
    """
    Two-step parser:
      1. pdfplumber converts PDF → structured text (tables as markdown)
      2. Gemini Flash-Lite extracts structured JSON from that text
    """
    if not isinstance(pdf_path, Path):
        pdf_path = Path(pdf_path)
    if not pdf_path.exists():
        raise FileNotFoundError(f"PDF not found: {pdf_path}")
    if pdf_path.suffix.lower() != ".pdf":
        raise ValueError("Only PDF files are supported")

    structured_text = pdf_to_structured_text(pdf_path)
    if not structured_text.strip():
        raise RuntimeError(
            "This PDF appears to be scanned images (no extractable text). "
            "OCR/image-only PDF support is a feature coming soon."
        )

    return extract_statement_from_structured_text(
        structured_text,
        api_key=api_key,
        model=model,
    )
