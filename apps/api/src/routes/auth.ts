import { Router } from "express";
import { createHash, randomInt, randomUUID } from "node:crypto";
import { z } from "zod";
import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { pool } from "../db/client.js";
import { env } from "../config/env.js";
import { abuseProtection } from "../middleware/abuse-protection.js";
import { requireAuth } from "../middleware/auth.js";
import { recordPresenceEvent } from "../services/user-presence.js";
import { refreshTokenExpiresAt, signAccessToken } from "../services/token-service.js";
import { normalizeDisplayName } from "../utils/normalize.js";
import { generateRefreshToken, hashPassword, hashRefreshToken, verifyPassword } from "../utils/security.js";
import {
  normalizeIdentifier,
  checkLoginState,
  recordFailure,
  recordSuccess,
  issueUnlockToken,
  redeemUnlockToken,
  fireSecurityAlert,
} from "../services/login-security.js";

const LocationSchema = z.object({
  latitude: z.number().min(-90).max(90),
  longitude: z.number().min(-180).max(180),
  accuracyM: z.number().int().min(0).max(100_000).optional(),
  source: z.string().trim().min(1).max(50).optional(),
});

const RegisterSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8).max(128),
  displayName: z.string().min(3).max(40).optional(),
  fullName: z.string().min(1).max(120).optional(),
  userType: z.enum(["buyer", "seller", "both"]).optional(),
  countryCode: z.string().min(2).max(3).optional(),
  language: z.string().min(2).max(10).optional(),
  location: LocationSchema.optional(),
});

const LoginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
  deviceId: z.string().min(1).max(128).optional(),
  deviceName: z.string().min(1).max(128).optional(),
  location: LocationSchema.optional(),
});

const RefreshSchema = z.object({
  refreshToken: z.string().min(20),
});

const LogoutSchema = z.object({
  refreshToken: z.string().min(20).optional(),
});

const PasswordResetRequestSchema = z.object({});

const PasswordResetConfirmSchema = z.object({
  code: z.string().regex(/^\d{6}$/, "6-digit code required"),
  newPassword: z.string().min(8).max(128),
});

const PASSWORD_RESET_CODE_TTL_MINUTES = 10;
const PASSWORD_RESET_MIN_REQUEST_INTERVAL_SECONDS = 60;

export const authRouter = Router();

function hashResetCode(code: string): string {
  return createHash("sha256").update(code).digest("hex");
}

async function sendPasswordResetCodeEmail(params: {
  email: string;
  displayName: string | null;
  code: string;
  expiresInMinutes: number;
}): Promise<void> {
  if (!env.N8N_HOST) {
    throw new Error("EMAIL_DELIVERY_NOT_CONFIGURED");
  }
  const url = `${env.N8N_HOST}${env.PASSWORD_RESET_EMAIL_WEBHOOK_PATH}`;
  const response = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      channel: "password_reset",
      email: params.email,
      displayName: params.displayName,
      code: params.code,
      expiresInMinutes: params.expiresInMinutes,
      appName: "Coziyoo",
    }),
  });
  if (!response.ok) {
    throw new Error(`EMAIL_DELIVERY_FAILED_${response.status}`);
  }
}

authRouter.get("/display-name/check", abuseProtection({ flow: "display_name_check", ipLimit: 200, userLimit: 120, windowMs: 60_000 }), async (req, res) => {
  const value = String(req.query.value ?? "");
  const normalized = normalizeDisplayName(value);
  if (normalized.length < 3) {
    return res.status(400).json({
      error: { code: "DISPLAY_NAME_INVALID", message: "Display name must be at least 3 chars" },
    });
  }

  const exists = await pool.query<{ exists: boolean }>(
    "SELECT EXISTS(SELECT 1 FROM users WHERE display_name_normalized = $1) AS exists",
    [normalized]
  );

  const suggestionRows = await pool.query<{ display_name: string }>(
    "SELECT display_name FROM users WHERE display_name_normalized LIKE $1 ORDER BY display_name ASC LIMIT 5",
    [`${normalized.slice(0, Math.max(1, normalized.length - 1))}%`]
  );

  const suggestions = suggestionRows.rows.map((row) => row.display_name);
  if (!exists.rows[0].exists && suggestions.length === 0) {
    suggestions.push(`${value}${Math.floor(Math.random() * 900 + 100)}`);
  }

  return res.json({
    data: {
      value,
      normalized,
      available: !exists.rows[0].exists,
      suggestions,
    },
  });
});

