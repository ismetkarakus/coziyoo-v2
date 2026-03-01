import crypto from "node:crypto";
import { Router } from "express";
import { z } from "zod";
import { env } from "../config/env.js";
import { pool } from "../db/client.js";
import { abuseProtection } from "../middleware/abuse-protection.js";
import { resolveActorRole } from "../middleware/app-role.js";
import { requireAuth } from "../middleware/auth.js";
import { requireIdempotency } from "../middleware/idempotency.js";
import { enqueueOutboxEvent } from "../services/outbox.js";

const StartSchema = z.object({
  orderId: z.string().uuid(),
});

const ReturnQuerySchema = z.object({
  sessionId: z.string().min(10),
  result: z.enum(["success", "failed"]).default("success"),
});

const WebhookSchema = z.object({
  sessionId: z.string().min(10),
  providerReferenceId: z.string().min(4),
  result: z.enum(["confirmed", "failed"]),
});

export const paymentsRouter = Router();

paymentsRouter.post(
  "/start",
  requireAuth("app"),
  abuseProtection({ flow: "payment_start", ipLimit: 25, userLimit: 15, windowMs: 60_000 }),
  requireIdempotency({ scope: "payment_start" }),
  async (req, res) => {
  const actorRole = resolveActorRole(req);
  if (actorRole !== "buyer") {
    return res.status(403).json({ error: { code: "ROLE_NOT_ALLOWED", message: "Payment start requires buyer role" } });
  }

  const parsed = StartSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: { code: "VALIDATION_ERROR", details: parsed.error.flatten() } });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const orderResult = await client.query<{
      id: string;
      buyer_id: string;
      status: string;
      total_price: string;
    }>("SELECT id, buyer_id, status, total_price::text FROM orders WHERE id = $1 FOR UPDATE", [parsed.data.orderId]);

    if ((orderResult.rowCount ?? 0) === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: { code: "ORDER_NOT_FOUND", message: "Order not found" } });
    }
    const order = orderResult.rows[0];
    if (order.buyer_id !== req.auth!.userId) {
      await client.query("ROLLBACK");
      return res.status(403).json({ error: { code: "FORBIDDEN_ORDER_SCOPE", message: "Not buyer of this order" } });
    }

    if (!["seller_approved", "awaiting_payment"].includes(order.status)) {
      await client.query("ROLLBACK");
      return res.status(409).json({
        error: { code: "ORDER_INVALID_STATE", message: `Payment start not allowed for status ${order.status}` },
      });
    }

    if (order.status === "seller_approved") {
      await client.query("UPDATE orders SET status = 'awaiting_payment', updated_at = now() WHERE id = $1", [order.id]);
      await client.query(
        `INSERT INTO order_events (order_id, actor_user_id, event_type, from_status, to_status, payload_json)
         VALUES ($1, $2, 'payment_start', 'seller_approved', 'awaiting_payment', $3)`,
        [order.id, req.auth!.userId, JSON.stringify({ provider: env.PAYMENT_PROVIDER_NAME })]
      );
    }

    const sessionId = crypto.randomUUID();
    await client.query(
      `INSERT INTO payment_attempts (
        order_id, buyer_id, provider, provider_session_id, status, created_at, updated_at
      ) VALUES ($1, $2, $3, $4, 'initiated', now(), now())`,
      [order.id, req.auth!.userId, env.PAYMENT_PROVIDER_NAME, sessionId]
    );

    await enqueueOutboxEvent(client, {
      eventType: "payment_session_started",
      aggregateType: "payment_attempt",
      aggregateId: sessionId,
      payload: { orderId: order.id, buyerId: req.auth!.userId, provider: env.PAYMENT_PROVIDER_NAME },
    });

    await client.query("COMMIT");

    return res.status(201).json({
      data: {
        orderId: order.id,
        amount: Number(order.total_price),
        provider: env.PAYMENT_PROVIDER_NAME,
        sessionId,
        checkoutUrl: `${env.PAYMENT_CHECKOUT_BASE_URL}?sessionId=${encodeURIComponent(sessionId)}`,
      },
    });
  } catch (error) {
    await client.query("ROLLBACK");
    const err = error as { code?: string };
    if (err.code === "23505") {
      return res.status(409).json({
        error: { code: "PAYMENT_SESSION_CONFLICT", message: "Payment session conflict, retry start" },
      });
    }
    return res.status(500).json({ error: { code: "INTERNAL_ERROR", message: "Payment start failed" } });
  } finally {
    client.release();
  }
  }
);

