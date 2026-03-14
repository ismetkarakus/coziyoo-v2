import crypto from "crypto";
import { pool } from "../db/client.js";
import { env } from "../config/env.js";

export function normalizeIdentifier(identifier: string): string {
  return identifier.toLowerCase().trim();
}

export function computeDelaySeconds(consecutiveFailedCount: number): number {
  if (consecutiveFailedCount < 3) return 0;
  if (consecutiveFailedCount === 3) return 2;
  if (consecutiveFailedCount === 4) return 4;
  if (consecutiveFailedCount === 5) return 8;
  return 15;
}

export async function checkLoginState(
  realm: string,
  identifier: string
): Promise<{ softLocked: boolean; retryAfterSeconds: number }> {
  const result = await pool.query<{
    consecutive_failed_count: number;
    last_failed_at: Date | null;
    soft_locked: boolean;
  }>(
    `SELECT consecutive_failed_count, last_failed_at, soft_locked
     FROM security_login_state
     WHERE realm = $1 AND identifier = $2`,
    [realm, identifier]
  );

  if (result.rowCount === 0) {
    return { softLocked: false, retryAfterSeconds: 0 };
  }

  const row = result.rows[0];

  if (row.soft_locked) {
    return { softLocked: true, retryAfterSeconds: 0 };
  }

  const delaySeconds = computeDelaySeconds(row.consecutive_failed_count);
  if (delaySeconds > 0 && row.last_failed_at) {
    const unlockAt = new Date(row.last_failed_at.getTime() + delaySeconds * 1000);
    const now = new Date();
    if (unlockAt > now) {
      const remaining = Math.ceil((unlockAt.getTime() - now.getTime()) / 1000);
      return { softLocked: false, retryAfterSeconds: remaining };
    }
  }

  return { softLocked: false, retryAfterSeconds: 0 };
}

export async function recordFailure(params: {
  realm: string;
  identifier: string;
  userId: string | null;
  deviceId: string | null;
  deviceName: string | null;
  ip: string | null;
  userAgent: string | null;
  failureReason: string;
}): Promise<{ newCount: number; justSoftLocked: boolean }> {
  const { realm, identifier, userId, deviceId, deviceName, ip, userAgent, failureReason } = params;

  const stateResult = await pool.query<{
    consecutive_failed_count: number;
    soft_locked: boolean;
  }>(
    `INSERT INTO security_login_state
       (realm, identifier, consecutive_failed_count, last_failed_at, last_device_id, last_device_name, last_ip, soft_locked)
     VALUES ($1, $2, 1, now(), $3, $4, $5, FALSE)
     ON CONFLICT (realm, identifier) DO UPDATE
       SET consecutive_failed_count = security_login_state.consecutive_failed_count + 1,
           last_failed_at = now(),
           last_device_id = EXCLUDED.last_device_id,
           last_device_name = EXCLUDED.last_device_name,
           last_ip = EXCLUDED.last_ip,
           soft_locked = CASE
             WHEN security_login_state.consecutive_failed_count + 1 >= 10
               THEN TRUE
             ELSE security_login_state.soft_locked
           END,
           soft_locked_at = CASE
             WHEN security_login_state.consecutive_failed_count + 1 >= 10
               AND NOT security_login_state.soft_locked
               THEN now()
             ELSE security_login_state.soft_locked_at
           END
     RETURNING consecutive_failed_count, soft_locked`,
    [realm, identifier, deviceId, deviceName, ip]
  );

  const newCount = stateResult.rows[0].consecutive_failed_count;
  const nowSoftLocked = stateResult.rows[0].soft_locked;

  // Determine if it just became soft locked (count hit exactly 10 and locked=true)
  const justSoftLocked = nowSoftLocked && newCount >= 10;

  await pool.query(
    `INSERT INTO security_login_events
       (realm, actor_user_id, identifier, success, failure_reason, device_id, device_name, ip, user_agent)
     VALUES ($1, $2, $3, FALSE, $4, $5, $6, $7, $8)`,
    [realm, userId, identifier, failureReason, deviceId, deviceName, ip, userAgent]
  );

  return { newCount, justSoftLocked };
}

export async function recordSuccess(params: {
  realm: string;
  identifier: string;
  userId: string;
  deviceId: string | null;
  deviceName: string | null;
  ip: string | null;
  userAgent: string | null;
}): Promise<void> {
  const { realm, identifier, userId, deviceId, deviceName, ip, userAgent } = params;

  await pool.query(
    `UPDATE security_login_state
     SET consecutive_failed_count = 0,
         last_success_at = now(),
         soft_locked = FALSE,
         soft_locked_at = NULL,
         unlock_token = NULL,
         unlock_token_expires_at = NULL
     WHERE realm = $1 AND identifier = $2`,
    [realm, identifier]
  );

  await pool.query(
    `INSERT INTO security_login_events
       (realm, actor_user_id, identifier, success, device_id, device_name, ip, user_agent)
     VALUES ($1, $2, $3, TRUE, $4, $5, $6, $7)`,
    [realm, userId, identifier, deviceId, deviceName, ip, userAgent]
  );
}

export async function issueUnlockToken(realm: string, identifier: string): Promise<string> {
  const token = crypto.randomBytes(24).toString("hex");

  await pool.query(
    `UPDATE security_login_state
     SET unlock_token = $3,
         unlock_token_expires_at = now() + interval '24 hours'
     WHERE realm = $1 AND identifier = $2`,
    [realm, identifier, token]
  );

  return token;
}

export async function redeemUnlockToken(token: string): Promise<boolean> {
  const result = await pool.query<{ realm: string; identifier: string }>(
    `SELECT realm, identifier
     FROM security_login_state
     WHERE unlock_token = $1 AND unlock_token_expires_at > now()`,
    [token]
  );

  if (result.rowCount === 0) {
    return false;
  }

  const { realm, identifier } = result.rows[0];

  await pool.query(
    `UPDATE security_login_state
     SET consecutive_failed_count = 0,
         soft_locked = FALSE,
         soft_locked_at = NULL,
         unlock_token = NULL,
         unlock_token_expires_at = NULL
     WHERE realm = $1 AND identifier = $2`,
    [realm, identifier]
  );

  return true;
}

export function fireSecurityAlert(params: {
  alertType: "suspicious_activity" | "soft_locked";
  realm: string;
  identifier: string;
  count: number;
}): void {
  if (!env.N8N_HOST) return;

  fetch(`${env.N8N_HOST}/webhook/coziyoo/security-alert`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(params),
  }).catch(() => {});
}
