"""
Loonie AI chat endpoint.
POST /api/chat  — authenticated (Supabase Bearer JWT)

Request:  { "message": "...", "history": [{"role": "user"|"assistant", "content": "..."}] }
Response: { "reply": "..." }
"""
from __future__ import annotations

import json
import logging
import os
from collections import defaultdict
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from fastapi import Body, Header, HTTPException

_EXCHANGE_RATES_PATH = Path(__file__).resolve().parent / "data" / "exchange_rates.json"


def _load_to_cad_map() -> dict[str, float]:
    """Load static FX rates (1 unit of currency → CAD). Falls back to CAD=1."""
    try:
        data = json.loads(_EXCHANGE_RATES_PATH.read_text(encoding="utf-8"))
        rates = data.get("to_cad", {})
        if isinstance(rates, dict):
            return {k: float(v) for k, v in rates.items() if isinstance(v, (int, float))}
    except Exception:
        pass
    return {"CAD": 1.0}


def _to_cad(amount: float, currency: str, to_cad_map: dict[str, float]) -> float:
    """Convert an amount in the given currency to CAD."""
    ccy = (currency or "CAD").strip().upper()
    rate = to_cad_map.get(ccy, to_cad_map.get("CAD", 1.0))
    return amount * rate

logger = logging.getLogger(__name__)

_GEMINI_CHAT_MODEL_DEFAULT = "gemini-2.5-flash"


def _get_chat_model() -> str:
    return os.environ.get("GEMINI_MODEL_CHAT", _GEMINI_CHAT_MODEL_DEFAULT)


def _fmt_currency(value: float, currency: str = "CAD") -> str:
    try:
        return f"{currency} {value:,.2f}"
    except Exception:
        return str(value)


_LIABILITY_SUBTYPES = {
    "auto_loan", "autoloan", "credit_card", "creditcard", "credit card",
    "heloc", "line_of_credit", "lineofcredit", "line of credit",
    "mortgage", "student_loan", "studentloan", "student loan",
}


def _is_liability(subtype: str) -> bool:
    return (subtype or "").lower().replace(" ", "_") in _LIABILITY_SUBTYPES