paymentsRouter.get("/return", async (req, res) => {
  const parsed = ReturnQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    return res.status(400).json({ error: { code: "VALIDATION_ERROR", details: parsed.error.flatten() } });
  }

  const status = parsed.data.result === "success" ? "returned_success" : "returned_failed";
  await pool.query(
    `UPDATE payment_attempts
     SET status = CASE
       WHEN status = 'confirmed' THEN status
       ELSE $1
     END,
     callback_payload_json = coalesce(callback_payload_json, '{}'::jsonb) || $2::jsonb,
     updated_at = now()
     WHERE provider_session_id = $3`,
    [status, JSON.stringify({ returnQuery: parsed.data, receivedAt: new Date().toISOString() }), parsed.data.sessionId]
  );

  return res.json({
    data: {
      sessionId: parsed.data.sessionId,
      returnResult: parsed.data.result,
      note: "Return endpoint is informational only. Order is marked paid only after verified webhook.",
    },
  });
});

paymentsRouter.post("/webhook", async (req, res) => {
  const signature = String(req.headers["x-provider-signature"] ?? "");
  const expected = crypto.createHmac("sha256", env.PAYMENT_WEBHOOK_SECRET).update(req.rawBody ?? "").digest("hex");

  const parsed = WebhookSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: { code: "VALIDATION_ERROR", details: parsed.error.flatten() } });
  }

  const payload = parsed.data;
  const signatureBuffer = Buffer.from(signature, "utf8");
  const expectedBuffer = Buffer.from(expected, "utf8");
  const signatureValid =
    signature.length > 0 &&
    signatureBuffer.length === expectedBuffer.length &&
    crypto.timingSafeEqual(signatureBuffer, expectedBuffer);

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const paymentResult = await client.query<{
      id: string;
      order_id: string;
      status: string;
      provider_reference_id: string | null;
    }>(
      `SELECT id, order_id, status, provider_reference_id
       FROM payment_attempts
       WHERE provider_session_id = $1
       FOR UPDATE`,
      [payload.sessionId]
    );

    if ((paymentResult.rowCount ?? 0) === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: { code: "PAYMENT_ATTEMPT_NOT_FOUND", message: "Unknown payment session" } });
    }
    const payment = paymentResult.rows[0];

    const mergedPayload = JSON.stringify({ webhook: payload, receivedAt: new Date().toISOString() });
    if (!signatureValid) {
      await client.query(
        `UPDATE payment_attempts
         SET signature_valid = FALSE,
             status = CASE WHEN status = 'confirmed' THEN status ELSE 'confirmation_failed' END,
             callback_payload_json = coalesce(callback_payload_json, '{}'::jsonb) || $2::jsonb,
             updated_at = now()
         WHERE id = $1`,
        [payment.id, mergedPayload]
      );
      await client.query("COMMIT");
      return res.status(401).json({ error: { code: "WEBHOOK_SIGNATURE_INVALID", message: "Invalid signature" } });
    }

    if (payment.status === "confirmed") {
      await client.query(
        `UPDATE payment_attempts
         SET signature_valid = TRUE,
             callback_payload_json = coalesce(callback_payload_json, '{}'::jsonb) || $2::jsonb,
             updated_at = now()
         WHERE id = $1`,
        [payment.id, mergedPayload]
      );
      await client.query("COMMIT");
      return res.json({ data: { accepted: true, idempotent: true } });
    }

    if (payload.result === "failed") {
      await client.query(
        `UPDATE payment_attempts
         SET signature_valid = TRUE,
             provider_reference_id = $2,
             status = 'confirmation_failed',
             callback_payload_json = coalesce(callback_payload_json, '{}'::jsonb) || $3::jsonb,
             updated_at = now()
         WHERE id = $1`,
        [payment.id, payload.providerReferenceId, mergedPayload]
      );
      await client.query("COMMIT");
      return res.json({ data: { accepted: true, paid: false } });
    }

    const orderResult = await client.query<{ status: string }>("SELECT status FROM orders WHERE id = $1 FOR UPDATE", [payment.order_id]);
    if ((orderResult.rowCount ?? 0) === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: { code: "ORDER_NOT_FOUND", message: "Order not found for payment attempt" } });
    }
    const orderStatus = orderResult.rows[0].status;
    if (orderStatus !== "awaiting_payment") {
      await client.query(
        `UPDATE payment_attempts
         SET signature_valid = TRUE,
             provider_reference_id = $2,
             status = 'confirmation_failed',
             callback_payload_json = coalesce(callback_payload_json, '{}'::jsonb) || $3::jsonb,
             updated_at = now()
         WHERE id = $1`,
        [payment.id, payload.providerReferenceId, mergedPayload]
      );
      await client.query("COMMIT");
      return res.status(409).json({
        error: { code: "ORDER_INVALID_STATE", message: `Order must be awaiting_payment, got ${orderStatus}` },
      });
    }

    await client.query(
      `UPDATE payment_attempts
       SET signature_valid = TRUE,
           provider_reference_id = $2,
           status = 'confirmed',
           callback_payload_json = coalesce(callback_payload_json, '{}'::jsonb) || $3::jsonb,
           updated_at = now()
       WHERE id = $1`,
      [payment.id, payload.providerReferenceId, mergedPayload]
    );

    await client.query("UPDATE orders SET status = 'paid', payment_completed = TRUE, updated_at = now() WHERE id = $1", [
      payment.order_id,
    ]);
    await client.query(
      `INSERT INTO order_events (order_id, actor_user_id, event_type, from_status, to_status, payload_json)
       VALUES ($1, NULL, 'payment_confirmed', 'awaiting_payment', 'paid', $2)`,
      [payment.order_id, JSON.stringify({ providerReferenceId: payload.providerReferenceId })]
    );
    await enqueueOutboxEvent(client, {
      eventType: "payment_confirmed",
      aggregateType: "order",
      aggregateId: payment.order_id,
      payload: { orderId: payment.order_id, providerReferenceId: payload.providerReferenceId },
    });

    await client.query("COMMIT");
    return res.json({ data: { accepted: true, paid: true } });
  } catch {
    await client.query("ROLLBACK");
    return res.status(500).json({ error: { code: "INTERNAL_ERROR", message: "Webhook processing failed" } });
  } finally {
    client.release();
  }
});

