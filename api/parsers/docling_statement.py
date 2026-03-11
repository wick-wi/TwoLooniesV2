"""
Docling-based statement parser (standalone).
Extracts: provider, account_id, opening_balance, closing_balance, currency, start_date, end_date, account_type, and transactions.
Uses Docling for PDF -> markdown; then either LLM extraction (instructor + Pydantic, Google Gemini) or regex fallback.
Set GOOGLE_API_KEY or GEMINI_API_KEY to use LLM extraction. Outputs JSON. Reads PDF from path (CLI or default samples).
"""
import json
import os
import sys
from pathlib import Path
from typing import Any

from pydantic import BaseModel, Field

# Default PDF path relative to repo root
DEFAULT_PDF = "api/parsers/samples/statement.pdf"

# Limit text to first N chars to approximate "first 2 pages" for long statements
MAX_TEXT_FOR_EXTRACTION = 15000

# Gemini model for structured extraction (stable 2.x flash)
GEMINI_MODEL = "google/gemini-2.5-flash"


def _get_gemini_api_key(api_key: str | None = None) -> str:
    """Resolve Gemini/Google API key from argument or environment. Raises ValueError if missing."""
    key = api_key or os.environ.get("GOOGLE_API_KEY") or os.environ.get("GEMINI_API_KEY")
    if not key:
        raise ValueError("GOOGLE_API_KEY or GEMINI_API_KEY must be set (or pass api_key) to use LLM extraction")
    return key


def _repo_root() -> Path:
    """Resolve repo root (directory containing api/). Works when run as CLI or as module."""
    p = Path(__file__).resolve().parent
    while p != p.parent:
        if (p / "api").is_dir():
            return p
        p = p.parent
    return Path(__file__).resolve().parent.parent.parent


def _ensure_metadata_import():
    """Load extract_statement_metadata_from_text; add repo root to path when run as script."""
    try:
        from .metadata import extract_statement_metadata_from_text
        return extract_statement_metadata_from_text
    except ImportError:
        root = _repo_root()
        if str(root) not in sys.path:
            sys.path.insert(0, str(root))
        from api.parsers.metadata import extract_statement_metadata_from_text  # noqa: E402
        return extract_statement_metadata_from_text


# Lazy import so path is set first when run as script
_extract_statement_metadata_from_text = None

def _get_metadata_extractor():
    global _extract_statement_metadata_from_text
    if _extract_statement_metadata_from_text is None:
        _extract_statement_metadata_from_text = _ensure_metadata_import()
    return _extract_statement_metadata_from_text


# --- Pydantic models ---

class StatementFields(BaseModel):
    """Extracted statement metadata; matches the JSON output schema."""

    provider: str = Field(default="Unknown", description="Bank or financial institution name (e.g. Wealthsimple, TD)")
    account_id: str | None = Field(default=None, description="Account number or account ID from the statement")
    opening_balance: float | None = Field(default=None, description="Balance at start of statement period")
    closing_balance: float | None = Field(default=None, description="Balance at end of statement period")
    currency: str = Field(default="CAD", description="Currency code (e.g. CAD, USD)")
    start_date: str | None = Field(default=None, description="Statement period start date in YYYY-MM-DD format")
    end_date: str | None = Field(default=None, description="Statement period end date in YYYY-MM-DD format")
    account_type: str = Field(default="Chequing", description="Account type: must be exactly one of the allowed canonical names (e.g. Chequing, Savings, TFSA, RRSP)")


class TransactionItem(BaseModel):
    """Single transaction row from a statement."""

    date: str = Field(description="Transaction date in YYYY-MM-DD format")
    description: str = Field(default="", description="Transaction description or memo")
    amount: float = Field(description="Signed amount: negative = outflow, positive = inflow")
    category: str = Field(
        default="Uncategorized",
        description="Category name: must be exactly one of the allowed names, or 'Uncategorized' only when confidence < 0.8",
    )
    confidence_score: float = Field(
        default=0.0,
        ge=0.0,
        le=1.0,
        description="Confidence in the category assignment, 0 to 1",
    )


class StatementExtraction(StatementFields):
    """Combined LLM output: statement metadata (from StatementFields) + list of transactions."""

    transactions: list[TransactionItem] = Field(default_factory=list, description="List of all transactions in the statement")


try:
    from .account_types_ref import get_valid_account_type_names
except ImportError:
    get_valid_account_type_names = None

try:
    from api.utils.categorization import get_category_names
except ImportError:
    try:
        from ..utils.categorization import get_category_names
    except ImportError:
        get_category_names = None


def _allowed_account_types_prompt_suffix() -> str:
    """Allowed account_type values for LLM prompt (from account_types.json)."""
    if get_valid_account_type_names is None:
        return "AutoLoan, Chequing, Credit Card, Crypto, DPSP, ESOP, FHSA, GIC, HELOC, Line of Credit, LIRA, Margin, Mortgage, RDSP, RESP, RPP, RRIF, RRSP, Savings, Student Loan, TFSA"
    return ", ".join(sorted(get_valid_account_type_names()))


def _allowed_category_names_prompt_suffix() -> str:
    """Allowed category names for LLM prompt (from categories.json). Does not include 'Uncategorized' (allowed separately in prompt)."""
    if get_category_names is None:
        return "Credit Card Payment, Dining & Coffee, E-Transfer, Entertainment & Subs, Financial & Investing, Groceries, Health & Wellness, Housing, Household & Shopping, Income, Miscellaneous, Self-Transfer, Transport & Auto, Utilities & Phone"
    return ", ".join(get_category_names())


