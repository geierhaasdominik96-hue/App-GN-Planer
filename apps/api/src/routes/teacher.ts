import type {
  BatchCreateStudentsResponse,
  CreateInvitationResponse,
  CreateStudentResponse,
  CreateTeacherResponse,
  CreateTeamResponse,
  StudentAccountSummary,
  StudentManagementResponse,
  ResetStudentPasswordResponse,
  SystemStatusResponse,
  TeacherOverviewResponse,
  TeacherAccountSummary,
  TeamInvitationSummary,
  TeamSummary
} from "@gn-planer/contracts";
import { hashPassword } from "better-auth/crypto";
import { Router } from "express";
import { z } from "zod";
import {
  createInitialPassword,
  createNumericInitialPassword,
  createStudentAccount,
  createTeacherAccount
} from "../account-provisioning.js";
import { pool } from "../database.js";
import { getDatabaseBackupStatus } from "../backup.js";
import { env } from "../env.js";
import { createInvitationToken, hashInvitationToken } from "../invitation-tokens.js";
import {
  hasTeacherPermission,
  type Principal,
  type TeacherPermission
} from "../security.js";

interface CountRow {
  teams: number;
  students: number;
  upcoming_bookings: number;
  upcoming_appointments: number;
}

export const teacherRouter = Router();

const teamSchema = z.object({ name: z.string().trim().min(1).max(80) });
const studentSchema = z.object({
  displayName: z.string().trim().min(2).max(120),
  teamId: z.string().uuid().nullable()
});
const invitationSchema = z.object({
  teamId: z.string().uuid(),
  validDays: z.number().int().min(1).max(30),
  maxUses: z.number().int().min(1).max(100)
});
const batchStudentSchema = z.object({
  teamId: z.string().uuid(),
  names: z.array(z.string().trim().min(2).max(120)).min(1).max(60)
});
const updateStudentSchema = z.object({
  displayName: z.string().trim().min(2).max(120),
  loginId: z.string().trim().toLowerCase().regex(/^[a-z0-9._-]{3,32}$/),
  teamId: z.string().uuid().nullable(),
  active: z.boolean()
});
const teacherSchema = z.object({
  displayName: z.string().trim().min(2).max(120),
  teamIds: z.array(z.string().uuid()).max(200),
  canManageAccounts: z.boolean().optional().default(false),
  canManageTeams: z.boolean().optional().default(false),
  canManageAssessments: z.boolean().optional().default(false),
  canManagePlanning: z.boolean().optional().default(false)
});
const updateTeacherSchema = z.object({
  displayName: z.string().trim().min(2).max(120),
  teamIds: z.array(z.string().uuid()).max(200),
  canManageAccounts: z.boolean().optional(),
  canManageTeams: z.boolean().optional(),
  canManageAssessments: z.boolean().optional(),
  canManagePlanning: z.boolean().optional(),
  loginId: z.string().trim().toLowerCase().regex(/^[a-z0-9._-]{3,32}$/),
  active: z.boolean()
});

function requirePermission(
  principal: Principal,
  permission: TeacherPermission,
  message = "Für diese Aktion fehlt die Berechtigung."
) {
  if (!hasTeacherPermission(principal, permission)) {
    const error = new Error(message);
    error.name = "FORBIDDEN";
    throw error;
  }
}

async function mayAccessTeam(principal: Principal, teamId: string) {
  if (principal.canManageAccounts) return true;
  const result = await pool.query(
    `SELECT 1
       FROM teacher_profiles tp
       JOIN teacher_team_access tta ON tta.teacher_profile_id = tp.id
      WHERE tp.app_user_id = $1 AND tta.team_id = $2`,
    [principal.appUserId, teamId]
  );
  return Boolean(result.rowCount);
}

async function requireTeamAccess(principal: Principal, teamId: string) {
  if (!await mayAccessTeam(principal, teamId)) {
    const error = new Error("Für dieses Team fehlt die Berechtigung.");
    error.name = "FORBIDDEN";
    throw error;
  }
}

