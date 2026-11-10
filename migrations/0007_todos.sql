-- To-dos: things to do before, during and after a trip ("Book the kennel", "Check out by 11").
-- A to-do's date is one of: none, a fixed date, or relative to the trip ("3 days before the
-- trip starts"). Relative dates are worked out from the trip's dates, so they move with them.

CREATE TABLE trip_todos (
  id TEXT PRIMARY KEY,
  trip_id TEXT NOT NULL REFERENCES trips (id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  -- 'pre', 'during' or 'after'.
  phase TEXT NOT NULL DEFAULT 'pre',
  -- 'none', 'fixed' (due_date) or 'relative' (rel_days, rel_dir, rel_anchor).
  date_mode TEXT NOT NULL DEFAULT 'none',
  due_date TEXT,
  rel_days INTEGER,
  -- 'before', 'on' or 'after'.
  rel_dir TEXT,
  -- 'start', 'middle' or 'end' of the trip.
  rel_anchor TEXT,
  notes TEXT,
  done INTEGER NOT NULL DEFAULT 0,
  done_at TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX idx_trip_todos_trip ON trip_todos (trip_id, sort_order);

CREATE TABLE template_todos (
  id TEXT PRIMARY KEY,
  template_id TEXT NOT NULL REFERENCES templates (id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  phase TEXT NOT NULL DEFAULT 'pre',
  date_mode TEXT NOT NULL DEFAULT 'none',
  due_date TEXT,
  rel_days INTEGER,
  rel_dir TEXT,
  rel_anchor TEXT,
  notes TEXT,
  sort_order INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX idx_template_todos_template ON template_todos (template_id, sort_order);
