"""
Docling-based statement parser (standalone).
Extracts: provider, account_id, opening_balance, closing_balance, currency, start_date, end_date, account_type, and transactions.
Uses Docling for PDF -> markdown; then either LLM extraction (instructor + Pydantic, Google Gemini) or regex fallback.
Set GOOGLE_API_KEY or GEMINI_API_KEY to use LLM extraction. Outputs JSON. Reads PDF from path (CLI or default samples).
"""
import json
import os
import re
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from pydantic import BaseModel, Field

# Default PDF path relative to repo root
DEFAULT_PDF = "api/parsers/samples/statement.pdf"

# Limit text to first N chars to approximate "first 2 pages" for long statements
MAX_TEXT_FOR_EXTRACTION = 15000

try:
    from api.utils.gemini_model import get_configured_instructor_model
except ImportError:  # pragma: no cover
    try:
        from ..utils.gemini_model import get_configured_instructor_model  # type: ignore
    except ImportError:  # pragma: no cover
        get_configured_instructor_model = None  # type: ignore


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
    opening_cash_balance: float | None = Field(
        default=None,
        description="Investment/brokerage only: cash at period start (not NAV). Null if not stated.",
    )
    closing_cash_balance: float | None = Field(
        default=None,
        description="Investment/brokerage only: cash at period end (not NAV). Null if not stated.",
    )
    currency: str = Field(default="CAD", description="Currency code (e.g. CAD, USD)")
    start_date: str | None = Field(default=None, description="Statement period start date in YYYY-MM-DD format")
    end_date: str | None = Field(default=None, description="Statement period end date in YYYY-MM-DD format")
    account_type: str = Field(default="Chequing", description="Account type: must be exactly one of the allowed canonical names (e.g. Chequing, Savings, TFSA, RRSP)")


class TransactionItem(BaseModel):
    """Single transaction row from a statement."""

    date: str = Field(description="Transaction date in YYYY-MM-DD format")
    description: str = Field(default="", description="Transaction description or memo")
    amount: float = Field(description="Transaction amount as a positive number (absolute value as printed on the statement). For non-credit-card accounts, use signed: negative = outflow, positive = inflow.")
    transaction_type: str = Field(
        default="purchase",
        description="Type of transaction: purchase, fee, interest, cash_advance, payment, credit, refund, deposit, withdrawal, transfer",
    )
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
    running_balance: float | None = Field(
        default=None,
        description="Running/cumulative account balance shown on the same row as this transaction. "
        "Copy the EXACT value printed; do NOT calculate it. Use null if not shown.",
    )


class HoldingItem(BaseModel):
    """Single holding position from an investment statement."""

    asset_symbol: str | None = Field(default="CASH", description="Ticker symbol (e.g. XEQT, VFV) or 'CASH' for cash balances")
    asset_name: str | None = Field(default=None, description="Full name of the asset (e.g. 'iShares Core Equity ETF')")
    quantity: float = Field(description="Number of units/shares held")
    unit_price: float = Field(description="Price per unit in the account currency")
    total_value: float = Field(description="Total market value (quantity * unit_price)")
    currency: str = Field(default="CAD", description="Currency code (e.g. CAD, USD)")
    is_cash_equivalent: bool = Field(default=False, description="True if this position is cash or a money-market/savings equivalent")


class StatementExtraction(StatementFields):
    """Combined LLM output: statement metadata + transactions + holdings."""

    transactions: list[TransactionItem] = Field(
        default_factory=list,
        description="Bank/credit: full ledger. Investment/brokerage: all cash-balance-affecting activity (deposits, withdrawals, trades, dividends, fees, interest, transfers, etc.).",
    )
    holdings: list[HoldingItem] = Field(default_factory=list, description="Itemized holding positions for investment/brokerage accounts; empty for depository/credit/loan accounts")


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
        return "Bank & broker fees, Career & Education, Credit Card Payment, Dining & Coffee, E-Transfer, Entertainment & Subs, Gifts and Donations, Groceries, Health & Wellness, Housing, Household & Shopping, Income, Loans & Reimbursements, Miscellaneous, Securities Trading, Self-Transfer, Transport & Auto, Travel, Utilities & Phone"
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
   - opening_cash_balance / closing_cash_balance: For investment/brokerage accounts ONLY, if the statement shows period start/end cash (cash balance, not total portfolio value), extract those numeric values. Must match opening_balance/closing_balance currency. Use null if not stated or unclear.

