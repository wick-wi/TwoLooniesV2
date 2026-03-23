-- Legacy renames: portfolio -> statement; cash -> cash_only. Refreshes check constraint to (statement, cash_only).

update public.balances
set balance_kind = 'statement'
where balance_kind = 'portfolio';

update public.balances
set balance_kind = 'cash_only'
where balance_kind = 'cash';

alter table public.balances
  drop constraint if exists balances_balance_kind_check;

alter table public.balances
  add constraint balances_balance_kind_check
  check (balance_kind in ('statement', 'cash_only'));

alter table public.balances
  alter column balance_kind set default 'statement';