teacherRouter.get("/overview", async (request, response, next) => {
  try {
    const principal = request.principal!;
    const result = await pool.query<CountRow>(
      `SELECT
         (SELECT count(*)::int FROM teams t
           WHERE t.active = true AND ($1::boolean OR EXISTS (
             SELECT 1 FROM teacher_profiles tp
             JOIN teacher_team_access tta ON tta.teacher_profile_id = tp.id
             WHERE tp.app_user_id = $2 AND tta.team_id = t.id
           ))) AS teams,
         (SELECT count(*)::int FROM student_profiles sp
           WHERE $1::boolean OR EXISTS (
             SELECT 1 FROM teacher_profiles tp
             JOIN teacher_team_access tta ON tta.teacher_profile_id = tp.id
             WHERE tp.app_user_id = $2 AND tta.team_id = sp.team_id
           )) AS students,
         (SELECT count(*)::int
            FROM bookings b
            JOIN student_profiles sp ON sp.id = b.student_profile_id
            JOIN time_slots ts ON ts.id = b.time_slot_id
           WHERE b.status = 'PLANNED' AND ts.starts_at > now()
             AND ($1::boolean OR EXISTS (
               SELECT 1 FROM teacher_profiles tp
               JOIN teacher_team_access tta ON tta.teacher_profile_id = tp.id
               WHERE tp.app_user_id = $2 AND tta.team_id = sp.team_id
             ))) AS upcoming_bookings,
         (SELECT count(*)::int
            FROM appointments a
            JOIN time_slots ts ON ts.id = a.time_slot_id
           WHERE a.status = 'OPEN' AND ts.starts_at > now()) AS upcoming_appointments`
      , [principal.canManageAccounts, principal.appUserId]
    );
    const row = result.rows[0]!;
    const payload: TeacherOverviewResponse = {
      counts: {
        teams: row.teams,
        students: row.students,
        upcomingBookings: row.upcoming_bookings,
        upcomingAppointments: row.upcoming_appointments
      }
    };
    response.json(payload);
  } catch (error) {
    next(error);
  }
});

teacherRouter.get("/system-status", (request, response) => {
  if (!request.principal!.canManageAccounts) {
    response.status(403).json({ error: "FORBIDDEN", message: "Nur das Masterkonto darf den Systemstatus sehen." });
    return;
  }
  const payload: SystemStatusResponse = {
    backup: getDatabaseBackupStatus(),
    transportSecurity: env.BETTER_AUTH_URL.startsWith("https://") ? "https" : "http",
    productionMode: env.NODE_ENV === "production"
  };
  response.json(payload);
});

teacherRouter.get("/management", async (_request, response, next) => {
  const principal = _request.principal!;
  if (!hasTeacherPermission(principal, "teams")) {
    response.status(403).json({ error: "FORBIDDEN", message: "Für die Team- und Schülerverwaltung fehlt die Berechtigung." });
    return;
  }
  try {
    const [teams, students, teachers, invitations] = await Promise.all([
      pool.query<TeamSummary>(
        `SELECT t.id, t.name, count(sp.id)::int AS "studentCount"
           FROM teams t
           LEFT JOIN student_profiles sp ON sp.team_id = t.id
          WHERE t.active = true
            AND ($1::boolean OR EXISTS (
              SELECT 1 FROM teacher_profiles tp
              JOIN teacher_team_access mine ON mine.teacher_profile_id = tp.id
              WHERE tp.app_user_id = $2 AND mine.team_id = t.id
            ))
          GROUP BY t.id, t.name
          ORDER BY lower(t.name)`,
        [principal.canManageAccounts, principal.appUserId]
      ),
      pool.query<StudentAccountSummary>(
        `SELECT
           sp.id,
           au.display_name AS "displayName",
           u.username AS "loginId",
           t.id AS "teamId",
           t.name AS "teamName",
           au.active,
           sp.must_change_password AS "mustChangePassword",
           au.created_at AS "createdAt"
         FROM student_profiles sp
         JOIN app_users au ON au.id = sp.app_user_id
         JOIN "user" u ON u.id = au.auth_user_id
         LEFT JOIN teams t ON t.id = sp.team_id
         WHERE $1::boolean OR EXISTS (
           SELECT 1 FROM teacher_profiles tp
           JOIN teacher_team_access mine ON mine.teacher_profile_id = tp.id
           WHERE tp.app_user_id = $2 AND mine.team_id = sp.team_id
         )
         ORDER BY lower(au.display_name)`
        , [principal.canManageAccounts, principal.appUserId]
      ),
      pool.query<TeacherAccountSummary>(
        `SELECT tp.id, au.display_name AS "displayName", u.username AS "loginId",
                au.active, tp.can_manage_accounts AS "canManageAccounts",
                tp.can_manage_teams AS "canManageTeams",
                tp.can_manage_assessments AS "canManageAssessments",
                tp.can_manage_planning AS "canManagePlanning",
                COALESCE(array_agg(tta.team_id) FILTER (WHERE tta.team_id IS NOT NULL), '{}') AS "teamIds",
                au.created_at AS "createdAt"
           FROM teacher_profiles tp
           JOIN app_users au ON au.id = tp.app_user_id
           JOIN "user" u ON u.id = au.auth_user_id
           LEFT JOIN teacher_team_access tta ON tta.teacher_profile_id = tp.id
          WHERE $1::boolean
          GROUP BY tp.id, au.id, u.id
          ORDER BY tp.can_manage_accounts DESC, lower(au.display_name)`,
        [principal.canManageAccounts]
      ),
      pool.query<TeamInvitationSummary>(
        `SELECT
           ti.id,
           ti.team_id AS "teamId",
           t.name AS "teamName",
           ti.expires_at AS "expiresAt",
           ti.max_uses AS "maxUses",
           ti.use_count AS "useCount",
           (ti.active AND ti.expires_at > now() AND ti.use_count < ti.max_uses) AS active,
           ti.created_at AS "createdAt"
         FROM team_invitations ti
         JOIN teams t ON t.id = ti.team_id
         WHERE $1::boolean OR EXISTS (
           SELECT 1 FROM teacher_profiles tp
           JOIN teacher_team_access mine ON mine.teacher_profile_id = tp.id
           WHERE tp.app_user_id = $2 AND mine.team_id = ti.team_id
         )
         ORDER BY ti.created_at DESC
         LIMIT 30`,
        [principal.canManageAccounts, principal.appUserId]
      )
    ]);

    const payload: StudentManagementResponse = {
      teams: teams.rows,
      students: students.rows,
      teachers: teachers.rows,
      invitations: invitations.rows
    };
    response.json(payload);
  } catch (error) {
    next(error);
  }
});

