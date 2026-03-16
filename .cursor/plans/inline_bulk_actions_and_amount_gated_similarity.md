# Inline Smart Actions + Amount-Gated Similarity

## 1. UI: Inline "Smart Actions" (zero layout shift)

**Current behavior** ([DataEditorTab.js](frontend/src/pages/dashboard/DataEditorTab.js)):
- When `pendingBulkAction` is set, a **full-width extra table row** (`data-editor-bulk-prompt-row`) is rendered below the edited row with "We found N other transactions... Apply X and tags to all? [Yes / Dismiss]".
- If that row is not visible (e.g. filtered out), a **fallback glass-card** is shown below the table (lines 720–748).
- Both cause layout shift and take significant space.

**Target behavior**:
- **No extra row and no fallback card.** Remove both.
- **Inline control on the edited row:** Add a small "Bulk Action" group on the **far right** of the same row (recommended: dedicated column so width is fixed and there is zero shift).
- **Content when `pendingBulkAction.transactionId === tx.id`:**
  - **Icon:** Bright, noticeable icon (e.g. Sparkles / Zap from `lucide-react`) next to the edited cell (Category or a new Actions column).
  - **Tooltip:** On hover, show dynamic text: e.g. `Apply Housing and #waterloo-condo to 3 similar transactions` (category + tags + count; shorten if only category or only tags).
  - **Dismiss:** Grey "x" (e.g. `X` from lucide-react) next to the icon; click clears `pendingBulkAction` (same as current "Dismiss").
  - **Apply:** Clicking the icon (or a small "Apply" next to it) triggers `handleBulkUpdateYes` (same as "Yes, update all").

**Implementation outline**:
- **Table:** Add a 6th column (e.g. "Actions") with fixed width, always rendered so layout is stable. Empty for rows that don't have a pending bulk action.
- **Row content:** In the Actions cell for the row where `pendingBulkAction.transactionId === tx.id`, render: `[Icon with tooltip] [X]` and optionally a small "Apply" button (or make the icon clickable for apply). Use `title` or a proper tooltip component for the dynamic text.
- **Remove:** The `<tr className="data-editor-bulk-prompt-row">` block (lines 682–711) and the fallback `pendingBulkAction && !displayTransactions.some(...)` block (720–748).
- **CSS:** Style the icon (e.g. amber/gold for "smart action"), subtle grey "x", and tight spacing so the control sits neatly in the cell. Reuse or trim [DataEditorTab.css](frontend/src/pages/dashboard/DataEditorTab.css) bulk-prompt styles as needed (e.g. for an optional small "Apply" button in the cell).

**State and handlers:** No change to `pendingBulkAction` shape for the UI-only work; only where it's rendered and how dismiss/apply are triggered (same `handleBulkUpdateNo` / `handleBulkUpdateYes`).

---

## 2. Backend: Amount-gated similarity (e-transfer vs standard)

**Current behavior** ([api/index.py](api/index.py)):
- **PATCH category** (lines 719–734) and **PATCH tags** (794–801) both use a single similarity rule: build `ilike_pattern` from `_description_to_ilike_pattern(desc)` and find other transactions with `.ilike("description", ilike_pattern)` (and needs_review or uncategorised). Amount is ignored.
- **bulk-update-category** (851–858) uses the same: match by `description` ILIKE only.

**Problem:** For e-transfers, the memo is stripped so many transactions share the same (or very similar) description. Grouping by description only pulls in unrelated amounts (e.g. $15 pizza and $2,200 rent).

**Target behavior – two paths**:

- **Path A – Standard vendors (e.g. "Netflix", "Sage II"):**  
  Keep current behavior: match by **description pattern only** (ILIKE from `_description_to_ilike_pattern`), **ignore amount** (subscription/condo fee can vary slightly).

- **Path B – Generic e-transfers:**  
  When the transaction's description indicates an e-transfer (e.g. contains `e-transfer` or `etransfer`, case-insensitive), **do not** use the generic ILIKE pattern for "similar" logic. Instead match by:
  - **Description:** Use a single canonical pattern that matches any e-transfer (e.g. `ILIKE '%e-transfer%' OR ILIKE '%etransfer%'`), and
  - **Amount (float-safe):** Do **not** use strict `.eq("amount", amount)` for floating-point money. To avoid floating-point drift, define a tiny buffer in Python (e.g. `AMOUNT_BUFFER = 0.01`). Then use a tight range in the Supabase query: `.gte("amount", amount - buffer).lte("amount", amount + buffer)`. This safely matches the exact dollar and cent value.

