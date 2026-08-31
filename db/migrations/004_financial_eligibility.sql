-- The canonical audited source marks all 142 rows as not eligible for full project value.
UPDATE financial_relation
SET full_value_eligible = false
WHERE full_value_eligible IS NULL;
