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
      countryCode: "UK",
      language: "en",
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
    email: `sellerc${now}@coziyoo.test`,
    displayName: `sellerc${now}`,
    userType: "seller",
  });
  const buyer = await registerUser({
    email: `buyerc${now}@coziyoo.test`,
    displayName: `buyerc${now}`,
    userType: "buyer",
  });

  const adminLogin = await jsonRequest("/v1/admin/auth/login", {
    method: "POST",
    body: JSON.stringify({ email: "admin@coziyoo.local", password: "Admin12345!" }),
  });
  if (adminLogin.status !== 200) throw new Error(`admin login failed: ${JSON.stringify(adminLogin.body)}`);
  const adminToken = adminLogin.body.data.tokens.accessToken as string;

  const category = await pool.query<{ id: string }>(
    "INSERT INTO categories (name_tr, name_en, sort_order, is_active) VALUES ('Corba', 'Soup', 1, TRUE) RETURNING id"
  );
  const food = await pool.query<{ id: string }>(
    `INSERT INTO foods (seller_id, category_id, name, price, is_active, is_available, current_stock)
     VALUES ($1, $2, 'Mercimek Corbasi', 80.00, TRUE, TRUE, 50)
     RETURNING id`,
    [seller.user.id, category.rows[0].id]
  );
  const producedAt = new Date().toISOString();

  const createOrder = await jsonRequest("/v1/orders", {
    method: "POST",
    headers: { authorization: `Bearer ${buyer.tokens.accessToken}`, "Idempotency-Key": `order-create-${now}` },
    body: JSON.stringify({ sellerId: seller.user.id, deliveryType: "delivery", items: [{ foodId: food.rows[0].id, quantity: 1 }] }),
  });
  if (createOrder.status !== 201) throw new Error(`create order failed: ${JSON.stringify(createOrder.body)}`);
  const orderId = createOrder.body.data.orderId as string;

  const blockedApprove = await jsonRequest(`/v1/orders/${orderId}/approve`, {
    method: "POST",
    headers: { authorization: `Bearer ${seller.tokens.accessToken}` },
    body: JSON.stringify({}),
  });
  if (blockedApprove.status !== 403) {
    throw new Error(`seller must be blocked without compliance: ${JSON.stringify(blockedApprove.body)}`);
  }

  const profileUpdate = await jsonRequest("/v1/seller/compliance/profile", {
    method: "PUT",
    headers: { authorization: `Bearer ${seller.tokens.accessToken}` },
    body: JSON.stringify({
      countryCode: "UK",
      checks: [
        { checkCode: "id_verification", required: true, status: "verified", value: { id: "ok" } },
        { checkCode: "hygiene_doc", required: true, status: "verified", value: { score: "A" } },
      ],
    }),
  });
  if (profileUpdate.status !== 200) throw new Error(`profile update failed: ${JSON.stringify(profileUpdate.body)}`);

  const submit = await jsonRequest("/v1/seller/compliance/submit", {
    method: "POST",
    headers: { authorization: `Bearer ${seller.tokens.accessToken}` },
    body: JSON.stringify({}),
  });
  if (submit.status !== 200) throw new Error(`compliance submit failed: ${JSON.stringify(submit.body)}`);

  const approveCompliance = await jsonRequest(`/v1/admin/compliance/${seller.user.id}/approve`, {
    method: "POST",
    headers: { authorization: `Bearer ${adminToken}` },
    body: JSON.stringify({ reviewNotes: "All required checks verified." }),
  });
  if (approveCompliance.status !== 200) {
    throw new Error(`admin approve compliance failed: ${JSON.stringify(approveCompliance.body)}`);
  }

  const sellerApprove = await jsonRequest(`/v1/orders/${orderId}/approve`, {
    method: "POST",
    headers: { authorization: `Bearer ${seller.tokens.accessToken}` },
    body: JSON.stringify({}),
  });
  if (sellerApprove.status !== 200) throw new Error(`seller approve failed: ${JSON.stringify(sellerApprove.body)}`);

  const lotCreate = await jsonRequest("/v1/seller/lots", {
    method: "POST",
    headers: { authorization: `Bearer ${seller.tokens.accessToken}` },
    body: JSON.stringify({
      foodId: food.rows[0].id,
      producedAt,
      quantityProduced: 30,
      quantityAvailable: 30,
      notes: "Compliance smoke lot",
    }),
  });
  if (lotCreate.status !== 201) throw new Error(`lot create failed: ${JSON.stringify(lotCreate.body)}`);

  const paymentStart = await jsonRequest("/v1/payments/start", {
    method: "POST",
    headers: { authorization: `Bearer ${buyer.tokens.accessToken}`, "Idempotency-Key": `payment-start-${now}` },
    body: JSON.stringify({ orderId }),
  });
  if (paymentStart.status !== 201) throw new Error(`payment start failed: ${JSON.stringify(paymentStart.body)}`);
  const sessionId = paymentStart.body.data.sessionId as string;

  const webhookPayload = { sessionId, providerReferenceId: `cmp-${now}`, result: "confirmed" };
  const webhook = await jsonRequest("/v1/payments/webhook", {
    method: "POST",
    headers: { "x-provider-signature": signatureFor(webhookPayload) },
    body: JSON.stringify(webhookPayload),
  });
  if (webhook.status !== 200) throw new Error(`webhook failed: ${JSON.stringify(webhook.body)}`);

  for (const nextStatus of ["preparing", "ready", "in_delivery"] as const) {
    const step = await jsonRequest(`/v1/orders/${orderId}/status`, {
      method: "POST",
      headers: { authorization: `Bearer ${seller.tokens.accessToken}` },
      body: JSON.stringify({ toStatus: nextStatus }),
    });
    if (step.status !== 200) throw new Error(`status ${nextStatus} failed: ${JSON.stringify(step.body)}`);
  }

  const sendPin = await jsonRequest(`/v1/orders/${orderId}/delivery-proof/pin/send`, {
    method: "POST",
    headers: { authorization: `Bearer ${seller.tokens.accessToken}` },
    body: JSON.stringify({ testPin: "123456" }),
  });
  if (sendPin.status !== 201) throw new Error(`send pin failed: ${JSON.stringify(sendPin.body)}`);

  const verifyPin = await jsonRequest(`/v1/orders/${orderId}/delivery-proof/pin/verify`, {
    method: "POST",
    headers: { authorization: `Bearer ${seller.tokens.accessToken}` },
    body: JSON.stringify({ pin: "123456" }),
  });
  if (verifyPin.status !== 200) throw new Error(`verify pin failed: ${JSON.stringify(verifyPin.body)}`);

  const delivered = await jsonRequest(`/v1/orders/${orderId}/status`, {
    method: "POST",
    headers: { authorization: `Bearer ${seller.tokens.accessToken}` },
    body: JSON.stringify({ toStatus: "delivered" }),
  });
  if (delivered.status !== 200) throw new Error(`status delivered failed: ${JSON.stringify(delivered.body)}`);

  const completeWithoutDisclosure = await jsonRequest(`/v1/orders/${orderId}/status`, {
    method: "POST",
    headers: { authorization: `Bearer ${buyer.tokens.accessToken}` },
    body: JSON.stringify({ toStatus: "completed" }),
  });
  if (completeWithoutDisclosure.status !== 409) {
    throw new Error(`completed should fail without disclosures: ${JSON.stringify(completeWithoutDisclosure.body)}`);
  }

  const preOrderDisclosure = await jsonRequest(`/v1/orders/${orderId}/allergen-disclosure/pre-order`, {
    method: "POST",
    headers: { authorization: `Bearer ${buyer.tokens.accessToken}` },
    body: JSON.stringify({
      allergenSnapshot: { contains: ["gluten"] },
      disclosureMethod: "ui_ack",
      buyerConfirmation: "acknowledged",
      evidenceRef: "checkout_ack",
    }),
  });
  if (preOrderDisclosure.status !== 201) throw new Error(`pre_order disclosure failed: ${JSON.stringify(preOrderDisclosure.body)}`);

  const handoverDisclosure = await jsonRequest(`/v1/orders/${orderId}/allergen-disclosure/handover`, {
    method: "POST",
    headers: { authorization: `Bearer ${seller.tokens.accessToken}` },
    body: JSON.stringify({
      allergenSnapshot: { contains: ["gluten"] },
      disclosureMethod: "verbal",
      buyerConfirmation: "acknowledged",
      evidenceRef: "handover_note",
    }),
  });
  if (handoverDisclosure.status !== 201) throw new Error(`handover disclosure failed: ${JSON.stringify(handoverDisclosure.body)}`);

  const completed = await jsonRequest(`/v1/orders/${orderId}/status`, {
    method: "POST",
    headers: { authorization: `Bearer ${buyer.tokens.accessToken}` },
    body: JSON.stringify({ toStatus: "completed" }),
  });
  if (completed.status !== 200) throw new Error(`completed after disclosures failed: ${JSON.stringify(completed.body)}`);

  console.log("Compliance + allergen smoke test passed", {
    orderId,
    complianceStatus: approveCompliance.body.data.status,
    finalStatus: completed.body.data.toStatus,
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
