-- Item groups: rows on a packing list or template are grouped by category ("Clothing",
-- "Documents"). Each row keeps its own category, copied from the catalog when added,
-- so it can be regrouped without touching the catalog. NULL = not in a group.
ALTER TABLE trip_items ADD COLUMN category TEXT;
ALTER TABLE template_items ADD COLUMN category TEXT;

-- The order of the groups on a list, as a JSON array of category names. Groups not
-- listed follow in the default order.
ALTER TABLE trips ADD COLUMN category_order TEXT NOT NULL DEFAULT '[]';
ALTER TABLE templates ADD COLUMN category_order TEXT NOT NULL DEFAULT '[]';

UPDATE trip_items SET category = (SELECT category FROM items WHERE items.id = trip_items.item_id)
WHERE item_id IS NOT NULL;
UPDATE template_items
SET category = (SELECT category FROM items WHERE items.id = template_items.item_id);
