"""
Admin config utility — reads runtime configuration from the admin_config Supabase table.

Priority (highest to lowest):
  1. admin_config DB row (if table is available and a row exists)
  2. Environment variable (matching the key uppercased)
  3. api/config.json value
  4. Provided default

Values are cached for TTL_SECONDS to avoid hitting the DB on every request.
The cache is invalidated when admin writes a new value via the PATCH endpoint.
"""
from __future__ import annotations

import json
import os
import time
from pathlib import Path
from typing import Any

_CONFIG_PATH = Path(__file__).resolve().parent.parent / "config.json"

TTL_SECONDS = 60  # cache lifetime

# Keys whose DB values are read during normal API operation via get_admin_config*.
# Update this set when wiring new keys (e.g. gemini_model_pass1 in gemini_model.py).
ADMIN_CONFIG_WIRED_KEYS: frozenset[str] = frozenset({
    "maintenance_mode",
    "max_uploads_per_hour",
    "loonie_ai_enabled",
})

_cache: dict[str, tuple[Any, float]] = {}  # key -> (value, expires_at)


def _read_json_config() -> dict:
    try:
        if _CONFIG_PATH.exists():
            data = json.loads(_CONFIG_PATH.read_text(encoding="utf-8"))
            return data if isinstance(data, dict) else {}
    except Exception:
        pass
    return {}


def _fetch_from_db(key: str) -> Any:
    """Fetch a single config value from the DB. Returns _MISSING sentinel on failure."""
    try:
        from api.supabase_client import supabase  # noqa: PLC0415
        if not supabase:
            return _MISSING
        resp = supabase.table("admin_config").select("value").eq("key", key).maybe_single().execute()
        if resp and resp.data and "value" in resp.data:
            return resp.data["value"]
    except Exception:
        pass
    return _MISSING


class _Missing:
    def __repr__(self) -> str:
        return "<MISSING>"


_MISSING = _Missing()


def get_admin_config(key: str, *, default: Any = None) -> Any:
    """Return config value for *key* with TTL-based DB caching."""
    now = time.monotonic()
    cached_val, expires = _cache.get(key, (_MISSING, 0))
    if not isinstance(cached_val, _Missing) and now < expires:
        return cached_val

    db_val = _fetch_from_db(key)
    if not isinstance(db_val, _Missing):
        _cache[key] = (db_val, now + TTL_SECONDS)
        return db_val

    # Fallback to env (key uppercased)
    env_val = os.environ.get(key.upper())
    if env_val is not None:
        return env_val

    # Fallback to config.json
    cfg = _read_json_config()
    if key in cfg:
        return cfg[key]

    return default


def get_admin_config_bool(key: str, *, default: bool = False) -> bool:
    val = get_admin_config(key, default=default)
    if isinstance(val, bool):
        return val
    if isinstance(val, str):
        return val.strip().lower() in ("1", "true", "yes", "on")
    return bool(val)


def get_admin_config_int(key: str, *, default: int = 0) -> int:
    val = get_admin_config(key, default=default)
    try:
        return int(val)
    except (TypeError, ValueError):
        return default


def get_admin_config_float(key: str, *, default: float = 0.0) -> float:
    val = get_admin_config(key, default=default)
    try:
        return float(val)
    except (TypeError, ValueError):
        return default


def get_admin_config_str(key: str, *, default: str = "") -> str:
    val = get_admin_config(key, default=default)
    if val is None:
        return default
    # jsonb strings come back quoted from Postgres: '"some-model"' — strip them
    if isinstance(val, str):
        s = val.strip()
        if s.startswith('"') and s.endswith('"'):
            return s[1:-1]
        return s
    return str(val)


def invalidate_cache(key: str | None = None) -> None:
    """Invalidate cached value for *key*, or the entire cache if key is None."""
    if key is None:
        _cache.clear()
    else:
        _cache.pop(key, None)


def set_admin_config(key: str, value: Any, admin_id: str) -> dict:
    """Persist a config value to the DB and invalidate the local cache."""
    from api.supabase_client import supabase  # noqa: PLC0415
    if not supabase:
        raise RuntimeError("Database not configured")

    resp = (
        supabase.table("admin_config")
        .upsert({"key": key, "value": value, "updated_at": "now()", "updated_by": admin_id})
        .execute()
    )
    invalidate_cache(key)

    # Log to audit log
    try:
        supabase.table("admin_audit_log").insert({
            "admin_id": admin_id,
            "action": "config_update",
            "target_type": "config",
            "target_id": key,
            "details": {"new_value": value},
        }).execute()
    except Exception:
        pass

    return resp.data[0] if resp.data else {}
