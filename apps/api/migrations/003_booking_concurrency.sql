ALTER TABLE bookings
  ADD COLUMN IF NOT EXISTS version integer NOT NULL DEFAULT 1 CHECK (version > 0);

CREATE OR REPLACE FUNCTION enforce_student_booking_overlap()
RETURNS trigger AS $$
DECLARE requested_start timestamptz;
DECLARE requested_end timestamptz;
BEGIN
  IF NEW.status <> 'PLANNED' THEN
    RETURN NEW;
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(NEW.student_profile_id::text, 0));

  SELECT starts_at, ends_at
    INTO requested_start, requested_end
    FROM time_slots
   WHERE id = NEW.time_slot_id;

  IF EXISTS (
    SELECT 1
      FROM bookings b
      JOIN time_slots ts ON ts.id = b.time_slot_id
     WHERE b.student_profile_id = NEW.student_profile_id
       AND b.status = 'PLANNED'
       AND b.id <> NEW.id
       AND ts.starts_at < requested_end
       AND ts.ends_at > requested_start
  ) THEN
    RAISE EXCEPTION 'Zu dieser Zeit besteht bereits eine andere Anmeldung';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS booking_overlap_guard ON bookings;
CREATE TRIGGER booking_overlap_guard
BEFORE INSERT OR UPDATE OF student_profile_id, time_slot_id, status ON bookings
FOR EACH ROW EXECUTE FUNCTION enforce_student_booking_overlap();

DROP TRIGGER IF EXISTS booking_settings_touch ON booking_settings;
CREATE TRIGGER booking_settings_touch BEFORE UPDATE ON booking_settings
FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

CREATE INDEX IF NOT EXISTS appointments_schedule_idx ON appointments(schedule_id);
CREATE INDEX IF NOT EXISTS bookings_student_status_idx ON bookings(student_profile_id, status);
