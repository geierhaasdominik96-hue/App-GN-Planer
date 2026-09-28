import type { ChangePasswordResponse } from "@gn-planer/contracts";
import { fromNodeHeaders } from "better-auth/node";
import { Router } from "express";
import { z } from "zod";
import { auth } from "../auth.js";
import { pool } from "../database.js";

const passwordSchema = z
  .object({
    currentPassword: z.string().min(1),
    newPassword: z.string().min(10).max(128),
    confirmPassword: z.string().min(1)
  })
  .refine((value) => value.newPassword === value.confirmPassword, {
    message: "Die neuen Passwörter stimmen nicht überein.",
    path: ["confirmPassword"]
  })
  .refine((value) => value.currentPassword !== value.newPassword, {
    message: "Das neue Passwort muss sich vom bisherigen unterscheiden.",
    path: ["newPassword"]
  });

export const accountRouter = Router();

accountRouter.post("/change-password", async (request, response, next) => {
  const parsed = passwordSchema.safeParse(request.body);
  if (!parsed.success) {
    response.status(400).json({
      error: "INVALID_PASSWORD",
      message: parsed.error.issues[0]?.message ?? "Passwort ist ungültig."
    });
    return;
  }

  try {
    await auth.api.changePassword({
      body: {
        currentPassword: parsed.data.currentPassword,
        newPassword: parsed.data.newPassword,
        revokeOtherSessions: true
      },
      headers: fromNodeHeaders(request.headers)
    });

    await pool.query(
      `UPDATE student_profiles
          SET must_change_password = false
        WHERE app_user_id = $1`,
      [request.principal!.appUserId]
    );
    await pool.query(
      `INSERT INTO audit_log (actor_app_user_id, action, entity_type, entity_id)
       VALUES ($1, 'PASSWORD_CHANGED', 'app_user', $1::text)`,
      [request.principal!.appUserId]
    );

    const payload: ChangePasswordResponse = { changed: true };
    response.json(payload);
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (/password|credential|invalid/i.test(message)) {
      response.status(400).json({
        error: "PASSWORD_CHANGE_FAILED",
        message: "Das bisherige Passwort ist nicht korrekt."
      });
      return;
    }
    next(error);
  }
});
