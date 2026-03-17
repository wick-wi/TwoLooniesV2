import json
import logging
import os
import re
import tempfile
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
load_dotenv(dotenv_path=env_path)
if env_local.exists():
    load_dotenv(dotenv_path=env_local, override=True)

print("--- SYSTEM CHECK ---")
print(f"Looking for .env at: {env_path}")
print(f"File exists? {env_path.exists()}")
print(f"Client ID loaded: {os.getenv('PLAID_CLIENT_ID') is not None}")
print("--------------------")

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
from .parsers.docling_statement import extract_statement_with_llm
from .parsers.account_types_ref import get_valid_account_type_names, get_generates_transactions, get_plaid_type
from .utils.categorization import categorize_transaction, get_category_by_name
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

    all_transactions = []
    files_breakdown = []

    for idx, stmt in enumerate(statements):
        fname = stmt.filename or f"file_{idx}"
        if not fname.lower().endswith(".pdf"):
            logger.warning("Rejected: %s is not a PDF", fname)
            return {"error": f"Only PDF files accepted. '{fname}' is not a PDF."}
        logger.info("Processing: %s", fname)
        try:
            content = await stmt.read()
            logger.info("Received %d bytes", len(content))
            with tempfile.NamedTemporaryFile(delete=False, suffix=".pdf") as tmp:
                tmp.write(content)
                tmp_path = tmp.name
            try:
                markdown = pdf_to_markdown(tmp_path, filename=fname)
                meta, txns_list, holdings_list = extract_statement_with_llm(markdown)
                provider = meta.get("provider") or "Unknown"
                account_id_from_stmt = meta.get("account_id")
                opening_balance = meta.get("opening_balance")
                closing_balance = meta.get("closing_balance")
                currency = meta.get("currency") or "CAD"
                start_date = meta.get("start_date")
                end_date = meta.get("end_date")
                account_type = meta.get("account_type") or "Chequing"
                transactions = txns_list if get_generates_transactions(account_type) else []
                # Credit card statements: expenses are positive, payments negative; flip to app convention (negative = outflow, positive = inflow)
                if account_type == "Credit Card":
                    for t in transactions:
                        amt = t.get("amount")
                        if amt is not None:
                            t["amount"] = round(-float(amt), 2)
                # Stamp statement currency onto each extracted transaction for UI formatting
                for t in transactions:
                    if isinstance(t, dict) and not t.get("currency"):
                        t["currency"] = currency
                logger.info("LLM extraction: account_type=%s generates_txns=%s txns=%d holdings=%d", account_type, get_generates_transactions(account_type), len(transactions), len(holdings_list))

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
                "extraction_method": "docling_gemini",
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
        use_llm = (
            isinstance(confidence, (int, float))
            and float(confidence) >= 0.8
            and llm_category
            and llm_category.lower() != "uncategorized"
        )
        result = get_category_by_name(llm_category) if use_llm else None
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
    Returns set of (txn_id_out, txn_id_in) pairs.
    """
    from datetime import datetime as dt

    by_account: dict[str, list[dict]] = defaultdict(list)
    for t in db_transactions:
        aid = t.get("account_id")
        if aid:
            by_account[aid].append(t)

    pairs = set()
    account_ids = list(by_account.keys())
    for i, aid_a in enumerate(account_ids):
        for aid_b in account_ids[i + 1 :]:  # noqa: E203
            outgoings = [(t, float(t.get("amount", 0) or 0)) for t in by_account[aid_a] if float(t.get("amount", 0) or 0) < 0]
            incomings = [(t, float(t.get("amount", 0) or 0)) for t in by_account[aid_b] if float(t.get("amount", 0) or 0) > 0]
            for tout, amt_out in outgoings:
                for tin, amt_in in incomings:
                    if abs(abs(amt_out) - amt_in) < 0.02:  # epsilon for float
                        dout = tout.get("date")
                        din = tin.get("date")
                        if dout and din:
                            try:
                                d1 = dt.strptime(str(dout)[:10], "%Y-%m-%d").date()
                                d2 = dt.strptime(str(din)[:10], "%Y-%m-%d").date()
                                if abs((d1 - d2).days) <= 3:
                                    tid_out, tid_in = tout.get("id"), tin.get("id")
                                    if tid_out and tid_in:
                                        pairs.add((tid_out, tid_in))
                            except (ValueError, TypeError):
                                pass
            outgoings_b = [(t, float(t.get("amount", 0) or 0)) for t in by_account[aid_b] if float(t.get("amount", 0) or 0) < 0]
            incomings_a = [(t, float(t.get("amount", 0) or 0)) for t in by_account[aid_a] if float(t.get("amount", 0) or 0) > 0]
            for tout, amt_out in outgoings_b:
                for tin, amt_in in incomings_a:
                    if abs(abs(amt_out) - amt_in) < 0.02:
                        dout, din = tout.get("date"), tin.get("date")
                        if dout and din:
                            try:
                                d1 = dt.strptime(str(dout)[:10], "%Y-%m-%d").date()
                                d2 = dt.strptime(str(din)[:10], "%Y-%m-%d").date()
                                if abs((d1 - d2).days) <= 3:
                                    tid_out, tid_in = tout.get("id"), tin.get("id")
                                    if tid_out and tid_in:
                                        pairs.add((tid_out, tid_in))
                            except (ValueError, TypeError):
                                pass
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
    name = f"{provider} – {account_number}" if provider and account_number else "Imported Statements"
    plaid_type = get_plaid_type(account_subtype) or "depository"
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
        "date": str(t.get("date", "")) if t.get("date") else "",
        "description": _strip_date_prefix_from_description(t.get("description") or t.get("clean_merchant")),
        "amount": float(t.get("amount", 0)),
        "category": t.get("category"),
        "tags": t.get("tags") or [],
        "is_transfer": t.get("is_transfer", False),
        "needs_review": t.get("needs_review", False),
        "currency": (t.get("currency") or "CAD").strip() or "CAD",
    }


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
                "storage_path": None,
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

            for txn in txns:
                raw_date = txn.get("date")
                norm_date = _normalize_date_for_db(raw_date)
                if not norm_date:
                    continue
                desc = _strip_date_prefix_from_description(txn.get("description"))
                amount = txn.get("amount", 0)
                txn_row = {
                    "user_id": user_id,
                    "account_id": account_id,
                    "statement_id": statement_id,
                    "date": norm_date,
                    "description": desc,
                    "clean_merchant": txn.get("clean_merchant"),
                    "amount": amount,
                    "category": txn.get("category"),
                    "is_fixed_cost": txn.get("is_fixed_cost", False),
                    "needs_review": txn.get("needs_review", False),
                    "currency": currency,
                }
                all_txn_rows.append(txn_row)

        # Pre-query existing transactions to count and skip duplicates (per account)
        duplicates_skipped = 0
        rows_to_upsert = all_txn_rows
        if all_txn_rows:
            account_ids_in_batch = list({r["account_id"] for r in all_txn_rows})
            batch_dates = [r["date"] for r in all_txn_rows]
            min_d, max_d = min(batch_dates), max(batch_dates)
            existing_sigs_by_account = {}
            for aid in account_ids_in_batch:
                existing = supabase.table("transactions").select("date,amount,description").eq(
                    "account_id", aid
                ).gte("date", min_d).lte("date", max_d).execute()
                existing_sigs_by_account[aid] = {
                    (str(r["date"]), round(float(r["amount"] or 0), 2), r.get("description") or "")
                    for r in (getattr(existing, "data", None) or [])
                }
            rows_to_upsert = []
            for row in all_txn_rows:
                aid = row["account_id"]
                sig = (row["date"], round(float(row["amount"] or 0), 2), row.get("description") or "")
                if existing_sigs_by_account.get(aid, set()) and sig in existing_sigs_by_account[aid]:
                    duplicates_skipped += 1
                else:
                    rows_to_upsert.append(row)
                    if aid not in existing_sigs_by_account:
                        existing_sigs_by_account[aid] = set()
                    existing_sigs_by_account[aid].add(sig)

        # Upsert transactions (ignore duplicates to avoid overwriting)
        for txn_row in rows_to_upsert:
            supabase.table("transactions").upsert(
                txn_row,
                on_conflict="account_id,date,amount,description",
                ignore_duplicates=True,
            ).execute()

        # Fetch all user transactions and run transfer detection
        tx_resp = supabase.table("transactions").select("*").eq("user_id", user_id).execute()
        db_transactions = getattr(tx_resp, "data", None) or []
        transfer_pairs = _detect_internal_transfers(db_transactions, user_id)
        transfer_ids = set()
        for tid_out, tid_in in transfer_pairs:
            transfer_ids.add(tid_out)
            transfer_ids.add(tid_in)
        for tid in transfer_ids:
            supabase.table("transactions").update({"is_transfer": True}).eq("id", tid).eq("user_id", user_id).execute()

        tx_resp = supabase.table("transactions").select("*").eq("user_id", user_id).order("date", desc=False).execute()
        db_transactions = getattr(tx_resp, "data", None) or []
        all_transactions = [_db_txn_to_analysis(t) for t in db_transactions]
        analysis = analyze_transactions(all_transactions)

        processing_summary = {
            "transactions_categorized": cat_count,
            "flagged_for_review": flagged_count,
            "duplicates_skipped": duplicates_skipped,
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

        analysis = analyze_transactions(all_transactions)
        return {"statements": statements, "transactions": all_transactions, "analysis": analysis}
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

        analysis = analyze_transactions(all_transactions)
        return {"statements": statements, "transactions": all_transactions, "analysis": analysis}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)
