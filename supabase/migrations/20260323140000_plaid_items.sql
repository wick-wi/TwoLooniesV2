-- Server-side Plaid Item storage (access tokens). RLS enabled with no policies:
-- only the API service role (bypasses RLS) reads/writes; end users never query this table directly.

create table if not exists public.plaid_items (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users (id) on delete cascade,
  item_id text not null,
  access_token text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint plaid_items_user_item_unique unique (user_id, item_id)
);

create index if not exists plaid_items_user_id_idx on public.plaid_items (user_id);

alter table public.plaid_items enable row level security;
