import { Router } from "express";
import { pool } from "../db/client.js";
import { requireAuth } from "../middleware/auth.js";
import { resolveActorRole } from "../middleware/app-role.js";

export const complaintsRouter = Router();

complaintsRouter.use(requireAuth("app"));

type TicketPriority = "low" | "medium" | "high" | "urgent";
type TicketStatus = "open" | "in_review" | "resolved" | "closed";

const CATEGORY_PRIORITY_MAP: Record<string, TicketPriority> = {
  gida_guvenligi: "high",
  food_safety: "high",
  urun_kalitesi: "high",
  teslimat_gecikmesi: "medium",
  teslimat_sorunu: "medium",
  delivery_issue: "medium",
  iletisim: "low",
  communication: "low",
};

function pickPriorityByCategoryCode(categoryCode: string | null): TicketPriority {
  if (!categoryCode) return "medium";
  return CATEGORY_PRIORITY_MAP[categoryCode] ?? "medium";
}

type TicketMessage = {
  id: string;
  senderRole: "buyer" | "admin";
  senderName: string;
  senderUserId: string;
  message: string;
  createdAt: string;
};

async function fetchTicketMessages(complaintId: string): Promise<TicketMessage[]> {
  let ticketMessagesPart = "";
  try {
    await pool.query("SELECT 1 FROM ticket_messages LIMIT 0");
    ticketMessagesPart = `SELECT
       tm.id::text,
       tm.sender_role,
       tm.sender_name,
       tm.sender_user_id::text,
       tm.message,
       tm.created_at::text
     FROM ticket_messages tm
     WHERE tm.complaint_id = $1
     UNION ALL `;
  } catch {
    // ticket_messages table does not exist yet — migration pending
  }

  const rows = await pool.query<{
    id: string;
    sender_role: "buyer" | "admin";
    sender_name: string | null;
    sender_user_id: string | null;
    message: string;
    created_at: string;
  }>(
    `${ticketMessagesPart}SELECT
       can.id::text,
       'admin'::text AS sender_role,
       COALESCE(au.email, can.created_by_admin_id::text) AS sender_name,
       can.created_by_admin_id::text AS sender_user_id,
       can.note AS message,
       can.created_at::text
     FROM complaint_admin_notes can
     LEFT JOIN admin_users au ON au.id = can.created_by_admin_id
     WHERE can.complaint_id = $1
     ORDER BY created_at ASC`,
    [complaintId]
  );

  return rows.rows.map((row) => ({
    id: row.id,
    senderRole: row.sender_role,
    senderName: row.sender_name ?? "Destek",
    senderUserId: row.sender_user_id ?? "",
    message: row.message,
    createdAt: row.created_at,
  }));
}

async function resolveCategory(categoryCode: string) {
  const cat = await pool.query<{ id: string; code: string }>(
    "SELECT id::text, code FROM complaint_categories WHERE code = $1 AND is_active = true LIMIT 1",
    [categoryCode]
  );
  if ((cat.rowCount ?? 0) === 0) {
    return { categoryId: null as string | null, categoryCode: null as string | null };
  }
  return { categoryId: cat.rows[0].id, categoryCode: cat.rows[0].code };
}

/**
 * POST /v1/complaints
 * Create a new complaint/ticket for an order (buyer only).
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

    const { categoryId, categoryCode } = await resolveCategory(category);
    const autoPriority = pickPriorityByCategoryCode(categoryCode);

    const trimmedDescription = description.trim();
    let rows: Array<{
      id: string;
      status: TicketStatus;
      created_at: Date | string;
      priority: TicketPriority;
      ticket_no: number | null;
    }>;
    try {
      const insert = await pool.query(
        `INSERT INTO complaints (
           order_id,
           complainant_buyer_id,
           complainant_type,
           complainant_user_id,
           description,
           category_id,
           priority,
           status
         )
         VALUES ($1, $2, 'buyer', $2, $3, $4, $5, 'open')
         RETURNING
           id::text,
           status,
           created_at,
           priority,
           COALESCE((to_jsonb(complaints) ->> 'ticket_no')::int, 0) AS ticket_no`,
        [orderId, req.auth!.userId, trimmedDescription, categoryId, autoPriority],
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
        `INSERT INTO complaints (order_id, complainant_buyer_id, subject, description, category_id, priority, status)
         VALUES ($1, $2, $3, $4, $5, $6, 'open')
         RETURNING
           id::text,
           status,
           created_at,
           priority,
           COALESCE((to_jsonb(complaints) ->> 'ticket_no')::int, 0) AS ticket_no`,
        [orderId, req.auth!.userId, legacySubject, trimmedDescription, categoryId, autoPriority],
      );
      rows = legacyInsert.rows;
    }

    res.status(201).json({
      data: {
        id: rows[0].id,
        ticketNo: rows[0].ticket_no ?? 0,
        status: rows[0].status,
        priority: rows[0].priority,
        createdAt: new Date(rows[0].created_at).toISOString(),
        lastActivityAt: new Date(rows[0].created_at).toISOString(),
      },
    });
  } catch (err) {
    console.error("[complaints] create error:", err);
    res.status(500).json({ error: { code: "INTERNAL_ERROR", message: "Failed to create complaint" } });
  }
});

/**
 * GET /v1/tickets
 * GET /v1/complaints
 * Buyer's own ticket list.
 */
