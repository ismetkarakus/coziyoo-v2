import crypto from "node:crypto";
import { Router } from "express";
import { z } from "zod";
import { env } from "../config/env.js";
import { pool } from "../db/client.js";
import { abuseProtection } from "../middleware/abuse-protection.js";
import { resolveActorRole } from "../middleware/app-role.js";
import { requireAuth } from "../middleware/auth.js";
import { enqueueOutboxEvent } from "../services/outbox.js";

const SendPinSchema = z.object({
  testPin: z.string().regex(/^[0-9]{4,8}$/).optional(),
});

const VerifyPinSchema = z.object({
  pin: z.string().regex(/^[0-9]{4,8}$/),
});

const OverrideSchema = z.object({
  reason: z.string().min(3).max(500),
});

export const deliveryProofRouter = Router();
export const adminDeliveryProofRouter = Router();

deliveryProofRouter.post("/:id/delivery-proof/pin/send", requireAuth("app"), async (req, res) => {
  const role = resolveActorRole(req);
  if (role !== "seller") {
    return res.status(403).json({ error: { code: "ROLE_NOT_ALLOWED", message: "Seller role required" } });
  }
  const parsed = SendPinSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    return res.status(400).json({ error: { code: "VALIDATION_ERROR", details: parsed.error.flatten() } });
  }

  const orderId = String(req.params.id ?? "");
  if (!z.string().uuid().safeParse(orderId).success) {
    return res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "Invalid order id" } });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const order = await client.query<{
      buyer_id: string;
      seller_id: string;
      delivery_type: string;
      status: string;
    }>("SELECT buyer_id, seller_id, delivery_type, status FROM orders WHERE id = $1 FOR UPDATE", [orderId]);

    if ((order.rowCount ?? 0) === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: { code: "ORDER_NOT_FOUND", message: "Order not found" } });
    }
    const row = order.rows[0];
    if (row.seller_id !== req.auth!.userId) {
      await client.query("ROLLBACK");
      return res.status(403).json({ error: { code: "FORBIDDEN_ORDER_SCOPE", message: "Not seller of this order" } });
    }
    if (row.delivery_type !== "delivery") {
      await client.query("ROLLBACK");
      return res.status(409).json({ error: { code: "DELIVERY_PROOF_NOT_REQUIRED", message: "Order is not delivery type" } });
    }
    if (!["ready", "in_delivery"].includes(row.status)) {
      await client.query("ROLLBACK");
      return res.status(409).json({
        error: { code: "ORDER_INVALID_STATE", message: "PIN can be sent only in ready/in_delivery states" },
      });
    }

    const pin = parsed.data.testPin && env.NODE_ENV !== "production" ? parsed.data.testPin : randomPin();
    const pinHash = sha256(pin);
    await client.query(
      `INSERT INTO delivery_proof_records
        (order_id, seller_id, buyer_id, proof_mode, pin_hash, pin_sent_at, pin_sent_channel, verification_attempts, status, metadata_json, created_at)
       VALUES ($1, $2, $3, 'pin', $4, now(), 'in_app', 0, 'pending', $5, now())
       ON CONFLICT (order_id)
       DO UPDATE SET
         pin_hash = EXCLUDED.pin_hash,
         pin_sent_at = now(),
         pin_sent_channel = 'in_app',
         verification_attempts = 0,
         status = 'pending',
         metadata_json = EXCLUDED.metadata_json`,
      [orderId, row.seller_id, row.buyer_id, pinHash, JSON.stringify({ ttlMinutes: 10 })]
    );

    await client.query(
      `INSERT INTO notification_events (user_id, type, title, body, data_json, is_read, created_at)
       VALUES ($1, 'delivery_pin', 'Delivery PIN', $2, $3, FALSE, now())`,
      [row.buyer_id, `Your delivery PIN is ${pin}`, JSON.stringify({ orderId })]
    );
    await enqueueOutboxEvent(client, {
      eventType: "delivery_pin_sent",
      aggregateType: "order",
      aggregateId: orderId,
      payload: { orderId, buyerId: row.buyer_id },
    });

    await client.query("COMMIT");
    return res.status(201).json({
      data: {
        orderId,
        status: "pending",
        ...(env.NODE_ENV === "production" ? {} : { debugPin: pin }),
      },
    });
  } catch {
    await client.query("ROLLBACK");
    return res.status(500).json({ error: { code: "INTERNAL_ERROR", message: "PIN send failed" } });
  } finally {
    client.release();
  }
});

