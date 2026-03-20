-- Step 1: Add the new column
ALTER TABLE public.transactions ADD COLUMN occurrence_index INTEGER DEFAULT 1;

-- Step 2: Safely backfill existing duplicates using a window function
WITH numbered_txns AS (
    SELECT 
        id,
        ROW_NUMBER() OVER (
            PARTITION BY account_id, date, amount, description 
            ORDER BY created_at ASC, id ASC
        ) as rn
    FROM public.transactions
)
UPDATE public.transactions t
SET occurrence_index = nt.rn
FROM numbered_txns nt
WHERE t.id = nt.id;

-- Step 3: Enforce NOT NULL
ALTER TABLE public.transactions ALTER COLUMN occurrence_index SET NOT NULL;

-- Step 4: Drop the old unique signature constraint
ALTER TABLE public.transactions DROP CONSTRAINT IF EXISTS unique_transaction_sig;

-- Step 5: Add the new daily occurrence constraint
ALTER TABLE public.transactions ADD CONSTRAINT unique_transaction_occurrence 
UNIQUE (account_id, date, amount, description, occurrence_index);

