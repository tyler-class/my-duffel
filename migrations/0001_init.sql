-- Duffel schema v1.
-- ids are TEXT uuids; timestamps are ISO-8601 strings; booleans are INTEGER 0/1;
-- tag sets are JSON arrays stored as TEXT.

CREATE TABLE people (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  role TEXT,
  color TEXT NOT NULL DEFAULT 'mist',
  emoji TEXT,
  notes TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE items (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  category TEXT,
  qty_mode TEXT NOT NULL DEFAULT 'fixed' CHECK (qty_mode IN ('fixed', 'per_day', 'per_night')),
  qty REAL NOT NULL DEFAULT 1,
  max_qty REAL,
  climate_tags TEXT NOT NULL DEFAULT '[]',
  activity_tags TEXT NOT NULL DEFAULT '[]',
  length_in REAL,
  width_in REAL,
  height_in REAL,
  dimensions_source TEXT,
  not_in_suitcase INTEGER NOT NULL DEFAULT 0,
  usually_carry_on INTEGER NOT NULL DEFAULT 0,
  notes TEXT,
  archived INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE item_default_people (
  item_id TEXT NOT NULL REFERENCES items (id) ON DELETE CASCADE,
  person_id TEXT NOT NULL REFERENCES people (id) ON DELETE CASCADE,
  PRIMARY KEY (item_id, person_id)
);
CREATE INDEX idx_item_default_people_person ON item_default_people (person_id);

CREATE TABLE suitcases (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  type TEXT,
  length_in REAL,
  width_in REAL,
  height_in REAL,
  capacity_l REAL,
  max_weight_lb REAL,
  notes TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE templates (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  trip_type TEXT,
  climate TEXT,
  activities TEXT NOT NULL DEFAULT '[]',
  notes TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- Template items have no packed state: a template is a plan, not a list being packed.
CREATE TABLE template_items (
  id TEXT PRIMARY KEY,
  template_id TEXT NOT NULL REFERENCES templates (id) ON DELETE CASCADE,
  item_id TEXT NOT NULL REFERENCES items (id) ON DELETE CASCADE,
  qty_mode_override TEXT CHECK (qty_mode_override IN ('fixed', 'per_day', 'per_night')),
  qty_override REAL,
  carry_on INTEGER NOT NULL DEFAULT 0, -- placement hint: goes in the person's carry-on bag
  notes TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX idx_template_items_template ON template_items (template_id, sort_order);
CREATE INDEX idx_template_items_item ON template_items (item_id);

CREATE TABLE template_item_assignees (
  template_item_id TEXT NOT NULL REFERENCES template_items (id) ON DELETE CASCADE,
  person_id TEXT NOT NULL REFERENCES people (id) ON DELETE CASCADE,
  PRIMARY KEY (template_item_id, person_id)
);
CREATE INDEX idx_template_item_assignees_person ON template_item_assignees (person_id);

CREATE TABLE trips (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  template_id TEXT REFERENCES templates (id) ON DELETE SET NULL,
  cloned_from_trip_id TEXT REFERENCES trips (id) ON DELETE SET NULL,
  trip_type TEXT,
  start_date TEXT,
  end_date TEXT,
  days INTEGER,
  nights INTEGER,
  destination TEXT,
  climate TEXT,
  activities TEXT NOT NULL DEFAULT '[]',
  status TEXT,
  notes TEXT,
  archived_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX idx_trips_template ON trips (template_id);
CREATE INDEX idx_trips_cloned_from ON trips (cloned_from_trip_id);

CREATE TABLE trip_travelers (
  trip_id TEXT NOT NULL REFERENCES trips (id) ON DELETE CASCADE,
  person_id TEXT NOT NULL REFERENCES people (id) ON DELETE CASCADE,
  PRIMARY KEY (trip_id, person_id)
);
CREATE INDEX idx_trip_travelers_person ON trip_travelers (person_id);

-- A specific bag on a specific trip. Carry-on belongs to the bag; items inherit it.
CREATE TABLE trip_bags (
  id TEXT PRIMARY KEY,
  trip_id TEXT NOT NULL REFERENCES trips (id) ON DELETE CASCADE,
  suitcase_id TEXT REFERENCES suitcases (id) ON DELETE SET NULL,
  label TEXT NOT NULL,
  role TEXT,
  carry_on INTEGER NOT NULL DEFAULT 0,
  notes TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX idx_trip_bags_trip ON trip_bags (trip_id, sort_order);
CREATE INDEX idx_trip_bags_suitcase ON trip_bags (suitcase_id);

-- The packing list. Placement is exactly one of: in a bag (trip_bag_id),
-- explicitly no bag (no_bag = 1), or not decided yet (neither).
CREATE TABLE trip_items (
  id TEXT PRIMARY KEY,
  trip_id TEXT NOT NULL REFERENCES trips (id) ON DELETE CASCADE,
  item_id TEXT REFERENCES items (id) ON DELETE SET NULL,
  name TEXT NOT NULL,
  person_id TEXT REFERENCES people (id) ON DELETE SET NULL,
  trip_bag_id TEXT REFERENCES trip_bags (id) ON DELETE SET NULL,
  no_bag INTEGER NOT NULL DEFAULT 0,
  calc_mode TEXT CHECK (calc_mode IN ('fixed', 'per_day', 'per_night')),
  calc_unit_qty REAL,
  calc_max REAL,
  qty REAL,
  qty_override REAL,
  packed INTEGER NOT NULL DEFAULT 0,
  packed_at TEXT,
  notes TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  CHECK (NOT (no_bag = 1 AND trip_bag_id IS NOT NULL))
);
CREATE INDEX idx_trip_items_trip ON trip_items (trip_id, sort_order);
CREATE INDEX idx_trip_items_item ON trip_items (item_id);
CREATE INDEX idx_trip_items_person ON trip_items (person_id);
CREATE INDEX idx_trip_items_bag ON trip_items (trip_bag_id);

CREATE TABLE settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE login_attempts (
  ip TEXT NOT NULL,
  attempted_at TEXT NOT NULL
);
CREATE INDEX idx_login_attempts_ip ON login_attempts (ip, attempted_at);
