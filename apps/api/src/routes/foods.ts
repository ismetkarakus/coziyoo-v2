import { Router } from "express";
import { pool } from "../db/client.js";
import { requireAuth } from "../middleware/auth.js";

export const foodsRouter = Router();

foodsRouter.use(requireAuth("app"));

/**
 * GET /v1/foods
 * List active foods with seller info, category, and available lot stock.
 * Query params: category (category name_tr filter)
 */
foodsRouter.get("/", async (req, res) => {
  try {
    const categoryFilter = req.query.category as string | undefined;

    let query = `
      SELECT
        f.id,
        f.name,
        f.card_summary,
        f.description,
        f.price,
        f.image_url,
        f.rating,
        f.review_count,
        f.preparation_time_minutes,
        f.max_delivery_distance_km,
        f.is_active,
        c.name_tr AS category,
        u.id AS seller_id,
        u.display_name AS seller_name,
        u.profile_image_url AS seller_image,
        COALESCE(
          (SELECT SUM(pl.quantity_available)
           FROM production_lots pl
           WHERE pl.food_id = f.id
             AND pl.status = 'open'
             AND (pl.sale_ends_at IS NULL OR pl.sale_ends_at > NOW())
          ), 0
        )::int AS stock
      FROM foods f
      JOIN users u ON u.id = f.seller_id
      LEFT JOIN categories c ON c.id = f.category_id
      WHERE f.is_active = true
    `;

    const params: string[] = [];

    if (categoryFilter && categoryFilter !== "Tumu") {
      params.push(categoryFilter);
      query += ` AND c.name_tr = $${params.length}`;
    }

    query += ` ORDER BY f.rating DESC NULLS LAST, f.created_at DESC`;

    const { rows } = await pool.query(query, params);

    const foods = rows.map((r) => ({
      id: r.id,
      name: r.name,
      cardSummary: r.card_summary,
      description: r.description,
      price: parseFloat(r.price),
      imageUrl: r.image_url,
      rating: r.rating ? parseFloat(r.rating).toFixed(1) : null,
      reviewCount: r.review_count,
      prepTime: r.preparation_time_minutes,
      maxDistance: r.max_delivery_distance_km
        ? parseFloat(r.max_delivery_distance_km)
        : null,
      category: r.category,
      stock: r.stock,
      seller: {
        id: r.seller_id,
        name: r.seller_name,
        image: r.seller_image,
      },
    }));

    res.json({ data: foods });
  } catch (err) {
    console.error("[foods] list error:", err);
    res.status(500).json({
      error: { code: "INTERNAL_ERROR", message: "Failed to load foods" },
    });
  }
});
