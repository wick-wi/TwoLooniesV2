"""
CSV statement parser with schema registry caching.
"""

from __future__ import annotations

import csv
import io
import logging
import os
from datetime import datetime
from typing import Any

from .account_types_ref import (
    get_plaid_type,
    get_valid_account_type_names,
    normalize_account_subtype_alias,
)
from .schema import CSVColumnMapping, StatementExtraction, TransactionItem

try:
    from api.supabase_client import supabase
except ImportError:  # pragma: no cover
    from ..supabase_client import supabase  # type: ignore

try:
    from api.utils.gemini_model import get_configured_instructor_model
except ImportError:  # pragma: no cover
    from ..utils.gemini_model import get_configured_instructor_model  # type: ignore


logger = logging.getLogger(__name__)

_DEFAULT_SUBTYPE_BY_TYPE: dict[str, str] = {
    "depository": "Chequing",
    "credit": "Credit Card",
    "investment": "TFSA",
    "loan": "Line of Credit",
}

_ACCOUNT_ID_HEADER_CANDIDATES = (
    "account_id",
    "account number",
    "account_number",
    "account no",
    "account_no",
)
_ACCOUNT_SUBTYPE_HEADER_CANDIDATES = (
    "account_type",
    "account subtype",
    "account_subtype",
    "subtype",
)
_CURRENCY_HEADER_CANDIDATES = (
    "currency",
    "currency code",
    "curr",
    "ccy",
    "iso currency",
    "txn currency",
    "transaction currency",
)


def _decode_csv_bytes(file_content: bytes) -> str:
    for encoding in ("utf-8-sig", "utf-8", "latin-1"):
        try:
            return file_content.decode(encoding)
        except UnicodeDecodeError:
            continue
    return file_content.decode("utf-8", errors="replace")


def _normalize_header(header: str) -> str:
    return (header or "").strip().lower()


def _safe_float(value: Any) -> float:
    if value is None:
        return 0.0
    text = str(value).strip()
    if not text:
        return 0.0
    normalized = text.replace(",", "").replace("$", "").replace("(", "-").replace(")", "")
    return float(normalized)


def _fingerprint_from_headers(headers: list[str]) -> str:
    return "|".join(_normalize_header(h) for h in headers)


def get_csv_header_fingerprint(file_content: bytes) -> str | None:
    """Return normalized header fingerprint for a CSV payload."""
    decoded = _decode_csv_bytes(file_content)
    reader = csv.DictReader(io.StringIO(decoded))
    headers = reader.fieldnames or []
    if not headers:
        return None
    return _fingerprint_from_headers(headers)


def _build_mapping_prompt(headers: list[str], sample_rows: list[dict[str, str]]) -> str:
    valid_subtypes = ", ".join(sorted(get_valid_account_type_names()))
    return (
        "You are mapping a bank statement CSV format to our transaction schema.\n"
        "Return ONLY the CSVColumnMapping structured response.\n\n"
        "Rules:\n"
        "- account_type must be one of: depository, credit, investment, loan.\n"
        f"- account_subtype should be one of these canonical values when possible: {valid_subtypes}.\n"
        "- date_col and description_col must exactly match a provided header.\n"
        "- date_format must be a valid Python datetime.strptime format matching sample values.\n"
        "- amount_logic.mode='signed' when one signed amount column exists.\n"
        "- amount_logic.mode='split' when separate inflow/debit and outflow/credit columns exist.\n"
        "- balance_col is optional and should be null when no running balance exists.\n"
        "- account_subtype_col is optional; set it when a column contains per-row account subtype values.\n"
        "- account_id_col is optional; set only when the file has a per-row account id column whose header is NOT one of: "
        "account_id, account number, account_number, account no, account_no (those are detected without AI). "
        "If present, must exactly match a header.\n"
        "- currency_col is optional; set only when the file has a per-row currency column whose header is NOT one of: "
        "currency, currency code, curr, ccy, iso currency, txn currency, transaction currency. "
        "If present, must exactly match a header.\n"
        "- currency should be ISO code (CAD, USD, etc), default CAD if unclear (used when rows have no currency column).\n\n"
        f"Headers:\n{headers}\n\n"
        f"Sample rows (first up to 3):\n{sample_rows}\n"
    )


