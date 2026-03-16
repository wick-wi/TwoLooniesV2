-- Plaid-aligned account taxonomy: split account_type into account_type (Plaid top-level)
-- and account_subtype (Canadian product name).

-- 1. Drop existing CHECK constraint on account_type (unnamed constraint, find and drop)
DO $$
DECLARE
    _con text;
BEGIN
    SELECT con.conname INTO _con
    FROM pg_constraint con
    JOIN pg_class rel ON rel.oid = con.conrelid
    JOIN pg_namespace nsp ON nsp.oid = rel.relnamespace
    WHERE rel.relname = 'accounts'
      AND nsp.nspname = 'public'
      AND con.contype = 'c'
      AND pg_get_constraintdef(con.oid) ILIKE '%account_type%';
    IF _con IS NOT NULL THEN
        EXECUTE format('ALTER TABLE public.accounts DROP CONSTRAINT %I', _con);
    END IF;
END $$;

-- 2. Rename account_type -> account_subtype
ALTER TABLE public.accounts RENAME COLUMN account_type TO account_subtype;

-- 3. Add CHECK constraint on account_subtype for all 21 canonical names
ALTER TABLE public.accounts ADD CONSTRAINT accounts_subtype_check
    CHECK (account_subtype IN (
        'AutoLoan', 'Chequing', 'Credit Card', 'Crypto', 'DPSP', 'ESOP',
        'FHSA', 'GIC', 'HELOC', 'Line of Credit', 'LIRA', 'Margin',
        'Mortgage', 'RDSP', 'RESP', 'RPP', 'RRIF', 'RRSP', 'Savings',
        'Student Loan', 'TFSA'
    ));

-- 4. Add new account_type column for Plaid top-level category
ALTER TABLE public.accounts ADD COLUMN account_type text;

ALTER TABLE public.accounts ADD CONSTRAINT accounts_type_check
    CHECK (account_type IN ('depository', 'investment', 'credit', 'loan'));

-- 5. Backfill account_type from account_subtype
UPDATE public.accounts SET account_type = CASE account_subtype
    WHEN 'AutoLoan'       THEN 'loan'
    WHEN 'Chequing'       THEN 'depository'
    WHEN 'Credit Card'    THEN 'credit'
    WHEN 'Crypto'         THEN 'investment'
    WHEN 'DPSP'           THEN 'investment'
    WHEN 'ESOP'           THEN 'investment'
    WHEN 'FHSA'           THEN 'investment'
    WHEN 'GIC'            THEN 'investment'
    WHEN 'HELOC'          THEN 'credit'
    WHEN 'Line of Credit' THEN 'credit'
    WHEN 'LIRA'           THEN 'investment'
    WHEN 'Margin'         THEN 'investment'
    WHEN 'Mortgage'       THEN 'loan'
    WHEN 'RDSP'           THEN 'investment'
    WHEN 'RESP'           THEN 'investment'
    WHEN 'RPP'            THEN 'investment'
    WHEN 'RRIF'           THEN 'investment'
    WHEN 'RRSP'           THEN 'investment'
    WHEN 'Savings'        THEN 'depository'
    WHEN 'Student Loan'   THEN 'loan'
    WHEN 'TFSA'           THEN 'investment'
    ELSE 'depository'
END
WHERE account_type IS NULL;