teacherRouter.post("/teachers", async (request, response, next) => {
  const parsed = teacherSchema.safeParse(request.body);
  if (!parsed.success) {
    response.status(400).json({ error: "INVALID_TEACHER", message: "Bitte Name und mindestens ein Team auswählen." });
    return;
  }
  if (!parsed.data.canManageAccounts && parsed.data.teamIds.length === 0) {
    response.status(400).json({ error: "TEAM_REQUIRED", message: "Eine Lehrkraft ohne Adminrecht benötigt mindestens ein zugewiesenes Team." });
    return;
  }
  try {
    requirePermission(request.principal!, "accounts", "Nur ein Administratorkonto darf Lehrkraftkonten anlegen.");
    const created = await createTeacherAccount({
      displayName: parsed.data.displayName,
      teamIds: [...new Set(parsed.data.teamIds)],
      actorAppUserId: request.principal!.appUserId,
      canManageAccounts: parsed.data.canManageAccounts,
      canManageTeams: parsed.data.canManageTeams,
      canManageAssessments: parsed.data.canManageAssessments,
      canManagePlanning: parsed.data.canManagePlanning
    });
    const payload: CreateTeacherResponse = created;
    response.status(201).json(payload);
  } catch (error) {
    if (error instanceof Error && error.name === "FORBIDDEN") {
      response.status(403).json({ error: "FORBIDDEN", message: error.message });
      return;
    }
    if (error instanceof Error && error.name === "ADMIN_LIMIT") {
      response.status(409).json({ error: "ADMIN_LIMIT", message: error.message });
      return;
    }
    next(error);
  }
});

