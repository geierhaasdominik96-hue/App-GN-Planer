import type { PublicInvitationResponse, RedeemInvitationResponse } from "@gn-planer/contracts";
import { Router } from "express";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import { createStudentAccount } from "../account-provisioning.js";
import { pool } from "../database.js";
import { hashInvitationToken } from "../invitation-tokens.js";

interface InvitationRow {
  id: string;
  team_id: string;
  team_name: string;
  created_by_app_user_id: string;
  expires_at: string;
  remaining_uses: number;
}

const tokenSchema = z.string().regex(/^[A-Za-z0-9_-]{43}$/);
const registrationSchema = z
  .object({
    displayName: z.string().trim().min(2).max(120),
    password: z.string().min(10).max(128),
    confirmPassword: z.string().min(1)
  })
  .refine((value) => value.password === value.confirmPassword, {
    message: "Die Passwörter stimmen nicht überein.",
    path: ["confirmPassword"]
  });

async function findInvitation(token: string) {
  const result = await pool.query<InvitationRow>(
    `SELECT
       ti.id,
       ti.team_id,
       t.name AS team_name,
       ti.created_by_app_user_id,
       ti.expires_at,
       (ti.max_uses - ti.use_count)::int AS remaining_uses
     FROM team_invitations ti
     JOIN teams t ON t.id = ti.team_id
     WHERE ti.token_hash = $1
       AND ti.active = true
       AND ti.expires_at > now()
       AND ti.use_count < ti.max_uses
       AND t.active = true`,
    [hashInvitationToken(token)]
  );
  return result.rows[0] ?? null;
}

export const invitationRouter = Router();

invitationRouter.use(
  rateLimit({
    windowMs: 10 * 60_000,
    limit: 30,
    standardHeaders: "draft-8",
    legacyHeaders: false
  })
);

invitationRouter.get("/:token", async (request, response, next) => {
  const parsedToken = tokenSchema.safeParse(request.params.token);
  if (!parsedToken.success) {
    response.status(404).json({ error: "INVITATION_NOT_FOUND", message: "Einladung nicht gefunden." });
    return;
  }

  try {
    const invitation = await findInvitation(parsedToken.data);
    if (!invitation) {
      response.status(410).json({
        error: "INVITATION_EXPIRED",
        message: "Diese Einladung ist abgelaufen oder wurde deaktiviert."
      });
      return;
    }
    const payload: PublicInvitationResponse = {
      teamName: invitation.team_name,
      expiresAt: invitation.expires_at,
      remainingUses: invitation.remaining_uses
    };
    response.json(payload);
  } catch (error) {
    next(error);
  }
});

invitationRouter.post("/:token/redeem", async (request, response, next) => {
  const parsedToken = tokenSchema.safeParse(request.params.token);
  const parsedBody = registrationSchema.safeParse(request.body);
  if (!parsedToken.success || !parsedBody.success) {
    response.status(400).json({
      error: "INVALID_REGISTRATION",
      message: parsedBody.error?.issues[0]?.message ?? "Einladung ist ungültig."
    });
    return;
  }

  try {
    const invitation = await findInvitation(parsedToken.data);
    if (!invitation) {
      response.status(410).json({
        error: "INVITATION_EXPIRED",
        message: "Diese Einladung ist abgelaufen oder wurde bereits vollständig verwendet."
      });
      return;
    }

    const created = await createStudentAccount({
      displayName: parsedBody.data.displayName,
      teamId: invitation.team_id,
      actorAppUserId: invitation.created_by_app_user_id,
      password: parsedBody.data.password,
      invitationId: invitation.id
    });
    const payload: RedeemInvitationResponse = {
      displayName: created.student.displayName,
      loginId: created.student.loginId,
      teamName: invitation.team_name
    };
    response.status(201).json(payload);
  } catch (error) {
    if (error instanceof Error && error.name === "INVITATION_UNAVAILABLE") {
      response.status(410).json({ error: "INVITATION_EXPIRED", message: error.message });
      return;
    }
    next(error);
  }
});
