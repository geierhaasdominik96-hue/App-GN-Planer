import type { PlanningAdminResponse } from "@gn-planer/contracts";
import { Router, type NextFunction, type Request, type Response } from "express";
import type { Pool, PoolClient } from "pg";
import { z } from "zod";
import { pool } from "../database.js";
import { endWeeklySchedule } from "../planning-service.js";
import { hasTeacherPermission, type Principal, type TeacherPermission } from "../security.js";

export const planningRouter = Router();

const uuid = z.string().uuid();
const roomSchema = z.object({ name: z.string().trim().min(1).max(80), defaultCapacity: z.number().int().min(1).max(500) });
const assessmentSchema = z.object({
  subject: z.string().trim().min(1).max(80),
  learningHouse: z.string().trim().min(1).max(80),
  title: z.string().trim().min(1).max(120),
  teamIds: z.array(uuid).min(1)
});
const timePattern = /^([01]\d|2[0-3]):[0-5]\d$/;
const datePattern = /^\d{4}-\d{2}-\d{2}$/;
const scheduleSchema = z.object({
  name: z.string().trim().min(1).max(100),
  startsOn: z.string().regex(datePattern),
  endsOn: z.string().regex(datePattern),
  startTime: z.string().regex(timePattern),
  endTime: z.string().regex(timePattern),
  roomId: uuid,
  capacity: z.number().int().min(1).max(500)
}).refine((value) => value.endsOn >= value.startsOn, { message: "Enddatum liegt vor dem Startdatum." })
  .refine((value) => value.endTime > value.startTime, { message: "Die Endzeit muss nach der Startzeit liegen." });
const occurrenceSchema = z.object({
  startsAt: z.string().datetime(),
  endsAt: z.string().datetime(),
  roomId: uuid,
  capacity: z.number().int().min(1).max(500),
  version: z.number().int().positive()
}).refine((value) => value.endsAt > value.startsAt, { message: "Die Endzeit muss nach der Startzeit liegen." });
const versionSchema = z.object({ version: z.number().int().positive() });
const settingsSchema = z.object({
  bookingCutoffHours: z.number().int().min(0).max(8760),
  cancellationCutoffHours: z.number().int().min(0).max(8760)
});

function isRoomConflict(error: unknown) {
  return Boolean(
    error
    && typeof error === "object"
    && "code" in error
    && error.code === "23P01"
  ) || (error instanceof Error && /Raum ist zum ausgewählten Zeitraum bereits belegt/i.test(error.message));
}

function requirePlanningPermission(permission: TeacherPermission) {
  return (request: Request, response: Response, next: NextFunction) => {
    if (!hasTeacherPermission(request.principal!, permission)) {
      response.status(403).json({ error: "FORBIDDEN", message: "Für diesen Planungsbereich fehlt die Berechtigung." });
      return;
    }
    next();
  };
}

async function requireAssignedTeams(
  client: Pool | PoolClient,
  principal: Principal,
  teamIds: string[]
) {
  const uniqueTeamIds = [...new Set(teamIds)];
  const result = await client.query(
    principal.canManageAccounts
      ? `SELECT t.id FROM teams t WHERE t.active = true AND t.id = ANY($1::uuid[])`
      : `SELECT t.id
           FROM teams t
           JOIN teacher_team_access tta ON tta.team_id = t.id
           JOIN teacher_profiles tp ON tp.id = tta.teacher_profile_id
          WHERE t.active = true AND t.id = ANY($1::uuid[]) AND tp.app_user_id = $2`,
    principal.canManageAccounts
      ? [uniqueTeamIds]
      : [uniqueTeamIds, principal.appUserId]
  );
  if (result.rowCount !== uniqueTeamIds.length) {
    const error = new Error("Mindestens ein Team ist nicht zugewiesen oder nicht mehr aktiv.");
    error.name = "FORBIDDEN";
    throw error;
  }
}