complaintsRouter.get("/", async (req, res) => {
  try {
    const actorRole = resolveActorRole(req);
    if (actorRole !== "buyer") {
      return res.status(403).json({ error: { code: "ROLE_NOT_ALLOWED", message: "Ticket listing requires buyer role" } });
    }

    const rows = await pool.query<{
      id: string;
      order_id: string;
      description: string | null;
      category_code: string | null;
      category_name: string | null;
      status: TicketStatus;
      priority: TicketPriority;
      created_at: string;
      updated_at: string;
      ticket_no: number | null;
    }>(
      `SELECT
         c.id::text,
         c.order_id::text,
         c.description,
         cat.code AS category_code,
         cat.name AS category_name,
         c.status,
         c.priority,
         c.created_at::text,
         COALESCE((to_jsonb(c) ->> 'updated_at')::timestamptz, c.created_at)::text AS updated_at,
         COALESCE((to_jsonb(c) ->> 'ticket_no')::int, 0) AS ticket_no
       FROM complaints c
       LEFT JOIN complaint_categories cat ON cat.id = c.category_id
       WHERE COALESCE(c.complainant_user_id::text, c.complainant_buyer_id::text) = $1
         AND COALESCE(to_jsonb(c) ->> 'complainant_type', 'buyer') = 'buyer'
       ORDER BY COALESCE((to_jsonb(c) ->> 'updated_at')::timestamptz, c.created_at) DESC
       LIMIT 100`,
      [req.auth!.userId]
    );

    // Fetch last message timestamps separately so missing table doesn't break the list.
    const lastMessageAtById: Record<string, string> = {};
    try {
      const ids = rows.rows.map((r) => r.id);
      if (ids.length > 0) {
        const msgTs = await pool.query<{ complaint_id: string; latest: string }>(
          `SELECT complaint_id::text, max(created_at)::text AS latest
           FROM ticket_messages
           WHERE complaint_id = ANY($1::uuid[])
           GROUP BY complaint_id`,
          [ids],
        );
        for (const r of msgTs.rows) lastMessageAtById[r.complaint_id] = r.latest;
      }
    } catch {
      // ticket_messages table not yet migrated — fall back to updated_at
    }

    return res.json({
      data: rows.rows.map((row) => ({
        id: row.id,
        ticketNo: row.ticket_no ?? 0,
        orderId: row.order_id,
        category: row.category_code,
        categoryName: row.category_name,
        status: row.status,
        priority: row.priority,
        description: row.description ?? null,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        lastActivityAt: lastMessageAtById[row.id] ?? row.updated_at ?? row.created_at,
      })),
    });
  } catch (err) {
    console.error("[tickets] list error:", err);
    return res.status(500).json({ error: { code: "INTERNAL_ERROR", message: "Failed to load tickets" } });
  }
});

/**
 * GET /v1/tickets/:id
 * GET /v1/complaints/:id
 */
