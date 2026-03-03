UPDATE transactions 
SET description = TRIM(REGEXP_REPLACE(description, '^\d{1,4}\s+\d{1,2}(\s+\d{1,2})?\s+', ''))
WHERE description ~ '^\d{1,4}\s+\d{1,2}';