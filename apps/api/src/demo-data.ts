import type {
  CreateDemoDataResponse,
  DeleteDemoDataResponse,
  DemoCredential,
  DemoDataCounts,
  DemoDataStatusResponse
} from "@gn-planer/contracts";
import type { PoolClient } from "pg";
import {
  createNumericInitialPassword,
  createStudentAccount
} from "./account-provisioning.js";
import { pool } from "./database.js";

const demoLockName = "gn-planer-demo-data-v1";

const emptyCounts: DemoDataCounts = {
  teams: 0,
  students: 0,
  rooms: 0,
  assessments: 0,
  schedules: 0,
  appointments: 0,
  bookings: 0
};

interface DemoDatasetRow {
  id: string;
  ready: boolean;
  created_at: Date | string;
}

interface DemoStudentSeed {
  displayName: string;
  teamIndex: 0 | 1;
}

interface CreatedDemoStudent extends DemoStudentSeed {
  profileId: string;
  loginId: string;
  initialPassword: string;
}

interface ScheduleSeed {
  name: string;
  startsOn: string;
  startTime: string;
  endTime: string;
  occurrenceCount: number;
  roomId: string;
  capacity: number;
}

export class DemoDataAlreadyExistsError extends Error {
  constructor() {
    super("Es sind bereits Demodaten vorhanden. Verwende zum Neuaufsetzen die Funktion ‚Auf Ausgangszustand zurücksetzen‘.");
    this.name = "DEMO_DATA_EXISTS";
  }
}

export class DemoDataInUseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DEMO_DATA_IN_USE";
  }
}

function isoTimestamp(value: Date | string) {
  return value instanceof Date ? value.toISOString() : new Date(value).toISOString();
}

function addDays(isoDate: string, days: number) {
  const [year, month, day] = isoDate.split("-").map(Number);
  const value = new Date(Date.UTC(year!, month! - 1, day! + days));
  return value.toISOString().slice(0, 10);
}

/** Gibt immer den nächsten (nicht den heutigen) ISO-Wochentag zurück. */
export function nextIsoWeekday(isoDate: string, targetWeekday: number) {
  const [year, month, day] = isoDate.split("-").map(Number);
  const value = new Date(Date.UTC(year!, month! - 1, day!));
  const currentWeekday = value.getUTCDay() === 0 ? 7 : value.getUTCDay();
  const distance = (targetWeekday - currentWeekday + 7) % 7 || 7;
  return addDays(isoDate, distance);
}

function previousIsoWeekday(isoDate: string, targetWeekday: number) {
  const [year, month, day] = isoDate.split("-").map(Number);
  const value = new Date(Date.UTC(year!, month! - 1, day!));
  const currentWeekday = value.getUTCDay() === 0 ? 7 : value.getUTCDay();
  const distance = (currentWeekday - targetWeekday + 7) % 7 || 7;
  return addDays(isoDate, -distance);
}

async function withDemoLock<T>(work: (client: PoolClient) => Promise<T>) {
  const client = await pool.connect();
  try {
    await client.query("SELECT pg_advisory_lock(hashtextextended($1, 0))", [demoLockName]);
    return await work(client);
  } finally {
    try {
      await client.query("SELECT pg_advisory_unlock(hashtextextended($1, 0))", [demoLockName]);
    } finally {
      client.release();
    }
  }
}

async function currentDataset(client: PoolClient, forUpdate = false) {
  const result = await client.query<DemoDatasetRow>(
    `SELECT id, ready, created_at
       FROM demo_datasets
      ORDER BY created_at
      LIMIT 1${forUpdate ? " FOR UPDATE" : ""}`
  );
  return result.rows[0] ?? null;
}