authRouter.post("/register", abuseProtection({ flow: "signup", ipLimit: 120, userLimit: 80, windowMs: 60_000 }), async (req, res) => {
  const parsed = RegisterSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: { code: "VALIDATION_ERROR", details: parsed.error.flatten() } });
  }

  const input = parsed.data;
  const passwordHash = await hashPassword(input.password);
  const displayName = input.displayName ?? input.email.split("@")[0].slice(0, 40);
  const userType = input.userType ?? "buyer";
  const displayNameNormalized = normalizeDisplayName(displayName);

  try {
    const userInsert = await pool.query<{
      id: string;
      email: string;
      display_name: string;
      user_type: "buyer" | "seller" | "both";
    }>(
      `INSERT INTO users (email, password_hash, display_name, display_name_normalized, full_name, user_type, country_code, language)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
       RETURNING id, email, display_name, user_type`,
      [
        input.email.toLowerCase(),
        passwordHash,
        displayName,
        displayNameNormalized,
        input.fullName ?? null,
        userType,
        input.countryCode ?? null,
        input.language ?? null,
      ]
    );

    const user = userInsert.rows[0];
    const refreshToken = generateRefreshToken();
    const refreshTokenHash = hashRefreshToken(refreshToken);
    const expiresAt = refreshTokenExpiresAt();

    const sessionInsert = await pool.query<{ id: string }>(
      `INSERT INTO auth_sessions (user_id, refresh_token_hash, expires_at, device_info, ip, last_used_at)
       VALUES ($1, $2, $3, $4, $5, now())
       RETURNING id`,
      [user.id, refreshTokenHash, expiresAt, req.headers["user-agent"] ?? null, req.ip]
    );

    await pool.query(
      "INSERT INTO auth_audit (user_id, event_type, ip, user_agent) VALUES ($1, $2, $3, $4)",
      [user.id, "register_success", req.ip, req.headers["user-agent"] ?? null]
    );

    await recordPresenceEvent({
      subjectType: "app_user",
      subjectId: user.id,
      sessionId: sessionInsert.rows[0].id,
      eventType: "login",
      ip: req.ip ?? null,
      userAgent: req.headers["user-agent"] ?? null,
    });

    if (input.location) {
      await pool.query(
        `INSERT INTO user_login_locations (user_id, session_id, latitude, longitude, accuracy_m, source, ip, user_agent)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
        [
          user.id,
          sessionInsert.rows[0].id,
          input.location.latitude,
          input.location.longitude,
          input.location.accuracyM ?? null,
          input.location.source ?? "app",
          req.ip ?? null,
          req.headers["user-agent"] ?? null,
        ]
      );
    }

    const accessToken = signAccessToken({
      sub: user.id,
      sessionId: sessionInsert.rows[0].id,
      realm: "app",
      role: user.user_type,
    });

    return res.status(201).json({
      data: {
        user: {
          id: user.id,
          email: user.email,
          displayName: user.display_name,
          userType: user.user_type,
        },
        tokens: {
          accessToken,
          refreshToken,
          tokenType: "Bearer",
        },
      },
    });
  } catch (error) {
    const err = error as { code?: string; constraint?: string };
    if (err.code === "23505" && err.constraint?.includes("display_name")) {
      return res.status(409).json({ error: { code: "DISPLAY_NAME_TAKEN", message: "Display name already used" } });
    }
    if (err.code === "23505" && err.constraint?.includes("email")) {
      return res.status(409).json({ error: { code: "EMAIL_TAKEN", message: "Email already used" } });
    }
    return res.status(500).json({ error: { code: "INTERNAL_ERROR", message: "Register failed" } });
  }
});

authRouter.post("/login", abuseProtection({ flow: "login", ipLimit: 120, userLimit: 80, windowMs: 60_000 }), async (req, res) => {
  const parsed = LoginSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: { code: "VALIDATION_ERROR", details: parsed.error.flatten() } });
  }

  const input = parsed.data;
  const normalizedEmail = normalizeIdentifier(input.email);
  const deviceId = input.deviceId ?? null;
  const deviceName = input.deviceName ?? null;
  const ip = req.ip ?? null;
  const userAgent = req.headers["user-agent"] ?? null;

  const state = await checkLoginState("app", normalizedEmail);
  if (state.softLocked) {
    return res.status(423).json({ error: { code: "ACCOUNT_LOCKED", message: "Account is temporarily locked. Check your email to unlock." } });
  }
  if (state.retryAfterSeconds > 0) {
    res.setHeader("Retry-After", String(state.retryAfterSeconds));
    return res.status(429).json({ error: { code: "TOO_MANY_ATTEMPTS", message: "Too many failed attempts. Try again later.", retryAfterSeconds: state.retryAfterSeconds } });
  }

  const userResult = await pool.query<{
    id: string;
    email: string;
    password_hash: string;
    user_type: "buyer" | "seller" | "both";
    is_active: boolean;
  }>("SELECT id, email, password_hash, user_type, is_active FROM users WHERE email = $1", [normalizedEmail]);

  const user = userResult.rows[0];
  if (!user || !user.is_active) {
    const { newCount, justSoftLocked } = await recordFailure({
      realm: "app",
      identifier: normalizedEmail,
      userId: null,
      deviceId,
      deviceName,
      ip,
      userAgent,
      failureReason: "user_not_found_or_inactive",
    });
    if (justSoftLocked) {
      fireSecurityAlert({ alertType: "soft_locked", realm: "app", identifier: normalizedEmail, count: newCount });
      issueUnlockToken("app", normalizedEmail).catch(() => {});
    } else if (newCount >= 3 && newCount % 3 === 0) {
      fireSecurityAlert({ alertType: "suspicious_activity", realm: "app", identifier: normalizedEmail, count: newCount });
    }
    await pool.query("INSERT INTO auth_audit (user_id, event_type, ip, user_agent) VALUES ($1, $2, $3, $4)", [
      null,
      "login_failed",
      req.ip,
      req.headers["user-agent"] ?? null,
    ]);
    return res.status(401).json({ error: { code: "INVALID_CREDENTIALS", message: "Email or password invalid" } });
  }

  const passwordOk = await verifyPassword(user.password_hash, input.password);
  if (!passwordOk) {
    const { newCount, justSoftLocked } = await recordFailure({
      realm: "app",
      identifier: normalizedEmail,
      userId: user.id,
      deviceId,
      deviceName,
      ip,
      userAgent,
      failureReason: "wrong_password",
    });
    if (justSoftLocked) {
      fireSecurityAlert({ alertType: "soft_locked", realm: "app", identifier: normalizedEmail, count: newCount });
      issueUnlockToken("app", normalizedEmail).catch(() => {});
    } else if (newCount >= 3 && newCount % 3 === 0) {
      fireSecurityAlert({ alertType: "suspicious_activity", realm: "app", identifier: normalizedEmail, count: newCount });
    }
    await pool.query("INSERT INTO auth_audit (user_id, event_type, ip, user_agent) VALUES ($1, $2, $3, $4)", [
      user.id,
      "login_failed",
      req.ip,
      req.headers["user-agent"] ?? null,
    ]);
    return res.status(401).json({ error: { code: "INVALID_CREDENTIALS", message: "Email or password invalid" } });
  }

  const refreshToken = generateRefreshToken();
  const refreshTokenHash = hashRefreshToken(refreshToken);
  const expiresAt = refreshTokenExpiresAt();
  const sessionInsert = await pool.query<{ id: string }>(
    `INSERT INTO auth_sessions (user_id, refresh_token_hash, expires_at, device_info, ip, last_used_at)
     VALUES ($1, $2, $3, $4, $5, now())
     RETURNING id`,
    [user.id, refreshTokenHash, expiresAt, req.headers["user-agent"] ?? null, req.ip]
  );

  await pool.query("UPDATE users SET last_sign_in_at = now() WHERE id = $1", [user.id]);

  await pool.query("INSERT INTO auth_audit (user_id, event_type, ip, user_agent) VALUES ($1, $2, $3, $4)", [
    user.id,
    "login_success",
    req.ip,
    req.headers["user-agent"] ?? null,
  ]);
  await recordSuccess({
    realm: "app",
    identifier: normalizedEmail,
    userId: user.id,
    deviceId,
    deviceName,
    ip,
    userAgent,
  });
  await recordPresenceEvent({
    subjectType: "app_user",
    subjectId: user.id,
    sessionId: sessionInsert.rows[0].id,
    eventType: "login",
    ip: req.ip ?? null,
    userAgent: req.headers["user-agent"] ?? null,
  });

  const accessToken = signAccessToken({
    sub: user.id,
    sessionId: sessionInsert.rows[0].id,
    realm: "app",
    role: user.user_type,
  });

  await pool.query(
    `INSERT INTO user_login_locations (user_id, session_id, latitude, longitude, accuracy_m, source, ip, user_agent)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
    [
      user.id,
      sessionInsert.rows[0].id,
      input.location?.latitude ?? null,
      input.location?.longitude ?? null,
      input.location?.accuracyM ?? null,
      input.location?.source ?? "ip",
      req.ip ?? null,
      req.headers["user-agent"] ?? null,
    ]
  );

  return res.json({
    data: {
      user: {
        id: user.id,
        email: user.email,
        userType: user.user_type,
      },
      tokens: {
        accessToken,
        refreshToken,
        tokenType: "Bearer",
      },
    },
  });
});

