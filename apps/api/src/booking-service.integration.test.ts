import { randomUUID } from "node:crypto";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createStudentAccount, createTeacherAccount } from "./account-provisioning.js";
import { createBooking } from "./booking-service.js";
import { pool } from "./database.js";
import { endWeeklySchedule } from "./planning-service.js";

const runDatabaseTests = process.env.RUN_DATABASE_TESTS === "true";

describe.runIf(runDatabaseTests)("Buchungen mit echter PostgreSQL-Datenbank", () => {
  const marker = randomUUID().slice(0, 8);
  let actorAppUserId = "";
  let teamId = "";
  let roomOneId = "";
  let roomTwoId = "";
  let assessmentId = "";
  let timeSlotId = "";
  let overlappingTimeSlotId = "";
  let scheduleId = "";
  let appointmentOneId = "";
  let appointmentTwoId = "";
  const studentIds: string[] = [];
  const teacherIds: string[] = [];
  const authUserIds: string[] = [];

  beforeAll(async () => {
    const actor = await pool.query<{ id: string }>(
      `SELECT au.id FROM app_users au JOIN teacher_profiles tp ON tp.app_user_id = au.id
        WHERE au.active = true AND tp.can_manage_accounts = true LIMIT 1`
    );
    actorAppUserId = actor.rows[0]?.id ?? "";
    if (!actorAppUserId) throw new Error("Für den Integrationstest fehlt das Masterkonto.");

    teamId = (await pool.query<{ id: string }>("INSERT INTO teams (name) VALUES ($1) RETURNING id", [`Integration-${marker}`])).rows[0]!.id;
    roomOneId = (await pool.query<{ id: string }>("INSERT INTO rooms (name, default_capacity) VALUES ($1, 1) RETURNING id", [`Test-Raum-A-${marker}`])).rows[0]!.id;
    roomTwoId = (await pool.query<{ id: string }>("INSERT INTO rooms (name, default_capacity) VALUES ($1, 10) RETURNING id", [`Test-Raum-B-${marker}`])).rows[0]!.id;
    assessmentId = (await pool.query<{ id: string }>(
      "INSERT INTO assessment_definitions (subject, learning_house, title) VALUES ($1, $2, $3) RETURNING id",
      ["Testfach", "Testlernhaus", marker]
    )).rows[0]!.id;
    await pool.query("INSERT INTO team_assessment_requirements (team_id, assessment_id) VALUES ($1, $2)", [teamId, assessmentId]);

    const startsAt = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000);
    const endsAt = new Date(startsAt.getTime() + 60 * 60 * 1000);
    timeSlotId = (await pool.query<{ id: string }>(
      "INSERT INTO time_slots (starts_at, ends_at) VALUES ($1, $2) RETURNING id",
      [startsAt.toISOString(), endsAt.toISOString()]
    )).rows[0]!.id;
    scheduleId = (await pool.query<{ id: string }>(
      `INSERT INTO weekly_schedules
         (name, weekday, local_start_time, local_end_time, starts_on, ends_on, room_id, capacity)
       VALUES ($1, 1, '10:00', '11:00', current_date + 14, current_date + 14, $2, 1)
       RETURNING id`,
      [`Test-Serie-${marker}`, roomOneId]
    )).rows[0]!.id;
    appointmentOneId = (await pool.query<{ id: string }>(
      "INSERT INTO appointments (schedule_id, time_slot_id, room_id, capacity) VALUES ($1, $2, $3, 1) RETURNING id",
      [scheduleId, timeSlotId, roomOneId]
    )).rows[0]!.id;
    appointmentTwoId = (await pool.query<{ id: string }>(
      "INSERT INTO appointments (time_slot_id, room_id, capacity) VALUES ($1, $2, 10) RETURNING id",
      [timeSlotId, roomTwoId]
    )).rows[0]!.id;

    for (const name of [`Testperson Alpha ${marker}`, `Testperson Beta ${marker}`]) {
      const created = await createStudentAccount({ displayName: name, teamId, actorAppUserId, simpleInitialPassword: true });
      studentIds.push(created.student.id);
      const auth = await pool.query<{ auth_user_id: string }>(
        `SELECT au.auth_user_id FROM student_profiles sp JOIN app_users au ON au.id = sp.app_user_id WHERE sp.id = $1`,
        [created.student.id]
      );
      authUserIds.push(auth.rows[0]!.auth_user_id);
    }
  }, 30_000);

  afterAll(async () => {
    if (studentIds.length) await pool.query("DELETE FROM bookings WHERE student_profile_id = ANY($1::uuid[])", [studentIds]);
    if (authUserIds.length) await pool.query(`DELETE FROM "user" WHERE id = ANY($1::text[])`, [authUserIds]);
    if (appointmentOneId || appointmentTwoId) await pool.query("DELETE FROM appointments WHERE id = ANY($1::uuid[])", [[appointmentOneId, appointmentTwoId].filter(Boolean)]);
    if (scheduleId) await pool.query("DELETE FROM weekly_schedules WHERE id = $1", [scheduleId]);
    if (overlappingTimeSlotId) await pool.query("DELETE FROM time_slots WHERE id = $1", [overlappingTimeSlotId]);
    if (timeSlotId) await pool.query("DELETE FROM time_slots WHERE id = $1", [timeSlotId]);
    if (assessmentId) await pool.query("DELETE FROM assessment_definitions WHERE id = $1", [assessmentId]);
    if (roomOneId || roomTwoId) await pool.query("DELETE FROM rooms WHERE id = ANY($1::uuid[])", [[roomOneId, roomTwoId].filter(Boolean)]);
    if (teamId) await pool.query("DELETE FROM teams WHERE id = $1", [teamId]);
    if (studentIds.length) await pool.query("DELETE FROM audit_log WHERE entity_type = 'student_profile' AND entity_id = ANY($1::text[])", [studentIds]);
    if (teacherIds.length) await pool.query("DELETE FROM audit_log WHERE entity_type = 'teacher_profile' AND entity_id = ANY($1::text[])", [teacherIds]);
    if (scheduleId) await pool.query("DELETE FROM audit_log WHERE entity_type = 'weekly_schedule' AND entity_id = $1", [scheduleId]);
  }, 30_000);

  it("vergibt bei zwei gleichzeitigen Anfragen nur den letzten freien Platz", async () => {
    const results = await Promise.allSettled(studentIds.map((studentProfileId) => createBooking({
      studentProfileId,
      appointmentId: appointmentOneId,
      assessmentId,
      comment: null,
      actorAppUserId,
      enforceDeadline: true
    })));
    expect(results.filter((result) => result.status === "fulfilled")).toHaveLength(1);
    expect(results.filter((result) => result.status === "rejected")).toHaveLength(1);
  });

  it("verhindert für dieselbe Person eine zweite Buchung im gleichen Zeitfenster", async () => {
    const existing = await pool.query<{ student_profile_id: string }>(
      "SELECT student_profile_id FROM bookings WHERE appointment_id = $1 AND status = 'PLANNED'",
      [appointmentOneId]
    );
    await expect(createBooking({
      studentProfileId: existing.rows[0]!.student_profile_id,
      appointmentId: appointmentTwoId,
      assessmentId,
      comment: null,
      actorAppUserId,
      enforceDeadline: true
    })).rejects.toMatchObject({ name: "TIME_CONFLICT" });
  });

  it("verhindert auch teilweise überlappende Termine im selben Raum", async () => {
    const slot = await pool.query<{ starts_at: string; ends_at: string }>(
      "SELECT starts_at, ends_at FROM time_slots WHERE id = $1",
      [timeSlotId]
    );
    const startsAt = new Date(new Date(slot.rows[0]!.starts_at).getTime() + 30 * 60 * 1000);
    const endsAt = new Date(new Date(slot.rows[0]!.ends_at).getTime() + 30 * 60 * 1000);
    overlappingTimeSlotId = (await pool.query<{ id: string }>(
      "INSERT INTO time_slots (starts_at, ends_at) VALUES ($1, $2) RETURNING id",
      [startsAt.toISOString(), endsAt.toISOString()]
    )).rows[0]!.id;

    await expect(pool.query(
      "INSERT INTO appointments (time_slot_id, room_id, capacity) VALUES ($1, $2, 1)",
      [overlappingTimeSlotId, roomOneId]
    )).rejects.toMatchObject({ code: "23P01" });
  });

  it("legt ein persönliches Lehrkraftkonto nur für ausgewählte Teams an", async () => {
    const created = await createTeacherAccount({
      displayName: `Test Lerncoach ${marker}`,
      teamIds: [teamId],
      actorAppUserId
    });
    teacherIds.push(created.teacher.id);
    const record = await pool.query<{ auth_user_id: string; team_id: string }>(
      `SELECT au.auth_user_id, tta.team_id
         FROM teacher_profiles tp JOIN app_users au ON au.id = tp.app_user_id
         JOIN teacher_team_access tta ON tta.teacher_profile_id = tp.id
        WHERE tp.id = $1`,
      [created.teacher.id]
    );
    authUserIds.push(record.rows[0]!.auth_user_id);
    expect(created.teacher.canManageAccounts).toBe(false);
    expect(created.teacher.canManageTeams).toBe(false);
    expect(created.teacher.canManageAssessments).toBe(false);
    expect(created.teacher.canManagePlanning).toBe(false);
    expect(record.rows.map((row) => row.team_id)).toEqual([teamId]);
    expect(created.initialPassword.length).toBeGreaterThanOrEqual(10);
  });

  it("sperrt beim Beenden einer Serie alle Termine, ohne Buchungen zu verlieren", async () => {
    const cancelledOccurrences = await endWeeklySchedule(scheduleId, actorAppUserId);
    expect(cancelledOccurrences).toBe(1);

    const state = await pool.query<{ schedule_active: boolean; appointment_status: string; booking_count: number }>(
      `SELECT ws.active AS schedule_active, a.status AS appointment_status,
              count(b.id) FILTER (WHERE b.status = 'PLANNED')::int AS booking_count
         FROM weekly_schedules ws
         JOIN appointments a ON a.schedule_id = ws.id
         LEFT JOIN bookings b ON b.appointment_id = a.id
        WHERE ws.id = $1
        GROUP BY ws.active, a.status`,
      [scheduleId]
    );
    expect(state.rows[0]).toMatchObject({
      schedule_active: false,
      appointment_status: "CANCELLED",
      booking_count: 1
    });

    await expect(createBooking({
      studentProfileId: studentIds[1]!,
      appointmentId: appointmentOneId,
      assessmentId,
      comment: null,
      actorAppUserId,
      enforceDeadline: true
    })).rejects.toMatchObject({ name: "NOT_BOOKABLE" });
  });
});
