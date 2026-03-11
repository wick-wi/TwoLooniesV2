-- PRD-aligned: accounts (currency, unique provider+account_number), user_statements (provider, currency), transactions (currency).
-- accounts: add currency; make name optional; unique (user_id, provider, account_number) for get-or-create.
alter table public.accounts add column if not exists currency text default 'CAD';
alter table public.accounts alter column name drop not null;

drop index if exists accounts_user_account_number_key;
create unique index if not exists accounts_user_provider_account_number_key
  on public.accounts (user_id, provider, account_number)
  where provider is not null and account_number is not null;

-- user_statements: add provider and currency (PRD)
alter table public.user_statements add column if not exists provider text;
alter table public.user_statements add column if not exists currency text default 'CAD';

-- transactions: add currency (PRD)
alter table public.transactions add column if not exists currency text default 'CAD';
