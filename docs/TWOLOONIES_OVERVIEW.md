# TwoLoonies (TwoLooniesV2) — product and technical overview

Use this document as context for AI prompts or onboarding. Prefix with: *“Context: I’m working on the TwoLooniesV2 codebase. Use the following as ground truth unless the repo contradicts it.”*

**Features shipped, roadmap, and beta checklist:** [FEATURE_ROADMAP.md](./FEATURE_ROADMAP.md)

## What it is

**TwoLoonies** is a **Canadian-oriented personal finance web app** (repo/package name `two-loonies`) that helps users **import bank/investment data**, **normalize it into a structured ledger**, and **explore it in a dashboard**: overview, **wealth** (accounts, balances, holdings), **cash flow** (income/expense-style analysis, charts), **data editor** (transactions, categories, tags), and **profile**. The experience is built around **PDF statement upload** and parsing, with **Plaid** wired in for linking (currently using **Plaid Sandbox** and **Canada** as the country code). Branding in code refers to a “Canada Wealth Dashboard” style product.

## Architecture (high level)

| Layer | Technology |
|--------|------------|
| **Frontend** | **Create React App** (`react-scripts`), **React 19**, **React Router 7**, **Tailwind CSS**, **Axios**, **@supabase/supabase-js**, **react-plaid-link**, **Nivo** (`@nivo/sankey`, `@nivo/core`), **lucide-react**, **react-select** |
| **Backend** | **FastAPI** in `api/index.py`, served on **Vercel** with rewrite `/api/*` → `api/index.py` (`vercel.json`) |
| **Database & auth** | **Supabase** (Postgres + Row Level Security + Auth). Backend uses **service/secret key** via `api/supabase_client.py` for admin-style operations |
| **File storage** | **Supabase Storage** bucket (default name from env `STATEMENT_PDF_BUCKET`, often `statement-pdfs`) for uploaded PDFs |
| **Async jobs** | **Redis** (`REDIS_URL`, default `redis://localhost:6379`) stores upload **job state** (JSON, **1h TTL**) for PDF pipeline progress and final JSON result |
| **AI / parsing** | **Google Gemini** (env `GOOGLE_API_KEY` or `GEMINI_API_KEY`), **Instructor** for structured output, optional **Docling** (local or remote on Vercel via `requirements-vercel.txt` + `DOCLING_MODE` / `DOCLING_SERVICE_URL`) |

Local dev: frontend **`package.json`** sets **`"proxy": "http://localhost:8000"`** so CRA can talk to a local API; root **`npm run build`** builds the frontend into **`public/`** for static hosting alongside the API.

## PDF statement pipeline (technical)

1. **Text extraction**: `pdfplumber`-based **`pdf_to_structured_text`** (`api/parsers/pdfplumber_parser.py`) runs in a **thread** so the event loop is not blocked.
2. **Structured extraction**: **`extract_statement_from_structured_text`** uses Gemini to produce a **`StatementExtraction`** (`api/parsers/schema.py`): metadata (provider, account id, opening/closing balance, currency, dates, account type), **transactions**, and **holdings**.
3. **Post-processing**:
   - Strips fake “opening/closing balance” lines from transaction lists.
   - **Non–credit-card**: **running-balance–based sign correction** (subset-sum for small groups) and verification walk.
   - **Credit card**: **deterministic sign rules** from `transaction_type` plus keyword overrides (`payment` vs `credit`/`refund`).
   - Optional validation: **opening + sum(txns) ≈ closing** (with credit-specific convention flips).
4. **Retry ladder**: If validation fails, a **second Gemini pass** runs; if still failing, **Docling markdown + LLM** (Pass 3) may run.
5. **Parser registry** (`api/parsers/registry.py`): `STATEMENT_PARSER` ∈ `{docling, gemini_native, pdfplumber}`; default **`pdfplumber`**; supports **`parser_override`** for future tiering.
6. **Categorization**: After extraction, **`_apply_categorization`** runs on the combined transaction list; **`analyze_transactions`** builds summary stats for the response.

