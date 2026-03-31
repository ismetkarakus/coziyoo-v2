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
         count(*) FILTER (WHERE status IN ('paid', 'preparing', 'ready', 'in_delivery', 'delivered'))::text AS active_orders,
         count(*) FILTER (WHERE payment_completed = FALSE AND status IN ('pending_seller_approval', 'seller_approved', 'awaiting_payment'))::text AS payment_pending_orders
       FROM orders`
    ),
    pool.query<{ compliance_queue_count: string }>(
      `SELECT count(*)::text AS compliance_queue_count
       FROM (
         SELECT seller_id
         FROM seller_compliance_documents
         WHERE is_required = TRUE
           AND is_current = TRUE
           AND status = 'uploaded'
           AND (expires_at IS NULL OR expires_at > now())
         GROUP BY seller_id
       ) q`
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

adminDashboardRouter.get("/dashboard/review-queue", requireAuth("admin"), async (_req, res) => {
  const [
    complianceCountResult,
    complaintCountResult,
    disputeCountResult,
    paymentCountResult,
    complianceRows,
    complaintRows,
    disputeRows,
    paymentRows,
  ] = await Promise.all([
    pool.query<{ count: string }>(
      `SELECT count(*)::text AS count
       FROM seller_compliance_documents
       WHERE is_required = TRUE
         AND is_current = TRUE
         AND status = 'uploaded'
         AND (expires_at IS NULL OR expires_at > now())`
    ),
    pool.query<{ count: string }>(
      `SELECT count(*)::text AS count
       FROM complaints
       WHERE status IN ('open', 'in_review')`
    ),
    pool.query<{ count: string }>(
      `SELECT count(*)::text AS count
       FROM payment_dispute_cases
       WHERE status IN ('opened', 'under_review')`
    ),
    pool.query<{ count: string }>(
      `SELECT count(*)::text AS count
       FROM orders
       WHERE payment_completed = FALSE
         AND status IN ('pending_seller_approval', 'seller_approved', 'awaiting_payment')`
    ),
    pool.query<{
      id: string;
      seller_id: string;
      seller_name: string | null;
      document_code: string;
      document_name: string;
      status: string;
      created_at: string;
      uploaded_at: string | null;
    }>(
      `SELECT
         scd.id::text,
         scd.seller_id::text,
         COALESCE(NULLIF(u.display_name, ''), NULLIF(u.full_name, ''), NULLIF(u.email, ''), scd.seller_id::text) AS seller_name,
         cdl.code AS document_code,
         cdl.name AS document_name,
         scd.status,
         scd.created_at::text,
         scd.uploaded_at::text
       FROM seller_compliance_documents scd
       JOIN compliance_documents_list cdl ON cdl.id = scd.document_list_id
       LEFT JOIN users u ON u.id = scd.seller_id
       WHERE scd.is_required = TRUE
         AND scd.is_current = TRUE
         AND scd.status = 'uploaded'
         AND (scd.expires_at IS NULL OR scd.expires_at > now())
       ORDER BY COALESCE(scd.uploaded_at, scd.created_at) DESC
       LIMIT 10`
    ),
    pool.query<{
      id: string;
      order_id: string;
      buyer_name: string | null;
      description: string | null;
      priority: "low" | "medium" | "high" | "urgent";
      status: "open" | "in_review";
      created_at: string;
    }>(
      `SELECT
         c.id::text,
         c.order_id::text,
         COALESCE(NULLIF(b.display_name, ''), NULLIF(b.full_name, ''), NULLIF(b.email, ''), c.complainant_buyer_id::text) AS buyer_name,
         c.description,
         c.priority,
         c.status,
         c.created_at::text
       FROM complaints c
       LEFT JOIN users b ON b.id = c.complainant_buyer_id
       WHERE c.status IN ('open', 'in_review')
       ORDER BY c.created_at DESC
       LIMIT 10`
    ),
    pool.query<{
      id: string;
      order_id: string;
      buyer_name: string | null;
      seller_name: string | null;
      status: "opened" | "under_review";
      reason_code: string | null;
      created_at: string;
    }>(
      `SELECT
         d.id::text,
         d.order_id::text,
         COALESCE(NULLIF(b.display_name, ''), NULLIF(b.full_name, ''), NULLIF(b.email, ''), o.buyer_id::text) AS buyer_name,
         COALESCE(NULLIF(s.display_name, ''), NULLIF(s.full_name, ''), NULLIF(s.email, ''), o.seller_id::text) AS seller_name,
         d.status,
         d.reason_code,
         d.created_at::text
       FROM payment_dispute_cases d
       JOIN orders o ON o.id = d.order_id
       LEFT JOIN users b ON b.id = o.buyer_id
       LEFT JOIN users s ON s.id = o.seller_id
       WHERE d.status IN ('opened', 'under_review')
       ORDER BY d.created_at DESC
       LIMIT 10`
    ),
    pool.query<{
      id: string;
      buyer_name: string | null;
      seller_name: string | null;
      total_amount: string;
      status: string;
      created_at: string;
    }>(
      `SELECT
         o.id::text,
         COALESCE(NULLIF(b.display_name, ''), NULLIF(b.full_name, ''), NULLIF(b.email, ''), o.buyer_id::text) AS buyer_name,
         COALESCE(NULLIF(s.display_name, ''), NULLIF(s.full_name, ''), NULLIF(s.email, ''), o.seller_id::text) AS seller_name,
         o.total_amount::text,
         o.status,
         o.created_at::text
       FROM orders o
       LEFT JOIN users b ON b.id = o.buyer_id
       LEFT JOIN users s ON s.id = o.seller_id
       WHERE o.payment_completed = FALSE
         AND o.status IN ('pending_seller_approval', 'seller_approved', 'awaiting_payment')
       ORDER BY o.created_at DESC
       LIMIT 10`
    ),
  ]);

  return res.json({
    data: {
      totals: {
        compliance: Number(complianceCountResult.rows[0]?.count ?? "0"),
        complaints: Number(complaintCountResult.rows[0]?.count ?? "0"),
        disputes: Number(disputeCountResult.rows[0]?.count ?? "0"),
        payments: Number(paymentCountResult.rows[0]?.count ?? "0"),
      },
      compliance: complianceRows.rows.map((row) => ({
        id: row.id,
        sellerId: row.seller_id,
        sellerName: row.seller_name ?? row.seller_id,
        documentCode: row.document_code,
        documentName: row.document_name,
        status: row.status,
        createdAt: row.created_at,
        uploadedAt: row.uploaded_at,
      })),
      complaints: complaintRows.rows.map((row) => ({
        id: row.id,
        orderId: row.order_id,
        buyerName: row.buyer_name ?? row.order_id,
        description: row.description,
        priority: row.priority,
        status: row.status,
        createdAt: row.created_at,
      })),
      disputes: disputeRows.rows.map((row) => ({
        id: row.id,
        orderId: row.order_id,
        buyerName: row.buyer_name ?? row.order_id,
        sellerName: row.seller_name ?? row.order_id,
        reasonCode: row.reason_code,
        status: row.status,
        createdAt: row.created_at,
      })),
      payments: paymentRows.rows.map((row) => ({
        id: row.id,
        buyerName: row.buyer_name ?? row.id,
        sellerName: row.seller_name ?? row.id,
        totalAmount: Number(row.total_amount),
        status: row.status,
        createdAt: row.created_at,
      })),
      updatedAt: new Date().toISOString(),
    },
  });
});
