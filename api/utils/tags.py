import re


def normalize_tags(tags: list[str] | None) -> list[str]:
    """Sanitize, deduplicate, and lowercase a list of tag strings.

    Strips leading '#', lowercases, removes non-word/non-hyphen characters
    (keeps Unicode letters, digits, underscores, and hyphens), enforces a
    64-char max per tag, and preserves insertion order while deduplicating.
    """
    if not tags:
        return []
    seen: set[str] = set()
    result: list[str] = []
    for raw in tags:
        t = re.sub(r"^#+", "", str(raw).strip()).strip().lower()
        t = re.sub(r"[^\w-]", "", t, flags=re.UNICODE)
        if t and len(t) <= 64 and t not in seen:
            seen.add(t)
            result.append(t)
    return result