paymentsRouter.get("/:orderId/status", requireAuth("app"), async (req, res) => {
  const orderId = String(req.params.orderId ?? "");
  if (!z.string().uuid().safeParse(orderId).success) {
    return res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "Invalid orderId" } });
  }

  const orderResult = await pool.query<{
    id: string;
    buyer_id: string;
    seller_id: string;
    status: string;
    payment_completed: boolean;
  }>("SELECT id, buyer_id, seller_id, status, payment_completed FROM orders WHERE id = $1", [orderId]);
  if ((orderResult.rowCount ?? 0) === 0) {
    return res.status(404).json({ error: { code: "ORDER_NOT_FOUND", message: "Order not found" } });
  }
  const order = orderResult.rows[0];
  if (order.buyer_id !== req.auth!.userId && order.seller_id !== req.auth!.userId) {
    return res.status(403).json({ error: { code: "FORBIDDEN_ORDER_SCOPE", message: "No access to this order" } });
  }

  const paymentResult = await pool.query<{
    id: string;
    provider: string;
    provider_session_id: string | null;
    provider_reference_id: string | null;
    status: string;
    signature_valid: boolean | null;
    updated_at: string;
  }>(
    `SELECT id, provider, provider_session_id, provider_reference_id, status, signature_valid, updated_at::text
     FROM payment_attempts
     WHERE order_id = $1
     ORDER BY created_at DESC
     LIMIT 1`,
    [orderId]
  );

  return res.json({
    data: {
      orderId: order.id,
      orderStatus: order.status,
      paymentCompleted: order.payment_completed,
      latestAttempt: paymentResult.rows[0] ?? null,
    },
  });
});
