import { Router } from "express";
import { z } from "zod";
import { pool } from "../db/client.js";
import { requireAuth } from "../middleware/auth.js";
import { recordPresenceEvent } from "../services/user-presence.js";
import { refreshTokenExpiresAt, signAccessToken } from "../services/token-service.js";
import { generateRefreshToken, hashRefreshToken, verifyPassword } from "../utils/security.js";

const LoginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

const RefreshSchema = z.object({
  refreshToken: z.string().min(20),
});

const LogoutSchema = z.object({
  refreshToken: z.string().min(20).optional(),
});

export const adminAuthRouter = Router();

adminAuthRouter.post("/login", async (req, res) => {
  const parsed = LoginSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: { code: "VALIDATION_ERROR", details: parsed.error.flatten() } });
  }

  const input = parsed.data;
  const adminResult = await pool.query<{
    id: string;
    email: string;
    password_hash: string;
    role: "admin" | "super_admin";
    is_active: boolean;
  }>("SELECT id, email, password_hash, role, is_active FROM admin_users WHERE email = $1", [input.email.toLowerCase()]);

  const admin = adminResult.rows[0];
  if (!admin || !admin.is_active) {
    await pool.query(
      "INSERT INTO admin_auth_audit (admin_user_id, event_type, ip, user_agent) VALUES ($1, $2, $3, $4)",
      [null, "admin_login_failed", req.ip, req.headers["user-agent"] ?? null]
    );
    return res.status(401).json({ error: { code: "INVALID_CREDENTIALS", message: "Email or password invalid" } });
  }

  const passwordOk = await verifyPassword(admin.password_hash, input.password);
  if (!passwordOk) {
    await pool.query(
      "INSERT INTO admin_auth_audit (admin_user_id, event_type, ip, user_agent) VALUES ($1, $2, $3, $4)",
      [admin.id, "admin_login_failed", req.ip, req.headers["user-agent"] ?? null]
    );
    return res.status(401).json({ error: { code: "INVALID_CREDENTIALS", message: "Email or password invalid" } });
  }

  const refreshToken = generateRefreshToken();
  const refreshTokenHash = hashRefreshToken(refreshToken);
  const expiresAt = refreshTokenExpiresAt();
  const sessionInsert = await pool.query<{ id: string }>(
    `INSERT INTO admin_auth_sessions (admin_user_id, refresh_token_hash, expires_at, device_info, ip, last_used_at)
     VALUES ($1, $2, $3, $4, $5, now())
     RETURNING id`,
    [admin.id, refreshTokenHash, expiresAt, req.headers["user-agent"] ?? null, req.ip]
  );

  await pool.query("UPDATE admin_users SET last_login_at = now() WHERE id = $1", [admin.id]);
  await pool.query("INSERT INTO admin_auth_audit (admin_user_id, event_type, ip, user_agent) VALUES ($1, $2, $3, $4)", [
    admin.id,
    "admin_login_success",
    req.ip,
    req.headers["user-agent"] ?? null,
  ]);
  await recordPresenceEvent({
    subjectType: "admin_user",
    subjectId: admin.id,
    sessionId: sessionInsert.rows[0].id,
    eventType: "login",
    ip: req.ip ?? null,
    userAgent: req.headers["user-agent"] ?? null,
  });

  const accessToken = signAccessToken({
    sub: admin.id,
    sessionId: sessionInsert.rows[0].id,
    realm: "admin",
    role: admin.role,
  });

  return res.json({
    data: {
      admin: {
        id: admin.id,
        email: admin.email,
        role: admin.role,
      },
      tokens: {
        accessToken,
        refreshToken,
        tokenType: "Bearer",
      },
    },
  });
});

