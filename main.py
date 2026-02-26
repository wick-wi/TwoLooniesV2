import json
import logging
import os
import tempfile
from datetime import date, timedelta
from pathlib import Path

# Log to console and file
LOG_DIR = Path(__file__).parent / "logs"
LOG_DIR.mkdir(exist_ok=True)
LOG_FILE = LOG_DIR / "statement_uploads.log"

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    datefmt="%Y-%m-%d %H:%M:%S",
)
file_handler = logging.FileHandler(LOG_FILE, encoding="utf-8")
file_handler.setLevel(logging.INFO)
file_handler.setFormatter(logging.Formatter("%(asctime)s [%(levelname)s] %(name)s: %(message)s", datefmt="%Y-%m-%d %H:%M:%S"))
logging.getLogger().addHandler(file_handler)
logger = logging.getLogger(__name__)
file_logger = logging.getLogger("statement_upload_file")
file_logger.addHandler(file_handler)
file_logger.setLevel(logging.INFO)
file_logger.propagate = False

from fastapi import FastAPI, Body, File, UploadFile, Header, HTTPException, Request
from fastapi.middleware.cors import CORSMiddleware
from dotenv import load_dotenv
# This tells Python: "Find the folder this script is in, and look for .env right there."
env_path = Path(__file__).parent / ".env"
load_dotenv(dotenv_path=env_path)

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

from analysis import analyze_transactions
from pdf_parser import parse_statement
try:
    from supabase_client import supabase
except ImportError:
    supabase = None

load_dotenv()

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://127.0.0.1:3000"],
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
        'plaidVersion': '2020-09-14' # Adding the explicit version helps too
    }
)
api_client = plaid.ApiClient(configuration)
client = plaid_api.PlaidApi(api_client)

@app.get("/")
def read_root():
    return {"message": "Backend is running!"}

@app.post("/api/create_link_token")
async def create_link_token():
    try:
        request = LinkTokenCreateRequest(
            products=[Products('transactions')],
            country_codes=[CountryCode('CA')], # Specifically for Canada
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
        # This is the "Magic" step: Swapping the temporary token for a permanent key
        exchange_request = ItemPublicTokenExchangeRequest(
            public_token=public_token
        )
        exchange_response = client.item_public_token_exchange(exchange_request)
        
        # In a real app, you would save this 'access_token' to a database
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
    # Accept both "statements" (plural) and "statement" (single, legacy)
    statements = form.getlist("statements") or form.getlist("statement")
    statements = [s for s in statements if s and hasattr(s, "read")]

    if not statements:
        return {"error": "At least one PDF file is required"}
    if len(statements) > MAX_STATEMENTS:
        return {"error": f"Maximum {MAX_STATEMENTS} statements allowed"}

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
                transactions = parse_statement(tmp_path)
            finally:
                Path(tmp_path).unlink(missing_ok=True)
            logger.info("Parsed %d transactions from %s", len(transactions), fname)
            all_transactions.extend(transactions)
            files_breakdown.append({"filename": fname, "transactions": transactions})
        except Exception as e:
            logger.exception("Failed to parse %s: %s", fname, e)
            return {"error": f"Failed to parse '{fname}': {str(e)}"}

    transactions = all_transactions
    logger.info("Total transactions across all statements: %d", len(transactions))
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

    return {"transactions": transactions, "analysis": analysis, "source": "pdf", "files": files_breakdown}


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
    # Our format: + = income, - = expense
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
        # Plaid returns dict-like with 'transactions' key
        raw = resp.to_dict() if hasattr(resp, "to_dict") else dict(resp)
        plaid_txns = raw.get("transactions", [])
        transactions = [_plaid_to_common(t) for t in plaid_txns]
        analysis = analyze_transactions(transactions)
        return {"transactions": transactions, "analysis": analysis, "source": "plaid"}
    except plaid.ApiException as e:
        return {"error": str(e)}


def _get_user_from_token(authorization: str = None):
    """Extract and verify Supabase JWT, return user_id. Supports both JWKS (ES256/RS256) and legacy HS256."""
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=401, detail="Missing or invalid Authorization header")
    token = authorization.split(" ")[1]
    supabase_url = os.getenv("SUPABASE_URL")
    jwks_url = f"{supabase_url.rstrip('/')}/auth/v1/.well-known/jwks.json" if supabase_url else None

    try:
        # New Supabase projects use ES256/RS256 with JWKS
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

    # Fallback: legacy HS256 with JWT secret (older Supabase projects)
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
    """Save analysis to Supabase. Requires Bearer token from Supabase Auth."""
    user_id = _get_user_from_token(authorization)
    if not supabase:
        raise HTTPException(status_code=500, detail="Database not configured")
    source = payload.get("source", "pdf")
    summary = payload.get("summary", {})
    access_token = payload.get("access_token")
    try:
        supabase.table("analyses").insert({
            "user_id": user_id,
            "source": source,
            "summary": summary,
        }).execute()
        if access_token:
            item_id = payload.get("item_id") or "unknown"
            supabase.table("plaid_items").upsert({
                "user_id": user_id,
                "access_token": access_token,
                "item_id": item_id,
            }, on_conflict="user_id").execute()
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
    return {"status": "saved"}


