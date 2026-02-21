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

async function main() {
  const seller = await registerUser({
    email: `seller${now}@coziyoo.test`,
    displayName: `seller${now}`,
    userType: "seller",
  });
  const buyer = await registerUser({
    email: `buyer${now}@coziyoo.test`,
    displayName: `buyer${now}`,
    userType: "buyer",
  });

  const category = await pool.query<{ id: string }>(
    "INSERT INTO categories (name_tr, name_en, sort_order, is_active) VALUES ('Ev Yemegi', 'Home Food', 1, TRUE) RETURNING id"
  );
  const food = await pool.query<{ id: string }>(
    `INSERT INTO foods (seller_id, category_id, name, price, is_active, is_available, current_stock)
     VALUES ($1, $2, 'Dolma', 120.00, TRUE, TRUE, 100)
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
      deliveryAddress: { city: "Istanbul", line: "Kadikoy" },
      items: [{ foodId: food.rows[0].id, quantity: 2 }],
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

  const invalidBuyerPrepare = await jsonRequest(`/v1/orders/${orderId}/status`, {
    method: "POST",
    headers: { authorization: `Bearer ${buyer.tokens.accessToken}` },
    body: JSON.stringify({ toStatus: "preparing" }),
  });
  if (invalidBuyerPrepare.status !== 403) {
    throw new Error(`expected buyer forbidden on preparing: ${JSON.stringify(invalidBuyerPrepare.body)}`);
  }

  const moveAwaitingPayment = await jsonRequest(`/v1/orders/${orderId}/status`, {
    method: "POST",
    headers: { authorization: `Bearer ${seller.tokens.accessToken}` },
    body: JSON.stringify({ toStatus: "awaiting_payment" }),
  });
  if (moveAwaitingPayment.status !== 200) {
    throw new Error(`awaiting_payment failed: ${JSON.stringify(moveAwaitingPayment.body)}`);
  }

  const listOrders = await jsonRequest("/v1/orders?page=1&pageSize=10", {
    method: "GET",
    headers: { authorization: `Bearer ${buyer.tokens.accessToken}` },
  });
  if (listOrders.status !== 200) throw new Error(`list orders failed: ${JSON.stringify(listOrders.body)}`);

  console.log("Orders smoke test passed", {
    orderId,
    finalStatus: moveAwaitingPayment.body.data.toStatus,
    listCount: listOrders.body.data.length,
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
