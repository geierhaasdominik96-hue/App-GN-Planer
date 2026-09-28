import type { AppRole } from "@gn-planer/contracts";

export interface Principal {
  appUserId: string;
  authUserId: string;
  loginId: string;
  displayName: string;
  role: AppRole;
  teamId: string | null;
  canManageAccounts: boolean;
  canManageTeams: boolean;
  canManageAssessments: boolean;
  canManagePlanning: boolean;
  mustChangePassword: boolean;
}

export type TeacherPermission =
  | "accounts"
  | "teams"
  | "assessments"
  | "planning";

/**
 * Das Kontoverwaltungsrecht kennzeichnet ein Administratorkonto und umfasst
 * stets alle Einzelrechte. So bleibt die Sicherheitsregel auch dann korrekt,
 * wenn ein alter Datensatz die neuen Spalten noch nicht explizit gesetzt hat.
 */
export function hasTeacherPermission(
  principal: Principal,
  permission: TeacherPermission
) {
  if (principal.role !== "TEACHER") return false;
  if (principal.canManageAccounts) return true;
  switch (permission) {
    case "accounts": return false;
    case "teams": return principal.canManageTeams;
    case "assessments": return principal.canManageAssessments;
    case "planning": return principal.canManagePlanning;
  }
}

export function hasAnyRole(role: AppRole, allowedRoles: readonly AppRole[]) {
  return allowedRoles.includes(role);
}

export function requiresInitialPasswordChange(
  principal: Pick<Principal, "role" | "mustChangePassword">
) {
  return principal.role === "STUDENT" && principal.mustChangePassword;
}