async function statusForDataset(
  client: PoolClient,
  dataset: DemoDatasetRow | null
): Promise<DemoDataStatusResponse> {
  if (!dataset) {
    return { active: false, createdAt: null, counts: { ...emptyCounts } };
  }

  const result = await client.query<{
    teams: number;
    students: number;
    rooms: number;
    assessments: number;
    schedules: number;
    appointments: number;
    bookings: number;
  }>(
    `SELECT
       (SELECT count(*)::int FROM teams WHERE demo_dataset_id = $1) AS teams,
       (SELECT count(*)::int FROM app_users WHERE demo_dataset_id = $1 AND role = 'STUDENT') AS students,
       (SELECT count(*)::int FROM rooms WHERE demo_dataset_id = $1) AS rooms,
       (SELECT count(*)::int FROM assessment_definitions WHERE demo_dataset_id = $1) AS assessments,
       (SELECT count(*)::int FROM weekly_schedules WHERE demo_dataset_id = $1) AS schedules,
       (SELECT count(*)::int FROM appointments WHERE demo_dataset_id = $1) AS appointments,
       (SELECT count(*)::int FROM bookings WHERE demo_dataset_id = $1) AS bookings`,
    [dataset.id]
  );

  return {
    active: true,
    createdAt: isoTimestamp(dataset.created_at),
    counts: result.rows[0] ?? { ...emptyCounts }
  };
}

export async function getDemoDataStatus(): Promise<DemoDataStatusResponse> {
  return withDemoLock(async (client) => statusForDataset(client, await currentDataset(client)));
}

async function lockDemoRows(client: PoolClient, datasetId: string) {
  // Die Elternzeilen werden vor der Abhängigkeitsprüfung gesperrt. Neue
  // Fremdschlüssel-Verweise warten dadurch bis zum Commit und können nicht
  // unbemerkt zwischen Prüfung und Löschen entstehen.
  await client.query("SELECT id FROM teams WHERE demo_dataset_id = $1 FOR UPDATE", [datasetId]);
  await client.query("SELECT id FROM rooms WHERE demo_dataset_id = $1 FOR UPDATE", [datasetId]);
  await client.query("SELECT id FROM assessment_definitions WHERE demo_dataset_id = $1 FOR UPDATE", [datasetId]);
  await client.query("SELECT id FROM weekly_schedules WHERE demo_dataset_id = $1 FOR UPDATE", [datasetId]);
  await client.query("SELECT id FROM time_slots WHERE demo_dataset_id = $1 FOR UPDATE", [datasetId]);
  await client.query("SELECT id FROM appointments WHERE demo_dataset_id = $1 FOR UPDATE", [datasetId]);
  await client.query("SELECT id FROM app_users WHERE demo_dataset_id = $1 FOR UPDATE", [datasetId]);
  await client.query(
    `SELECT sp.id
       FROM student_profiles sp
       JOIN app_users au ON au.id = sp.app_user_id
      WHERE au.demo_dataset_id = $1
      FOR UPDATE OF sp`,
    [datasetId]
  );
  await client.query("SELECT id FROM bookings WHERE demo_dataset_id = $1 FOR UPDATE", [datasetId]);
}

