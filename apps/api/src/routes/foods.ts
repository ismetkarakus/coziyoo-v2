import { Router } from "express";
import { pool } from "../db/client.js";
import { requireAuth } from "../middleware/auth.js";

export const foodsRouter = Router();

foodsRouter.use(requireAuth("app"));

function parseAllergens(value: unknown): string[] {
  if (!value) return [];
  if (Array.isArray(value)) {
    return value
      .map((item) => String(item ?? "").trim())
      .filter((item) => item.length > 0);
  }
  if (typeof value === "string") {
    return value
      .split(",")
      .map((item) => item.trim())
      .filter((item) => item.length > 0);
  }
  if (typeof value === "object") {
    return Object.values(value as Record<string, unknown>)
      .map((item) => String(item ?? "").trim())
      .filter((item) => item.length > 0);
  }
  return [];
}

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
        f.allergens_json,
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
      allergens: parseAllergens(r.allergens_json),
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

/**
 * GET /v1/foods/sellers/:sellerId/reviews
 * List recent reviews for a seller.
 */
foodsRouter.get("/sellers/:sellerId/reviews", async (req, res) => {
  try {
    const { sellerId } = req.params;
    const { rows } = await pool.query(
      `
        SELECT
          r.id,
          r.rating,
          r.comment,
          r.created_at,
          f.name AS food_name,
          COALESCE(b.display_name, 'Anonim Kullanici') AS buyer_name
        FROM reviews r
        JOIN foods f ON f.id = r.food_id
        LEFT JOIN users b ON b.id = r.buyer_id
        WHERE r.seller_id = $1
        ORDER BY r.created_at DESC
        LIMIT 50
      `,
      [sellerId],
    );

    const reviews = rows.map((r) => ({
      id: r.id as string,
      rating: Number(r.rating),
      comment: (r.comment as string | null) ?? "",
      foodName: r.food_name as string,
      buyerName: r.buyer_name as string,
      createdAt: new Date(r.created_at).toISOString(),
    }));

    res.json({ data: reviews });
  } catch (err) {
    console.error("[foods] seller reviews error:", err);
    res.status(500).json({
      error: { code: "INTERNAL_ERROR", message: "Failed to load seller reviews" },
    });
  }
});