2) Every transaction in the statement as a list. These are transaction line items from a bank or brokerage statement (not from a live feed with clean merchant names). Descriptions may be abbreviated, include reference numbers, ATM/terminal IDs, or payee names, and format varies by institution—use this context when assigning categories.
   For each transaction provide: date (YYYY-MM-DD), description (text), amount, transaction_type, category, confidence_score (0-1).
   - amount: For Credit Card statements, return the ABSOLUTE VALUE as printed on the statement (always positive). For all other account types, use signed amounts (negative = outflow, positive = inflow).
   - transaction_type: Classify each transaction as exactly one of: purchase, fee, interest, cash_advance, payment, credit, refund, deposit, withdrawal, transfer.
     For Credit Card statements: purchases/charges → "purchase", finance charges → "interest", annual/late fees → "fee", ATM cash → "cash_advance", payments to the card → "payment", refunds/credit vouchers/cashback applied → "credit" or "refund".
     For other account types: deposits/income → "deposit", withdrawals/debits → "withdrawal", transfers → "transfer", fees → "fee".
   - category: You MUST use exactly one of these values: {_allowed_category_names_prompt_suffix()}, or "Uncategorized". Use "Uncategorized" ONLY when your confidence in the category assignment is less than 0.8; otherwise pick the best-matching category from the list and set confidence_score at least 0.8.
   - confidence_score: Your confidence in the category assignment, a number from 0 to 1.
   - running_balance: The running/cumulative account balance shown on the SAME ROW as this transaction (e.g. in a "Balance" column). Copy the EXACT value printed in the statement. Do NOT calculate or derive this value. If no per-row balance is shown for this transaction, use null.
   If there are no transactions, return an empty list.
   INVESTMENT/BROKERAGE ACCOUNTS (TFSA, RRSP, RRIF, LIRA, FHSA, RESP, RDSP, RPP, DPSP, Margin, ESOP, Crypto, GIC): In transactions[], include every line from the cash/activity ledger that changes cash balance (deposits, withdrawals, bank transfers, buys, sells, dividends paid to cash, fees, interest, etc.). Use signed amounts (negative = cash out, positive = cash in). Classify transaction_type appropriately (e.g. purchase for buys, deposit/withdrawal/transfer for bank movements). If the statement shows a per-row cash balance, put it in running_balance; if only portfolio value is shown per row, use null for running_balance. Holdings in section (3) still capture positions.

3) For investment/brokerage accounts (TFSA, RRSP, RRIF, LIRA, FHSA, RESP, RDSP, RPP, DPSP, Margin, ESOP, Crypto, GIC), extract every holding position as a list. For each holding provide:
   - asset_symbol: Ticker symbol (e.g. XEQT, VFV, BTC). Use "CASH" for cash balances.
   - asset_name: Full name of the asset (e.g. "iShares Core Equity ETF Portfolio").
   - quantity: Number of units/shares held.
   - unit_price: Price per unit in the account currency.
   - total_value: Total market value of this position (quantity * unit_price).
   - currency: Currency code (e.g. CAD, USD).
   - is_cash_equivalent: true if this position is cash or a money-market/savings equivalent, false otherwise.
   Cash balances within an investment account should be included as a holding with asset_symbol "CASH" and is_cash_equivalent true.
   For non-investment accounts (Chequing, Savings, Credit Card, Line of Credit, HELOC, Mortgage, AutoLoan, Student Loan), return an empty holdings list.

Use null for any metadata value you cannot find."""


def _is_gemini_dump_enabled() -> bool:
    """True when the local-only dump flag is set AND we're not running on Vercel."""
    if os.environ.get("VERCEL"):
        return False
    return os.environ.get("STATEMENT_GEMINI_DUMP", "").strip() in ("1", "true", "yes")