async function findUnsafeDependency(client: PoolClient, datasetId: string) {
  const result = await client.query<{ reason: string | null }>(
    `SELECT CASE
       WHEN EXISTS (
         SELECT 1
           FROM student_profiles sp
           JOIN app_users au ON au.id = sp.app_user_id
           JOIN teams t ON t.id = sp.team_id
          WHERE t.demo_dataset_id = $1
            AND au.demo_dataset_id IS DISTINCT FROM $1::uuid
       ) THEN 'Mindestens ein echtes Schülerkonto ist einem Demo-Team zugeordnet.'
       WHEN EXISTS (
         SELECT 1
           FROM teacher_team_access tta
           JOIN teacher_profiles tp ON tp.id = tta.teacher_profile_id
           JOIN app_users au ON au.id = tp.app_user_id
           JOIN teams t ON t.id = tta.team_id
          WHERE t.demo_dataset_id = $1
            AND au.demo_dataset_id IS DISTINCT FROM $1::uuid
       ) THEN 'Mindestens eine echte Lehrkraft besitzt Zugriff auf ein Demo-Team.'
       WHEN EXISTS (
         SELECT 1
           FROM team_invitations ti
           JOIN teams t ON t.id = ti.team_id
          WHERE t.demo_dataset_id = $1
            AND ti.demo_dataset_id IS DISTINCT FROM $1::uuid
       ) THEN 'Eine nicht als Demo gekennzeichnete Einladung verweist auf ein Demo-Team.'
       WHEN EXISTS (
         SELECT 1
           FROM team_assessment_requirements tar
           JOIN teams t ON t.id = tar.team_id
           JOIN assessment_definitions ad ON ad.id = tar.assessment_id
          WHERE (t.demo_dataset_id = $1 AND ad.demo_dataset_id IS DISTINCT FROM $1::uuid)
             OR (ad.demo_dataset_id = $1 AND t.demo_dataset_id IS DISTINCT FROM $1::uuid)
       ) THEN 'Ein echtes Team oder ein echter Gelingensnachweis ist mit einem Demo-Eintrag verknüpft.'
       WHEN EXISTS (
         SELECT 1
           FROM weekly_schedules ws
           JOIN rooms r ON r.id = ws.room_id
          WHERE r.demo_dataset_id = $1
            AND ws.demo_dataset_id IS DISTINCT FROM $1::uuid
       ) THEN 'Eine echte Terminserie verwendet einen Demo-Raum.'
       WHEN EXISTS (
         SELECT 1
           FROM appointments a
           LEFT JOIN weekly_schedules ws ON ws.id = a.schedule_id
           JOIN rooms r ON r.id = a.room_id
          WHERE a.demo_dataset_id IS DISTINCT FROM $1::uuid
            AND (r.demo_dataset_id = $1 OR ws.demo_dataset_id = $1)
       ) THEN 'Ein echter Termin verweist auf einen Demo-Raum oder eine Demo-Terminserie.'
       WHEN EXISTS (
         SELECT 1
           FROM bookings b
           JOIN appointments a ON a.id = b.appointment_id
           JOIN assessment_definitions ad ON ad.id = b.assessment_id
           JOIN student_profiles sp ON sp.id = b.student_profile_id
           JOIN app_users au ON au.id = sp.app_user_id
          WHERE b.demo_dataset_id IS DISTINCT FROM $1::uuid
            AND (a.demo_dataset_id = $1 OR ad.demo_dataset_id = $1 OR au.demo_dataset_id = $1)
       ) THEN 'Eine echte Buchung verweist auf einen Demo-Termin, Demo-Nachweis oder ein Demo-Konto.'
       ELSE NULL
     END AS reason`,
    [datasetId]
  );
  return result.rows[0]?.reason ?? null;
}

