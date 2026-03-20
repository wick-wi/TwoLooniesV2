"""
Gemini model configuration helper.

Supports overriding the model name via:
  - env: GEMINI_MODEL_PASS1
  - api/config.json: { "gemini_model_pass1": "..." }

Normalizes between:
  - google-genai SDK model names: e.g. "gemini-2.5-flash-lite"
  - instructor provider names:   e.g. "google/gemini-2.5-flash-lite"
"""

from __future__ import annotations

import json
import os
from functools import lru_cache
from pathlib import Path

_CONFIG_PATH = Path(__file__).resolve().parent.parent / "config.json"  # api/config.json

_DEFAULT_GENAI_PASS1_MODEL = "gemini-2.5-flash-lite"
_DEFAULT_GENAI_PASS2_MODEL = "gemini-2.5-flash"


def _coerce_model_string(v: object) -> str | None:
    if not isinstance(v, str):
        return None
    s = v.strip().strip("\"'").strip()
    return s or None


@lru_cache(maxsize=1)
def _read_config() -> dict:
    try:
        if not _CONFIG_PATH.exists():
            return {}
        raw = _CONFIG_PATH.read_text(encoding="utf-8")
        data = json.loads(raw)
        return data if isinstance(data, dict) else {}
    except Exception:
        return {}


def get_configured_gemini_model_raw() -> str:
    """
    Return the configured model name as provided by the user (without normalization).

    Expected examples:
      - "gemini-2.5-flash-lite"
      - "google/gemini-2.5-flash-lite"
    """
    # Env override wins (only pass-1 var; you can still set google/ prefixed
    # values and we will normalize them where required).
    v = _coerce_model_string(os.environ.get("GEMINI_MODEL_PASS1"))
    if v:
        return v

    # Fallback to api/config.json.
    cfg = _read_config()
    v = _coerce_model_string(cfg.get("gemini_model_pass1"))
    if v:
        return v

    return _DEFAULT_GENAI_PASS1_MODEL


def get_configured_genai_model() -> str:
    """
    Return the model name for google-genai SDK calls (e.g. "gemini-2.5-flash-lite").
    """
    # Maps the configured "pass 1" model to google-genai SDK model names.
    raw = get_configured_gemini_model_raw()
    return raw[len("google/") :] if raw.startswith("google/") else raw


def get_configured_instructor_model() -> str:
    """
    Return the model name for instructor provider calls (e.g. "google/gemini-2.5-flash-lite").
    """
    raw = get_configured_gemini_model_raw()
    return raw if raw.startswith("google/") else f"google/{raw}"


def get_configured_genai_model_pass2() -> str:
    """
    Return the model name for google-genai SDK calls used as "pass 2".

    Env:
      - GEMINI_MODEL_PASS2 (preferred)
    Config:
      - gemini_model_pass2
    Fallback:
      - pass 1 model (via `get_configured_genai_model()`)
    """
    # Env override wins.
    for key in ("GEMINI_MODEL_PASS2", "GEMINI_MODEL_2", "GEMINI_MODEL_SECOND"):
        v = _coerce_model_string(os.environ.get(key))
        if v:
            return v[len("google/") :] if v.startswith("google/") else v

    # Config fallback.
    cfg = _read_config()
    v = _coerce_model_string(cfg.get("gemini_model_pass2"))
    if v:
        return v[len("google/") :] if v.startswith("google/") else v

    # Final fallback: use pass 1 model.
    return get_configured_genai_model()


def get_configured_instructor_model_pass2() -> str:
    """
    Return the model name for instructor provider calls used in "pass 3".

    In `api/index.py` we currently reuse the "pass 2" model for docling's stronger
    instructor-based extraction, and instructor expects the `google/` prefix.
    """
    genai_model_pass2 = get_configured_genai_model_pass2()
    return genai_model_pass2 if genai_model_pass2.startswith("google/") else f"google/{genai_model_pass2}"

