-- Add account_number to accounts for get-or-create by parsed statement metadata.
-- Partial unique index: one account per (user_id, account_number) when account_number is set.
alter table public.accounts add column if not exists account_number text;

create unique index if not exists accounts_user_account_number_key
  on public.accounts (user_id, account_number)
  where account_number is not null;

-- Add principal_remaining to user_statements for Type 3 (Liability) statements.
alter table public.user_statements add column if not exists principal_remaining decimal(12,2);