async function requireAssessmentAccess(
  client: Pool | PoolClient,
  principal: Principal,
  assessmentId: string
) {
  if (principal.canManageAccounts) return;
  const result = await client.query(
    `SELECT 1
       FROM assessment_definitions ad
      WHERE ad.id = $1 AND ad.active = true
        AND EXISTS (
          SELECT 1 FROM team_assessment_requirements tar
          JOIN teacher_team_access tta ON tta.team_id = tar.team_id
          JOIN teacher_profiles tp ON tp.id = tta.teacher_profile_id
          WHERE tar.assessment_id = ad.id AND tp.app_user_id = $2
        )
        AND NOT EXISTS (
          SELECT 1 FROM team_assessment_requirements tar
          WHERE tar.assessment_id = ad.id
            AND NOT EXISTS (
              SELECT 1 FROM teacher_team_access tta
              JOIN teacher_profiles tp ON tp.id = tta.teacher_profile_id
              WHERE tta.team_id = tar.team_id AND tp.app_user_id = $2
            )
        )`,
    [assessmentId, principal.appUserId]
  );
  if (!result.rowCount) {
    const error = new Error("Dieser Gelingensnachweis gehört nicht ausschließlich zu den zugewiesenen Teams.");
    error.name = "FORBIDDEN";
    throw error;
  }
}

planningRouter.use((request, response, next) => {
  if (
    !hasTeacherPermission(request.principal!, "planning")
    && !hasTeacherPermission(request.principal!, "assessments")
  ) {
    response.status(403).json({ error: "FORBIDDEN", message: "Für Planung oder Gelingensnachweise fehlt die Berechtigung." });
    return;
  }
  next();
});

