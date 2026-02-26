"""
Transaction analysis: income vs expenses, cash flow, categories, top merchants.
Works with both Plaid and PDF-parsed transactions in common format.
"""
from collections import defaultdict
from datetime import datetime
from typing import Any


# Simple heuristics for categorizing by description (when Plaid category not available)
CATEGORY_KEYWORDS = {
    "Food & Dining": ["restaurant", "cafe", "coffee", "uber eats", "doordash", "food", "groceries", "superstore", "loblaws", "sobeys", "metro", "tim horton", "mcdonald", "starbucks"],
    "Shopping": ["amazon", "walmart", "costco", "best buy", "ebay", "etsy", "store", "shop"],
    "Transportation": ["gas", "petro", "esso", "shell", "uber", "lyft", "parking", "transit", "go transit", "ttc", "presto"],
    "Bills & Utilities": ["hydro", "enbridge", "bell", "rogers", "telus", "internet", "electric", "water", "insurance"],
    "Entertainment": ["netflix", "spotify", "disney", "hulu", "apple tv", "prime video", "crave", "hbo", "youtube premium", "gaming", "steam", "playstation", "xbox"],
    "Travel": ["air canada", "westjet", "expedia", "booking.com", "hotel", "marriott", "airbnb", "airline", "flight", "ticket", "kayak", "trip.com"],
    "Income": ["payroll", "deposit", "transfer in", "direct deposit", "salary", "employment"],
    "Transfer": ["transfer", "etransfer", "e-transfer"],
}


def _infer_category(description: str) -> str:
    desc_lower = (description or "").lower()
    for category, keywords in CATEGORY_KEYWORDS.items():
        if any(kw in desc_lower for kw in keywords):
            return category
    return "Other"


def analyze_transactions(transactions: list[dict[str, Any]]) -> dict[str, Any]:
    """
    Compute detailed analysis from transaction list.
    Each transaction: { date, description, amount, category? (optional, from Plaid) }
    """
    if not transactions:
        return {
            "total_income": 0,
            "total_expenses": 0,
            "cash_flow": 0,
            "by_category": {},
            "top_merchants": [],
            "cash_flow_by_month": {},
            "transaction_count": 0,
        }

    total_income = 0.0
    total_expenses = 0.0
    by_category: dict[str, float] = defaultdict(float)
    by_merchant: dict[str, float] = defaultdict(float)
    by_month: dict[str, float] = defaultdict(float)

    for t in transactions:
        amount = float(t.get("amount", 0))
        desc = (t.get("description") or t.get("name") or "Unknown").strip()
        cat = t.get("category") or _infer_category(desc)
        date_str = t.get("date")
        if amount > 0:
            total_income += amount
        else:
            total_expenses += abs(amount)
        by_category[cat] += abs(amount) if amount < 0 else amount
        if amount < 0:  # expenses count toward merchants
            merchant = _extract_merchant(desc)
            by_merchant[merchant] += abs(amount)
        if date_str:
            month = _month_key(date_str)
            if month:
                by_month[month] += amount

    top_merchants = sorted(
        [{"name": k, "amount": round(v, 2)} for k, v in by_merchant.items()],
        key=lambda x: -x["amount"],
    )[:10]

    by_category_final = {k: round(v, 2) for k, v in by_category.items()}
    by_month_final = {k: round(v, 2) for k, v in sorted(by_month.items())}

    return {
        "total_income": round(total_income, 2),
        "total_expenses": round(total_expenses, 2),
        "cash_flow": round(total_income - total_expenses, 2),
        "by_category": by_category_final,
        "top_merchants": top_merchants,
        "cash_flow_by_month": by_month_final,
        "transaction_count": len(transactions),
    }


def _extract_merchant(description: str) -> str:
    """Simple extraction: use first meaningful part of description."""
    parts = description.split()
    for p in parts:
        p = p.strip(".,-")
        if len(p) > 2 and not p.isdigit():
            return p[:50]
    return description[:50] or "Unknown"


def _month_key(date_str: Any) -> str | None:
    """Convert various date formats to YYYY-MM."""
    if not date_str:
        return None
    s = str(date_str).strip()
    for fmt in ("%Y-%m-%d", "%d/%m/%Y", "%d-%m-%Y", "%Y/%m/%d", "%d %b %Y", "%d %B %Y"):
        try:
            dt = datetime.strptime(s[:10], fmt[:10] if len(fmt) > 10 else fmt)
            return dt.strftime("%Y-%m")
        except ValueError:
            continue
    return None