teacherRouter.patch("/teachers/:id", async (request, response, next) => {
  const id = z.string().uuid().safeParse(request.params.id);
  const parsed = updateTeacherSchema.safeParse(request.body);
  if (!id.success || !parsed.success) {
    response.status(400).json({ error: "INVALID_TEACHER", message: "Bitte Lehrkraftdaten und Teamrechte prüfen." });
    return;
  }
  try {
    requirePermission(request.principal!, "accounts", "Nur ein Administratorkonto darf Lehrkraftkonten bearbeiten.");
    const teamIds = [...new Set(parsed.data.teamIds)];
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query("SELECT pg_advisory_xact_lock(hashtext('gn-planer-admin-accounts'))");
      const validTeams = await client.query("SELECT id FROM teams WHERE active = true AND id = ANY($1::uuid[])", [teamIds]);
      if (validTeams.rowCount !== teamIds.length) throw new Error("INVALID_TEAMS");
      const teacher = await client.query<{
        app_user_id: string;
        auth_user_id: string;
        active: boolean;
        can_manage_accounts: boolean;
        can_manage_teams: boolean;
        can_manage_assessments: boolean;
        can_manage_planning: boolean;
      }>(
        `SELECT tp.app_user_id, au.auth_user_id, au.active,
                tp.can_manage_accounts, tp.can_manage_teams,
                tp.can_manage_assessments, tp.can_manage_planning
           FROM teacher_profiles tp JOIN app_users au ON au.id = tp.app_user_id
          WHERE tp.id = $1 FOR UPDATE OF tp, au`,
        [id.data]
      );
      const record = teacher.rows[0];
      if (!record) throw new Error("TEACHER_NOT_FOUND");
      const isAdmin = parsed.data.canManageAccounts ?? record.can_manage_accounts;
      const canManageTeams = isAdmin || (parsed.data.canManageTeams ?? record.can_manage_teams);
      const canManageAssessments = isAdmin || (parsed.data.canManageAssessments ?? record.can_manage_assessments);
      const canManagePlanning = isAdmin || (parsed.data.canManagePlanning ?? record.can_manage_planning);
      if (!isAdmin && teamIds.length === 0) throw new Error("TEAM_REQUIRED");
      const changesOwnAdminStatus = record.app_user_id === request.principal!.appUserId
        && (!parsed.data.active || !isAdmin);
      if (changesOwnAdminStatus) throw new Error("SELF_ADMIN_PROTECTED");

      const activeAdmins = await client.query<{ count: number }>(
        `SELECT count(*)::int AS count
           FROM teacher_profiles tp
           JOIN app_users au ON au.id = tp.app_user_id
          WHERE tp.can_manage_accounts = true AND au.active = true`
      );
      const activeAdminCount = activeAdmins.rows[0]!.count;
      const wasActiveAdmin = record.active && record.can_manage_accounts;
      const willBeActiveAdmin = parsed.data.active && isAdmin;
      if (!wasActiveAdmin && willBeActiveAdmin && activeAdminCount >= 2) {
        throw new Error("ADMIN_LIMIT");
      }
      if (wasActiveAdmin && !willBeActiveAdmin && activeAdminCount <= 1) {
        throw new Error("LAST_ADMIN");
      }

      await client.query("UPDATE app_users SET display_name = $2, active = $3 WHERE id = $1", [record.app_user_id, parsed.data.displayName, parsed.data.active]);
      await client.query(
        `UPDATE "user" SET name = $2, username = $3, "displayUsername" = $3, "updatedAt" = now() WHERE id = $1`,
        [record.auth_user_id, parsed.data.displayName, parsed.data.loginId]
      );
      await client.query(
        `UPDATE teacher_profiles
            SET can_manage_accounts = $2,
                can_manage_teams = $3,
                can_manage_assessments = $4,
                can_manage_planning = $5
          WHERE id = $1`,
        [id.data, isAdmin, canManageTeams, canManageAssessments, canManagePlanning]
      );
      await client.query("DELETE FROM teacher_team_access WHERE teacher_profile_id = $1", [id.data]);
      await client.query(
        `INSERT INTO teacher_team_access (teacher_profile_id, team_id)
         SELECT $1, value::uuid FROM unnest($2::text[]) AS value`,
        [id.data, teamIds]
      );
      if (!parsed.data.active) await client.query(`DELETE FROM "session" WHERE "userId" = $1`, [record.auth_user_id]);
      await client.query(
        `INSERT INTO audit_log (actor_app_user_id, action, entity_type, entity_id, details)
         VALUES ($1, 'TEACHER_ACCOUNT_UPDATED', 'teacher_profile', $2, $3::jsonb)`,
        [
          request.principal!.appUserId,
          id.data,
          JSON.stringify({
            loginId: parsed.data.loginId,
            active: parsed.data.active,
            teamIds,
            canManageAccounts: isAdmin,
            canManageTeams,
            canManageAssessments,
            canManagePlanning
          })
        ]
      );
      await client.query("COMMIT");
      response.json({ updated: true });
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally { client.release(); }
  } catch (error) {
    if (error instanceof Error && error.name === "FORBIDDEN") return void response.status(403).json({ error: "FORBIDDEN", message: error.message });
    if (error instanceof Error && error.message === "INVALID_TEAMS") return void response.status(400).json({ error: "INVALID_TEAMS", message: "Mindestens ein Team existiert nicht mehr." });
    if (error instanceof Error && error.message === "TEAM_REQUIRED") return void response.status(400).json({ error: "TEAM_REQUIRED", message: "Eine Lehrkraft ohne Adminrecht benötigt mindestens ein zugewiesenes Team." });
    if (error instanceof Error && error.message === "TEACHER_NOT_FOUND") return void response.status(404).json({ error: "TEACHER_NOT_FOUND", message: "Lehrkraftkonto wurde nicht gefunden." });
    if (error instanceof Error && error.message === "SELF_ADMIN_PROTECTED") return void response.status(409).json({ error: "SELF_ADMIN_PROTECTED", message: "Das eigene Administratorkonto kann nicht deaktiviert oder herabgestuft werden." });
    if (error instanceof Error && error.message === "LAST_ADMIN") return void response.status(409).json({ error: "LAST_ADMIN", message: "Mindestens ein aktives Administratorkonto muss erhalten bleiben." });
    if (error instanceof Error && error.message === "ADMIN_LIMIT") return void response.status(409).json({ error: "ADMIN_LIMIT", message: "Es sind bereits zwei aktive Administratorkonten vorhanden." });
    if (error instanceof Error && /unique/i.test(error.message)) return void response.status(409).json({ error: "LOGIN_EXISTS", message: "Diese Anmelde-ID ist bereits vergeben." });
    next(error);
  }
});

