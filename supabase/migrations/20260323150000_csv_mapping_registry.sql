-- Cache AI-generated CSV header mappings for fast re-use across users.
create table if not exists public.csv_mapping_registry (
  id uuid default gen_random_uuid() primary key,
  header_fingerprint text unique not null,
  provider_guess text,
  account_type_guess text check (account_type_guess in ('depository', 'credit', 'investment', 'loan')),
  account_subtype_guess text,
  mapping_schema jsonb not null,
  created_at timestamptz default now()
);

create index if not exists csv_mapping_registry_header_idx
  on public.csv_mapping_registry (header_fingerprint);