authRouter.post("/refresh", async (req, res) => {
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
      user_id: string;
      user_type: "buyer" | "seller" | "both";
    }>(
      `SELECT s.id AS session_id, s.user_id, u.user_type
       FROM auth_sessions s
       JOIN users u ON u.id = s.user_id
       WHERE s.refresh_token_hash = $1
         AND s.revoked_at IS NULL
         AND s.expires_at > now()
         AND u.is_active = TRUE
       LIMIT 1`,
      [refreshTokenHash]
    );

    const currentSession = sessionResult.rows[0];
    if (!currentSession) {
      await client.query("ROLLBACK");
      return res.status(401).json({ error: { code: "REFRESH_INVALID", message: "Invalid refresh token" } });
    }

    await client.query("UPDATE auth_sessions SET revoked_at = now() WHERE id = $1", [currentSession.session_id]);
    const nextRefreshToken = generateRefreshToken();
    const nextRefreshTokenHash = hashRefreshToken(nextRefreshToken);
    const nextExpiresAt = refreshTokenExpiresAt();
    const nextSession = await client.query<{ id: string }>(
      `INSERT INTO auth_sessions (user_id, refresh_token_hash, expires_at, device_info, ip, last_used_at)
       VALUES ($1, $2, $3, $4, $5, now())
       RETURNING id`,
      [currentSession.user_id, nextRefreshTokenHash, nextExpiresAt, req.headers["user-agent"] ?? null, req.ip]
    );

    await client.query("INSERT INTO auth_audit (user_id, event_type, ip, user_agent) VALUES ($1, $2, $3, $4)", [
      currentSession.user_id,
      "refresh",
      req.ip,
      req.headers["user-agent"] ?? null,
    ]);
    await recordPresenceEvent(
      {
        subjectType: "app_user",
        subjectId: currentSession.user_id,
        sessionId: nextSession.rows[0].id,
        eventType: "refresh",
        ip: req.ip ?? null,
        userAgent: req.headers["user-agent"] ?? null,
      },
      client
    );

    await client.query("COMMIT");

    const accessToken = signAccessToken({
      sub: currentSession.user_id,
      sessionId: nextSession.rows[0].id,
      realm: "app",
      role: currentSession.user_type,
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

authRouter.post("/logout", requireAuth("app"), async (req, res) => {
  const parsed = LogoutSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    return res.status(400).json({ error: { code: "VALIDATION_ERROR", details: parsed.error.flatten() } });
  }

  let userId = req.auth!.userId;
  let sessionId = req.auth!.sessionId;
  if (parsed.data.refreshToken) {
    const refreshTokenHash = hashRefreshToken(parsed.data.refreshToken);
    const result = await pool.query<{ user_id: string; id: string }>(
      `UPDATE auth_sessions
       SET revoked_at = now()
       WHERE refresh_token_hash = $1 AND revoked_at IS NULL
       RETURNING user_id, id`,
      [refreshTokenHash]
    );
    if ((result.rowCount ?? 0) > 0) {
      userId = result.rows[0].user_id;
      sessionId = result.rows[0].id;
    }
  } else {
    await pool.query("UPDATE auth_sessions SET revoked_at = now() WHERE id = $1 AND revoked_at IS NULL", [req.auth!.sessionId]);
  }

  await pool.query("INSERT INTO auth_audit (user_id, event_type, ip, user_agent) VALUES ($1, $2, $3, $4)", [
    userId,
    "logout",
    req.ip,
    req.headers["user-agent"] ?? null,
  ]);
  await recordPresenceEvent({
    subjectType: "app_user",
    subjectId: userId,
    sessionId,
    eventType: "logout",
    ip: req.ip ?? null,
    userAgent: req.headers["user-agent"] ?? null,
  });

  return res.json({ data: { success: true } });
});

const UnlockSchema = z.object({ token: z.string().min(1) });

authRouter.post("/unlock", async (req, res) => {
  const parsed = UnlockSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: { code: "VALIDATION_ERROR", details: parsed.error.flatten() } });
  }
  const ok = await redeemUnlockToken(parsed.data.token);
  if (!ok) {
    return res.status(400).json({ error: { code: "UNLOCK_TOKEN_INVALID", message: "Invalid or expired unlock token." } });
  }
  return res.json({ data: { success: true } });
});

