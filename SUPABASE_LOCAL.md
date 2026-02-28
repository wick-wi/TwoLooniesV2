# Local Supabase Setup

Use a local Supabase instance to test changes before pushing to production.

## Prerequisites

- **Docker Desktop** – Must be installed and running. [Install Docker Desktop](https://docs.docker.com/desktop/)

## Quick start

1. **Start Docker Desktop** (if not already running).

2. **Start local Supabase:**
   ```bash
   npx supabase start
   ```
   This starts Postgres, Auth, Storage, and the API. The first run may take a few minutes to pull images.

3. **Start your app** – The `.env.local` files are already configured to use the local instance:
   - API: `cd api && uvicorn api.index:app --reload` (or your usual backend command)
   - Frontend: `cd frontend && npm start`

4. **Create an account** – Sign up via your app. Local Supabase has no email verification, so you can use any email/password.

## Local URLs

When Supabase is running locally:

| Service       | URL                         |
|---------------|-----------------------------|
| API           | http://127.0.0.1:54321      |
| Studio (DB UI)| http://127.0.0.1:54323      |
| Inbucket (email)| http://127.0.0.1:54324   |

Open Studio to inspect tables, run SQL, and manage auth users.

## Switching between local and production

| Use case          | Action                                                                 |
|-------------------|------------------------------------------------------------------------|
| **Local testing** | Ensure Docker is running and `npx supabase start` has been executed. `.env.local` overrides production credentials. |
| **Production**    | Option A: Stop Supabase (`npx supabase stop`) and delete or rename `.env.local` and `frontend/.env.local`. Option B: Keep `.env.local`; when Supabase isn’t running locally, the app will fail to reach it, so stop Supabase when you want to use production. |

**Recommendation:** When developing locally, keep `.env.local`. When deploying or testing against production, temporarily rename the files (e.g. to `.env.local.bak`) so the app falls back to `.env`.

## Useful commands

```bash
npx supabase start      # Start local Supabase
npx supabase stop       # Stop local Supabase
npx supabase status     # Show URLs and API keys
npx supabase db reset   # Reset DB and re-run migrations
```

## Schema migrations

Schema is defined in `supabase/migrations/`. After editing migrations or adding new ones:

```bash
npx supabase db reset   # Applies all migrations from scratch
```

To add a new migration:

```bash
npx supabase migration new my_migration_name
```

Then edit the generated file in `supabase/migrations/`.
