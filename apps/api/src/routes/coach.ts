import type {
  CoachAssessmentState,
  CoachStudentSummary,
  TeacherBookingSummary,
  TeacherCoachResponse
} from "@gn-planer/contracts";
import { Router } from "express";
import { z } from "zod";
import { createBooking, updateBookingStatus } from "../booking-service.js";
import { pool } from "../database.js";

export const coachRouter = Router();

const uuid = z.string().uuid();
const bookingSchema = z.object({
  studentId: uuid,
  appointmentId: uuid,
  assessmentId: uuid,
  comment: z.string().trim().max(1000).nullable()
});
const statusSchema = z.object({
  status: z.enum(["PLANNED", "COMPLETED", "CANCELLED"]),
  version: z.number().int().positive()
});

function accessSql(canManageAccounts: boolean, parameterNumber: number) {
  return canManageAccounts
    ? `($${parameterNumber}::uuid IS NOT NULL)`
    : `EXISTS (
        SELECT 1 FROM teacher_profiles tp
        JOIN teacher_team_access tta ON tta.teacher_profile_id = tp.id
        WHERE tp.app_user_id = $${parameterNumber} AND tta.team_id = sp.team_id
      )`;
}

coachRouter.get("/teams", async (request, response, next) => {
  try {
    const access = request.principal!.canManageAccounts
      ? "($1::uuid IS NOT NULL)"
      : `EXISTS (
          SELECT 1 FROM teacher_profiles tp
          JOIN teacher_team_access tta ON tta.teacher_profile_id = tp.id
          WHERE tp.app_user_id = $1 AND tta.team_id = t.id
        )`;
    const [teams, appointments] = await Promise.all([
      pool.query(
        `SELECT t.id, t.name, count(sp.id)::int AS "studentCount"
           FROM teams t LEFT JOIN student_profiles sp ON sp.team_id = t.id
          WHERE t.active = true AND ${access}
          GROUP BY t.id ORDER BY lower(t.name)`,
        [request.principal!.appUserId]
      ),
      pool.query(
        `SELECT a.id, a.schedule_id AS "scheduleId", ts.starts_at AS "startsAt", ts.ends_at AS "endsAt",
                r.id AS "roomId", r.name AS "roomName", a.capacity,
                count(b.id) FILTER (WHERE b.status = 'PLANNED')::int AS booked,
                a.status, a.version
           FROM appointments a JOIN time_slots ts ON ts.id = a.time_slot_id
           JOIN rooms r ON r.id = a.room_id
           LEFT JOIN bookings b ON b.appointment_id = a.id
          WHERE a.status = 'OPEN' AND ts.starts_at > now()
          GROUP BY a.id, ts.id, r.id ORDER BY ts.starts_at, lower(r.name)`
      )
    ]);
    response.json({ teams: teams.rows, appointments: appointments.rows });
  } catch (error) { next(error); }
});

