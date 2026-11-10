-- Auto pack: an item can go into a type of bag ("Diaper bag", "Cooler"). When a trip is
-- built, it goes into its person's bag of that type. NULL = no type (main or carry-on bag).
ALTER TABLE items ADD COLUMN pack_type TEXT;
-- NULL = the catalog item's choice.
ALTER TABLE template_items ADD COLUMN pack_type TEXT;
-- Kept on the packing list, so the row finds its bag if one of that type is added later.
ALTER TABLE trip_items ADD COLUMN pack_type TEXT;
