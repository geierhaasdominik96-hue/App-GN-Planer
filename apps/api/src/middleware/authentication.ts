import type { AppRole } from "@gn-planer/contracts";
import { fromNodeHeaders } from "better-auth/node";
import type { NextFunction, Request, Response } from "express";
import { auth } from "../auth.js";
import { pool } from "../database.js";
import {
  hasAnyRole,
  requiresInitialPasswordChange,
  type Principal
} from "../security.js";

interface PrincipalRow {
  app_user_id: string;
  auth_user_id: string;
  login_id: string;
  display_name: string;
  role: AppRole;
  team_id: string | null;
  can_manage_accounts: boolean | null;
  can_manage_teams: boolean | null;
  can_manage_assessments: boolean | null;
  can_manage_planning: boolean | null;
  must_change_password: boolean | null;
}

export async function requireAuthentication(
  request: Request,
  response: Response,
  next: NextFunction
) {
  try {
    const session = await auth.api.getSession({
      headers: fromNodeHeaders(request.headers)
    });

    if (!session) {
      response.status(401).json({ error: "UNAUTHENTICATED", message: "Bitte anmelden." });
      return;
    }

    const result = await pool.query<PrincipalRow>(
      `SELECT
         au.id AS app_user_id,
         au.auth_user_id,
         u.username AS login_id,
         au.display_name,
         au.role,
         sp.team_id,
         tp.can_manage_accounts,
         tp.can_manage_teams,
         tp.can_manage_assessments,
         tp.can_manage_planning,
         sp.must_change_password
       FROM app_users au
       JOIN "user" u ON u.id = au.auth_user_id
       LEFT JOIN student_profiles sp ON sp.app_user_id = au.id
       LEFT JOIN teacher_profiles tp ON tp.app_user_id = au.id
       WHERE au.auth_user_id = $1 AND au.active = true`,
      [session.user.id]
    );

    const row = result.rows[0];
    if (!row) {
      response.status(403).json({
        error: "PROFILE_MISSING",
        message: "Für dieses Konto ist noch kein aktives Schulprofil eingerichtet."
      });
      return;
    }

    const principal: Principal = {
      appUserId: row.app_user_id,
      authUserId: row.auth_user_id,
      loginId: row.login_id,
      displayName: row.display_name,
      role: row.role,
      teamId: row.team_id,
      canManageAccounts: row.can_manage_accounts ?? false,
      canManageTeams: row.can_manage_teams ?? false,
      canManageAssessments: row.can_manage_assessments ?? false,
      canManagePlanning: row.can_manage_planning ?? false,
      mustChangePassword: row.must_change_password ?? false
    };

    request.principal = principal;
    next();
  } catch (error) {
    next(error);
  }
}

export function requireRole(...allowedRoles: AppRole[]) {
  return (request: Request, response: Response, next: NextFunction) => {
    const principal = request.principal;
    if (!principal) {
      response.status(401).json({ error: "UNAUTHENTICATED", message: "Bitte anmelden." });
      return;
    }

    if (!hasAnyRole(principal.role, allowedRoles)) {
      response.status(403).json({
        error: "FORBIDDEN",
        message: "Für diesen Bereich fehlt die Berechtigung."
      });
      return;
    }

    next();
  };
}

export function requireCompletedInitialPasswordChange(
  request: Request,
  response: Response,
  next: NextFunction
) {
  const principal = request.principal;
  if (!principal) {
    response.status(401).json({ error: "UNAUTHENTICATED", message: "Bitte anmelden." });
    return;
  }

  if (requiresInitialPasswordChange(principal)) {
    response.status(403).json({
      error: "PASSWORD_CHANGE_REQUIRED",
      message: "Bitte ändere zuerst dein Startpasswort in den Einstellungen."
    });
    return;
  }

  next();
}
