-- balance_kind: statement = period open/close as printed on the statement (chequing balance, CC balance, or brokerage NAV).
--               cash_only = optional brokerage cash subtotal only (not NAV), for cash-ledger reconciliation.

alter table public.balances
  add column if not exists balance_kind text not null default 'statement';

alter table public.balances
  drop constraint if exists balances_balance_kind_check;

alter table public.balances
  add constraint balances_balance_kind_check
  check (balance_kind in ('statement', 'cash_only'));

create unique index if not exists balances_statement_date_currency_kind_uniq
  on public.balances (statement_id, date, currency, balance_kind)
  where statement_id is not null;
