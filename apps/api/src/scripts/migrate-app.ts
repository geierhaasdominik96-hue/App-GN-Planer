import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { pool } from "../database.js";

const migrationDirectory = fileURLToPath(new URL("../../migrations/", import.meta.url));

async function migrate() {
  const client = await pool.connect();
  try {
    await client.query(`
      CREATE TABLE IF NOT EXISTS app_migrations (
        name text PRIMARY KEY,
        checksum text NOT NULL,
        applied_at timestamptz NOT NULL DEFAULT now()
      )
    `);

    const files = (await readdir(migrationDirectory))
      .filter((file) => file.endsWith(".sql"))
      .sort();

    for (const file of files) {
      const sql = await readFile(new URL(`../../migrations/${file}`, import.meta.url), "utf8");
      const checksum = createHash("sha256").update(sql).digest("hex");
      await client.query("BEGIN");
      try {
        await client.query("SELECT pg_advisory_xact_lock(hashtext('gn-planer-migrations'))");
        const existing = await client.query<{ checksum: string }>(
          "SELECT checksum FROM app_migrations WHERE name = $1",
          [file]
        );

        if (existing.rows[0]) {
          if (existing.rows[0].checksum !== checksum) {
            throw new Error(`Migration ${file} wurde nachträglich verändert.`);
          }
          await client.query("COMMIT");
          console.log(`Bereits angewendet: ${file}`);
          continue;
        }

        await client.query(sql);
        await client.query(
          "INSERT INTO app_migrations (name, checksum) VALUES ($1, $2)",
          [file, checksum]
        );
        await client.query("COMMIT");
        console.log(`Angewendet: ${file}`);
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      }
    }
  } finally {
    client.release();
    await pool.end();
  }
}

await migrate();
