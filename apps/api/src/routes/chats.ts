import { Router } from "express";
import { pool } from "../db/client.js";
import { requireAuth } from "../middleware/auth.js";
import { resolveActorRole } from "../middleware/app-role.js";

export const chatsRouter = Router();

chatsRouter.use(requireAuth("app"));

/**
 * GET /v1/chats
 * List chats for the authenticated user (buyer or seller perspective).
 */
chatsRouter.get("/", async (req, res) => {
  try {
    const actorRole = resolveActorRole(req);
    if (!actorRole) {
      return res.status(403).json({ error: { code: "ROLE_NOT_ALLOWED", message: "Actor role required" } });
    }

    const userId = req.auth!.userId;
    const isBuyer = actorRole === "buyer";

    const { rows } = await pool.query(
      `SELECT
         c.id,
         c.buyer_id,
         c.seller_id,
         c.last_message,
         c.last_message_time,
         c.buyer_unread_count,
         c.seller_unread_count,
         u.display_name AS other_name,
         u.profile_image_url AS other_image
       FROM chats c
       JOIN users u ON u.id = ${isBuyer ? "c.seller_id" : "c.buyer_id"}
       WHERE ${isBuyer ? "c.buyer_id" : "c.seller_id"} = $1
         AND c.is_active = true
       ORDER BY c.last_message_time DESC NULLS LAST, c.created_at DESC
       LIMIT 100`,
      [userId],
    );

    const chats = rows.map((r) => ({
      id: r.id as string,
      sellerId: isBuyer ? (r.seller_id as string) : (r.buyer_id as string),
      sellerName: r.other_name as string,
      sellerImage: (r.other_image as string | null) ?? null,
      lastMessage: (r.last_message as string | null) ?? null,
      lastMessageTime: r.last_message_time ? new Date(r.last_message_time).toISOString() : null,
      buyerUnreadCount: isBuyer ? (r.buyer_unread_count as number) : (r.seller_unread_count as number),
    }));

    res.json({ data: chats });
  } catch (err) {
    console.error("[chats] list error:", err);
    res.status(500).json({ error: { code: "INTERNAL_ERROR", message: "Failed to load chats" } });
  }
});

/**
 * GET /v1/chats/:chatId/messages
 * List messages for a chat.
 */
chatsRouter.get("/:chatId/messages", async (req, res) => {
  try {
    const { chatId } = req.params;
    const userId = req.auth!.userId;

    // Verify user is part of this chat
    const chat = await pool.query(
      "SELECT id, buyer_id, seller_id FROM chats WHERE id = $1",
      [chatId],
    );
    if (chat.rows.length === 0) {
      return res.status(404).json({ error: { code: "CHAT_NOT_FOUND", message: "Chat not found" } });
    }
    const c = chat.rows[0];
    if (c.buyer_id !== userId && c.seller_id !== userId) {
      return res.status(403).json({ error: { code: "FORBIDDEN", message: "Not a participant of this chat" } });
    }

    const { rows } = await pool.query(
      `SELECT id, sender_id, sender_type, message, message_type, is_read, created_at
       FROM messages
       WHERE chat_id = $1
       ORDER BY created_at ASC
       LIMIT 500`,
      [chatId],
    );

    // Mark as read for the current user
    const actorRole = resolveActorRole(req);
    if (actorRole === "buyer") {
      await pool.query("UPDATE chats SET buyer_unread_count = 0 WHERE id = $1", [chatId]);
    } else if (actorRole === "seller") {
      await pool.query("UPDATE chats SET seller_unread_count = 0 WHERE id = $1", [chatId]);
    }

    const messages = rows.map((r) => ({
      id: r.id as string,
      senderId: r.sender_id as string,
      senderType: r.sender_type as string,
      message: (r.message as string | null) ?? null,
      messageType: r.message_type as string,
      isRead: r.is_read as boolean,
      createdAt: new Date(r.created_at).toISOString(),
    }));

    res.json({ data: messages });
  } catch (err) {
    console.error("[chats] messages list error:", err);
    res.status(500).json({ error: { code: "INTERNAL_ERROR", message: "Failed to load messages" } });
  }
});

/**
 * POST /v1/chats/:chatId/messages
 * Send a message in a chat.
 */
chatsRouter.post("/:chatId/messages", async (req, res) => {
  try {
    const { chatId } = req.params;
    const userId = req.auth!.userId;
    const actorRole = resolveActorRole(req);

    if (!actorRole) {
      return res.status(403).json({ error: { code: "ROLE_NOT_ALLOWED", message: "Actor role required" } });
    }

    // Verify user is part of this chat
    const chat = await pool.query(
      "SELECT id, buyer_id, seller_id FROM chats WHERE id = $1",
      [chatId],
    );
    if (chat.rows.length === 0) {
      return res.status(404).json({ error: { code: "CHAT_NOT_FOUND", message: "Chat not found" } });
    }
    const c = chat.rows[0];
    if (c.buyer_id !== userId && c.seller_id !== userId) {
      return res.status(403).json({ error: { code: "FORBIDDEN", message: "Not a participant of this chat" } });
    }

    const { message, messageType } = req.body ?? {};
    if (!message || typeof message !== "string" || message.trim().length === 0) {
      return res.status(400).json({ error: { code: "MISSING_MESSAGE", message: "Message text is required" } });
    }

    const validTypes = ["text", "image", "order_update"];
    const type = validTypes.includes(messageType) ? messageType : "text";

    const { rows } = await pool.query(
      `INSERT INTO messages (chat_id, sender_id, sender_type, message, message_type)
       VALUES ($1, $2, $3, $4, $5)
       RETURNING id, sender_id, sender_type, message, message_type, is_read, created_at`,
      [chatId, userId, actorRole, message.trim(), type],
    );

    // Update chat metadata
    const unreadField = actorRole === "buyer" ? "seller_unread_count" : "buyer_unread_count";
    await pool.query(
      `UPDATE chats SET
         last_message = $2,
         last_message_time = NOW(),
         last_message_sender = $3,
         ${unreadField} = ${unreadField} + 1,
         updated_at = NOW()
       WHERE id = $1`,
      [chatId, message.trim().substring(0, 200), actorRole],
    );

    const r = rows[0];
    res.status(201).json({
      data: {
        id: r.id as string,
        senderId: r.sender_id as string,
        senderType: r.sender_type as string,
        message: (r.message as string | null) ?? null,
        messageType: r.message_type as string,
        isRead: r.is_read as boolean,
        createdAt: new Date(r.created_at).toISOString(),
      },
    });
  } catch (err) {
    console.error("[chats] send message error:", err);
    res.status(500).json({ error: { code: "INTERNAL_ERROR", message: "Failed to send message" } });
  }
});
