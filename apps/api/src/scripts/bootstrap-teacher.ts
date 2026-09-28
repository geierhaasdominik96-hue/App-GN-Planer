import { provisioningAuth } from "../auth.js";
import { pool } from "../database.js";

const loginId = process.env.BOOTSTRAP_TEACHER_ID?.trim();
const displayName = process.env.BOOTSTRAP_TEACHER_NAME?.trim();
const password = process.env.BOOTSTRAP_TEACHER_PASSWORD;

if (!loginId || !displayName || !password) {
  throw new Error(
    "BOOTSTRAP_TEACHER_ID, BOOTSTRAP_TEACHER_NAME und BOOTSTRAP_TEACHER_PASSWORD müssen gesetzt sein."
  );
}

if (password.length < 12) {
  throw new Error("Das Startpasswort der Lehrkraft muss mindestens 12 Zeichen lang sein.");
}

const existingTeachers = await pool.query<{ count: number }>(
  "SELECT count(*)::int AS count FROM teacher_profiles"
);
if (existingTeachers.rows[0]!.count > 0) {
  throw new Error("Es existiert bereits ein Lehrkraftprofil. Der Bootstrap wurde abgebrochen.");
}

const normalizedId = loginId.toLowerCase();
const internalEmail = `${normalizedId}@accounts.gn-planer.invalid`;
const created = await provisioningAuth.api.signUpEmail({
  body: {
    name: displayName,
    email: internalEmail,
    password,
    username: normalizedId,
    displayUsername: loginId
  }
});

const client = await pool.connect();
try {
  await client.query("BEGIN");
  await client.query("SELECT pg_advisory_xact_lock(hashtext('gn-planer-admin-accounts'))");
  const teachersAfterLock = await client.query<{ count: number }>(
    "SELECT count(*)::int AS count FROM teacher_profiles"
  );
  if (teachersAfterLock.rows[0]!.count > 0) {
    throw new Error("Es existiert bereits ein Lehrkraftprofil. Der Bootstrap wurde abgebrochen.");
  }
  const appUser = await client.query<{ id: string }>(
    `INSERT INTO app_users (auth_user_id, display_name, role)
     VALUES ($1, $2, 'TEACHER')
     RETURNING id`,
    [created.user.id, displayName]
  );
  await client.query(
    `INSERT INTO teacher_profiles
       (app_user_id, can_manage_accounts, can_manage_teams,
        can_manage_assessments, can_manage_planning)
     VALUES ($1, true, true, true, true)`,
    [appUser.rows[0]!.id]
  );
  await client.query("COMMIT");
  console.log(`Master-Lehrkraft '${loginId}' wurde angelegt.`);
  console.log("BOOTSTRAP_TEACHER_PASSWORD jetzt wieder aus der .env-Datei entfernen.");
} catch (error) {
  await client.query("ROLLBACK");
  await pool.query('DELETE FROM "user" WHERE id = $1', [created.user.id]);
  throw error;
} finally {
  client.release();
  await pool.end();
}