def _build_financial_context(
    accounts: list[dict],
    transactions: list[dict],
    balances: list[dict],
) -> str:
    """Build a concise financial snapshot to inject into the system prompt."""
    lines: list[str] = []
    to_cad_map = _load_to_cad_map()

    # ── Pre-compute net worth summary (all amounts converted to CAD) ──────────
    total_assets_cad: float = 0.0
    total_liabilities_cad: float = 0.0

    if accounts:
        for acct in accounts:
            subtype = acct.get("account_subtype") or acct.get("account_type") or ""
            is_liab = _is_liability(subtype)
            for b in (acct.get("balances") or []):
                amt = float(b.get("amount") or 0)
                ccy = (b.get("currency") or "CAD").strip().upper()
                amt_cad = _to_cad(amt, ccy, to_cad_map)
                if is_liab:
                    total_liabilities_cad += abs(amt_cad)
                else:
                    total_assets_cad += amt_cad

    net_worth_cad = total_assets_cad - total_liabilities_cad
    lines.append("## Summary (pre-computed in CAD — use these numbers directly)")
    lines.append(f"- Net Worth: {_fmt_currency(net_worth_cad)}")
    lines.append(f"- Total Assets: {_fmt_currency(total_assets_cad)}")
    lines.append(f"- Total Liabilities: {_fmt_currency(total_liabilities_cad)}")

    # ── Accounts & Balances ──────────────────────────────────────────────────
    if accounts:
        lines.append("\n## Accounts (latest balance per account)")
        for acct in accounts:
            name = acct.get("name") or acct.get("provider") or "Account"
            subtype = acct.get("account_subtype") or acct.get("account_type") or ""
            acct_balances = acct.get("balances") or []
            bal_parts = []
            for b in acct_balances:
                amt = b.get("amount")
                ccy = b.get("currency", "CAD")
                if amt is not None:
                    bal_parts.append(_fmt_currency(float(amt), ccy))
            bal_str = ", ".join(bal_parts) if bal_parts else "no balance data"
            lines.append(f"- {name} ({subtype}): {bal_str}")
    else:
        lines.append("\n## Accounts\nNo accounts linked yet.")

    # ── Spending summary (last 3 months) ─────────────────────────────────────
    if transactions:
        today = datetime.now(tz=timezone.utc)
        current_ym = f"{today.year}-{today.month:02d}"

        monthly: dict[str, float] = defaultdict(float)
        by_category: dict[str, float] = defaultdict(float)
        exclude_cats = {
            "Self-Transfer", "Credit Card Payment",
            "Securities Trading", "E-Transfer",
            "Loans & Reimbursements", "Reimbursements & Loans",
        }

        tx_ids = {str(t.get("id")) for t in transactions if t.get("id") is not None}
        for tx in transactions:
            lid = tx.get("linked_transaction_id")
            if lid is not None and str(lid) in tx_ids:
                continue
            cat = (tx.get("category") or "").strip()
            if cat in exclude_cats:
                continue
            amount = float(tx.get("amount") or 0)
            ym = (tx.get("date") or "")[:7]
            if not ym or ym >= current_ym:
                continue
            if amount < 0:
                monthly[ym] += abs(amount)
                if cat:
                    by_category[cat] += abs(amount)

        sorted_months = sorted(monthly.keys(), reverse=True)[:3]
        if sorted_months:
            lines.append("\n## Monthly Spending (last 3 complete months)")
            for ym in sorted_months:
                lines.append(f"- {ym}: {_fmt_currency(monthly[ym])}")

        if by_category:
            top_cats = sorted(by_category.items(), key=lambda x: -x[1])[:8]
            lines.append("\n## Top Spending Categories (all history)")
            for cat, amt in top_cats:
                lines.append(f"- {cat}: {_fmt_currency(amt)}")

        # Income summary
        total_income: float = 0.0
        for tx in transactions:
            lid = tx.get("linked_transaction_id")
            if lid is not None and str(lid) in tx_ids:
                continue
            cat = (tx.get("category") or "").strip()
            if cat != "Income":
                continue
            amount = float(tx.get("amount") or 0)
            ym = (tx.get("date") or "")[:7]
            if ym and ym < current_ym:
                total_income += amount
        if total_income > 0:
            lines.append(f"\n## Total Income (historical): {_fmt_currency(total_income)}")

    else:
        lines.append("\n## Transactions\nNo transaction history yet.")

    return "\n".join(lines)


_SYSTEM_PROMPT_TEMPLATE = """\
You are Loonie, a concise Canadian personal finance AI inside the TwoLoonies app.

RESPONSE STYLE — follow this exactly:
- Lead with the direct answer in the very first sentence. Never open with "Let me…", "Let's…", "To calculate…", or any other preamble.
- Use the pre-computed numbers from the snapshot below. Do not re-derive or narrate arithmetic.
- Be brief. One sentence for simple questions, a short bullet list for breakdowns.
- You can reference Canadian-specific concepts (TFSA, RRSP, FHSA, OSAP, etc.).
- Never fabricate numbers not in the provided snapshot.

EXAMPLES OF CORRECT RESPONSES:

User: What is my net worth?
Loonie: Your net worth is **CAD 139,234.56** (CAD 142,000 in assets minus CAD 2,766 in liabilities).

User: How much do I spend per month?
Loonie: Your average monthly spending over the last 3 months is **CAD 4,200**.

User: What are my biggest expenses?
Loonie: Your top spending categories are:
- Groceries: CAD 620
- Dining: CAD 410
- Transport: CAD 290

EXAMPLES OF WRONG RESPONSES (never do this):
❌ "Let's calculate your net worth by summing your assets and subtracting your liabilities."
❌ "To find your monthly spend, I'll look at the last 3 months of transactions."
❌ "Based on your financial snapshot, here's the breakdown: [then lists accounts without a total]"

Here is the user's current financial snapshot:

{financial_context}
"""


