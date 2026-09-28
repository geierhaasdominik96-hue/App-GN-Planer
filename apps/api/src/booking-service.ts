import type { BookingStatus } from "./domain-types.js";
import { pool } from "./database.js";

interface CreateBookingInput {
  studentProfileId: string;
  appointmentId: string;
  assessmentId: string;
  comment: string | null;
  actorAppUserId: string;
  enforceDeadline: boolean;
}

export async function createBooking(input: CreateBookingInput) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const appointment = await client.query<{
      time_slot_id: string;
      starts_at: string;
      status: "OPEN" | "CANCELLED";
      capacity: number;
      booked: number;
      booking_cutoff_hours: number;
    }>(
      `SELECT a.time_slot_id, ts.starts_at, a.status, a.capacity,
              (SELECT count(*)::int FROM bookings b WHERE b.appointment_id = a.id AND b.status = 'PLANNED') AS booked,
              bs.booking_cutoff_hours
         FROM appointments a
         JOIN time_slots ts ON ts.id = a.time_slot_id
         CROSS JOIN booking_settings bs
        WHERE a.id = $1
        FOR UPDATE OF a`,
      [input.appointmentId]
    );
    const slot = appointment.rows[0];
    if (!slot || slot.status !== "OPEN") throw namedError("NOT_BOOKABLE", "Dieser Termin ist nicht buchbar.");
    if (new Date(slot.starts_at) <= new Date()) throw namedError("NOT_BOOKABLE", "Dieser Termin liegt bereits in der Vergangenheit.");
    if (input.enforceDeadline && Date.now() >= new Date(slot.starts_at).getTime() - slot.booking_cutoff_hours * 3_600_000) {
      throw namedError("DEADLINE", "Die Anmeldefrist für diesen Termin ist bereits abgelaufen.");
    }
    if (slot.booked >= slot.capacity) throw namedError("CAPACITY", "Dieser Termin ist inzwischen ausgebucht.");

    const allowed = await client.query(
      `SELECT 1
         FROM student_profiles sp
         JOIN team_assessment_requirements tar ON tar.team_id = sp.team_id
         JOIN assessment_definitions ad ON ad.id = tar.assessment_id AND ad.active = true
        WHERE sp.id = $1 AND ad.id = $2`,
      [input.studentProfileId, input.assessmentId]
    );
    if (allowed.rowCount === 0) {
      throw namedError("ASSESSMENT_NOT_ALLOWED", "Dieser Gelingensnachweis ist für das Team nicht freigegeben.");
    }

    const result = await client.query<{ id: string; demo_dataset_id: string | null }>(
      `INSERT INTO bookings
         (student_profile_id, appointment_id, time_slot_id, assessment_id, comment)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, demo_dataset_id`,
      [input.studentProfileId, input.appointmentId, slot.time_slot_id, input.assessmentId, input.comment]
    );
    await client.query(
      `INSERT INTO audit_log
         (actor_app_user_id, action, entity_type, entity_id, details, demo_dataset_id)
       VALUES ($1, 'BOOKING_CREATED', 'booking', $2, $3::jsonb, $4)`,
      [
        input.actorAppUserId,
        result.rows[0]!.id,
        JSON.stringify({ appointmentId: input.appointmentId }),
        result.rows[0]!.demo_dataset_id
      ]
    );
    await client.query("COMMIT");
    return result.rows[0]!.id;
  } catch (error) {
    await client.query("ROLLBACK");
    if (error instanceof Error && /andere Anmeldung|one_planned_booking|duplicate key/i.test(error.message)) {
      throw namedError("TIME_CONFLICT", "Zu dieser Zeit besteht bereits eine andere Anmeldung.");
    }
    if (error instanceof Error && /ausgebucht/i.test(error.message)) {
      throw namedError("CAPACITY", "Dieser Termin ist inzwischen ausgebucht.");
    }
    throw error;
  } finally {
    client.release();
  }
}

interface CancelBookingInput {
  bookingId: string;
  studentProfileId: string;
  version: number;
  actorAppUserId: string;
}

export async function cancelOwnBooking(input: CancelBookingInput) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const result = await client.query<{
      status: BookingStatus;
      version: number;
      starts_at: string;
      cancellation_cutoff_hours: number;
      demo_dataset_id: string | null;
    }>(
      `SELECT b.status, b.version, ts.starts_at, bs.cancellation_cutoff_hours,
              b.demo_dataset_id
         FROM bookings b
         JOIN time_slots ts ON ts.id = b.time_slot_id
         CROSS JOIN booking_settings bs
        WHERE b.id = $1 AND b.student_profile_id = $2
        FOR UPDATE OF b`,
      [input.bookingId, input.studentProfileId]
    );
    const booking = result.rows[0];
    if (!booking) throw namedError("NOT_FOUND", "Anmeldung wurde nicht gefunden.");
    if (booking.version !== input.version) throw namedError("STALE", "Die Anmeldung wurde inzwischen geändert. Bitte neu laden.");
    if (booking.status === "COMPLETED") throw namedError("COMPLETED", "Ein erledigter Nachweis kann nicht abgemeldet werden.");
    if (booking.status === "CANCELLED") throw namedError("CANCELLED", "Diese Anmeldung wurde bereits abgemeldet.");
    if (Date.now() >= new Date(booking.starts_at).getTime() - booking.cancellation_cutoff_hours * 3_600_000) {
      throw namedError("DEADLINE", "Die Abmeldefrist ist bereits abgelaufen. Bitte wende dich an eine Lehrkraft.");
    }
    await client.query(
      `UPDATE bookings
          SET status = 'CANCELLED', cancelled_at = now(), version = version + 1
        WHERE id = $1`,
      [input.bookingId]
    );
    await client.query(
      `INSERT INTO audit_log
         (actor_app_user_id, action, entity_type, entity_id, demo_dataset_id)
       VALUES ($1, 'BOOKING_CANCELLED_BY_STUDENT', 'booking', $2, $3)`,
      [input.actorAppUserId, input.bookingId, booking.demo_dataset_id]
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

interface UpdateBookingStatusInput {
  bookingId: string;
  status: BookingStatus;
  version: number;
  actorAppUserId: string;
}

export async function updateBookingStatus(input: UpdateBookingStatusInput) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const updated = await client.query<{ id: string; demo_dataset_id: string | null }>(
      `UPDATE bookings
          SET status = $2,
              completed_at = CASE WHEN $2 = 'COMPLETED' THEN now() ELSE NULL END,
              cancelled_at = CASE WHEN $2 = 'CANCELLED' THEN now() ELSE NULL END,
              version = version + 1
        WHERE id = $1 AND version = $3
        RETURNING id, demo_dataset_id`,
      [input.bookingId, input.status, input.version]
    );
    if (updated.rowCount === 0) throw namedError("STALE", "Die Anmeldung wurde inzwischen geändert. Bitte neu laden.");
    await client.query(
      `INSERT INTO audit_log
         (actor_app_user_id, action, entity_type, entity_id, details, demo_dataset_id)
       VALUES ($1, 'BOOKING_STATUS_CHANGED', 'booking', $2, $3::jsonb, $4)`,
      [
        input.actorAppUserId,
        input.bookingId,
        JSON.stringify({ status: input.status }),
        updated.rows[0]!.demo_dataset_id
      ]
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    if (error instanceof Error && /andere Anmeldung|ausgebucht/i.test(error.message)) {
      throw namedError("CONFLICT", error.message);
    }
    throw error;
  } finally {
    client.release();
  }
}

export function namedError(name: string, message: string) {
  const error = new Error(message);
  error.name = name;
  return error;
}
