"""
Shared statement extraction schema and prompt helpers.

Used by all statement parsers (docling, gemini_native, pdfplumber) so they can
run independently—no parser imports another parser. Import from here for
StatementExtraction and allowed account type/category prompt suffixes.
"""

from typing import Literal

from pydantic import BaseModel, Field

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


# --- Pydantic models (canonical schema for all parsers) ---


class AmountMapping(BaseModel):
    """How a CSV encodes transaction amount values."""

    mode: Literal["signed", "split"] = Field(description="Amount mode: signed single column or split inflow/outflow columns")
    column: str | None = Field(default=None, description="Column for signed amounts when mode='signed'")
    inflow_col: str | None = Field(default=None, description="Column for incoming amounts when mode='split'")
    outflow_col: str | None = Field(default=None, description="Column for outgoing amounts when mode='split'")


class CSVColumnMapping(BaseModel):
    """LLM-generated mapping from CSV headers to extraction fields."""

    provider: str = Field(description="Guessed bank or financial institution name")
    account_type: Literal["depository", "credit", "investment", "loan"] = Field(
        description="Guessed top-level account type"
    )
    account_subtype: str | None = Field(
        default=None,
        description="Optional canonical subtype guess (e.g. Chequing, Savings, Credit Card, TFSA, Line of Credit)",
    )
    date_col: str = Field(description="Exact CSV column name containing transaction date")
    date_format: str = Field(description="Python strptime format for date_col values (e.g. '%Y-%m-%d')")
    description_col: str = Field(description="Exact CSV column name containing transaction description/memo")
    amount_logic: AmountMapping = Field(description="How to compute signed amount from one or two CSV columns")
    balance_col: str | None = Field(default=None, description="Optional running balance column if present")
    account_subtype_col: str | None = Field(
        default=None,
        description="Optional CSV column containing per-row account subtype values (e.g. Chequing, TFSA, Credit Card)",
    )
    currency: str = Field(default="CAD", description="Guessed currency code")
    account_id_col: str | None = Field(
        default=None,
        description="Optional CSV column for per-row account id/number; use when no standard account_id/account number header exists. Must exactly match a header.",
    )
    currency_col: str | None = Field(
        default=None,
        description="Optional CSV column for per-row ISO currency; use when headers are not standard. Must exactly match a header.",
    )


class StatementFields(BaseModel):
    """Extracted statement metadata; matches the JSON output schema."""

    provider: str = Field(default="Unknown", description="Bank or financial institution name (e.g. Wealthsimple, TD)")
    account_id: str | None = Field(default=None, description="Account number or account ID from the statement")
    opening_balance: float | None = Field(default=None, description="Balance at start of statement period")
    closing_balance: float | None = Field(default=None, description="Balance at end of statement period")
    opening_cash_balance: float | None = Field(
        default=None,
        description="Investment/brokerage only: cash balance at period start (not NAV). Null if not on statement.",
    )
    closing_cash_balance: float | None = Field(
        default=None,
        description="Investment/brokerage only: cash balance at period end (not NAV). Null if not on statement.",
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
    currency: str = Field(
        default="CAD",
        description="ISO 4217 currency for this transaction (e.g. CAD, USD)",
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
        description="Bank/credit: full ledger. Investment/brokerage: all lines that change account cash (deposits, withdrawals, trades, dividends to cash, fees, interest, transfers, etc.).",
    )
    holdings: list[HoldingItem] = Field(default_factory=list, description="Itemized holding positions for investment/brokerage accounts; empty for depository/credit/loan accounts")


# --- Prompt helpers (used by any parser that builds LLM prompts) ---


def get_allowed_account_types_prompt_suffix() -> str:
    """Allowed account_type values for LLM prompt (from account_types.json or fallback)."""
    if get_valid_account_type_names is None:
        return "AutoLoan, Chequing, Credit Card, Crypto, DPSP, ESOP, FHSA, GIC, HELOC, Line of Credit, LIRA, Margin, Mortgage, RDSP, RESP, RPP, RRIF, RRSP, Savings, Student Loan, TFSA"
    return ", ".join(sorted(get_valid_account_type_names()))


def get_allowed_category_names_prompt_suffix() -> str:
    """Allowed category names for LLM prompt (from categories.json or fallback). Does not include 'Uncategorized'."""
    if get_category_names is None:
        return "Bank & broker fees, Career & Education, Credit Card Payment, Dining & Coffee, E-Transfer, Entertainment & Subs, Gifts and Donations, Groceries, Health & Wellness, Housing, Household & Shopping, Income, Loans & Reimbursements, Miscellaneous, Securities Trading, Self-Transfer, Transport & Auto, Travel, Utilities & Phone"
    return ", ".join(get_category_names())
