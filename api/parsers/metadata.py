"""
Extract statement metadata from PDF text: account number, account name/type, bank name,
total account value. Used for account get-or-create and Type 2/3 balance.
"""
import re
from typing import Any

import pdfplumber

from .account_types_ref import get_account_type_keywords, get_valid_account_type_names

# Common bank/institution names
BANK_KEYWORDS = [
    "wealthsimple", "td canada", "rbc", "scotiabank", "bmo", "cibc", "national bank",
    "desjardins", "tangerine", "simplii", "eq bank", "questrade", "koho", "neo financial",
]
# Prefer: "Account number:" / "Account No." - capture only what follows the label (not the word "accountno" etc.)
ACCOUNT_NUMBER_LABEL_PATTERN = re.compile(
    r"account\s*(?:number|#|no)\s*\.?\s*:?\s*[\s.]*\s*([A-Za-z0-9][A-Za-z0-9\s\-]{2,})",
    re.I,
)
# Reject captures that are the label or nearby header words (PDF extraction artifacts)
ACCOUNT_NUMBER_BLOCKLIST = frozenset({
    "account", "accountno", "accountnumber", "number", "no",
    "owner", "statement", "period", "statementperiod", "ownerstatementperiod",
})
# Fallback: masked form e.g. ****1234
ACCOUNT_NUMBER_MASKED_PATTERN = re.compile(r"\*{2,}(\d{4,})")
# Last resort: digits or alphanumeric in lines that contain "account"
ACCOUNT_NUMBER_GENERIC_IN_LINE_PATTERN = re.compile(
    r"([A-Za-z0-9][A-Za-z0-9\s\-]{3,})",
    re.I,
)
# Closing balance (prefer these so we don't take "opening" or "jan 1" by mistake)
# Month + 30 (Apr, Jun, Sep, Nov) and 31 (Jan, Mar, May, Jul, Aug, Oct, Dec)
CLOSING_BALANCE_PATTERNS = [
    re.compile(r"(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\s*30\s+balance\s*:?\s*\$?\s*([\d,]+\.?\d*)", re.I),
    re.compile(r"(?:january|february|march|april|june|july|august|september|october|november|december)\s+30\s+balance\s*:?\s*\$?\s*([\d,]+\.?\d*)", re.I),
    re.compile(r"(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\s*31\s+balance\s*:?\s*\$?\s*([\d,]+\.?\d*)", re.I),
    re.compile(r"(?:january|february|march|april|june|july|august|september|october|november|december)\s+31\s+balance\s*:?\s*\$?\s*([\d,]+\.?\d*)", re.I),
    re.compile(r"closing\s+balance\s*:?\s*\$?\s*([\d,]+\.?\d*)", re.I),
    re.compile(r"end\s+(?:of\s+)?(?:period\s+)?balance\s*:?\s*\$?\s*([\d,]+\.?\d*)", re.I),
    re.compile(r"total\s+account\s+value\s*:?\s*\$?\s*([\d,]+\.?\d*)", re.I),
    re.compile(r"account\s+value\s*:?\s*\$?\s*([\d,]+\.?\d*)", re.I),
]
# Opening balance (for statement opening_balance only)
OPENING_BALANCE_PATTERNS = [
    re.compile(r"(?:jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)\s*1\s+balance\s*:?\s*\$?\s*([\d,]+\.?\d*)", re.I),
    re.compile(r"(?:january|february|march|april|june|july|august|september|october|november|december)\s+1\s+balance\s*:?\s*\$?\s*([\d,]+\.?\d*)", re.I),
    re.compile(r"opening\s+balance\s*:?\s*\$?\s*([\d,]+\.?\d*)", re.I),
    re.compile(r"beginning\s+(?:of\s+)?(?:period\s+)?balance\s*:?\s*\$?\s*([\d,]+\.?\d*)", re.I),
]
# Fallback: any "balance" (may capture opening if closing not found)
TOTAL_VALUE_PATTERNS = [
    re.compile(r"balance\s*:?\s*\$?\s*([\d,]+\.?\d*)", re.I),
]
# Month abbreviations for summary box (e.g. "APR 1 BALANCE", "APR 30 BALANCE")
MONTH_ABBREVS = (
    "jan", "feb", "mar", "apr", "may", "jun",
    "jul", "aug", "sep", "oct", "nov", "dec",
)
def _sample_text(pdf: pdfplumber.PDF, max_pages: int = 3) -> str:
    """First few pages as single string (lowercase)."""
    parts = []
    for i, page in enumerate(pdf.pages):
        if i >= max_pages:
            break
        t = page.extract_text()
        if t:
            parts.append(t)
    return " ".join(parts).lower()


