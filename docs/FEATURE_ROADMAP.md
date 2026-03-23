# TwoLoonies — feature roadmap

This document lists **what is implemented today** and **what must be done before a public beta**. For architecture and technical depth, see [TWOLOONIES_OVERVIEW.md](./TWOLOONIES_OVERVIEW.md).

---

## Shipped (done so far)

### Product — authentication and shell

- **Supabase Auth**: Email/password sign-in and sign-up; session JWT used for authenticated API calls.
- **Password reset**: Flow with redirect to `/reset-password` when Supabase sends recovery links to the site root.
- **Protected dashboard**: `/dashboard` with tabs — **Dashboard**, **Wealth**, **Cashflow**, **Data editor**, **Profile**; landing and `/analysis` routes outside the shell.
- **Context providers**: `AuthProvider`, `AnalysisProvider`, `UploadProvider` wrapping the app.

### Product — statements and data

- **PDF upload**: One or more PDFs per request (up to **12 files**, **5 MB** each).
- **Async processing**: `POST /api/upload_statement` returns a **`job_id`**; client polls **status** and **result** (backed by Redis job state with TTL).
- **Parsing**: Text extraction (pdfplumber), Gemini structured extraction (`StatementExtraction`: metadata, transactions, holdings), post-processing (balance-line stripping, running-balance sign fixes, credit-card sign normalization, opening/closing checks), optional **retry passes** and **Docling** path when validation fails.
- **Parser selection**: Configurable via `STATEMENT_PARSER` (`docling` | `gemini_native` | `pdfplumber`) and optional per-request override hook for future tiers.
- **Save to ledger**: Parsed statements can be **saved** to Supabase — get-or-create **accounts** by provider + account number; insert **user_statements**, **transactions**, **balances**, and **holdings** (branching by Plaid-style account type: e.g. investment vs depository).
- **Supabase Storage**: Optional upload of statement PDFs to a private bucket (`STATEMENT_PDF_BUCKET`).

### Product — editing, analysis, and UX

- **Transactions**: Columnar store with `needs_review`, duplicate/transfer/fixed-cost flags, **`tags`** (`text[]`), **`linked_transaction_id`** for paired internal transfers, **`occurrence_index`** for same-signature duplicates on the same day.
- **Categories**: Rule-based assignment from `api/data/categories.json`; API to list categories; per-transaction and **bulk** category PATCH; integration with parser/LLM category vocabulary.
- **Tags**: Per-transaction tags; **`GET /api/tags`** via RPC `get_unique_user_tags`.
- **Analysis**: Server-side cash flow, category totals, top merchants, monthly series (`api/analysis.py`); keyword fallback when category missing.
- **Internal transfers**: Detection endpoint to link related transactions.
- **Statement lifecycle**: Delete statement (and bulk delete); validation annotations on statements (e.g. balance reconciliation, “all reviewed”) for UI.

### Product — bank linking (early)

- **Plaid Link**: `create_link_token` and `exchange_public_token` endpoints; **Sandbox** environment and **Canada** country codes in current code; `react-plaid-link` on the frontend.

### Platform — backend and data model

- **FastAPI** monolith (`api/index.py`) with CORS; deployable on **Vercel** (`/api/*` → `api/index.py`).
- **Supabase Postgres** with **RLS** on user-scoped tables; **service/secret key** on the server for privileged operations.
- **Event-driven ledger tables**: `accounts` (type + subtype), `user_statements`, `transactions`, `balances`, `holdings`, `profiles`.
- **JWT verification** on protected routes: JWKS (RS256/ES256) with fallback to HS256 via `SUPABASE_JWT_SECRET`.
- **Legacy compatibility**: `POST /api/save_analysis` is a **no-op** (old analyses table removed).

### Platform — developer experience

- **Tests**: Python tests (running balance, occurrence index, priority rules, parser benchmarks, etc.); frontend Jest/RTL via CRA.
- **Logging**: File logging for statement uploads on non-Vercel environments; console on Vercel.

