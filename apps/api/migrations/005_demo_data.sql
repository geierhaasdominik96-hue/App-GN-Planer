CREATE TABLE demo_datasets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_by_app_user_id uuid REFERENCES app_users(id) ON DELETE SET NULL,
  ready boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Der Planer verwaltet bewusst höchstens einen vorführbaren Datenbestand.
-- Dadurch sind Anlegen, Zurücksetzen und Löschen auch bei mehreren
-- Server-Instanzen eindeutig.
CREATE UNIQUE INDEX demo_datasets_singleton
  ON demo_datasets ((true));

ALTER TABLE app_users
  ADD COLUMN demo_dataset_id uuid REFERENCES demo_datasets(id) ON DELETE RESTRICT;

ALTER TABLE teams
  ADD COLUMN demo_dataset_id uuid REFERENCES demo_datasets(id) ON DELETE RESTRICT;

ALTER TABLE rooms
  ADD COLUMN demo_dataset_id uuid REFERENCES demo_datasets(id) ON DELETE RESTRICT;

ALTER TABLE assessment_definitions
  ADD COLUMN demo_dataset_id uuid REFERENCES demo_datasets(id) ON DELETE RESTRICT;

ALTER TABLE weekly_schedules
  ADD COLUMN demo_dataset_id uuid REFERENCES demo_datasets(id) ON DELETE RESTRICT;

ALTER TABLE time_slots
  ADD COLUMN demo_dataset_id uuid REFERENCES demo_datasets(id) ON DELETE RESTRICT;

ALTER TABLE appointments
  ADD COLUMN demo_dataset_id uuid REFERENCES demo_datasets(id) ON DELETE RESTRICT;

ALTER TABLE bookings
  ADD COLUMN demo_dataset_id uuid REFERENCES demo_datasets(id) ON DELETE RESTRICT;

ALTER TABLE team_invitations
  ADD COLUMN demo_dataset_id uuid REFERENCES demo_datasets(id) ON DELETE RESTRICT;

ALTER TABLE audit_log
  ADD COLUMN demo_dataset_id uuid REFERENCES demo_datasets(id) ON DELETE RESTRICT;

CREATE INDEX app_users_demo_dataset_idx ON app_users (demo_dataset_id)
  WHERE demo_dataset_id IS NOT NULL;
CREATE INDEX teams_demo_dataset_idx ON teams (demo_dataset_id)
  WHERE demo_dataset_id IS NOT NULL;
CREATE INDEX rooms_demo_dataset_idx ON rooms (demo_dataset_id)
  WHERE demo_dataset_id IS NOT NULL;
CREATE INDEX assessments_demo_dataset_idx ON assessment_definitions (demo_dataset_id)
  WHERE demo_dataset_id IS NOT NULL;
CREATE INDEX schedules_demo_dataset_idx ON weekly_schedules (demo_dataset_id)
  WHERE demo_dataset_id IS NOT NULL;
CREATE INDEX time_slots_demo_dataset_idx ON time_slots (demo_dataset_id)
  WHERE demo_dataset_id IS NOT NULL;
CREATE INDEX appointments_demo_dataset_idx ON appointments (demo_dataset_id)
  WHERE demo_dataset_id IS NOT NULL;
CREATE INDEX bookings_demo_dataset_idx ON bookings (demo_dataset_id)
  WHERE demo_dataset_id IS NOT NULL;
CREATE INDEX invitations_demo_dataset_idx ON team_invitations (demo_dataset_id)
  WHERE demo_dataset_id IS NOT NULL;
CREATE INDEX audit_log_demo_dataset_idx ON audit_log (demo_dataset_id)
  WHERE demo_dataset_id IS NOT NULL;

-- Einladungen, die für ein Demo-Team erzeugt werden, gehören ebenfalls
-- vollständig zum löschbaren Demo-Bestand. Ein echter Schüler, der bereits
-- über eine Einladung angelegt wurde, wird hingegen durch die Prüfungen im
-- Demo-Service geschützt.
CREATE OR REPLACE FUNCTION inherit_invitation_demo_dataset()
RETURNS trigger AS $$
BEGIN
  SELECT demo_dataset_id
    INTO NEW.demo_dataset_id
    FROM teams
   WHERE id = NEW.team_id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS team_invitation_demo_dataset ON team_invitations;
CREATE TRIGGER team_invitation_demo_dataset
BEFORE INSERT OR UPDATE OF team_id ON team_invitations
FOR EACH ROW EXECUTE FUNCTION inherit_invitation_demo_dataset();

-- Buchungen eines Demo-Schülerkontos bleiben auch dann sicher zuordenbar,
-- wenn das Konto während einer Vorführung einen regulären Termin auswählt.
-- Buchungen echter Schüler werden nie automatisch als Demo markiert.
CREATE OR REPLACE FUNCTION inherit_booking_demo_dataset()
RETURNS trigger AS $$
DECLARE student_demo_dataset_id uuid;
BEGIN
  SELECT au.demo_dataset_id
    INTO student_demo_dataset_id
    FROM student_profiles sp
    JOIN app_users au ON au.id = sp.app_user_id
   WHERE sp.id = NEW.student_profile_id;

  IF student_demo_dataset_id IS NOT NULL THEN
    IF NEW.demo_dataset_id IS NOT NULL
       AND NEW.demo_dataset_id <> student_demo_dataset_id THEN
      RAISE EXCEPTION 'Buchung und Demo-Schülerkonto gehören nicht zum selben Demo-Datensatz';
    END IF;
    NEW.demo_dataset_id := student_demo_dataset_id;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS booking_demo_dataset ON bookings;
CREATE TRIGGER booking_demo_dataset
BEFORE INSERT OR UPDATE OF student_profile_id ON bookings
FOR EACH ROW EXECUTE FUNCTION inherit_booking_demo_dataset();