/* ── Public Forgot Password ── */

const ForgotPasswordRequestSchema = z.object({
  email: z.string().email(),
});

const ForgotPasswordConfirmSchema = z.object({
  email: z.string().email(),
  code: z.string().regex(/^\d{6}$/, "6-digit code required"),
  newPassword: z.string().min(8).max(128),
});

authRouter.post("/forgot-password/request", abuseProtection({ flow: "forgot_password", ipLimit: 10, userLimit: 5, windowMs: 60_000 }), async (req, res) => {
  const parsed = ForgotPasswordRequestSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: { code: "VALIDATION_ERROR", details: parsed.error.flatten() } });
  }

  const userResult = await pool.query<{
    id: string;
    email: string;
    display_name: string | null;
    is_active: boolean;
  }>(
    `SELECT id, email, display_name, is_active
     FROM users
     WHERE email = $1
     LIMIT 1`,
    [parsed.data.email.trim().toLowerCase()]
  );

  // Always return success to prevent email enumeration
  if ((userResult.rowCount ?? 0) === 0 || !userResult.rows[0].is_active) {
    return res.json({ data: { codeSent: true, expiresInMinutes: PASSWORD_RESET_CODE_TTL_MINUTES } });
  }
  const user = userResult.rows[0];

  const latestRequest = await pool.query<{ requested_at: string }>(
    `SELECT created_at::text AS requested_at
     FROM password_reset_codes
     WHERE user_id = $1
     ORDER BY created_at DESC
     LIMIT 1`,
    [user.id]
  );
  if ((latestRequest.rowCount ?? 0) > 0) {
    const latestAt = new Date(latestRequest.rows[0].requested_at);
    if (!Number.isNaN(latestAt.getTime())) {
      const elapsedSeconds = Math.floor((Date.now() - latestAt.getTime()) / 1000);
      if (elapsedSeconds < PASSWORD_RESET_MIN_REQUEST_INTERVAL_SECONDS) {
        const retryAfter = PASSWORD_RESET_MIN_REQUEST_INTERVAL_SECONDS - elapsedSeconds;
        res.setHeader("Retry-After", String(retryAfter));
        return res.status(429).json({
          error: {
            code: "PASSWORD_RESET_TOO_FREQUENT",
            message: `Lütfen ${retryAfter} saniye bekleyin.`,
            retryAfterSeconds: retryAfter,
          },
        });
      }
    }
  }

  const code = String(randomInt(100000, 1000000));
  const codeHash = hashResetCode(code);
  const expiresAt = new Date(Date.now() + PASSWORD_RESET_CODE_TTL_MINUTES * 60_000);

  const insertResult = await pool.query<{ id: string }>(
    `INSERT INTO password_reset_codes
       (user_id, code_hash, expires_at, request_ip, request_user_agent)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id`,
    [user.id, codeHash, expiresAt.toISOString(), req.ip ?? null, req.headers["user-agent"] ?? null]
  );
  const codeId = insertResult.rows[0].id;

  try {
    await sendPasswordResetCodeEmail({
      email: user.email,
      displayName: user.display_name,
      code,
      expiresInMinutes: PASSWORD_RESET_CODE_TTL_MINUTES,
    });
  } catch {
    await pool.query("DELETE FROM password_reset_codes WHERE id = $1", [codeId]);
    return res.status(503).json({
      error: { code: "EMAIL_DELIVERY_UNAVAILABLE", message: "Şu anda e-posta gönderilemedi." },
    });
  }

  await pool.query("INSERT INTO auth_audit (user_id, event_type, ip, user_agent) VALUES ($1, $2, $3, $4)", [
    user.id,
    "forgot_password_requested",
    req.ip,
    req.headers["user-agent"] ?? null,
  ]);

  return res.json({ data: { codeSent: true, expiresInMinutes: PASSWORD_RESET_CODE_TTL_MINUTES } });
});

