-- Migration: Move from JSON-based structure to column-based schema
-- Run after 20240227160000_initial_schema.sql
-- WARNING: This drops analyses, plaid_items, and user_statements. Data will be lost.
-- If you need to preserve data, export it before running.

-- 1. Drop old tables (user_statements must be dropped before transactions can reference new one)
drop table if exists public.transactions;
drop table if exists public.user_statements;
drop table if exists public.analyses;
drop table if exists public.plaid_items;

-- 2. Alter profiles: add birth_date and province
alter table public.profiles add column if not exists birth_date date;
alter table public.profiles add column if not exists province text;
-- Add check constraint for province (drop first for idempotency)
alter table public.profiles drop constraint if exists profiles_province_check;
alter table public.profiles add constraint profiles_province_check
  check (province is null or province in ('AB', 'BC', 'MB', 'NB', 'NL', 'NS', 'ON', 'PE', 'QC', 'SK', 'NT', 'NU', 'YT'));

-- 3. Create accounts table
create table if not exists public.accounts (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users not null,
  name text not null,
  account_type text check (account_type in ('Chequing', 'Savings', 'TFSA', 'RRSP', 'FHSA', 'Taxable', 'Credit Card', 'Loan', 'Mortgage')),
  provider text,
  last_balance decimal(12,2) default 0.00,
  balance_last_updated_at timestamptz default now(),
  created_at timestamptz default now()
);

-- 4. Create user_statements (new structure)
create table if not exists public.user_statements (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users not null,
  account_id uuid references public.accounts(id) on delete cascade,
  filename text not null,
  storage_path text,
  opening_balance decimal(12,2),
  closing_balance decimal(12,2),
  start_date date,
  end_date date,
  created_at timestamptz default now()
);

-- 5. Create transactions table
create table if not exists public.transactions (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users not null,
  account_id uuid references public.accounts(id) on delete cascade,
  statement_id uuid references public.user_statements(id) on delete cascade,
  date date not null,
  description text not null,
  clean_merchant text,
  amount decimal(12,2) not null,
  category text,
  is_duplicate boolean default false,
  is_transfer boolean default false,
  is_fixed_cost boolean default false,
  created_at timestamptz default now()
);

alter table public.transactions drop constraint if exists unique_transaction_sig;
alter table public.transactions add constraint unique_transaction_sig unique (account_id, date, amount, description);

-- 6. RLS for new tables (profiles policies need updating to unified "manage" policy)
alter table public.accounts enable row level security;
alter table public.user_statements enable row level security;
alter table public.transactions enable row level security;

-- Drop old granular profile policies and create unified one
drop policy if exists "Users can read own profile" on public.profiles;
drop policy if exists "Users can insert own profile" on public.profiles;
drop policy if exists "Users can update own profile" on public.profiles;
create policy "Users can manage own profile" on public.profiles for all using (auth.uid() = id);

-- Accounts, statements, transactions
drop policy if exists "Users can manage own accounts" on public.accounts;
create policy "Users can manage own accounts" on public.accounts for all using (auth.uid() = user_id);

drop policy if exists "Users can read own statements" on public.user_statements;
drop policy if exists "Users can insert own statements" on public.user_statements;
drop policy if exists "Users can delete own statements" on public.user_statements;
create policy "Users can manage own statements" on public.user_statements for all using (auth.uid() = user_id);

drop policy if exists "Users can manage own transactions" on public.transactions;
create policy "Users can manage own transactions" on public.transactions for all using (auth.uid() = user_id);