def _looks_like_yyyymmdd(raw: str) -> bool:
    """Reject 8-digit tokens that parse as YYYYMMDD so we don't use statement dates as account_id."""
    if not raw or len(raw) != 8 or not raw.isdigit():
        return False
    try:
        y, m, d = int(raw[:4]), int(raw[4:6]), int(raw[6:8])
        return 1900 <= y <= 2100 and 1 <= m <= 12 and 1 <= d <= 31
    except (ValueError, TypeError):
        return False


def _extract_account_number(text: str) -> str | None:
    """Extract account number (digits or alphanumeric e.g. HQ4PL3MK9CAD), preferring explicit label."""
    def normalize(raw: str) -> str | None:
        raw = re.sub(r"[\s\-]", "", raw.strip())
        if not raw or len(raw) > 24:
            return None
        if raw.lower() in ACCOUNT_NUMBER_BLOCKLIST:
            return None
        # Reject date-like 8-digit numbers (e.g. 20250402) that Docling/text can surface as account
        if _looks_like_yyyymmdd(raw):
            return None
        # Allow digits-only (e.g. 13008701) or alphanumeric (e.g. HQ4PL3MK9CAD)
        if 4 <= len(raw) <= 24 and raw.isalnum():
            return raw
        return None

    # 1. Best: "Account number: 13008701" or "Account No. HQ4PL3MK9CAD"
    m = ACCOUNT_NUMBER_LABEL_PATTERN.search(text)
    if m:
        token = m.group(1).strip()
        # Stop at common trailing words (e.g. "ORDER EXECUTION ONLY")
        token = re.split(r"\s+(?:order|execution|only|account|all)\b", token, 1, re.I)[0].strip()
        # Try whole token first, then each word (Docling may put date next to account number)
        for candidate in [token] + token.split():
            n = normalize(candidate)
            if n:
                return n

    # 2. Masked form e.g. ****1234
    m = ACCOUNT_NUMBER_MASKED_PATTERN.search(text)
    if m:
        return m.group(1).strip()

    # 3. Only search lines that contain "account" - skip label words like "accountno"
    for line in text.split("\n"):
        line = line.strip()
        if "account" in line.lower():
            for m in ACCOUNT_NUMBER_GENERIC_IN_LINE_PATTERN.finditer(line):
                n = normalize(m.group(1))
                if n:
                    return n
    return None


def _extract_account_name_and_type(text: str) -> tuple[str | None, str]:
    """Return (account_name, account_type). account_type is from account_types reference."""
    for keyword, acc_type in get_account_type_keywords():
        if keyword.lower() in text:
            return (keyword, acc_type)
    return (None, "Chequing")


def _extract_bank_name(text: str, bank_id: str) -> str:
    """Infer bank/institution name from text or bank_id."""
    for kw in BANK_KEYWORDS:
        if kw in text:
            return kw.replace(" ", " ").title()
    if bank_id and bank_id != "generic":
        return bank_id.title()
    return "Unknown"


def _extract_total_account_value(text: str) -> float | None:
    """Prefer closing-balance patterns so we get end-of-period balance, not opening."""
    for pat in CLOSING_BALANCE_PATTERNS:
        m = pat.search(text)
        if m:
            try:
                return float(m.group(1).replace(",", ""))
            except (ValueError, TypeError):
                continue
    for pat in TOTAL_VALUE_PATTERNS:
        m = pat.search(text)
        if m:
            try:
                return float(m.group(1).replace(",", ""))
            except (ValueError, TypeError):
                continue
    return None