authRouter.post("/forgot-password/confirm", abuseProtection({ flow: "forgot_password_confirm", ipLimit: 10, userLimit: 5, windowMs: 60_000 }), async (req, res) => {
  const parsed = ForgotPasswordConfirmSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: { code: "VALIDATION_ERROR", details: parsed.error.flatten() } });
  }

  const userResult = await pool.query<{ id: string; is_active: boolean }>(
    `SELECT id, is_active FROM users WHERE email = $1 LIMIT 1`,
    [parsed.data.email.trim().toLowerCase()]
  );
  if ((userResult.rowCount ?? 0) === 0 || !userResult.rows[0].is_active) {
    return res.status(400).json({ error: { code: "PASSWORD_RESET_CODE_INVALID", message: "Kod geçersiz veya süresi dolmuş." } });
  }
  const userId = userResult.rows[0].id;

  const hashed = hashResetCode(parsed.data.code);
  const codeResult = await pool.query<{ id: string }>(
    `SELECT id
     FROM password_reset_codes
     WHERE user_id = $1
       AND consumed_at IS NULL
       AND expires_at > now()
       AND code_hash = $2
     ORDER BY created_at DESC
     LIMIT 1`,
    [userId, hashed]
  );
  if ((codeResult.rowCount ?? 0) === 0) {
    return res.status(400).json({ error: { code: "PASSWORD_RESET_CODE_INVALID", message: "Kod geçersiz veya süresi dolmuş." } });
  }

  const passwordHash = await hashPassword(parsed.data.newPassword);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      `UPDATE users SET password_hash = $1, updated_at = now() WHERE id = $2 AND is_active = TRUE`,
      [passwordHash, userId]
    );
    await client.query(
      `UPDATE password_reset_codes SET consumed_at = now() WHERE user_id = $1 AND consumed_at IS NULL`,
      [userId]
    );
    await client.query(
      `UPDATE auth_sessions SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL`,
      [userId]
    );
    await client.query("INSERT INTO auth_audit (user_id, event_type, ip, user_agent) VALUES ($1, $2, $3, $4)", [
      userId,
      "forgot_password_completed",
      req.ip,
      req.headers["user-agent"] ?? null,
    ]);
    await client.query("COMMIT");
  } catch {
    await client.query("ROLLBACK");
    return res.status(500).json({ error: { code: "INTERNAL_ERROR", message: "Şifre güncellenemedi" } });
  } finally {
    client.release();
  }

  return res.json({ data: { success: true, message: "Şifre başarıyla güncellendi." } });
});

authRouter.get("/me", requireAuth("app"), async (req, res) => {
  const result = await pool.query<{
    id: string;
    email: string;
    display_name: string;
    user_type: string;
    full_name: string | null;
    country_code: string | null;
    language: string | null;
    phone: string | null;
    dob: string | null;
    profile_image_url: string | null;
  }>(
    `SELECT id, email, display_name, user_type, full_name, country_code, language, phone, dob, profile_image_url
     FROM users
     WHERE id = $1 AND is_active = TRUE`,
    [req.auth!.userId]
  );

  if ((result.rowCount ?? 0) === 0) {
    return res.status(404).json({ error: { code: "USER_NOT_FOUND", message: "User not found" } });
  }

  const user = result.rows[0];
  return res.json({
    data: {
      id: user.id,
      email: user.email,
      displayName: user.display_name,
      fullName: user.full_name,
      userType: user.user_type,
      countryCode: user.country_code,
      language: user.language,
      phone: user.phone,
      dob: user.dob,
      profileImageUrl: user.profile_image_url,
    },
  });
});

const UpdateProfileSchema = z.object({
  displayName: z.string().min(3).max(40).optional(),
  fullName: z.string().min(1).max(120).optional(),
  countryCode: z.union([
    z.string().regex(/^\d{11}$/, "TC identity number must be 11 digits"),
    z.string().min(2).max(3),
  ]).optional(),
  language: z.string().min(2).max(10).optional(),
  phone: z.string().min(7).max(20).optional(),
  dob: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "YYYY-MM-DD format required").optional(),
  email: z.string().email().optional(),
});

authRouter.put("/me", requireAuth("app"), async (req, res) => {
  const parsed = UpdateProfileSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: { code: "VALIDATION_ERROR", details: parsed.error.flatten() } });
  }

  const fields = parsed.data;
  if (Object.keys(fields).length === 0) {
    return res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "No fields to update" } });
  }

  const setClauses: string[] = [];
  const values: unknown[] = [];
  let idx = 1;

  if (fields.displayName !== undefined) {
    setClauses.push(`display_name = $${idx++}`);
    values.push(normalizeDisplayName(fields.displayName));
  }
  if (fields.fullName !== undefined) {
    setClauses.push(`full_name = $${idx++}`);
    values.push(fields.fullName);
  }
  if (fields.countryCode !== undefined) {
    setClauses.push(`country_code = $${idx++}`);
    values.push(fields.countryCode);
  }
  if (fields.language !== undefined) {
    setClauses.push(`language = $${idx++}`);
    values.push(fields.language);
  }
  if (fields.phone !== undefined) {
    setClauses.push(`phone = $${idx++}`);
    values.push(fields.phone);
  }
  if (fields.dob !== undefined) {
    setClauses.push(`dob = $${idx++}`);
    values.push(fields.dob);
  }
  if (fields.email !== undefined) {
    const existing = await pool.query(
      `SELECT id FROM users WHERE email = $1 AND id != $2 AND is_active = TRUE`,
      [fields.email, req.auth!.userId]
    );
    if (existing.rows.length > 0) {
      return res.status(409).json({ error: { code: "EMAIL_TAKEN", message: "This email is already in use" } });
    }
    setClauses.push(`email = $${idx++}`);
    values.push(fields.email);
  }

  setClauses.push(`updated_at = NOW()`);
  values.push(req.auth!.userId);

  const result2 = await pool.query<{
    id: string;
    email: string;
    display_name: string;
    full_name: string | null;
    user_type: string;
    country_code: string | null;
    language: string | null;
    phone: string | null;
    dob: string | null;
    profile_image_url: string | null;
  }>(
    `UPDATE users SET ${setClauses.join(", ")} WHERE id = $${idx} AND is_active = TRUE
     RETURNING id, email, display_name, user_type, full_name, country_code, language, phone, dob, profile_image_url`,
    values
  );

  if ((result2.rowCount ?? 0) === 0) {
    return res.status(404).json({ error: { code: "USER_NOT_FOUND", message: "User not found" } });
  }

  const updated = result2.rows[0];
  return res.json({
    data: {
      id: updated.id,
      email: updated.email,
      displayName: updated.display_name,
      fullName: updated.full_name,
      userType: updated.user_type,
      countryCode: updated.country_code,
      language: updated.language,
      phone: updated.phone,
      dob: updated.dob,
      profileImageUrl: updated.profile_image_url,
    },
  });
});

