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

    if (!["pending_seller_approval", "seller_approved", "awaiting_payment"].includes(order.status)) {
      await client.query("ROLLBACK");
      return res.status(409).json({
        error: { code: "ORDER_INVALID_STATE", message: `Bu siparis durumunda odeme baslatilamaz: ${order.status}` },
      });
    }

    await client.query(
      `INSERT INTO order_events (order_id, actor_user_id, event_type, from_status, to_status, payload_json)
       VALUES ($1, $2, 'payment_start', $3, $4, $5)`,
      [
        order.id,
        req.auth!.userId,
        order.status,
        order.status,
        JSON.stringify({
          provider: env.PAYMENT_PROVIDER_NAME,
        }),
      ]
    );

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
        checkoutUrl: env.PAYMENT_PROVIDER_NAME === "mockpay"
          ? `${req.protocol}://${req.get("host")}/v1/payments/mock-checkout?sessionId=${encodeURIComponent(sessionId)}`
          : `${env.PAYMENT_CHECKOUT_BASE_URL}?sessionId=${encodeURIComponent(sessionId)}`,
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
    if (!["pending_seller_approval", "seller_approved", "awaiting_payment"].includes(orderStatus)) {
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
        error: { code: "ORDER_INVALID_STATE", message: `Order cannot accept payment confirmation in state ${orderStatus}` },
      });
    }

    const nextOrderStatus = env.PAYMENT_PROVIDER_NAME === "mockpay" ? "paid" : "preparing";

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

    await client.query("UPDATE orders SET status = $2, payment_completed = TRUE, updated_at = now() WHERE id = $1", [
      payment.order_id,
      nextOrderStatus,
    ]);
    await client.query(
      `INSERT INTO order_events (order_id, actor_user_id, event_type, from_status, to_status, payload_json)
       VALUES ($1, NULL, 'payment_confirmed', $2, $3, $4)`,
      [
        payment.order_id,
        orderStatus,
        nextOrderStatus,
        JSON.stringify({ providerReferenceId: payload.providerReferenceId }),
      ]
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

/* ------------------------------------------------------------------ */
/*  Mock Checkout Page (development only)                              */
/* ------------------------------------------------------------------ */

/* ------------------------------------------------------------------ */
/*  Mock Process — server-side HMAC so WebView doesn't need crypto     */
/* ------------------------------------------------------------------ */

paymentsRouter.post("/mock-process", async (req, res) => {
  if (env.PAYMENT_PROVIDER_NAME !== "mockpay") {
    return res.status(403).json({ error: { code: "NOT_ALLOWED", message: "mock-process only available in mockpay mode" } });
  }
  const sessionId = String(req.body?.sessionId ?? "");
  const result = String(req.body?.result ?? "");
  if (!sessionId || !["success", "failed"].includes(result)) {
    return res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "sessionId and result required" } });
  }

  const providerReferenceId = "MOCK-" + Date.now() + "-" + Math.random().toString(36).slice(2, 8);
  const body = JSON.stringify({
    sessionId,
    providerReferenceId,
    result: result === "success" ? "confirmed" : "failed",
  });
  const signature = crypto.createHmac("sha256", env.PAYMENT_WEBHOOK_SECRET).update(body).digest("hex");

  const baseUrl = `${req.protocol}://${req.get("host")}`;
  const webhookRes = await fetch(`${baseUrl}/v1/payments/webhook`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "x-provider-signature": signature },
    body,
  });
  const json = await webhookRes.json().catch(() => ({}));
  if (!webhookRes.ok) {
    return res.status(webhookRes.status).json(json);
  }
  return res.json({ data: { ok: true, result } });
});

