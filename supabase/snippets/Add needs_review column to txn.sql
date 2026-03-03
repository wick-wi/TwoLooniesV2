alter table public.transactions add column if not exists needs_review boolean default false;