authRouter.post("/me/password-reset/request", requireAuth("app"), async (req, res) => {
  const parsed = PasswordResetRequestSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    return res.status(400).json({ error: { code: "VALIDATION_ERROR", details: parsed.error.flatten() } });
  }

  const userResult = await pool.query<{
    id: string;
    email: string;
    display_name: string | null;
    is_active: boolean;
  }>(
    `SELECT id, email, display_name, is_active
     FROM users
     WHERE id = $1
     LIMIT 1`,
    [req.auth!.userId]
  );
  if ((userResult.rowCount ?? 0) === 0 || !userResult.rows[0].is_active) {
    return res.status(404).json({ error: { code: "USER_NOT_FOUND", message: "User not found" } });
  }
  const user = userResult.rows[0];

  const latestRequest = await pool.query<{ requested_at: string }>(
    `SELECT created_at::text AS requested_at
     FROM password_reset_codes
     WHERE user_id = $1
     ORDER BY created_at DESC
     LIMIT 1`,
    [user.id]
  );
  if ((latestRequest.rowCount ?? 0) > 0) {
    const latestAt = new Date(latestRequest.rows[0].requested_at);
    if (!Number.isNaN(latestAt.getTime())) {
      const elapsedSeconds = Math.floor((Date.now() - latestAt.getTime()) / 1000);
      if (elapsedSeconds < PASSWORD_RESET_MIN_REQUEST_INTERVAL_SECONDS) {
        const retryAfter = PASSWORD_RESET_MIN_REQUEST_INTERVAL_SECONDS - elapsedSeconds;
        res.setHeader("Retry-After", String(retryAfter));
        return res.status(429).json({
          error: {
            code: "PASSWORD_RESET_TOO_FREQUENT",
            message: `Please wait ${retryAfter} seconds before requesting a new code.`,
            retryAfterSeconds: retryAfter,
          },
        });
      }
    }
  }

  const code = String(randomInt(100000, 1000000));
  const codeHash = hashResetCode(code);
  const expiresAt = new Date(Date.now() + PASSWORD_RESET_CODE_TTL_MINUTES * 60_000);

  const insertResult = await pool.query<{ id: string }>(
    `INSERT INTO password_reset_codes
       (user_id, code_hash, expires_at, request_ip, request_user_agent)
     VALUES ($1, $2, $3, $4, $5)
     RETURNING id`,
    [user.id, codeHash, expiresAt.toISOString(), req.ip ?? null, req.headers["user-agent"] ?? null]
  );
  const codeId = insertResult.rows[0].id;

  try {
    await sendPasswordResetCodeEmail({
      email: user.email,
      displayName: user.display_name,
      code,
      expiresInMinutes: PASSWORD_RESET_CODE_TTL_MINUTES,
    });
  } catch (error) {
    await pool.query("DELETE FROM password_reset_codes WHERE id = $1", [codeId]);
    return res.status(503).json({
      error: {
        code: "EMAIL_DELIVERY_UNAVAILABLE",
        message: "Password reset email could not be sent right now.",
        detail: error instanceof Error ? error.message : String(error),
      },
    });
  }

  await pool.query("INSERT INTO auth_audit (user_id, event_type, ip, user_agent) VALUES ($1, $2, $3, $4)", [
    user.id,
    "password_reset_requested",
    req.ip,
    req.headers["user-agent"] ?? null,
  ]);

  return res.json({
    data: {
      codeSent: true,
      expiresInMinutes: PASSWORD_RESET_CODE_TTL_MINUTES,
    },
  });
});

authRouter.post("/me/password-reset/confirm", requireAuth("app"), async (req, res) => {
  const parsed = PasswordResetConfirmSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: { code: "VALIDATION_ERROR", details: parsed.error.flatten() } });
  }

  const userResult = await pool.query<{ id: string; is_active: boolean }>(
    `SELECT id, is_active
     FROM users
     WHERE id = $1
     LIMIT 1`,
    [req.auth!.userId]
  );
  if ((userResult.rowCount ?? 0) === 0 || !userResult.rows[0].is_active) {
    return res.status(404).json({ error: { code: "USER_NOT_FOUND", message: "User not found" } });
  }

  const hashed = hashResetCode(parsed.data.code);
  const codeResult = await pool.query<{ id: string }>(
    `SELECT id
     FROM password_reset_codes
     WHERE user_id = $1
       AND consumed_at IS NULL
       AND expires_at > now()
       AND code_hash = $2
     ORDER BY created_at DESC
     LIMIT 1`,
    [req.auth!.userId, hashed]
  );
  if ((codeResult.rowCount ?? 0) === 0) {
    return res.status(400).json({
      error: {
        code: "PASSWORD_RESET_CODE_INVALID",
        message: "The verification code is invalid or expired.",
      },
    });
  }

  const passwordHash = await hashPassword(parsed.data.newPassword);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      `UPDATE users
       SET password_hash = $1, updated_at = now()
       WHERE id = $2 AND is_active = TRUE`,
      [passwordHash, req.auth!.userId]
    );
    await client.query(
      `UPDATE password_reset_codes
       SET consumed_at = now()
       WHERE user_id = $1
         AND consumed_at IS NULL`,
      [req.auth!.userId]
    );
    await client.query(
      `UPDATE auth_sessions
       SET revoked_at = now()
       WHERE user_id = $1
         AND id <> $2
         AND revoked_at IS NULL`,
      [req.auth!.userId, req.auth!.sessionId]
    );
    await client.query("INSERT INTO auth_audit (user_id, event_type, ip, user_agent) VALUES ($1, $2, $3, $4)", [
      req.auth!.userId,
      "password_reset_completed",
      req.ip,
      req.headers["user-agent"] ?? null,
    ]);
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    return res.status(500).json({ error: { code: "INTERNAL_ERROR", message: "Password update failed" } });
  } finally {
    client.release();
  }

  return res.json({
    data: {
      success: true,
      message: "Password updated successfully.",
    },
  });
});

