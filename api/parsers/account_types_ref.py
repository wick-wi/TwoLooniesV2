"""
Shared account types reference loaded from api/data/account_types.json.
Used by metadata and docling_statement for validation and keyword inference.
"""
import json
from pathlib import Path

_ACCOUNT_TYPES_PATH = Path(__file__).resolve().parent.parent / "data" / "account_types.json"

# Keywords to infer account type from PDF text (order: more specific first).
# Each (phrase, canonical_name) must match a "name" in account_types.json.
ACCOUNT_TYPE_KEYWORDS_ORDERED = [
    ("Credit Card", "Credit Card"),
    ("Line of Credit", "Line of Credit"),
    ("Student Loan", "Student Loan"),
    ("Auto Loan", "AutoLoan"),
    ("AutoLoan", "AutoLoan"),
    ("Tax-Free Savings", "TFSA"),
    ("Tax Free Savings", "TFSA"),
    ("TFSA", "TFSA"),
    ("Chequing", "Chequing"),
    ("Cash", "Chequing"),
    ("Savings", "Savings"),
    ("HELOC", "HELOC"),
    ("Mortgage", "Mortgage"),
    ("RRSP", "RRSP"),
    ("RRIF", "RRIF"),
    ("FHSA", "FHSA"),
    ("RESP", "RESP"),
    ("RDSP", "RDSP"),
    ("LIRA", "LIRA"),
    ("RPP", "RPP"),
    ("DPSP", "DPSP"),
    ("Margin", "Margin"),
    ("ESOP", "ESOP"),
    ("Crypto", "Crypto"),
    ("GIC", "GIC"),
]

_cached_valid_names: frozenset[str] | None = None
_cached_keyword_pairs: list[tuple[str, str]] | None = None


def _load() -> tuple[frozenset[str], list[tuple[str, str]]]:
    global _cached_valid_names, _cached_keyword_pairs
    if _cached_valid_names is not None and _cached_keyword_pairs is not None:
        return _cached_valid_names, _cached_keyword_pairs
    try:
        raw = _ACCOUNT_TYPES_PATH.read_text(encoding="utf-8")
        data = json.loads(raw)
        types_list = data.get("account_types") or []
        valid_names = frozenset(t.get("name") for t in types_list if t.get("name"))
        keyword_pairs = [(kw, name) for kw, name in ACCOUNT_TYPE_KEYWORDS_ORDERED if name in valid_names]
        _cached_valid_names = valid_names
        _cached_keyword_pairs = keyword_pairs
        return valid_names, keyword_pairs
    except (OSError, json.JSONDecodeError, KeyError):
        fallback = frozenset({"Chequing", "Savings", "Credit Card", "TFSA", "RRSP", "FHSA", "Mortgage", "Loan"})
        keyword_pairs = [(kw, name) for kw, name in ACCOUNT_TYPE_KEYWORDS_ORDERED if name in fallback]
        return fallback, keyword_pairs


def get_valid_account_type_names() -> frozenset[str]:
    """Return the set of canonical account type names from the reference JSON."""
    valid, _ = _load()
    return valid


def get_account_type_keywords() -> list[tuple[str, str]]:
    """Return (keyword_phrase, canonical_name) pairs in specificity order."""
    _, pairs = _load()
    return pairs


def get_account_type_names_tuple() -> tuple[str, ...]:
    """Return tuple of valid names for DB check / dropdowns (order from JSON)."""
    try:
        raw = _ACCOUNT_TYPES_PATH.read_text(encoding="utf-8")
        data = json.loads(raw)
        types_list = data.get("account_types") or []
        return tuple(t.get("name") for t in types_list if t.get("name"))
    except (OSError, json.JSONDecodeError, KeyError):
        return ("Chequing", "Savings", "TFSA", "RRSP", "FHSA", "Credit Card", "Mortgage", "Loan")


_cached_generates_map: dict[str, bool] | None = None


def get_generates_transactions(account_type_name: str) -> bool:
    """Return True if the account type (by canonical name) has generates_transactions true in account_types.json (PRD)."""
    global _cached_generates_map
    if _cached_generates_map is None:
        try:
            raw = _ACCOUNT_TYPES_PATH.read_text(encoding="utf-8")
            data = json.loads(raw)
            types_list = data.get("account_types") or []
            _cached_generates_map = {
                (t.get("name") or ""): bool(t.get("generates_transactions"))
                for t in types_list if t.get("name")
            }
        except (OSError, json.JSONDecodeError, KeyError):
            _cached_generates_map = {}
    return _cached_generates_map.get(account_type_name, False)
