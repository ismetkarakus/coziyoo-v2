import { Router } from "express";
import { pool } from "../db/client.js";
import { requireAuth } from "../middleware/auth.js";

export const adminDashboardRouter = Router();

adminDashboardRouter.get("/dashboard/overview", requireAuth("admin"), async (_req, res) => {
  const [usersAgg, ordersAgg, complianceAgg, disputesAgg] = await Promise.all([
    pool.query<{ total_users: string; active_users: string; disabled_users: string }>(
      `SELECT
         count(*)::text AS total_users,
         count(*) FILTER (WHERE is_active = TRUE)::text AS active_users,
         count(*) FILTER (WHERE is_active = FALSE)::text AS disabled_users
       FROM users`
    ),
    pool.query<{ active_orders: string; payment_pending_orders: string }>(
      `SELECT
         count(*) FILTER (WHERE status IN ('pending_seller_approval', 'seller_approved', 'awaiting_payment', 'preparing', 'ready', 'in_delivery'))::text AS active_orders,
         count(*) FILTER (WHERE payment_completed = FALSE AND status IN ('awaiting_payment', 'preparing', 'ready', 'in_delivery', 'delivered', 'completed'))::text AS payment_pending_orders
       FROM orders`
    ),
    pool.query<{ compliance_queue_count: string }>(
      `SELECT count(*)::text AS compliance_queue_count
       FROM seller_compliance_profiles
       WHERE status IN ('submitted', 'under_review')`
    ),
    pool.query<{ open_dispute_count: string }>(
      `SELECT count(*)::text AS open_dispute_count
       FROM payment_dispute_cases
       WHERE status IN ('opened', 'under_review')`
    ),
  ]);

  return res.json({
    data: {
      totalUsers: Number(usersAgg.rows[0].total_users),
      activeUsers: Number(usersAgg.rows[0].active_users),
      disabledUsers: Number(usersAgg.rows[0].disabled_users),
      activeOrders: Number(ordersAgg.rows[0].active_orders),
      paymentPendingOrders: Number(ordersAgg.rows[0].payment_pending_orders),
      complianceQueueCount: Number(complianceAgg.rows[0].compliance_queue_count),
      openDisputeCount: Number(disputesAgg.rows[0].open_dispute_count),
      updatedAt: new Date().toISOString(),
    },
  });
});
