import { Router } from "express";
import { z } from "zod";
import { pool } from "../db/client.js";
import { abuseProtection } from "../middleware/abuse-protection.js";
import { requireAuth } from "../middleware/auth.js";
import { refreshTokenExpiresAt, signAccessToken } from "../services/token-service.js";
import { normalizeDisplayName } from "../utils/normalize.js";
import { generateRefreshToken, hashPassword, hashRefreshToken, verifyPassword } from "../utils/security.js";

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
  const userResult = await pool.query<{
    id: string;
    email: string;
    password_hash: string;
    user_type: "buyer" | "seller" | "both";
    is_active: boolean;
  }>("SELECT id, email, password_hash, user_type, is_active FROM users WHERE email = $1", [input.email.toLowerCase()]);

  const user = userResult.rows[0];
  if (!user || !user.is_active) {
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
  if (parsed.data.refreshToken) {
    const refreshTokenHash = hashRefreshToken(parsed.data.refreshToken);
    const result = await pool.query<{ user_id: string }>(
      `UPDATE auth_sessions
       SET revoked_at = now()
       WHERE refresh_token_hash = $1 AND revoked_at IS NULL
       RETURNING user_id`,
      [refreshTokenHash]
    );
    if ((result.rowCount ?? 0) > 0) {
      userId = result.rows[0].user_id;
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
  }>(
    `SELECT id, email, display_name, user_type, full_name, country_code, language
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
    },
  });
});
