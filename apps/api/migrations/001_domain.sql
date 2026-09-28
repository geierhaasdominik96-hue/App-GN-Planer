CREATE EXTENSION IF NOT EXISTS pgcrypto;

DO $$ BEGIN
  CREATE TYPE app_role AS ENUM ('STUDENT', 'TEACHER');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE appointment_status AS ENUM ('OPEN', 'CANCELLED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE booking_status AS ENUM ('PLANNED', 'COMPLETED', 'CANCELLED');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE TABLE IF NOT EXISTS app_users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  auth_user_id text NOT NULL UNIQUE REFERENCES "user"(id) ON DELETE CASCADE,
  display_name text NOT NULL,
  role app_role NOT NULL,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS teams (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS student_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  app_user_id uuid NOT NULL UNIQUE REFERENCES app_users(id) ON DELETE CASCADE,
  team_id uuid REFERENCES teams(id) ON DELETE SET NULL,
  must_change_password boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS teacher_profiles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  app_user_id uuid NOT NULL UNIQUE REFERENCES app_users(id) ON DELETE CASCADE,
  can_manage_accounts boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS teacher_team_access (
  teacher_profile_id uuid NOT NULL REFERENCES teacher_profiles(id) ON DELETE CASCADE,
  team_id uuid NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  PRIMARY KEY (teacher_profile_id, team_id)
);

CREATE TABLE IF NOT EXISTS rooms (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  default_capacity integer NOT NULL CHECK (default_capacity > 0),
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS assessment_definitions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  subject text NOT NULL,
  learning_house text NOT NULL,
  title text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (subject, learning_house, title)
);

CREATE TABLE IF NOT EXISTS team_assessment_requirements (
  team_id uuid NOT NULL REFERENCES teams(id) ON DELETE CASCADE,
  assessment_id uuid NOT NULL REFERENCES assessment_definitions(id) ON DELETE CASCADE,
  PRIMARY KEY (team_id, assessment_id)
);

CREATE TABLE IF NOT EXISTS weekly_schedules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  weekday smallint NOT NULL CHECK (weekday BETWEEN 1 AND 7),
  local_start_time time NOT NULL,
  local_end_time time NOT NULL,
  starts_on date NOT NULL,
  ends_on date NOT NULL,
  room_id uuid NOT NULL REFERENCES rooms(id),
  capacity integer NOT NULL CHECK (capacity > 0),
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (local_end_time > local_start_time),
  CHECK (ends_on >= starts_on)
);

CREATE TABLE IF NOT EXISTS time_slots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (ends_at > starts_at),
  UNIQUE (starts_at, ends_at)
);

CREATE TABLE IF NOT EXISTS appointments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  schedule_id uuid REFERENCES weekly_schedules(id) ON DELETE SET NULL,
  time_slot_id uuid NOT NULL REFERENCES time_slots(id),
  room_id uuid NOT NULL REFERENCES rooms(id),
  capacity integer NOT NULL CHECK (capacity > 0),
  status appointment_status NOT NULL DEFAULT 'OPEN',
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (time_slot_id, room_id),
  UNIQUE (id, time_slot_id)
);

CREATE TABLE IF NOT EXISTS bookings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  student_profile_id uuid NOT NULL REFERENCES student_profiles(id),
  appointment_id uuid NOT NULL,
  time_slot_id uuid NOT NULL,
  assessment_id uuid NOT NULL REFERENCES assessment_definitions(id),
  comment text CHECK (comment IS NULL OR length(comment) <= 1000),
  status booking_status NOT NULL DEFAULT 'PLANNED',
  completed_at timestamptz,
  cancelled_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  FOREIGN KEY (appointment_id, time_slot_id)
    REFERENCES appointments(id, time_slot_id)
);

CREATE UNIQUE INDEX IF NOT EXISTS one_planned_booking_per_student_and_slot
  ON bookings(student_profile_id, time_slot_id)
  WHERE status = 'PLANNED';

CREATE INDEX IF NOT EXISTS bookings_appointment_status_idx
  ON bookings(appointment_id, status);

CREATE INDEX IF NOT EXISTS time_slots_starts_at_idx
  ON time_slots(starts_at);

