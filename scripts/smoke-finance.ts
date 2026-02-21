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
  const adminLogin = await jsonRequest("/v1/admin/auth/login", {
    method: "POST",
    body: JSON.stringify({ email: "admin@coziyoo.local", password: "Admin12345!" }),
  });
  if (adminLogin.status !== 200) throw new Error(`admin login failed: ${JSON.stringify(adminLogin.body)}`);
  const adminToken = adminLogin.body.data.tokens.accessToken as string;

  const commission = await jsonRequest("/v1/admin/commission-settings", {
    method: "POST",
    headers: { authorization: `Bearer ${adminToken}` },
    body: JSON.stringify({ commissionRate: 0.12 }),
  });
  if (commission.status !== 201) throw new Error(`commission create failed: ${JSON.stringify(commission.body)}`);

  const seller = await registerUser({
    email: `sellerf${now}@coziyoo.test`,
    displayName: `sellerf${now}`,
    userType: "seller",
  });
  const buyer = await registerUser({
    email: `buyerf${now}@coziyoo.test`,
    displayName: `buyerf${now}`,
    userType: "buyer",
  });

  await pool.query(
    `INSERT INTO seller_compliance_profiles (seller_id, country_code, status, approved_at, updated_at)
     VALUES ($1, 'TR', 'approved', now(), now())`,
    [seller.user.id]
  );

  const category = await pool.query<{ id: string }>(
    "INSERT INTO categories (name_tr, name_en, sort_order, is_active) VALUES ('Et', 'Meat', 1, TRUE) RETURNING id"
  );
  const food = await pool.query<{ id: string }>(
    `INSERT INTO foods (seller_id, category_id, name, price, is_active, is_available, current_stock)
     VALUES ($1, $2, 'Kofte', 150.00, TRUE, TRUE, 60)
     RETURNING id`,
    [seller.user.id, category.rows[0].id]
  );
  const producedAt = new Date().toISOString();

  const createOrder = await jsonRequest("/v1/orders", {
    method: "POST",
    headers: { authorization: `Bearer ${buyer.tokens.accessToken}`, "Idempotency-Key": `order-create-${now}` },
    body: JSON.stringify({
      sellerId: seller.user.id,
      deliveryType: "delivery",
      items: [{ foodId: food.rows[0].id, quantity: 2 }],
    }),
  });
  if (createOrder.status !== 201) throw new Error(`order create failed: ${JSON.stringify(createOrder.body)}`);
  const orderId = createOrder.body.data.orderId as string;
  const total = createOrder.body.data.totalPrice as number;

  const approve = await jsonRequest(`/v1/orders/${orderId}/approve`, {
    method: "POST",
    headers: { authorization: `Bearer ${seller.tokens.accessToken}` },
    body: JSON.stringify({}),
  });
  if (approve.status !== 200) throw new Error(`approve failed: ${JSON.stringify(approve.body)}`);

  const lotCreate = await jsonRequest("/v1/seller/lots", {
    method: "POST",
    headers: { authorization: `Bearer ${seller.tokens.accessToken}` },
    body: JSON.stringify({
      foodId: food.rows[0].id,
      producedAt,
      quantityProduced: 50,
      quantityAvailable: 50,
      notes: "Finance smoke lot",
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

  const webhookPayload = { sessionId, providerReferenceId: `fin-${now}`, result: "confirmed" };
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

  await jsonRequest(`/v1/orders/${orderId}/allergen-disclosure/pre-order`, {
    method: "POST",
    headers: { authorization: `Bearer ${buyer.tokens.accessToken}` },
    body: JSON.stringify({
      allergenSnapshot: { contains: ["egg"] },
      disclosureMethod: "ui_ack",
      buyerConfirmation: "acknowledged",
    }),
  });
  await jsonRequest(`/v1/orders/${orderId}/allergen-disclosure/handover`, {
    method: "POST",
    headers: { authorization: `Bearer ${seller.tokens.accessToken}` },
    body: JSON.stringify({
      allergenSnapshot: { contains: ["egg"] },
      disclosureMethod: "verbal",
      buyerConfirmation: "acknowledged",
    }),
  });

  const complete = await jsonRequest(`/v1/orders/${orderId}/status`, {
    method: "POST",
    headers: { authorization: `Bearer ${buyer.tokens.accessToken}` },
    body: JSON.stringify({ toStatus: "completed" }),
  });
  if (complete.status !== 200) throw new Error(`complete failed: ${JSON.stringify(complete.body)}`);

  const sellerSummary = await jsonRequest(`/v1/sellers/${seller.user.id}/finance/summary`, {
    method: "GET",
    headers: { authorization: `Bearer ${seller.tokens.accessToken}` },
  });
  if (sellerSummary.status !== 200) throw new Error(`seller summary failed: ${JSON.stringify(sellerSummary.body)}`);

  const sellerOrders = await jsonRequest(`/v1/sellers/${seller.user.id}/finance/orders`, {
    method: "GET",
    headers: { authorization: `Bearer ${seller.tokens.accessToken}` },
  });
  if (sellerOrders.status !== 200 || sellerOrders.body.data.length < 1) {
    throw new Error(`seller finance orders failed: ${JSON.stringify(sellerOrders.body)}`);
  }

  const financeRow = sellerOrders.body.data[0];
  if (Math.abs(financeRow.commissionRateSnapshot - 0.12) > 0.0001) {
    throw new Error(`commission snapshot mismatch: ${JSON.stringify(financeRow)}`);
  }

  const refundRequest = await jsonRequest(`/v1/orders/${orderId}/refund-request`, {
    method: "POST",
    headers: { authorization: `Bearer ${buyer.tokens.accessToken}`, "Idempotency-Key": `refund-${now}` },
    body: JSON.stringify({ reasonCode: "order_issue", reason: "Quality issue" }),
  });
  if (refundRequest.status !== 201) throw new Error(`refund request failed: ${JSON.stringify(refundRequest.body)}`);
  const disputeId = refundRequest.body.data.disputeId as string;

  const orderDisputes = await jsonRequest(`/v1/orders/${orderId}/disputes`, {
    method: "GET",
    headers: { authorization: `Bearer ${buyer.tokens.accessToken}` },
  });
  if (orderDisputes.status !== 200 || orderDisputes.body.data.length < 1) {
    throw new Error(`order disputes failed: ${JSON.stringify(orderDisputes.body)}`);
  }

  const adminDisputes = await jsonRequest("/v1/admin/disputes", {
    method: "GET",
    headers: { authorization: `Bearer ${adminToken}` },
  });
  if (adminDisputes.status !== 200 || adminDisputes.body.data.length < 1) {
    throw new Error(`admin disputes list failed: ${JSON.stringify(adminDisputes.body)}`);
  }

  const resolve = await jsonRequest(`/v1/admin/disputes/${disputeId}/resolve`, {
    method: "POST",
    headers: { authorization: `Bearer ${adminToken}` },
    body: JSON.stringify({ status: "lost", liabilityParty: "shared", liabilityRatio: { seller: 0.5, platform: 0.5 } }),
  });
  if (resolve.status !== 200) throw new Error(`resolve dispute failed: ${JSON.stringify(resolve.body)}`);

  const sellerReportCreate = await jsonRequest(`/v1/sellers/${seller.user.id}/finance/reports`, {
    method: "POST",
    headers: { authorization: `Bearer ${seller.tokens.accessToken}` },
    body: JSON.stringify({ reportType: "payout_summary", periodStart: "2026-01-01", periodEnd: "2026-12-31" }),
  });
  if (sellerReportCreate.status !== 201) throw new Error(`seller report create failed: ${JSON.stringify(sellerReportCreate.body)}`);

  const sellerReports = await jsonRequest(`/v1/sellers/${seller.user.id}/finance/reports`, {
    method: "GET",
    headers: { authorization: `Bearer ${seller.tokens.accessToken}` },
  });
  if (sellerReports.status !== 200 || sellerReports.body.data.length < 1) {
    throw new Error(`seller reports list failed: ${JSON.stringify(sellerReports.body)}`);
  }

  const adminReportCreate = await jsonRequest("/v1/admin/finance/reports", {
    method: "POST",
    headers: { authorization: `Bearer ${adminToken}` },
    body: JSON.stringify({ reportType: "refund_chargeback", periodStart: "2026-01-01", periodEnd: "2026-12-31" }),
  });
  if (adminReportCreate.status !== 201) throw new Error(`admin report create failed: ${JSON.stringify(adminReportCreate.body)}`);

  const adminReports = await jsonRequest("/v1/admin/finance/reports", {
    method: "GET",
    headers: { authorization: `Bearer ${adminToken}` },
  });
  if (adminReports.status !== 200 || adminReports.body.data.length < 1) {
    throw new Error(`admin reports list failed: ${JSON.stringify(adminReports.body)}`);
  }

  console.log("Finance smoke test passed", {
    orderId,
    total,
    commissionSnapshot: financeRow.commissionRateSnapshot,
    disputeResolved: resolve.body.data.status,
    sellerReports: sellerReports.body.data.length,
    adminReports: adminReports.body.data.length,
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
