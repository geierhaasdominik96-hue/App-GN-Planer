import request from "supertest";
import { describe, expect, it } from "vitest";
import { app } from "./app.js";

describe("HTTP-Pilotbetrieb", () => {
  it("erzwingt für lokale HTTP-Dateien kein nicht vorhandenes HTTPS", async () => {
    // Die CSP gilt bereits fuer die normale 404-Antwort. So bleibt dieser
    // reine Header-Test unabhaengig von einer laufenden PostgreSQL-Instanz;
    // /api/health prueft im echten Betrieb absichtlich auch die Datenbank.
    const response = await request(app).get("/api/does-not-exist");
    expect(response.status).toBe(404);
    expect(response.headers["content-security-policy"]).not.toContain("upgrade-insecure-requests");
  });
});
