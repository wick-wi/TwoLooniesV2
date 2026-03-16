   SELECT id, description, category, needs_review
   FROM transactions
   WHERE description ILIKE '%Cardtronics%'
   ORDER BY date DESC;