def register_chat_routes(app: Any) -> None:
    """Register /api/chat on the given FastAPI app."""

    @app.post("/api/chat")
    async def loonie_chat(
        payload: dict = Body(...),
        authorization: str = Header(None, alias="Authorization"),
    ):
        from api.index import _get_user_from_token  # noqa: PLC0415
        from api.supabase_client import supabase  # noqa: PLC0415
        from api.utils.admin_config import get_admin_config_bool  # noqa: PLC0415

        user_id = _get_user_from_token(authorization)

        if not get_admin_config_bool("loonie_ai_enabled", default=True):
            raise HTTPException(
                status_code=503,
                detail="Loonie AI is temporarily unavailable.",
            )

        message = (payload.get("message") or "").strip()
        if not message:
            raise HTTPException(status_code=400, detail="message is required")

        history: list[dict] = payload.get("history") or []

        # ── Fetch user financial data ─────────────────────────────────────────
        accounts: list[dict] = []
        transactions: list[dict] = []
        balances: list[dict] = []

        if supabase:
            try:
                acct_resp = supabase.table("accounts").select(
                    "id, name, account_type, account_subtype, provider"
                ).eq("user_id", user_id).execute()
                raw_accounts = acct_resp.data or []

                # Replicate the same logic as _get_latest_balance_per_account_currency:
                # filter to statement-kind, deduplicate to the latest per account/currency.
                bal_resp = (
                    supabase.table("balances")
                    .select("account_id, amount, currency, date")
                    .eq("user_id", user_id)
                    .eq("balance_kind", "statement")
                    .order("date", desc=True)
                    .execute()
                )
                balances = bal_resp.data or []

                seen_bal: set = set()
                bal_by_account: dict[str, list] = defaultdict(list)
                for b in balances:
                    aid = (str(b.get("account_id") or "")).strip().lower()
                    ccy = (b.get("currency") or "CAD").strip() or "CAD"
                    key = (aid, ccy)
                    if aid and key not in seen_bal:
                        seen_bal.add(key)
                        bal_by_account[aid].append({
                            "amount": float(b.get("amount") or 0),
                            "currency": ccy,
                            "date": str(b["date"]) if b.get("date") else None,
                        })

                for acct in raw_accounts:
                    aid = (str(acct.get("id") or "")).strip().lower()
                    acct["balances"] = bal_by_account.get(aid, [])
                accounts = raw_accounts

                tx_resp = (
                    supabase.table("transactions")
                    .select("id,date,amount,currency,category,description,linked_transaction_id,is_transfer")
                    .eq("user_id", user_id)
                    .order("date", desc=True)
                    .limit(500)
                    .execute()
                )
                transactions = tx_resp.data or []
            except Exception as e:
                logger.warning("Failed to fetch user data for Loonie chat: %s", e)

        # ── Build financial context ───────────────────────────────────────────
        financial_context = _build_financial_context(accounts, transactions, balances)
        system_prompt = _SYSTEM_PROMPT_TEMPLATE.format(financial_context=financial_context)

        # ── Call Gemini ───────────────────────────────────────────────────────
        model_name = _get_chat_model()
        try:
            from google import genai  # noqa: PLC0415
            from google.genai import types  # noqa: PLC0415

            api_key = os.environ.get("GEMINI_API_KEY") or os.environ.get("GOOGLE_API_KEY")
            if not api_key:
                raise HTTPException(status_code=500, detail="AI service not configured")

            client = genai.Client(api_key=api_key)

            # Build conversation contents
            contents: list[types.Content] = []

            for turn in history:
                role = turn.get("role", "user")
                content = turn.get("content", "")
                if role == "assistant":
                    role = "model"
                contents.append(types.Content(role=role, parts=[types.Part(text=content)]))

            # Add current user message
            contents.append(types.Content(role="user", parts=[types.Part(text=message)]))

            response = client.models.generate_content(
                model=model_name,
                contents=contents,
                config=types.GenerateContentConfig(
                    system_instruction=system_prompt,
                    temperature=0.3,
                    max_output_tokens=2048,
                ),
            )

            reply = response.text or "Sorry, I couldn't generate a response. Please try again."
        except HTTPException:
            raise
        except Exception as e:
            logger.error("Gemini chat error: %s", e)
            raise HTTPException(status_code=500, detail=f"AI error: {str(e)}")

        return {"reply": reply}
