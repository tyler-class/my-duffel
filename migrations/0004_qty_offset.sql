-- A per-day or per-night count can add or take away a few: "1 per day, plus 2".
ALTER TABLE items ADD COLUMN qty_offset REAL NOT NULL DEFAULT 0;
-- NULL = use the catalog item's offset.
ALTER TABLE template_items ADD COLUMN qty_offset_override REAL;
-- Snapshot on the packing list, so a change of dates keeps the offset.
ALTER TABLE trip_items ADD COLUMN calc_offset REAL;
