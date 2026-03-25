import { Router } from "express";
import { pool } from "../db/client.js";
import { requireAuth } from "../middleware/auth.js";
import { resolveActorRole } from "../middleware/app-role.js";

export const complaintsRouter = Router();

complaintsRouter.use(requireAuth("app"));

/**
 * POST /v1/complaints
 * Create a new complaint for an order (buyer only).
 */
complaintsRouter.post("/", async (req, res) => {
  try {
    const actorRole = resolveActorRole(req);
    if (actorRole !== "buyer") {
      return res.status(403).json({ error: { code: "ROLE_NOT_ALLOWED", message: "Complaint requires buyer role" } });
    }

    const { orderId, category, description } = req.body ?? {};

    if (!orderId || !category || !description) {
      return res.status(400).json({
        error: { code: "MISSING_FIELDS", message: "orderId, category, and description are required" },
      });
    }

    if (typeof description !== "string" || description.trim().length < 10) {
      return res.status(400).json({
        error: { code: "DESCRIPTION_TOO_SHORT", message: "Description must be at least 10 characters" },
      });
    }

    // Verify the order belongs to this buyer
    const order = await pool.query(
      "SELECT id, buyer_id FROM orders WHERE id = $1",
      [orderId],
    );
    if (order.rows.length === 0) {
      return res.status(404).json({ error: { code: "ORDER_NOT_FOUND", message: "Order not found" } });
    }
    if (order.rows[0].buyer_id !== req.auth!.userId) {
      return res.status(403).json({ error: { code: "FORBIDDEN", message: "Not your order" } });
    }

    // Look up category_id from code
    const cat = await pool.query(
      "SELECT id FROM complaint_categories WHERE code = $1 AND is_active = true",
      [category],
    );
    const categoryId = cat.rows.length > 0 ? cat.rows[0].id : null;

    const trimmedDescription = description.trim();
    let rows: Array<{ id: string; status: string; created_at: Date | string }>;
    try {
      const insert = await pool.query(
        `INSERT INTO complaints (order_id, complainant_buyer_id, complainant_type, complainant_user_id, description, category_id, status)
         VALUES ($1, $2, 'buyer', $2, $3, $4, 'open')
         RETURNING id, status, created_at`,
        [orderId, req.auth!.userId, trimmedDescription, categoryId],
      );
      rows = insert.rows;
    } catch (insertErr) {
      const pgErr = insertErr as { code?: string; column?: string; message?: string };
      const errorText = `${pgErr.message ?? ""} ${pgErr.column ?? ""}`.toLowerCase();
      const shouldTryLegacySchema =
        pgErr.code === "42703" ||
        (pgErr.code === "23502" && pgErr.column === "subject") ||
        errorText.includes("subject") ||
        errorText.includes("complainant_type") ||
        errorText.includes("complainant_user_id");

      if (!shouldTryLegacySchema) {
        throw insertErr;
      }

      const legacySubject = trimmedDescription.slice(0, 120);
      const legacyInsert = await pool.query(
        `INSERT INTO complaints (order_id, complainant_buyer_id, subject, description, category_id, status)
         VALUES ($1, $2, $3, $4, $5, 'open')
         RETURNING id, status, created_at`,
        [orderId, req.auth!.userId, legacySubject, trimmedDescription, categoryId],
      );
      rows = legacyInsert.rows;
    }

    res.status(201).json({
      data: {
        id: rows[0].id,
        status: rows[0].status,
        createdAt: new Date(rows[0].created_at).toISOString(),
      },
    });
  } catch (err) {
    console.error("[complaints] create error:", err);
    res.status(500).json({ error: { code: "INTERNAL_ERROR", message: "Failed to create complaint" } });
  }
});