complaintsRouter.get("/:id", async (req, res) => {
  try {
    const actorRole = resolveActorRole(req);
    if (actorRole !== "buyer") {
      return res.status(403).json({ error: { code: "ROLE_NOT_ALLOWED", message: "Ticket detail requires buyer role" } });
    }

    const detail = await pool.query<{
      id: string;
      order_id: string;
      description: string | null;
      category_code: string | null;
      category_name: string | null;
      status: TicketStatus;
      priority: TicketPriority;
      created_at: string;
      updated_at: string;
      ticket_no: number | null;
      order_delivery_type: "pickup" | "delivery" | null;
      order_delivery_address_json: unknown;
      seller_name: string | null;
    }>(
      `SELECT
         c.id::text,
         c.order_id::text,
         c.description,
         cat.code AS category_code,
         cat.name AS category_name,
         c.status,
         c.priority,
         c.created_at::text,
         COALESCE((to_jsonb(c) ->> 'updated_at')::timestamptz, c.created_at)::text AS updated_at,
         COALESCE((to_jsonb(c) ->> 'ticket_no')::int, 0) AS ticket_no,
         o.delivery_type AS order_delivery_type,
         o.delivery_address_json AS order_delivery_address_json,
         seller.display_name AS seller_name
       FROM complaints c
       JOIN orders o ON o.id = c.order_id
       LEFT JOIN users seller ON seller.id = o.seller_id
       LEFT JOIN complaint_categories cat ON cat.id = c.category_id
       WHERE c.id = $1
         AND COALESCE(c.complainant_user_id::text, c.complainant_buyer_id::text) = $2
         AND COALESCE(to_jsonb(c) ->> 'complainant_type', 'buyer') = 'buyer'
       LIMIT 1`,
      [req.params.id, req.auth!.userId]
    );

    const row = detail.rows[0];
    if (!row) {
      return res.status(404).json({ error: { code: "TICKET_NOT_FOUND", message: "Ticket not found" } });
    }

    const messages = await fetchTicketMessages(row.id);
    const events = [
      {
        type: "ticket_created",
        at: row.created_at,
      },
      ...messages.map((item) => ({
        type: "message",
        at: item.createdAt,
      })),
      ...(row.updated_at !== row.created_at
        ? [{ type: "ticket_updated", at: row.updated_at }]
        : []),
    ];

    return res.json({
      data: {
        id: row.id,
        ticketNo: row.ticket_no ?? 0,
        orderId: row.order_id,
        status: row.status,
        priority: row.priority,
        category: row.category_code,
        categoryName: row.category_name,
        description: row.description,
        createdAt: row.created_at,
        updatedAt: row.updated_at,
        lastActivityAt: messages.at(-1)?.createdAt ?? row.updated_at ?? row.created_at,
        orderSummary: {
          sellerName: row.seller_name ?? "-",
          deliveryType: row.order_delivery_type,
          deliveryAddress: row.order_delivery_address_json ?? null,
        },
        messages,
        events,
      },
    });
  } catch (err) {
    console.error("[tickets] detail error:", err);
    return res.status(500).json({ error: { code: "INTERNAL_ERROR", message: "Failed to load ticket detail" } });
  }
});

/**
 * POST /v1/tickets/:id/messages
 * POST /v1/complaints/:id/messages
 */
complaintsRouter.post("/:id/messages", async (req, res) => {
  try {
    const actorRole = resolveActorRole(req);
    if (actorRole !== "buyer") {
      return res.status(403).json({ error: { code: "ROLE_NOT_ALLOWED", message: "Ticket messaging requires buyer role" } });
    }

    const message = String(req.body?.message ?? "").trim();
    if (message.length < 2) {
      return res.status(400).json({ error: { code: "MESSAGE_TOO_SHORT", message: "Message must be at least 2 characters" } });
    }

    const complaint = await pool.query<{
      id: string;
      status: TicketStatus;
      complainant_name: string | null;
      complainant_email: string | null;
    }>(
      `SELECT
         c.id::text,
         c.status,
         u.display_name AS complainant_name,
         u.email AS complainant_email
       FROM complaints c
       LEFT JOIN users u ON u.id = COALESCE(c.complainant_user_id, c.complainant_buyer_id)
       WHERE c.id = $1
         AND COALESCE(c.complainant_user_id::text, c.complainant_buyer_id::text) = $2
         AND COALESCE(to_jsonb(c) ->> 'complainant_type', 'buyer') = 'buyer'
       LIMIT 1`,
      [req.params.id, req.auth!.userId]
    );

    if ((complaint.rowCount ?? 0) === 0) {
      return res.status(404).json({ error: { code: "TICKET_NOT_FOUND", message: "Ticket not found" } });
    }

    const status = complaint.rows[0].status;
    if (status === "resolved" || status === "closed") {
      return res.status(409).json({
        error: { code: "TICKET_CLOSED", message: "This ticket is closed. Support can reopen it if needed." },
      });
    }

    const created = await pool.query<{
      id: string;
      sender_role: "buyer";
      sender_name: string | null;
      sender_user_id: string;
      message: string;
      created_at: string;
    }>(
      `INSERT INTO ticket_messages (complaint_id, sender_user_id, sender_role, sender_name, message)
       VALUES ($1, $2, 'buyer', $3, $4)
       RETURNING id::text, sender_role, sender_name, sender_user_id::text, message, created_at::text`,
      [req.params.id, req.auth!.userId, complaint.rows[0].complainant_name ?? complaint.rows[0].complainant_email ?? "Alıcı", message]
    );

    await pool.query("UPDATE complaints SET updated_at = now() WHERE id = $1", [req.params.id]);

    return res.status(201).json({
      data: {
        id: created.rows[0].id,
        senderRole: created.rows[0].sender_role,
        senderName: created.rows[0].sender_name ?? "Alıcı",
        senderUserId: created.rows[0].sender_user_id,
        message: created.rows[0].message,
        createdAt: created.rows[0].created_at,
      },
    });
  } catch (err) {
    console.error("[tickets] message error:", err);
    return res.status(500).json({ error: { code: "INTERNAL_ERROR", message: "Failed to send message" } });
  }
});
