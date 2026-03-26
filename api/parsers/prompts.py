"""
Centralised prompt builder for bank/financial statement extraction parsers.

Each parser supplies its own modality_instructions describing how the document
was pre-processed; the shared business logic (metadata fields, transaction rules,
holdings rules) lives here so it only needs to be maintained in one place.
"""

from .schema import (
    get_allowed_account_types_prompt_suffix,
    get_allowed_category_names_prompt_suffix,
)

__all__ = [
    "get_allowed_account_types_prompt_suffix",
    "get_allowed_category_names_prompt_suffix",
    "build_core_extraction_prompt",
]


def build_core_extraction_prompt(modality_instructions: str, priority_rules: str = "") -> str:
    """
    Build the shared extraction prompt, injecting parser-specific modality instructions.

    Args:
        modality_instructions: Parser-specific preamble describing how the document
            was prepared (e.g. "converted to markdown", "native PDF bytes").
        priority_rules: Optional priority/override rules fetched from the DB
            (e.g. user-defined categorisation rules). Pass an empty string if none.
    """
    priority_section = (f"\n{priority_rules}\n") if priority_rules else ""
    account_types = get_allowed_account_types_prompt_suffix()
    categories = get_allowed_category_names_prompt_suffix()

    return f"""You are extracting structured data from a bank/financial statement.
Return ONLY valid JSON matching the provided schema.

{modality_instructions}

1) Statement metadata:
   - provider: The bank or financial institution name (e.g. Wealthsimple, TD, RBC).
   - account_id: The account number or account ID **exactly as printed on the statement** (digits or alphanumeric). 
     For credit card statements: copy the card identifier verbatim, including masking characters (`*`, `•`), spaces, and punctuation. **Do not replace `*` with digits, do not insert zeros, and do not “complete” or lengthen the number.** If the statement only shows a masked PAN, your `account_id` must still contain those mask characters — it must not become a single long all-digit string.
     For non-credit accounts: still copy exactly as printed; remove only spaces/dashes if needed for a compact ID, but never invent characters.
     Do not use dates (e.g. 20250402) as account_id. If no clear account identifier is present, use null.
   - opening_balance: Numeric balance at the start of the statement period. For investment/brokerage accounts (e.g. TFSA, RRSP, Margin), this MUST be the Total Portfolio Value or Total Market Value, NOT just the cash portion. (No currency symbol).
   - closing_balance: Numeric balance at the end of the statement period. For investment/brokerage accounts, this MUST be the Total Portfolio Value or Total Market Value, NOT just the cash portion. (No currency symbol).
   - currency: Currency code, e.g. CAD or USD.
   - start_date: First day of the statement period in YYYY-MM-DD format.
   - end_date: Last day of the statement period in YYYY-MM-DD format.
   - account_type: You MUST use exactly one of these values (pick the closest match to what the document says): {account_types}. Do not use any other wording (e.g. use "TFSA" not "Tax-Free Savings", use "RRSP" not "Registered Retirement Savings Plan").
   - opening_cash_balance / closing_cash_balance: For investment/brokerage accounts ONLY, if the statement shows period start/end cash (cash balance, not total portfolio value), extract those numeric values. Must match opening_balance/closing_balance currency. Use null if not stated or unclear.

2) Every transaction in the statement as a list. These are transaction line items from a bank or brokerage statement (not from a live feed with clean merchant names). Descriptions may be abbreviated, include reference numbers, ATM/terminal IDs, or payee names, and format varies by institution—use this context when assigning categories.
{priority_section}   For each transaction provide: date (YYYY-MM-DD), description (text), amount, transaction_type, category, confidence_score (0-1), currency.
   - amount: For Credit Card statements, return the ABSOLUTE VALUE as printed on the statement (always positive). For all other account types, use signed amounts (negative = outflow, positive = inflow).
   - currency: ISO 4217 currency code for THIS transaction (e.g. CAD, USD). Multi-currency statements (e.g. Wealthsimple with CAD and USD sections) MUST tag each transaction with the correct currency from its section. Default to the statement-level currency when only one currency is present.
   - transaction_type: Classify each transaction as exactly one of: purchase, fee, interest, cash_advance, payment, credit, refund, deposit, withdrawal, transfer.
     For Credit Card statements: purchases/charges → "purchase", finance charges → "interest", annual/late fees → "fee", ATM cash → "cash_advance", payments to the card → "payment", refunds/credit vouchers/cashback applied → "credit" or "refund".
     For other account types: deposits/income → "deposit", withdrawals/debits → "withdrawal", transfers → "transfer", fees → "fee".
   - category: You MUST use exactly one of these values: {categories}, or "Uncategorized". Use "Uncategorized" ONLY when your confidence in the category assignment is less than 0.8; otherwise pick the best-matching category from the list and set confidence_score at least 0.8.
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

Important rules:
- Ignore boilerplate text, terms and conditions, marketing pages, and fee schedules.
- Do not invent transactions. If there are no transactions, return an empty list.
- Prefer the detailed transaction table/ledger over any totals/summary sections.
- Use null for any metadata value you cannot find."""
