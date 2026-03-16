# Two-Dimensional Ledger: Tags (DB, Backend, Frontend)

## Overview

Add a flexible tags dimension to transactions (strict categories + user-defined tags) with a new DB column, a Supabase RPC for performant tag extraction, PATCH endpoint for tags with strict normalization, and a creatable autocomplete UI in the Data Editor. Bulk uncategorised update propagates tags from the edited row to all matching transactions.

---

## 1. Database schema (Supabase / PostgreSQL)

**New migration file:** `supabase/migrations/20250315150000_transactions_tags.sql`

### 1.1 Add `tags` column

```sql
alter table public.transactions
  add column if not exists tags text[] not null default '{}';
```

- `default '{}'` so every row has an array; no NULLs simplifies backend/frontend logic.
- No RLS change: existing policy "Users can manage own transactions" already scopes by `user_id`.

### 1.2 Supabase RPC for performant tag extraction

Instead of pulling all transactions into Python and flattening in memory (which degrades badly at 2k+ transactions), push the work to Postgres via an RPC:

```sql
create or replace function get_unique_user_tags(p_user_id uuid)
returns table(tag text) language sql stable security definer as $$
  select distinct unnest(tags) as tag
  from public.transactions
  where user_id = p_user_id
  order by tag;
$$;
```

- `stable` + `security definer` so the function runs with owner privileges and Postgres can optimize it.
- Returns a flat, sorted, deduplicated list of tags directly from the DB, regardless of transaction count.

---

## 2. Backend (FastAPI)

### 2.1 Tag normalization utility

**Location:** New file `api/utils/tags.py`

- Strip leading/trailing `#` and whitespace per tag; lowercase; drop empty strings after cleanup.
- Deduplicate (preserve insertion order).
- Enforce max length per tag (64 chars) and allow only safe characters (letters, numbers, hyphens, underscores).

```python
import re

def normalize_tags(tags: list[str] | None) -> list[str]:
    if not tags:
        return []
    seen = set()
    result = []
    for raw in tags:
        t = re.sub(r'^#+', '', str(raw).strip()).strip().lower()
        t = re.sub(r'[^\w-]', '', t, flags=re.UNICODE)
        if t and len(t) <= 64 and t not in seen:
            seen.add(t)
            result.append(t)
    return result
```

- `\w` with `re.UNICODE` matches letters (including accented: `é`, `ç`, `ñ`, etc.), digits, and underscores. Combined with `-`, this keeps multilingual tags intact while stripping dangerous symbols, spaces, and emojis.

Use in every endpoint that writes `tags` (single PATCH, bulk update, and any future import).

### 2.2 GET /api/tags (via RPC)

**Location:** [api/index.py](api/index.py)

- Auth: `_get_user_from_token(authorization)`.
- Call the RPC: `supabase.rpc('get_unique_user_tags', {'p_user_id': user_id}).execute()`.
- Return `{"tags": [row["tag"] for row in resp.data]}`.
- This returns instantly regardless of transaction count.

### 2.3 PATCH /api/transactions/{transaction_id}/tags

- Body: `{"tags": ["tag1", "tag2", ...]}`.
- Resolve user, ensure transaction exists and belongs to user, run `normalize_tags()`, update row, return updated transaction (with `tags` in shape from `_db_txn_to_analysis`).

### 2.4 Include `tags` in transaction payloads

- In `_db_txn_to_analysis` ([api/index.py](api/index.py) ~line 587): add `"tags": t.get("tags") or []`.
- All responses that return transactions (user_data, category patch, tags patch, bulk update, save_analysis, delete statement, rerun_analysis) will then include `tags`.

### 2.5 Bulk update: propagate tags

**Extend PATCH /api/transactions/bulk-update-category** ([api/index.py](api/index.py) ~line 733):

