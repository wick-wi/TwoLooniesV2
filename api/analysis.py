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


def _normalize_category_name(category: Any) -> str:
    """Normalize category strings for backward compatibility."""
    cat = (category or "").strip()
    if cat == "Reimbursements & Loans":
        return "Loans & Reimbursements"
    return cat


# Categories excluded from headline income/expense unless the row is an orphan leg of a linked pair
# (partner id not in the same transaction list).
EXCLUDE_FROM_CASHFLOW_CATEGORIES = frozenset(
    {
        "Self-Transfer",
        "Credit Card Payment",
        "Loans & Reimbursements",
    }
)


def _skip_for_cashflow_aggregate(t: dict[str, Any], id_set: set[str]) -> bool:
    """Omit paired legs when both are in scope; keep orphan legs visible despite excluded categories."""
    lid = t.get("linked_transaction_id")
    if lid and str(lid) in id_set:
        return True
    cat = _normalize_category_name(t.get("category"))
    if cat not in EXCLUDE_FROM_CASHFLOW_CATEGORIES:
        return False
    if lid and str(lid) not in id_set:
        return False
    return True


# Refund indicators: positive amounts with these in description reduce expenses
REFUND_KEYWORDS = ("refund", "credit adjustment", "reversal", "credit", "reversed", "refunded")


def _is_refund(t: dict[str, Any]) -> bool:
    """True if transaction looks like a refund (positive amount + refund-like description)."""
    amount = float(t.get("amount", 0))
    if amount <= 0:
        return False
    desc = (t.get("description") or t.get("name") or "").lower()
    cat = (t.get("category") or "").lower()
    if "refund" in cat:
        return True
    return any(kw in desc for kw in REFUND_KEYWORDS)


def analyze_transactions(transactions: list[dict[str, Any]]) -> dict[str, Any]:
    """
    Compute detailed analysis from transaction list.
    Omits rows whose linked_transaction_id points at another row in the same list (paired transfer/payment).
    Excluded categories omit rows only when the link partner is present in the list; orphan legs stay in totals.
    Refunds (positive amount + refund-like description) reduce total_expenses.
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

    id_set = {str(t.get("id")) for t in transactions if t.get("id") is not None}

    for t in transactions:
        try:
            amount = float(t.get("amount", 0) or 0)
        except (TypeError, ValueError):
            amount = 0.0
        desc = (t.get("description") or t.get("name") or "Unknown").strip()
        cat = _normalize_category_name(t.get("category")) or _infer_category(desc)
        date_str = t.get("date")

        if _skip_for_cashflow_aggregate(t, id_set):
            continue
        if amount > 0:
            if _is_refund(t):
                total_expenses -= amount
            else:
                total_income += amount
        else:
            total_expenses += abs(amount)
        if not _is_refund(t):
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
