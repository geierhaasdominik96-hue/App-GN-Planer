import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const migration = readFileSync(
  new URL("../migrations/005_demo_data.sql", import.meta.url),
  "utf8"
);

describe("Demo-Daten-Migration", () => {
  it("erlaubt hoechstens einen Demo-Datensatz", () => {
    expect(migration).toMatch(
      /CREATE UNIQUE INDEX demo_datasets_singleton\s+ON demo_datasets \(\(true\)\)/i
    );
  });

  it("markiert alle loeschbaren Demo-Entitaeten mit restriktiven Fremdschluesseln", () => {
    const tables = [
      "app_users",
      "teams",
      "rooms",
      "assessment_definitions",
      "weekly_schedules",
      "time_slots",
      "appointments",
      "bookings",
      "team_invitations",
      "audit_log"
    ];

    for (const table of tables) {
      expect(migration, `fehlende sichere Demo-Markierung fuer ${table}`).toMatch(
        new RegExp(
          `ALTER TABLE ${table}\\s+ADD COLUMN demo_dataset_id uuid REFERENCES demo_datasets\\(id\\) ON DELETE RESTRICT`,
          "i"
        )
      );
    }

    expect(migration).not.toMatch(
      /demo_dataset_id uuid REFERENCES demo_datasets\(id\) ON DELETE CASCADE/i
    );
  });

  it("ordnet nur Buchungen eines markierten Demo-Schuelers automatisch zu", () => {
    expect(migration).toMatch(
      /FROM student_profiles sp\s+JOIN app_users au ON au\.id = sp\.app_user_id\s+WHERE sp\.id = NEW\.student_profile_id/is
    );
    expect(migration).toMatch(
      /IF student_demo_dataset_id IS NOT NULL THEN[\s\S]*NEW\.demo_dataset_id := student_demo_dataset_id/is
    );
  });

  it("ordnet neue Einladungen eines Demo-Teams dem Demo-Datensatz zu", () => {
    expect(migration).toMatch(
      /SELECT demo_dataset_id\s+INTO NEW\.demo_dataset_id\s+FROM teams\s+WHERE id = NEW\.team_id/is
    );
  });
});
