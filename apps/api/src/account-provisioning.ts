import { randomInt } from "node:crypto";
import type { StudentAccountSummary } from "@gn-planer/contracts";
import { provisioningAuth } from "./auth.js";
import { pool } from "./database.js";

const passwordAlphabet = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789!?#";

export function createInitialPassword() {
  let password = "Start!";
  for (let index = 0; index < 14; index += 1) {
    password += passwordAlphabet[randomInt(passwordAlphabet.length)];
  }
  return password;
}

export function createNumericInitialPassword() {
  let password = String(randomInt(1, 10));
  for (let index = 1; index < 10; index += 1) {
    password += String(randomInt(10));
  }
  return password;
}

export function createLoginIdBase(displayName: string) {
  const parts = displayName
    .replace(/ß/g, "ss")
    .replace(/Ä/g, "Ae")
    .replace(/Ö/g, "Oe")
    .replace(/Ü/g, "Ue")
    .replace(/ä/g, "ae")
    .replace(/ö/g, "oe")
    .replace(/ü/g, "ue")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);

  const fallback = "schueler";
  if (parts.length === 0) return fallback;
  if (parts.length === 1) return parts[0]!.slice(0, 24).padEnd(3, "x");
  return `${parts[0]![0]}${parts.at(-1)!}`.slice(0, 24).padEnd(3, "x");
}

async function nextLoginId(displayName: string) {
  const base = createLoginIdBase(displayName);
  for (let suffix = 0; suffix <= 999; suffix += 1) {
    const candidate = suffix === 0 ? base : `${base.slice(0, 28)}${suffix}`;
    const existing = await pool.query('SELECT 1 FROM "user" WHERE username = $1', [candidate]);
    if (existing.rowCount === 0) return candidate;
  }
  throw new Error("Für diesen Namen konnte keine freie Anmelde-ID erzeugt werden.");
}

interface CreateTeacherInput {
  displayName: string;
  teamIds: string[];
  actorAppUserId: string;
  canManageAccounts?: boolean;
  canManageTeams?: boolean;
  canManageAssessments?: boolean;
  canManagePlanning?: boolean;
}

export async function createTeacherAccount(input: CreateTeacherInput) {
  const isAdmin = input.canManageAccounts ?? false;
  const canManageTeams = isAdmin || (input.canManageTeams ?? false);
  const canManageAssessments = isAdmin || (input.canManageAssessments ?? false);
  const canManagePlanning = isAdmin || (input.canManagePlanning ?? false);
  if (!isAdmin && input.teamIds.length === 0) {
    const error = new Error("Eine Lehrkraft ohne Adminrecht benötigt mindestens ein zugewiesenes Team.");
    error.name = "TEAM_REQUIRED";
    throw error;
  }
  const validTeams = await pool.query<{ id: string }>(
    "SELECT id FROM teams WHERE active = true AND id = ANY($1::uuid[])",
    [input.teamIds]
  );
  if (validTeams.rowCount !== input.teamIds.length) throw new Error("Mindestens ein ausgewähltes Team existiert nicht mehr.");

  const loginId = await nextLoginId(input.displayName);
  const initialPassword = createInitialPassword();
  const created = await provisioningAuth.api.signUpEmail({
    body: {
      name: input.displayName,
      email: `${loginId}@accounts.gn-planer.invalid`,
      password: initialPassword,
      username: loginId,
      displayUsername: loginId
    }
  });

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    if (isAdmin) {
      await client.query("SELECT pg_advisory_xact_lock(hashtext('gn-planer-admin-accounts'))");
      const admins = await client.query<{ count: number }>(
        `SELECT count(*)::int AS count
           FROM teacher_profiles tp
           JOIN app_users au ON au.id = tp.app_user_id
          WHERE tp.can_manage_accounts = true AND au.active = true`
      );
      if (admins.rows[0]!.count >= 2) {
        const error = new Error("Es sind bereits zwei aktive Administratorkonten vorhanden.");
        error.name = "ADMIN_LIMIT";
        throw error;
      }
    }
    const appUser = await client.query<{ id: string; created_at: string }>(
      `INSERT INTO app_users (auth_user_id, display_name, role)
       VALUES ($1, $2, 'TEACHER') RETURNING id, created_at`,
      [created.user.id, input.displayName]
    );
    const teacherProfile = await client.query<{ id: string }>(
      `INSERT INTO teacher_profiles
         (app_user_id, can_manage_accounts, can_manage_teams,
          can_manage_assessments, can_manage_planning)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id`,
      [
        appUser.rows[0]!.id,
        isAdmin,
        canManageTeams,
        canManageAssessments,
        canManagePlanning
      ]
    );
    await client.query(
      `INSERT INTO teacher_team_access (teacher_profile_id, team_id)
       SELECT $1, value::uuid FROM unnest($2::text[]) AS value`,
      [teacherProfile.rows[0]!.id, input.teamIds]
    );
    await client.query(
      `INSERT INTO audit_log (actor_app_user_id, action, entity_type, entity_id, details)
       VALUES ($1, 'TEACHER_ACCOUNT_CREATED', 'teacher_profile', $2, $3::jsonb)`,
      [
        input.actorAppUserId,
        teacherProfile.rows[0]!.id,
        JSON.stringify({
          loginId,
          teamIds: input.teamIds,
          canManageAccounts: isAdmin,
          canManageTeams,
          canManageAssessments,
          canManagePlanning
        })
      ]
    );
    await client.query("COMMIT");
    const teacher = {
      id: teacherProfile.rows[0]!.id,
      displayName: input.displayName,
      loginId,
      active: true,
      canManageAccounts: isAdmin,
      canManageTeams,
      canManageAssessments,
      canManagePlanning,
      teamIds: input.teamIds,
      createdAt: appUser.rows[0]!.created_at
    };
    return { teacher, initialPassword };
  } catch (error) {
    await client.query("ROLLBACK");
    await pool.query('DELETE FROM "user" WHERE id = $1', [created.user.id]);
    throw error;
  } finally {
    client.release();
  }
}

