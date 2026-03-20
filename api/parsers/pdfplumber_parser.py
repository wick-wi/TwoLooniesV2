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

from .docling_statement import (
    StatementExtraction,
    _allowed_account_types_prompt_suffix,
    _allowed_category_names_prompt_suffix,
)
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

    Strategy: detect tables first, render them as markdown tables (preserving
    column associations), then extract the remaining non-table text to capture
    headers, section labels, and metadata that live outside tables.
    """
    parts: list[str] = []

    tables = page.find_tables()

    # Collect non-table text by filtering out table bounding boxes
    if tables:
        table_bboxes = [t.bbox for t in tables]

        def not_in_table(obj: dict[str, Any]) -> bool:
            for bbox in table_bboxes:
                if (obj["x0"] >= bbox[0] - 2 and obj["top"] >= bbox[1] - 2
                        and obj["x1"] <= bbox[2] + 2 and obj["bottom"] <= bbox[3] + 2):
                    return False
            return True

        filtered_page = page.filter(not_in_table)
        text = filtered_page.extract_text(layout=True)
        if text and text.strip():
            parts.append(text.strip())
    else:
        text = page.extract_text(layout=True)
        if text and text.strip():
            parts.append(text.strip())

    for table in tables:
        extracted = table.extract()
        if extracted:
            md = _table_to_markdown(extracted)
            if md:
                parts.append(md)

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


def _build_pdfplumber_prompt() -> str:
    priority = ""
    if get_prompt_rules_text:
        try:
            priority = (get_prompt_rules_text() or "").strip()
        except Exception:
            priority = ""
    priority_section = (priority + "\n") if priority else ""

    return (
        "You are extracting structured data from a bank/financial statement.\n"
        "The document has been converted to text with tables preserved as markdown tables.\n"
        "Return ONLY valid JSON matching the provided schema.\n"
        "\n"
        "IMPORTANT: The document may span multiple pages and contain multiple sub-accounts\n"
        "or sections (e.g. CAD cash, USD cash, investments). You MUST extract data from\n"
        "ALL pages and ALL sections, combining them into a single result.\n"
        "\n"
        "The text preserves table structure: columns in markdown tables map directly to\n"
        "data fields (e.g. Date | Description | Amount). Use column headers to determine\n"
        "which numbers are amounts, balances, quantities, etc.\n"
        "\n"
        "1) Statement metadata:\n"
        "   - provider: The bank or financial institution name (e.g. Wealthsimple, TD, RBC).\n"
        "   - account_id: The account number or account ID (digits or alphanumeric). Do not use dates as account_id.\n"
        "   - opening_balance: Numeric balance at the start of the statement period. "
        "For investment/brokerage accounts (e.g. TFSA, RRSP, Margin), this MUST be the Total Portfolio Value "
        "or Total Market Value, NOT just the cash portion. (No currency symbol).\n"
        "   - closing_balance: Numeric balance at the end of the statement period. "
        "For investment/brokerage accounts, this MUST be the Total Portfolio Value or Total Market Value, "
        "NOT just the cash portion. (No currency symbol).\n"
        "   - currency: Currency code, e.g. CAD or USD.\n"
        "   - start_date: First day of the statement period in YYYY-MM-DD format.\n"
        "   - end_date: Last day of the statement period in YYYY-MM-DD format.\n"
        f"   - account_type: You MUST use exactly one of these values: {_allowed_account_types_prompt_suffix()}. "
        "Do not use any other wording (e.g. use \"TFSA\" not \"Tax-Free Savings\", "
        "use \"RRSP\" not \"Registered Retirement Savings Plan\").\n"
        "\n"
        "2) Every transaction in the statement as a list. These are transaction line items from a\n"
        "bank or brokerage statement. Descriptions may be abbreviated, include reference numbers,\n"
        "ATM/terminal IDs, or payee names. Include transactions from ALL pages and ALL sub-account sections.\n"
        f"{priority_section}"
        "   For each transaction provide: date (YYYY-MM-DD), description (text), amount, transaction_type, category, confidence_score (0-1).\n"
        "   - amount: For Credit Card statements, return the ABSOLUTE VALUE as printed on the statement (always positive). "
        "For all other account types, use signed amounts (negative = outflow, positive = inflow).\n"
        "   - transaction_type: Classify each transaction as exactly one of: purchase, fee, interest, cash_advance, payment, credit, refund, deposit, withdrawal, transfer.\n"
        "     For Credit Card statements: purchases/charges → \"purchase\", finance charges → \"interest\", "
        "annual/late fees → \"fee\", ATM cash → \"cash_advance\", payments to the card → \"payment\", "
        "refunds/credit vouchers/cashback applied → \"credit\" or \"refund\".\n"
        "     For other account types: deposits/income → \"deposit\", withdrawals/debits → \"withdrawal\", "
        "transfers → \"transfer\", fees → \"fee\".\n"
        f"   - category: You MUST use exactly one of these values: {_allowed_category_names_prompt_suffix()}, "
        "or \"Uncategorized\". Use \"Uncategorized\" ONLY when your confidence is less than 0.8; "
        "otherwise pick the best-matching category and set confidence_score >= 0.8.\n"
        "   - confidence_score: Your confidence in the category assignment, 0 to 1.\n"
        "   - running_balance: The running/cumulative account balance shown on the SAME ROW "
        "as this transaction (e.g. in a \"Balance\" column). Copy the EXACT value printed "
        "in the statement. Do NOT calculate or derive this value. If no per-row balance "
        "is shown for this transaction, use null.\n"
        "   If there are no transactions, return an empty list.\n"
        "\n"
        "3) For investment/brokerage accounts (TFSA, RRSP, RRIF, LIRA, FHSA, RESP, RDSP, RPP, DPSP, Margin, ESOP, Crypto, GIC), "
        "extract every holding position as a list. For each holding provide:\n"
        "   - asset_symbol: Ticker symbol (e.g. XEQT, VFV, BTC). Use \"CASH\" for cash balances.\n"
        "   - asset_name: Full name of the asset (e.g. \"iShares Core Equity ETF Portfolio\").\n"
        "   - quantity: Number of units/shares held.\n"
        "   - unit_price: Price per unit in the account currency.\n"
        "   - total_value: Total market value (quantity * unit_price).\n"
        "   - currency: Currency code (e.g. CAD, USD).\n"
        "   - is_cash_equivalent: true if cash or money-market/savings equivalent, false otherwise.\n"
        "   Cash balances should be included as a holding with asset_symbol \"CASH\" and is_cash_equivalent true.\n"
        "   For non-investment accounts (Chequing, Savings, Credit Card, Line of Credit, HELOC, Mortgage, AutoLoan, Student Loan), "
        "return an empty holdings list.\n"
        "\n"
        "Important rules:\n"
        "- Ignore boilerplate text, terms and conditions, marketing pages, and fee schedules.\n"
        "- Do not invent transactions. If there are no transactions, return an empty list.\n"
        "- Prefer the detailed transaction table/ledger over any totals/summary sections.\n"
        "- Use null for any metadata value you cannot find.\n"
    )


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
    from google import genai

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