@app.get("/api/user_data")
async def get_user_data(authorization: str = Header(None, alias="Authorization")):
    """Fetch user's saved statements and computed analysis. Requires Bearer token."""
    user_id = _get_user_from_token(authorization)
    if not supabase:
        raise HTTPException(status_code=500, detail="Database not configured")
    try:
        resp = supabase.table("user_statements").select("*").eq("user_id", user_id).order("created_at", desc=False).execute()
        statements = resp.data or []
        all_transactions = []
        for s in statements:
            txns = s.get("transactions") or []
            if isinstance(txns, list):
                all_transactions.extend(txns)
            else:
                all_transactions.extend(txns) if hasattr(txns, "__iter__") else []
        analysis = analyze_transactions(all_transactions)
        return {"statements": statements, "transactions": all_transactions, "analysis": analysis, "source": "pdf"}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/save_statements")
async def save_statements(
    payload: dict = Body(...),
    authorization: str = Header(None, alias="Authorization"),
):
    """Save uploaded statement(s) to Supabase. Each PDF = one row with filename + transactions."""
    user_id = _get_user_from_token(authorization)
    if not supabase:
        raise HTTPException(status_code=500, detail="Database not configured")
    items = payload.get("statements", [])
    if not isinstance(items, list) or not items:
        raise HTTPException(status_code=400, detail="statements must be a non-empty list of {filename, transactions}")
    try:
        rows = []
        for item in items:
            fn = item.get("filename") or "statement.pdf"
            txns = item.get("transactions") or []
            if not isinstance(txns, list):
                txns = []
            rows.append({"user_id": user_id, "filename": fn, "transactions": txns})
        supabase.table("user_statements").insert(rows).execute()
        all_transactions = []
        for r in rows:
            all_transactions.extend(r["transactions"])
        analysis = analyze_transactions(all_transactions)
        return {"status": "saved", "analysis": analysis, "transactions": all_transactions}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.delete("/api/statements/{statement_id}")
async def delete_statement(statement_id: str, authorization: str = Header(None, alias="Authorization")):
    """Delete a statement by id. Recompute and return updated analysis."""
    user_id = _get_user_from_token(authorization)
    if not supabase:
        raise HTTPException(status_code=500, detail="Database not configured")
    try:
        supabase.table("user_statements").delete().eq("id", statement_id).eq("user_id", user_id).execute()
        resp = supabase.table("user_statements").select("*").eq("user_id", user_id).order("created_at", desc=False).execute()
        statements = resp.data or []
        all_transactions = []
        for s in statements:
            txns = s.get("transactions") or []
            if isinstance(txns, list):
                all_transactions.extend(txns)
        analysis = analyze_transactions(all_transactions)
        return {"statements": statements, "transactions": all_transactions, "analysis": analysis}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


@app.post("/api/rerun_analysis")
async def rerun_analysis(authorization: str = Header(None, alias="Authorization")):
    """Recompute analysis from all saved statements (no changes to statements)."""
    user_id = _get_user_from_token(authorization)
    if not supabase:
        raise HTTPException(status_code=500, detail="Database not configured")
    try:
        resp = supabase.table("user_statements").select("*").eq("user_id", user_id).order("created_at", desc=False).execute()
        statements = resp.data or []
        all_transactions = []
        for s in statements:
            txns = s.get("transactions") or []
            if isinstance(txns, list):
                all_transactions.extend(txns)
        analysis = analyze_transactions(all_transactions)
        return {"statements": statements, "transactions": all_transactions, "analysis": analysis}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=8000)