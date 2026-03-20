import json
import logging
import os
import re
import tempfile
import uuid
from collections import defaultdict
from datetime import date, datetime, timedelta
from pathlib import Path

_ROOT = Path(__file__).resolve().parent.parent

# Log to console; skip file logging on Vercel (read-only filesystem)
IS_VERCEL = os.environ.get("VERCEL") == "1"
if not IS_VERCEL:
    LOG_DIR = _ROOT / "logs"
    LOG_DIR.mkdir(exist_ok=True)
    LOG_FILE = LOG_DIR / "statement_uploads.log"

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
if not IS_VERCEL:
    file_handler = logging.FileHandler(LOG_FILE, encoding="utf-8")
    file_handler.setLevel(logging.INFO)
    file_handler.setFormatter(logging.Formatter("%(asctime)s [%(levelname)s] %(name)s: %(message)s", datefmt="%Y-%m-%d %H:%M:%S"))
    logging.getLogger().addHandler(file_handler)
logger = logging.getLogger(__name__)
file_logger = logging.getLogger("statement_upload_file")
if IS_VERCEL:
    file_logger.addHandler(logging.StreamHandler())
else:
    file_logger.addHandler(file_handler)
file_logger.setLevel(logging.INFO)
file_logger.propagate = False

from fastapi import FastAPI, Body, File, UploadFile, Header, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from dotenv import load_dotenv

env_path = _ROOT / ".env"
env_local = _ROOT / ".env.local"
# Load project .env then .env.local (override=True so project files win over shell env)
load_dotenv(dotenv_path=str(env_path), override=True)
if env_local.exists():
    load_dotenv(dotenv_path=str(env_local), override=True)

# Prefer STATEMENT_PARSER from .env.local on disk (override any shell/dotenv quirk)
_env_local_parser = None
if env_local.exists():
    with open(env_local) as f:
        for line in f:
            line = line.strip()
            if line.startswith("STATEMENT_PARSER="):
                _env_local_parser = line.split("=", 1)[1].strip().strip('"\'')
                break
if _env_local_parser is not None and _env_local_parser.lower() in ("docling", "gemini_native", "pdfplumber"):
    os.environ["STATEMENT_PARSER"] = _env_local_parser

# Prefer GEMINI_MODEL_PASS2 from .env.local on disk (override any shell/dotenv quirk)
_env_local_gemini_model_pass1 = None
_env_local_gemini_model_pass2 = None
if env_local.exists():
    with open(env_local) as f:
        for line in f:
            line = line.strip()
            if line.startswith("GEMINI_MODEL_PASS1="):
                _env_local_gemini_model_pass1 = line.split("=", 1)[1].strip().strip('"\'')
                break
            if line.startswith("GEMINI_MODEL_PASS2="):
                _env_local_gemini_model_pass2 = line.split("=", 1)[1].strip().strip('"\'')
                break
if _env_local_gemini_model_pass1:
    os.environ["GEMINI_MODEL_PASS1"] = _env_local_gemini_model_pass1
if _env_local_gemini_model_pass2:
    os.environ["GEMINI_MODEL_PASS2"] = _env_local_gemini_model_pass2

print(f"STATEMENT_PARSER in use (at startup): {os.environ.get('STATEMENT_PARSER', '(unset)')!r}")
print(f"GEMINI_MODEL_PASS1 from .env.local file: {_env_local_gemini_model_pass1!r}")
print(f"GEMINI_MODEL_PASS2 in use (at startup): {os.environ.get('GEMINI_MODEL_PASS2', '(unset)')!r}")

import plaid
from plaid.api import plaid_api
from plaid.model.link_token_create_request import LinkTokenCreateRequest
from plaid.model.link_token_create_request_user import LinkTokenCreateRequestUser
from plaid.model.item_public_token_exchange_request import ItemPublicTokenExchangeRequest
from plaid.model.products import Products
from plaid.model.country_code import CountryCode
from plaid.model.transactions_get_request import TransactionsGetRequest

import jwt

from .analysis import analyze_transactions
from .docling_client import pdf_to_markdown
from .parsers import get_configured_parser_name, parse_statement_pdf
from .parsers.docling_statement import extract_statement_with_llm
from .parsers.gemini_native_parser import parse_statement_pdf_native
from .parsers.pdfplumber_parser import (
    extract_statement_from_structured_text,
    parse_statement_pdfplumber,
    pdf_to_structured_text,
)
from .parsers.account_types_ref import get_valid_account_type_names, get_generates_transactions, get_plaid_type
from .utils.categorization import categorize_transaction, forced_category_from_description, get_category_by_name
from .utils.priority_rules import override_category_from_description
from .utils.tags import normalize_tags
try:
    from .supabase_client import supabase
except ImportError:
    supabase = None

load_dotenv()

app = FastAPI()

# CORS: localhost for dev, Vercel for deployed frontend (same-origin when both on Vercel)
_cors_origins = ["http://localhost:3000", "http://127.0.0.1:3000"]
for env_var in ("VERCEL_URL", "VERCEL_BRANCH_URL"):
    if url := os.environ.get(env_var):
        _cors_origins.append(f"https://{url}")
