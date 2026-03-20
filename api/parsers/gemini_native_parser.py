import json
import os
from pathlib import Path

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


def _get_google_api_key(api_key: str | None = None) -> str:
    key = api_key or os.environ.get("GEMINI_API_KEY")
    if not key:
        raise ValueError("GEMINI_API_KEY must be set (or pass api_key) to use native PDF extraction")
    return key


def _build_native_pdf_prompt() -> str:
    priority = ""
    if get_prompt_rules_text:
        try:
            priority = (get_prompt_rules_text() or "").strip()
        except Exception:
            priority = ""
    priority_section = (priority + "\n") if priority else ""

    return (
        "You are extracting structured data from a bank/financial statement PDF.\n"
        "Return ONLY valid JSON matching the provided schema.\n"
        "\n"
        "IMPORTANT: Read the ENTIRE document from first page to last before extracting.\n"
        "Many statements contain multiple sub-accounts or sections (e.g. CAD cash, USD cash, investments).\n"
        "You MUST combine transactions from ALL sections into a single transactions[] list.\n"
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
        "2) Every transaction in the statement as a list. Include transactions from ALL pages and ALL sub-account sections.\n"
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
        "   - asset_name: Full name of the asset.\n"
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
