import { spawn } from "node:child_process";
import { createReadStream, createWriteStream, existsSync } from "node:fs";
import { copyFile, mkdir, readdir, rename, rm, stat } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { finished } from "node:stream/promises";
import path from "node:path";
import { env } from "./env.js";

const projectRoot = fileURLToPath(new URL("../../../", import.meta.url));
const defaultBackupDirectory = process.platform === "win32" && process.env.LOCALAPPDATA
  ? path.join(process.env.LOCALAPPDATA, "GN-Planer", "Sicherungen")
  : path.join(projectRoot, "data", "Sicherungen");
let backupDirectory = path.resolve(env.BACKUP_DIRECTORY || defaultBackupDirectory);
const composeFile = path.join(projectRoot, "docker-compose.yml");
const serverEnvironmentFile = path.join(projectRoot, ".env.server");
let runningBackup: Promise<void> | null = null;
const backupStatus: {
  lastSuccessAt: string | null;
  lastFilename: string | null;
  lastError: string | null;
} = { lastSuccessAt: null, lastFilename: null, lastError: null };

function dockerExecutable() {
  const localAppData = process.env.LOCALAPPDATA;
  if (process.platform === "win32" && localAppData) {
    const bundled = path.join(localAppData, "Programs", "DockerDesktop", "resources", "bin", "docker.exe");
    if (existsSync(bundled)) return bundled;
  }
  return "docker";
}

function directDatabaseEnvironment() {
  const databaseUrl = new URL(env.DATABASE_URL);
  return {
    databaseUrl,
    processEnvironment: {
      ...process.env,
      PGPASSWORD: decodeURIComponent(databaseUrl.password)
    }
  };
}

function spawnDatabaseTool(tool: "pg_dump" | "pg_restore") {
  if (!env.containerized) {
    const composeEnvironmentArguments = existsSync(serverEnvironmentFile)
      ? ["--env-file", serverEnvironmentFile]
      : [];
    const command = tool === "pg_dump"
      ? ["compose", ...composeEnvironmentArguments, "-f", composeFile, "exec", "-T", "postgres", "pg_dump", "-U", "gn_planer", "-d", "gn_planer", "--format=custom"]
      : ["compose", ...composeEnvironmentArguments, "-f", composeFile, "exec", "-T", "postgres", "pg_restore", "--list"];
    return spawn(dockerExecutable(), command, {
      windowsHide: true,
      stdio: ["pipe", "pipe", "pipe"]
    });
  }

  const { databaseUrl, processEnvironment } = directDatabaseEnvironment();
  const connectionArguments = [
    "--host", databaseUrl.hostname,
    "--port", databaseUrl.port || "5432",
    "--username", decodeURIComponent(databaseUrl.username),
    "--dbname", decodeURIComponent(databaseUrl.pathname.replace(/^\/+/, ""))
  ];
  return spawn(tool, tool === "pg_dump" ? [...connectionArguments, "--format=custom"] : ["--list"], {
    env: processEnvironment,
    windowsHide: true,
    stdio: ["pipe", "pipe", "pipe"]
  });
}

function stamp(date = new Date()) {
  return date.toISOString().replaceAll(":", "-").replace("T", "_").slice(0, 19);
}

async function removeOldBackups(retain = 30) {
  const names = (await readdir(backupDirectory)).filter((name) => /^gn-planer_.*\.dump$/.test(name));
  const entries = await Promise.all(names.map(async (name) => ({ name, modified: (await stat(path.join(backupDirectory, name))).mtimeMs })));
  entries.sort((a, b) => b.modified - a.modified);
  await Promise.all(entries.slice(retain).map((entry) => rm(path.join(backupDirectory, entry.name), { force: true })));
}

