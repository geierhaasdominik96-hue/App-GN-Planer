import { pool } from "./database.js";

export async function endWeeklySchedule(scheduleId: string, actorAppUserId: string) {
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const schedule = await client.query(
      "UPDATE weekly_schedules SET active = false WHERE id = $1 AND active = true RETURNING id",
      [scheduleId]
    );
    if (!schedule.rowCount) {
      await client.query("ROLLBACK");
      return null;
    }

    const cancelled = await client.query(
      `UPDATE appointments
          SET status = 'CANCELLED', version = version + 1
        WHERE schedule_id = $1 AND status = 'OPEN'
        RETURNING id`,
      [scheduleId]
    );
    await client.query(
      `INSERT INTO audit_log (actor_app_user_id, action, entity_type, entity_id, details)
       VALUES ($1, 'WEEKLY_SCHEDULE_ENDED', 'weekly_schedule', $2, $3::jsonb)`,
      [actorAppUserId, scheduleId, JSON.stringify({ cancelledOccurrences: cancelled.rowCount ?? 0 })]
    );
    await client.query("COMMIT");
    return cancelled.rowCount ?? 0;
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