def _build_extraction_prompt() -> str:
    return f"""You are extracting structured data from a bank/financial statement that has been converted to markdown.

Extract the following:

1) Statement metadata:
   - provider: The bank or financial institution name (e.g. Wealthsimple, TD, RBC).
   - account_id: The account number or account ID (digits or alphanumeric). Do not use dates (e.g. 20250402) as account_id.
   - opening_balance: Numeric balance at the start of the statement period. For investment/brokerage accounts (e.g., TFSA, RRSP, Margin), this MUST be the Total Portfolio Value or Total Market Value, NOT just the cash portion. (No currency symbol).
   - closing_balance: Numeric balance at the end of the statement period. For investment/brokerage accounts, this MUST be the Total Portfolio Value or Total Market Value, NOT just the cash portion. (No currency symbol).
   - currency: Currency code, e.g. CAD or USD.
   - start_date: First day of the statement period in YYYY-MM-DD format.
   - end_date: Last day of the statement period in YYYY-MM-DD format.
   - account_type: You MUST use exactly one of these values (pick the closest match to what the document says): {_allowed_account_types_prompt_suffix()}. Do not use any other wording (e.g. use "TFSA" not "Tax-Free Savings", use "RRSP" not "Registered Retirement Savings Plan").

2) Every transaction in the statement as a list. For each transaction provide: date (YYYY-MM-DD), description (text), amount (signed number: negative for withdrawals/outflows, positive for deposits/inflows), category, confidence_score (0-1).
   - category: You MUST use exactly one of these values: {_allowed_category_names_prompt_suffix()}, or "Uncategorized". Use "Uncategorized" ONLY when your confidence in the category assignment is less than 0.8; otherwise pick the best-matching category from the list and set confidence_score at least 0.8.
   - confidence_score: Your confidence in the category assignment, a number from 0 to 1.
   If there are no transactions, return an empty list.

Use null for any metadata value you cannot find."""


def extract_statement_with_llm(markdown: str, *, api_key: str | None = None) -> tuple[dict[str, Any], list[dict[str, Any]]]:
    """
    Single Gemini call: return (metadata_dict, transactions_list). Uses account_id throughout.
    Uses GOOGLE_API_KEY or GEMINI_API_KEY from env if api_key not provided.
    """
    import instructor

    key = _get_gemini_api_key(api_key)
    client = instructor.from_provider(GEMINI_MODEL, api_key=key)
    user_content = f"{_build_extraction_prompt()}\n\nDocument:\n\n{markdown}"
    out: StatementExtraction = client.create(
        messages=[{"role": "user", "content": user_content}],
        response_model=StatementExtraction,
    )
    meta = out.model_dump()
    txns_list = meta.pop("transactions", [])
    return (meta, txns_list)


def _extract_statement_fields_regex(markdown: str) -> dict[str, Any]:
    """Extract statement fields from markdown using only extract_statement_metadata_from_text. Map to standard dict format."""
    text = markdown.strip()
    if len(text) > MAX_TEXT_FOR_EXTRACTION:
        text = text[:MAX_TEXT_FOR_EXTRACTION]
    get_meta = _get_metadata_extractor()
    meta = get_meta(text.lower(), bank_id="generic")
    return {
        "provider": meta.get("bank_name") or "Unknown",
        "account_id": meta.get("account_number"),
        "opening_balance": meta.get("opening_balance"),
        "closing_balance": meta.get("total_account_value"),
        "currency": meta.get("currency", "CAD"),
        "start_date": meta.get("start_date"),
        "end_date": meta.get("end_date"),
        "account_type": meta.get("account_type") or "Chequing",
        "transactions": [],
    }


def extract_statement_fields(pdf_path: Path, *, use_llm: bool | None = None) -> tuple[dict[str, Any], str]:
    """
    Convert PDF with Docling to markdown, then extract statement data (metadata + transactions).
    If use_llm is True or GOOGLE_API_KEY/GEMINI_API_KEY is set (and use_llm is not False), uses LLM extraction;
    otherwise uses regex extraction. Returns (result_dict, full_markdown). result_dict includes all metadata fields and a "transactions" list.
    Only used when running as CLI; API uses docling_client.pdf_to_markdown (remote or local) then extract_statement_with_llm(markdown).
    """
    from docling.document_converter import DocumentConverter

    converter = DocumentConverter()
    result = converter.convert(pdf_path)
    doc = result.document
    full_markdown = doc.export_to_markdown() or ""

    use_llm_extraction = use_llm if use_llm is not None else bool(
        os.environ.get("GOOGLE_API_KEY") or os.environ.get("GEMINI_API_KEY")
    )
    if use_llm_extraction:
        try:
            meta, txns_list = extract_statement_with_llm(full_markdown)
            result_dict = {**meta, "transactions": txns_list}
            return (result_dict, full_markdown)
        except Exception as e:
            print(f"LLM extraction failed ({e}), falling back to regex.", file=sys.stderr)
    result_dict = _extract_statement_fields_regex(full_markdown)
    return (result_dict, full_markdown)


def main() -> None:
    if len(sys.argv) >= 2:
        pdf_path = Path(sys.argv[1])
    else:
        pdf_path = _repo_root() / DEFAULT_PDF

    if not pdf_path.exists():
        print(f"PDF not found: {pdf_path}", file=sys.stderr)
        sys.exit(1)

    result, markdown = extract_statement_fields(pdf_path)
    print("--- Docling markdown ---")
    print(markdown)
    print("--- Extracted JSON ---")
    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    main()