deliveryProofRouter.post(
  "/:id/delivery-proof/pin/verify",
  requireAuth("app"),
  abuseProtection({ flow: "pin_verify", ipLimit: 25, userLimit: 10, windowMs: 60_000 }),
  async (req, res) => {
    const role = resolveActorRole(req);
    if (role !== "seller") {
      return res.status(403).json({ error: { code: "ROLE_NOT_ALLOWED", message: "Seller role required" } });
    }
    const parsed = VerifyPinSchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: { code: "VALIDATION_ERROR", details: parsed.error.flatten() } });
    }

    const orderId = String(req.params.id ?? "");
    if (!z.string().uuid().safeParse(orderId).success) {
      return res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "Invalid order id" } });
    }

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const rowResult = await client.query<{
        seller_id: string;
        pin_hash: string;
        pin_sent_at: string | null;
        verification_attempts: number;
        status: string;
      }>(
        `SELECT seller_id, pin_hash, pin_sent_at::text, verification_attempts, status
         FROM delivery_proof_records
         WHERE order_id = $1
         FOR UPDATE`,
        [orderId]
      );
      if ((rowResult.rowCount ?? 0) === 0) {
        await client.query("ROLLBACK");
        return res.status(404).json({ error: { code: "DELIVERY_PROOF_NOT_FOUND", message: "PIN not sent yet" } });
      }

      const row = rowResult.rows[0];
      if (row.seller_id !== req.auth!.userId) {
        await client.query("ROLLBACK");
        return res.status(403).json({ error: { code: "FORBIDDEN_ORDER_SCOPE", message: "Not seller of this order" } });
      }
      if (row.status === "verified") {
        await client.query("COMMIT");
        return res.json({ data: { orderId, status: "verified", idempotent: true } });
      }
      if (row.verification_attempts >= 5) {
        await client.query(
          "UPDATE delivery_proof_records SET status = 'failed', metadata_json = coalesce(metadata_json, '{}'::jsonb) || $2::jsonb WHERE order_id = $1",
          [orderId, JSON.stringify({ failure: "max_attempts" })]
        );
        await client.query("COMMIT");
        return res.status(429).json({ error: { code: "PIN_MAX_ATTEMPTS", message: "PIN verification attempts exceeded" } });
      }

      const sentAt = row.pin_sent_at ? new Date(row.pin_sent_at).getTime() : 0;
      if (!sentAt || Date.now() - sentAt > 10 * 60 * 1000) {
        await client.query(
          "UPDATE delivery_proof_records SET status = 'expired', verification_attempts = verification_attempts + 1 WHERE order_id = $1",
          [orderId]
        );
        await client.query("COMMIT");
        return res.status(410).json({ error: { code: "PIN_EXPIRED", message: "PIN expired" } });
      }

      const providedHash = sha256(parsed.data.pin);
      if (!safeEqualHex(providedHash, row.pin_hash)) {
        await client.query(
          "UPDATE delivery_proof_records SET verification_attempts = verification_attempts + 1 WHERE order_id = $1",
          [orderId]
        );
        await client.query("COMMIT");
        return res.status(401).json({ error: { code: "PIN_INVALID", message: "PIN invalid" } });
      }

      await client.query(
        `UPDATE delivery_proof_records
         SET status = 'verified', pin_verified_at = now(), verification_attempts = verification_attempts + 1
         WHERE order_id = $1`,
        [orderId]
      );
      await enqueueOutboxEvent(client, {
        eventType: "delivery_pin_verified",
        aggregateType: "order",
        aggregateId: orderId,
        payload: { orderId },
      });
      await client.query("COMMIT");
      return res.json({ data: { orderId, status: "verified" } });
    } catch {
      await client.query("ROLLBACK");
      return res.status(500).json({ error: { code: "INTERNAL_ERROR", message: "PIN verify failed" } });
    } finally {
      client.release();
    }
  }
);

