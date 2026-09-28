import type { MeResponse } from "@gn-planer/contracts";
import { Router } from "express";

export const meRouter = Router();

meRouter.get("/", (request, response) => {
  const principal = request.principal!;
  const payload: MeResponse = {
    profile: {
      id: principal.appUserId,
      authUserId: principal.authUserId,
      loginId: principal.loginId,
      displayName: principal.displayName,
      role: principal.role,
      teamId: principal.teamId,
      canManageAccounts: principal.canManageAccounts,
      canManageTeams: principal.canManageTeams,
      canManageAssessments: principal.canManageAssessments,
      canManagePlanning: principal.canManagePlanning,
      mustChangePassword: principal.mustChangePassword
    }
  };
  response.json(payload);
});