def _map_account_subtype(account_type: str, account_subtype: str | None) -> str:
    valid = get_valid_account_type_names()
    if account_subtype and account_subtype in valid:
        return account_subtype
    return _DEFAULT_SUBTYPE_BY_TYPE.get(account_type, "Chequing")


def _find_header_by_candidates(headers: list[str], candidates: tuple[str, ...]) -> str | None:
    normalized_to_original = {_normalize_header(h): h for h in headers}
    for candidate in candidates:
        original = normalized_to_original.get(_normalize_header(candidate))
        if original:
            return original
    return None


def _resolve_account_id_column(headers: list[str], mapping: CSVColumnMapping) -> str | None:
    found = _find_header_by_candidates(headers, _ACCOUNT_ID_HEADER_CANDIDATES)
    if found:
        return found
    if mapping.account_id_col and mapping.account_id_col in headers:
        return mapping.account_id_col
    return None


def _resolve_currency_column(headers: list[str], mapping: CSVColumnMapping) -> str | None:
    found = _find_header_by_candidates(headers, _CURRENCY_HEADER_CANDIDATES)
    if found:
        return found
    if mapping.currency_col and mapping.currency_col in headers:
        return mapping.currency_col
    return None


def _normalize_currency_code(raw: Any, default: str) -> str:
    if raw is None:
        return default
    text = str(raw).strip().upper()
    if not text:
        return default
    if len(text) >= 3 and text[:3].isalpha():
        return text[:3]
    return default


def _first_non_empty_column_value(rows: list[dict[str, str]], column_name: str | None) -> str | None:
    if not column_name:
        return None
    for row in rows:
        value = (row.get(column_name) or "").strip()
        if value:
            return value
    return None


def _resolve_subtype_from_text(value: str | None) -> str | None:
    return normalize_account_subtype_alias(value)


def _infer_group_subtype(group_rows: list[dict[str, str]], subtype_column: str | None) -> str | None:
    if not subtype_column:
        return None
    counts: dict[str, int] = {}
    for row in group_rows:
        candidate = _resolve_subtype_from_text((row.get(subtype_column) or "").strip())
        if candidate:
            counts[candidate] = counts.get(candidate, 0) + 1
    if not counts:
        return None
    return max(counts.items(), key=lambda kv: kv[1])[0]


def _load_mapping_from_registry(header_fingerprint: str) -> CSVColumnMapping | None:
    if not supabase:
        return None
    try:
        resp = (
            supabase.table("csv_mapping_registry")
            .select("mapping_schema")
            .eq("header_fingerprint", header_fingerprint)
            .limit(1)
            .execute()
        )
    except Exception as e:
        logger.warning("csv_mapping_registry lookup failed: %s", e)
        return None
    rows = getattr(resp, "data", None) or []
    if not rows:
        return None
    try:
        supabase.table("csv_mapping_registry").update({"last_used_at": datetime.utcnow().isoformat()}).eq(
            "header_fingerprint", header_fingerprint
        ).execute()
    except Exception:
        pass
    schema_payload = rows[0].get("mapping_schema")
    if not isinstance(schema_payload, dict):
        return None
    try:
        return CSVColumnMapping.model_validate(schema_payload)
    except Exception as e:
        logger.warning("Invalid cached csv mapping schema: %s", e)
        return None


def _save_mapping_to_registry(header_fingerprint: str, mapping: CSVColumnMapping) -> None:
    if not supabase:
        return
    try:
        supabase.table("csv_mapping_registry").upsert(
            {
                "header_fingerprint": header_fingerprint,
                "provider_guess": mapping.provider,
                "account_type_guess": mapping.account_type,
                "account_subtype_guess": mapping.account_subtype,
                "mapping_schema": mapping.model_dump(),
            },
            on_conflict="header_fingerprint",
        ).execute()
    except Exception as e:
        logger.warning("csv_mapping_registry upsert failed: %s", e)


