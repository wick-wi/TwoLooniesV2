"""
pdfplumber V2 parser: same table-aware extraction as pdfplumber_parser,
plus deterministic post-processing to reduce boilerplate before sending
content to the LLM.

Goals:
- Global boilerplate removal (repeated headers/footers across pages)
- Drop large "terms and conditions"/legal tails that are not useful for extraction

This module is intentionally provider-agnostic: it relies on repetition and a
small set of generic patterns rather than bank-specific keywords.
"""

from __future__ import annotations

import json
import os
import re
from collections import Counter
from pathlib import Path

import pdfplumber

from .prompts import build_core_extraction_prompt
from .schema import StatementExtraction

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

    def _cell(val: object) -> str:
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
    non-table text (headers/metadata) and markdown tables top-to-bottom.
    """
    parts: list[str] = []
    tables = page.find_tables()
    tables = sorted(tables, key=lambda t: t.bbox[1])

    current_top = 0.0
    for table in tables:
        bbox_above = (0, current_top, page.width, table.bbox[1])
        if bbox_above[3] > bbox_above[1]:
            text_above = page.crop(bbox_above).extract_text(layout=True)
            if text_above and text_above.strip():
                parts.append(text_above.strip())

        extracted = table.extract()
        if extracted:
            md = _table_to_markdown(extracted)
            if md:
                parts.append(md)

        current_top = table.bbox[3]

    if current_top < page.height:
        bbox_below = (0, current_top, page.width, page.height)
        text_below = page.crop(bbox_below).extract_text(layout=True)
        if text_below and text_below.strip():
            parts.append(text_below.strip())

    return "\n\n".join(parts)


_PAGE_MARKER_RE = re.compile(r"^--- Page (\d+) ---$", re.M)
_WS_RE = re.compile(r"\s+")
_DIGIT_RE = re.compile(r"\d")

# Small, generic boilerplate patterns. Keep conservative; repetition filter does most of the work.
_BOILERPLATE_LINE_RE = re.compile(
    r"(?i)\b("
    r"terms\s+and\s+conditions|privacy\s+policy|cookie\s+policy|"
    r"disclaimer|legal\s+notice|important\s+information|"
    r"page\s+\d+\s+of\s+\d+|all\s+rights\s+reserved|"
    r"customer\s+service|contact\s+us|call\s+us|get\s+help|"
    r"registered\s+address|authori[sz]ed\s+by|regulated\s+by"
    r")\b"
)

# "Tail section" triggers used for truncation when they appear near the end.
_TAIL_SECTION_RE = re.compile(
    r"(?i)^\s*("
    r"terms\s+and\s+conditions|"
    r"important\s+information|"
    r"legal(\s+information|\s+disclosure|\s+notice)?|"
    r"disclosures?|"
    r"privacy(\s+notice|\s+policy)?"
    r")\s*$"
)

_TAIL_KEYWORDS_RE = re.compile(
    r"(?i)\b("
    r"disclosure|disclosures|"
    r"statement\s+notes|notes|endnotes|"
    r"glossary|definitions|"
    r"statement\s+codes|codes"
    r")\b"
)


def _normalize_line_for_repetition(s: str) -> str:
    s = s.strip().lower()
    if not s:
        return ""
    s = _WS_RE.sub(" ", s)
    # Replace digits so "Page 1 of 10" == "Page 2 of 10"
    s = _DIGIT_RE.sub("#", s)
    # Collapse long digit runs into a single token-ish sequence
    s = re.sub(r"#{3,}", "###", s)
    return s


def _split_pages(structured_text: str) -> list[tuple[int, str]]:
    """
    Return list of (page_number, page_body).
    Assumes pages are marked like: '--- Page N ---\\n<content>'.
    """
    if not structured_text.strip():
        return []
    # Find markers and slice.
    matches = list(_PAGE_MARKER_RE.finditer(structured_text))
    if not matches:
        return [(1, structured_text)]
    pages: list[tuple[int, str]] = []
    for idx, m in enumerate(matches):
        start = m.end()
        end = matches[idx + 1].start() if idx + 1 < len(matches) else len(structured_text)
        page_num = int(m.group(1))
        body = structured_text[start:end].lstrip("\n")
        pages.append((page_num, body))
    return pages


def _remove_repeated_boilerplate_lines(pages: list[tuple[int, str]]) -> list[tuple[int, str]]:
    """
    Drop non-table lines that repeat across many pages.
    Provider-agnostic: detects repeated headers/footers/legal blocks.
    """
    if len(pages) < 2:
        return pages

    normalized_counts: Counter[str] = Counter()
    per_page_norm_lines: list[set[str]] = []

    for _, body in pages:
        norms: set[str] = set()
        for line in body.splitlines():
            raw = line.strip()
            if not raw:
                continue
            if raw.startswith("|"):  # keep markdown tables intact
                continue
            norm = _normalize_line_for_repetition(raw)
            if not norm:
                continue
            norms.add(norm)
        per_page_norm_lines.append(norms)
        normalized_counts.update(norms)

    page_count = len(pages)
    # Threshold chosen to avoid removing legitimate recurring content.
    # Needs to repeat on most pages (e.g. headers/footers).
    min_ratio = 0.7 if page_count >= 4 else 0.8
    repeated = {
        norm
        for norm, c in normalized_counts.items()
        if c >= 2 and (c / page_count) >= min_ratio
    }

    cleaned_pages: list[tuple[int, str]] = []
    for (pnum, body) in pages:
        out_lines: list[str] = []
        for line in body.splitlines():
            raw = line.rstrip()
            stripped = raw.strip()
            if not stripped:
                out_lines.append("")
                continue
            if stripped.startswith("|"):
                out_lines.append(raw)
                continue
            norm = _normalize_line_for_repetition(stripped)
            if norm in repeated:
                continue
            # Also drop very obvious single-line boilerplate.
            if _BOILERPLATE_LINE_RE.search(stripped):
                continue
            out_lines.append(raw)
        cleaned_pages.append((pnum, _collapse_blank_lines("\n".join(out_lines)).strip()))
    return cleaned_pages


def _collapse_blank_lines(s: str, max_run: int = 1) -> str:
    """Collapse blank line runs to at most max_run."""
    lines = s.splitlines()
    out: list[str] = []
    blank_run = 0
    for line in lines:
        if not line.strip():
            blank_run += 1
            if blank_run <= max_run:
                out.append("")
            continue
        blank_run = 0
        out.append(line.rstrip())
    return "\n".join(out).strip()


def _truncate_terms_tail(text: str) -> str:
    """
    Truncate large legal/terms tail sections near the end of the document.

    Heuristic:
    - Look for a standalone section heading that matches _TAIL_SECTION_RE.
    - Only truncate if it appears late in the document and the remaining tail is large.
    """
    if not text.strip():
        return text
    lines = text.splitlines()
    if len(lines) < 80:
        return text

    # Only consider headings in the last 40% of lines.
    start_scan = int(len(lines) * 0.6)
    for i in range(start_scan, len(lines)):
        line = lines[i] or ""
        stripped = line.strip()
        if not stripped:
            continue

        # Trigger 1: explicit "Terms and Conditions" style headings.
        is_tail_heading = bool(_TAIL_SECTION_RE.match(stripped))

        # Trigger 2: common non-transaction appendix sections (provider-agnostic keywords),
        # often presented as ALL CAPS headings (e.g. "LEVERAGE DISCLOSURE", "STATEMENT NOTES").
        if not is_tail_heading and _TAIL_KEYWORDS_RE.search(stripped):
            # Prefer to cut only when it looks like a standalone heading line.
            # Heuristic: mostly uppercase and not too long.
            letters = [c for c in stripped if c.isalpha()]
            upper_ratio = (sum(1 for c in letters if c.isupper()) / len(letters)) if letters else 0.0
            if upper_ratio >= 0.7 and len(stripped) <= 80:
                is_tail_heading = True

        if is_tail_heading:
            tail = "\n".join(lines[i:])
            # Large tail: typically many hundreds/thousands of chars.
            if len(tail) >= 2000:
                return _collapse_blank_lines("\n".join(lines[:i]).rstrip())
    return text


def postprocess_structured_text_v2(structured_text: str) -> str:
    """
    Apply V2 deterministic cleanup to pdfplumber structured text.
    """
    pages = _split_pages(structured_text)
    pages = _remove_repeated_boilerplate_lines(pages)
    rebuilt = "\n\n".join(
        f"--- Page {pnum} ---\n{body}".rstrip()
        for (pnum, body) in pages
        if body.strip()
    ).strip()
    rebuilt = _truncate_terms_tail(rebuilt)
    return rebuilt.strip()


def pdf_to_structured_text_v2(pdf_path: Path) -> str:
    """
    Convert a PDF to structured text using pdfplumber, then run V2 post-processing.
    Tables are rendered as markdown tables; non-table text uses layout hints.
    """
    if not isinstance(pdf_path, Path):
        pdf_path = Path(pdf_path)

    sections: list[str] = []
    with pdfplumber.open(pdf_path) as pdf:
        for i, page in enumerate(pdf.pages, start=1):
            content = _extract_page_content(page)
            if content.strip():
                sections.append(f"--- Page {i} ---\n{content}")

    raw = "\n\n".join(sections)
    return postprocess_structured_text_v2(raw)


_PDFPLUMBER_V2_MODALITY = (
    "The document has been converted to text with tables preserved as markdown tables.\n"
    "A deterministic cleanup pass was applied to remove repeated page boilerplate and\n"
    "truncate large terms/legal sections that are not relevant to transactions.\n"
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


def _build_pdfplumber_v2_prompt() -> str:
    priority = ""
    if get_prompt_rules_text:
        try:
            priority = (get_prompt_rules_text() or "").strip()
        except Exception:
            priority = ""
    return build_core_extraction_prompt(_PDFPLUMBER_V2_MODALITY, priority_rules=priority)


def extract_statement_from_structured_text_v2(
    structured_text: str,
    *,
    api_key: str | None = None,
    model: str | None = None,
) -> StatementExtraction:
    """
    Extract statement JSON from already-computed structured text (V2).
    """
    from google import genai

    if not isinstance(structured_text, str):
        raise TypeError("structured_text must be a string")
    if not structured_text.strip():
        raise RuntimeError("pdfplumber V2 structured text is empty")

    key = _get_gemini_api_key(api_key)
    try:
        client = genai.Client(api_key=key)
    except TypeError:
        client = genai.Client()

    system_instruction = _build_pdfplumber_v2_prompt()
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
        raise RuntimeError(f"pdfplumberV2+LLM structured extraction failed: {e}") from e


def parse_statement_pdfplumber_v2(
    pdf_path: Path,
    *,
    api_key: str | None = None,
    model: str | None = None,
) -> StatementExtraction:
    """
    Two-step parser:
      1. pdfplumber converts PDF → structured text (tables as markdown)
      2. V2 post-process removes boilerplate / truncates terms tail
      3. Gemini extracts structured JSON from the cleaned text
    """
    if not isinstance(pdf_path, Path):
        pdf_path = Path(pdf_path)
    if not pdf_path.exists():
        raise FileNotFoundError(f"PDF not found: {pdf_path}")
    if pdf_path.suffix.lower() != ".pdf":
        raise ValueError("Only PDF files are supported")

    structured_text = pdf_to_structured_text_v2(pdf_path)
    if not structured_text.strip():
        raise RuntimeError(
            "This PDF appears to be scanned images (no extractable text). "
            "OCR/image-only PDF support is a feature coming soon."
        )

    return extract_statement_from_structured_text_v2(
        structured_text,
        api_key=api_key,
        model=model,
    )