teacherRouter.post("/teachers/:id/reset-password", async (request, response, next) => {
  const id = z.string().uuid().safeParse(request.params.id);
  if (!id.success) return void response.status(400).json({ error: "INVALID_TEACHER", message: "Lehrkraftkonto ist ungültig." });
  try {
    requirePermission(request.principal!, "accounts", "Nur ein Administratorkonto darf Lehrkraftpasswörter zurücksetzen.");
    const initialPassword = createInitialPassword();
    const passwordHash = await hashPassword(initialPassword);
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const teacher = await client.query<{ auth_user_id: string }>(
        `SELECT au.auth_user_id
           FROM teacher_profiles tp JOIN app_users au ON au.id = tp.app_user_id
          WHERE tp.id = $1 AND tp.app_user_id <> $2 FOR UPDATE OF tp`,
        [id.data, request.principal!.appUserId]
      );
      const authUserId = teacher.rows[0]?.auth_user_id;
      if (!authUserId) throw new Error("SELF_PASSWORD_RESET");
      await client.query(
        `UPDATE "account" SET password = $2, "updatedAt" = now()
          WHERE "userId" = $1 AND "providerId" = 'credential'`,
        [authUserId, passwordHash]
      );
      await client.query(`DELETE FROM "session" WHERE "userId" = $1`, [authUserId]);
      await client.query(
        `INSERT INTO audit_log (actor_app_user_id, action, entity_type, entity_id)
         VALUES ($1, 'TEACHER_PASSWORD_RESET', 'teacher_profile', $2)`,
        [request.principal!.appUserId, id.data]
      );
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally { client.release(); }
    const payload: ResetStudentPasswordResponse = { initialPassword };
    response.json(payload);
  } catch (error) {
    if (error instanceof Error && error.name === "FORBIDDEN") return void response.status(403).json({ error: "FORBIDDEN", message: error.message });
    if (error instanceof Error && error.message === "SELF_PASSWORD_RESET") return void response.status(409).json({ error: "SELF_PASSWORD_RESET", message: "Das eigene Passwort wird in den persönlichen Einstellungen geändert." });
    next(error);
  }
});

teacherRouter.post("/invitations", async (request, response, next) => {
  const parsed = invitationSchema.safeParse(request.body);
  if (!parsed.success) {
    response.status(400).json({
      error: "INVALID_INVITATION",
      message: "Bitte Team, Gültigkeit und Anzahl der Einlösungen prüfen."
    });
    return;
  }

  try {
    requirePermission(request.principal!, "teams", "Für Einladungslinks fehlt die Berechtigung zur Teamverwaltung.");
    await requireTeamAccess(request.principal!, parsed.data.teamId);
    const token = createInvitationToken();
    const result = await pool.query<TeamInvitationSummary>(
      `WITH inserted AS (
         INSERT INTO team_invitations
           (team_id, created_by_app_user_id, token_hash, expires_at, max_uses)
         SELECT t.id, $2, $3, now() + make_interval(days => $4), $5
           FROM teams t
          WHERE t.id = $1 AND t.active = true
         RETURNING *
       )
       SELECT
         i.id,
         i.team_id AS "teamId",
         t.name AS "teamName",
         i.expires_at AS "expiresAt",
         i.max_uses AS "maxUses",
         i.use_count AS "useCount",
         i.active,
         i.created_at AS "createdAt"
       FROM inserted i
       JOIN teams t ON t.id = i.team_id`,
      [
        parsed.data.teamId,
        request.principal!.appUserId,
        hashInvitationToken(token),
        parsed.data.validDays,
        parsed.data.maxUses
      ]
    );
    const invitation = result.rows[0];
    if (!invitation) {
      response.status(404).json({ error: "TEAM_NOT_FOUND", message: "Team wurde nicht gefunden." });
      return;
    }
    await pool.query(
      `INSERT INTO audit_log (actor_app_user_id, action, entity_type, entity_id, details)
       VALUES ($1, 'TEAM_INVITATION_CREATED', 'team_invitation', $2, $3::jsonb)`,
      [
        request.principal!.appUserId,
        invitation.id,
        JSON.stringify({ teamId: invitation.teamId, maxUses: invitation.maxUses })
      ]
    );
    const payload: CreateInvitationResponse = { invitation, token };
    response.status(201).json(payload);
  } catch (error) {
    if (error instanceof Error && error.name === "FORBIDDEN") {
      response.status(403).json({ error: "FORBIDDEN", message: error.message });
      return;
    }
    next(error);
  }
});