planningRouter.get("/", async (request, response, next) => {
  try {
    const principal = request.principal!;
    const canManagePlanning = hasTeacherPermission(principal, "planning");
    const canManageAssessments = hasTeacherPermission(principal, "assessments");
    const empty = Promise.resolve({ rows: [] });
    const [rooms, assessments, schedules, appointments, settings, teams] = await Promise.all([
      canManagePlanning ? pool.query(
        `SELECT id, name, default_capacity AS "defaultCapacity", active
           FROM rooms WHERE active = true ORDER BY lower(name)`
      ) : empty,
      canManageAssessments ? pool.query(
        `SELECT ad.id, ad.subject, ad.learning_house AS "learningHouse", ad.title, ad.active,
                COALESCE(array_agg(tar.team_id) FILTER (WHERE tar.team_id IS NOT NULL), '{}') AS "teamIds"
           FROM assessment_definitions ad
           LEFT JOIN team_assessment_requirements tar ON tar.assessment_id = ad.id
          WHERE ad.active = true AND ($1::boolean OR (
            EXISTS (
              SELECT 1 FROM team_assessment_requirements own_tar
              JOIN teacher_team_access own_tta ON own_tta.team_id = own_tar.team_id
              JOIN teacher_profiles own_tp ON own_tp.id = own_tta.teacher_profile_id
              WHERE own_tar.assessment_id = ad.id AND own_tp.app_user_id = $2
            )
            AND NOT EXISTS (
              SELECT 1 FROM team_assessment_requirements other_tar
              WHERE other_tar.assessment_id = ad.id
                AND NOT EXISTS (
                  SELECT 1 FROM teacher_team_access other_tta
                  JOIN teacher_profiles other_tp ON other_tp.id = other_tta.teacher_profile_id
                  WHERE other_tta.team_id = other_tar.team_id AND other_tp.app_user_id = $2
                )
            )
          ))
          GROUP BY ad.id ORDER BY lower(ad.subject), lower(ad.learning_house), lower(ad.title)`,
        [principal.canManageAccounts, principal.appUserId]
      ) : empty,
      canManagePlanning ? pool.query(
        `SELECT ws.id, ws.name, ws.weekday, ws.local_start_time AS "localStartTime",
                ws.local_end_time AS "localEndTime", ws.starts_on AS "startsOn", ws.ends_on AS "endsOn",
                ws.room_id AS "roomId", r.name AS "roomName", ws.capacity, ws.active,
                count(a.id)::int AS "occurrenceCount"
           FROM weekly_schedules ws
           JOIN rooms r ON r.id = ws.room_id
           LEFT JOIN appointments a ON a.schedule_id = ws.id AND a.status = 'OPEN'
          WHERE ws.active = true
          GROUP BY ws.id, r.name ORDER BY ws.starts_on, ws.local_start_time`
      ) : empty,
      canManagePlanning ? pool.query(
        `SELECT a.id, a.schedule_id AS "scheduleId", ts.starts_at AS "startsAt", ts.ends_at AS "endsAt",
                r.id AS "roomId", r.name AS "roomName", a.capacity,
                count(b.id) FILTER (WHERE b.status = 'PLANNED')::int AS booked,
                a.status, a.version
           FROM appointments a
           JOIN time_slots ts ON ts.id = a.time_slot_id
           JOIN rooms r ON r.id = a.room_id
           LEFT JOIN bookings b ON b.appointment_id = a.id
          WHERE ts.starts_at > now() - interval '1 day'
          GROUP BY a.id, ts.id, r.id
          ORDER BY ts.starts_at, lower(r.name)`
      ) : empty,
      pool.query(`SELECT booking_cutoff_hours AS "bookingCutoffHours", cancellation_cutoff_hours AS "cancellationCutoffHours" FROM booking_settings`),
      canManageAssessments ? pool.query(
        `SELECT t.id, t.name, count(sp.id)::int AS "studentCount"
           FROM teams t LEFT JOIN student_profiles sp ON sp.team_id = t.id
          WHERE t.active = true AND ($1::boolean OR EXISTS (
            SELECT 1 FROM teacher_profiles tp
            JOIN teacher_team_access tta ON tta.teacher_profile_id = tp.id
            WHERE tp.app_user_id = $2 AND tta.team_id = t.id
          ))
          GROUP BY t.id ORDER BY lower(t.name)`,
        [principal.canManageAccounts, principal.appUserId]
      ) : empty
    ]);
    const payload: PlanningAdminResponse = {
      rooms: rooms.rows as PlanningAdminResponse["rooms"],
      assessments: assessments.rows as PlanningAdminResponse["assessments"],
      schedules: schedules.rows as PlanningAdminResponse["schedules"],
      appointments: appointments.rows as PlanningAdminResponse["appointments"],
      teams: teams.rows as PlanningAdminResponse["teams"],
      settings: settings.rows[0] as PlanningAdminResponse["settings"]
    };
    response.json(payload);
  } catch (error) {
    next(error);
  }
});

planningRouter.post("/rooms", requirePlanningPermission("planning"), async (request, response, next) => {
  const parsed = roomSchema.safeParse(request.body);
  if (!parsed.success) return void response.status(400).json({ error: "INVALID_ROOM", message: "Bitte Raumname und Kapazität prüfen." });
  try {
    const result = await pool.query(
      `INSERT INTO rooms (name, default_capacity) VALUES ($1, $2)
       RETURNING id, name, default_capacity AS "defaultCapacity", active`,
      [parsed.data.name, parsed.data.defaultCapacity]
    );
    response.status(201).json({ room: result.rows[0] });
  } catch (error) {
    if (error instanceof Error && /unique/i.test(error.message)) return void response.status(409).json({ error: "ROOM_EXISTS", message: "Dieser Raum existiert bereits." });
    next(error);
  }
});

planningRouter.patch("/rooms/:id", requirePlanningPermission("planning"), async (request, response, next) => {
  const id = uuid.safeParse(request.params.id);
  const parsed = roomSchema.safeParse(request.body);
  if (!id.success || !parsed.success) return void response.status(400).json({ error: "INVALID_ROOM", message: "Bitte Raumdaten prüfen." });
  try {
    const result = await pool.query(
      `UPDATE rooms SET name = $2, default_capacity = $3 WHERE id = $1 AND active = true RETURNING id`,
      [id.data, parsed.data.name, parsed.data.defaultCapacity]
    );
    if (!result.rowCount) return void response.status(404).json({ error: "NOT_FOUND", message: "Raum wurde nicht gefunden." });
    response.json({ updated: true });
  } catch (error) {
    if (error instanceof Error && /unique/i.test(error.message)) return void response.status(409).json({ error: "ROOM_EXISTS", message: "Dieser Raumname ist bereits vergeben." });
    next(error);
  }
});

