"""
Parser registry: select which statement parser runs.

Default parser: .env STATEMENT_PARSER. Allowed values: "docling", "gemini_native", "pdfplumber".
If unset or invalid, falls back to "pdfplumber".

For subscription gating: pass parser_override per request (e.g. from user tier).
Parsers are loaded lazily so removing a parser file only fails when that
parser is selected.
"""

import logging
import os
from pathlib import Path
from typing import Any

_log = logging.getLogger(__name__)

# Supported parser names (must match the dispatch below)
PARSER_NAMES = ("docling", "gemini_native", "pdfplumber", "pdfplumber_v2")
DEFAULT_PARSER = "pdfplumber"


def _load_default_parser_name() -> str:
    """Default parser from .env STATEMENT_PARSER, else DEFAULT_PARSER."""
    env = os.environ.get("STATEMENT_PARSER", "").strip().lower()
    if env and env in PARSER_NAMES:
        return env
    return DEFAULT_PARSER


def get_configured_parser_name() -> str:
    """Return the default parser name (e.g. 'pdfplumber')."""
    return _load_default_parser_name()


def parse_statement_pdf(
    pdf_path: Path,
    *,
    api_key: str | None = None,
    parser_override: str | None = None,
    **kwargs: Any,
) -> Any:
    """
    Parse a statement PDF using the chosen parser.

    Parser selection:
      - If parser_override is set and valid, use it (for subscription/tier gating).
      - Otherwise use default from .env STATEMENT_PARSER.

    Returns a StatementExtraction (Pydantic model).
    """
    name = (parser_override or "").strip().lower() if parser_override else ""
    if name not in PARSER_NAMES:
        name = _load_default_parser_name()
    raw_env = os.environ.get("STATEMENT_PARSER", "")
    _log.info(
        "Statement parser: using=%s (STATEMENT_PARSER=%r, parser_override=%r)",
        name, raw_env, parser_override,
    )
    if name == "docling":
        from .docling_statement import extract_statement_fields
        result_dict, _ = extract_statement_fields(pdf_path, **kwargs)
        from .schema import StatementExtraction
        return StatementExtraction.model_validate(result_dict)
    if name == "gemini_native":
        from .gemini_native_parser import parse_statement_pdf_native
        return parse_statement_pdf_native(pdf_path, api_key=api_key, **kwargs)
    if name == "pdfplumber":
        from .pdfplumber_parser import parse_statement_pdfplumber
        return parse_statement_pdfplumber(pdf_path, api_key=api_key, **kwargs)
    if name == "pdfplumber_v2":
        from .pdfplumberV2_parser import parse_statement_pdfplumber_v2
        return parse_statement_pdfplumber_v2(pdf_path, api_key=api_key, **kwargs)
    raise ValueError(f"Unknown statement_parser: {name}. Allowed: {list(PARSER_NAMES)}")
