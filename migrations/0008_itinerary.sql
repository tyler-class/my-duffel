-- Itinerary: a trip's plan, as sections in order ("Getting there", "Lisbon", "Heading home").
-- A section is travel (getting from one place to another) or a stay (time in one place).
-- Entries are transport (a departure and its arrival), lodging, plans and notes. Times are
-- stored as printed on the booking: a local date and time plus the place's IANA time zone.
-- Itineraries belong to one trip: they are not copied when a trip is cloned or saved as a
-- template.

CREATE TABLE itinerary_sections (
  id TEXT PRIMARY KEY,
  trip_id TEXT NOT NULL REFERENCES trips (id) ON DELETE CASCADE,
  -- 'travel' or 'stay'.
  kind TEXT NOT NULL DEFAULT 'stay',
  title TEXT NOT NULL,
  notes TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX idx_itinerary_sections_trip ON itinerary_sections (trip_id, sort_order);

CREATE TABLE itinerary_entries (
  id TEXT PRIMARY KEY,
  section_id TEXT NOT NULL REFERENCES itinerary_sections (id) ON DELETE CASCADE,
  -- 'transport', 'lodging', 'plan' or 'note'.
  kind TEXT NOT NULL DEFAULT 'plan',
  -- Transport: 'plane', 'train', 'bus', 'boat', 'car' or 'other'.
  mode TEXT,
  title TEXT,
  -- Transport: the airline or company and the flight or train number.
  carrier TEXT,
  number TEXT,
  -- Start: a departure, a check-in, or when a plan starts.
  start_place TEXT,
  -- An airport or station code ("BOS").
  start_code TEXT,
  start_date TEXT,
  -- Local "HH:MM".
  start_time TEXT,
  start_tz TEXT,
  -- End: the arrival, the check-out, or when a plan ends.
  end_place TEXT,
  end_code TEXT,
  end_date TEXT,
  end_time TEXT,
  end_tz TEXT,
  address TEXT,
  confirmation TEXT,
  -- Seat, terminal, gate, room: short details.
  details TEXT,
  notes TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX idx_itinerary_entries_section ON itinerary_entries (section_id, sort_order);