coachRouter.get("/", async (request, response, next) => {
  const teamId = typeof request.query.teamId === "string" ? request.query.teamId : null;
  if (teamId && !uuid.safeParse(teamId).success) {
    response.status(400).json({ error: "INVALID_TEAM", message: "Team ist ungültig." });
    return;
  }
  try {
    const params = [teamId, request.principal!.appUserId];
    const access = accessSql(request.principal!.canManageAccounts, 2);
    const [studentRows, statusRows, bookings] = await Promise.all([
      pool.query<{ studentId: string; displayName: string; teamId: string | null; teamName: string | null }>(
        `SELECT sp.id AS "studentId", au.display_name AS "displayName",
                t.id AS "teamId", t.name AS "teamName"
           FROM student_profiles sp
           JOIN app_users au ON au.id = sp.app_user_id AND au.active = true
           LEFT JOIN teams t ON t.id = sp.team_id
          WHERE ($1::uuid IS NULL OR sp.team_id = $1) AND ${access}
          ORDER BY lower(au.display_name)`,
        params
      ),
      pool.query<{
        studentId: string;
        displayName: string;
        teamId: string | null;
        teamName: string | null;
        assessmentId: string;
        subject: string;
        learningHouse: string;
        title: string;
        status: "OPEN" | "PLANNED" | "COMPLETED";
      }>(
        `SELECT sp.id AS "studentId", au.display_name AS "displayName",
                t.id AS "teamId", t.name AS "teamName",
                ad.id AS "assessmentId", ad.subject, ad.learning_house AS "learningHouse", ad.title,
                CASE
                  WHEN bool_or(b.status = 'PLANNED') THEN 'PLANNED'
                  WHEN bool_or(b.status = 'COMPLETED') THEN 'COMPLETED'
                  ELSE 'OPEN'
                END AS status
           FROM student_profiles sp
           JOIN app_users au ON au.id = sp.app_user_id AND au.active = true
           LEFT JOIN teams t ON t.id = sp.team_id
           JOIN team_assessment_requirements tar ON tar.team_id = sp.team_id
           JOIN assessment_definitions ad ON ad.id = tar.assessment_id AND ad.active = true
           LEFT JOIN bookings b ON b.student_profile_id = sp.id AND b.assessment_id = ad.id
          WHERE ($1::uuid IS NULL OR sp.team_id = $1) AND ${access}
          GROUP BY sp.id, au.display_name, t.id, t.name, ad.id
          ORDER BY lower(au.display_name), lower(ad.subject), lower(ad.learning_house), lower(ad.title)`,
        params
      ),
      pool.query<TeacherBookingSummary>(
        `SELECT b.id, sp.id AS "studentId", au.display_name AS "studentName",
                t.id AS "teamId", t.name AS "teamName", ts.starts_at AS "startsAt", ts.ends_at AS "endsAt",
                r.name AS "roomName", ad.subject, ad.learning_house AS "learningHouse",
                ad.title AS "assessmentTitle", b.comment, b.status, b.version,
                false AS "cancellationAllowed", ts.starts_at AS "cancellationDeadline"
           FROM bookings b
           JOIN student_profiles sp ON sp.id = b.student_profile_id
           JOIN app_users au ON au.id = sp.app_user_id
           LEFT JOIN teams t ON t.id = sp.team_id
           JOIN time_slots ts ON ts.id = b.time_slot_id
           JOIN appointments a ON a.id = b.appointment_id
           JOIN rooms r ON r.id = a.room_id
           JOIN assessment_definitions ad ON ad.id = b.assessment_id
          WHERE ($1::uuid IS NULL OR sp.team_id = $1) AND ${access}
          ORDER BY ts.starts_at DESC, lower(au.display_name)`,
        params
      )
    ]);

    const studentsById = new Map<string, CoachStudentSummary>(
      studentRows.rows.map((row) => [row.studentId, { ...row, assessments: [] }])
    );
    for (const row of statusRows.rows) {
      let student = studentsById.get(row.studentId);
      if (!student) {
        student = {
          studentId: row.studentId,
          displayName: row.displayName,
          teamId: row.teamId,
          teamName: row.teamName,
          assessments: []
        };
        studentsById.set(row.studentId, student);
      }
      const state: CoachAssessmentState = {
        assessmentId: row.assessmentId,
        subject: row.subject,
        learningHouse: row.learningHouse,
        title: row.title,
        status: row.status
      };
      student.assessments.push(state);
    }
    const payload: TeacherCoachResponse = {
      students: [...studentsById.values()],
      bookings: bookings.rows
    };
    response.json(payload);
  } catch (error) {
    next(error);
  }
});

coachRouter.post("/bookings", async (request, response, next) => {
  const parsed = bookingSchema.safeParse(request.body);
  if (!parsed.success) {
    response.status(400).json({ error: "INVALID_BOOKING", message: "Bitte Schüler*in, Termin und Nachweis auswählen." });
    return;
  }
  try {
    const allowed = await pool.query(
      `SELECT 1 FROM student_profiles sp WHERE sp.id = $1 AND ${accessSql(request.principal!.canManageAccounts, 2)}`,
      [parsed.data.studentId, request.principal!.appUserId]
    );
    if (!allowed.rowCount) {
      response.status(403).json({ error: "FORBIDDEN", message: "Für dieses Team fehlt die Berechtigung." });
      return;
    }
    const bookingId = await createBooking({
      studentProfileId: parsed.data.studentId,
      appointmentId: parsed.data.appointmentId,
      assessmentId: parsed.data.assessmentId,
      comment: parsed.data.comment || null,
      actorAppUserId: request.principal!.appUserId,
      enforceDeadline: false
    });
    response.status(201).json({ bookingId });
  } catch (error) {
    if (error instanceof Error && ["NOT_BOOKABLE", "CAPACITY", "TIME_CONFLICT", "ASSESSMENT_NOT_ALLOWED"].includes(error.name)) {
      response.status(409).json({ error: error.name, message: error.message });
      return;
    }
    next(error);
  }
});