app.add_middleware(
    CORSMiddleware,
    allow_origins=_cors_origins,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Configuration for Plaid
PLAID_CLIENT_ID = os.getenv('PLAID_CLIENT_ID')
PLAID_SECRET = os.getenv('PLAID_SECRET')

# This will stop the code and tell you EXACTLY if the keys are missing
if not PLAID_CLIENT_ID or not PLAID_SECRET:
    print("❌ ERROR: Plaid keys not found in .env file!")
    print(f"DEBUG -> Client ID: {PLAID_CLIENT_ID}")
    print(f"DEBUG -> Secret: {PLAID_SECRET}")
else:
    print("✅ Plaid keys loaded successfully.")

configuration = plaid.Configuration(
    host=plaid.Environment.Sandbox,
    api_key={
        'clientId': PLAID_CLIENT_ID,
        'secret': PLAID_SECRET,
        'plaidVersion': '2020-09-14'
    }
)
api_client = plaid.ApiClient(configuration)
client = plaid_api.PlaidApi(api_client)


@app.post("/api/create_link_token")
async def create_link_token():
    try:
        request = LinkTokenCreateRequest(
            products=[Products('transactions')],
            country_codes=[CountryCode('CA')],  # Specifically for Canada
            language='en',
            user=LinkTokenCreateRequestUser(client_user_id='unique-user-id-123'),
            client_name="Canada Wealth Dashboard"
        )
        response = client.link_token_create(request)
        return response.to_dict()
    except plaid.ApiException as e:
        logger.error(f"Plaid link token error: {e}")
        detail = str(e.body) if getattr(e, 'body', None) else str(e)
        raise HTTPException(status_code=502, detail=detail)
    except Exception as e:
        logger.error(f"Link token error: {e}")
        raise HTTPException(status_code=500, detail="Failed to create bank link. Ensure the backend is configured with valid Plaid credentials.")


@app.post("/api/exchange_public_token")
async def exchange_public_token(payload: dict = Body(...)):
    public_token = payload.get("public_token")
    if not public_token:
        return {"error": "No public token provided"}

    try:
        exchange_request = ItemPublicTokenExchangeRequest(
            public_token=public_token
        )
        exchange_response = client.item_public_token_exchange(exchange_request)
        access_token = exchange_response['access_token']
        item_id = exchange_response['item_id']
        print(f"✅ Success! Access Token: {access_token}")
        return {"status": "success", "item_id": item_id, "access_token": access_token}
    except plaid.ApiException as e:
        print(f"❌ Plaid Error: {e}")
        return {"error": str(e)}


MAX_STATEMENTS = 12
MAX_STATEMENT_FILE_SIZE_BYTES = 1 * 1024 * 1024  # 1MB per file

_CC_OUTFLOW_TYPES = frozenset({"purchase", "fee", "interest", "cash_advance"})
_CC_INFLOW_TYPES = frozenset({"payment", "credit", "refund"})

_CC_PAYMENT_KEYWORDS = frozenset({
    "payment", "royal bank", "td bank", "cibc", "bmo", "scotiabank",
    "national bank", "desjardins", "tangerine", "simplii",
})
_CC_CREDIT_KEYWORDS = frozenset({
    "credit voucher", "refund", "reversal", "cashback", "rebate",
})


def _infer_cc_transaction_type(description: str, llm_type: str) -> str:
    """Use keywords to override LLM transaction_type when description is unambiguous."""
    lower = (description or "").lower()
    if any(kw in lower for kw in _CC_CREDIT_KEYWORDS):
        return "credit"
    if any(kw in lower for kw in _CC_PAYMENT_KEYWORDS):
        return "payment"
    return llm_type


_BALANCE_DESCRIPTION_TOKENS = frozenset({
    "openingbalance", "closingbalance", "previousbalance", "newbalance",
    "opening balance", "closing balance", "previous balance", "new balance",
})


def _is_balance_line(description: str | None) -> bool:
    """Return True if the description looks like a balance summary, not a real transaction."""
    if not description:
        return False
    normed = description.strip().lower().replace("_", " ")
    if normed in _BALANCE_DESCRIPTION_TOKENS:
        return True
    no_spaces = normed.replace(" ", "")
    return no_spaces in _BALANCE_DESCRIPTION_TOKENS


def _strip_balance_lines(transactions: list[dict]) -> list[dict]:
    """Remove synthetic opening/closing balance entries the LLM sometimes produces."""
    return [t for t in transactions if not _is_balance_line(t.get("description"))]


def _normalize_credit_card_signs(transactions: list[dict]) -> None:
    """Deterministic sign assignment for credit-card transactions.

    Uses transaction_type (from LLM) with keyword-based override to decide
    direction, then forces amount to the correct sign:
      outflow (purchase/fee/interest/cash_advance) → negative
      inflow  (payment/credit/refund)              → positive
    """
    for t in transactions:
        raw = abs(float(t.get("amount", 0)))
        llm_type = (t.get("transaction_type") or "purchase").strip().lower()
        txn_type = _infer_cc_transaction_type(t.get("description", ""), llm_type)
        if txn_type in _CC_INFLOW_TYPES:
            t["amount"] = round(raw, 2)
        else:
            t["amount"] = round(-raw, 2)


_MAX_GROUP_SIZE_FOR_SIGN_FIX = 15


def _solve_sign_assignment(abs_values: list[float], expected_delta: float) -> list[int] | None:
    """Find sign assignment (+1/-1) for each absolute value so the signed sum equals expected_delta.

    Returns list of signs [+1 or -1] if a unique solution exists, else None.
    Uses subset-sum: sum_of_negatives = (sum_abs - expected_delta) / 2, then
    brute-forces which subset should be negative (feasible for n <= 15).
    """
    n = len(abs_values)
    total_abs = sum(abs_values)
    target_neg = (total_abs - expected_delta) / 2.0

    if target_neg < -0.02:
        return None

    solutions: list[int] = []
    for mask in range(1 << n):
        subset_sum = sum(abs_values[i] for i in range(n) if mask & (1 << i))
        if abs(subset_sum - target_neg) < 0.02:
            solutions.append(mask)
            if len(solutions) > 1:
                return None

    if len(solutions) != 1:
        return None

    mask = solutions[0]
    return [-1 if mask & (1 << i) else 1 for i in range(n)]


def _validate_signs_from_running_balance(
    transactions: list[dict],
    opening_balance: float | None,
    filename: str = "",
) -> tuple[int, bool, int, int]:
    """Use running_balance to detect and fix sign errors.

    Two-pass approach:
      Pass 1 – Group-level: collect segments of transactions between known
               balances, then use subset-sum to find the correct sign
               assignment for the entire group.
      Pass 2 – Verification: re-walk the chain and report any remaining
               mismatches.

    Returns:
      - corrections: total count of sign corrections applied
      - validation_ok: True when validation passes (or no checkable running balances exist)
      - mismatch_count: number of remaining running-balance mismatches
      - validated_count: number of transactions with non-null running_balance
    """
    corrections = 0
    corrected_details: list[str] = []

    # --- Pass 1: group-level sign correction ---
    groups: list[tuple[float, list[dict], float]] = []
    prev_balance = opening_balance
    current_group: list[dict] = []

    for t in transactions:
        current_group.append(t)
        rb = t.get("running_balance")
        if rb is not None:
            if prev_balance is not None:
                groups.append((prev_balance, current_group, rb))
            prev_balance = rb
            current_group = []

    for group_prev, group_txns, group_rb in groups:
        expected_delta = round(group_rb - group_prev, 2)
        current_sum = round(sum(float(t.get("amount", 0)) for t in group_txns), 2)

        if abs(current_sum - expected_delta) < 0.02:
            continue

        if len(group_txns) == 1:
            t = group_txns[0]
            amount = float(t.get("amount", 0))
            if abs(amount) > 0.001 and abs(abs(amount) - abs(expected_delta)) < 0.02:
                if (amount > 0) != (expected_delta > 0):
                    old_amount = amount
                    t["amount"] = round(expected_delta, 2)
                    corrections += 1
                    corrected_details.append(
                        f"  {t.get('date')} {t.get('description', '')[:40]}: "
                        f"{old_amount:+.2f} -> {t['amount']:+.2f} "
                        f"(balance {group_prev:.2f} -> {group_rb:.2f})"
                    )
            continue

        if len(group_txns) > _MAX_GROUP_SIZE_FOR_SIGN_FIX:
            logger.warning(
                "Skipping group sign-fix for %s: group of %d transactions too large (max %d)",
                filename, len(group_txns), _MAX_GROUP_SIZE_FOR_SIGN_FIX,
            )
            continue

        abs_values = [abs(float(t.get("amount", 0))) for t in group_txns]
        signs = _solve_sign_assignment(abs_values, expected_delta)
        if signs is None:
            continue

        for i, t in enumerate(group_txns):
            old_amount = float(t.get("amount", 0))
            new_amount = round(signs[i] * abs_values[i], 2)
            if abs(old_amount - new_amount) > 0.001:
                t["amount"] = new_amount
                corrections += 1
                corrected_details.append(
                    f"  {t.get('date')} {t.get('description', '')[:40]}: "
                    f"{old_amount:+.2f} -> {new_amount:+.2f} "
                    f"(group balance {group_prev:.2f} -> {group_rb:.2f})"
                )

    if corrected_details:
        logger.info(
            "Running balance sign corrections for %s (%d fixed):\n%s",
            filename, corrections, "\n".join(corrected_details),
        )

    # --- Pass 2: verification walk ---
    prev_balance = opening_balance
    mismatches: list[str] = []
    for t in transactions:
        rb = t.get("running_balance")
        if prev_balance is None:
            # If we don't have an anchor yet, only advance when the model provides rb.
            if rb is not None:
                prev_balance = rb
            continue

        amount = float(t.get("amount", 0))
        expected_rb = round(prev_balance + amount, 2)

        if rb is not None:
            # Compare only when the model claims a running_balance, but always keep the chain moving.
            if abs(expected_rb - rb) > 0.02:
                mismatches.append(
                    f"  {t.get('date')} {t.get('description', '')[:40]}: "
                    f"expected balance {expected_rb:.2f}, got {rb:.2f} "
                    f"(prev={prev_balance:.2f}, amount={amount:+.2f})"
                )
            prev_balance = rb  # anchor to the model-provided running balance
        else:
            # rb=None means we can't verify this step, but it still affects subsequent balances.
            prev_balance = expected_rb

    validated_count = sum(1 for t in transactions if t.get("running_balance") is not None)
    mismatch_count = len(mismatches)
    validation_ok = mismatch_count == 0 or validated_count == 0

    if mismatch_count:
        logger.warning(
            "Running balance validation: %d mismatch(es) remain after corrections for %s:\n%s",
            mismatch_count, filename, "\n".join(mismatches),
        )
    else:
        if validated_count > 0:
            logger.info(
                "Running balance validation: all %d checkable transactions passed for %s",
                validated_count, filename,
            )

    return corrections, validation_ok, mismatch_count, validated_count


@app.post("/api/upload_statement")
async def upload_statement(request: Request):
    """Accept 1–12 PDF bank statements, parse and return combined transactions."""
    logger.info("=== UPLOAD STATEMENT(S) ===")
    form = await request.form()
    statements = form.getlist("statements") or form.getlist("statement")
    statements = [s for s in statements if s and hasattr(s, "read")]

    if not statements:
        return {"error": "At least one PDF file is required"}
    if len(statements) > MAX_STATEMENTS:
        return {"error": f"Maximum {MAX_STATEMENTS} statements allowed"}

    if not (os.environ.get("GOOGLE_API_KEY") or os.environ.get("GEMINI_API_KEY")):
        return {"error": "GOOGLE_API_KEY or GEMINI_API_KEY required for statement extraction (Docling + Gemini)."}

    parser_name = get_configured_parser_name()
    logger.info("STATEMENT_PARSER env=%r -> using parser: %s", os.environ.get("STATEMENT_PARSER"), parser_name)

    all_transactions = []
    files_breakdown = []
    storage_bucket_name = os.environ.get("STATEMENT_PDF_BUCKET", "statement-pdfs")
    _try_create_storage_bucket = bool(supabase and storage_bucket_name)
    _storage_bucket_created = False

    for idx, stmt in enumerate(statements):
        fname = stmt.filename or f"file_{idx}"
        if not fname.lower().endswith(".pdf"):
            logger.warning("Rejected: %s is not a PDF", fname)
            return {"error": f"Only PDF files accepted. '{fname}' is not a PDF."}
        logger.info("Processing: %s", fname)
        try:
            # Read up to (max + 1) bytes so we can reject oversize files
            # without buffering the entire payload into memory.
            content = await stmt.read(MAX_STATEMENT_FILE_SIZE_BYTES + 1)
            if len(content) > MAX_STATEMENT_FILE_SIZE_BYTES:
                logger.warning("Rejected: %s is larger than %d bytes", fname, MAX_STATEMENT_FILE_SIZE_BYTES)
                return {"error": f"Each PDF must be up to 1MB per file. '{fname}' is too large."}
            logger.info("Received %d bytes", len(content))

            storage_path = None
            if supabase and storage_bucket_name:
                if _try_create_storage_bucket and not _storage_bucket_created:
                    try:
                        supabase.storage.create_bucket(storage_bucket_name, options={"public": False})
                    except Exception:
                        # Bucket likely already exists or storage isn't configured; continue without failing the upload.
                        pass
                    _storage_bucket_created = True

                # Keep storage object key opaque; later we link it via `user_statements.storage_path`.
                object_key = f"statement-pdfs/{uuid.uuid4()}.pdf"
                try:
                    supabase.storage.from_(storage_bucket_name).upload(
                        object_key,
                        content,
                        {"content-type": "application/pdf"},
                    )
                    storage_path = f"{storage_bucket_name}/{object_key}"
                except Exception as e:
                    logger.warning("Supabase Storage upload failed for %s: %s", fname, e)

            with tempfile.NamedTemporaryFile(delete=False, suffix=".pdf") as tmp:
                tmp.write(content)
                tmp_path = tmp.name
            try:
                from .utils.gemini_model import (
                    get_configured_genai_model,
                    get_configured_genai_model_pass2,
                    get_configured_instructor_model_pass2,
                )

                PASS1_MODEL = get_configured_genai_model()
                PASS2_MODEL = get_configured_genai_model_pass2()
                PASS3_INSTRUCTOR_MODEL = get_configured_instructor_model_pass2()

                # --- Shared work: pdfplumber conversion (Pass 1 + Pass 2) ---
                structured_text = pdf_to_structured_text(Path(tmp_path))
                if not structured_text.strip():
                    raise RuntimeError(
                        "This PDF appears to be scanned images (no extractable text). "
                        "OCR/image-only PDF support is a feature coming soon."
                    )

                def _process_extraction(*, extraction, extraction_method: str) -> tuple[list[dict], list[dict], dict]:
                    meta = extraction.model_dump()
                    txns_list = meta.pop("transactions", [])
                    holdings_list = meta.pop("holdings", [])
                    provider = meta.get("provider") or "Unknown"
                    account_id_from_stmt = meta.get("account_id")
                    opening_balance = meta.get("opening_balance")
                    closing_balance = meta.get("closing_balance")
                    currency = meta.get("currency") or "CAD"
                    start_date = meta.get("start_date")
                    end_date = meta.get("end_date")
                    account_type = meta.get("account_type") or "Chequing"

                    transactions = txns_list if get_generates_transactions(account_type) else []
                    transactions = _strip_balance_lines(transactions)

                    running_ok = True
                    running_mismatch_count = 0
                    running_validated_count = 0

                    if account_type != "Credit Card":
                        _, running_ok, running_mismatch_count, running_validated_count = _validate_signs_from_running_balance(
                            transactions,
                            opening_balance,
                            filename=fname,
                        )
                    if account_type == "Credit Card":
                        _normalize_credit_card_signs(transactions)

                    closing_ok = True
                    if transactions and closing_balance is not None:
                        last_rb = None
                        for t in reversed(transactions):
                            if t.get("running_balance") is not None:
                                last_rb = t["running_balance"]
                                break
                        if last_rb is not None and abs(last_rb - closing_balance) > 0.02:
                            closing_ok = False

                    validation_ok = running_ok and closing_ok

                    # Stamp statement currency onto each extracted transaction for UI formatting
                    for t in transactions:
                        if isinstance(t, dict) and not t.get("currency"):
                            t["currency"] = currency

                    logger.info(
                        "LLM extraction: method=%s account_type=%s generates_txns=%s txns=%d holdings=%d validation_ok=%s (running_mismatches=%d, validated=%d, closing_ok=%s)",
                        extraction_method,
                        account_type,
                        get_generates_transactions(account_type),
                        len(transactions),
                        len(holdings_list),
                        validation_ok,
                        running_mismatch_count,
                        running_validated_count,
                        closing_ok,
                    )

                    extra = {
                        "validation_ok": validation_ok,
                        "running_mismatch_count": running_mismatch_count,
                        "running_validated_count": running_validated_count,
                        "closing_ok": closing_ok,
                        "extraction_method": extraction_method,
                        "provider": provider,
                        "account_id_from_stmt": account_id_from_stmt,
                        "opening_balance": opening_balance,
                        "closing_balance": closing_balance,
                        "currency": currency,
                        "start_date": start_date,
                        "end_date": end_date,
                        "account_type": account_type,
                        "holdings_list": holdings_list,
                    }
                    return transactions, holdings_list, extra

                # Pass 1
                extraction1 = extract_statement_from_structured_text(
                    structured_text,
                    model=PASS1_MODEL,
                )
                transactions, holdings_list, extra = _process_extraction(
                    extraction=extraction1,
                    extraction_method=f"pdfplumber+{PASS1_MODEL}",
                )

                # Pass 2 (retry on validation failure)
                pass2_used = False
                pass3_used = False
                if not extra["validation_ok"]:
                    pass2_used = True
                    extraction2 = extract_statement_from_structured_text(
                        structured_text,
                        model=PASS2_MODEL,
                    )
                    transactions, holdings_list, extra = _process_extraction(
                        extraction=extraction2,
                        extraction_method=f"pdfplumber+{PASS2_MODEL}",
                    )

                # Pass 3 (docling markdown + stronger Gemini) if still failing validation
                if not extra["validation_ok"]:
                    pass3_used = True
                    from .parsers.schema import StatementExtraction

                    markdown = pdf_to_markdown(Path(tmp_path), filename=fname)
                    docling_meta, docling_txns, docling_holdings = extract_statement_with_llm(
                        markdown,
                        model=PASS3_INSTRUCTOR_MODEL,
                    )
                    extraction3 = StatementExtraction.model_validate(
                        {**docling_meta, "transactions": docling_txns, "holdings": docling_holdings}
                    )
                    transactions, holdings_list, extra = _process_extraction(
                        extraction=extraction3,
                        extraction_method=f"docling+{PASS2_MODEL}",
                    )

                provider = extra["provider"]
                account_id_from_stmt = extra["account_id_from_stmt"]
                opening_balance = extra["opening_balance"]
                closing_balance = extra["closing_balance"]
                currency = extra["currency"]
                start_date = extra["start_date"]
                end_date = extra["end_date"]
                account_type = extra["account_type"]

            finally:
                Path(tmp_path).unlink(missing_ok=True)

            logger.info("Parsed %d transactions from %s (provider=%s account_type=%s)", len(transactions), fname, provider, account_type)
            all_transactions.extend(transactions)
            files_breakdown.append({
                "filename": fname,
                "transactions": transactions,
                "holdings": holdings_list,
                "opening_balance": opening_balance,
                "closing_balance": closing_balance,
                "account_id": account_id_from_stmt,
                "account_type": account_type,
                "provider": provider,
                "currency": currency,
                "start_date": start_date,
                "end_date": end_date,
                "storage_path": storage_path,
                "extraction_method": extra.get("extraction_method"),
                "retry_pass_2_used": pass2_used,
                "retry_pass_3_used": pass3_used,
                "validation_ok": extra.get("validation_ok"),
            })
        except Exception as e:
            logger.exception("Failed to parse %s: %s", fname, e)
            return {"error": f"Failed to parse '{fname}': {str(e)}"}

    transactions = all_transactions
    logger.info("Total transactions across all statements: %d", len(transactions))

    # Apply categorization before analysis
    cat_count, flagged_count = _apply_categorization(transactions)
    logger.info("Categorized %d transactions, %d flagged for review", cat_count, flagged_count)

    if transactions:
        logger.info("First 10 transactions: %s", json.dumps(transactions[:10], indent=2, default=str))
        if len(transactions) > 10:
            logger.info("... and %d more", len(transactions) - 10)
        file_logger.info("All transactions:\n%s", json.dumps(transactions, indent=2, default=str))

    analysis = analyze_transactions(transactions)
    logger.info(
        "Analysis: income=%.2f expenses=%.2f cash_flow=%.2f",
        analysis.get("total_income", 0),
        analysis.get("total_expenses", 0),
        analysis.get("cash_flow", 0),
    )
    file_logger.info(
        "Analysis: income=%.2f expenses=%.2f cash_flow=%.2f\nBy category: %s\nTop merchants: %s\nCash flow by month: %s",
        analysis.get("total_income", 0),
        analysis.get("total_expenses", 0),
        analysis.get("cash_flow", 0),
        json.dumps(analysis.get("by_category", {}), indent=2),
        json.dumps(analysis.get("top_merchants", []), indent=2),
        json.dumps(analysis.get("cash_flow_by_month", {}), indent=2),
    )
    logger.info("=== END UPLOAD ===")
    file_logger.info("=== END UPLOAD ===")

    processing_summary = {
        "transactions_categorized": cat_count,
        "flagged_for_review": flagged_count,
    }
    return {
        "transactions": transactions,
        "analysis": analysis,
        "source": "pdf",
        "files": files_breakdown,
        "processing_summary": processing_summary,
    }


@app.post("/api/v1/test-native-pdf-parse")
async def test_native_pdf_parse(file: UploadFile = File(...)):
    """
    Test endpoint for native PDF parsing (Gemini Files API + structured output).
    Isolated from Docling and existing statement upload route.
    """
    fname = file.filename or "statement.pdf"
    if not fname.lower().endswith(".pdf"):
        raise HTTPException(status_code=400, detail="Only PDF files are accepted")
    if file.content_type and "pdf" not in file.content_type.lower():
        raise HTTPException(status_code=400, detail="Only PDF files are accepted")

    tmp_path = None
    try:
        content = await file.read()
        if not content:
            raise HTTPException(status_code=400, detail="Empty file upload")
        with tempfile.NamedTemporaryFile(delete=False, suffix=".pdf") as tmp:
            tmp.write(content)
            tmp_path = tmp.name

        result = parse_statement_pdf_native(Path(tmp_path))
        return result.model_dump()
    except HTTPException:
        raise
    except ValueError as e:
        msg = str(e)
        if "GEMINI_API_KEY" in msg:
            raise HTTPException(status_code=500, detail=msg)
        raise HTTPException(status_code=400, detail=msg)
    except RuntimeError as e:
        raise HTTPException(status_code=502, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    finally:
        if tmp_path:
            Path(tmp_path).unlink(missing_ok=True)


@app.post("/api/analyze_transactions")
async def analyze_transactions_endpoint(payload: dict = Body(...)):
    """Analyze transaction list and return insights."""
    transactions = payload.get("transactions", [])
    if not isinstance(transactions, list):
        return {"error": "transactions must be a list"}
    result = analyze_transactions(transactions)
    return result


def _plaid_to_common(txn: dict) -> dict:
    """Convert Plaid transaction to common format. Plaid: + = outflow, - = inflow."""
    amount = float(txn.get("amount", 0))
    normalized_amount = -amount
    cat = None
    if "personal_finance_category" in txn and txn["personal_finance_category"]:
        pfc = txn["personal_finance_category"]
        if isinstance(pfc, dict):
            cat = pfc.get("primary") or pfc.get("detailed")
        elif isinstance(pfc, str):
            cat = pfc
    return {
        "date": txn.get("date"),
        "description": txn.get("name") or txn.get("merchant_name") or "Unknown",
        "amount": round(normalized_amount, 2),
        "category": cat,
        "currency": txn.get("iso_currency_code") or txn.get("unofficial_currency_code") or "CAD",
    }


@app.post("/api/transactions")
async def get_plaid_transactions(payload: dict = Body(...)):
    """Fetch transactions from Plaid using access_token. Returns normalized transactions + analysis."""
    access_token = payload.get("access_token")
    if not access_token:
        return {"error": "access_token required"}
    end = date.today()
    start = end - timedelta(days=90)
    try:
        req = TransactionsGetRequest(
            access_token=access_token,
            start_date=start,
            end_date=end,
        )
        resp = client.transactions_get(req)
        raw = resp.to_dict() if hasattr(resp, "to_dict") else dict(resp)
        plaid_txns = raw.get("transactions", [])
        transactions = [_plaid_to_common(t) for t in plaid_txns]
        _apply_categorization(transactions)
        analysis = analyze_transactions(transactions)
        return {"transactions": transactions, "analysis": analysis, "source": "plaid"}
    except plaid.ApiException as e:
        return {"error": str(e)}


def _apply_categorization(transactions: list[dict]) -> tuple[int, int]:
    """
    Apply categorization to each transaction. Mutates transactions in place.
    - confidence >= 0.8 and not "Uncategorized": use LLM category; else keyword fallback.
    - needs_review: True for E-Transfer/Uncategorised, or when LLM was used but confidence < 0.9 (user should confirm).
    Returns (transactions_categorized, flagged_for_review).
    """
    categorized = 0
    flagged = 0
    for t in transactions:
        desc = t.get("description") or t.get("clean_merchant") or "Unknown"
        confidence = t.get("confidence_score")
        llm_category = (t.get("category") or "").strip()

        # 1) Forced overrides from categories.json (rail-level deterministic matches)
        forced = forced_category_from_description(desc)

        # 2) Priority overrides from llm_priority_rules.json
        priority_name = None if forced is not None else override_category_from_description(desc)
        priority = get_category_by_name(priority_name) if priority_name else None

        use_llm = (
            forced is None
            and priority is None
            and isinstance(confidence, (int, float))
            and float(confidence) >= 0.8
            and llm_category
            and llm_category.lower() != "uncategorized"
        )
        result = forced or priority or (get_category_by_name(llm_category) if use_llm else None)
        if result is None:
            result = categorize_transaction(desc)
        t["category"] = result.get("category_name", result.get("category_id"))
        t["category_id"] = result["category_id"]
        t["tier1"] = result["tier1"]
        t["is_fixed_cost"] = result.get("is_fixed_cost", False)
        needs_review = result["category_id"] in ("etransfer", "uncategorized") or (
            use_llm and (confidence is None or float(confidence) < 0.9)
        )
        t["needs_review"] = needs_review
        categorized += 1
        if needs_review:
            flagged += 1
    return categorized, flagged


def _strip_date_prefix_from_description(desc: str | None) -> str:
    """Remove leading date-like fragments (e.g. '20 20' from PDF table extraction artifacts)."""
    if not desc:
        return "Unknown"
    s = str(desc).strip()
    # Strip leading "20 20", "2020 03 31", "31 03 20" etc. (space-separated date fragments)
    s = re.sub(r"^\d{1,4}\s+\d{1,2}(\s+\d{1,2})?\s+", "", s).strip()
    return s or "Unknown"


def _description_to_ilike_pattern(desc: str | None) -> str:
    """Strip trailing numbers, dates, and special chars (*, #) for 'similar' transaction matching.
    E.g. 'UBER EATS *1234' -> base 'UBER EATS'; return value is base with % and _ escaped + '%'."""
    if not desc:
        return "%"
    s = str(desc).strip()
    if not s:
        return "%"
    # Strip trailing: optional * or #, then digits/spaces; and trailing date-like fragments
    s = re.sub(r"[\s*#]*\d+[\s*#]*$", "", s)
    s = re.sub(r"\s+\d{1,4}[-/]\d{1,2}[-/]\d{1,2}\s*$", "", s)
    s = re.sub(r"\s+\d{1,2}[-/]\d{1,2}[-/]\d{2,4}\s*$", "", s)
    s = s.strip()
    if not s:
        return "%"
    # Escape ILIKE special chars: % -> \% , _ -> \_
    s = s.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")
    return s + "%"


def _is_etransfer(desc: str | None) -> bool:
    """True if description looks like an e-transfer (memo stripped by bank)."""
    if not desc or not isinstance(desc, str):
        return False
    lower = desc.strip().lower()
    return "e-transfer" in lower or "etransfer" in lower


# Float-safe amount matching for e-transfer similarity (avoid .eq on floats)
AMOUNT_BUFFER = 0.01


def _similar_query_etransfer(supabase_client, user_id: str, transaction_id: str, amount: float):
    """
    Return list of all similar e-transfer rows matching description (e-transfer pattern)
    and amount in [amount - buffer, amount + buffer]. Includes both uncategorised/needs_review
    and already categorized (count is used for Smart Action; bulk-update still targets only
    needs_review/uncategorised).
    """
    lo = amount - AMOUNT_BUFFER
    hi = amount + AMOUNT_BUFFER
    rows_by_id = {}
    for pattern in ("%e-transfer%", "%etransfer%"):
        resp = (
            supabase_client.table("transactions")
            .select("id, needs_review, category")
            .eq("user_id", user_id)
            .neq("id", transaction_id)
            .ilike("description", pattern)
            .gte("amount", lo)
            .lte("amount", hi)
            .execute()
        )
        for r in (resp.data or []):
            rows_by_id[r["id"]] = r
    return list(rows_by_id.values())


def _is_uncategorised(category) -> bool:
    """True if category is null, empty, or 'Uncategorized' / 'Uncategorised' (case-insensitive)."""
    if category is None:
        return True
    if not isinstance(category, str):
        return False
    s = category.strip().lower()
    return s in ("", "uncategorized", "uncategorised")


def _normalize_date_for_db(date_val: str | None) -> str | None:
    """Convert various date formats to YYYY-MM-DD for PostgreSQL. Avoids datestyle ambiguity (e.g. 25-03-31)."""
    if not date_val:
        return None
    s = str(date_val).strip()
    if not s:
        return None
    formats = [
        "%Y-%m-%d", "%y-%m-%d",  # 2025-03-31, 25-03-31
        "%d/%m/%Y", "%d/%m/%y", "%d-%m-%Y", "%d-%m-%y",
        "%m/%d/%Y", "%m/%d/%y", "%m-%d-%Y", "%m-%d-%y",
        "%Y/%m/%d", "%y/%m/%d",
        "%d %b %Y", "%d %B %Y", "%d %b %y",
    ]
    for fmt in formats:
        try:
            dt = datetime.strptime(s[:12].strip(), fmt)
            return dt.strftime("%Y-%m-%d")
        except (ValueError, TypeError):
            continue
    return None


def _detect_internal_transfers(db_transactions: list[dict], user_id: str) -> set[tuple[str, str]]:
    """
    Find pairs of transactions that look like internal transfers between accounts.
    Outgoing (amount < 0) in one account matches incoming (amount > 0) in another, same amount, within ±3 days.

    Edge case: one debit can match multiple credits (and vice versa). We enforce a 1:1 pairing by
    generating candidates and greedily taking the closest-date matches first.

    Returns set of (txn_id_out, txn_id_in) pairs.
    """
    from datetime import datetime as dt

    def _to_date(v):
        if not v:
            return None
        try:
            return dt.strptime(str(v)[:10], "%Y-%m-%d").date()
        except (ValueError, TypeError):
            return None

    by_account: dict[str, list[dict]] = defaultdict(list)
    for t in db_transactions:
        aid = t.get("account_id")
        if aid:
            by_account[aid].append(t)

    # Build candidate pairs across account combinations, then greedily assign 1:1
    candidates: list[tuple[int, str, str]] = []  # (abs_day_diff, tid_out, tid_in)
    account_ids = list(by_account.keys())
    for i, aid_a in enumerate(account_ids):
        for aid_b in account_ids[i + 1 :]:  # noqa: E203
            a_rows = by_account[aid_a]
            b_rows = by_account[aid_b]

            a_out = [(t, float(t.get("amount", 0) or 0), _to_date(t.get("date"))) for t in a_rows if float(t.get("amount", 0) or 0) < 0]
            a_in = [(t, float(t.get("amount", 0) or 0), _to_date(t.get("date"))) for t in a_rows if float(t.get("amount", 0) or 0) > 0]
            b_out = [(t, float(t.get("amount", 0) or 0), _to_date(t.get("date"))) for t in b_rows if float(t.get("amount", 0) or 0) < 0]
            b_in = [(t, float(t.get("amount", 0) or 0), _to_date(t.get("date"))) for t in b_rows if float(t.get("amount", 0) or 0) > 0]

            # a_out -> b_in
            for tout, amt_out, dout in a_out:
                if not dout:
                    continue
                tid_out = tout.get("id")
                if not tid_out:
                    continue
                for tin, amt_in, din in b_in:
                    if not din:
                        continue
                    if abs(abs(amt_out) - amt_in) < 0.02:
                        day_diff = abs((dout - din).days)
                        if day_diff <= 3:
                            tid_in = tin.get("id")
                            if tid_in:
                                candidates.append((day_diff, tid_out, tid_in))

            # b_out -> a_in
            for tout, amt_out, dout in b_out:
                if not dout:
                    continue
                tid_out = tout.get("id")
                if not tid_out:
                    continue
                for tin, amt_in, din in a_in:
                    if not din:
                        continue
                    if abs(abs(amt_out) - amt_in) < 0.02:
                        day_diff = abs((dout - din).days)
                        if day_diff <= 3:
                            tid_in = tin.get("id")
                            if tid_in:
                                candidates.append((day_diff, tid_out, tid_in))

    candidates.sort(key=lambda x: x[0])  # closest date first
    used: set[str] = set()
    pairs: set[tuple[str, str]] = set()
    for _, tid_out, tid_in in candidates:
        if tid_out in used or tid_in in used:
            continue
        used.add(tid_out)
        used.add(tid_in)
        pairs.add((tid_out, tid_in))
    return pairs


def _get_or_create_import_account(user_id: str) -> str:
    """Get or create a default 'Imported Statements' account for PDF uploads. Returns account_id (uuid)."""
    resp = supabase.table("accounts").select("id").eq("user_id", user_id).execute()
    for acc in (resp.data or []):
        if acc.get("name") and "Imported" in acc["name"]:
            return acc["id"]
    ins = supabase.table("accounts").insert({
        "user_id": user_id,
        "name": "Imported Statements",
        "account_type": "depository",
        "account_subtype": "Chequing",
        "provider": "PDF Upload",
    }).execute()
    if not ins or not (getattr(ins, "data", None) and len(ins.data) > 0):
        raise RuntimeError("Failed to create import account: no data returned from Supabase")
    return ins.data[0]["id"]


def _normalize_account_number(account_number: str | None) -> str:
    """Normalize account number by removing spaces and hyphens so '1 3008701' matches '13008701'."""
    if not account_number or not isinstance(account_number, str):
        return ""
    return "".join(account_number.strip().split()).replace("-", "")


def _get_or_create_account_by_provider_and_number(
    user_id: str, provider: str, account_number: str,
    account_subtype: str, currency: str,
) -> str:
    """Get or create account by (user_id, account_number). Returns account id (uuid). Provider is not used for uniqueness."""
    account_number = _normalize_account_number(account_number)
    if not account_number:
        return _get_or_create_import_account(user_id)
    resp = supabase.table("accounts").select("id").eq(
        "user_id", user_id
    ).eq("account_number", account_number).limit(1).execute()
    if resp and getattr(resp, "data", None) and resp.data and len(resp.data) > 0 and resp.data[0].get("id"):
        return resp.data[0]["id"]
    display_subtype = (account_subtype or "").strip()
    plaid_type = get_plaid_type(display_subtype) or "depository"
    display_label = display_subtype or plaid_type
    masked_last4 = f"••••{account_number[-4:]}" if len(account_number) >= 4 else f"••••{account_number}"
    if provider and display_label:
        name = f"{provider} – {display_label} ({masked_last4})"
    elif provider:
        name = f"{provider} ({masked_last4})"
    else:
        name = f"{display_label} ({masked_last4})"
    ins = supabase.table("accounts").insert({
        "user_id": user_id,
        "name": name,
        "provider": provider,
        "account_number": account_number,
        "account_type": plaid_type,
        "account_subtype": account_subtype or "Chequing",
    }).execute()
    if not ins or not (getattr(ins, "data", None) and len(ins.data) > 0):
        raise RuntimeError("Failed to create account: no data returned from Supabase")
    return ins.data[0]["id"]


def _update_account_number(account_id: str, account_number: str, user_id: str) -> None:
    """Set account_number on the account row when we have an extracted value from a statement."""
    an = _normalize_account_number(account_number)
    if not an:
        return
    try:
        supabase.table("accounts").update({"account_number": an}).eq(
            "id", account_id
        ).eq("user_id", user_id).execute()
    except Exception as e:
        logger.warning("Failed to update account account_number: %s", e)


def _update_account_type_and_subtype(account_id: str, account_subtype: str, user_id: str) -> None:
    """Set account_type and account_subtype on the account row. Only updates if the subtype is a valid canonical name."""
    if not account_subtype or not isinstance(account_subtype, str):
        return
    st = str(account_subtype).strip()
    if not st:
        return
    valid_types = get_valid_account_type_names()
    if st not in valid_types:
        return
    plaid_type = get_plaid_type(st) or "depository"
    try:
        supabase.table("accounts").update({
            "account_type": plaid_type,
            "account_subtype": st,
        }).eq("id", account_id).eq("user_id", user_id).execute()
    except Exception as e:
        logger.warning("Failed to update account type/subtype: %s", e)


def _normalize_uuid(value) -> str | None:
    """Normalize UUID to lowercase string for consistent dict keying."""
    if value is None:
        return None
    s = str(value).strip().lower()
    return s if s else None


def _get_latest_balance_per_account_currency(user_id: str) -> dict:
    """Return dict account_id -> list of { amount, currency, date } (latest by date per account/currency)."""
    try:
        bal_resp = supabase.table("balances").select("account_id, amount, currency, date").eq(
            "user_id", user_id
        ).order("date", desc=True).execute()
        rows = getattr(bal_resp, "data", None) or []
    except Exception:
        return {}
    # First row per (account_id, currency) is latest by date; normalize UUID for keying
    seen = set()
    result = {}
    for r in rows:
        aid = _normalize_uuid(r.get("account_id"))
        currency = (r.get("currency") or "CAD").strip() or "CAD"
        key = (aid, currency)
        if aid and key not in seen:
            seen.add(key)
            date_val = r.get("date")
            result.setdefault(aid, []).append({
                "amount": float(r.get("amount", 0) or 0),
                "currency": currency,
                "date": str(date_val) if date_val else None,
            })
    return result


def _db_txn_to_analysis(t: dict) -> dict:
    """Convert DB transaction row to analysis format. Includes account_id and is_transfer for Cash Flow filtering."""
    return {
        "id": t.get("id"),
        "account_id": t.get("account_id"),
        "statement_id": t.get("statement_id"),
        "date": str(t.get("date", "")) if t.get("date") else "",
        "description": _strip_date_prefix_from_description(t.get("description") or t.get("clean_merchant")),
        "amount": float(t.get("amount", 0)),
        "category": t.get("category"),
        "tags": t.get("tags") or [],
        "is_transfer": t.get("is_transfer", False),
        "linked_transaction_id": t.get("linked_transaction_id"),
        "needs_review": t.get("needs_review", False),
        "currency": (t.get("currency") or "CAD").strip() or "CAD",
    }


VALIDATABLE_STATEMENT_ACCOUNT_TYPES = {"depository", "credit"}
STATEMENT_BALANCE_TOLERANCE = 0.02


def _to_float_or_none(value) -> float | None:
    if value is None:
        return None
    try:
        return float(value)
    except Exception:
        return None


def _statement_open_close_from_balances(statement: dict, statement_balance_rows: list[dict]) -> tuple[float | None, float | None]:
    """Return (opening, closing) from balances rows for a statement."""
    if not statement_balance_rows:
        return None, None

    start_date = str(statement.get("start_date")) if statement.get("start_date") else None
    end_date = str(statement.get("end_date")) if statement.get("end_date") else None

    opening = None
    closing = None
    sorted_rows = sorted(
        statement_balance_rows,
        key=lambda r: str(r.get("date") or ""),
    )

    if start_date:
        for row in sorted_rows:
            if str(row.get("date")) == start_date:
                opening = _to_float_or_none(row.get("amount"))
                break
    if end_date:
        for row in sorted_rows:
            if str(row.get("date")) == end_date:
                closing = _to_float_or_none(row.get("amount"))
                break

    # Fallback for imperfect metadata: first and last balance row for this statement.
    if opening is None and sorted_rows:
        opening = _to_float_or_none(sorted_rows[0].get("amount"))
    if closing is None and sorted_rows:
        closing = _to_float_or_none(sorted_rows[-1].get("amount"))
    return opening, closing


def _annotate_statement_validation(
    statements: list[dict],
    accounts: list[dict],
    db_transactions: list[dict],
    balance_rows: list[dict],
) -> None:
    """Compute per-statement validation flags used by Data Editor UI."""
    account_type_by_id: dict[str, str] = {}
    for account in accounts or []:
        aid = _normalize_uuid(account.get("id"))
        if aid:
            account_type_by_id[aid] = str(account.get("account_type") or "").strip().lower()

    tx_by_stmt: dict[str, list[dict]] = defaultdict(list)
    for tx in db_transactions or []:
        sid = _normalize_uuid(tx.get("statement_id"))
        if sid:
            tx_by_stmt[sid].append(tx)

    balances_by_stmt: dict[str, list[dict]] = defaultdict(list)
    for row in balance_rows or []:
        sid = _normalize_uuid(row.get("statement_id"))
        if sid:
            balances_by_stmt[sid].append(row)

    for statement in statements or []:
        sid = _normalize_uuid(statement.get("id"))
        account_id = _normalize_uuid(statement.get("account_id"))
        account_type = account_type_by_id.get(account_id, "")
        applicable = account_type in VALIDATABLE_STATEMENT_ACCOUNT_TYPES

        statement_txs = tx_by_stmt.get(sid, [])
        all_reviewed = bool(applicable and all(not bool(tx.get("needs_review")) for tx in statement_txs))

        opening, closing = _statement_open_close_from_balances(statement, balances_by_stmt.get(sid, []))
        tx_sum = sum(_to_float_or_none(tx.get("amount")) or 0.0 for tx in statement_txs)
        balances_reconciled = bool(
            applicable
            and opening is not None
            and closing is not None
            and abs((opening + tx_sum) - closing) <= STATEMENT_BALANCE_TOLERANCE
        )

        statement["validation_applicable"] = applicable
        statement["balances_reconciled"] = balances_reconciled
        statement["all_reviewed"] = all_reviewed
        statement["fully_validated"] = bool(balances_reconciled and all_reviewed)


def _get_user_from_token(authorization: str = None):
    """Extract and verify Supabase JWT, return user_id. Supports both JWKS (ES256/RS256) and legacy HS256."""
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing or invalid Authorization header")
    token = authorization.split(" ")[1]
    supabase_url = os.getenv("SUPABASE_URL")
    jwks_url = f"{supabase_url.rstrip('/')}/auth/v1/.well-known/jwks.json" if supabase_url else None

    try:
        if jwks_url:
            jwks_client = jwt.PyJWKClient(jwks_url)
            signing_key = jwks_client.get_signing_key_from_jwt(token)
            payload = jwt.decode(
                token,
                signing_key.key,
                algorithms=["RS256", "ES256"],
                audience="authenticated",
                options={"verify_exp": True},
            )
            return payload.get("sub")
    except Exception:
        pass

    secret = os.getenv("SUPABASE_JWT_SECRET")
    if secret:
        try:
            payload = jwt.decode(token, secret, algorithms=["HS256"], audience="authenticated")
            return payload.get("sub")
        except jwt.InvalidTokenError:
            pass

    raise HTTPException(status_code=401, detail="Invalid token")


@app.post("/api/save_analysis")
async def save_analysis(
    payload: dict = Body(...),
    authorization: str = Header(None, alias="Authorization"),
):
    """No-op for backward compatibility. analyses/plaid_items tables were removed in favor of
    column-based accounts, statements, and transactions. Analysis is computed on-the-fly from transactions."""
    _get_user_from_token(authorization)
    return {"status": "saved"}


@app.get("/api/categories")
async def get_categories():
    """Return the shared categories JSON (used by PDF parser and AI categorizer). No auth required."""
    path = _ROOT / "api" / "data" / "categories.json"
    if not path.exists():
        raise HTTPException(status_code=500, detail="categories.json not found")
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/tags")
async def get_tags(authorization: str = Header(None, alias="Authorization")):
    """Return all unique tags for the authenticated user (via Postgres RPC)."""
    user_id = _get_user_from_token(authorization)
    if not supabase:
        raise HTTPException(status_code=500, detail="Database not configured")
    resp = supabase.rpc("get_unique_user_tags", {"p_user_id": user_id}).execute()
    tags = [row["tag"] for row in (resp.data or []) if row.get("tag")]
    return {"tags": tags}


@app.patch("/api/transactions/{transaction_id}/category")
async def patch_transaction_category(
    transaction_id: str,
    payload: dict = Body(...),
    authorization: str = Header(None, alias="Authorization"),
):
    """Update a transaction's category and set needs_review=False. Return similar-count for bulk prompt."""
    user_id = _get_user_from_token(authorization)
    if not supabase:
        raise HTTPException(status_code=500, detail="Database not configured")
    category = payload.get("category")
    if not category or not str(category).strip():
        raise HTTPException(status_code=400, detail="category is required")
    category = str(category).strip()

    # Ensure transaction exists and belongs to user
    existing = (
        supabase.table("transactions")
        .select("id, description, amount")
        .eq("id", transaction_id)
        .eq("user_id", user_id)
        .execute()
    )
    data = getattr(existing, "data", None) or []
    if not data:
        raise HTTPException(status_code=404, detail="Transaction not found")
    row = data[0]
    desc = row.get("description") or ""
    amount_val = float(row.get("amount", 0) or 0)

    # Update category and needs_review
    supabase.table("transactions").update({
        "category": category,
        "needs_review": False,
    }).eq("id", transaction_id).eq("user_id", user_id).execute()

    # Similar check: Path B (e-transfer) = description + amount range; Path A = description pattern only
    similar_amount = None
    if _is_etransfer(desc):
        similar_rows = _similar_query_etransfer(supabase, user_id, transaction_id, amount_val)
        similar_count = len(similar_rows)
        has_similar_pending = similar_count > 0
        if has_similar_pending:
            similar_amount = amount_val
        base = "e-transfer"
    else:
        ilike_pattern = _description_to_ilike_pattern(desc)
        similar_resp = (
            supabase.table("transactions")
            .select("id, needs_review, category")
            .eq("user_id", user_id)
            .neq("id", transaction_id)
            .ilike("description", ilike_pattern)
            .execute()
        )
        similar_rows = similar_resp.data or []
        # Count all similar for Smart Action; bulk-update still only applies to needs_review/uncategorised
        similar_count = len(similar_rows)
        has_similar_pending = similar_count > 0
        base = re.sub(r"[\s*#]*\d+[\s*#]*$", "", str(desc).strip()) if desc else ""
        base = re.sub(r"\s+\d{1,4}[-/]\d{1,2}[-/]\d{1,2}\s*$", "", base).strip()
        base = re.sub(r"\s+\d{1,2}[-/]\d{1,2}[-/]\d{2,4}\s*$", "", base).strip() or (desc or "")

    updated_row = (
        supabase.table("transactions")
        .select("*")
        .eq("id", transaction_id)
        .eq("user_id", user_id)
        .execute()
    )
    updated_data = getattr(updated_row, "data", None) or []
    transaction = _db_txn_to_analysis(updated_data[0]) if updated_data else None
    if transaction is not None:
        transaction["needs_review"] = False

    out = {
        "transaction": transaction,
        "has_similar_pending": has_similar_pending,
        "similar_count": similar_count,
        "similar_description": base,
    }
    if similar_amount is not None:
        out["similar_amount"] = similar_amount
    return out


@app.patch("/api/transactions/{transaction_id}/tags")
async def patch_transaction_tags(
    transaction_id: str,
    payload: dict = Body(...),
    authorization: str = Header(None, alias="Authorization"),
):
    """Update a transaction's tags. Normalizes before saving. Returns similarity info for unified bulk prompt."""
    user_id = _get_user_from_token(authorization)
    if not supabase:
        raise HTTPException(status_code=500, detail="Database not configured")
    raw_tags = payload.get("tags")
    if raw_tags is None:
        raise HTTPException(status_code=400, detail="tags array is required")
    tags = normalize_tags(raw_tags)

    existing = (
        supabase.table("transactions")
        .select("id, description, amount")
        .eq("id", transaction_id)
        .eq("user_id", user_id)
        .execute()
    )
    if not (getattr(existing, "data", None) or []):
        raise HTTPException(status_code=404, detail="Transaction not found")
    row = existing.data[0]
    desc = row.get("description") or ""
    amount_val = float(row.get("amount", 0) or 0)

    supabase.table("transactions").update({
        "tags": tags,
    }).eq("id", transaction_id).eq("user_id", user_id).execute()

    similar_amount = None
    if _is_etransfer(desc):
        similar_rows = _similar_query_etransfer(supabase, user_id, transaction_id, amount_val)
        similar_count = len(similar_rows)
        has_similar_pending = similar_count > 0
        if has_similar_pending:
            similar_amount = amount_val
        base = "e-transfer"
    else:
        ilike_pattern = _description_to_ilike_pattern(desc)
        similar_resp = (
            supabase.table("transactions")
            .select("id, needs_review, category")
            .eq("user_id", user_id)
            .neq("id", transaction_id)
            .ilike("description", ilike_pattern)
            .execute()
        )
        similar_rows = similar_resp.data or []
        # Count all similar for Smart Action; bulk-update still only applies to needs_review/uncategorised
        similar_count = len(similar_rows)
        has_similar_pending = similar_count > 0
        base = re.sub(r"[\s*#]*\d+[\s*#]*$", "", str(desc).strip()) if desc else ""
        base = re.sub(r"\s+\d{1,4}[-/]\d{1,2}[-/]\d{1,2}\s*$", "", base).strip()
        base = re.sub(r"\s+\d{1,2}[-/]\d{1,2}[-/]\d{2,4}\s*$", "", base).strip() or (desc or "")

    updated_row = (
        supabase.table("transactions")
        .select("*")
        .eq("id", transaction_id)
        .eq("user_id", user_id)
        .execute()
    )
    updated_data = getattr(updated_row, "data", None) or []
    transaction = _db_txn_to_analysis(updated_data[0]) if updated_data else None
    out = {
        "transaction": transaction,
        "has_similar_pending": has_similar_pending,
        "similar_count": similar_count,
        "similar_description": base,
    }
    if similar_amount is not None:
        out["similar_amount"] = similar_amount
    return out


@app.patch("/api/transactions/bulk-update-category")
async def bulk_update_transaction_category(
    payload: dict = Body(...),
    authorization: str = Header(None, alias="Authorization"),
):
    """Bulk-update similar transactions. category and tags are both optional; at least one must be provided."""
    user_id = _get_user_from_token(authorization)
    if not supabase:
        raise HTTPException(status_code=500, detail="Database not configured")
    description = payload.get("description")
    category = payload.get("category")
    raw_tags = payload.get("tags")
    if not description or not str(description).strip():
        raise HTTPException(status_code=400, detail="description is required")
    has_category = category and str(category).strip()
    has_tags = raw_tags is not None
    if not has_category and not has_tags:
        raise HTTPException(status_code=400, detail="at least one of category or tags is required")
    category = str(category).strip() if has_category else None
    normalized_tags = normalize_tags(raw_tags) if has_tags else None
    description_str = str(description).strip()
    payload_amount = payload.get("amount")

    if payload_amount is not None and _is_etransfer(description_str):
        # Path B: e-transfer – match by description pattern + amount range; update all similar
        amount_val = float(payload_amount)
        lo = amount_val - AMOUNT_BUFFER
        hi = amount_val + AMOUNT_BUFFER
        rows_by_id = {}
        for pattern in ("%e-transfer%", "%etransfer%"):
            match_resp = (
                supabase.table("transactions")
                .select("id")
                .eq("user_id", user_id)
                .ilike("description", pattern)
                .gte("amount", lo)
                .lte("amount", hi)
                .execute()
            )
            for r in (match_resp.data or []):
                rows_by_id[r["id"]] = True
        ids = list(rows_by_id.keys())
    else:
        # Path A: standard – match by description pattern only; update all similar
        ilike_pattern = _description_to_ilike_pattern(description_str)
        match_resp = (
            supabase.table("transactions")
            .select("id")
            .eq("user_id", user_id)
            .ilike("description", ilike_pattern)
            .execute()
        )
        ids = [r["id"] for r in (match_resp.data or [])]
    if not ids:
        # Return full list so the UI does not get wiped when nothing to update
        tx_resp = supabase.table("transactions").select("*").eq("user_id", user_id).order("date", desc=False).execute()
        db_transactions = tx_resp.data or []
        all_transactions = [_db_txn_to_analysis(t) for t in db_transactions]
        return {"updated_count": 0, "transactions": all_transactions}

    update_payload = {}
    if category is not None:
        update_payload["category"] = category
        update_payload["needs_review"] = False
    if normalized_tags is not None:
        update_payload["tags"] = normalized_tags

    for tid in ids:
        supabase.table("transactions").update(
            update_payload
        ).eq("id", tid).eq("user_id", user_id).execute()

    # Return updated rows in analysis shape
    tx_resp = supabase.table("transactions").select("*").eq("user_id", user_id).order("date", desc=False).execute()
    db_transactions = tx_resp.data or []
    all_transactions = [_db_txn_to_analysis(t) for t in db_transactions]
    return {"updated_count": len(ids), "transactions": all_transactions}


@app.get("/api/user_data")
async def get_user_data(authorization: str = Header(None, alias="Authorization")):
    """Fetch user's accounts, statements, transactions and computed analysis. Requires Bearer token."""
    user_id = _get_user_from_token(authorization)
    if not supabase:
        raise HTTPException(status_code=500, detail="Database not configured")
    try:
        accounts_resp = supabase.table("accounts").select("*").eq("user_id", user_id).execute()
        accounts = accounts_resp.data or []

        stmt_resp = supabase.table("user_statements").select("*").eq("user_id", user_id).order("created_at", desc=False).execute()
        statements = stmt_resp.data or []

        tx_resp = supabase.table("transactions").select("*").eq("user_id", user_id).order("date", desc=False).execute()
        db_transactions = tx_resp.data or []

        all_transactions = [_db_txn_to_analysis(t) for t in db_transactions]
        tx_by_stmt = defaultdict(list)
        for t in db_transactions:
            sid = t.get("statement_id")
            if sid:
                tx_by_stmt[sid].append(_db_txn_to_analysis(t))
        for s in statements:
            s["transactions"] = tx_by_stmt.get(s["id"], [])

        balances = []
        try:
            bal_resp = supabase.table("balances").select("*").eq("user_id", user_id).order("date", desc=True).execute()
            balances = getattr(bal_resp, "data", None) or []
        except Exception:
            pass
        _annotate_statement_validation(statements, accounts, db_transactions, balances)

        analysis = analyze_transactions(all_transactions)
        return {
            "accounts": accounts,
            "statements": statements,
            "transactions": all_transactions,
            "analysis": analysis,
            "balances": balances,
            "source": "pdf",
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.get("/api/accounts_with_balances")
async def get_accounts_with_balances(authorization: str = Header(None, alias="Authorization")):
    """Return accounts for the user with balances (latest per account/currency and date) for Wealth tab."""
    user_id = _get_user_from_token(authorization)
    if not supabase:
        raise HTTPException(status_code=500, detail="Database not configured")
    try:
        accounts_resp = supabase.table("accounts").select("id, name, account_type, account_subtype, provider").eq(
            "user_id", user_id
        ).order("account_subtype").execute()
        accounts = accounts_resp.data or []
        latest_by_account = _get_latest_balance_per_account_currency(user_id)
        for a in accounts:
            a["balances"] = latest_by_account.get(_normalize_uuid(a.get("id")), [])
        return {"accounts": accounts}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


def _get_latest_holdings_snapshot(user_id: str, account_id: str, currency: str) -> tuple[list[dict], str | None]:
    """Return (list of holding dicts, snapshot_date) for the latest date with holdings for this account/currency."""
    try:
        aid = _normalize_uuid(account_id)
        if not aid:
            return [], None
        cur = (currency or "CAD").strip() or "CAD"
        resp = supabase.table("holdings").select(
            "asset_symbol, asset_name, quantity, unit_price, total_value, currency, date, is_cash_equivalent"
        ).eq("user_id", user_id).eq("account_id", aid).eq("currency", cur).order("date", desc=True).execute()
        rows = getattr(resp, "data", None) or []
    except Exception:
        return [], None
    if not rows:
        return [], None
    latest_date = rows[0].get("date")
    if not latest_date:
        return [], None
    snapshot = [
        {
            "asset_symbol": r.get("asset_symbol"),
            "asset_name": r.get("asset_name"),
            "quantity": float(r.get("quantity", 0) or 0),
            "unit_price": float(r.get("unit_price", 0) or 0),
            "total_value": float(r.get("total_value", 0) or 0),
            "currency": (r.get("currency") or cur).strip() or cur,
            "date": str(r.get("date")) if r.get("date") else None,
            "is_cash_equivalent": bool(r.get("is_cash_equivalent", False)),
        }
        for r in rows
        if str(r.get("date")) == str(latest_date)
    ]
    return snapshot, str(latest_date)


@app.get("/api/holdings")
async def get_holdings(
    account_id: str = None,
    currency: str = "CAD",
    authorization: str = Header(None, alias="Authorization"),
):
    """Return latest holdings snapshot for an account/currency. Auth required."""
    user_id = _get_user_from_token(authorization)
    if not account_id:
        raise HTTPException(status_code=400, detail="account_id is required")
    if not supabase:
        raise HTTPException(status_code=500, detail="Database not configured")
    try:
        holdings_list, snapshot_date = _get_latest_holdings_snapshot(user_id, account_id, currency or "CAD")
        return {"holdings": holdings_list, "date": snapshot_date}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/save_statements")
async def save_statements(
    payload: dict = Body(...),
    authorization: str = Header(None, alias="Authorization"),
):
    """Save uploaded statement(s) to Supabase. Get-or-create account by (provider, account_number);
    branch insertion logic by Plaid type: investment -> balances + holdings, others -> balances + transactions."""
    user_id = _get_user_from_token(authorization)
    if not supabase:
        raise HTTPException(status_code=500, detail="Database not configured")
    items = payload.get("statements", [])
    if not isinstance(items, list) or not items:
        raise HTTPException(status_code=400, detail="statements must be a non-empty list of {filename, transactions, provider?, account_id?, ...}")
    try:
        all_txn_rows = []
        cat_count = 0
        flagged_count = 0

        for item in items:
            # IMPORTANT: This tracking must be scoped to the current statement item.
            # If it persisted across items, `occurrence_index` would be inflated for later uploads.
            signature_counts = {}
            fn = item.get("filename") or "statement.pdf"
            txns = item.get("transactions") or []
            if not isinstance(txns, list):
                txns = []

            provider = item.get("provider") or "Unknown"
            account_number = _normalize_account_number(
                item.get("account_id") or item.get("account_number")
            )
            account_subtype = item.get("account_type") or "Chequing"
            plaid_type = get_plaid_type(account_subtype) or "depository"
            currency = item.get("currency") or "CAD"
            start_date = item.get("start_date")
            end_date = item.get("end_date")
            if not start_date and txns:
                norm_dates = [_normalize_date_for_db(t.get("date")) for t in txns]
                valid_dates = [d for d in norm_dates if d]
                if valid_dates:
                    start_date = min(valid_dates)
            if not end_date and txns:
                norm_dates = [_normalize_date_for_db(t.get("date")) for t in txns]
                valid_dates = [d for d in norm_dates if d]
                if valid_dates:
                    end_date = max(valid_dates)

            account_id = _get_or_create_account_by_provider_and_number(
                user_id, provider, account_number, account_subtype, currency
            )

            if get_generates_transactions(account_subtype):
                c, f = _apply_categorization(txns)
                cat_count += c
                flagged_count += f

            stmt_ins = supabase.table("user_statements").insert({
                "user_id": user_id,
                "account_id": account_id,
                "filename": fn,
                "storage_path": item.get("storage_path"),
                "start_date": start_date,
                "end_date": end_date,
                "provider": provider,
            }).execute()
            if not stmt_ins or not (getattr(stmt_ins, "data", None) and len(stmt_ins.data) > 0):
                raise RuntimeError("Failed to insert user_statement: no data returned from Supabase")
            statement_id = stmt_ins.data[0]["id"]

            # Event-driven ledger: insert point-in-time balances (all account types)
            opening_balance = item.get("opening_balance")
            closing_balance = item.get("closing_balance")
            if start_date and opening_balance is not None:
                supabase.table("balances").insert({
                    "user_id": user_id,
                    "account_id": account_id,
                    "statement_id": statement_id,
                    "amount": round(float(opening_balance), 2),
                    "currency": currency or "CAD",
                    "date": start_date,
                }).execute()
            if end_date and closing_balance is not None:
                supabase.table("balances").insert({
                    "user_id": user_id,
                    "account_id": account_id,
                    "statement_id": statement_id,
                    "amount": round(float(closing_balance), 2),
                    "currency": currency or "CAD",
                    "date": end_date,
                }).execute()

            # Investment accounts: insert holdings; integrity check first
            if plaid_type == "investment":
                holdings_list = item.get("holdings") or []
                if holdings_list and closing_balance is not None:
                    holdings_sum = sum(float(h.get("total_value", 0)) for h in holdings_list)
                    if abs(holdings_sum - float(closing_balance)) > 0.01:
                        logger.warning(
                            "Holdings/balance mismatch for statement %s (account %s): "
                            "closing_balance=%.2f, holdings_sum=%.2f, diff=%.2f",
                            statement_id, account_id,
                            float(closing_balance), holdings_sum,
                            holdings_sum - float(closing_balance),
                        )
                holding_date = end_date or start_date
                for h in holdings_list:
                    supabase.table("holdings").insert({
                        "user_id": user_id,
                        "account_id": account_id,
                        "statement_id": statement_id,
                        "asset_symbol": h.get("asset_symbol") or "CASH",
                        "asset_name": h.get("asset_name"),
                        "quantity": float(h.get("quantity", 0)),
                        "unit_price": float(h.get("unit_price", 0)),
                        "total_value": float(h.get("total_value", 0)),
                        "currency": h.get("currency") or currency or "CAD",
                        "date": holding_date,
                        "is_cash_equivalent": bool(h.get("is_cash_equivalent", False)),
                    }).execute()

            # Depository / credit / loan: process transactions if applicable, skip holdings
            if not get_generates_transactions(account_subtype):
                txns = []

            txns = _strip_balance_lines(txns)

            for txn in txns:
                raw_date = txn.get("date")
                norm_date = _normalize_date_for_db(raw_date)
                if not norm_date:
                    continue
                desc = _strip_date_prefix_from_description(txn.get("description"))
                amount_rounded = round(float(txn.get("amount", 0) or 0), 2)
                sig = (norm_date, amount_rounded, desc)
                occurrence_index = signature_counts.get(sig, 0) + 1
                signature_counts[sig] = occurrence_index
                txn_row = {
                    "user_id": user_id,
                    "account_id": account_id,
                    "statement_id": statement_id,
                    "date": norm_date,
                    "description": desc,
                    "clean_merchant": txn.get("clean_merchant"),
                    "amount": amount_rounded,
                    "category": txn.get("category"),
                    "is_fixed_cost": txn.get("is_fixed_cost", False),
                    "needs_review": txn.get("needs_review", False),
                    "occurrence_index": occurrence_index,
                    "currency": currency,
                }
                all_txn_rows.append(txn_row)

        # Upsert transactions (ignore duplicates; uniqueness is enforced in DB).
        for txn_row in all_txn_rows:
            supabase.table("transactions").upsert(
                txn_row,
                on_conflict="account_id,date,amount,description,occurrence_index",
                ignore_duplicates=True,
            ).execute()

        # Recompute internal transfer links for this user (avoid stale links on re-upload/delete).
        # 1) Clear all previous transfer marks/links for the user
        supabase.table("transactions").update(
            {"is_transfer": False, "linked_transaction_id": None}
        ).eq("user_id", user_id).execute()

        # 2) Fetch all user transactions and run transfer detection
        tx_resp = supabase.table("transactions").select("*").eq("user_id", user_id).execute()
        db_transactions = getattr(tx_resp, "data", None) or []
        transfer_pairs = _detect_internal_transfers(db_transactions, user_id)

        # 3) Persist 1:1 links + transfer marker on both sides
        for tid_out, tid_in in transfer_pairs:
            supabase.table("transactions").update(
                {"is_transfer": True, "linked_transaction_id": tid_in, "category": "Self-Transfer"}
            ).eq("id", tid_out).eq("user_id", user_id).execute()
            supabase.table("transactions").update(
                {"is_transfer": True, "linked_transaction_id": tid_out, "category": "Self-Transfer"}
            ).eq("id", tid_in).eq("user_id", user_id).execute()

        tx_resp = supabase.table("transactions").select("*").eq("user_id", user_id).order("date", desc=False).execute()
        db_transactions = getattr(tx_resp, "data", None) or []
        all_transactions = [_db_txn_to_analysis(t) for t in db_transactions]
        analysis = analyze_transactions(all_transactions)

        processing_summary = {
            "transactions_categorized": cat_count,
            "flagged_for_review": flagged_count,
            "transfers_detected": len(transfer_pairs),
        }
        return {
            "status": "saved",
            "analysis": analysis,
            "transactions": all_transactions,
            "processing_summary": processing_summary,
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.delete("/api/statements/{statement_id}")
async def delete_statement(statement_id: str, authorization: str = Header(None, alias="Authorization")):
    """Delete a statement by id (cascades to transactions). If it was the last statement for that account, delete the account too. Recompute and return updated analysis."""
    user_id = _get_user_from_token(authorization)
    if not supabase:
        raise HTTPException(status_code=500, detail="Database not configured")
    try:
        # Fetch statement to get account_id before deleting (and ensure it exists and belongs to user)
        get_resp = supabase.table("user_statements").select("account_id").eq("id", statement_id).eq("user_id", user_id).execute()
        if not get_resp.data or len(get_resp.data) == 0:
            raise HTTPException(status_code=404, detail="Statement not found")
        account_id = get_resp.data[0].get("account_id")

        supabase.table("user_statements").delete().eq("id", statement_id).eq("user_id", user_id).execute()

        # If this was the last statement for that account, delete the account row
        if account_id:
            remaining = supabase.table("user_statements").select("id").eq("account_id", account_id).execute()
            if not (remaining.data and len(remaining.data) > 0):
                supabase.table("accounts").delete().eq("id", account_id).eq("user_id", user_id).execute()

        stmt_resp = supabase.table("user_statements").select("*").eq("user_id", user_id).order("created_at", desc=False).execute()
        statements = stmt_resp.data or []
        accounts_resp = supabase.table("accounts").select("id, account_type").eq("user_id", user_id).execute()
        accounts = accounts_resp.data or []

        tx_resp = supabase.table("transactions").select("*").eq("user_id", user_id).order("date", desc=False).execute()
        db_transactions = tx_resp.data or []
        all_transactions = [_db_txn_to_analysis(t) for t in db_transactions]
        tx_by_stmt = defaultdict(list)
        for t in db_transactions:
            sid = t.get("statement_id")
            if sid:
                tx_by_stmt[sid].append(_db_txn_to_analysis(t))
        for s in statements:
            s["transactions"] = tx_by_stmt.get(s["id"], [])
        bal_resp = supabase.table("balances").select("statement_id, date, amount").eq("user_id", user_id).execute()
        balance_rows = getattr(bal_resp, "data", None) or []
        _annotate_statement_validation(statements, accounts, db_transactions, balance_rows)

        analysis = analyze_transactions(all_transactions)
        return {"statements": statements, "transactions": all_transactions, "analysis": analysis}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/statements/bulk-delete")
async def bulk_delete_statements(body: dict = Body(...), authorization: str = Header(None, alias="Authorization")):
    """Delete multiple statements by IDs (cascades to transactions). Cleans up orphaned accounts. Recomputes and returns updated analysis."""
    user_id = _get_user_from_token(authorization)
    if not supabase:
        raise HTTPException(status_code=500, detail="Database not configured")
    statement_ids = body.get("statement_ids", [])
    if not statement_ids or not isinstance(statement_ids, list):
        raise HTTPException(status_code=400, detail="statement_ids must be a non-empty list")
    try:
        affected_account_ids = set()
        for sid in statement_ids:
            get_resp = supabase.table("user_statements").select("account_id").eq("id", sid).eq("user_id", user_id).execute()
            if get_resp.data and len(get_resp.data) > 0:
                acc_id = get_resp.data[0].get("account_id")
                if acc_id:
                    affected_account_ids.add(acc_id)
                supabase.table("user_statements").delete().eq("id", sid).eq("user_id", user_id).execute()

        for account_id in affected_account_ids:
            remaining = supabase.table("user_statements").select("id").eq("account_id", account_id).execute()
            if not (remaining.data and len(remaining.data) > 0):
                supabase.table("accounts").delete().eq("id", account_id).eq("user_id", user_id).execute()

        stmt_resp = supabase.table("user_statements").select("*").eq("user_id", user_id).order("created_at", desc=False).execute()
        statements = stmt_resp.data or []
        accounts_resp = supabase.table("accounts").select("id, account_type").eq("user_id", user_id).execute()
        accounts = accounts_resp.data or []

        tx_resp = supabase.table("transactions").select("*").eq("user_id", user_id).order("date", desc=False).execute()
        db_transactions = tx_resp.data or []
        all_transactions = [_db_txn_to_analysis(t) for t in db_transactions]
        tx_by_stmt = defaultdict(list)
        for t in db_transactions:
            sid = t.get("statement_id")
            if sid:
                tx_by_stmt[sid].append(_db_txn_to_analysis(t))
        for s in statements:
            s["transactions"] = tx_by_stmt.get(s["id"], [])
        bal_resp = supabase.table("balances").select("statement_id, date, amount").eq("user_id", user_id).execute()
        balance_rows = getattr(bal_resp, "data", None) or []
        _annotate_statement_validation(statements, accounts, db_transactions, balance_rows)

        analysis = analyze_transactions(all_transactions)
        return {"statements": statements, "transactions": all_transactions, "analysis": analysis, "deleted_count": len(statement_ids)}
    except HTTPException:
        raise
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/rerun_analysis")
async def rerun_analysis(authorization: str = Header(None, alias="Authorization")):
    """Recompute analysis from all saved transactions (no changes to data)."""
    user_id = _get_user_from_token(authorization)
    if not supabase:
        raise HTTPException(status_code=500, detail="Database not configured")
    try:
        stmt_resp = supabase.table("user_statements").select("*").eq("user_id", user_id).order("created_at", desc=False).execute()
        statements = stmt_resp.data or []
        accounts_resp = supabase.table("accounts").select("id, account_type").eq("user_id", user_id).execute()
        accounts = accounts_resp.data or []

        tx_resp = supabase.table("transactions").select("*").eq("user_id", user_id).order("date", desc=False).execute()
        db_transactions = tx_resp.data or []
        all_transactions = [_db_txn_to_analysis(t) for t in db_transactions]
        tx_by_stmt = defaultdict(list)
        for t in db_transactions:
            sid = t.get("statement_id")
            if sid:
                tx_by_stmt[sid].append(_db_txn_to_analysis(t))
        for s in statements:
            s["transactions"] = tx_by_stmt.get(s["id"], [])
        bal_resp = supabase.table("balances").select("statement_id, date, amount").eq("user_id", user_id).execute()
        balance_rows = getattr(bal_resp, "data", None) or []
        _annotate_statement_validation(statements, accounts, db_transactions, balance_rows)

        analysis = analyze_transactions(all_transactions)
        return {"statements": statements, "transactions": all_transactions, "analysis": analysis}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/detect-internal-transfers")
async def detect_internal_transfers(authorization: str = Header(None, alias="Authorization")):
    """
    Recompute internal transfer detection for the authenticated user.
    - Clears previous is_transfer + linked_transaction_id
    - Runs _detect_internal_transfers over all user transactions
    - Persists 1:1 links on both sides
    Returns updated transactions + analysis + summary counts.
    """
    user_id = _get_user_from_token(authorization)
    if not supabase:
        raise HTTPException(status_code=500, detail="Database not configured")
    try:
        # Clear all previous transfer marks/links
        supabase.table("transactions").update(
            {"is_transfer": False, "linked_transaction_id": None}
        ).eq("user_id", user_id).execute()

        # Re-detect pairs based on current ledger
        tx_resp = supabase.table("transactions").select("*").eq("user_id", user_id).execute()
        db_transactions = getattr(tx_resp, "data", None) or []
        transfer_pairs = _detect_internal_transfers(db_transactions, user_id)

        for tid_out, tid_in in transfer_pairs:
            supabase.table("transactions").update(
                {"is_transfer": True, "linked_transaction_id": tid_in, "category": "Self-Transfer"}
            ).eq("id", tid_out).eq("user_id", user_id).execute()
            supabase.table("transactions").update(
                {"is_transfer": True, "linked_transaction_id": tid_out, "category": "Self-Transfer"}
            ).eq("id", tid_in).eq("user_id", user_id).execute()

        # Return updated transactions + recomputed analysis
        tx_resp = supabase.table("transactions").select("*").eq("user_id", user_id).order("date", desc=False).execute()
        db_transactions = getattr(tx_resp, "data", None) or []
        all_transactions = [_db_txn_to_analysis(t) for t in db_transactions]
        analysis = analyze_transactions(all_transactions)
        return {
            "transactions": all_transactions,
            "analysis": analysis,
            "processing_summary": {
                "transfers_detected": len(transfer_pairs),
                "transactions_marked_transfer": len(transfer_pairs) * 2,
            },
        }
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