paymentsRouter.get("/mock-checkout", async (req, res) => {
  const sessionId = String(req.query.sessionId ?? "");
  if (!sessionId) {
    return res.status(400).send("sessionId query param required");
  }

  const result = await pool.query<{
    order_id: string;
    status: string;
    total_price: string;
    buyer_name: string;
  }>(
    `SELECT pa.order_id, pa.status, o.total_price::text,
            COALESCE(u.display_name, u.email, 'Alici') AS buyer_name
     FROM payment_attempts pa
     JOIN orders o ON o.id = pa.order_id
     JOIN users u ON u.id = pa.buyer_id
     WHERE pa.provider_session_id = $1`,
    [sessionId],
  );

  if ((result.rowCount ?? 0) === 0) {
    return res.status(404).send("Payment session not found");
  }

  const row = result.rows[0];
  const amount = Number(row.total_price).toFixed(2);
  const apiBase = `${req.protocol}://${req.get("host")}`;

  res.setHeader("content-type", "text/html; charset=utf-8");
  return res.send(`<!doctype html>
<html lang="tr">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>Odeme - Coziyoo</title>
  <style>
    :root {
      --bg: #F5F1EB;
      --card: #FFFDF9;
      --primary: #4A7C59;
      --text: #3D3229;
      --muted: #A89B8C;
      --border: #EDE8E0;
      --error: #DC3545;
      --success: #28a745;
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
      background: var(--bg);
      color: var(--text);
      min-height: 100vh;
      display: flex;
      flex-direction: column;
      align-items: center;
      padding: 24px 16px;
    }
    .card {
      background: var(--card);
      border: 1px solid var(--border);
      border-radius: 16px;
      padding: 28px 24px;
      width: 100%;
      max-width: 400px;
      box-shadow: 0 4px 24px rgba(0,0,0,0.06);
    }
    .logo {
      text-align: center;
      font-size: 28px;
      font-weight: 700;
      color: var(--primary);
      margin-bottom: 24px;
    }
    .amount {
      text-align: center;
      font-size: 36px;
      font-weight: 800;
      margin: 16px 0 8px;
    }
    .label {
      text-align: center;
      color: var(--muted);
      font-size: 14px;
      margin-bottom: 24px;
    }
    .field {
      margin-bottom: 16px;
    }
    .field label {
      display: block;
      font-size: 13px;
      color: var(--muted);
      margin-bottom: 6px;
      font-weight: 600;
    }
    .field input {
      width: 100%;
      padding: 12px 14px;
      border: 1px solid var(--border);
      border-radius: 10px;
      font-size: 16px;
      background: var(--bg);
      color: var(--text);
      outline: none;
    }
    .field input:focus {
      border-color: var(--primary);
    }
    .row {
      display: flex;
      gap: 12px;
    }
    .row .field { flex: 1; }
    .btn {
      width: 100%;
      padding: 14px;
      border: none;
      border-radius: 12px;
      font-size: 17px;
      font-weight: 700;
      cursor: pointer;
      margin-top: 8px;
      transition: opacity 0.2s;
    }
    .btn:active { opacity: 0.8; }
    .btn-pay {
      background: var(--primary);
      color: #fff;
    }
    .btn-fail {
      background: var(--border);
      color: var(--muted);
      margin-top: 10px;
      font-size: 14px;
    }
    .btn:disabled {
      opacity: 0.5;
      cursor: not-allowed;
    }
    .status-msg {
      text-align: center;
      margin-top: 16px;
      font-weight: 600;
      font-size: 15px;
      min-height: 24px;
    }
    .status-ok { color: var(--success); }
    .status-err { color: var(--error); }
    .info {
      text-align: center;
      color: var(--muted);
      font-size: 12px;
      margin-top: 20px;
    }
  </style>
</head>
<body>
  <div class="card">
    <div class="logo">Coziyoo</div>
    <div class="amount">₺${amount}</div>
    <div class="label">${row.buyer_name} &middot; Siparis #${row.order_id.slice(0, 8)}</div>

    <div class="field">
      <label>Kart Numarasi</label>
      <input type="text" value="4242 4242 4242 4242" maxlength="19" inputmode="numeric" />
    </div>
    <div class="row">
      <div class="field">
        <label>Son Kullanma</label>
        <input type="text" value="12/28" maxlength="5" />
      </div>
      <div class="field">
        <label>CVV</label>
        <input type="text" value="123" maxlength="4" inputmode="numeric" />
      </div>
    </div>

    <button class="btn btn-pay" id="payBtn" onclick="processPayment('success')">
      ₺${amount} Ode
    </button>
    <button class="btn btn-fail" id="failBtn" onclick="processPayment('failed')">
      Odemeyi Basarisiz Yap (Test)
    </button>

    <div class="status-msg" id="statusMsg"></div>
    <div class="info">Mock odeme sayfasi &mdash; gercek kart bilgisi islenmez</div>
  </div>

  <script>
    const SESSION_ID = ${JSON.stringify(sessionId)};
    const API_BASE = ${JSON.stringify(apiBase)};

    async function processPayment(result) {
      const payBtn = document.getElementById('payBtn');
      const failBtn = document.getElementById('failBtn');
      const msg = document.getElementById('statusMsg');
      payBtn.disabled = true;
      failBtn.disabled = true;
      msg.textContent = 'Isleniyor...';
      msg.className = 'status-msg';

      try {
        const res = await fetch(API_BASE + '/v1/payments/mock-process', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sessionId: SESSION_ID, result: result }),
        });

        const json = await res.json();

        if (res.ok && result === 'success') {
          msg.textContent = 'Odeme basarili! Yonlendiriliyorsunuz...';
          msg.className = 'status-msg status-ok';
          setTimeout(() => {
            window.location.href = API_BASE + '/v1/payments/return?sessionId=' + encodeURIComponent(SESSION_ID) + '&result=success';
          }, 1500);
        } else if (res.ok) {
          msg.textContent = 'Odeme basarisiz olarak islendi.';
          msg.className = 'status-msg status-err';
          setTimeout(() => {
            window.location.href = API_BASE + '/v1/payments/return?sessionId=' + encodeURIComponent(SESSION_ID) + '&result=failed';
          }, 1500);
        } else {
          msg.textContent = json?.error?.message ?? 'Bir hata olustu';
          msg.className = 'status-msg status-err';
          payBtn.disabled = false;
          failBtn.disabled = false;
        }
      } catch (err) {
        msg.textContent = 'Baglanti hatasi: ' + err.message;
        msg.className = 'status-msg status-err';
        payBtn.disabled = false;
        failBtn.disabled = false;
      }
    }
  </script>
</body>
</html>`);
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
