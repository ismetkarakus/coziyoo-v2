import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { pool } from "../db/client.js";
import { abuseProtection } from "../middleware/abuse-protection.js";
import { resolveActorRole } from "../middleware/app-role.js";
import { requireAuth } from "../middleware/auth.js";
import { requireIdempotency } from "../middleware/idempotency.js";
import {
  canActorSetStatus,
  canTransition,
  isTerminalStatus,
  type OrderStatus,
} from "../services/order-state-machine.js";
import { finalizeOrderFinanceTx } from "../services/finance.js";
import { enqueueOutboxEvent } from "../services/outbox.js";
import { allocateLotsFefoTx } from "../services/lots.js";

const CreateOrderSchema = z.object({
  sellerId: z.string().uuid(),
  deliveryType: z.enum(["pickup", "delivery"]),
  deliveryAddress: z.record(z.string(), z.unknown()).optional(),
  requestedAt: z.string().datetime().optional(),
  items: z.array(z.object({ foodId: z.string().uuid(), quantity: z.number().int().positive() })).min(1),
});

const ListOrdersQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(100).default(20),
  sortDir: z.enum(["asc", "desc"]).default("desc"),
});

const StatusSchema = z.object({
  toStatus: z.enum([
    "seller_approved",
    "rejected",
    "awaiting_payment",
    "preparing",
    "ready",
    "in_delivery",
    "delivered",
    "completed",
    "cancelled",
  ]),
  reason: z.string().min(3).max(500).optional(),
});

type OrderRow = {
  id: string;
  buyer_id: string;
  seller_id: string;
  status: OrderStatus;
  total_price: string;
  delivery_type: string;
};

export const ordersRouter = Router();