def _get_gemini_api_key(api_key: str | None = None) -> str:
    key = api_key or os.environ.get("GOOGLE_API_KEY") or os.environ.get("GEMINI_API_KEY")
    if not key:
        raise RuntimeError("GOOGLE_API_KEY or GEMINI_API_KEY is required for CSV mapping")
    return key


def _infer_mapping_with_gemini(
    headers: list[str],
    sample_rows: list[dict[str, str]],
    *,
    api_key: str | None = None,
) -> CSVColumnMapping:
    import instructor

    key = _get_gemini_api_key(api_key)
    client = instructor.from_provider(get_configured_instructor_model(), api_key=key)
    prompt = _build_mapping_prompt(headers, sample_rows)
    return client.create(
        messages=[{"role": "user", "content": prompt}],
        response_model=CSVColumnMapping,
    )


def _compute_signed_amount(row: dict[str, str], mapping: CSVColumnMapping) -> float:
    logic = mapping.amount_logic
    if logic.mode == "signed":
        if not logic.column:
            raise ValueError("CSV mapping mode='signed' requires amount_logic.column")
        return _safe_float(row.get(logic.column))
    if not logic.inflow_col or not logic.outflow_col:
        raise ValueError("CSV mapping mode='split' requires inflow_col and outflow_col")
    inflow = _safe_float(row.get(logic.inflow_col))
    outflow = _safe_float(row.get(logic.outflow_col))
    return inflow - outflow


def _build_extraction(
    rows: list[dict[str, str]],
    headers: list[str],
    mapping: CSVColumnMapping,
    account_id_value: str | None = None,
) -> StatementExtraction:
    transactions: list[TransactionItem] = []
    default_ccy = (mapping.currency or "CAD").upper()
    currency_col = _resolve_currency_column(headers, mapping)

    for row in rows:
        raw_date = (row.get(mapping.date_col) or "").strip()
        if not raw_date:
            continue
        try:
            parsed_date = datetime.strptime(raw_date, mapping.date_format).date().isoformat()
        except Exception:
            continue
        amount = _compute_signed_amount(row, mapping)
        description = (row.get(mapping.description_col) or "").strip()
        running_balance = None
        if mapping.balance_col:
            try:
                running_balance = _safe_float(row.get(mapping.balance_col))
            except Exception:
                running_balance = None
        row_ccy = (
            _normalize_currency_code(row.get(currency_col), default_ccy) if currency_col else default_ccy
        )
        transactions.append(
            TransactionItem(
                date=parsed_date,
                description=description,
                amount=amount,
                running_balance=running_balance,
                category="Uncategorized",
                confidence_score=0.0,
                currency=row_ccy,
            )
        )

    if mapping.account_type == "credit":
        for txn in transactions:
            txn.amount = -abs(float(txn.amount))

    dates = [t.date for t in transactions]
    start_date = min(dates) if dates else None
    end_date = max(dates) if dates else None
    opening_balance = None
    closing_balance = None

    if mapping.balance_col and transactions:
        first_row_balance = transactions[0].running_balance
        last_row_balance = transactions[-1].running_balance
        if first_row_balance is not None:
            opening_balance = round(float(first_row_balance) - float(transactions[0].amount), 2)
        if last_row_balance is not None:
            closing_balance = round(float(last_row_balance), 2)

    subtype = _map_account_subtype(mapping.account_type, mapping.account_subtype)
    if account_id_value is None:
        account_id_column = _resolve_account_id_column(headers, mapping)
        account_id_value = _first_non_empty_column_value(rows, account_id_column)
    txn_ccys = {t.currency for t in transactions}
    statement_currency = txn_ccys.pop() if len(txn_ccys) == 1 else default_ccy
    return StatementExtraction(
        provider=mapping.provider or "Unknown",
        account_id=account_id_value,
        opening_balance=opening_balance,
        closing_balance=closing_balance,
        currency=statement_currency,
        start_date=start_date,
        end_date=end_date,
        account_type=subtype,
        transactions=transactions,
        holdings=[],
    )


