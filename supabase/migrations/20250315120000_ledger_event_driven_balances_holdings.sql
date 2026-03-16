-- Ledger restructure: event-driven time-series (Plaid-inspired).
-- user_statements: metadata only (drop balance/currency columns).
-- accounts: metadata only (drop balance columns).
-- balances: point-in-time account value.
-- holdings: itemized assets including cash.

-- 1.1 Alter user_statements: drop balance and currency columns
alter table public.user_statements drop column if exists opening_balance;
alter table public.user_statements drop column if exists closing_balance;
alter table public.user_statements drop column if exists currency;

-- 1.2 Alter accounts: drop balance-related columns
alter table public.accounts drop column if exists last_balance;
alter table public.accounts drop column if exists currency;
alter table public.accounts drop column if exists balance_as_of_date;
alter table public.accounts drop column if exists balance_last_updated_at;

-- 1.3 Create balances table (point-in-time account value)
create table if not exists public.balances (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users not null,
  account_id uuid references public.accounts(id) on delete cascade not null,
  statement_id uuid references public.user_statements(id) on delete set null,
  amount decimal(12,2) not null,
  currency text not null,
  date date not null,
  created_at timestamptz default now()
);

create index if not exists balances_account_date_idx on public.balances (account_id, date desc);

alter table public.balances enable row level security;
drop policy if exists "Users can manage own balances" on public.balances;
create policy "Users can manage own balances" on public.balances for all using (auth.uid() = user_id);

-- 1.4 Create holdings table (itemized assets, including cash)
create table if not exists public.holdings (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users not null,
  account_id uuid references public.accounts(id) on delete cascade not null,
  statement_id uuid references public.user_statements(id) on delete set null,
  asset_symbol text,
  asset_name text,
  quantity decimal(18,6) not null,
  unit_price decimal(18,6) not null,
  total_value decimal(18,6) not null,
  currency text not null,
  date date not null,
  is_cash_equivalent boolean default false,
  created_at timestamptz default now()
);

create index if not exists holdings_user_account_date_idx on public.holdings (user_id, account_id, date);
create index if not exists holdings_account_date_idx on public.holdings (account_id, date);
create index if not exists holdings_statement_id_idx on public.holdings (statement_id) where statement_id is not null;

alter table public.holdings enable row level security;
drop policy if exists "Users can manage own holdings" on public.holdings;
create policy "Users can manage own holdings" on public.holdings for all using (auth.uid() = user_id);
