-- Add a concrete link between paired internal transfer transactions.
-- If one side is deleted (e.g. statement delete cascade), clear the other side's link.

alter table public.transactions
  add column if not exists linked_transaction_id uuid references public.transactions(id) on delete set null;
