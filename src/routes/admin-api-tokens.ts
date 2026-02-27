import { randomUUID } from "node:crypto";
import { Router } from "express";
import jwt from "jsonwebtoken";
import { z } from "zod";
import { pool } from "../db/client.js";
import { requireAuth } from "../middleware/auth.js";
import { writeAdminAudit } from "../services/admin-audit.js";
import { signAccessToken } from "../services/token-service.js";

const CreateAdminApiTokenSchema = z.object({
  label: z.string().trim().min(3).max(100),
  role: z.enum(["admin", "super_admin"]).default("admin"),
});

function tokenPreview(token: string) {
  const payload = jwt.decode(token);
  if (!payload || typeof payload !== "object") return null;
  const claims = payload as Record<string, unknown>;
  const iat = typeof claims.iat === "number" ? new Date(claims.iat * 1000).toISOString() : null;
  const exp = typeof claims.exp === "number" ? new Date(claims.exp * 1000).toISOString() : null;
  return {
    iat,
    exp,
    claims,
  };
}

export const adminApiTokenRouter = Router();

adminApiTokenRouter.use(requireAuth("admin"));

adminApiTokenRouter.post("/api-tokens/admin", async (req, res) => {
  const parsed = CreateAdminApiTokenSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: { code: "VALIDATION_ERROR", details: parsed.error.flatten() } });
  }

  const input = parsed.data;
  if (input.role === "super_admin" && req.auth!.role !== "super_admin") {
    return res.status(403).json({
      error: { code: "FORBIDDEN", message: "Only super_admin can create super_admin API tokens." },
    });
  }

  const sessionId = `api_${randomUUID()}`;
  const token = signAccessToken(
    {
      sub: req.auth!.userId,
      sessionId,
      realm: "admin",
      role: input.role,
    },
    { expiresInMinutes: null }
  );

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await writeAdminAudit(client, {
      actorAdminId: req.auth!.userId,
      action: "admin_api_token_created",
      entityType: "admin_api_tokens",
      entityId: sessionId,
      after: {
        label: input.label,
        role: input.role,
        expiresAt: null,
      },
    });
    await client.query("COMMIT");
  } catch {
    await client.query("ROLLBACK");
    return res.status(500).json({ error: { code: "INTERNAL_ERROR", message: "API token could not be created" } });
  } finally {
    client.release();
  }

  return res.status(201).json({
    data: {
      label: input.label,
      role: input.role,
      token,
      createdAt: new Date().toISOString(),
      preview: tokenPreview(token),
    },
  });
});