def _extract_opening_balance(text: str) -> float | None:
    for pat in OPENING_BALANCE_PATTERNS:
        m = pat.search(text)
        if m:
            try:
                return float(m.group(1).replace(",", ""))
            except (ValueError, TypeError):
                continue
    return None


def _normalize_account_number_token(raw: str) -> str | None:
    """Return normalized account number (4–24 alphanumeric) or None if invalid/blocklisted."""
    if not raw or not isinstance(raw, str):
        return None
    s = re.sub(r"[\s\-]", "", raw.strip())
    if not s or len(s) > 24:
        return None
    if s.lower() in ACCOUNT_NUMBER_BLOCKLIST:
        return None
    if 4 <= len(s) <= 24 and s.isalnum():
        return s
    return None


def extract_account_number_bbox(pdf: pdfplumber.PDF, max_pages: int = 2) -> str | None:
    """
    Extract account number using word positions. Looks for "Account number" (or "Account No.") label
    and the following token on the same line, e.g. "Account number: 13008701".
    """
    all_words: list[dict] = []
    for i, page in enumerate(pdf.pages):
        if i >= max_pages:
            break
        w = page.extract_words()
        if w:
            all_words.extend(w)
    if not all_words:
        return None
    for w in all_words:
        if "top" not in w:
            w["top"] = 0
        if "x0" not in w:
            w["x0"] = 0
    all_words.sort(key=lambda w: (round(w["top"] / 4) * 4, w["x0"]))

    i = 0
    while i < len(all_words):
        w = all_words[i]
        text = (w.get("text") or "").strip()
        if text.lower() != "account":
            i += 1
            continue
        # Next word(s) on same line may be "number", "no", "#", or "number:"
        line_top = w.get("top", 0)
        j = i + 1
        while j < len(all_words):
            nw = all_words[j]
            nt = (nw.get("text") or "").strip().lower()
            ntop = nw.get("top", 0)
            if abs(ntop - line_top) > 8:
                break
            if nt in ("number", "no", "no.", "#") or nt.startswith("number"):
                j += 1
                break
            if _normalize_account_number_token(nt):
                return _normalize_account_number_token(nt)
            j += 1
        while j < len(all_words):
            nw = all_words[j]
            nt = (nw.get("text") or "").strip()
            ntop = nw.get("top", 0)
            if abs(ntop - line_top) > 15:
                break
            normalized = _normalize_account_number_token(nt)
            if normalized:
                return normalized
            j += 1
        i += 1
    return None


def _parse_currency_word(text: str) -> float | None:
    """Parse a single word as currency (e.g. $2,235.79 or 6,231.33). Returns None if not valid."""
    if not text or not isinstance(text, str):
        return None
    s = text.strip().replace("$", "").replace(",", "")
    try:
        val = float(s)
        if abs(val) < 1e12:  # sanity
            return val
    except (ValueError, TypeError):
        pass
    return None