def _redact_payload(payload: dict[str, Any]) -> dict[str, Any]:
    """Return a shallow-redacted copy safe for local debug files."""
    redacted = dict(payload)

    acct = redacted.get("account_id")
    if acct and isinstance(acct, str) and len(acct) > 4:
        redacted["account_id"] = "***" + acct[-4:]

    if "transactions" in redacted:
        redacted["transactions"] = [
            {
                **t,
                "description": (t.get("description", "")[:12] + "...") if len(t.get("description", "")) > 12 else t.get("description", ""),
            }
            for t in redacted["transactions"]
        ]

    return redacted


def _dump_gemini_output(raw_payload: dict[str, Any]) -> None:
    """Write a redacted Gemini JSON dump to disk when STATEMENT_GEMINI_DUMP is enabled."""
    if not _is_gemini_dump_enabled():
        return
    try:
        dump_dir = os.environ.get("STATEMENT_GEMINI_DUMP_DIR", "").strip()
        if not dump_dir:
            dump_dir = str(_repo_root() / "tmp" / "gemini-dumps")
        elif not os.path.isabs(dump_dir):
            dump_dir = str(_repo_root() / dump_dir)

        Path(dump_dir).mkdir(parents=True, exist_ok=True)

        ts = datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")
        provider = re.sub(r"[^a-zA-Z0-9_-]", "_", (raw_payload.get("provider") or "unknown").lower())
        filename = f"gemini_{ts}_{provider}.json"

        redacted = _redact_payload(raw_payload)
        out_path = Path(dump_dir) / filename
        out_path.write_text(json.dumps(redacted, indent=2, default=str), encoding="utf-8")
    except Exception:
        pass


def extract_statement_with_llm(
    markdown: str, *, api_key: str | None = None, model: str | None = None
) -> tuple[dict[str, Any], list[dict[str, Any]], list[dict[str, Any]]]:
    """
    Single Gemini call with structured output enforcement via instructor response_model.
    Returns (metadata_dict, transactions_list, holdings_list).
    The full Pydantic schema (StatementExtraction including HoldingItem) is passed
    as the response_schema to Gemini, guaranteeing the returned JSON matches our DB types.
    """
    import instructor

    key = _get_gemini_api_key(api_key)
    instructor_model = model or (
        get_configured_instructor_model() if get_configured_instructor_model else "google/gemini-2.5-flash-lite"
    )
    client = instructor.from_provider(instructor_model, api_key=key)
    user_content = f"{_build_extraction_prompt()}\n\nDocument:\n\n{markdown}"
    out: StatementExtraction = client.create(
        messages=[{"role": "user", "content": user_content}],
        response_model=StatementExtraction,
    )
    meta = out.model_dump()
    _dump_gemini_output(meta)
    # Normalize account_id: remove spaces so "1 3008701" -> "13008701" (same account across statements)
    if meta.get("account_id") and isinstance(meta["account_id"], str):
        meta["account_id"] = "".join(meta["account_id"].split()).replace("-", "") or meta["account_id"]
    txns_list = meta.pop("transactions", [])
    holdings_list = meta.pop("holdings", [])
    return (meta, txns_list, holdings_list)


def _extract_statement_fields_regex(markdown: str) -> dict[str, Any]:
    """Extract statement fields from markdown using only extract_statement_metadata_from_text. Map to standard dict format."""
    text = markdown.strip()
    if len(text) > MAX_TEXT_FOR_EXTRACTION:
        text = text[:MAX_TEXT_FOR_EXTRACTION]
    get_meta = _get_metadata_extractor()
    meta = get_meta(text.lower(), bank_id="generic")
    # Normalize account number: no spaces so statements match the same account
    raw_account = meta.get("account_number")
    account_id = "".join((raw_account or "").split()).replace("-", "") or raw_account if raw_account else None
    return {
        "provider": meta.get("bank_name") or "Unknown",
        "account_id": account_id,
        "opening_balance": meta.get("opening_balance"),
        "closing_balance": meta.get("total_account_value"),
        "currency": meta.get("currency", "CAD"),
        "start_date": meta.get("start_date"),
        "end_date": meta.get("end_date"),
        "account_type": meta.get("account_type") or "Chequing",
        "transactions": [],
        "holdings": [],
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
            meta, txns_list, holdings_list = extract_statement_with_llm(full_markdown)
            result_dict = {**meta, "transactions": txns_list, "holdings": holdings_list}
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