---

## Must-do before a public beta

Treat as a **checklist** to assign owners and dates; not every item blocks a *closed* beta with trusted users.

### Production data connections

- **Plaid**: Move from **Sandbox** to **production**; use a **stable per-user `client_user_id`** (not a placeholder); securely **store and rotate** access tokens; handle **item login required**, **institution downtime**, and **disconnect / remove connection** in the product.
- **Redis**: Hosted **Redis** in production with the same semantics as local (job state, TTL); **monitor** connectivity; define behavior when Redis is down (clear user messaging, no silent data loss).

### Trust and legal surface

- **Privacy policy** and **terms of use** (or beta terms) covering data collection, AI processing, retention, subprocessors (Supabase, Plaid, Google, Vercel, etc.), and Canadian context where relevant.
- **In-product disclaimers** that parsed amounts and categories may be wrong and are **not** tax or investment advice.

### Account lifecycle

- **Email verification** (or another signal) before sensitive actions, if not already enforced by Supabase settings.
- **Delete account / export data**: A path for users to **leave** and optionally **download** their data (even minimal JSON/CSV export helps beta trust).

### Security hardening

- **Secrets**: No service keys in the frontend; **rotate** any key that ever leaked; review **Vercel / Supabase** env vars.
- **API**: Authenticated routes reject missing/invalid tokens consistently; **rate limiting** or abuse controls on expensive endpoints (upload, AI, Plaid).
- **CORS** and **Content-Security-Policy** reviewed for production origins only.

### Observability and support

- **Error tracking** (e.g. Sentry) on frontend and serverless API; **structured logs** for uploads and Plaid errors (without logging full PII or tokens).
- A **feedback channel** (email, form, or in-app) and a simple **status** or incident communication plan.

### Product completeness for beta narrative

- Clear **empty states** and **failure states** (upload failed, bank link failed, parsing uncertain).
- **Onboarding** copy: PDF quality, supported institutions, known limitations (**scanned PDFs** / OCR not ready).
- **Mobile-friendly** core flows (sign-in, upload, dashboard) or an explicit “desktop recommended” stance.

---

## Validations we must do (before opening to the public)

### Security and privacy

- **RLS audit**: Confirm **no cross-user reads/writes** on `accounts`, `user_statements`, `transactions`, `balances`, `holdings`, storage objects, and RPCs such as `get_unique_user_tags`.
- **JWT verification**: Production tokens use the intended algorithm (JWKS vs HS256) and **audience** matches Supabase configuration.
- **Dependency review**: Known CVEs on critical packages; lockfiles committed; production install path matches `requirements-vercel.txt` / `requirements.txt` as intended.

### Correctness and data integrity

- **Parser regression set**: Curated **anonymized** PDFs across major Canadian banks and products (chequing, credit card, brokerage); track accuracy on amounts, dates, and balance reconciliation flags.
- **Plaid path** (if in beta): End-to-end test on **production** with a small set of real items; verify mapping into **account_subtype** / **account_type** and duplicate/reimport behavior.
- **Save path**: `save_statements` tested for **partial failure**, **retries**, and **idempotency** where users might double-submit.

### Reliability and performance

- **Load smoke test**: Concurrent uploads and dashboard loads against production-like infra; watch **Vercel** timeouts, **Gemini** rate limits, **Redis** memory.
- **Chaos-lite**: Redis unavailable, Gemini timeout, oversize PDF, wrong file type — each returns a **safe, understandable** response.

### Compliance and vendor readiness

- **Plaid** production checklist (use case, retention, data minimization, display requirements).
- **Supabase** backup / point-in-time recovery understood; **encryption at rest** and **TLS** on all paths.

### Release hygiene

- **Staging** mirrors production (separate Supabase project recommended).
- **Rollback plan** for API and frontend; **feature flags** or kill switches for upload/Plaid if needed.
- **Beta scope** documented internally: audience, duration, success metrics (retention, parse accuracy, support volume).