/* ── Profile Image Upload ── */

let profileS3Client: S3Client | null = null;
function getProfileS3Client() {
  if (!env.S3_ENDPOINT || !env.S3_BUCKET_SELLER_DOCS || !env.S3_ACCESS_KEY_ID || !env.S3_SECRET_ACCESS_KEY) {
    throw new Error("S3_STORAGE_NOT_CONFIGURED");
  }
  if (profileS3Client) return profileS3Client;
  profileS3Client = new S3Client({
    endpoint: env.S3_ENDPOINT,
    region: env.S3_REGION,
    forcePathStyle: env.S3_FORCE_PATH_STYLE,
    credentials: {
      accessKeyId: env.S3_ACCESS_KEY_ID,
      secretAccessKey: env.S3_SECRET_ACCESS_KEY,
    },
  });
  return profileS3Client;
}

const ProfileImageUploadSchema = z.object({
  contentType: z.enum(["image/jpeg", "image/png", "image/webp"]),
});

const ProfileImageDirectUploadSchema = z.object({
  contentType: z.enum(["image/jpeg", "image/png", "image/webp"]),
  dataBase64: z.string().min(20),
});

authRouter.post("/me/profile-image/upload-url", requireAuth("app"), async (req, res) => {
  const parsed = ProfileImageUploadSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: { code: "VALIDATION_ERROR", details: parsed.error.flatten() } });
  }

  if (!env.S3_ENDPOINT || !env.S3_BUCKET_SELLER_DOCS) {
    return res.status(503).json({ error: { code: "STORAGE_NOT_CONFIGURED", message: "S3 storage is not configured" } });
  }

  const ext = parsed.data.contentType === "image/png" ? "png" : parsed.data.contentType === "image/webp" ? "webp" : "jpg";
  const key = `user/${req.auth!.userId}/profile/${Date.now()}-${randomUUID().slice(0, 8)}.${ext}`;
  const bucket = env.S3_BUCKET_SELLER_DOCS!;

  try {
    const client = getProfileS3Client();
    const uploadUrl = await getSignedUrl(
      client,
      new PutObjectCommand({
        Bucket: bucket,
        Key: key,
        ContentType: parsed.data.contentType,
      }),
      { expiresIn: env.S3_SIGNED_URL_TTL_SECONDS }
    );

    return res.json({
      data: {
        uploadUrl,
        imageUrl: `${env.S3_ENDPOINT}/${bucket}/${key}`,
        expiresInSeconds: env.S3_SIGNED_URL_TTL_SECONDS,
      },
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return res.status(500).json({ error: { code: "INTERNAL_ERROR", message: "Upload URL generation failed", detail } });
  }
});

authRouter.put("/me/profile-image", requireAuth("app"), async (req, res) => {
  const parsed = z.object({ imageUrl: z.string().url() }).safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: { code: "VALIDATION_ERROR", details: parsed.error.flatten() } });
  }

  await pool.query(
    `UPDATE users SET profile_image_url = $1, updated_at = NOW() WHERE id = $2 AND is_active = TRUE`,
    [parsed.data.imageUrl, req.auth!.userId]
  );

  return res.json({ data: { profileImageUrl: parsed.data.imageUrl } });
});

authRouter.post("/me/profile-image/upload", requireAuth("app"), async (req, res) => {
  const parsed = ProfileImageDirectUploadSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: { code: "VALIDATION_ERROR", details: parsed.error.flatten() } });
  }

  const ext = parsed.data.contentType === "image/png" ? "png" : parsed.data.contentType === "image/webp" ? "webp" : "jpg";
  const key = `user/${req.auth!.userId}/profile/${Date.now()}-${randomUUID().slice(0, 8)}.${ext}`;
  const bucket = env.S3_BUCKET_SELLER_DOCS;
  const canUseS3 = Boolean(
    env.S3_ENDPOINT &&
    env.S3_BUCKET_SELLER_DOCS &&
    env.S3_ACCESS_KEY_ID &&
    env.S3_SECRET_ACCESS_KEY
  );

  try {
    const binary = Buffer.from(parsed.data.dataBase64, "base64");
    if (binary.byteLength === 0) {
      return res.status(400).json({ error: { code: "INVALID_IMAGE_DATA", message: "Image payload is empty" } });
    }
    // Keep payload bounded to avoid oversized uploads through JSON.
    if (binary.byteLength > 7 * 1024 * 1024) {
      return res.status(413).json({ error: { code: "IMAGE_TOO_LARGE", message: "Image is too large" } });
    }

    let imageUrl = `data:${parsed.data.contentType};base64,${parsed.data.dataBase64}`;
    let storage: "s3" | "inline" = "inline";

    if (canUseS3 && env.S3_ENDPOINT && bucket) {
      try {
        const client = getProfileS3Client();
        await client.send(
          new PutObjectCommand({
            Bucket: bucket,
            Key: key,
            ContentType: parsed.data.contentType,
            Body: binary,
          })
        );
        imageUrl = `${env.S3_ENDPOINT}/${bucket}/${key}`;
        storage = "s3";
      } catch {
        // Keep inline fallback when S3 upload fails at runtime.
      }
    }

    await pool.query(
      `UPDATE users SET profile_image_url = $1, updated_at = NOW() WHERE id = $2 AND is_active = TRUE`,
      [imageUrl, req.auth!.userId]
    );

    return res.status(201).json({
      data: { profileImageUrl: imageUrl, storage },
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return res.status(500).json({ error: { code: "UPLOAD_FAILED", message: "Profile image upload failed", detail } });
  }
});

