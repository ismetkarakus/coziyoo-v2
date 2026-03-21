import { Router } from "express";
import { z } from "zod";
import { pool } from "../db/client.js";
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

const RegisterSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8).max(128),
  displayName: z.string().min(3).max(40),
  fullName: z.string().min(1).max(120).optional(),
  userType: z.enum(["buyer", "seller", "both"]),
  countryCode: z.string().min(2).max(3).optional(),
  language: z.string().min(2).max(10).optional(),
});

const LoginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
  deviceId: z.string().min(1).max(128).optional(),
  deviceName: z.string().min(1).max(128).optional(),
  location: z.object({
    latitude: z.number().min(-90).max(90),
    longitude: z.number().min(-180).max(180),
    accuracyM: z.number().int().min(0).max(100_000).optional(),
    source: z.string().trim().min(1).max(50).optional(),
  }).optional(),
});

const RefreshSchema = z.object({
  refreshToken: z.string().min(20),
});

const LogoutSchema = z.object({
  refreshToken: z.string().min(20).optional(),
});

export const authRouter = Router();

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
  const displayNameNormalized = normalizeDisplayName(input.displayName);

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
        input.displayName,
        displayNameNormalized,
        input.fullName ?? null,
        input.userType,
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
  countryCode: z.string().min(2).max(3).optional(),
  language: z.string().min(2).max(10).optional(),
  phone: z.string().min(7).max(20).optional(),
  dob: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "YYYY-MM-DD format required").optional(),
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

/* ── Buyer Address Management ── */

const CreateAddressSchema = z.object({
  title: z.string().min(1).max(80),
  addressLine: z.string().min(3).max(500),
  isDefault: z.boolean().optional(),
});

const UpdateAddressSchema = z.object({
  title: z.string().min(1).max(80).optional(),
  addressLine: z.string().min(3).max(500).optional(),
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