ordersRouter.post(
  "/",
  requireAuth("app"),
  abuseProtection({ flow: "order_create", ipLimit: 30, userLimit: 20, windowMs: 60_000 }),
  requireIdempotency({ scope: "order_create" }),
  async (req, res) => {
  const actorRole = resolveActorRole(req);
  if (actorRole !== "buyer") {
    return res.status(403).json({
      error: {
        code: "ROLE_NOT_ALLOWED",
        message: "Order create requires buyer role. Use x-actor-role header for both-role users.",
      },
    });
  }

  const parsed = CreateOrderSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: { code: "VALIDATION_ERROR", details: parsed.error.flatten() } });
  }
  const input = parsed.data;

  const client = await pool.connect();
  try {
    await client.query("BEGIN");

    const foods = await client.query<{ id: string; seller_id: string; price: string; is_active: boolean }>(
      "SELECT id, seller_id, price::text, is_active FROM foods WHERE id = ANY($1::uuid[])",
      [input.items.map((item) => item.foodId)]
    );

    if (foods.rowCount !== input.items.length) {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: { code: "FOOD_NOT_FOUND", message: "One or more foods do not exist" } });
    }

    const foodsMap = new Map(foods.rows.map((f) => [f.id, f]));
    for (const item of input.items) {
      const food = foodsMap.get(item.foodId);
      if (!food || !food.is_active || food.seller_id !== input.sellerId) {
        await client.query("ROLLBACK");
        return res.status(400).json({
          error: { code: "ORDER_INVALID_ITEMS", message: "Foods must be active and belong to selected seller" },
        });
      }
    }

    let total = 0;
    for (const item of input.items) {
      const price = Number(foodsMap.get(item.foodId)!.price);
      total += price * item.quantity;
    }
    total = Number(total.toFixed(2));

    const orderInsert = await client.query<{ id: string }>(
      `INSERT INTO orders (buyer_id, seller_id, status, delivery_type, delivery_address_json, total_price, requested_at)
       VALUES ($1, $2, 'pending_seller_approval', $3, $4, $5, $6)
       RETURNING id`,
      [
        req.auth!.userId,
        input.sellerId,
        input.deliveryType,
        input.deliveryAddress ? JSON.stringify(input.deliveryAddress) : null,
        total,
        input.requestedAt ?? null,
      ]
    );

    for (const item of input.items) {
      const price = Number(foodsMap.get(item.foodId)!.price);
      const lineTotal = Number((price * item.quantity).toFixed(2));
      await client.query(
        `INSERT INTO order_items (order_id, food_id, quantity, unit_price, line_total)
         VALUES ($1, $2, $3, $4, $5)`,
        [orderInsert.rows[0].id, item.foodId, item.quantity, price, lineTotal]
      );
    }

    await client.query(
      `INSERT INTO order_events (order_id, actor_user_id, event_type, from_status, to_status, payload_json)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [
        orderInsert.rows[0].id,
        req.auth!.userId,
        "order_created",
        null,
        "pending_seller_approval",
        JSON.stringify({ deliveryType: input.deliveryType }),
      ]
    );

    await enqueueOutboxEvent(client, {
      eventType: "order_created",
      aggregateType: "order",
      aggregateId: orderInsert.rows[0].id,
      payload: {
        orderId: orderInsert.rows[0].id,
        buyerId: req.auth!.userId,
        sellerId: input.sellerId,
        totalPrice: total,
      },
    });

    await client.query("COMMIT");
    return res.status(201).json({
      data: {
        orderId: orderInsert.rows[0].id,
        status: "pending_seller_approval",
        totalPrice: total,
      },
    });
  } catch {
    await client.query("ROLLBACK");
    return res.status(500).json({ error: { code: "INTERNAL_ERROR", message: "Order create failed" } });
  } finally {
    client.release();
  }
  }
);

ordersRouter.get("/", requireAuth("app"), async (req, res) => {
  const parsed = ListOrdersQuerySchema.safeParse(req.query);
  if (!parsed.success) {
    return res.status(400).json({ error: { code: "PAGINATION_INVALID", details: parsed.error.flatten() } });
  }

  const { page, pageSize, sortDir } = parsed.data;
  const offset = (page - 1) * pageSize;

  const totalResult = await pool.query<{ count: string }>(
    "SELECT count(*)::text AS count FROM orders WHERE buyer_id = $1 OR seller_id = $1",
    [req.auth!.userId]
  );

  const listResult = await pool.query<{
    id: string;
    buyer_id: string;
    seller_id: string;
    status: string;
    delivery_type: string;
    total_price: string;
    created_at: string;
  }>(
    `SELECT id, buyer_id, seller_id, status, delivery_type, total_price::text, created_at::text
     FROM orders
     WHERE buyer_id = $1 OR seller_id = $1
     ORDER BY created_at ${sortDir === "asc" ? "ASC" : "DESC"}, id ${sortDir === "asc" ? "ASC" : "DESC"}
     LIMIT $2 OFFSET $3`,
    [req.auth!.userId, pageSize, offset]
  );

  const total = Number(totalResult.rows[0].count);
  return res.json({
    data: listResult.rows.map((row) => ({
      id: row.id,
      buyerId: row.buyer_id,
      sellerId: row.seller_id,
      status: row.status,
      deliveryType: row.delivery_type,
      totalPrice: Number(row.total_price),
      createdAt: row.created_at,
    })),
    pagination: {
      mode: "offset",
      page,
      pageSize,
      total,
      totalPages: Math.ceil(total / pageSize),
    },
  });
});

ordersRouter.post("/:id/approve", requireAuth("app"), async (req, res) => {
  req.body = { toStatus: "seller_approved" };
  return transitionHandler(req, res, "seller_approve");
});

ordersRouter.post("/:id/reject", requireAuth("app"), async (req, res) => {
  req.body = { toStatus: "rejected", reason: req.body?.reason };
  return transitionHandler(req, res, "seller_reject");
});

ordersRouter.post("/:id/cancel", requireAuth("app"), async (req, res) => {
  req.body = { toStatus: "cancelled", reason: req.body?.reason };
  return transitionHandler(req, res, "order_cancel");
});

ordersRouter.post("/:id/status", requireAuth("app"), async (req, res) => {
  return transitionHandler(req, res, "status_update");
});

async function transitionHandler(
  req: Request,
  res: Response,
  eventType: string
) {
  const actorRole = resolveActorRole(req);
  if (!actorRole) {
    return res.status(403).json({
      error: {
        code: "ROLE_NOT_ALLOWED",
        message: "Missing actor role. For both-role users, set x-actor-role to buyer or seller.",
      },
    });
  }

  const parsed = StatusSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: { code: "VALIDATION_ERROR", details: parsed.error.flatten() } });
  }
  const { toStatus, reason } = parsed.data;
  if (!canActorSetStatus(actorRole, toStatus)) {
    return res.status(403).json({ error: { code: "ROLE_NOT_ALLOWED", message: "Actor cannot set target status" } });
  }

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const orderResult = await client.query<OrderRow>(
      "SELECT id, buyer_id, seller_id, status, total_price::text, delivery_type FROM orders WHERE id = $1 FOR UPDATE",
      [req.params.id]
    );

    if ((orderResult.rowCount ?? 0) === 0) {
      await client.query("ROLLBACK");
      return res.status(404).json({ error: { code: "ORDER_NOT_FOUND", message: "Order not found" } });
    }
    const order = orderResult.rows[0];

    if (isTerminalStatus(order.status)) {
      await client.query("ROLLBACK");
      return res.status(409).json({ error: { code: "ORDER_TERMINAL", message: "Order is already terminal" } });
    }

    if (actorRole === "seller" && order.seller_id !== req.auth!.userId) {
      await client.query("ROLLBACK");
      return res.status(403).json({ error: { code: "FORBIDDEN_ORDER_SCOPE", message: "Not seller of this order" } });
    }
    if (actorRole === "buyer" && order.buyer_id !== req.auth!.userId) {
      await client.query("ROLLBACK");
      return res.status(403).json({ error: { code: "FORBIDDEN_ORDER_SCOPE", message: "Not buyer of this order" } });
    }

    if (!canTransition(order.status, toStatus)) {
      await client.query("ROLLBACK");
      return res.status(409).json({
        error: { code: "ORDER_INVALID_STATE", message: `Cannot transition ${order.status} -> ${toStatus}` },
      });
    }

    if (actorRole === "seller") {
      const compliance = await client.query<{ country_code: string; status: string }>(
        "SELECT country_code, status FROM seller_compliance_profiles WHERE seller_id = $1",
        [req.auth!.userId]
      );
      if ((compliance.rowCount ?? 0) === 0) {
        await client.query("ROLLBACK");
        return res.status(403).json({
          error: { code: "COMPLIANCE_REQUIRED", message: "Seller compliance profile required for seller operations" },
        });
      }
      const profile = compliance.rows[0];
      if (profile.status === "suspended" || profile.status === "rejected") {
        await client.query("ROLLBACK");
        return res.status(403).json({
          error: { code: "COMPLIANCE_BLOCKED", message: `Seller blocked by compliance status ${profile.status}` },
        });
      }
      if (profile.country_code === "UK" && profile.status !== "approved") {
        await client.query("ROLLBACK");
        return res.status(403).json({
          error: { code: "COMPLIANCE_REQUIRED", message: "UK sellers must be approved before seller operations" },
        });
      }
    }

    if (toStatus === "cancelled" && actorRole === "buyer") {
      if (!["pending_seller_approval", "seller_approved", "awaiting_payment", "paid"].includes(order.status)) {
        await client.query("ROLLBACK");
        return res.status(409).json({
          error: { code: "ORDER_CANCEL_POLICY", message: "Buyer cancellation allowed only before preparing" },
        });
      }
    }

    if (toStatus === "rejected" && !reason) {
      await client.query("ROLLBACK");
      return res.status(400).json({ error: { code: "REASON_REQUIRED", message: "Reject reason is required" } });
    }

    if (toStatus === "completed") {
      const disclosure = await client.query<{ pre_order_count: string; handover_count: string }>(
        `SELECT
          count(*) FILTER (WHERE phase = 'pre_order')::text AS pre_order_count,
          count(*) FILTER (WHERE phase = 'handover')::text AS handover_count
         FROM allergen_disclosure_records
         WHERE order_id = $1`,
        [order.id]
      );
      const preOrder = Number(disclosure.rows[0].pre_order_count);
      const handover = Number(disclosure.rows[0].handover_count);
      if (preOrder < 1 || handover < 1) {
        await client.query("ROLLBACK");
        return res.status(409).json({
          error: {
            code: "ALLERGEN_DISCLOSURE_REQUIRED",
            message: "Order cannot be completed without pre_order and handover allergen disclosures",
          },
        });
      }
    }

    if (["delivered", "completed"].includes(toStatus) && order.delivery_type === "delivery") {
      const proof = await client.query<{ status: string }>(
        "SELECT status FROM delivery_proof_records WHERE order_id = $1",
        [order.id]
      );
      if ((proof.rowCount ?? 0) === 0 || proof.rows[0].status !== "verified") {
        await client.query("ROLLBACK");
        return res.status(409).json({
          error: {
            code: "DELIVERY_PIN_REQUIRED",
            message: "Delivery orders require verified PIN before delivered/completed transitions",
          },
        });
      }
    }

    await client.query("UPDATE orders SET status = $1, updated_at = now() WHERE id = $2", [toStatus, order.id]);
    await client.query(
      `INSERT INTO order_events (order_id, actor_user_id, event_type, from_status, to_status, payload_json)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [order.id, req.auth!.userId, eventType, order.status, toStatus, reason ? JSON.stringify({ reason }) : null]
    );

    if (toStatus === "preparing") {
      try {
        await allocateLotsFefoTx({ client, orderId: order.id, sellerId: order.seller_id });
      } catch (error) {
        const msg = error instanceof Error ? error.message : "LOT_ALLOCATE_FAILED";
        if (msg.startsWith("INSUFFICIENT_LOT_STOCK:")) {
          await client.query("ROLLBACK");
          return res.status(409).json({
            error: { code: "LOT_STOCK_INSUFFICIENT", message: "Not enough lot stock for preparing transition" },
          });
        }
        throw error;
      }
    }

    if (toStatus === "completed") {
      await finalizeOrderFinanceTx({
        client,
        orderId: order.id,
        sellerId: order.seller_id,
        grossAmount: Number(order.total_price),
      });
      await enqueueOutboxEvent(client, {
        eventType: "finance_snapshot_finalized",
        aggregateType: "order_finance",
        aggregateId: order.id,
        payload: { orderId: order.id, sellerId: order.seller_id, grossAmount: Number(order.total_price) },
      });
      await enqueueOutboxEvent(client, {
        eventType: "order_completed",
        aggregateType: "order",
        aggregateId: order.id,
        payload: { orderId: order.id },
      });
    }

    await client.query("COMMIT");
    return res.json({ data: { orderId: order.id, fromStatus: order.status, toStatus } });
  } catch {
    await client.query("ROLLBACK");
    return res.status(500).json({ error: { code: "INTERNAL_ERROR", message: "Order transition failed" } });
  } finally {
    client.release();
  }
}