teacherRouter.post("/invitations/:id/revoke", async (request, response, next) => {
  const parsedId = z.string().uuid().safeParse(request.params.id);
  if (!parsedId.success) {
    response.status(404).json({ error: "INVITATION_NOT_FOUND", message: "Einladung nicht gefunden." });
    return;
  }

  try {
    requirePermission(request.principal!, "teams", "Für Einladungslinks fehlt die Berechtigung zur Teamverwaltung.");
    const result = await pool.query(
      `UPDATE team_invitations ti
          SET active = false
        WHERE ti.id = $1 AND ti.active = true
          AND ($2::boolean OR EXISTS (
            SELECT 1 FROM teacher_profiles tp
            JOIN teacher_team_access tta ON tta.teacher_profile_id = tp.id
            WHERE tp.app_user_id = $3 AND tta.team_id = ti.team_id
          ))
        RETURNING id`,
      [parsedId.data, request.principal!.canManageAccounts, request.principal!.appUserId]
    );
    if (result.rowCount === 0) {
      response.status(404).json({ error: "INVITATION_NOT_FOUND", message: "Einladung ist bereits inaktiv." });
      return;
    }
    await pool.query(
      `INSERT INTO audit_log (actor_app_user_id, action, entity_type, entity_id)
       VALUES ($1, 'TEAM_INVITATION_REVOKED', 'team_invitation', $2)`,
      [request.principal!.appUserId, parsedId.data]
    );
    response.json({ revoked: true });
  } catch (error) {
    if (error instanceof Error && error.name === "FORBIDDEN") {
      response.status(403).json({ error: "FORBIDDEN", message: error.message });
      return;
    }
    next(error);
  }
});

teacherRouter.post("/teams", async (request, response, next) => {
  const parsed = teamSchema.safeParse(request.body);
  if (!parsed.success) {
    response.status(400).json({ error: "INVALID_TEAM", message: "Bitte einen Teamnamen angeben." });
    return;
  }

  try {
    requirePermission(request.principal!, "teams", "Für das Anlegen von Teams fehlt die Berechtigung.");
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const result = await client.query<TeamSummary>(
        `INSERT INTO teams (name)
         VALUES ($1)
         RETURNING id, name, 0::int AS "studentCount"`,
        [parsed.data.name]
      );
      if (!request.principal!.canManageAccounts) {
        const access = await client.query(
          `INSERT INTO teacher_team_access (teacher_profile_id, team_id)
           SELECT tp.id, $2
             FROM teacher_profiles tp
            WHERE tp.app_user_id = $1
           ON CONFLICT DO NOTHING
           RETURNING teacher_profile_id`,
          [request.principal!.appUserId, result.rows[0]!.id]
        );
        if (!access.rowCount) throw new Error("TEACHER_PROFILE_MISSING");
      }
      await client.query(
        `INSERT INTO audit_log (actor_app_user_id, action, entity_type, entity_id, details)
         VALUES ($1, 'TEAM_CREATED', 'team', $2, jsonb_build_object('name', $3::text))`,
        [request.principal!.appUserId, result.rows[0]!.id, result.rows[0]!.name]
      );
      await client.query("COMMIT");
      const payload: CreateTeamResponse = { team: result.rows[0]! };
      response.status(201).json(payload);
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  } catch (error) {
    if (error instanceof Error && error.name === "FORBIDDEN") {
      response.status(403).json({ error: "FORBIDDEN", message: error.message });
      return;
    }
    if (error instanceof Error && /unique/i.test(error.message)) {
      response.status(409).json({ error: "TEAM_EXISTS", message: "Dieses Team existiert bereits." });
      return;
    }
    next(error);
  }
});

teacherRouter.patch("/teams/:id", async (request, response, next) => {
  const id = z.string().uuid().safeParse(request.params.id);
  const parsed = teamSchema.safeParse(request.body);
  if (!id.success || !parsed.success) {
    response.status(400).json({ error: "INVALID_TEAM", message: "Bitte Teamname prüfen." });
    return;
  }
  try {
    requirePermission(request.principal!, "teams", "Für das Bearbeiten von Teams fehlt die Berechtigung.");
    const result = await pool.query(
      `UPDATE teams t SET name = $2
        WHERE t.id = $1 AND t.active = true
          AND ($3::boolean OR EXISTS (
            SELECT 1 FROM teacher_profiles tp
            JOIN teacher_team_access tta ON tta.teacher_profile_id = tp.id
            WHERE tp.app_user_id = $4 AND tta.team_id = t.id
          ))
        RETURNING id`,
      [id.data, parsed.data.name, request.principal!.canManageAccounts, request.principal!.appUserId]
    );
    if (!result.rowCount) {
      response.status(404).json({ error: "TEAM_NOT_FOUND", message: "Team wurde nicht gefunden." });
      return;
    }
    await pool.query(
      `INSERT INTO audit_log (actor_app_user_id, action, entity_type, entity_id, details)
       VALUES ($1, 'TEAM_UPDATED', 'team', $2, jsonb_build_object('name', $3::text))`,
      [request.principal!.appUserId, id.data, parsed.data.name]
    );
    response.json({ updated: true });
  } catch (error) {
    if (error instanceof Error && error.name === "FORBIDDEN") {
      response.status(403).json({ error: "FORBIDDEN", message: error.message });
      return;
    }
    if (error instanceof Error && /unique/i.test(error.message)) {
      response.status(409).json({ error: "TEAM_EXISTS", message: "Dieser Teamname ist bereits vergeben." });
      return;
    }
    next(error);
  }
});

