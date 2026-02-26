"""
Generic parser for Canadian bank statement PDFs.
Fallback when no bank-specific template matches.
"""
import logging
import re
from typing import Any

import pdfplumber

from parsers.base import (
    AMOUNT_PATTERN,
    DATE_PATTERNS,
    PAREN_AMOUNT_PATTERN,
    POSITIVE_TXN_AMOUNT_PATTERN,
    SIGNED_AMOUNT_PATTERN,
    find_header_row,
    looks_like_header_or_summary,
    looks_like_pagination_or_footer,
    normalize_amount,
)

logger = logging.getLogger(__name__)


def _extract_from_tables(pdf: pdfplumber.PDF) -> list[dict[str, Any]]:
    """Extract transactions from table structures."""
    transactions = []
    for page in pdf.pages:
        tables = page.extract_tables()
        for table in tables or []:
            if not table or len(table) < 2:
                continue
            header_row_idx = find_header_row(table)
            headers = [str(h).lower() if h else "" for h in table[header_row_idx]]
            date_col = desc_col = amount_col = None
            for i, h in enumerate(headers):
                if not h:
                    continue
                if "date" in h or "post" in h:
                    date_col = i
                elif "desc" in h or "description" in h or "details" in h or "particulars" in h:
                    desc_col = i
                elif "amount" in h or "debit" in h or "credit" in h or "withdrawal" in h or "deposit" in h:
                    amount_col = i
            if date_col is None:
                date_col = 0
            if amount_col is None:
                amount_col = len(headers) - 1
            if desc_col is None:
                desc_col = 1 if len(headers) > 2 else 0

            for row in table[header_row_idx + 1:]:
                if not row or len(row) <= max(date_col, desc_col, amount_col):
                    continue
                date_val = str(row[date_col] or "").strip()
                desc_val = str(row[desc_col] or "").strip()
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
                    raw = amt_match.group(1) if amt_match.lastindex else amt_match.group(0)
                    is_neg = bool(
                        SIGNED_AMOUNT_PATTERN.search(amount_val)
                        or PAREN_AMOUNT_PATTERN.search(amount_val)
                    )
                    amount = -abs(normalize_amount(raw)) if is_neg else normalize_amount(raw)
                except (ValueError, TypeError):
                    continue
                if looks_like_header_or_summary(desc_val):
                    continue
                transactions.append({
                    "date": date_val or None,
                    "description": desc_val or "Unknown",
                    "amount": round(amount, 2),
                })
    return transactions


def _extract_from_text(pdf: pdfplumber.PDF) -> list[dict[str, Any]]:
    """Fallback: extract from raw text using regex."""
    transactions = []
    past_activity = False
    sample_text = " ".join(
        p.extract_text() or "" for p in list(pdf.pages)[:2]
    ).lower()
    require_activity = "wealthsimple" in sample_text
    for page in pdf.pages:
        text = page.extract_text()
        if not text:
            continue
        for line in text.split("\n"):
            line = line.strip()
            if len(line) < 5:
                continue
            if "activity" in line.lower():
                past_activity = True
                continue
            if require_activity and not past_activity:
                continue
            # Prefer transaction amount over balance: signed (-$16), positive ($5.46), then trailing
            signed_match = SIGNED_AMOUNT_PATTERN.search(line)
            paren_match = PAREN_AMOUNT_PATTERN.search(line)
            positive_txn_match = POSITIVE_TXN_AMOUNT_PATTERN.search(line)
            end_match = AMOUNT_PATTERN.search(line)
            amt_match = signed_match or paren_match or positive_txn_match or end_match
            if not amt_match:
                continue
            is_negative = bool(signed_match or paren_match)
            date_val = None
            for pat in DATE_PATTERNS:
                m = re.search(pat, line)
                if m:
                    date_val = m.group(1)
                    break
            try:
                raw = amt_match.group(1) if amt_match.lastindex else amt_match.group(0)
                amount = -abs(normalize_amount(raw)) if is_negative else normalize_amount(raw)
            except (ValueError, TypeError):
                continue
            if abs(amount) < 0.01 or abs(amount) > 999_999:
                continue
            desc = re.sub(SIGNED_AMOUNT_PATTERN, "", line)
            desc = re.sub(POSITIVE_TXN_AMOUNT_PATTERN, "", desc)
            desc = re.sub(AMOUNT_PATTERN, "", desc).strip()
            desc = re.sub(PAREN_AMOUNT_PATTERN, "", desc).strip()
            for p in DATE_PATTERNS:
                desc = re.sub(p, "", desc, flags=re.I).strip()
            desc = re.sub(r"\s+", " ", desc).strip() or "Unknown"
            if looks_like_header_or_summary(desc) or looks_like_pagination_or_footer(desc) or len(desc) < 3:
                continue
            # Skip lines that look like address/account (no date, short or numeric desc)
            if not date_val and (len(desc) < 10 or desc.replace(" ", "").isdigit()):
                continue
            transactions.append({"date": date_val, "description": desc, "amount": round(amount, 2)})
    return transactions


def parse_generic(pdf: pdfplumber.PDF) -> list[dict[str, Any]]:
    """Parse using generic table/text extraction."""
    txns = _extract_from_tables(pdf)
    if not txns:
        txns = _extract_from_text(pdf)
    return txns
