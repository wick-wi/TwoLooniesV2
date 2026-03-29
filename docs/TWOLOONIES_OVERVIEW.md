# TwoLoonies (TwoLooniesV2) — product and technical overview

Use this document as context for AI prompts or onboarding. Prefix with: *“Context: I’m working on the TwoLooniesV2 codebase. Use the following as ground truth unless the repo contradicts it.”*

**Beta checklist and historical roadmap notes:** [FEATURE_ROADMAP.md](./FEATURE_ROADMAP.md)

---

## What it is

**TwoLoonies** (“Two Loonies” in the UI) is a **Canadian-oriented personal finance web app** (repo/package name `two-loonies`) that helps users **import bank and investment data** (PDF statements and CSV exports, plus early **Plaid** linking), **normalize it into a structured ledger** in **Supabase**, and **explore it in a dashboard**: high-level **metrics**, **wealth** (accounts, balances, holdings), **spending and income** (cash-flow-style views and charts), **data editor** (transactions, categories, tags, review flags), and **profile**. Authenticated users also get **Loonie AI**, an in-dashboard chat that answers questions using a **server-built snapshot** of their accounts and recent transactions (Gemini).

The experience is optimized around **statement upload and parsing**; Plaid is wired for **Sandbox** and **Canada** in current configuration.

---

## What users can do today (product surface)

### Account and access

- **Sign up / sign in** with Supabase Auth (email and password).
- **Password reset** via email; recovery links that land on `/` are redirected to `/reset-password` so the form is shown.
- **Legal pages**: `/privacy`, `/terms`, `/legal/subprocessors` (linked from the profile menu).
- **Landing** (`/`) and **analysis** (`/analysis`) exist outside the main dashboard shell; authenticated users hitting `/` go to `/dashboard`.

### Data import

- **Upload PDF statements** and **CSV exports** (async pipeline with job polling). Limits are enforced in API code (e.g. file count/size; configurable pieces like per-hour upload caps can be tightened via admin config where wired).
- **Parse** into a structured **`StatementExtraction`** (metadata, transactions, holdings) using the selected parser (see below), then **review and save** into the user’s ledger: accounts, statements, transactions, balances, holdings.
- **Optional storage** of originals in **Supabase Storage** (bucket from env, e.g. `STATEMENT_PDF_BUCKET`).
- **Plaid Link** on the landing flow: **create link token** and **exchange public token** (Sandbox + Canada in code); maps into the same account / balance model as statements when used.

### Dashboard (protected `/dashboard`)

- **Dashboard** (home tab): loads **accounts with balances**, **exchange rates** for CAD aggregation, and **derived metrics** (e.g. net worth and spending-oriented signals via `useDashboardMetrics` and shared FX helpers).
- **Wealth**: accounts, balances, holdings-oriented views (Canadian product subtypes such as TFSA, RRSP, chequing, margin, etc.).
- **Spending & Income**: income/expense-style analysis and charts (route: `/dashboard/spending-income`; `/dashboard/cashflow` redirects here).
- **Data editor**: edit **categories** (single and bulk), **tags**, **reviewed** state, **internal transfer** linking; work with duplicates and flags the pipeline sets.
- **Profile**: user/profile fields backed by `profiles`.
- **Loonie AI** (floating chat on all dashboard tabs): asks natural-language questions; backend injects a **pre-computed** net worth / account / spending snapshot and calls **Gemini** (`GEMINI_MODEL_CHAT`, default `gemini-2.5-flash`). Can be **disabled globally** via admin (`loonie_ai_enabled`); when off, the UI hides the widget and `POST /api/chat` returns **503**.
- **Maintenance mode**: when `maintenance_mode` is true, the shell shows a banner and **uploads are paused**; the rest of the dashboard stays usable as read-only where data already exists.

### Operators / admins (`profiles.is_admin`)

- **Admin UI** at `/admin` (not shown to non-admins): dashboard home, **system config** (key/value rows in `admin_config`), **prompt versions** (`prompt_versions`), **API key / env presence** checklist, **user list and detail**, optional **hard delete** (gated by `flag_hard_delete_enabled`), **audit log**, **analytics** (extraction summary, costs, upload volume, active users, API error rates), **queue health**.
- **Public system status**: `GET /api/system/status` exposes `maintenance_mode` and `loonie_ai_enabled` for the dashboard shell (no auth).

**Note:** Many keys are **editable in the admin UI** and stored in Postgres; only a subset are read on the **hot path** of normal user API traffic via `api/utils/admin_config.py` (`ADMIN_CONFIG_WIRED_KEYS`: e.g. `maintenance_mode`, `max_uploads_per_hour`, `loonie_ai_enabled`). Extraction model names are primarily driven by **environment variables** and **`api/config.json`** unless extended to read `admin_config`.

