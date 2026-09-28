import type {
  CreateBookingResponse,
  StudentBookingSummary,
  StudentOverviewResponse,
  StudentPlannerResponse
} from "@gn-planer/contracts";
import { Router } from "express";
import { z } from "zod";
import { cancelOwnBooking, createBooking, namedError } from "../booking-service.js";
import { pool } from "../database.js";

export const studentRouter = Router();

const bookingSchema = z.object({
  appointmentId: z.string().uuid(),
  assessmentId: z.string().uuid(),
  comment: z.string().trim().max(1000).nullable()
});
const cancelSchema = z.object({ version: z.number().int().positive() });

async function getStudentProfile(appUserId: string) {
  const result = await pool.query<{ id: string; team_id: string | null; team_name: string | null }>(
    `SELECT sp.id, sp.team_id, t.name AS team_name
       FROM student_profiles sp
       LEFT JOIN teams t ON t.id = sp.team_id
      WHERE sp.app_user_id = $1`,
    [appUserId]
  );
  return result.rows[0] ?? null;
}

studentRouter.get("/planner", async (request, response, next) => {
  try {
    const profile = await getStudentProfile(request.principal!.appUserId);
    if (!profile) throw namedError("NOT_FOUND", "Schülerprofil wurde nicht gefunden.");
    const [assessments, appointments] = await Promise.all([
      pool.query(
        `SELECT ad.id, ad.subject, ad.learning_house AS "learningHouse", ad.title,
                ad.active, ARRAY[$1::uuid] AS "teamIds"
           FROM assessment_definitions ad
           JOIN team_assessment_requirements tar ON tar.assessment_id = ad.id
          WHERE tar.team_id = $1 AND ad.active = true
          ORDER BY lower(ad.subject), lower(ad.learning_house), lower(ad.title)`,
        [profile.team_id]
      ),
      pool.query(
        `SELECT
           a.id,
           a.schedule_id AS "scheduleId",
           ts.starts_at AS "startsAt",
           ts.ends_at AS "endsAt",
           r.id AS "roomId",
           r.name AS "roomName",
           a.capacity,
           count(all_b.id) FILTER (WHERE all_b.status = 'PLANNED')::int AS booked,
           a.status,
           a.version,
           (a.capacity - count(all_b.id) FILTER (WHERE all_b.status = 'PLANNED'))::int AS remaining,
           own_b.id AS "ownBookingId",
           CASE
             WHEN own_b.id IS NOT NULL THEN false
             WHEN a.status <> 'OPEN' OR ts.starts_at <= now() THEN false
             WHEN now() >= ts.starts_at - make_interval(hours => bs.booking_cutoff_hours) THEN false
             WHEN count(all_b.id) FILTER (WHERE all_b.status = 'PLANNED') >= a.capacity THEN false
             WHEN EXISTS (
               SELECT 1 FROM bookings conflict_b
               JOIN time_slots conflict_ts ON conflict_ts.id = conflict_b.time_slot_id
               WHERE conflict_b.student_profile_id = $1
                 AND conflict_b.status = 'PLANNED'
                 AND conflict_ts.starts_at < ts.ends_at
                 AND conflict_ts.ends_at > ts.starts_at
             ) THEN false
             ELSE true
           END AS "registrationOpen",
           CASE
             WHEN own_b.id IS NOT NULL THEN 'Bereits gebucht'
             WHEN a.status <> 'OPEN' OR ts.starts_at <= now() THEN 'Nicht buchbar'
             WHEN now() >= ts.starts_at - make_interval(hours => bs.booking_cutoff_hours) THEN 'Anmeldefrist abgelaufen'
             WHEN count(all_b.id) FILTER (WHERE all_b.status = 'PLANNED') >= a.capacity THEN 'Ausgebucht'
             WHEN EXISTS (
               SELECT 1 FROM bookings conflict_b
               JOIN time_slots conflict_ts ON conflict_ts.id = conflict_b.time_slot_id
               WHERE conflict_b.student_profile_id = $1
                 AND conflict_b.status = 'PLANNED'
                 AND conflict_ts.starts_at < ts.ends_at
                 AND conflict_ts.ends_at > ts.starts_at
             ) THEN 'Zeit bereits belegt'
             ELSE NULL
           END AS "restrictionReason"
         FROM appointments a
         JOIN time_slots ts ON ts.id = a.time_slot_id
         JOIN rooms r ON r.id = a.room_id
         CROSS JOIN booking_settings bs
         LEFT JOIN bookings all_b ON all_b.appointment_id = a.id
         LEFT JOIN bookings own_b ON own_b.appointment_id = a.id
            AND own_b.student_profile_id = $1 AND own_b.status = 'PLANNED'
         WHERE ts.starts_at > now() - interval '1 day'
         GROUP BY a.id, ts.id, r.id, own_b.id, bs.booking_cutoff_hours
         ORDER BY ts.starts_at, lower(r.name)`,
        [profile.id]
      )
    ]);
    const payload: StudentPlannerResponse = {
      teamName: profile.team_name,
      assessments: assessments.rows as StudentPlannerResponse["assessments"],
      appointments: appointments.rows as StudentPlannerResponse["appointments"]
    };
    response.json(payload);
  } catch (error) {
    next(error);
  }
});

