import { describe, expect, it } from "vitest";
import {
  hasAnyRole,
  hasTeacherPermission,
  requiresInitialPasswordChange,
  type Principal
} from "./security.js";

function teacher(overrides: Partial<Principal> = {}): Principal {
  return {
    appUserId: "app-user",
    authUserId: "auth-user",
    loginId: "lehrkraft",
    displayName: "Lehrkraft",
    role: "TEACHER",
    teamId: null,
    canManageAccounts: false,
    canManageTeams: false,
    canManageAssessments: false,
    canManagePlanning: false,
    mustChangePassword: false,
    ...overrides
  };
}

describe("Rollenprüfung", () => {
  it("lässt Schüler nur durch explizite Schülerfreigaben", () => {
    expect(hasAnyRole("STUDENT", ["STUDENT"])).toBe(true);
    expect(hasAnyRole("STUDENT", ["TEACHER"])).toBe(false);
  });

  it("macht Lehrer nicht automatisch zu Schülern", () => {
    expect(hasAnyRole("TEACHER", ["TEACHER"])).toBe(true);
    expect(hasAnyRole("TEACHER", ["STUDENT"])).toBe(false);
  });
});

describe("verpflichtender Erstpasswortwechsel", () => {
  it("sperrt Schüler mit unverändertem Startpasswort", () => {
    expect(requiresInitialPasswordChange({ role: "STUDENT", mustChangePassword: true })).toBe(true);
  });

  it("gibt Schüler nach dem Wechsel und Lehrkräfte frei", () => {
    expect(requiresInitialPasswordChange({ role: "STUDENT", mustChangePassword: false })).toBe(false);
    expect(requiresInitialPasswordChange({ role: "TEACHER", mustChangePassword: true })).toBe(false);
  });
});

describe("granulare Lehrkraftrechte", () => {
  it("gibt Admins implizit alle Einzelrechte", () => {
    const admin = teacher({ canManageAccounts: true });
    expect(hasTeacherPermission(admin, "accounts")).toBe(true);
    expect(hasTeacherPermission(admin, "teams")).toBe(true);
    expect(hasTeacherPermission(admin, "assessments")).toBe(true);
    expect(hasTeacherPermission(admin, "planning")).toBe(true);
  });

  it("trennt Rechte normaler Lehrkräfte", () => {
    const coach = teacher({ canManageTeams: true, canManageAssessments: true });
    expect(hasTeacherPermission(coach, "accounts")).toBe(false);
    expect(hasTeacherPermission(coach, "teams")).toBe(true);
    expect(hasTeacherPermission(coach, "assessments")).toBe(true);
    expect(hasTeacherPermission(coach, "planning")).toBe(false);
  });
});