async function deleteCurrentDatasetUnlocked(
  client: PoolClient,
  actorAppUserId: string,
  auditAction: "DEMO_DATA_DELETED" | "DEMO_DATA_RESET"
) {
  await client.query("BEGIN");
  try {
    const dataset = await currentDataset(client, true);
    if (!dataset) {
      await client.query("COMMIT");
      return false;
    }

    await lockDemoRows(client, dataset.id);
    const reason = await findUnsafeDependency(client, dataset.id);
    if (reason) {
      throw new DemoDataInUseError(
        `${reason} Die Demodaten wurden zum Schutz echter Schuldaten nicht verändert. Löse diese Verknüpfung zuerst in der Verwaltung.`
      );
    }

    const before = await statusForDataset(client, dataset);

    // Audit-Einträge zuerst entfernen: Der Marker hat absichtlich eine
    // RESTRICT-Fremdschlüsselregel, damit keine Historie versehentlich bleibt.
    await client.query(
      `DELETE FROM audit_log al
        WHERE al.demo_dataset_id = $1
           OR al.actor_app_user_id IN (
             SELECT id FROM app_users WHERE demo_dataset_id = $1
           )
           OR (al.entity_type = 'student_profile' AND al.entity_id IN (
             SELECT sp.id::text
               FROM student_profiles sp
               JOIN app_users au ON au.id = sp.app_user_id
              WHERE au.demo_dataset_id = $1
           ))
           OR (al.entity_type = 'booking' AND al.entity_id IN (
             SELECT id::text FROM bookings WHERE demo_dataset_id = $1
           ))
           OR (al.entity_type = 'team' AND al.entity_id IN (
             SELECT id::text FROM teams WHERE demo_dataset_id = $1
           ))
           OR (al.entity_type = 'team_invitation' AND al.entity_id IN (
             SELECT id::text FROM team_invitations WHERE demo_dataset_id = $1
           ))
           OR (al.entity_type = 'weekly_schedule' AND al.entity_id IN (
             SELECT id::text FROM weekly_schedules WHERE demo_dataset_id = $1
           ))`,
      [dataset.id]
    );

    await client.query("DELETE FROM bookings WHERE demo_dataset_id = $1", [dataset.id]);
    await client.query("DELETE FROM team_invitations WHERE demo_dataset_id = $1", [dataset.id]);
    await client.query("DELETE FROM appointments WHERE demo_dataset_id = $1", [dataset.id]);
    await client.query("DELETE FROM weekly_schedules WHERE demo_dataset_id = $1", [dataset.id]);

    // Better Auth löscht Konten, Sessions und die zugehörigen App-Profile über
    // die vorhandenen Fremdschlüsselregeln. Das Masterkonto besitzt nie diesen
    // Marker und kann daher von dieser Abfrage nicht erfasst werden.
    await client.query(
      `DELETE FROM "user" u
        USING app_users au
        WHERE au.auth_user_id = u.id
          AND au.demo_dataset_id = $1`,
      [dataset.id]
    );

    await client.query("DELETE FROM assessment_definitions WHERE demo_dataset_id = $1", [dataset.id]);
    await client.query("DELETE FROM rooms WHERE demo_dataset_id = $1", [dataset.id]);
    await client.query("DELETE FROM teams WHERE demo_dataset_id = $1", [dataset.id]);

    // Ein Zeitfenster darf von einem echten Termin mitbenutzt werden. In
    // diesem Fall wird nur der Demo-Marker gelöst; ansonsten wird es entfernt.
    await client.query(
      `DELETE FROM time_slots ts
        WHERE ts.demo_dataset_id = $1
          AND NOT EXISTS (SELECT 1 FROM appointments a WHERE a.time_slot_id = ts.id)`,
      [dataset.id]
    );
    await client.query(
      "UPDATE time_slots SET demo_dataset_id = NULL WHERE demo_dataset_id = $1",
      [dataset.id]
    );

    await client.query("DELETE FROM demo_datasets WHERE id = $1", [dataset.id]);
    await client.query(
      `INSERT INTO audit_log (actor_app_user_id, action, entity_type, entity_id, details)
       VALUES ($1, $2, 'demo_dataset', $3, $4::jsonb)`,
      [actorAppUserId, auditAction, dataset.id, JSON.stringify(before.counts)]
    );
    await client.query("COMMIT");
    return true;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
}

async function uniqueNamedEntity(
  client: PoolClient,
  table: "teams" | "rooms",
  baseName: string,
  suffix: string
) {
  const existing = await client.query(`SELECT 1 FROM ${table} WHERE name = $1`, [baseName]);
  return existing.rowCount === 0 ? baseName : `${baseName} [${suffix}]`;
}

async function uniqueAssessmentTitle(
  client: PoolClient,
  subject: string,
  learningHouse: string,
  baseTitle: string,
  suffix: string
) {
  const existing = await client.query(
    `SELECT 1 FROM assessment_definitions
      WHERE subject = $1 AND learning_house = $2 AND title = $3`,
    [subject, learningHouse, baseTitle]
  );
  return existing.rowCount === 0 ? baseTitle : `${baseTitle} [${suffix}]`;
}

async function ensureTimeSlot(
  client: PoolClient,
  datasetId: string,
  localDate: string,
  startTime: string,
  endTime: string
) {
  const result = await client.query<{ id: string }>(
    `WITH inserted AS (
       INSERT INTO time_slots (starts_at, ends_at, demo_dataset_id)
       VALUES (
         ($2::date + $3::time) AT TIME ZONE 'Europe/Berlin',
         ($2::date + $4::time) AT TIME ZONE 'Europe/Berlin',
         $1
       )
       ON CONFLICT (starts_at, ends_at) DO NOTHING
       RETURNING id
     )
     SELECT id FROM inserted
     UNION ALL
     SELECT id
       FROM time_slots
      WHERE starts_at = ($2::date + $3::time) AT TIME ZONE 'Europe/Berlin'
        AND ends_at = ($2::date + $4::time) AT TIME ZONE 'Europe/Berlin'
     LIMIT 1`,
    [datasetId, localDate, startTime, endTime]
  );
  const id = result.rows[0]?.id;
  if (!id) throw new Error("Das Demo-Zeitfenster konnte nicht angelegt werden.");
  return id;
}

async function createSchedule(
  client: PoolClient,
  datasetId: string,
  seed: ScheduleSeed
) {
  const endsOn = addDays(seed.startsOn, (seed.occurrenceCount - 1) * 7);
  const [year, month, day] = seed.startsOn.split("-").map(Number);
  const date = new Date(Date.UTC(year!, month! - 1, day!));
  const weekday = date.getUTCDay() === 0 ? 7 : date.getUTCDay();
  const schedule = await client.query<{ id: string }>(
    `INSERT INTO weekly_schedules
       (name, weekday, local_start_time, local_end_time, starts_on, ends_on,
        room_id, capacity, demo_dataset_id)
     VALUES ($1, $2, $3::time, $4::time, $5::date, $6::date, $7, $8, $9)
     RETURNING id`,
    [
      seed.name,
      weekday,
      seed.startTime,
      seed.endTime,
      seed.startsOn,
      endsOn,
      seed.roomId,
      seed.capacity,
      datasetId
    ]
  );

  const appointmentIds: string[] = [];
  for (let index = 0; index < seed.occurrenceCount; index += 1) {
    const occurrenceDate = addDays(seed.startsOn, index * 7);
    const timeSlotId = await ensureTimeSlot(
      client,
      datasetId,
      occurrenceDate,
      seed.startTime,
      seed.endTime
    );
    const appointment = await client.query<{ id: string }>(
      `INSERT INTO appointments
         (schedule_id, time_slot_id, room_id, capacity, demo_dataset_id)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id`,
      [schedule.rows[0]!.id, timeSlotId, seed.roomId, seed.capacity, datasetId]
    );
    appointmentIds.push(appointment.rows[0]!.id);
  }

  return { scheduleId: schedule.rows[0]!.id, appointmentIds };
}

async function seedFinishedDemoData(
  client: PoolClient,
  datasetId: string,
  teamIds: [string, string],
  createdStudents: CreatedDemoStudent[],
  suffix: string
) {
  await client.query("BEGIN");
  try {
    const roomNames = [
      await uniqueNamedEntity(client, "rooms", "Demo-Lernatelier", suffix),
      await uniqueNamedEntity(client, "rooms", "Demo-Prüfungsraum", suffix)
    ] as const;
    const roomResult = await client.query<{ id: string; name: string }>(
      `INSERT INTO rooms (name, default_capacity, demo_dataset_id)
       VALUES ($1, 12, $3), ($2, 6, $3)
       RETURNING id, name`,
      [roomNames[0], roomNames[1], datasetId]
    );
    const roomByName = new Map(roomResult.rows.map((room) => [room.name, room.id]));
    const roomIds = [roomByName.get(roomNames[0])!, roomByName.get(roomNames[1])!] as const;

    const assessmentSeeds = [
      { subject: "Mathematik", learningHouse: "Lernhaus 2", title: "Brüche und Prozente", teams: [0, 1] },
      { subject: "Deutsch", learningHouse: "Lernhaus 1", title: "Erzähltexte", teams: [0] },
      { subject: "Englisch", learningHouse: "Lernhaus 1", title: "Vocabulary Check", teams: [0, 1] },
      { subject: "Naturwissenschaften", learningHouse: "Lernhaus 2", title: "Energie", teams: [1] }
    ] as const;
    const assessmentIds: string[] = [];
    for (const seed of assessmentSeeds) {
      const title = await uniqueAssessmentTitle(
        client,
        seed.subject,
        seed.learningHouse,
        seed.title,
        suffix
      );
      const assessment = await client.query<{ id: string }>(
        `INSERT INTO assessment_definitions
           (subject, learning_house, title, demo_dataset_id)
         VALUES ($1, $2, $3, $4)
         RETURNING id`,
        [seed.subject, seed.learningHouse, title, datasetId]
      );
      const assessmentId = assessment.rows[0]!.id;
      assessmentIds.push(assessmentId);
      await client.query(
        `INSERT INTO team_assessment_requirements (team_id, assessment_id)
         SELECT $2[value], $1
           FROM generate_subscripts($2::uuid[], 1) AS value`,
        [assessmentId, seed.teams.map((teamIndex) => teamIds[teamIndex])]
      );
    }

    const today = (await client.query<{ today: string }>("SELECT current_date::text AS today")).rows[0]!.today;
    const nextMonday = nextIsoWeekday(today, 1);
    const nextWednesday = nextIsoWeekday(today, 3);
    const mondaySeries = await createSchedule(client, datasetId, {
      name: "Demo · Montags-Termin",
      startsOn: nextMonday,
      startTime: "09:00",
      endTime: "10:00",
      occurrenceCount: 6,
      roomId: roomIds[0],
      capacity: 12
    });
    const wednesdaySeries = await createSchedule(client, datasetId, {
      name: "Demo · Mittwochs-Termin",
      startsOn: nextWednesday,
      startTime: "11:00",
      endTime: "12:00",
      occurrenceCount: 6,
      roomId: roomIds[1],
      capacity: 6
    });

    const historyDate = previousIsoWeekday(today, 1);
    const historyTimeSlotId = await ensureTimeSlot(client, datasetId, historyDate, "09:00", "10:00");
    const historyAppointment = await client.query<{ id: string }>(
      `INSERT INTO appointments
         (time_slot_id, room_id, capacity, demo_dataset_id)
       VALUES ($1, $2, 12, $3)
       RETURNING id`,
      [historyTimeSlotId, roomIds[0], datasetId]
    );

    const plannedSeeds = [
      [0, mondaySeries.appointmentIds[0]!, assessmentIds[2]!, "Ich wiederhole vorher noch die Vokabeln."],
      [1, mondaySeries.appointmentIds[0]!, assessmentIds[1]!, "Schwerpunkt: Erzählperspektive"],
      [2, mondaySeries.appointmentIds[1]!, assessmentIds[0]!, null],
      [3, mondaySeries.appointmentIds[1]!, assessmentIds[1]!, "Bitte liniertes Papier bereitlegen."],
      [4, wednesdaySeries.appointmentIds[0]!, assessmentIds[2]!, null],
      [5, wednesdaySeries.appointmentIds[0]!, assessmentIds[3]!, "Thema Energieformen"],
      [6, wednesdaySeries.appointmentIds[1]!, assessmentIds[0]!, null],
      [7, wednesdaySeries.appointmentIds[1]!, assessmentIds[3]!, "Mit Formelsammlung" ]
    ] as const;
    for (const [studentIndex, appointmentId, assessmentId, comment] of plannedSeeds) {
      const timeSlot = await client.query<{ time_slot_id: string }>(
        "SELECT time_slot_id FROM appointments WHERE id = $1",
        [appointmentId]
      );
      await client.query(
        `INSERT INTO bookings
           (student_profile_id, appointment_id, time_slot_id, assessment_id,
            comment, status, demo_dataset_id)
         VALUES ($1, $2, $3, $4, $5, 'PLANNED', $6)`,
        [
          createdStudents[studentIndex]!.profileId,
          appointmentId,
          timeSlot.rows[0]!.time_slot_id,
          assessmentId,
          comment,
          datasetId
        ]
      );
    }

    const completedSeeds = [
      [0, assessmentIds[0]!, "Beispiel: bereits erfolgreich geschrieben"],
      [4, assessmentIds[3]!, "Beispiel: von der Lehrkraft als erledigt markiert"]
    ] as const;
    for (const [studentIndex, assessmentId, comment] of completedSeeds) {
      await client.query(
        `INSERT INTO bookings
           (student_profile_id, appointment_id, time_slot_id, assessment_id,
            comment, status, completed_at, demo_dataset_id)
         VALUES ($1, $2, $3, $4, $5, 'COMPLETED', now(), $6)`,
        [
          createdStudents[studentIndex]!.profileId,
          historyAppointment.rows[0]!.id,
          historyTimeSlotId,
          assessmentId,
          comment,
          datasetId
        ]
      );
    }

    await client.query("UPDATE teams SET active = true WHERE demo_dataset_id = $1", [datasetId]);
    await client.query("UPDATE demo_datasets SET ready = true WHERE id = $1", [datasetId]);
    await client.query(
      `INSERT INTO audit_log (actor_app_user_id, action, entity_type, entity_id, details)
       SELECT created_by_app_user_id, 'DEMO_DATA_CREATED', 'demo_dataset', id,
              $2::jsonb
         FROM demo_datasets
        WHERE id = $1`,
      [datasetId, JSON.stringify({ students: createdStudents.length, credentialsReturnedOnce: true })]
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  }
}

async function createDatasetUnlocked(
  client: PoolClient,
  actorAppUserId: string,
  replaceExisting: boolean
): Promise<CreateDemoDataResponse> {
  const existing = await currentDataset(client);
  if (existing && !replaceExisting) throw new DemoDataAlreadyExistsError();
  if (existing) await deleteCurrentDatasetUnlocked(client, actorAppUserId, "DEMO_DATA_RESET");

  let datasetId: string | null = null;
  try {
    await client.query("BEGIN");
    const dataset = await client.query<{ id: string }>(
      `INSERT INTO demo_datasets (created_by_app_user_id)
       VALUES ($1)
       RETURNING id`,
      [actorAppUserId]
    );
    datasetId = dataset.rows[0]!.id;
    const suffix = datasetId.slice(0, 6);
    const teamNames = [
      await uniqueNamedEntity(client, "teams", "Demo-Team 5A", suffix),
      await uniqueNamedEntity(client, "teams", "Demo-Team 6B", suffix)
    ] as const;
    const teams = await client.query<{ id: string; name: string }>(
      `INSERT INTO teams (name, active, demo_dataset_id)
       VALUES ($1, false, $3), ($2, false, $3)
       RETURNING id, name`,
      [teamNames[0], teamNames[1], datasetId]
    );
    const teamByName = new Map(teams.rows.map((team) => [team.name, team.id]));
    const teamIds = [teamByName.get(teamNames[0])!, teamByName.get(teamNames[1])!] as [string, string];
    await client.query("COMMIT");

    const students: DemoStudentSeed[] = [
      { displayName: "Demo Mia Muster", teamIndex: 0 },
      { displayName: "Demo Leon Beispiel", teamIndex: 0 },
      { displayName: "Demo Aylin Lern", teamIndex: 0 },
      { displayName: "Demo Noah Probe", teamIndex: 0 },
      { displayName: "Demo Emma Test", teamIndex: 1 },
      { displayName: "Demo Sam Beispiel", teamIndex: 1 },
      { displayName: "Demo Lina Schule", teamIndex: 1 },
      { displayName: "Demo Ben Versuch", teamIndex: 1 }
    ];
    const createdStudents: CreatedDemoStudent[] = [];
    const credentials: DemoCredential[] = [];
    for (const seed of students) {
      const initialPassword = createNumericInitialPassword();
      const created = await createStudentAccount({
        displayName: seed.displayName,
        teamId: teamIds[seed.teamIndex],
        actorAppUserId,
        password: initialPassword,
        demoDatasetId: datasetId
      });
      createdStudents.push({
        ...seed,
        profileId: created.student.id,
        loginId: created.student.loginId,
        initialPassword
      });
      credentials.push({
        displayName: seed.displayName,
        teamName: teamNames[seed.teamIndex],
        loginId: created.student.loginId,
        initialPassword
      });
    }

    await seedFinishedDemoData(client, datasetId, teamIds, createdStudents, suffix);
    const readyDataset = await currentDataset(client);
    return {
      status: await statusForDataset(client, readyDataset),
      credentials
    };
  } catch (error) {
    try {
      await client.query("ROLLBACK");
    } catch {
      // Der aufrufende Teilschritt kann bereits zurückgerollt haben.
    }
    if (datasetId) {
      try {
        await deleteCurrentDatasetUnlocked(client, actorAppUserId, "DEMO_DATA_RESET");
      } catch (cleanupError) {
        console.error("Unvollständige Demodaten konnten nicht automatisch bereinigt werden", cleanupError);
      }
    }
    throw error;
  }
}

export async function createDemoData(actorAppUserId: string): Promise<CreateDemoDataResponse> {
  return withDemoLock((client) => createDatasetUnlocked(client, actorAppUserId, false));
}

export async function resetDemoData(actorAppUserId: string): Promise<CreateDemoDataResponse> {
  return withDemoLock((client) => createDatasetUnlocked(client, actorAppUserId, true));
}

export async function deleteDemoData(actorAppUserId: string): Promise<DeleteDemoDataResponse> {
  return withDemoLock(async (client) => {
    const deleted = await deleteCurrentDatasetUnlocked(client, actorAppUserId, "DEMO_DATA_DELETED");
    return {
      deleted,
      status: await statusForDataset(client, await currentDataset(client))
    };
  });
}