def extract_summary_balances_bbox(pdf: pdfplumber.PDF, max_pages: int = 2) -> tuple[float | None, float | None]:
    """
    Extract starting (day 1) and ending (day 28–31) balance from a summary box using word positions.
    Layout like Wealthsimple: "APR 1 BALANCE" / "$2,235.79" and "APR 30 BALANCE" / "$6,231.33".
    Returns (opening_balance, closing_balance); either can be None if not found.
    """
    opening: float | None = None
    closing: float | None = None
    # Collect words from first page(s)
    all_words: list[dict] = []
    for i, page in enumerate(pdf.pages):
        if i >= max_pages:
            break
        w = page.extract_words()
        if w:
            all_words.extend(w)
    if not all_words:
        return (None, None)
    # Sort by vertical then horizontal position (top, x0)
    for w in all_words:
        if "top" not in w:
            w["top"] = 0
        if "x0" not in w:
            w["x0"] = 0
    all_words.sort(key=lambda w: (round(w["top"] / 4) * 4, w["x0"]))
    # Find BALANCE labels with month + day prefix (e.g. APR 1 BALANCE, APR 30 BALANCE)
    i = 0
    while i < len(all_words):
        w = all_words[i]
        text = (w.get("text") or "").strip()
        if text.upper() != "BALANCE":
            i += 1
            continue
        # Preceding two words should be month abbrev and day number
        if i < 2:
            i += 1
            continue
        prev1 = (all_words[i - 1].get("text") or "").strip()
        prev2 = (all_words[i - 2].get("text") or "").strip()
        month_candidate = prev2.lower()
        day_candidate = prev1
        if month_candidate not in MONTH_ABBREVS:
            i += 1
            continue
        try:
            day_num = int(day_candidate.replace(",", ""))
        except (ValueError, TypeError):
            i += 1
            continue
        if day_num < 1 or day_num > 31:
            i += 1
            continue
        # This BALANCE is for (month, day). Column = x0 of this label.
        ref_x0 = w.get("x0", 0)
        ref_x1 = w.get("x1", ref_x0 + 50)
        ref_top = w.get("top", 0)
        ref_bottom = w.get("bottom", ref_top + 12)
        col_center = (ref_x0 + ref_x1) / 2
        col_width = max(80, ref_x1 - ref_x0 + 20)
        # Find amount: same column, on same line or next line (below)
        candidates = [
            ow for ow in all_words
            if ow.get("top") is not None and ref_top - 2 <= ow["top"] <= ref_bottom + 35
            and abs((ow.get("x0", 0) + ow.get("x1", 0)) / 2 - col_center) <= col_width
        ]
        amount_val: float | None = None
        for c in candidates:
            # Skip the label words we already used
            if c is all_words[i - 2] or c is all_words[i - 1] or c is all_words[i]:
                continue
            parsed = _parse_currency_word(c.get("text") or "")
            if parsed is not None:
                amount_val = parsed
                break
        if amount_val is not None:
            if day_num == 1:
                opening = amount_val
            if day_num >= 28:
                closing = amount_val
        i += 1
    return (opening, closing)


def extract_statement_metadata(pdf: pdfplumber.PDF, bank_id: str) -> dict[str, Any]:
    """
    Extract metadata from PDF. Returns dict with keys:
    account_number, account_name, account_type, bank_name,
    total_account_value (closing), opening_balance (all optional).
    account_type is one of the reference account types.
    """
    valid_types = get_valid_account_type_names()
    text = _sample_text(pdf)
    account_number = _extract_account_number(text)
    account_name, account_type = _extract_account_name_and_type(text)
    bank_name = _extract_bank_name(text, bank_id)
    total_value = _extract_total_account_value(text)
    opening = _extract_opening_balance(text)
    return {
        "account_number": account_number,
        "account_name": account_name or "Account",
        "account_type": account_type if account_type in valid_types else "Chequing",
        "bank_name": bank_name,
        "total_account_value": total_value,
        "opening_balance": opening,
    }


def extract_statement_metadata_from_text(text: str, bank_id: str = "generic") -> dict[str, Any]:
    """
    Extract metadata from plain text (e.g. from Docling export). Returns same dict shape as
    extract_statement_metadata: account_number, account_name, account_type, bank_name,
    total_account_value (closing), opening_balance.
    """
    if not text or not isinstance(text, str):
        text = ""
    lower = text.lower()
    valid_types = get_valid_account_type_names()
    account_number = _extract_account_number(lower)
    account_name, account_type = _extract_account_name_and_type(lower)
    bank_name = _extract_bank_name(lower, bank_id)
    total_value = _extract_total_account_value(lower)
    opening = _extract_opening_balance(lower)
    return {
        "account_number": account_number,
        "account_name": account_name or "Account",
        "account_type": account_type if account_type in valid_types else "Chequing",
        "bank_name": bank_name,
        "total_account_value": total_value,
        "opening_balance": opening,
    }
