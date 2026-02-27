"""
Wealthsimple Cash monthly statement parser.
Columns: DATE, POSTED DATE, DESCRIPTION, AMOUNT (CAD), BALANCE (CAD)
Amount: positive = deposit, negative = withdrawal (matches our convention).
"""
import logging
from typing import Any

import pdfplumber

from .base import (
    AMOUNT_PATTERN,
    PAREN_AMOUNT_PATTERN,
    SIGNED_AMOUNT_PATTERN,
    find_header_row,
    looks_like_header_or_summary,
    looks_like_pagination_or_footer,
    normalize_amount,
)

logger = logging.getLogger(__name__)

# Wealthsimple column header keywords (order matters for fallback)
DATE_COL_KEYWORDS = ("date",)
DESC_COL_KEYWORDS = ("description",)
AMOUNT_COL_KEYWORDS = ("amount (cad)", "amount")


def _detect_columns(headers: list[str]) -> tuple[int, int, int]:
    """Return (date_col, desc_col, amount_col) indices."""
    date_col = desc_col = amount_col = None
    for i, h in enumerate(headers):
        h_lower = (h or "").lower()
        if any(kw in h_lower for kw in DATE_COL_KEYWORDS) and "posted" not in h_lower:
            date_col = i
        elif any(kw in h_lower for kw in DESC_COL_KEYWORDS):
            desc_col = i
        elif any(kw in h_lower for kw in AMOUNT_COL_KEYWORDS) and "balance" not in h_lower:
            amount_col = i
    # Fallbacks
    if date_col is None:
        date_col = 0
    if amount_col is None:
        amount_col = len(headers) - 2  # often second-to-last (before balance)
    if desc_col is None:
        desc_col = 2 if len(headers) > 3 else 1
    return date_col, desc_col, amount_col


def _page_has_activity(page) -> bool:
    """Check if page text contains Activity section (transaction table)."""
    text = page.extract_text() or ""
    return "activity" in text.lower()


def parse_wealthsimple(pdf: pdfplumber.PDF) -> list[dict[str, Any]]:
    """Parse Wealthsimple Cash statement. Skips header, finds Activity table."""
    transactions = []
    for page in pdf.pages:
        if not _page_has_activity(page):
            continue
        tables = page.extract_tables()
        for table in tables or []:
            if not table or len(table) < 2:
                continue
            header_row_idx = find_header_row(table)
            headers = [str(h).lower() if h else "" for h in table[header_row_idx]]
            header_text = " ".join(headers)
            if "description" not in header_text or "amount" not in header_text:
                continue
            date_col, desc_col, amount_col = _detect_columns(headers)
            data_start = header_row_idx + 1

            for row in table[data_start:]:
                if not row or len(row) <= max(date_col, desc_col, amount_col):
                    continue
                amount_val = str(row[amount_col] or "").strip()
                if not amount_val:
                    continue
                amt_match = (
                    SIGNED_AMOUNT_PATTERN.search(amount_val)
                    or PAREN_AMOUNT_PATTERN.search(amount_val)
                    or AMOUNT_PATTERN.search(amount_val)
                )
                if not amt_match:
                    continue
                try:
                    raw = amt_match.group(0)  # Full match preserves sign (e.g. –$16.00)
                    amount = normalize_amount(raw)
                except (ValueError, TypeError):
                    continue
                desc_val = str(row[desc_col] or "").strip()
                if looks_like_header_or_summary(desc_val) or looks_like_pagination_or_footer(desc_val):
                    continue
                date_val = str(row[date_col] or "").strip() or None
                transactions.append({
                    "date": date_val,
                    "description": desc_val or "Unknown",
                    "amount": round(amount, 2),
                })
    return transactions
