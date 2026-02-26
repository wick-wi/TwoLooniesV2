-- Run this in Supabase SQL Editor to create the required tables
-- If you already have analyses/plaid_items, only run the user_statements section
-- and the new RLS policies. Drop existing policies first if you get "already exists" errors.

-- Profiles (optional, extends auth.users)
create table if not exists public.profiles (
  id uuid references auth.users primary key,
  display_name text,
  created_at timestamptz default now()
);

-- Saved analyses
create table if not exists public.analyses (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users not null,
  source text not null,
  summary jsonb not null,
  created_at timestamptz default now()
);

-- User statements: one row per uploaded PDF (stores parsed transactions)
create table if not exists public.user_statements (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users not null,
  filename text not null,
  transactions jsonb not null default '[]',
  created_at timestamptz default now()
);

-- Plaid items (one per user)
create table if not exists public.plaid_items (
  id uuid default gen_random_uuid() primary key,
  user_id uuid references auth.users not null unique,
  access_token text not null,
  item_id text not null,
  created_at timestamptz default now()
);

-- Enable RLS
alter table public.profiles enable row level security;
alter table public.analyses enable row level security;
alter table public.user_statements enable row level security;
alter table public.plaid_items enable row level security;

-- RLS: profiles (drop first so script is idempotent)
drop policy if exists "Users can read own profile" on public.profiles;
drop policy if exists "Users can insert own profile" on public.profiles;
drop policy if exists "Users can update own profile" on public.profiles;
create policy "Users can read own profile" on public.profiles
  for select using (auth.uid() = id);
create policy "Users can insert own profile" on public.profiles
  for insert with check (auth.uid() = id);
create policy "Users can update own profile" on public.profiles
  for update using (auth.uid() = id);

-- RLS policies: users can only access their own rows
drop policy if exists "Users can read own analyses" on public.analyses;
drop policy if exists "Users can insert own analyses" on public.analyses;
create policy "Users can read own analyses" on public.analyses
  for select using (auth.uid() = user_id);
create policy "Users can insert own analyses" on public.analyses
  for insert with check (auth.uid() = user_id);

-- RLS: user_statements
drop policy if exists "Users can read own statements" on public.user_statements;
drop policy if exists "Users can insert own statements" on public.user_statements;
drop policy if exists "Users can delete own statements" on public.user_statements;
create policy "Users can read own statements" on public.user_statements
  for select using (auth.uid() = user_id);
create policy "Users can insert own statements" on public.user_statements
  for insert with check (auth.uid() = user_id);
create policy "Users can delete own statements" on public.user_statements
  for delete using (auth.uid() = user_id);

-- RLS: plaid_items
drop policy if exists "Users can read own plaid_items" on public.plaid_items;
drop policy if exists "Users can insert own plaid_items" on public.plaid_items;
drop policy if exists "Users can update own plaid_items" on public.plaid_items;
create policy "Users can read own plaid_items" on public.plaid_items
  for select using (auth.uid() = user_id);
create policy "Users can insert own plaid_items" on public.plaid_items
  for insert with check (auth.uid() = user_id);
create policy "Users can update own plaid_items" on public.plaid_items
  for update using (auth.uid() = user_id);
