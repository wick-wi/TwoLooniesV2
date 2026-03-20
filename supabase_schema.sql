-- Run this in Supabase SQL Editor to create the required tables
-- Migrating from JSON-based structure to column-based schema.

-- ==========================================
-- 1. CORE USER PROFILES
-- ==========================================
create table if not exists public.profiles (
  id uuid references auth.users primary key,
  display_name text,
  address text,
  birth_date date, -- For age-based cohort comparison
  province text check (province in ('AB', 'BC', 'MB', 'NB', 'NL', 'NS', 'ON', 'PE', 'QC', 'SK', 'NT', 'NU', 'YT')), -- Canadian context
  created_at timestamptz default now()
);

-- ==========================================
-- 2. ACCOUNTS (Metadata only; balances in public.balances)
-- ==========================================
create table if not exists public.accounts (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users not null,
  name text, -- e.g., "Main Chequing"
  account_number text, -- from statement parse; unique per user for get-or-create
  account_type text check (account_type in ('depository', 'investment', 'credit', 'loan')),
  account_subtype text check (account_subtype in ('AutoLoan', 'Chequing', 'Credit Card', 'Crypto', 'DPSP', 'ESOP', 'FHSA', 'GIC', 'HELOC', 'Line of Credit', 'LIRA', 'Margin', 'Mortgage', 'RDSP', 'RESP', 'RPP', 'RRIF', 'RRSP', 'Savings', 'Student Loan', 'TFSA')),
  provider text, -- e.g., "TD", "RBC", "Wealthsimple"
  created_at timestamptz default now()
);

-- ==========================================
-- 3. USER STATEMENTS (Metadata only; balance data in public.balances)
-- ==========================================
create table if not exists public.user_statements (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users not null,
  account_id uuid references public.accounts(id) on delete cascade,
  filename text not null,
  storage_path text, -- Link to the PDF in Supabase Storage for "Audit" view
  start_date date,
  end_date date,
  provider text,
  created_at timestamptz default now()
);

-- ==========================================
-- 3b. BALANCES (Point-in-time account value; event-driven ledger)
-- ==========================================
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
create policy "Users can manage own balances" on public.balances for all using (auth.uid() = user_id);

-- ==========================================
-- 3c. HOLDINGS (Itemized assets including cash)
-- ==========================================
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
create policy "Users can manage own holdings" on public.holdings for all using (auth.uid() = user_id);

-- ==========================================
-- 4. TRANSACTIONS (The Ledger)
-- ==========================================
create table if not exists public.transactions (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users not null,
  account_id uuid references public.accounts(id) on delete cascade,
  statement_id uuid references public.user_statements(id) on delete cascade,
  date date not null,
  description text not null, -- Raw description from bank
  clean_merchant text, -- Normalized name for Personal Inflation logic
  amount decimal(12,2) not null,
  category text,
  occurrence_index integer not null default 1,
  is_duplicate boolean default false,
  is_transfer boolean default false, -- For Sankey/Internal transfer filter
  is_fixed_cost boolean default false, -- For Fixed vs Variable split
  needs_review boolean default false, -- E-transfer, uncategorized
  created_at timestamptz default now()
);

-- DEDUPLICATION CONSTRAINT: Prevents same transaction twice
alter table public.transactions
drop constraint if exists unique_transaction_sig;

alter table public.transactions
drop constraint if exists unique_transaction_occurrence;

alter table public.transactions
add constraint unique_transaction_occurrence
unique (account_id, date, amount, description, occurrence_index);

-- ==========================================
-- 5. ROW LEVEL SECURITY (RLS)
-- ==========================================
alter table public.profiles enable row level security;
alter table public.accounts enable row level security;
alter table public.user_statements enable row level security;
alter table public.balances enable row level security;
alter table public.holdings enable row level security;
alter table public.transactions enable row level security;

-- Drop existing policies for idempotency
drop policy if exists "Users can manage own profile" on public.profiles;
drop policy if exists "Users can manage own accounts" on public.accounts;
drop policy if exists "Users can manage own statements" on public.user_statements;
drop policy if exists "Users can manage own balances" on public.balances;
drop policy if exists "Users can manage own holdings" on public.holdings;
drop policy if exists "Users can manage own transactions" on public.transactions;

-- Create unified policies
create policy "Users can manage own profile" on public.profiles for all using (auth.uid() = id);
create policy "Users can manage own accounts" on public.accounts for all using (auth.uid() = user_id);
create policy "Users can manage own statements" on public.user_statements for all using (auth.uid() = user_id);
create policy "Users can manage own balances" on public.balances for all using (auth.uid() = user_id);
create policy "Users can manage own holdings" on public.holdings for all using (auth.uid() = user_id);
create policy "Users can manage own transactions" on public.transactions for all using (auth.uid() = user_id);
