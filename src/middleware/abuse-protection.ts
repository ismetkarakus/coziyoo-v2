import type { NextFunction, Request, Response } from "express";
import { pool } from "../db/client.js";

type AbuseFlow =
  | "signup"
  | "login"
  | "display_name_check"
  | "order_create"
  | "payment_start"
  | "refund_request"
  | "pin_verify";

type AbuseConfig = {
  flow: AbuseFlow;
  ipLimit: number;
  userLimit: number;
  windowMs: number;
};

const ipBuckets = new Map<string, number[]>();
const userBuckets = new Map<string, number[]>();

export function abuseProtection(config: AbuseConfig) {
  return async (req: Request, res: Response, next: NextFunction) => {
    const now = Date.now();
    const ip = req.ip ?? "unknown";
    const userId = req.auth?.userId ?? "anon";

    const ipKey = `${config.flow}:ip:${ip}`;
    const userKey = `${config.flow}:user:${userId}`;

    const ipCount = pushAndCount(ipBuckets, ipKey, now, config.windowMs);
    const userCount = pushAndCount(userBuckets, userKey, now, config.windowMs);

    if (ipCount > config.ipLimit || userCount > config.userLimit) {
      await pool.query(
        `INSERT INTO abuse_risk_events (subject_type, subject_id, flow, risk_score, decision, reason_codes_json, request_fingerprint, created_at)
         VALUES ($1, $2, $3, $4, 'deny', $5, $6, now())`,
        [
          req.auth?.userId ? "user" : "ip",
          req.auth?.userId ?? ip,
          config.flow,
          95,
          JSON.stringify([
            ipCount > config.ipLimit ? "ip_rate_limit_exceeded" : null,
            userCount > config.userLimit ? "user_rate_limit_exceeded" : null,
          ].filter(Boolean)),
          `${ip}:${String(req.headers["user-agent"] ?? "unknown")}`,
        ]
      );
      return res.status(429).json({
        error: { code: "ABUSE_RATE_LIMIT", message: "Too many requests for this sensitive flow" },
      });
    }

    return next();
  };
}

function pushAndCount(store: Map<string, number[]>, key: string, now: number, windowMs: number): number {
  const list = store.get(key) ?? [];
  list.push(now);
  const threshold = now - windowMs;
  const filtered = list.filter((ts) => ts >= threshold);
  store.set(key, filtered);
  return filtered.length;
}

