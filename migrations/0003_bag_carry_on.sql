-- Carry-on is a property of a bag, separate from its type (suitcase, backpack, cooler…).
ALTER TABLE suitcases ADD COLUMN carry_on INTEGER NOT NULL DEFAULT 0;

UPDATE suitcases SET carry_on = 1
WHERE lower(type) IN ('carry-on', 'carry on', 'backpack', 'diaper bag', 'personal item');

-- "Carry-on" and "Checked" were never really types of bag.
UPDATE suitcases SET type = 'Suitcase' WHERE lower(type) IN ('carry-on', 'carry on', 'checked');