def parse_csv_review(
    file_content: bytes,
    filename: str,
    *,
    api_key: str | None = None,
) -> dict[str, Any]:
    decoded = _decode_csv_bytes(file_content)
    reader = csv.DictReader(io.StringIO(decoded))
    headers = reader.fieldnames or []
    if not headers:
        raise RuntimeError(f"CSV '{filename}' has no header row")
    rows = list(reader)
    if not rows:
        raise RuntimeError(f"CSV '{filename}' has no data rows")

    fingerprint = _fingerprint_from_headers(headers)
    mapping = _load_mapping_from_registry(fingerprint)
    if mapping is None:
        sample_rows = rows[:3]
        mapping = _infer_mapping_with_gemini(headers, sample_rows, api_key=api_key)
        _save_mapping_to_registry(fingerprint, mapping)

    account_id_column = _resolve_account_id_column(headers, mapping)
    subtype_column = mapping.account_subtype_col or _find_header_by_candidates(headers, _ACCOUNT_SUBTYPE_HEADER_CANDIDATES)
    grouped_rows: dict[str, list[dict[str, str]]] = {}
    for row in rows:
        key = (row.get(account_id_column) or "").strip() if account_id_column else ""
        key = key or "UnknownAccount-1"
        grouped_rows.setdefault(key, []).append(row)

    groups: list[dict[str, Any]] = []
    for group_key, group_rows in grouped_rows.items():
        group_subtype = _infer_group_subtype(group_rows, subtype_column)
        group_mapping = mapping.model_copy(
            update={
                "account_subtype": group_subtype or mapping.account_subtype,
                "account_type": get_plaid_type(group_subtype) or mapping.account_type if group_subtype else mapping.account_type,
            }
        )
        extraction = _build_extraction(group_rows, headers, group_mapping, account_id_value=group_key)
        extraction_dump = extraction.model_dump()
        group_transactions = extraction_dump.get("transactions", [])
        if not group_transactions:
            # Ignore synthetic groups produced by blank/footer rows with no parseable transactions.
            continue
        groups.append(
            {
                "group_key": group_key,
                "provider_guess": mapping.provider,
                "account_type_guess": group_mapping.account_type,
                "account_subtype_guess": extraction.account_type,
                "account_number_guess": "" if group_key.startswith("UnknownAccount-") else group_key,
                "currency_guess": extraction.currency or (mapping.currency or "CAD"),
                "start_date": extraction.start_date,
                "end_date": extraction.end_date,
                "opening_balance": extraction.opening_balance,
                "closing_balance": extraction.closing_balance,
                "transactions": group_transactions,
                "holdings": extraction_dump.get("holdings", []),
            }
        )

    return {
        "header_fingerprint": fingerprint,
        "mapping_schema": mapping.model_dump(),
        "groups": groups,
    }


async def parse_csv(
    file_content: bytes,
    filename: str,
    *,
    api_key: str | None = None,
) -> StatementExtraction:
    """
    Parse CSV bytes into the canonical StatementExtraction format.
    """
    review = parse_csv_review(file_content, filename, api_key=api_key)
    groups = review.get("groups") or []
    if not groups:
        raise RuntimeError(f"CSV '{filename}' produced no account groups")
    all_txn_dicts: list[dict[str, Any]] = []
    for group in groups:
        all_txn_dicts.extend(group.get("transactions") or [])
    first = groups[0]
    return StatementExtraction(
        provider=first.get("provider_guess") or "Unknown",
        account_id=first.get("account_number_guess") or None,
        opening_balance=None,
        closing_balance=None,
        currency=first.get("currency_guess") or "CAD",
        start_date=min((t.get("date") for t in all_txn_dicts if t.get("date")), default=None),
        end_date=max((t.get("date") for t in all_txn_dicts if t.get("date")), default=None),
        account_type=first.get("account_subtype_guess") or "Chequing",
        transactions=[TransactionItem.model_validate(t) for t in all_txn_dicts],
        holdings=[],
    )

