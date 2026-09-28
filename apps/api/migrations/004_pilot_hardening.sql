CREATE EXTENSION IF NOT EXISTS btree_gist;

ALTER TABLE appointments
  ADD COLUMN starts_at timestamptz,
  ADD COLUMN ends_at timestamptz;

UPDATE appointments a
   SET starts_at = ts.starts_at,
       ends_at = ts.ends_at
  FROM time_slots ts
 WHERE ts.id = a.time_slot_id;

CREATE OR REPLACE FUNCTION sync_appointment_times()
RETURNS trigger AS $$
BEGIN
  SELECT starts_at, ends_at
    INTO NEW.starts_at, NEW.ends_at
    FROM time_slots
   WHERE id = NEW.time_slot_id;

  IF NEW.starts_at IS NULL OR NEW.ends_at IS NULL THEN
    RAISE EXCEPTION 'Zeitfenster wurde nicht gefunden';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS appointment_time_sync ON appointments;
CREATE TRIGGER appointment_time_sync
BEFORE INSERT OR UPDATE OF time_slot_id ON appointments
FOR EACH ROW EXECUTE FUNCTION sync_appointment_times();

ALTER TABLE appointments
  ALTER COLUMN starts_at SET NOT NULL,
  ALTER COLUMN ends_at SET NOT NULL,
  ADD CONSTRAINT appointments_no_open_room_overlap
    EXCLUDE USING gist (
      room_id WITH =,
      tstzrange(starts_at, ends_at, '[)') WITH &&
    ) WHERE (status = 'OPEN');

CREATE OR REPLACE FUNCTION enforce_room_appointment_overlap()
RETURNS trigger AS $$
DECLARE requested_start timestamptz;
DECLARE requested_end timestamptz;
BEGIN
  IF NEW.status <> 'OPEN' THEN
    RETURN NEW;
  END IF;

  -- Liefert früh eine verständliche Meldung. Die GiST-Ausschlussregel oben ist
  -- zusätzlich die maßgebliche Absicherung gegen parallele Schreibvorgänge.
  PERFORM pg_advisory_xact_lock(hashtextextended('appointment-room:' || NEW.room_id::text, 0));

  SELECT starts_at, ends_at
    INTO requested_start, requested_end
    FROM time_slots
   WHERE id = NEW.time_slot_id;

  IF requested_start IS NULL OR requested_end IS NULL THEN
    RAISE EXCEPTION 'Zeitfenster wurde nicht gefunden';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM appointments a
      JOIN time_slots ts ON ts.id = a.time_slot_id
     WHERE a.room_id = NEW.room_id
       AND a.status = 'OPEN'
       AND a.id <> NEW.id
       AND ts.starts_at < requested_end
       AND ts.ends_at > requested_start
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = '23P01',
      MESSAGE = 'Raum ist zum ausgewählten Zeitraum bereits belegt';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS appointment_room_overlap_guard ON appointments;
CREATE TRIGGER appointment_room_overlap_guard
BEFORE INSERT OR UPDATE OF time_slot_id, room_id, status ON appointments
FOR EACH ROW EXECUTE FUNCTION enforce_room_appointment_overlap();
