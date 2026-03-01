import { Router, type Request, type Response } from "express";
import { z } from "zod";
import { pool } from "../db/client.js";
import { resolveActorRole } from "../middleware/app-role.js";
import { requireAuth } from "../middleware/auth.js";

const DisclosureSchema = z.object({
  allergenSnapshot: z.record(z.string(), z.unknown()),
  disclosureMethod: z.enum(["ui_ack", "label", "verbal", "receipt_note"]),
  buyerConfirmation: z.enum(["acknowledged", "refused", "unreachable"]),
  evidenceRef: z.string().max(300).optional(),
  occurredAt: z.string().datetime().optional(),
});

export const orderAllergenRouter = Router();

orderAllergenRouter.post("/:id/allergen-disclosure/pre-order", requireAuth("app"), async (req, res) => {
  return writeDisclosure(req, res, "pre_order");
});

orderAllergenRouter.post("/:id/allergen-disclosure/handover", requireAuth("app"), async (req, res) => {
  return writeDisclosure(req, res, "handover");
});

orderAllergenRouter.get("/:id/allergen-disclosure", requireAuth("app"), async (req, res) => {
  const orderId = String(req.params.id ?? "");
  if (!z.string().uuid().safeParse(orderId).success) {
    return res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "Invalid order id" } });
  }
  const order = await pool.query<{ buyer_id: string; seller_id: string }>(
    "SELECT buyer_id, seller_id FROM orders WHERE id = $1",
    [orderId]
  );
  if ((order.rowCount ?? 0) === 0) {
    return res.status(404).json({ error: { code: "ORDER_NOT_FOUND", message: "Order not found" } });
  }
  if (req.auth!.userId !== order.rows[0].buyer_id && req.auth!.userId !== order.rows[0].seller_id) {
    return res.status(403).json({ error: { code: "FORBIDDEN_ORDER_SCOPE", message: "No access to this order" } });
  }

  const rows = await pool.query(
    `SELECT id, order_id, phase, allergen_snapshot_json, disclosure_method, buyer_confirmation, evidence_ref, occurred_at, created_at
     FROM allergen_disclosure_records
     WHERE order_id = $1
     ORDER BY phase`,
    [orderId]
  );
  return res.json({ data: rows.rows });
});

async function writeDisclosure(
  req: Request,
  res: Response,
  phase: "pre_order" | "handover"
) {
  const orderId = String(req.params.id ?? "");
  if (!z.string().uuid().safeParse(orderId).success) {
    return res.status(400).json({ error: { code: "VALIDATION_ERROR", message: "Invalid order id" } });
  }
  const parsed = DisclosureSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: { code: "VALIDATION_ERROR", details: parsed.error.flatten() } });
  }
  const input = parsed.data;

  const order = await pool.query<{
    buyer_id: string;
    seller_id: string;
    status: string;
  }>("SELECT buyer_id, seller_id, status FROM orders WHERE id = $1", [orderId]);
  if ((order.rowCount ?? 0) === 0) {
    return res.status(404).json({ error: { code: "ORDER_NOT_FOUND", message: "Order not found" } });
  }
  const row = order.rows[0];
  const actorRole = resolveActorRole(req);

  if (phase === "pre_order") {
    if (actorRole !== "buyer" || row.buyer_id !== req.auth!.userId) {
      return res.status(403).json({ error: { code: "ROLE_NOT_ALLOWED", message: "Pre-order disclosure requires buyer" } });
    }
  } else {
    if (actorRole !== "seller" || row.seller_id !== req.auth!.userId) {
      return res.status(403).json({ error: { code: "ROLE_NOT_ALLOWED", message: "Handover disclosure requires seller" } });
    }
  }

  const foodRef = await pool.query<{ food_id: string }>(
    "SELECT food_id FROM order_items WHERE order_id = $1 ORDER BY created_at ASC LIMIT 1",
    [orderId]
  );
  if ((foodRef.rowCount ?? 0) === 0) {
    return res.status(409).json({ error: { code: "ORDER_INVALID_ITEMS", message: "Order items missing" } });
  }

  await pool.query(
    `INSERT INTO allergen_disclosure_records
      (order_id, phase, seller_id, buyer_id, food_id, allergen_snapshot_json, disclosure_method, buyer_confirmation, evidence_ref, occurred_at, created_at)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, now())
     ON CONFLICT (order_id, phase)
     DO UPDATE SET
       allergen_snapshot_json = EXCLUDED.allergen_snapshot_json,
       disclosure_method = EXCLUDED.disclosure_method,
       buyer_confirmation = EXCLUDED.buyer_confirmation,
       evidence_ref = EXCLUDED.evidence_ref,
       occurred_at = EXCLUDED.occurred_at`,
    [
      orderId,
      phase,
      row.seller_id,
      row.buyer_id,
      foodRef.rows[0].food_id,
      JSON.stringify(input.allergenSnapshot),
      input.disclosureMethod,
      input.buyerConfirmation,
      input.evidenceRef ?? null,
      input.occurredAt ?? new Date().toISOString(),
    ]
  );
  return res.status(201).json({ data: { orderId, phase, saved: true } });
}