**Scanned PDFs** with no extractable text fail with a clear error (“OCR is coming soon”).

## API surface (representative)

- **Upload (async)**: `POST /api/upload_statement` → `{ job_id }`; `GET /api/upload_statement_status/{job_id}`; `GET /api/upload_statement_result/{job_id}`.
- **Legacy sync**: `POST /api/upload_statement_old`.
- **Plaid**: `POST /api/create_link_token`, `POST /api/exchange_public_token` (Sandbox config in code).
- **Data**: `GET /api/user_data`, `GET /api/accounts_with_balances`, `GET /api/holdings`, `POST /api/save_statements`, `DELETE /api/statements/{statement_id}`, bulk delete, `POST /api/transactions`, `POST /api/analyze_transactions`, `POST /api/rerun_analysis`, `POST /api/detect-internal-transfers`.
- **Editing**: `PATCH` on transaction **category** and **tags**, bulk category patch.
- **Reference data**: `GET /api/categories` (public JSON), `GET /api/tags` (auth, uses RPC **`get_unique_user_tags`**).
- **Test**: `POST /api/v1/test-native-pdf-parse`.

## Authentication on the API

**`_get_user_from_token`**: `Authorization: Bearer <jwt>`. Prefers **JWKS** from `{SUPABASE_URL}/auth/v1/.well-known/jwks.json` with **RS256/ES256** and audience **`authenticated`**; falls back to **`SUPABASE_JWT_SECRET`** with **HS256**.

## Data model (Supabase / Postgres)

Evolved from early JSON blobs to a **columnar, “event-driven ledger”** style:

- **`profiles`**: extends `auth.users` (display name, optional birth date, province, address in later migrations).
- **`accounts`**: metadata only; **`account_type`** = Plaid top-level (`depository`, `investment`, `credit`, `loan`); **`account_subtype`** = Canadian product name (Chequing, TFSA, RRSP, Credit Card, etc.); provider, account number, etc.
- **`user_statements`**: metadata per PDF (filename, `storage_path`, dates, provider, `account_id`); balances/currency moved out to dedicated tables.
- **`transactions`**: `date`, `description`, `amount`, `category`, flags (`is_duplicate`, `is_transfer`, `is_fixed_cost`, `needs_review`), **`tags text[]`**, **`linked_transaction_id`**, **`occurrence_index`** with unique constraint **`(account_id, date, amount, description, occurrence_index)`** to allow identical same-day duplicates.
- **`balances`**: point-in-time **account** value (`amount`, `currency`, `date`, optional `statement_id`).
- **`holdings`**: positions (symbol, quantity, prices, `is_cash_equivalent`, etc.) keyed to account/statement/date.

**RLS**: Users can only access rows where **`auth.uid() = user_id`** (or profile id) on the relevant tables.

## Frontend structure

- **`App.js`**: Providers **`AuthProvider`**, **`AnalysisProvider`**, **`UploadProvider`**; routes `/`, `/analysis`, `/reset-password`, protected `/dashboard` with nested tabs (**Dashboard**, **Wealth**, **Cashflow**, **Data editor**, **Profile**).
- **Supabase client** in `frontend/src/lib/supabase.js` (pattern: anon key in browser).
- **Upload flow** uses context + modal; polling Redis-backed job endpoints.

## Operations and environment

- **Logging**: `logs/statement_uploads.log` on non-Vercel; on Vercel, file logging skipped (read-only FS).
- **Env vars** (non-exhaustive): Supabase URL/keys, JWT secret, Gemini/Google keys, Redis URL, Plaid client/secret, statement parser choice, optional Docling remote URL, storage bucket name.

## Testing

Python tests under **`tests/`** (e.g. running balance validation, occurrence index, priority rules, parser benchmarks). Frontend uses CRA’s Jest/RTL setup.
