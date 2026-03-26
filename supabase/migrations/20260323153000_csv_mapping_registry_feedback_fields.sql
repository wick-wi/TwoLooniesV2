alter table if exists public.csv_mapping_registry
  add column if not exists last_used_at timestamptz default now();

alter table if exists public.csv_mapping_registry
  add column if not exists correction_count integer not null default 0;