deliveryProofRouter.get("/:id/delivery-proof", requireAuth("app"), async (req, res) => {
  const orderId = String(req.params.id ?? "");
  if (!z.string().uuid().safeParse(orderId).success) {
    return res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "Invalid order id" } });
  }

  const order = await pool.query<{ buyer_id: string; seller_id: string }>("SELECT buyer_id, seller_id FROM orders WHERE id = $1", [orderId]);
  if ((order.rowCount ?? 0) === 0) {
    return res.status(404).json({ error: { code: "ORDER_NOT_FOUND", message: "Order not found" } });
  }
  if (req.auth!.userId !== order.rows[0].buyer_id && req.auth!.userId !== order.rows[0].seller_id) {
    return res.status(403).json({ error: { code: "FORBIDDEN_ORDER_SCOPE", message: "No access to this order" } });
  }

  const proof = await pool.query(
    `SELECT order_id, proof_mode, pin_sent_at::text, pin_verified_at::text, verification_attempts, status, metadata_json, created_at::text
     FROM delivery_proof_records
     WHERE order_id = $1`,
    [orderId]
  );
  return res.json({ data: proof.rows[0] ?? null });
});

adminDeliveryProofRouter.post("/orders/:id/delivery-proof/override", requireAuth("admin"), async (req, res) => {
  const orderId = String(req.params.id ?? "");
  if (!z.string().uuid().safeParse(orderId).success) {
    return res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "Invalid order id" } });
  }
  const parsed = OverrideSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    return res.status(400).json({ error: { code: "VALIDATION_ERROR", details: parsed.error.flatten() } });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const order = await client.query<{ buyer_id: string; seller_id: string }>("SELECT buyer_id, seller_id FROM orders WHERE id = $1", [orderId]);
    if ((order.rowCount ?? 0) === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: { code: "ORDER_NOT_FOUND", message: "Order not found" } });
    }

    await client.query(
      `INSERT INTO delivery_proof_records
        (order_id, seller_id, buyer_id, proof_mode, pin_hash, pin_sent_at, pin_sent_channel, pin_verified_at, verification_attempts, status, metadata_json, created_at)
       VALUES ($1, $2, $3, 'pin', $4, now(), 'in_app', now(), 0, 'verified', $5, now())
       ON CONFLICT (order_id)
       DO UPDATE SET status = 'verified', pin_verified_at = now(), metadata_json = coalesce(delivery_proof_records.metadata_json, '{}'::jsonb) || $5::jsonb`,
      [orderId, order.rows[0].seller_id, order.rows[0].buyer_id, sha256(`admin-override-${Date.now()}`), JSON.stringify({ adminOverride: true, reason: parsed.data.reason })]
    );

    const admin = await client.query<{ email: string; role: string }>("SELECT email, role FROM admin_users WHERE id = $1", [req.auth!.userId]);
    await client.query(
      `INSERT INTO admin_audit_logs (actor_admin_id, actor_email, actor_role, action, entity_type, entity_id, before_json, after_json)
       VALUES ($1, $2, $3, 'delivery_proof_override', 'delivery_proof_records', $4, $5, $6)`,
      [
        req.auth!.userId,
        admin.rows[0]?.email ?? "unknown",
        admin.rows[0]?.role ?? "admin",
        orderId,
        null,
        JSON.stringify({ status: "verified", adminOverride: true, reason: parsed.data.reason }),
      ]
    );
    await enqueueOutboxEvent(client, {
      eventType: "delivery_pin_override",
      aggregateType: "order",
      aggregateId: orderId,
      payload: { orderId, reason: parsed.data.reason, adminUserId: req.auth!.userId },
    });

    await client.query("COMMIT");
    return res.json({ data: { orderId, status: "verified", override: true } });
  } catch {
    await client.query("ROLLBACK");
    return res.status(500).json({ error: { code: "INTERNAL_ERROR", message: "Override failed" } });
  } finally {
    client.release();
  }
});

function randomPin(): string {
  return String(Math.floor(100000 + Math.random() * 900000));
}

function sha256(value: string): string {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function safeEqualHex(a: string, b: string): boolean {
  const ab = Buffer.from(a, "hex");
  const bb = Buffer.from(b, "hex");
  return ab.length === bb.length && crypto.timingSafeEqual(ab, bb);
}

