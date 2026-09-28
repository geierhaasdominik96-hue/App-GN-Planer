import express from "express";
import { app } from "./app.js";
import { createDatabaseBackup, startAutomaticBackups } from "./backup.js";
import { pool } from "./database.js";
import { env } from "./env.js";

const APP_ID = "gn-planer-app-planner-2";
const buildId = process.env.GN_PLANNER_BUILD_ID ?? "unmanaged";
const serverApp = express();

// Dieser Status wird nur vom Windows-Starter verwendet. Er verhindert, dass
// ein alter Build (oder ein fremdes Programm auf Port 3001) irrtuemlich als
// die gerade auszufuehrende Version behandelt wird.
serverApp.get("/api/launcher-status", (_request, response) => {
  response.setHeader("Cache-Control", "no-store");
  response.json({ appId: APP_ID, buildId, publicUrl: env.BETTER_AUTH_URL });
});
serverApp.use(app);

const server = serverApp.listen(env.PORT, env.HOST, () => {
  console.log(`GN-Planer API läuft unter ${env.BETTER_AUTH_URL}`);
});
const stopBackups = startAutomaticBackups();

async function shutdown(signal: string) {
  console.log(`${signal} empfangen, Server wird beendet.`);
  stopBackups();
  await createDatabaseBackup();
  server.close(async () => {
    await pool.end();
    process.exit(0);
  });
}

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