---

## Architecture (high level)

| Layer | Technology |
|--------|------------|
| **Frontend** | **Create React App** (`react-scripts`), **React 19**, **React Router 7**, **Tailwind CSS**, **Axios**, **@supabase/supabase-js**, **react-plaid-link**, **Nivo** (`@nivo/sankey`, `@nivo/core`), **lucide-react**, **react-select** |
| **Backend** | **FastAPI** in `api/index.py` plus **`api/admin_routes.py`** and **`api/chat_routes.py`**, served on **Vercel** with rewrite `/api/*` → `api/index.py` (`vercel.json`) |
| **Database & auth** | **Supabase** (Postgres + RLS + Auth). Backend uses **service/secret key** via `api/supabase_client.py` for privileged operations |
| **File storage** | **Supabase Storage** for uploaded PDFs (and related paths for statements) |
| **Async jobs** | **Redis** (`REDIS_URL`) stores upload **job state** (JSON, TTL) for pipeline progress and results |
| **AI / parsing** | **Google Gemini** (`GOOGLE_API_KEY` / `GEMINI_API_KEY`), **Instructor** for structured extraction, optional **Docling** (local or remote per `DOCLING_MODE` / `DOCLING_SERVICE_URL` and `requirements-vercel.txt`) |

Local dev: frontend **`package.json`** may set **`"proxy": "http://localhost:8000"`** so CRA can reach a local API; root **`npm run build`** can build the frontend into **`public/`** for static hosting alongside the API.

---

## PDF / CSV statement pipeline (technical)

1. **PDF text extraction**: Default path uses **pdfplumber** (`api/parsers/pdfplumber_parser.py`) in a **thread** to avoid blocking the event loop. **`pdfplumber_v2`** (`api/parsers/pdfplumberV2_parser.py`) adds **deterministic pre-cleaning** (repeated headers/footers, generic trimming of legal/boilerplate tails) before the LLM sees text.
2. **CSV path**: Dedicated CSV parsing (`api/parsers/csv_parser.py`) with header fingerprinting and optional **review** steps when mapping is ambiguous.
3. **Structured extraction**: Gemini produces a **`StatementExtraction`** (`api/parsers/schema.py`): provider metadata, account id, balances, currency, dates, account type, **transactions**, **holdings**.
4. **Post-processing** (PDF path): Strips spurious opening/closing balance lines; **non–credit-card** running-balance sign correction; **credit card** sign rules from `transaction_type` and keywords; optional **opening + Σ(transactions) ≈ closing** validation.
5. **Retry ladder**: Failed validation can trigger a **second Gemini pass**; if still failing, **Docling markdown + LLM** (Pass 3) may run when enabled (`ENABLE_PASS3`).
6. **Parser registry** (`api/parsers/registry.py`): `STATEMENT_PARSER` / `parser_override` ∈ `{ docling, gemini_native, pdfplumber, pdfplumber_v2 }`; default **`pdfplumber`**.
7. **Categorization**: Applied after extraction; **`analyze_transactions`** (and related endpoints) power summaries for the UI.

**Scanned PDFs** with no extractable text still fail with a clear message (OCR not shipped).

---

## API surface (representative)

**User-facing (authenticated unless noted)**

- **Upload (async)**: `POST /api/upload_statement` → `{ job_id }`; `GET /api/upload_statement_status/{job_id}`; `GET /api/upload_statement_result/{job_id}`.
- **Legacy sync**: `POST /api/upload_statement_old`.
- **Plaid**: `POST /api/create_link_token`, `POST /api/exchange_public_token`.
- **FX (public)**: `GET /api/exchange_rates`.
- **Data**: `GET /api/user_data`, `GET /api/accounts_with_balances`, `GET /api/holdings`, `POST /api/save_statements`, `DELETE /api/statements/{statement_id}`, bulk delete, `GET /api/statements/{statement_id}/pdf-url`, `POST /api/transactions`, `POST /api/analyze_transactions`, `POST /api/rerun_analysis`, `POST /api/detect-internal-transfers`, `POST /api/save_analysis` (legacy no-op).
- **Editing**: `PATCH` transaction **category**, **tags**, **reviewed**; bulk category patch; **unlink self-transfer** on a transaction.
- **Reference**: `GET /api/categories`, `GET /api/tags` (RPC **`get_unique_user_tags`**).
- **AI chat**: `POST /api/chat` — body `{ message, history? }` → `{ reply }`.
- **Test / dev**: `POST /api/v1/test-native-pdf-parse`.

**Public / system**

- `GET /api/system/status` — `maintenance_mode`, `loonie_ai_enabled`.

