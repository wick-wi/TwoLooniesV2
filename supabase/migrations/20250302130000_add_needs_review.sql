-- Add needs_review column for transactions requiring manual review
-- (e.g. e-transfers, uncategorized)
alter table public.transactions add column if not exists needs_review boolean default false;
