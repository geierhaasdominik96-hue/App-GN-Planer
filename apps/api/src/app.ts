import cors from "cors";
import express, { type ErrorRequestHandler } from "express";
import { fileURLToPath } from "node:url";
import rateLimit from "express-rate-limit";
import helmet from "helmet";
import { toNodeHandler } from "better-auth/node";
import { auth } from "./auth.js";
import { pool } from "./database.js";
import { env } from "./env.js";
import {
  requireAuthentication,
  requireCompletedInitialPasswordChange,
  requireRole
} from "./middleware/authentication.js";
import { accountRouter } from "./routes/account.js";
import { coachRouter } from "./routes/coach.js";
import { demoDataRouter } from "./routes/demo-data.js";
import { invitationRouter } from "./routes/invitations.js";
import { meRouter } from "./routes/me.js";
import { planningRouter } from "./routes/planning.js";
import { studentRouter } from "./routes/student.js";
import { teacherRouter } from "./routes/teacher.js";

export const app = express();
const webDistribution = fileURLToPath(new URL("../../web/dist/", import.meta.url));
const usesHttps = new URL(env.BETTER_AUTH_URL).protocol === "https:";

app.disable("x-powered-by");
if (env.trustProxy) app.set("trust proxy", 1);
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      // Im lokalen HTTP-Pilotbetrieb würde diese Direktive auch unsere eigenen
      // JS-/CSS-Dateien auf HTTPS umschreiben und dadurch eine weiße Seite erzeugen.
      // Sobald der Planer regulär über HTTPS läuft, bleibt der Schutz aktiv.
      "upgrade-insecure-requests": usesHttps ? [] : null
    }
  }
}));
app.use(
  cors({
    origin(origin, callback) {
      if (!origin || env.webOrigins.includes(origin)) {
        callback(null, true);
        return;
      }
      callback(new Error("Origin ist nicht freigegeben."));
    },
    credentials: true,
    methods: ["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"]
  })
);

// Der Wert wird immer serverseitig überschrieben und kann daher nicht von
// Clients zur Umgehung des Login-Limits gefälscht werden.
app.use("/api/auth", (request, _response, next) => {
  // request.ip verwendet bei TRUST_PROXY=true die von Express validierte
  // Clientadresse; ohne Proxy faellt es auf die direkte Socket-Adresse zurueck.
  request.headers["x-gn-planer-client-ip"] = request.ip ?? request.socket.remoteAddress ?? "unknown";
  next();
});

// Better Auth muss vor express.json() eingebunden werden.
app.all("/api/auth/*splat", toNodeHandler(auth));

app.use(express.json({ limit: "64kb" }));
app.use(
  "/api",
  rateLimit({
    windowMs: 60_000,
    limit: 180,
    standardHeaders: "draft-8",
    legacyHeaders: false
  })
);

app.get("/api/health", async (_request, response) => {
  try {
    await pool.query("SELECT 1");
    response.json({ status: "ok" });
  } catch (error) {
    console.error("Healthcheck: PostgreSQL ist nicht erreichbar", error);
    response.status(503).json({ status: "unavailable" });
  }
});

app.use("/api/invitations", invitationRouter);
app.use("/api/me", requireAuthentication, meRouter);
app.use("/api/account", requireAuthentication, accountRouter);
app.use(
  "/api/student",
  requireAuthentication,
  requireCompletedInitialPasswordChange,
  requireRole("STUDENT"),
  studentRouter
);
app.use("/api/teacher/coach", requireAuthentication, requireRole("TEACHER"), coachRouter);
app.use("/api/teacher/planning", requireAuthentication, requireRole("TEACHER"), planningRouter);
app.use("/api/teacher/demo-data", requireAuthentication, requireRole("TEACHER"), demoDataRouter);
app.use("/api/teacher", requireAuthentication, requireRole("TEACHER"), teacherRouter);

app.use("/api", (_request, response) => {
  response.status(404).json({ error: "NOT_FOUND", message: "Route nicht gefunden." });
});

if (env.NODE_ENV === "production") {
  app.use(express.static(webDistribution, { index: false, maxAge: "1h" }));
  app.get("/{*splat}", (_request, response) => response.sendFile("index.html", { root: webDistribution }));
} else {
  app.use((_request, response) => {
    response.status(404).json({ error: "NOT_FOUND", message: "Route nicht gefunden." });
  });
}

const errorHandler: ErrorRequestHandler = (error, _request, response, _next) => {
  console.error(error);
  response.status(500).json({
    error: "INTERNAL_ERROR",
    message: "Die Anfrage konnte nicht verarbeitet werden."
  });
};

app.use(errorHandler);