**Admin** (`Authorization: Bearer` + `profiles.is_admin`)

- Config: `GET /api/admin/config`, `GET /api/admin/config/{key}`, `PATCH /api/admin/config/{key}`.
- Prompts: `GET/POST /api/admin/prompts`, `PATCH .../activate`, `DELETE .../{prompt_id}`.
- Users: `GET /api/admin/users`, `GET /api/admin/users/{user_id}`, `DELETE .../hard-delete` (feature-flagged).
- Ops: `GET /api/admin/audit-log`, `GET /api/admin/api-key-status`, analytics and `GET /api/admin/queue-health`.

**Observability**

- Middleware logs most `/api/*` requests (excluding high-frequency upload status polls) into **`api_request_log`** for admin analytics.

---

## Authentication on the API

**`_get_user_from_token`**: `Authorization: Bearer <jwt>`. Prefers **JWKS** from `{SUPABASE_URL}/auth/v1/.well-known/jwks.json` with **RS256/ES256** and audience **`authenticated`**; falls back to **`SUPABASE_JWT_SECRET`** with **HS256**.

---

## Data model (Supabase / Postgres)

Core user data (evolved toward a columnar, event-style ledger):

- **`profiles`**: extends `auth.users` (display name, etc.); **`is_admin`** for operator access.
- **`accounts`**: **`account_type`** (Plaid-style top level), **`account_subtype`** (Canadian product labels), provider, identifiers.
- **`user_statements`**: per uploaded statement metadata (filename, storage path, dates, provider, linkage to `account_id`); validation/review annotations as implemented in migrations and API.
- **`transactions`**: `date`, `description`, `amount`, `category`, flags (`is_duplicate`, `is_transfer`, `is_fixed_cost`, `needs_review`), **`tags text[]`**, **`linked_transaction_id`**, **`occurrence_index`** with uniqueness on **`(account_id, date, amount, description, occurrence_index)`**.
- **`balances`**: point-in-time values (`balance_kind` includes statement-sourced rows used for wealth and Loonie context).
- **`holdings`**: positions keyed to account/statement/date.

**Admin / telemetry** (service-role from API; RLS not intended for end-user direct access):

- **`admin_config`**, **`prompt_versions`**, **`admin_audit_log`**, **`extraction_events`**, **`api_request_log`**, plus CSV mapping helpers such as **`csv_mapping_registry`** where present.

**RLS**: User tables restrict rows to **`auth.uid()`** (or equivalent user id) as defined in migrations.

---

## Frontend structure

- **`App.js`**: **`AuthProvider`**, **`AnalysisProvider`**, **`UploadProvider`**; routes for landing, analysis, reset password, legal pages, protected **`/dashboard`** (nested tabs), protected **`/admin`** (nested admin pages).
- **`DashboardShell.js`**: Bottom nav, profile menu, maintenance banner, **LoonieChat** when enabled.
- **`AdminShell.js`**: Separate shell and nav for operators.
- **Supabase client**: `frontend/src/lib/supabase.js` (anon key in browser).
- **Upload**: Context + modal; polling Redis-backed job endpoints.

---

## Operations and environment

- **Logging**: `logs/statement_uploads.log` on non-Vercel; on Vercel, file logging is skipped.
- **Env vars** (non-exhaustive): Supabase URL/keys, JWT secret, Gemini/Google keys, Redis URL, Plaid client/secret, `STATEMENT_PARSER`, Docling settings, storage bucket, `ENABLE_PASS3`, chat model `GEMINI_MODEL_CHAT`, upload and maintenance toggles (or use **`admin_config`** where wired).

---

## Testing

Python tests under **`tests/`** (parsers, running balance, occurrence index, priority rules, benchmarks). Frontend: CRA Jest/RTL.

---

## Potential future (not committed as shipped)

These items are **directional**; prioritize using [FEATURE_ROADMAP.md](./FEATURE_ROADMAP.md) for beta gates and ownership.

- **OCR / scanned PDFs**: Support statements that are image-only without extractable text.
- **Production Plaid**: Move beyond Sandbox; stable `client_user_id`, token lifecycle, disconnect UX, institution health.
- **Deeper admin ↔ runtime wiring**: Drive more of `admin_config` (models, parser default, feature flags) from DB on every request where safe and cacheable.
- **User lifecycle**: Self-serve **export** and **account deletion** aligned with privacy expectations.
- **Trust and scale**: Error tracking, stricter CORS/CSP, expanded rate limits and abuse controls, staging parity, SLOs for parsing and dashboard load.
- **Product polish**: Richer onboarding, institution coverage transparency, mobile-first passes on upload and charts, optional **conversation history** or **citations** for Loonie AI (today replies are stateless beyond the client-sent `history`).
