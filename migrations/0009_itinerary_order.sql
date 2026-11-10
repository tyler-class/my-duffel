-- Itinerary entries now keep the order they're arranged in (they can be dragged), instead of
-- always sorting by time. Start every section in time order, as it was shown before.
-- (Local date and time: close enough to set the starting order; the app keeps connecting
-- flights together on its own.)
UPDATE itinerary_entries
SET sort_order = (
  SELECT COUNT(*) FROM itinerary_entries o
  WHERE o.section_id = itinerary_entries.section_id
    AND COALESCE(o.start_date, '9999-12-31') || ' ' || COALESCE(o.start_time, '12:00') || ' ' || o.created_at || ' ' || o.id
      < COALESCE(itinerary_entries.start_date, '9999-12-31') || ' ' || COALESCE(itinerary_entries.start_time, '12:00') || ' ' || itinerary_entries.created_at || ' ' || itinerary_entries.id
);