CREATE TABLE IF NOT EXISTS booking_settings (
  singleton boolean PRIMARY KEY DEFAULT true CHECK (singleton),
  booking_cutoff_hours integer NOT NULL DEFAULT 24 CHECK (booking_cutoff_hours >= 0),
  cancellation_cutoff_hours integer NOT NULL DEFAULT 72 CHECK (cancellation_cutoff_hours >= 0),
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO booking_settings (singleton) VALUES (true)
ON CONFLICT (singleton) DO NOTHING;

CREATE TABLE IF NOT EXISTS audit_log (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  actor_app_user_id uuid REFERENCES app_users(id) ON DELETE SET NULL,
  action text NOT NULL,
  entity_type text NOT NULL,
  entity_id text,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE OR REPLACE FUNCTION enforce_profile_role()
RETURNS trigger AS $$
DECLARE expected_role app_role;
BEGIN
  expected_role := CASE TG_TABLE_NAME
    WHEN 'student_profiles' THEN 'STUDENT'::app_role
    WHEN 'teacher_profiles' THEN 'TEACHER'::app_role
  END;

  IF NOT EXISTS (
    SELECT 1 FROM app_users
     WHERE id = NEW.app_user_id AND role = expected_role
  ) THEN
    RAISE EXCEPTION 'Profiltyp passt nicht zur Rolle des App-Kontos';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS student_profile_role_guard ON student_profiles;
CREATE TRIGGER student_profile_role_guard
BEFORE INSERT OR UPDATE ON student_profiles
FOR EACH ROW EXECUTE FUNCTION enforce_profile_role();

DROP TRIGGER IF EXISTS teacher_profile_role_guard ON teacher_profiles;
CREATE TRIGGER teacher_profile_role_guard
BEFORE INSERT OR UPDATE ON teacher_profiles
FOR EACH ROW EXECUTE FUNCTION enforce_profile_role();

CREATE OR REPLACE FUNCTION enforce_booking_capacity()
RETURNS trigger AS $$
DECLARE maximum integer;
DECLARE current_bookings integer;
DECLARE appointment_state appointment_status;
BEGIN
  IF NEW.status <> 'PLANNED' THEN
    RETURN NEW;
  END IF;

  SELECT capacity, status
    INTO maximum, appointment_state
    FROM appointments
   WHERE id = NEW.appointment_id
   FOR UPDATE;

  IF maximum IS NULL OR appointment_state <> 'OPEN' THEN
    RAISE EXCEPTION 'Termin ist nicht buchbar';
  END IF;

  SELECT count(*)::integer
    INTO current_bookings
    FROM bookings
   WHERE appointment_id = NEW.appointment_id
     AND status = 'PLANNED'
     AND id <> NEW.id;

  IF current_bookings >= maximum THEN
    RAISE EXCEPTION 'Termin ist ausgebucht';
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS booking_capacity_guard ON bookings;
CREATE TRIGGER booking_capacity_guard
BEFORE INSERT OR UPDATE OF appointment_id, status ON bookings
FOR EACH ROW EXECUTE FUNCTION enforce_booking_capacity();

CREATE OR REPLACE FUNCTION touch_updated_at()
RETURNS trigger AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS app_users_touch ON app_users;
CREATE TRIGGER app_users_touch BEFORE UPDATE ON app_users
FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

DROP TRIGGER IF EXISTS teams_touch ON teams;
CREATE TRIGGER teams_touch BEFORE UPDATE ON teams
FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

DROP TRIGGER IF EXISTS rooms_touch ON rooms;
CREATE TRIGGER rooms_touch BEFORE UPDATE ON rooms
FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

DROP TRIGGER IF EXISTS assessment_definitions_touch ON assessment_definitions;
CREATE TRIGGER assessment_definitions_touch BEFORE UPDATE ON assessment_definitions
FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

DROP TRIGGER IF EXISTS appointments_touch ON appointments;
CREATE TRIGGER appointments_touch BEFORE UPDATE ON appointments
FOR EACH ROW EXECUTE FUNCTION touch_updated_at();

DROP TRIGGER IF EXISTS bookings_touch ON bookings;
CREATE TRIGGER bookings_touch BEFORE UPDATE ON bookings
FOR EACH ROW EXECUTE FUNCTION touch_updated_at();