adminAuthRouter.post("/refresh", async (req, res) => {
  const parsed = RefreshSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: { code: "VALIDATION_ERROR", details: parsed.error.flatten() } });
  }

  const refreshTokenHash = hashRefreshToken(parsed.data.refreshToken);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const sessionResult = await client.query<{
      session_id: string;
      admin_user_id: string;
      role: "admin" | "super_admin";
    }>(
      `SELECT s.id AS session_id, s.admin_user_id, a.role
       FROM admin_auth_sessions s
       JOIN admin_users a ON a.id = s.admin_user_id
       WHERE s.refresh_token_hash = $1
         AND s.revoked_at IS NULL
         AND s.expires_at > now()
         AND a.is_active = TRUE
       LIMIT 1`,
      [refreshTokenHash]
    );

    const currentSession = sessionResult.rows[0];
    if (!currentSession) {
      await client.query("ROLLBACK");
      return res.status(401).json({ error: { code: "REFRESH_INVALID", message: "Invalid refresh token" } });
    }

    await client.query("UPDATE admin_auth_sessions SET revoked_at = now() WHERE id = $1", [currentSession.session_id]);
    const nextRefreshToken = generateRefreshToken();
    const nextRefreshTokenHash = hashRefreshToken(nextRefreshToken);
    const nextExpiresAt = refreshTokenExpiresAt();
    const nextSession = await client.query<{ id: string }>(
      `INSERT INTO admin_auth_sessions (admin_user_id, refresh_token_hash, expires_at, device_info, ip, last_used_at)
       VALUES ($1, $2, $3, $4, $5, now())
       RETURNING id`,
      [currentSession.admin_user_id, nextRefreshTokenHash, nextExpiresAt, req.headers["user-agent"] ?? null, req.ip]
    );

    await client.query(
      "INSERT INTO admin_auth_audit (admin_user_id, event_type, ip, user_agent) VALUES ($1, $2, $3, $4)",
      [currentSession.admin_user_id, "admin_refresh", req.ip, req.headers["user-agent"] ?? null]
    );
    await recordPresenceEvent(
      {
        subjectType: "admin_user",
        subjectId: currentSession.admin_user_id,
        sessionId: nextSession.rows[0].id,
        eventType: "refresh",
        ip: req.ip ?? null,
        userAgent: req.headers["user-agent"] ?? null,
      },
      client
    );

    await client.query("COMMIT");

    const accessToken = signAccessToken({
      sub: currentSession.admin_user_id,
      sessionId: nextSession.rows[0].id,
      realm: "admin",
      role: currentSession.role,
    });

    return res.json({
      data: {
        tokens: {
          accessToken,
          refreshToken: nextRefreshToken,
          tokenType: "Bearer",
        },
      },
    });
  } catch {
    await client.query("ROLLBACK");
    return res.status(500).json({ error: { code: "INTERNAL_ERROR", message: "Refresh failed" } });
  } finally {
    client.release();
  }
});

adminAuthRouter.post("/logout", requireAuth("admin"), async (req, res) => {
  const parsed = LogoutSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    return res.status(400).json({ error: { code: "VALIDATION_ERROR", details: parsed.error.flatten() } });
  }

  let adminUserId = req.auth!.userId;
  let sessionId = req.auth!.sessionId;
  if (parsed.data.refreshToken) {
    const refreshTokenHash = hashRefreshToken(parsed.data.refreshToken);
    const result = await pool.query<{ admin_user_id: string; id: string }>(
      `UPDATE admin_auth_sessions
       SET revoked_at = now()
       WHERE refresh_token_hash = $1 AND revoked_at IS NULL
       RETURNING admin_user_id, id`,
      [refreshTokenHash]
    );
    if ((result.rowCount ?? 0) > 0) {
      adminUserId = result.rows[0].admin_user_id;
      sessionId = result.rows[0].id;
    }
  } else {
    await pool.query("UPDATE admin_auth_sessions SET revoked_at = now() WHERE id = $1 AND revoked_at IS NULL", [
      req.auth!.sessionId,
    ]);
  }

  await pool.query("INSERT INTO admin_auth_audit (admin_user_id, event_type, ip, user_agent) VALUES ($1, $2, $3, $4)", [
    adminUserId,
    "admin_logout",
    req.ip,
    req.headers["user-agent"] ?? null,
  ]);
  await recordPresenceEvent({
    subjectType: "admin_user",
    subjectId: adminUserId,
    sessionId,
    eventType: "logout",
    ip: req.ip ?? null,
    userAgent: req.headers["user-agent"] ?? null,
  });
  return res.json({ data: { success: true } });
});

adminAuthRouter.get("/me", requireAuth("admin"), async (req, res) => {
  const result = await pool.query<{
    id: string;
    email: string;
    role: "admin" | "super_admin";
    last_login_at: string | null;
  }>(
    `SELECT
       a.id,
       a.email,
       a.role,
       COALESCE(
         (
           SELECT max(p.happened_at)::text
           FROM user_presence_events p
           WHERE p.subject_type = 'admin_user'
             AND p.subject_id = a.id
         ),
         a.last_login_at::text
       ) AS last_login_at
     FROM admin_users a
     WHERE a.id = $1 AND a.is_active = TRUE`,
    [req.auth!.userId]
  );

  if ((result.rowCount ?? 0) === 0) {
    return res.status(404).json({ error: { code: "ADMIN_NOT_FOUND", message: "Admin not found" } });
  }

  return res.json({ data: result.rows[0] });
});
