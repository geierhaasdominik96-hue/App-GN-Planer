-- Granulare Lehrkraftrechte. Das bestehende Masterkonto bleibt Admin und
-- erhaelt damit bei der Migration automatisch alle neuen Einzelrechte.
ALTER TABLE teacher_profiles
  ADD COLUMN IF NOT EXISTS can_manage_teams boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS can_manage_assessments boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS can_manage_planning boolean NOT NULL DEFAULT false;

UPDATE teacher_profiles
   SET can_manage_teams = true,
       can_manage_assessments = true,
       can_manage_planning = true
 WHERE can_manage_accounts = true;
