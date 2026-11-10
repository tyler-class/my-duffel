-- Bags belong to people. A bag can be for one person ("Mia carry-on"), several
-- ("Kids' suitcase" for two children), or nobody (shared). Templates carry their own
-- bag setup, which is copied onto trips built from them.

-- Which people a bag in the catalog is for.
CREATE TABLE suitcase_people (
  suitcase_id TEXT NOT NULL REFERENCES suitcases (id) ON DELETE CASCADE,
  person_id TEXT NOT NULL REFERENCES people (id) ON DELETE CASCADE,
  PRIMARY KEY (suitcase_id, person_id)
);
CREATE INDEX idx_suitcase_people_person ON suitcase_people (person_id);

-- Which people a bag on a trip is for.
CREATE TABLE trip_bag_people (
  trip_bag_id TEXT NOT NULL REFERENCES trip_bags (id) ON DELETE CASCADE,
  person_id TEXT NOT NULL REFERENCES people (id) ON DELETE CASCADE,
  PRIMARY KEY (trip_bag_id, person_id)
);
CREATE INDEX idx_trip_bag_people_person ON trip_bag_people (person_id);

-- A template's bag setup.
CREATE TABLE template_bags (
  id TEXT PRIMARY KEY,
  template_id TEXT NOT NULL REFERENCES templates (id) ON DELETE CASCADE,
  suitcase_id TEXT REFERENCES suitcases (id) ON DELETE SET NULL,
  label TEXT NOT NULL,
  role TEXT,
  carry_on INTEGER NOT NULL DEFAULT 0,
  notes TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX idx_template_bags_template ON template_bags (template_id, sort_order);
CREATE INDEX idx_template_bags_suitcase ON template_bags (suitcase_id);

CREATE TABLE template_bag_people (
  template_bag_id TEXT NOT NULL REFERENCES template_bags (id) ON DELETE CASCADE,
  person_id TEXT NOT NULL REFERENCES people (id) ON DELETE CASCADE,
  PRIMARY KEY (template_bag_id, person_id)
);
CREATE INDEX idx_template_bag_people_person ON template_bag_people (person_id);

-- Remembers that a row should ride in its person's carry-on, so it can be placed
-- later when a matching bag is added.
ALTER TABLE trip_items ADD COLUMN carry_hint INTEGER NOT NULL DEFAULT 0;

-- Best guess for existing data: a bag whose name contains a person's name is theirs.
INSERT OR IGNORE INTO suitcase_people (suitcase_id, person_id)
SELECT s.id, p.id FROM suitcases s JOIN people p
  ON (' ' || lower(s.name) || ' ') LIKE ('% ' || lower(p.name) || ' %')
  OR (' ' || lower(s.name) || ' ') LIKE ('% ' || lower(p.name) || '''s %')
  OR (' ' || lower(s.name) || ' ') LIKE ('% ' || lower(p.name) || '’s %');

INSERT OR IGNORE INTO trip_bag_people (trip_bag_id, person_id)
SELECT b.id, p.id FROM trip_bags b JOIN people p
  ON (' ' || lower(b.label) || ' ') LIKE ('% ' || lower(p.name) || ' %')
  OR (' ' || lower(b.label) || ' ') LIKE ('% ' || lower(p.name) || '''s %')
  OR (' ' || lower(b.label) || ' ') LIKE ('% ' || lower(p.name) || '’s %');

-- Existing rows already in a carry-on bag keep that intent.
UPDATE trip_items SET carry_hint = 1
WHERE trip_bag_id IN (SELECT id FROM trip_bags WHERE carry_on = 1);