/* ── Buyer Address Management ── */

function isValidAddressLine(value: string): boolean {
  const trimmed = value.trim();
  if (trimmed.length < 10) return false;
  const words = trimmed.split(/\s+/).filter((w) => w.length > 0);
  if (words.length < 2) return false;
  // Must contain at least some real letters (not just random chars)
  const letterCount = (trimmed.match(/[\p{L}]/gu) ?? []).length;
  if (letterCount < 5) return false;
  // Must contain at least one space (real addresses have multiple parts)
  if (!trimmed.includes(" ")) return false;
  return true;
}

const addressLineSchema = z
  .string()
  .min(10, "Adres en az 10 karakter olmalı")
  .max(500)
  .refine(isValidAddressLine, {
    message: "Geçerli bir adres girin (mahalle, sokak, bina no gibi)",
  });

const CreateAddressSchema = z.object({
  title: z.string().min(1).max(80),
  addressLine: addressLineSchema,
  isDefault: z.boolean().optional(),
});

const UpdateAddressSchema = z.object({
  title: z.string().min(1).max(80).optional(),
  addressLine: addressLineSchema.optional(),
  isDefault: z.boolean().optional(),
}).refine((d) => Object.keys(d).length > 0, { message: "At least one field required" });

authRouter.get("/me/addresses", requireAuth("app"), async (req, res) => {
  const result = await pool.query<{
    id: string;
    title: string;
    address_line: string;
    is_default: boolean;
    created_at: string;
    updated_at: string;
  }>(
    `SELECT id, title, address_line, is_default, created_at, updated_at
     FROM user_addresses
     WHERE user_id = $1
     ORDER BY is_default DESC, created_at ASC`,
    [req.auth!.userId]
  );

  return res.json({
    data: result.rows.map((r) => ({
      id: r.id,
      title: r.title,
      addressLine: r.address_line,
      isDefault: r.is_default,
      createdAt: r.created_at,
      updatedAt: r.updated_at,
    })),
  });
});

authRouter.post("/me/addresses", requireAuth("app"), async (req, res) => {
  const parsed = CreateAddressSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: { code: "VALIDATION_ERROR", details: parsed.error.flatten() } });
  }

  const { title, addressLine, isDefault } = parsed.data;
  const result = await pool.query<{
    id: string;
    title: string;
    address_line: string;
    is_default: boolean;
    created_at: string;
    updated_at: string;
  }>(
    `INSERT INTO user_addresses (user_id, title, address_line, is_default)
     VALUES ($1, $2, $3, $4)
     RETURNING id, title, address_line, is_default, created_at, updated_at`,
    [req.auth!.userId, title, addressLine, isDefault ?? false]
  );

  const row = result.rows[0];
  return res.status(201).json({
    data: {
      id: row.id,
      title: row.title,
      addressLine: row.address_line,
      isDefault: row.is_default,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    },
  });
});

authRouter.patch("/me/addresses/:addressId", requireAuth("app"), async (req, res) => {
  const addressId = req.params.addressId;
  const parsed = UpdateAddressSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: { code: "VALIDATION_ERROR", details: parsed.error.flatten() } });
  }

  const fields = parsed.data;
  const setClauses: string[] = [];
  const values: unknown[] = [];
  let idx = 1;

  if (fields.title !== undefined) {
    setClauses.push(`title = $${idx++}`);
    values.push(fields.title);
  }
  if (fields.addressLine !== undefined) {
    setClauses.push(`address_line = $${idx++}`);
    values.push(fields.addressLine);
  }
  if (fields.isDefault !== undefined) {
    setClauses.push(`is_default = $${idx++}`);
    values.push(fields.isDefault);
  }

  setClauses.push(`updated_at = NOW()`);
  values.push(addressId, req.auth!.userId);

  const result = await pool.query<{
    id: string;
    title: string;
    address_line: string;
    is_default: boolean;
    created_at: string;
    updated_at: string;
  }>(
    `UPDATE user_addresses SET ${setClauses.join(", ")}
     WHERE id = $${idx} AND user_id = $${idx + 1}
     RETURNING id, title, address_line, is_default, created_at, updated_at`,
    values
  );

  if ((result.rowCount ?? 0) === 0) {
    return res.status(404).json({ error: { code: "ADDRESS_NOT_FOUND", message: "Address not found" } });
  }

  const row = result.rows[0];
  return res.json({
    data: {
      id: row.id,
      title: row.title,
      addressLine: row.address_line,
      isDefault: row.is_default,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    },
  });
});

authRouter.delete("/me/addresses/:addressId", requireAuth("app"), async (req, res) => {
  const result = await pool.query(
    `DELETE FROM user_addresses WHERE id = $1 AND user_id = $2`,
    [req.params.addressId, req.auth!.userId]
  );

  if ((result.rowCount ?? 0) === 0) {
    return res.status(404).json({ error: { code: "ADDRESS_NOT_FOUND", message: "Address not found" } });
  }

  return res.status(204).end();
});
