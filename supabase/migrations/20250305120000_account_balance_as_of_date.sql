-- Store the date as of which last_balance is valid. When updating last_balance we only
-- overwrite if the new statement's end_date is >= balance_as_of_date (so uploading an
-- earlier statement does not replace a later balance).
alter table public.accounts add column if not exists balance_as_of_date date;

comment on column public.accounts.balance_as_of_date is 'Date as of which last_balance is valid (statement end_date); only update last_balance when new statement end_date >= this.';
