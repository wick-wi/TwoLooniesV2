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
-- 2. ACCOUNTS (The "Source of Truth" for Wealth)
-- ==========================================
create table if not exists public.accounts (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users not null,
  name text not null, -- e.g., "Main Chequing"
  account_number text, -- from statement parse; unique per user for get-or-create
  account_type text check (account_type in ('AutoLoan', 'Chequing', 'Credit Card', 'Crypto', 'DPSP', 'ESOP', 'FHSA', 'GIC', 'HELOC', 'Line of Credit', 'LIRA', 'Margin', 'Mortgage', 'RDSP', 'RESP', 'RPP', 'RRIF', 'RRSP', 'Savings', 'Student Loan', 'TFSA')),
  provider text, -- e.g., "TD", "RBC", "Wealthsimple"
  last_balance decimal(12,2) default 0.00,
  balance_last_updated_at timestamptz default now(),
  balance_as_of_date date, -- statement end_date for this balance; only update when new statement is later
  created_at timestamptz default now()
);

-- ==========================================
-- 3. USER STATEMENTS (The "Vault" for PDF Ingestion)
-- ==========================================
create table if not exists public.user_statements (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users not null,
  account_id uuid references public.accounts(id) on delete cascade,
  filename text not null,
  storage_path text, -- Link to the PDF in Supabase Storage for "Audit" view
  opening_balance decimal(12,2),
  closing_balance decimal(12,2),
  principal_remaining decimal(12,2), -- Type 3 (Liability) statements
  start_date date,
  end_date date,
  created_at timestamptz default now()
);

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
add constraint unique_transaction_sig unique (account_id, date, amount, description);

-- ==========================================
-- 5. ROW LEVEL SECURITY (RLS)
-- ==========================================
alter table public.profiles enable row level security;
alter table public.accounts enable row level security;
alter table public.user_statements enable row level security;
alter table public.transactions enable row level security;

-- Drop existing policies for idempotency
drop policy if exists "Users can manage own profile" on public.profiles;
drop policy if exists "Users can manage own accounts" on public.accounts;
drop policy if exists "Users can manage own statements" on public.user_statements;
drop policy if exists "Users can manage own transactions" on public.transactions;

-- Create unified policies
create policy "Users can manage own profile" on public.profiles for all using (auth.uid() = id);
create policy "Users can manage own accounts" on public.accounts for all using (auth.uid() = user_id);
create policy "Users can manage own statements" on public.user_statements for all using (auth.uid() = user_id);
create policy "Users can manage own transactions" on public.transactions for all using (auth.uid() = user_id);