- **Payload:** Add optional `tags` array: `{"description": "...", "category": "...", "tags": ["tag1", "tag2"]}`.
- **Logic:** When `tags` is present in the payload, run `normalize_tags(payload["tags"])` and set `tags` on every matched row alongside `category` + `needs_review`. When `tags` is absent, leave existing tags on matched rows untouched (backward compatible).
- **Response:** Unchanged shape (updated_count, transactions); returned transactions include `tags` via `_db_txn_to_analysis`.

---

## 3. Frontend (Creatable auto-suggest for tags)

### 3.1 Data flow

- **Load:** Transactions include `tags` from GET /api/user_data (once backend returns them via `_db_txn_to_analysis`).
- **Suggestions:** GET /api/tags (with auth) populates `availableTags` state.
- **Save single row:** PATCH /api/transactions/{id}/tags with `{ "tags": [...] }`.
- **Bulk save:** PATCH /api/transactions/bulk-update-category with `description`, `category`, and `tags`.

### 3.2 Optimistic local tag state ("Domino Effect" fix)

When a user creates a brand-new tag (e.g. `ski-trip`) on Row 1, that tag must immediately be available in the dropdown when they click Row 2, without waiting for a refetch or page reload.

- In the `onChange` handler of the Creatable input: if a new tag is created (i.e. it's not in `availableTags`), **optimistically append** it to the `availableTags` React state immediately, in parallel with the PATCH request.
- This ensures new tags are available in all subsequent tag edits within the same session, no round-trip required.

### 3.3 Bulk prompt: include tags

- When opening the bulk prompt (after user sets category on one transaction), capture that row's **current tags** (after any in-memory edit).
- On "Yes, update all", call bulk-update-category with `description`, `category`, and `tags` (the template row's tags).
- If the user hasn't edited tags on that row, send the existing `tags` (or `[]`); all similar rows get the same category and tags.

### 3.4 TransactionTagInput component + dark-mode theming

**New file:** `frontend/src/components/TransactionTagInput.js`

- Uses `react-select/creatable` (Creatable).
- Must use the react-select `styles` or `classNames` API to override the default white theme. The dropdown menu, input background, multi-value chips, and text must match the dark-mode palette of DataEditorTab.css (dark navy backgrounds, amber/gold accents, light text). No bright-white flash.
- Accepted props: `value` (current tags), `options` (availableTags), `onChange`, `onCreateOption`.

### 3.5 Tags column in Data Editor

**File:** [frontend/src/pages/dashboard/DataEditorTab.js](frontend/src/pages/dashboard/DataEditorTab.js)

- Add a **Tags** column after Category.
- **Read mode:** Show tags as small chips (or comma-separated).
- **Edit mode (on click):** Render `<TransactionTagInput>` with suggestions from `availableTags` state.
- On blur/change: PATCH that transaction's tags; optimistically update local state and `availableTags`.

---

## 4. Implementation order

1. **Migration:** Add `tags` column + `get_unique_user_tags` RPC.
2. **Backend:** `normalize_tags()` utility; `_db_txn_to_analysis` includes tags; PATCH .../tags endpoint; GET /api/tags (via RPC); extend bulk-update-category with optional `tags`.
3. **Frontend:** Install react-select; `TransactionTagInput` component (dark-themed); Tags column in DataEditorTab; GET /api/tags + `availableTags` state with optimistic append; PATCH tags on edit; bulk prompt sends `tags`.

---

## 5. Files to add or touch

- **DB:** `supabase/migrations/20250315150000_transactions_tags.sql` -- migration (column + RPC)
- **Backend:** `api/utils/tags.py` -- new: `normalize_tags()`
- **Backend:** `api/index.py` -- GET /api/tags (RPC); PATCH .../tags; `_db_txn_to_analysis` + tags; bulk-update-category + tags
- **Frontend:** `frontend/src/components/TransactionTagInput.js` -- new: creatable tag input (dark-themed)
- **Frontend:** `frontend/src/pages/dashboard/DataEditorTab.js` -- Tags column, fetch tags, optimistic state, PATCH, bulk payload
- **Frontend:** `frontend/src/pages/dashboard/DataEditorTab.css` -- tag chip and input styles
- **Frontend:** `frontend/package.json` -- add react-select dependency