studentRouter.post("/bookings", async (request, response, next) => {
  const parsed = bookingSchema.safeParse(request.body);
  if (!parsed.success) {
    response.status(400).json({ error: "INVALID_BOOKING", message: "Bitte Termin und Gelingensnachweis auswählen." });
    return;
  }
  try {
    const profile = await getStudentProfile(request.principal!.appUserId);
    if (!profile) throw namedError("NOT_FOUND", "Schülerprofil wurde nicht gefunden.");
    const bookingId = await createBooking({
      studentProfileId: profile.id,
      appointmentId: parsed.data.appointmentId,
      assessmentId: parsed.data.assessmentId,
      comment: parsed.data.comment || null,
      actorAppUserId: request.principal!.appUserId,
      enforceDeadline: true
    });
    const payload: CreateBookingResponse = { bookingId };
    response.status(201).json(payload);
  } catch (error) {
    if (error instanceof Error && ["NOT_BOOKABLE", "DEADLINE", "CAPACITY", "TIME_CONFLICT", "ASSESSMENT_NOT_ALLOWED"].includes(error.name)) {
      response.status(409).json({ error: error.name, message: error.message });
      return;
    }
    next(error);
  }
});

studentRouter.post("/bookings/:id/cancel", async (request, response, next) => {
  const parsedId = z.string().uuid().safeParse(request.params.id);
  const parsed = cancelSchema.safeParse(request.body);
  if (!parsedId.success || !parsed.success) {
    response.status(400).json({ error: "INVALID_CANCELLATION", message: "Anmeldung konnte nicht abgemeldet werden." });
    return;
  }
  try {
    const profile = await getStudentProfile(request.principal!.appUserId);
    if (!profile) throw namedError("NOT_FOUND", "Schülerprofil wurde nicht gefunden.");
    await cancelOwnBooking({
      bookingId: parsedId.data,
      studentProfileId: profile.id,
      version: parsed.data.version,
      actorAppUserId: request.principal!.appUserId
    });
    response.json({ cancelled: true });
  } catch (error) {
    if (error instanceof Error && ["NOT_FOUND", "STALE", "COMPLETED", "CANCELLED", "DEADLINE"].includes(error.name)) {
      response.status(409).json({ error: error.name, message: error.message });
      return;
    }
    next(error);
  }
});

studentRouter.get("/overview", async (request, response, next) => {
  try {
    const result = await pool.query<StudentBookingSummary>(
      `SELECT b.id, ts.starts_at AS "startsAt", ts.ends_at AS "endsAt",
              r.name AS "roomName", ad.subject, ad.learning_house AS "learningHouse",
              ad.title AS "assessmentTitle", b.comment, b.status, b.version,
              (b.status = 'PLANNED' AND now() < ts.starts_at - make_interval(hours => bs.cancellation_cutoff_hours)) AS "cancellationAllowed",
              (ts.starts_at - make_interval(hours => bs.cancellation_cutoff_hours)) AS "cancellationDeadline"
         FROM bookings b
         JOIN student_profiles sp ON sp.id = b.student_profile_id
         JOIN time_slots ts ON ts.id = b.time_slot_id
         JOIN appointments a ON a.id = b.appointment_id
         JOIN rooms r ON r.id = a.room_id
         JOIN assessment_definitions ad ON ad.id = b.assessment_id
         CROSS JOIN booking_settings bs
        WHERE sp.app_user_id = $1
        ORDER BY ts.starts_at DESC`,
      [request.principal!.appUserId]
    );
    const payload: StudentOverviewResponse = { bookings: result.rows };
    response.json(payload);
  } catch (error) {
    next(error);
  }
});