interface CreateStudentInput {
  displayName: string;
  teamId: string | null;
  actorAppUserId: string;
  password?: string;
  invitationId?: string;
  simpleInitialPassword?: boolean;
  /**
   * Wird ausschließlich vom geschützten Demo-Service gesetzt. So werden
   * Auth-Konto und Schulprofil atomar dem löschbaren Demo-Bestand zugeordnet.
   */
  demoDatasetId?: string;
}

export async function createStudentAccount(input: CreateStudentInput) {
  if (input.teamId) {
    const team = await pool.query(
      `SELECT 1
         FROM teams
        WHERE id = $1
          AND (active = true OR ($2::uuid IS NOT NULL AND demo_dataset_id = $2::uuid))`,
      [input.teamId, input.demoDatasetId ?? null]
    );
    if (team.rowCount === 0) throw new Error("Das ausgewählte Team existiert nicht mehr.");
  }

  const loginId = await nextLoginId(input.displayName);
  const initialPassword = input.password ?? (
    input.simpleInitialPassword ? createNumericInitialPassword() : createInitialPassword()
  );
  const internalEmail = `${loginId}@accounts.gn-planer.invalid`;
  const created = await provisioningAuth.api.signUpEmail({
    body: {
      name: input.displayName,
      email: internalEmail,
      password: initialPassword,
      username: loginId,
      displayUsername: loginId
    }
  });

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    if (input.invitationId) {
      const invitation = await client.query(
        `SELECT 1
           FROM team_invitations
          WHERE id = $1
            AND team_id = $2
            AND active = true
            AND expires_at > now()
            AND use_count < max_uses
          FOR UPDATE`,
        [input.invitationId, input.teamId]
      );
      if (invitation.rowCount === 0) {
        const error = new Error("Diese Einladung ist nicht mehr gültig.");
        error.name = "INVITATION_UNAVAILABLE";
        throw error;
      }
    }

    const appUser = await client.query<{ id: string; created_at: string }>(
      `INSERT INTO app_users (auth_user_id, display_name, role, demo_dataset_id)
       VALUES ($1, $2, 'STUDENT', $3)
       RETURNING id, created_at`,
      [created.user.id, input.displayName, input.demoDatasetId ?? null]
    );
    const studentProfile = await client.query<{ id: string }>(
      `INSERT INTO student_profiles (app_user_id, team_id, must_change_password)
       VALUES ($1, $2, $3)
       RETURNING id`,
      [appUser.rows[0]!.id, input.teamId, !input.password]
    );
    if (input.invitationId) {
      await client.query(
        `UPDATE team_invitations
            SET use_count = use_count + 1,
                active = CASE WHEN use_count + 1 >= max_uses THEN false ELSE active END,
                last_used_at = now()
          WHERE id = $1`,
        [input.invitationId]
      );
    }
    await client.query(
      `INSERT INTO audit_log
         (actor_app_user_id, action, entity_type, entity_id, details, demo_dataset_id)
       VALUES ($1, 'STUDENT_ACCOUNT_CREATED', 'student_profile', $2, $3::jsonb, $4)`,
      [
        input.actorAppUserId,
        studentProfile.rows[0]!.id,
        JSON.stringify({ loginId, teamId: input.teamId }),
        input.demoDatasetId ?? null
      ]
    );
    await client.query("COMMIT");

    const student: StudentAccountSummary = {
      id: studentProfile.rows[0]!.id,
      displayName: input.displayName,
      loginId,
      teamId: input.teamId,
      teamName: null,
      active: true,
      mustChangePassword: !input.password,
      createdAt: appUser.rows[0]!.created_at
    };
    return { student, initialPassword };
  } catch (error) {
    await client.query("ROLLBACK");
    await pool.query('DELETE FROM "user" WHERE id = $1', [created.user.id]);
    throw error;
  } finally {
    client.release();
  }
}
