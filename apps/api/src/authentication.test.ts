import type { NextFunction, Request, Response } from "express";
import { describe, expect, it, vi } from "vitest";
import { requireCompletedInitialPasswordChange } from "./middleware/authentication.js";
import type { Principal } from "./security.js";

function principal(overrides: Partial<Principal> = {}): Principal {
  return {
    appUserId: "app-user",
    authUserId: "auth-user",
    loginId: "testperson",
    displayName: "Testperson",
    role: "STUDENT",
    teamId: "team",
    canManageAccounts: false,
    canManageTeams: false,
    canManageAssessments: false,
    canManagePlanning: false,
    mustChangePassword: false,
    ...overrides
  };
}

function callMiddleware(testPrincipal: Principal) {
  const request = { principal: testPrincipal } as Request;
  const status = vi.fn();
  const json = vi.fn();
  const response = { status, json } as unknown as Response;
  status.mockReturnValue(response);
  const next = vi.fn() as NextFunction;
  requireCompletedInitialPasswordChange(request, response, next);
  return { status, json, next };
}

describe("Erstpasswort-Schutz der Schülerbereiche", () => {
  it("sperrt Schüler mit unverändertem Startpasswort serverseitig", () => {
    const result = callMiddleware(principal({ mustChangePassword: true }));
    expect(result.status).toHaveBeenCalledWith(403);
    expect(result.json).toHaveBeenCalledWith(expect.objectContaining({ error: "PASSWORD_CHANGE_REQUIRED" }));
    expect(result.next).not.toHaveBeenCalled();
  });

  it("lässt Schüler nach dem Passwortwechsel und Lehrkräfte passieren", () => {
    const student = callMiddleware(principal());
    const teacher = callMiddleware(principal({ role: "TEACHER", mustChangePassword: true }));
    expect(student.next).toHaveBeenCalledOnce();
    expect(teacher.next).toHaveBeenCalledOnce();
  });
});