teacherRouter.post("/students/batch", async (request, response, next) => {
  const parsed = batchStudentSchema.safeParse(request.body);
  if (!parsed.success) {
    response.status(400).json({
      error: "INVALID_STUDENT_LIST",
      message: "Bitte ein Team und höchstens 60 vollständige Namen angeben."
    });
    return;
  }

  try {
    requirePermission(request.principal!, "teams", "Für das Anlegen von Schülerkonten fehlt die Berechtigung.");
    await requireTeamAccess(request.principal!, parsed.data.teamId);
    const team = await pool.query<{ name: string }>(
      "SELECT name FROM teams WHERE id = $1 AND active = true",
      [parsed.data.teamId]
    );
    const teamName = team.rows[0]?.name;
    if (!teamName) {
      response.status(404).json({ error: "TEAM_NOT_FOUND", message: "Team wurde nicht gefunden." });
      return;
    }

    const seenNames = new Set<string>();
    const accounts: BatchCreateStudentsResponse["accounts"] = [];
    const failures: BatchCreateStudentsResponse["failures"] = [];
    for (const displayName of parsed.data.names) {
      const normalizedName = displayName.toLocaleLowerCase("de-DE");
      if (seenNames.has(normalizedName)) {
        failures.push({ displayName, message: "Name steht mehrfach in der Liste." });
        continue;
      }
      seenNames.add(normalizedName);
      try {
        const created = await createStudentAccount({
          displayName,
          teamId: parsed.data.teamId,
          actorAppUserId: request.principal!.appUserId,
          simpleInitialPassword: true
        });
        accounts.push({
          displayName: created.student.displayName,
          loginId: created.student.loginId,
          initialPassword: created.initialPassword
        });
      } catch {
        failures.push({ displayName, message: "Konto konnte nicht erstellt werden." });
      }
    }

    const payload: BatchCreateStudentsResponse = { teamName, accounts, failures };
    response.status(accounts.length > 0 ? 201 : 200).json(payload);
  } catch (error) {
    if (error instanceof Error && error.name === "FORBIDDEN") {
      response.status(403).json({ error: "FORBIDDEN", message: error.message });
      return;
    }
    next(error);
  }
});

teacherRouter.post("/students", async (request, response, next) => {
  const parsed = studentSchema.safeParse(request.body);
  if (!parsed.success) {
    response.status(400).json({
      error: "INVALID_STUDENT",
      message: "Name oder Teamzuordnung ist ungültig."
    });
    return;
  }

  try {
    requirePermission(request.principal!, "teams", "Für das Anlegen von Schülerkonten fehlt die Berechtigung.");
    if (parsed.data.teamId) {
      await requireTeamAccess(request.principal!, parsed.data.teamId);
    } else if (!request.principal!.canManageAccounts) {
      const error = new Error("Schülerkonten müssen einem zugewiesenen Team angehören.");
      error.name = "FORBIDDEN";
      throw error;
    }
    const created = await createStudentAccount({
      displayName: parsed.data.displayName,
      teamId: parsed.data.teamId,
      actorAppUserId: request.principal!.appUserId,
      simpleInitialPassword: true
    });
    const payload: CreateStudentResponse = created;
    response.status(201).json(payload);
  } catch (error) {
    if (error instanceof Error && error.name === "FORBIDDEN") {
      response.status(403).json({ error: "FORBIDDEN", message: error.message });
      return;
    }
    next(error);
  }
});

