import json
from pathlib import Path
from typing import Any


_RULES_PATH = Path(__file__).resolve().parent.parent / "data" / "llm_priority_rules.json"

_rules_cache: dict[str, Any] | None = None


def _load_rules() -> dict[str, Any]:
    """
    Load priority rules from llm_priority_rules.json.

    Safe failure: returns empty rules on missing file or parse errors.
    """
    global _rules_cache
    if _rules_cache is not None:
        return _rules_cache
    try:
        raw = _RULES_PATH.read_text(encoding="utf-8")
        data = json.loads(raw)
        if not isinstance(data, dict):
            data = {}
        _rules_cache = data
        return data
    except Exception:
        _rules_cache = {}
        return _rules_cache


def get_prompt_rules_text() -> str:
    """
    Return a compact prompt section containing configured priority rules.

    Returns an empty string if no prompt_rules are configured.
    """
    data = _load_rules()
    rules = data.get("prompt_rules") if isinstance(data, dict) else None
    if not isinstance(rules, list):
        return ""
    items = [str(r).strip() for r in rules if str(r).strip()]
    if not items:
        return ""
    lines = ["Category priority rules (apply these before any generic heuristics):"]
    lines.extend([f"- {r}" for r in items])
    return "\n".join(lines)


def override_category_from_description(description: str) -> str | None:
    """
    Apply deterministic override rules from llm_priority_rules.json.

    Matching is case-insensitive substring matching against `match_any` entries.
    Returns the configured category display name (e.g. \"E-Transfer\") or None.
    """
    if not description or not isinstance(description, str):
        return None

    data = _load_rules()
    rules = data.get("override_rules") if isinstance(data, dict) else None
    if not isinstance(rules, list) or not rules:
        return None

    haystack = description.upper()
    for rule in rules:
        if not isinstance(rule, dict):
            continue
        category = (rule.get("category") or "").strip()
        match_any = rule.get("match_any")
        if not category or not isinstance(match_any, list) or not match_any:
            continue
        for needle in match_any:
            n = str(needle).strip().upper()
            if n and n in haystack:
                return category
    return None