async function saveAssessmentTeams(assessmentId: string, teamIds: string[], client: Pool | PoolClient = pool) {
  await client.query("DELETE FROM team_assessment_requirements WHERE assessment_id = $1", [assessmentId]);
  await client.query(
    `INSERT INTO team_assessment_requirements (assessment_id, team_id)
     SELECT $1, value::uuid FROM unnest($2::text[]) AS value`,
    [assessmentId, teamIds]
  );
}

planningRouter.post("/assessments", requirePlanningPermission("assessments"), async (request, response, next) => {
  const parsed = assessmentSchema.safeParse(request.body);
  if (!parsed.success) return void response.status(400).json({ error: "INVALID_ASSESSMENT", message: "Bitte Fach, Lernhaus, Bezeichnung und Teams angeben." });
  const teamIds = [...new Set(parsed.data.teamIds)];
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await requireAssignedTeams(client, request.principal!, teamIds);
    const result = await client.query<{ id: string }>(
      `INSERT INTO assessment_definitions (subject, learning_house, title) VALUES ($1, $2, $3) RETURNING id`,
      [parsed.data.subject, parsed.data.learningHouse, parsed.data.title]
    );
    await saveAssessmentTeams(result.rows[0]!.id, teamIds, client);
    await client.query("COMMIT");
    response.status(201).json({ assessmentId: result.rows[0]!.id });
  } catch (error) {
    await client.query("ROLLBACK");
    if (error instanceof Error && error.name === "FORBIDDEN") return void response.status(403).json({ error: "FORBIDDEN", message: error.message });
    if (error instanceof Error && /unique/i.test(error.message)) return void response.status(409).json({ error: "ASSESSMENT_EXISTS", message: "Dieser Gelingensnachweis existiert bereits." });
    next(error);
  } finally { client.release(); }
});

planningRouter.patch("/assessments/:id", requirePlanningPermission("assessments"), async (request, response, next) => {
  const id = uuid.safeParse(request.params.id);
  const parsed = assessmentSchema.safeParse(request.body);
  if (!id.success || !parsed.success) return void response.status(400).json({ error: "INVALID_ASSESSMENT", message: "Bitte Angaben prüfen." });
  const teamIds = [...new Set(parsed.data.teamIds)];
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await requireAssessmentAccess(client, request.principal!, id.data);
    await requireAssignedTeams(client, request.principal!, teamIds);
    const result = await client.query(
      `UPDATE assessment_definitions SET subject = $2, learning_house = $3, title = $4
        WHERE id = $1 AND active = true RETURNING id`,
      [id.data, parsed.data.subject, parsed.data.learningHouse, parsed.data.title]
    );
    if (!result.rowCount) {
      await client.query("ROLLBACK");
      return void response.status(404).json({ error: "NOT_FOUND", message: "Gelingensnachweis wurde nicht gefunden." });
    }
    await saveAssessmentTeams(id.data, teamIds, client);
    await client.query("COMMIT");
    response.json({ updated: true });
  } catch (error) {
    await client.query("ROLLBACK");
    if (error instanceof Error && error.name === "FORBIDDEN") return void response.status(403).json({ error: "FORBIDDEN", message: error.message });
    next(error);
  } finally { client.release(); }
});

