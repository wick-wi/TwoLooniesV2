"""
Transaction categorization using categories.json.
Uses longest-match-first rule for keyword matching.
"""
import json
import re
from pathlib import Path

_CATEGORIES_PATH = Path(__file__).resolve().parent.parent / "data" / "categories.json"

# Bank noise patterns to strip (common PDF extraction artifacts)
_BANK_NOISE = re.compile(
    r"\b(?:20\s*20|INC\.?|CORP\.?|LLC\.?)\b",
    re.IGNORECASE,
)

# Date patterns: JAN 31, 31 JAN 2025, 2025-01-31, etc.
_DATE_PATTERNS = [
    re.compile(r"\b(?:JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)[A-Z]*\.?\s+\d{1,2}(?:\s+\d{2,4})?\b", re.I),
    re.compile(r"\b\d{1,2}\s+(?:JAN|FEB|MAR|APR|MAY|JUN|JUL|AUG|SEP|OCT|NOV|DEC)[A-Z]*\.?\s+\d{2,4}\b", re.I),
    re.compile(r"\b\d{4}[-/]\d{1,2}[-/]\d{1,2}\b"),
    re.compile(r"\b\d{1,2}[-/]\d{1,2}[-/]\d{2,4}\b"),
    re.compile(r"^\d{1,4}\s+\d{1,2}(\s+\d{1,2})?\s+"),  # leading "2020 03 31" etc.
]

_UNCATEGORIZED = {
    "category_id": "uncategorized",
    "tier1": "Uncategorized",
    "is_fixed_cost": False,
}

_keyword_cache = None
_forced_keyword_cache = None
_categories_data_cache: list[dict] | None = None


def _load_categories_data() -> list[dict]:
    """Load raw categories list from categories.json. Returns [] on missing file or parse error."""
    global _categories_data_cache
    if _categories_data_cache is not None:
        return _categories_data_cache
    try:
        with open(_CATEGORIES_PATH, encoding="utf-8") as f:
            data = json.load(f)
        _categories_data_cache = data.get("categories", [])
        return _categories_data_cache
    except (OSError, json.JSONDecodeError, KeyError):
        return []


def _load_keywords() -> list[tuple[str, dict]]:
    """Load (keyword, category_obj) pairs sorted by keyword length descending."""
    global _keyword_cache
    if _keyword_cache is not None:
        return _keyword_cache
    pairs = []
    for cat in _load_categories_data():
        for kw in cat.get("keywords", []):
            kw_upper = kw.strip().upper()
            if kw_upper:
                pairs.append((kw_upper, cat))
    pairs.sort(key=lambda x: len(x[0]), reverse=True)
    _keyword_cache = pairs
    return pairs


def _load_forced_keywords() -> list[tuple[str, dict]]:
    """
    Load (keyword, category_obj) pairs for categories that opt into hard overrides
    via `force_if_keywords_present` in categories.json.
    """
    global _forced_keyword_cache
    if _forced_keyword_cache is not None:
        return _forced_keyword_cache
    pairs = []
    for cat in _load_categories_data():
        if not cat.get("force_if_keywords_present"):
            continue
        for kw in cat.get("keywords", []):
            kw_upper = kw.strip().upper()
            if kw_upper:
                pairs.append((kw_upper, cat))
    pairs.sort(key=lambda x: len(x[0]), reverse=True)
    _forced_keyword_cache = pairs
    return pairs


def get_category_names() -> list[str]:
    """Return sorted list of category display names from categories.json (for LLM prompts)."""
    names = [c.get("name") for c in _load_categories_data() if c.get("name")]
    return sorted(names)


def get_category_by_name(name: str) -> dict | None:
    """
    Look up category by display name. Returns same shape as categorize_transaction(), or None if not found.
    Matching is case-insensitive after stripping whitespace.
    """
    if not name or not str(name).strip():
        return None
    key = str(name).strip().lower()
    for cat in _load_categories_data():
        if (cat.get("name") or "").strip().lower() == key:
            return {
                "category_id": cat["id"],
                "tier1": cat["tier1"],
                "is_fixed_cost": cat.get("tier1") == "Fixed",
                "category_name": cat.get("name", cat["id"]),
            }
    return None


def _normalize_description(desc: str) -> str:
    """Uppercase, remove dates, strip bank noise."""
    if not desc:
        return "UNKNOWN"
    s = str(desc).strip().upper()
    if not s:
        return "UNKNOWN"
    # Remove date patterns
    for pat in _DATE_PATTERNS:
        s = pat.sub(" ", s)
    # Strip bank noise
    s = _BANK_NOISE.sub(" ", s)
    # Collapse whitespace
    s = re.sub(r"\s+", " ", s).strip()
    return s or "UNKNOWN"


def categorize_transaction(description: str) -> dict:
    """
    Categorize a transaction by its description.

    Args:
        description: Raw transaction description from bank/parser.

    Returns:
        dict with:
            - category_id: e.g. "food_grocery"
            - tier1: e.g. "Variable"
            - is_fixed_cost: True if tier1 == "Fixed"
    """
    normalized = _normalize_description(description)
    keywords = _load_keywords()
    for kw, cat in keywords:
        if kw in normalized:
            return {
                "category_id": cat["id"],
                "tier1": cat["tier1"],
                "is_fixed_cost": cat.get("tier1") == "Fixed",
                "category_name": cat.get("name", cat["id"]),
            }
    return {
        **_UNCATEGORIZED,
        "category_name": "Uncategorized",
    }


def forced_category_from_description(description: str) -> dict | None:
    """
    Return a forced category when high-signal keywords are present.

    This is intended for \"rail\" classifications (e.g. Interac e-Transfers) where
    we want deterministic behavior even if an LLM labels it differently.
    """
    normalized = _normalize_description(description)
    for kw, cat in _load_forced_keywords():
        if kw in normalized:
            return {
                "category_id": cat["id"],
                "tier1": cat["tier1"],
                "is_fixed_cost": cat.get("tier1") == "Fixed",
                "category_name": cat.get("name", cat["id"]),
            }
    return None
