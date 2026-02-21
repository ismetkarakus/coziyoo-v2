import crypto from "node:crypto";
import { env } from "../src/config/env.js";
import { pool } from "../src/db/client.js";

const baseUrl = process.env.BASE_URL ?? "http://localhost:3000";
const now = Date.now();

async function jsonRequest(path: string, init?: RequestInit) {
  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: {
      "content-type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
  const body = await response.json();
  return { status: response.status, body };
}

async function registerUser(data: { email: string; displayName: string; userType: "buyer" | "seller" | "both" }) {
  const result = await jsonRequest("/v1/auth/register", {
    method: "POST",
    body: JSON.stringify({
      email: data.email,
      password: "User12345!",
      displayName: data.displayName,
      userType: data.userType,
      countryCode: "TR",
      language: "tr",
    }),
  });
  if (result.status !== 201) throw new Error(`register failed ${data.email}: ${JSON.stringify(result.body)}`);
  return result.body.data as {
    user: { id: string };
    tokens: { accessToken: string };
  };
}

function signatureFor(payload: object): string {
  return crypto.createHmac("sha256", env.PAYMENT_WEBHOOK_SECRET).update(JSON.stringify(payload)).digest("hex");
}

async function main() {
  const seller = await registerUser({
    email: `sellerp${now}@coziyoo.test`,
    displayName: `sellerp${now}`,
    userType: "seller",
  });
  const buyer = await registerUser({
    email: `buyerp${now}@coziyoo.test`,
    displayName: `buyerp${now}`,
    userType: "buyer",
  });

  const category = await pool.query<{ id: string }>(
    "INSERT INTO categories (name_tr, name_en, sort_order, is_active) VALUES ('Tatli', 'Dessert', 1, TRUE) RETURNING id"
  );
  const food = await pool.query<{ id: string }>(
    `INSERT INTO foods (seller_id, category_id, name, price, is_active, is_available, current_stock)
     VALUES ($1, $2, 'Baklava', 200.00, TRUE, TRUE, 100)
     RETURNING id`,
    [seller.user.id, category.rows[0].id]
  );

  await pool.query(
    `INSERT INTO seller_compliance_profiles (seller_id, country_code, status, approved_at, updated_at)
     VALUES ($1, 'TR', 'approved', now(), now())`,
    [seller.user.id]
  );

  const createOrder = await jsonRequest("/v1/orders", {
    method: "POST",
    headers: { authorization: `Bearer ${buyer.tokens.accessToken}`, "Idempotency-Key": `order-create-${now}` },
    body: JSON.stringify({
      sellerId: seller.user.id,
      deliveryType: "delivery",
      items: [{ foodId: food.rows[0].id, quantity: 1 }],
    }),
  });
  if (createOrder.status !== 201) throw new Error(`order create failed: ${JSON.stringify(createOrder.body)}`);
  const orderId = createOrder.body.data.orderId as string;

  const approve = await jsonRequest(`/v1/orders/${orderId}/approve`, {
    method: "POST",
    headers: { authorization: `Bearer ${seller.tokens.accessToken}` },
    body: JSON.stringify({}),
  });
  if (approve.status !== 200) throw new Error(`approve failed: ${JSON.stringify(approve.body)}`);

  const paymentStart = await jsonRequest("/v1/payments/start", {
    method: "POST",
    headers: { authorization: `Bearer ${buyer.tokens.accessToken}`, "Idempotency-Key": `payment-start-${now}` },
    body: JSON.stringify({ orderId }),
  });
  if (paymentStart.status !== 201) throw new Error(`payment start failed: ${JSON.stringify(paymentStart.body)}`);
  const sessionId = paymentStart.body.data.sessionId as string;

  const ret = await jsonRequest(`/v1/payments/return?sessionId=${encodeURIComponent(sessionId)}&result=success`);
  if (ret.status !== 200) throw new Error(`payment return failed: ${JSON.stringify(ret.body)}`);

  const statusAfterReturn = await jsonRequest(`/v1/payments/${orderId}/status`, {
    method: "GET",
    headers: { authorization: `Bearer ${buyer.tokens.accessToken}` },
  });
  if (statusAfterReturn.status !== 200) throw new Error(`payment status failed: ${JSON.stringify(statusAfterReturn.body)}`);
  if (statusAfterReturn.body.data.orderStatus !== "awaiting_payment") {
    throw new Error(`order should still be awaiting_payment after return: ${JSON.stringify(statusAfterReturn.body)}`);
  }

  const webhookPayload = {
    sessionId,
    providerReferenceId: `ref-${now}`,
    result: "confirmed",
  };

  const invalidWebhook = await jsonRequest("/v1/payments/webhook", {
    method: "POST",
    headers: { "x-provider-signature": "bad-signature" },
    body: JSON.stringify(webhookPayload),
  });
  if (invalidWebhook.status !== 401) {
    throw new Error(`invalid signature must be rejected: ${JSON.stringify(invalidWebhook.body)}`);
  }

  const validWebhook = await jsonRequest("/v1/payments/webhook", {
    method: "POST",
    headers: { "x-provider-signature": signatureFor(webhookPayload) },
    body: JSON.stringify(webhookPayload),
  });
  if (validWebhook.status !== 200) throw new Error(`valid webhook failed: ${JSON.stringify(validWebhook.body)}`);

  const duplicateWebhook = await jsonRequest("/v1/payments/webhook", {
    method: "POST",
    headers: { "x-provider-signature": signatureFor(webhookPayload) },
    body: JSON.stringify(webhookPayload),
  });
  if (duplicateWebhook.status !== 200) throw new Error(`duplicate webhook failed: ${JSON.stringify(duplicateWebhook.body)}`);

  const finalStatus = await jsonRequest(`/v1/payments/${orderId}/status`, {
    method: "GET",
    headers: { authorization: `Bearer ${buyer.tokens.accessToken}` },
  });
  if (finalStatus.status !== 200) throw new Error(`final payment status failed: ${JSON.stringify(finalStatus.body)}`);
  if (finalStatus.body.data.orderStatus !== "paid" || finalStatus.body.data.paymentCompleted !== true) {
    throw new Error(`expected paid order after valid webhook: ${JSON.stringify(finalStatus.body)}`);
  }

  console.log("Payments smoke test passed", {
    orderId,
    sessionId,
    finalOrderStatus: finalStatus.body.data.orderStatus,
    duplicateWebhookIdempotent: duplicateWebhook.body.data.idempotent ?? false,
  });
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await pool.end();
  });