teacherRouter.patch("/students/:id", async (request, response, next) => {
  const id = z.string().uuid().safeParse(request.params.id);
  const parsed = updateStudentSchema.safeParse(request.body);
  if (!id.success || !parsed.success) {
    response.status(400).json({ error: "INVALID_STUDENT", message: "Bitte Name, Anmelde-ID und Team prüfen." });
    return;
  }
  try {
    requirePermission(request.principal!, "teams", "Für das Bearbeiten von Schülerkonten fehlt die Berechtigung.");
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      if (parsed.data.teamId) {
        const team = await client.query(
          `SELECT 1 FROM teams t
            WHERE t.id = $1 AND t.active = true
              AND ($2::boolean OR EXISTS (
                SELECT 1 FROM teacher_profiles tp
                JOIN teacher_team_access tta ON tta.teacher_profile_id = tp.id
                WHERE tp.app_user_id = $3 AND tta.team_id = t.id
              ))`,
          [parsed.data.teamId, request.principal!.canManageAccounts, request.principal!.appUserId]
        );
        if (!team.rowCount) {
          await client.query("ROLLBACK");
          response.status(404).json({ error: "TEAM_NOT_FOUND", message: "Team wurde nicht gefunden." });
          return;
        }
      } else if (!request.principal!.canManageAccounts) {
        throw Object.assign(new Error("Schülerkonten müssen einem zugewiesenen Team angehören."), { name: "FORBIDDEN" });
      }
      const student = await client.query<{ app_user_id: string; auth_user_id: string }>(
        `SELECT sp.app_user_id, au.auth_user_id
           FROM student_profiles sp JOIN app_users au ON au.id = sp.app_user_id
          WHERE sp.id = $1
            AND ($2::boolean OR EXISTS (
              SELECT 1 FROM teacher_profiles tp
              JOIN teacher_team_access tta ON tta.teacher_profile_id = tp.id
              WHERE tp.app_user_id = $3 AND tta.team_id = sp.team_id
            ))
          FOR UPDATE OF sp, au`,
        [id.data, request.principal!.canManageAccounts, request.principal!.appUserId]
      );
      const record = student.rows[0];
      if (!record) {
        await client.query("ROLLBACK");
        response.status(404).json({ error: "STUDENT_NOT_FOUND", message: "Schülerkonto wurde nicht gefunden." });
        return;
      }
      await client.query(
        "UPDATE app_users SET display_name = $2, active = $3 WHERE id = $1",
        [record.app_user_id, parsed.data.displayName, parsed.data.active]
      );
      await client.query("UPDATE student_profiles SET team_id = $2 WHERE id = $1", [id.data, parsed.data.teamId]);
      await client.query(
        `UPDATE "user" SET name = $2, username = $3, "displayUsername" = $3, "updatedAt" = now() WHERE id = $1`,
        [record.auth_user_id, parsed.data.displayName, parsed.data.loginId]
      );
      if (!parsed.data.active) {
        await client.query(`DELETE FROM "session" WHERE "userId" = $1`, [record.auth_user_id]);
      }
      await client.query(
        `INSERT INTO audit_log (actor_app_user_id, action, entity_type, entity_id, details)
         VALUES ($1, 'STUDENT_ACCOUNT_UPDATED', 'student_profile', $2, $3::jsonb)`,
        [request.principal!.appUserId, id.data, JSON.stringify({ loginId: parsed.data.loginId, teamId: parsed.data.teamId, active: parsed.data.active })]
      );
      await client.query("COMMIT");
      response.json({ updated: true });
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  } catch (error) {
    if (error instanceof Error && error.name === "FORBIDDEN") {
      response.status(403).json({ error: "FORBIDDEN", message: error.message });
      return;
    }
    if (error instanceof Error && /unique/i.test(error.message)) {
      response.status(409).json({ error: "LOGIN_EXISTS", message: "Diese Anmelde-ID ist bereits vergeben." });
      return;
    }
    next(error);
  }
});

teacherRouter.post("/students/:id/reset-password", async (request, response, next) => {
  const id = z.string().uuid().safeParse(request.params.id);
  if (!id.success) {
    response.status(400).json({ error: "INVALID_STUDENT", message: "Schülerkonto ist ungültig." });
    return;
  }
  try {
    requirePermission(request.principal!, "teams", "Für das Zurücksetzen von Schülerpasswörtern fehlt die Berechtigung.");
    const initialPassword = createNumericInitialPassword();
    const passwordHash = await hashPassword(initialPassword);
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const student = await client.query<{ auth_user_id: string }>(
        `SELECT au.auth_user_id
           FROM student_profiles sp JOIN app_users au ON au.id = sp.app_user_id
          WHERE sp.id = $1
            AND ($2::boolean OR EXISTS (
              SELECT 1 FROM teacher_profiles tp
              JOIN teacher_team_access tta ON tta.teacher_profile_id = tp.id
              WHERE tp.app_user_id = $3 AND tta.team_id = sp.team_id
            ))
          FOR UPDATE OF sp`,
        [id.data, request.principal!.canManageAccounts, request.principal!.appUserId]
      );
      const authUserId = student.rows[0]?.auth_user_id;
      if (!authUserId) {
        await client.query("ROLLBACK");
        response.status(404).json({ error: "STUDENT_NOT_FOUND", message: "Schülerkonto wurde nicht gefunden." });
        return;
      }
      const account = await client.query(
        `UPDATE "account" SET password = $2, "updatedAt" = now()
          WHERE "userId" = $1 AND "providerId" = 'credential' RETURNING id`,
        [authUserId, passwordHash]
      );
      if (!account.rowCount) throw new Error("Kein Kennwortkonto gefunden.");
      await client.query("UPDATE student_profiles SET must_change_password = true WHERE id = $1", [id.data]);
      await client.query(`DELETE FROM "session" WHERE "userId" = $1`, [authUserId]);
      await client.query(
        `INSERT INTO audit_log (actor_app_user_id, action, entity_type, entity_id)
         VALUES ($1, 'STUDENT_PASSWORD_RESET', 'student_profile', $2)`,
        [request.principal!.appUserId, id.data]
      );
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
    const payload: ResetStudentPasswordResponse = { initialPassword };
    response.json(payload);
  } catch (error) {
    if (error instanceof Error && error.name === "FORBIDDEN") {
      response.status(403).json({ error: "FORBIDDEN", message: error.message });
      return;
    }
    next(error);
  }
});
