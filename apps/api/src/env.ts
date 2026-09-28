import "dotenv/config";
import { z } from "zod";

const schema = z.object({
  NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
  PORT: z.coerce.number().int().positive().default(3001),
  HOST: z.string().default("0.0.0.0"),
  DATABASE_URL: z.string().min(1),
  BETTER_AUTH_SECRET: z.string().min(32),
  BETTER_AUTH_URL: z.string().url(),
  WEB_ORIGINS: z.string().default("http://localhost:5173"),
  TRUST_PROXY: z.enum(["true", "false"]).default("false"),
  CONTAINERIZED: z.enum(["true", "false"]).default("false"),
  BACKUP_DIRECTORY: z.string().trim().optional(),
  BACKUP_MIRROR_DIRECTORY: z.string().trim().optional()
});

const parsed = schema.safeParse(process.env);

if (!parsed.success) {
  console.error("Ungültige Server-Konfiguration", parsed.error.flatten().fieldErrors);
  throw new Error("Server-Konfiguration ist unvollständig.");
}

export const env = {
  ...parsed.data,
  trustProxy: parsed.data.TRUST_PROXY === "true",
  containerized: parsed.data.CONTAINERIZED === "true",
  webOrigins: parsed.data.WEB_ORIGINS.split(",").map((origin) => origin.trim())
};
