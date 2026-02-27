"""
Shared utilities for bank statement parsers.
"""
import re
from typing import Any

# Regex patterns for dates and amounts
DATE_PATTERNS = [
    r"(\d{1,2}[/\-]\d{1,2}[/\-]\d{2,4})",
    r"(\d{4}[/\-]\d{1,2}[/\-]\d{1,2})",
    r"(\d{1,2}\s+(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+\d{2,4})",
]
# Standard minus, en-dash U+2013, em-dash U+2014
AMOUNT_PATTERN = re.compile(r"[-–—]?\$?\s*([\d,]+(?:\.\d{2})?)\s*$")
PAREN_AMOUNT_PATTERN = re.compile(r"\(\s*\$?\s*([\d,]+(?:\.\d{2})?)\s*\)")
# Signed amount (with - or – or —) - require decimals to avoid matching -03 in 2025-03-01
SIGNED_AMOUNT_PATTERN = re.compile(r"[-–—]\s*\$?\s*([\d,]+\.\d{2})")
# Positive tx amount followed by balance: "$5.46 $5,953.73" - capture first amount
POSITIVE_TXN_AMOUNT_PATTERN = re.compile(r"\$\s*([\d,]+\.\d{2})\s+(?=\$?[\d,])")

# Rows that look like headers/summaries, not transactions
SKIP_DESCRIPTIONS = frozenset({
    "date", "posted date", "description", "amount", "balance",
    "debit", "credit", "total", "opening balance", "closing balance",
    "balance forward", "summary", "activity", "account number",
    "mar 1 - mar 31", "calgary", "canada", "page",
})


def looks_like_pagination_or_footer(desc: str) -> bool:
    """Return True if description looks like pagination or footer, not a transaction."""
    if not desc or len(desc) < 5:
        return False
    d = desc.lower()
    if "page" in d and " of " in d:
        return True
    if "inc." in d or "inc," in d:
        return True
    if re.search(r"\d+\s*-\s*\d+\s+\w+\s+(?:st|ave|rd|blvd)", d, re.I):
        return True
    return False


def normalize_amount(raw: str) -> float:
    """Parse amount string to float. Parentheses and leading minus/en-dash = negative."""
    raw = str(raw).strip().replace(",", "").replace("–", "-").replace("—", "-")
    is_negative = raw.startswith("(") or raw.startswith("-")
    n = float(re.sub(r"[^\d.-]", "", raw.replace("(", "-")))
    return -abs(n) if is_negative else abs(n)


def looks_like_header_or_summary(desc: str) -> bool:
    """Return True if description suggests a header/summary row, not a transaction."""
    if not desc or len(desc) < 2:
        return True
    d = desc.lower().strip()
    if d in SKIP_DESCRIPTIONS:
        return True
    if d.startswith("balance") or d.startswith("total"):
        return True
    return False


def find_header_row(table: list, header_keywords: tuple = (
    "date", "desc", "description", "amount", "debit", "credit",
    "post", "posted", "withdrawal", "deposit", "balance", "particulars", "details"
)) -> int:
    """Find the 0-based row index that contains column headers."""
    for i, row in enumerate(table):
        if not row:
            continue
        row_text = " ".join(str(c).lower() for c in (row or []) if c)
        matches = sum(1 for kw in header_keywords if kw in row_text)
        if matches >= 2:
            return i
    return 0
