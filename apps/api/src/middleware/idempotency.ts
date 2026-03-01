import crypto from "node:crypto";
import type { NextFunction, Request, Response } from "express";
import { pool } from "../db/client.js";

type IdempotencyConfig = {
  scope: string;
  ttlHours?: number;
};

export function requireIdempotency(config: IdempotencyConfig) {
  const ttlHours = config.ttlHours ?? 24;

  return async (req: Request, res: Response, next: NextFunction) => {
    const rawKey = String(req.headers["idempotency-key"] ?? "").trim();
    if (!rawKey) {
      return res.status(400).json({
        error: { code: "IDEMPOTENCY_KEY_REQUIRED", message: "Missing Idempotency-Key header" },
      });
    }

    const keyHash = sha256(rawKey);
    const requestHash = sha256(
      JSON.stringify({
        method: req.method,
        path: req.path,
        actor: req.auth?.userId ?? null,
        body: req.body ?? null,
      })
    );

    const existing = await pool.query<{
      request_hash: string;
      response_status: number | null;
      response_body_json: unknown;
      expires_at: string;
    }>(
      `SELECT request_hash, response_status, response_body_json, expires_at::text
       FROM idempotency_keys
       WHERE scope = $1 AND key_hash = $2`,
      [config.scope, keyHash]
    );

    if ((existing.rowCount ?? 0) > 0) {
      const row = existing.rows[0];
      if (row.request_hash !== requestHash) {
        return res.status(409).json({
          error: { code: "IDEMPOTENCY_KEY_REUSED", message: "Idempotency-Key is already used for different payload" },
        });
      }

      if (row.response_status !== null && row.response_body_json !== null) {
        res.setHeader("x-idempotent-replay", "true");
        return res.status(row.response_status).json(row.response_body_json);
      }

      return res.status(409).json({
        error: { code: "IDEMPOTENCY_IN_PROGRESS", message: "Request is already being processed" },
      });
    }

    await pool.query(
      `INSERT INTO idempotency_keys (scope, key_hash, request_hash, expires_at, created_at)
       VALUES ($1, $2, $3, now() + ($4 || ' hours')::interval, now())`,
      [config.scope, keyHash, requestHash, String(ttlHours)]
    );

    req.idempotency = { scope: config.scope, keyHash, requestHash };

    const originalJson = res.json.bind(res);
    res.json = ((body: unknown) => {
      void pool.query(
        `UPDATE idempotency_keys
         SET response_status = $1, response_body_json = $2
         WHERE scope = $3 AND key_hash = $4 AND request_hash = $5`,
        [res.statusCode, JSON.stringify(body), config.scope, keyHash, requestHash]
      );
      return originalJson(body);
    }) as typeof res.json;

    return next();
  };
}

function sha256(value: string): string {
  return crypto.createHash("sha256").update(value).digest("hex");
}