coachRouter.post("/bookings/:id/status", async (request, response, next) => {
  const id = uuid.safeParse(request.params.id);
  const parsed = statusSchema.safeParse(request.body);
  if (!id.success || !parsed.success) {
    response.status(400).json({ error: "INVALID_STATUS", message: "Statusänderung ist ungültig." });
    return;
  }
  try {
    const allowed = await pool.query(
      `SELECT 1
         FROM bookings b
         JOIN student_profiles sp ON sp.id = b.student_profile_id
        WHERE b.id = $1 AND ${accessSql(request.principal!.canManageAccounts, 2)}`,
      [id.data, request.principal!.appUserId]
    );
    if (!allowed.rowCount) {
      response.status(403).json({ error: "FORBIDDEN", message: "Für dieses Team fehlt die Berechtigung." });
      return;
    }
    await updateBookingStatus({
      bookingId: id.data,
      status: parsed.data.status,
      version: parsed.data.version,
      actorAppUserId: request.principal!.appUserId
    });
    response.json({ updated: true });
  } catch (error) {
    if (error instanceof Error && ["STALE", "CONFLICT"].includes(error.name)) {
      response.status(409).json({ error: error.name, message: error.message });
      return;
    }
    next(error);
  }
});

function csvCell(value: unknown) {
  const text = String(value ?? "");
  const safe = /^[=+\-@]/.test(text) ? `'${text}` : text;
  return `"${safe.replaceAll('"', '""')}"`;
}

coachRouter.get("/export.csv", async (request, response, next) => {
  const teamId = typeof request.query.teamId === "string" ? request.query.teamId : null;
  if (teamId && !uuid.safeParse(teamId).success) {
    response.status(400).json({ error: "INVALID_TEAM", message: "Team ist ungültig." });
    return;
  }
  try {
    const rows = await pool.query(
      `SELECT t.name AS team, au.display_name AS student, ts.starts_at, ts.ends_at,
              r.name AS room, ad.subject, ad.learning_house, ad.title, b.status, b.comment
         FROM bookings b
         JOIN student_profiles sp ON sp.id = b.student_profile_id
         JOIN app_users au ON au.id = sp.app_user_id
         LEFT JOIN teams t ON t.id = sp.team_id
         JOIN time_slots ts ON ts.id = b.time_slot_id
         JOIN appointments a ON a.id = b.appointment_id
         JOIN rooms r ON r.id = a.room_id
         JOIN assessment_definitions ad ON ad.id = b.assessment_id
        WHERE ($1::uuid IS NULL OR sp.team_id = $1) AND ${accessSql(request.principal!.canManageAccounts, 2)}
        ORDER BY ts.starts_at, lower(t.name), lower(au.display_name)`,
      [teamId, request.principal!.appUserId]
    );
    const header = ["Team", "Schüler*in", "Beginn", "Ende", "Raum", "Fach", "Lernhaus", "Nachweis", "Status", "Kommentar"];
    const lines = [header, ...rows.rows.map((row) => [
      row.team, row.student, row.starts_at, row.ends_at, row.room, row.subject,
      row.learning_house, row.title, row.status, row.comment
    ])]
      .map((row) => row.map(csvCell).join(";"));
    const body = `\uFEFF${lines.join("\r\n")}`;
    response.setHeader("Content-Type", "text/csv; charset=utf-8");
    response.setHeader("Content-Disposition", 'attachment; filename="gn-anmeldungen.csv"');
    response.send(body);
  } catch (error) {
    next(error);
  }
});