planningRouter.post("/schedules", requirePlanningPermission("planning"), async (request, response, next) => {
  const parsed = scheduleSchema.safeParse(request.body);
  if (!parsed.success) return void response.status(400).json({ error: "INVALID_SCHEDULE", message: parsed.error.issues[0]?.message ?? "Wochenserie ist ungültig." });
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const schedule = await client.query<{ id: string }>(
      `INSERT INTO weekly_schedules
        (name, weekday, local_start_time, local_end_time, starts_on, ends_on, room_id, capacity)
       VALUES ($1, extract(isodow from $2::date), $3::time, $4::time, $2::date, $5::date, $6, $7)
       RETURNING id`,
      [parsed.data.name, parsed.data.startsOn, parsed.data.startTime, parsed.data.endTime, parsed.data.endsOn, parsed.data.roomId, parsed.data.capacity]
    );
    await client.query(
      `INSERT INTO time_slots (starts_at, ends_at)
       SELECT (day::date + $2::time) AT TIME ZONE 'Europe/Berlin',
              (day::date + $3::time) AT TIME ZONE 'Europe/Berlin'
         FROM generate_series($1::date, $4::date, interval '7 days') day
       ON CONFLICT (starts_at, ends_at) DO NOTHING`,
      [parsed.data.startsOn, parsed.data.startTime, parsed.data.endTime, parsed.data.endsOn]
    );
    const occurrences = await client.query(
      `INSERT INTO appointments (schedule_id, time_slot_id, room_id, capacity)
       SELECT $1, ts.id, $6, $7
         FROM generate_series($2::date, $5::date, interval '7 days') day
         JOIN time_slots ts
           ON ts.starts_at = (day::date + $3::time) AT TIME ZONE 'Europe/Berlin'
          AND ts.ends_at = (day::date + $4::time) AT TIME ZONE 'Europe/Berlin'
       ON CONFLICT (time_slot_id, room_id) DO NOTHING
       RETURNING id`,
      [schedule.rows[0]!.id, parsed.data.startsOn, parsed.data.startTime, parsed.data.endTime, parsed.data.endsOn, parsed.data.roomId, parsed.data.capacity]
    );
    await client.query("COMMIT");
    response.status(201).json({ scheduleId: schedule.rows[0]!.id, occurrenceCount: occurrences.rowCount ?? 0 });
  } catch (error) {
    await client.query("ROLLBACK");
    if (isRoomConflict(error)) {
      return void response.status(409).json({
        error: "ROOM_CONFLICT",
        message: "Mindestens ein Termin der Serie überschneidet sich mit einem vorhandenen Termin in diesem Raum."
      });
    }
    next(error);
  } finally { client.release(); }
});

planningRouter.post("/schedules/:id/remove", requirePlanningPermission("planning"), async (request, response, next) => {
  const id = uuid.safeParse(request.params.id);
  if (!id.success) return void response.status(400).json({ error: "INVALID_ID", message: "Wochenserie ist ungültig." });
  try {
    const cancelledOccurrences = await endWeeklySchedule(id.data, request.principal!.appUserId);
    if (cancelledOccurrences === null) {
      return void response.status(404).json({ error: "NOT_FOUND", message: "Wochenserie wurde nicht gefunden." });
    }
    response.json({ removed: true, cancelledOccurrences });
  } catch (error) {
    next(error);
  }
});