So: $2,200 incoming e-transfer only suggests bulk apply for other $2,200 e-transfers; $1,000 outgoing only for other $1,000 outflows.

**Implementation outline**:

1. **Helper**
   - Add `_is_etransfer(desc: str) -> bool`: return True if `"e-transfer" in desc.lower() or "etransfer" in desc.lower()` (or equivalent).
   - Add a small constant, e.g. `AMOUNT_BUFFER = 0.01`, for amount range matching.
   - Add `_similar_query_etransfer(supabase, user_id, transaction_id, amount)`: query with description ILIKE '%e-transfer%' OR ILIKE '%etransfer%', and **`.gte("amount", amount - AMOUNT_BUFFER).lte("amount", amount + AMOUNT_BUFFER)`** (no strict `.eq("amount", amount)`), and same needs_review/uncategorised filter; return list of matching rows.

2. **PATCH `/api/transactions/{id}/category`**
   - Select `id, description, amount` for the current transaction.
   - After update, if `_is_etransfer(desc)`:
     - Use Path B: run `_similar_query_etransfer(...)` with the row's `amount` (and buffer) to get `similar_ids` / `similar_count`.
     - In the response, include an optional **`similar_amount`** (the amount used for matching) so the frontend can send it to the bulk endpoint.
   - Else (Path A): keep existing logic (ILIKE pattern, no amount).
   - Keep returning `similar_description` (for Path A use current `base`; for Path B you can return a sentinel like `"e-transfer"` or the stripped description so the bulk endpoint still has a description key for validation).

3. **PATCH `/api/transactions/{id}/tags`**
   - Same as category: select `id, description, amount`; if `_is_etransfer(desc)` use Path B and return `similar_amount`; else Path A. No change to response shape beyond adding `similar_amount` when applicable.

4. **PATCH `/api/transactions/bulk-update-category`**
   - Payload: keep required `description`; add optional **`amount`**.
   - If `amount` is present and `_is_etransfer(description)`:
     - Path B: find transactions with same e-transfer description pattern and **amount in range** `[amount - AMOUNT_BUFFER, amount + AMOUNT_BUFFER]` (i.e. `.gte("amount", amount - buffer).lte("amount", amount + buffer)`), then apply category/tags to those (needs_review or uncategorised) as today.
   - Else:
     - Path A: current behavior (match by `_description_to_ilike_pattern(description)` only).

**DB:** No schema change; `transactions` already has `amount`. Use the same numeric type/rounding as elsewhere; the buffer guarantees matching the exact dollar and cent value without relying on float equality.

---

## 3. Frontend: Pass amount for e-transfer bulk update

- When the backend returns **`similar_amount`** in the PATCH category or PATCH tags response, store it in **`pendingBulkAction`** (e.g. `pendingBulkAction = { transactionId, count, description, similar_amount? }`).
- In **`handleBulkUpdateYes`**, when calling `PATCH /api/transactions/bulk-update-category`, include **`amount: pendingBulkAction.similar_amount`** in the payload when `similar_amount != null` (so Path B is used and only same-amount e-transfers are updated).

---

## Summary

| Area | Change |
|------|--------|
| **UI** | Replace full-width bulk row + fallback card with an inline control (icon + tooltip + dismiss, optional Apply) in a fixed-width Actions column on the edited row. |
| **Backend** | Add Path A (description-only) vs Path B (e-transfer: description + amount range using buffer); return `similar_amount` when Path B; bulk endpoint accepts optional `amount` and uses Path B when description is e-transfer and amount provided; use `.gte`/`.lte` with `AMOUNT_BUFFER = 0.01`, never strict `.eq("amount", amount)`. |
| **Frontend** | Store `similar_amount` in `pendingBulkAction`; send `amount` in bulk-update payload when present. |

This yields zero layout shift for the bulk prompt and correct e-transfer grouping (e.g. Waterloo $2,200 only with other $2,200 e-transfers, Calgary $1,000 only with $1,000), with float-safe amount matching.