async function verifyDatabaseBackup(dumpPath: string) {
  const child = spawnDatabaseTool("pg_restore");
  let stderr = "";
  child.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString(); });
  createReadStream(dumpPath).pipe(child.stdin);
  const exitCode = await new Promise<number>((resolve, reject) => {
    child.once("error", reject);
    child.once("close", (code) => resolve(code ?? 1));
  });
  if (exitCode !== 0) throw new Error(stderr.trim() || "Die Sicherungsdatei konnte nicht gelesen werden.");
}

async function mirrorBackup(sourcePath: string) {
  if (!env.BACKUP_MIRROR_DIRECTORY) return;
  const mirrorDirectory = path.resolve(env.BACKUP_MIRROR_DIRECTORY);
  await mkdir(mirrorDirectory, { recursive: true });
  const finalPath = path.join(mirrorDirectory, path.basename(sourcePath));
  const temporaryPath = `${finalPath}.tmp-${process.pid}-${Date.now()}`;
  try {
    await copyFile(sourcePath, temporaryPath);
    await rename(temporaryPath, finalPath);
  } catch (error) {
    await rm(temporaryPath, { force: true }).catch(() => undefined);
    throw error;
  }
}

async function performDatabaseBackup() {
  let temporaryPath = "";
  try {
    try {
      await mkdir(backupDirectory, { recursive: true });
    } catch (error) {
      if (env.BACKUP_DIRECTORY) throw error;
      backupDirectory = path.join(projectRoot, "data", "Sicherungen");
      await mkdir(backupDirectory, { recursive: true });
      console.warn("Der externe Sicherungsordner war nicht verfügbar; es wird vorübergehend der Projektordner verwendet.");
    }
    const finalPath = path.join(backupDirectory, `gn-planer_${stamp()}.dump`);
    temporaryPath = `${finalPath}.tmp`;
    const output = createWriteStream(temporaryPath, { flags: "wx" });
    const outputFinished = finished(output);
    const child = spawnDatabaseTool("pg_dump");
    let stderr = "";
    child.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString(); });
    child.stdout.pipe(output);
    const childFinished = new Promise<number>((resolve, reject) => {
      child.once("error", (error) => {
        output.destroy(error);
        reject(error);
      });
      child.once("close", (code) => resolve(code ?? 1));
    });
    const [exitCode] = await Promise.all([childFinished, outputFinished]);
    if (exitCode !== 0) throw new Error(stderr.trim() || `pg_dump endete mit Code ${exitCode}.`);
    await verifyDatabaseBackup(temporaryPath);
    await rename(temporaryPath, finalPath);
    await mirrorBackup(finalPath).catch((error) => {
      console.warn("Die lokale Sicherung ist gültig, konnte aber nicht zum zweiten Sicherungsziel kopiert werden:", error instanceof Error ? error.message : error);
    });
    await removeOldBackups();
    backupStatus.lastSuccessAt = new Date().toISOString();
    backupStatus.lastFilename = path.basename(finalPath);
    backupStatus.lastError = null;
    console.log(`Datenbanksicherung erstellt: ${path.basename(finalPath)}`);
  } catch (error) {
    if (temporaryPath) await rm(temporaryPath, { force: true }).catch(() => undefined);
    backupStatus.lastError = error instanceof Error ? error.message : String(error);
    console.warn("Datenbanksicherung konnte nicht erstellt werden:", backupStatus.lastError);
  }
}

export function createDatabaseBackup(): Promise<void> {
  if (runningBackup) return runningBackup;
  runningBackup = performDatabaseBackup().finally(() => {
    runningBackup = null;
  });
  return runningBackup;
}

export function getDatabaseBackupStatus() {
  return {
    ...backupStatus,
    directory: backupDirectory,
    mirrorConfigured: Boolean(env.BACKUP_MIRROR_DIRECTORY)
  };
}

export function startAutomaticBackups() {
  const interval = setInterval(() => void createDatabaseBackup(), 10 * 60 * 1000);
  interval.unref();
  const initial = setTimeout(() => void createDatabaseBackup(), 5_000);
  initial.unref();
  return () => { clearInterval(interval); clearTimeout(initial); };
}