planningRouter.patch("/appointments/:id", requirePlanningPermission("planning"), async (request, response, next) => {
  const id = uuid.safeParse(request.params.id);
  const parsed = occurrenceSchema.safeParse(request.body);
  if (!id.success || !parsed.success) return void response.status(400).json({ error: "INVALID_APPOINTMENT", message: parsed.error?.issues[0]?.message ?? "Termin ist ungültig." });
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const current = await client.query<{ starts_at: string; ends_at: string; booked: number }>(
      `SELECT ts.starts_at, ts.ends_at,
              (SELECT count(*)::int FROM bookings b WHERE b.appointment_id = a.id AND b.status <> 'CANCELLED') AS booked
         FROM appointments a JOIN time_slots ts ON ts.id = a.time_slot_id
        WHERE a.id = $1 AND a.version = $2 FOR UPDATE OF a`,
      [id.data, parsed.data.version]
    );
    const existing = current.rows[0];
    if (!existing) throw new Error("STALE");
    const changesTime = new Date(existing.starts_at).getTime() !== new Date(parsed.data.startsAt).getTime()
      || new Date(existing.ends_at).getTime() !== new Date(parsed.data.endsAt).getTime();
    if (existing.booked > 0 && changesTime) throw new Error("BOOKED_TIME");
    if (parsed.data.capacity < existing.booked) throw new Error("CAPACITY_LOW");
    const timeSlot = await client.query<{ id: string }>(
      `INSERT INTO time_slots (starts_at, ends_at) VALUES ($1, $2)
       ON CONFLICT (starts_at, ends_at) DO UPDATE SET starts_at = excluded.starts_at RETURNING id`,
      [parsed.data.startsAt, parsed.data.endsAt]
    );
    await client.query(
      `UPDATE appointments SET time_slot_id = $2, room_id = $3, capacity = $4, version = version + 1
        WHERE id = $1`,
      [id.data, timeSlot.rows[0]!.id, parsed.data.roomId, parsed.data.capacity]
    );
    await client.query("COMMIT");
    response.json({ updated: true });
  } catch (error) {
    await client.query("ROLLBACK");
    if (error instanceof Error && error.message === "STALE") return void response.status(409).json({ error: "STALE", message: "Der Termin wurde inzwischen geändert. Bitte neu laden." });
    if (error instanceof Error && error.message === "BOOKED_TIME") return void response.status(409).json({ error: "HAS_BOOKINGS", message: "Datum und Uhrzeit eines bereits gebuchten Termins können nicht geändert werden." });
    if (error instanceof Error && error.message === "CAPACITY_LOW") return void response.status(409).json({ error: "CAPACITY_LOW", message: "Die Kapazität darf nicht unter der Zahl vorhandener Buchungen liegen." });
    if (isRoomConflict(error)) return void response.status(409).json({ error: "ROOM_CONFLICT", message: "In diesem Raum überschneidet sich bereits ein anderer Termin mit dem gewählten Zeitraum." });
    if (error instanceof Error && /unique/i.test(error.message)) return void response.status(409).json({ error: "ROOM_CONFLICT", message: "In diesem Raum besteht bereits ein Termin zur gleichen Zeit." });
    next(error);
  } finally { client.release(); }
});

planningRouter.post("/appointments/:id/remove", requirePlanningPermission("planning"), async (request, response, next) => {
  const id = uuid.safeParse(request.params.id);
  const parsed = versionSchema.safeParse(request.body);
  if (!id.success || !parsed.success) return void response.status(400).json({ error: "INVALID_APPOINTMENT", message: "Termin ist ungültig." });
  try {
    const result = await pool.query(
      `UPDATE appointments a SET status = 'CANCELLED', version = version + 1
        WHERE a.id = $1 AND a.version = $2 AND NOT EXISTS (
          SELECT 1 FROM bookings b WHERE b.appointment_id = a.id AND b.status <> 'CANCELLED'
        ) RETURNING id`,
      [id.data, parsed.data.version]
    );
    if (!result.rowCount) return void response.status(409).json({ error: "NOT_REMOVABLE", message: "Der Termin wurde geändert oder besitzt bereits Buchungen." });
    response.json({ removed: true });
  } catch (error) { next(error); }
});

planningRouter.patch("/settings", requirePlanningPermission("planning"), async (request, response, next) => {
  const parsed = settingsSchema.safeParse(request.body);
  if (!parsed.success) return void response.status(400).json({ error: "INVALID_SETTINGS", message: "Bitte gültige Fristen angeben." });
  try {
    await pool.query(
      `UPDATE booking_settings SET booking_cutoff_hours = $1, cancellation_cutoff_hours = $2`,
      [parsed.data.bookingCutoffHours, parsed.data.cancellationCutoffHours]
    );
    response.json({ updated: true });
  } catch (error) { next(error); }
});
