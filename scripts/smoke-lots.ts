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
  return result.body.data as { user: { id: string }; tokens: { accessToken: string } };
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

  const seller = await registerUser({
    email: `sellerlot${now}@coziyoo.test`,
    displayName: `sellerlot${now}`,
    userType: "seller",
  });
  const buyer = await registerUser({
    email: `buyerlot${now}@coziyoo.test`,
    displayName: `buyerlot${now}`,
    userType: "buyer",
  });

  await pool.query(
    `INSERT INTO seller_compliance_profiles (seller_id, country_code, status, approved_at, updated_at)
     VALUES ($1, 'TR', 'approved', now(), now())`,
    [seller.user.id]
  );

  const category = await pool.query<{ id: string }>(
    "INSERT INTO categories (name_tr, name_en, sort_order, is_active) VALUES ('Sebze', 'Vegetable', 1, TRUE) RETURNING id"
  );
  const food = await pool.query<{ id: string }>(
    `INSERT INTO foods (seller_id, category_id, name, price, is_active, is_available, current_stock)
     VALUES ($1, $2, 'Biber Dolma', 90.00, TRUE, TRUE, 0)
     RETURNING id`,
    [seller.user.id, category.rows[0].id]
  );

  const lotCreate = await jsonRequest("/v1/seller/lots", {
    method: "POST",
    headers: { authorization: `Bearer ${seller.tokens.accessToken}` },
    body: JSON.stringify({
      foodId: food.rows[0].id,
      producedAt: new Date().toISOString(),
      quantityProduced: 20,
      quantityAvailable: 20,
      notes: "Initial lot",
    }),
  });
  if (lotCreate.status !== 201) throw new Error(`lot create failed: ${JSON.stringify(lotCreate.body)}`);
  const lotId = lotCreate.body.data.lotId as string;

  const lotAdjust = await jsonRequest(`/v1/seller/lots/${lotId}/adjust`, {
    method: "POST",
    headers: { authorization: `Bearer ${seller.tokens.accessToken}` },
    body: JSON.stringify({ quantityAvailable: 18, notes: "Stock recount" }),
  });
  if (lotAdjust.status !== 200) throw new Error(`lot adjust failed: ${JSON.stringify(lotAdjust.body)}`);

  const createOrder = await jsonRequest("/v1/orders", {
    method: "POST",
    headers: { authorization: `Bearer ${buyer.tokens.accessToken}`, "Idempotency-Key": `order-create-lot-${now}` },
    body: JSON.stringify({
      sellerId: seller.user.id,
      deliveryType: "pickup",
      items: [{ foodId: food.rows[0].id, quantity: 3 }],
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
    headers: { authorization: `Bearer ${buyer.tokens.accessToken}`, "Idempotency-Key": `payment-start-lot-${now}` },
    body: JSON.stringify({ orderId }),
  });
  if (paymentStart.status !== 201) throw new Error(`payment start failed: ${JSON.stringify(paymentStart.body)}`);
  const sessionId = paymentStart.body.data.sessionId as string;

  const webhookPayload = { sessionId, providerReferenceId: `lot-${now}`, result: "confirmed" };
  const webhook = await jsonRequest("/v1/payments/webhook", {
    method: "POST",
    headers: { "x-provider-signature": signatureFor(webhookPayload) },
    body: JSON.stringify(webhookPayload),
  });
  if (webhook.status !== 200) throw new Error(`webhook failed: ${JSON.stringify(webhook.body)}`);

  const preparing = await jsonRequest(`/v1/orders/${orderId}/status`, {
    method: "POST",
    headers: { authorization: `Bearer ${seller.tokens.accessToken}` },
    body: JSON.stringify({ toStatus: "preparing" }),
  });
  if (preparing.status !== 200) throw new Error(`preparing failed: ${JSON.stringify(preparing.body)}`);

  const adminLotOrders = await jsonRequest(`/v1/admin/lots/${lotId}/orders`, {
    method: "GET",
    headers: { authorization: `Bearer ${adminToken}` },
  });
  if (adminLotOrders.status !== 200 || adminLotOrders.body.data.length < 1) {
    throw new Error(`admin lot orders failed: ${JSON.stringify(adminLotOrders.body)}`);
  }

  const recall = await jsonRequest(`/v1/seller/lots/${lotId}/recall`, {
    method: "POST",
    headers: { authorization: `Bearer ${seller.tokens.accessToken}` },
    body: JSON.stringify({ reason: "quality control issue" }),
  });
  if (recall.status !== 200) throw new Error(`lot recall failed: ${JSON.stringify(recall.body)}`);

  const sellerLots = await jsonRequest(`/v1/seller/lots?foodId=${food.rows[0].id}`, {
    method: "GET",
    headers: { authorization: `Bearer ${seller.tokens.accessToken}` },
  });
  if (sellerLots.status !== 200 || sellerLots.body.data[0]?.status !== "recalled") {
    throw new Error(`seller lot list failed: ${JSON.stringify(sellerLots.body)}`);
  }

  const adminLots = await jsonRequest(`/v1/admin/lots?sellerId=${seller.user.id}`, {
    method: "GET",
    headers: { authorization: `Bearer ${adminToken}` },
  });
  if (adminLots.status !== 200 || adminLots.body.data.length < 1) {
    throw new Error(`admin lots failed: ${JSON.stringify(adminLots.body)}`);
  }

  console.log("Lots smoke test passed", {
    lotId,
    orderId,
    recalled: sellerLots.body.data[0]?.status,
    lotOrdersCount: adminLotOrders.body.data.length,
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

