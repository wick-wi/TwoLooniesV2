-- Expand accounts.account_type check constraint to all 21 reference types.
-- Map legacy values to new types before tightening the constraint.
update public.accounts set account_type = 'Line of Credit' where account_type = 'Loan';
update public.accounts set account_type = 'Margin' where account_type = 'Taxable';

-- Drop existing constraint (name may be accounts_account_type_check from create table).
alter table public.accounts drop constraint if exists accounts_account_type_check;

alter table public.accounts add constraint accounts_account_type_check check (
  account_type in (
    'AutoLoan',
    'Chequing',
    'Credit Card',
    'Crypto',
    'DPSP',
    'ESOP',
    'FHSA',
    'GIC',
    'HELOC',
    'Line of Credit',
    'LIRA',
    'Margin',
    'Mortgage',
    'RDSP',
    'RESP',
    'RPP',
    'RRIF',
    'RRSP',
    'Savings',
    'Student Loan',
    'TFSA'
  )
);
