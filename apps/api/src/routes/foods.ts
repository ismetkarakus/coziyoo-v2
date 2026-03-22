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

function pickRandom<T>(items: readonly T[]): T {
  return items[Math.floor(Math.random() * items.length)]!;
}

function buildRecommendationReason(input: {
  foodName: string;
  isUntried: boolean;
  isTopSold: boolean;
  userOrderCount: number;
}): string {
  const { foodName, isUntried, isTopSold, userOrderCount } = input;
  const normalized = foodName.trim();

  if (isUntried && isTopSold) {
    return pickRandom([
      `Hep aynı şeyleri yiyorsun, ${normalized}'a ne dersin?`,
      `${normalized} çok satanlarda üstte, bence bir dene.`,
      `${normalized} bayağı tutuluyor, bugün ona gidelim mi?`,
      `Yeni bir şey deneyelim: ${normalized} çok iyi gidiyor.`,
    ]);
  }

  if (isUntried) {
    return pickRandom([
      `${normalized}'ı daha önce denemedin, bugün şans verelim mi?`,
      `Bugün farklı gidelim: ${normalized} nasıl olur?`,
      `${normalized} güzel bir değişiklik olabilir.`,
    ]);
  }

  if (isTopSold) {
    return pickRandom([
      `${normalized} çok satanlardan, yine iyi gider.`,
      `Çok satanlarda ${normalized} var, bir kez daha iyi gider.`,
      `${normalized} yine trendde, kaçırma derim.`,
    ]);
  }

  if (userOrderCount > 0) {
    return pickRandom([
      `${normalized} senden tam not almıştı, tekrar ister misin?`,
      `Bunu sevdiğini biliyorum: ${normalized}.`,
      `${normalized} yine iyi gider gibi duruyor.`,
    ]);
  }

  return pickRandom([
    `Bugün ${normalized} deneyebilirsin.`,
    `${normalized} iyi bir tercih olur.`,
    `${normalized} için içimden iyi bir his geçiyor.`,
  ]);
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
        f.ingredients_json,
        f.cuisine,
        (
          SELECT pl.id
          FROM production_lots pl
          WHERE pl.food_id = f.id
            AND pl.status IN ('open', 'active')
            AND pl.quantity_available > 0
            AND (pl.sale_starts_at IS NULL OR pl.sale_starts_at <= NOW())
            AND (pl.sale_ends_at IS NULL OR pl.sale_ends_at > NOW())
          ORDER BY pl.quantity_available DESC, pl.created_at DESC
          LIMIT 1
        ) AS lot_id,
        f.is_active,
        c.name_tr AS category,
        u.id AS seller_id,
        u.display_name AS seller_name,
        u.profile_image_url AS seller_image,
        COALESCE(
          (SELECT SUM(pl.quantity_available)
           FROM production_lots pl
           WHERE pl.food_id = f.id
             AND pl.status IN ('open', 'active')
             AND pl.quantity_available > 0
             AND (pl.sale_starts_at IS NULL OR pl.sale_starts_at <= NOW())
             AND (pl.sale_ends_at IS NULL OR pl.sale_ends_at > NOW())
          ), 0
        )::int AS stock
      FROM foods f
      JOIN users u ON u.id = f.seller_id
      LEFT JOIN categories c ON c.id = f.category_id
      WHERE f.is_active = true
        AND EXISTS (
          SELECT 1
          FROM production_lots plx
          WHERE plx.food_id = f.id
            AND plx.status IN ('open', 'active')
            AND plx.quantity_available > 0
            AND (plx.sale_starts_at IS NULL OR plx.sale_starts_at <= NOW())
            AND (plx.sale_ends_at IS NULL OR plx.sale_ends_at > NOW())
        )
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
      ingredients: parseAllergens(r.ingredients_json),
      cuisine: r.cuisine ?? null,
      lotId: r.lot_id ?? null,
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
 * GET /v1/foods/top-sold
 * List most sold dishes aggregated across all sellers by dish name.
 * Query params: limit (default 12, max 50)
 */
foodsRouter.get("/top-sold", async (req, res) => {
  try {
    const rawLimit = Number.parseInt(String(req.query.limit ?? "12"), 10);
    const limit = Number.isFinite(rawLimit) ? Math.min(Math.max(rawLimit, 1), 50) : 12;

    const { rows } = await pool.query(
      `
        WITH per_food AS (
          SELECT
            f.id,
            f.name,
            f.image_url,
            f.rating,
            f.review_count,
            COALESCE(SUM(oi.quantity), 0)::int AS sold_qty
          FROM order_items oi
          JOIN orders o ON o.id = oi.order_id
          JOIN foods f ON f.id = oi.food_id
          WHERE o.payment_completed = TRUE
            AND o.status IN ('paid', 'preparing', 'ready', 'in_delivery', 'delivered', 'completed')
          GROUP BY f.id, f.name, f.image_url, f.rating, f.review_count
        ),
        by_name AS (
          SELECT
            lower(trim(name)) AS name_key,
            MIN(name) AS name,
            SUM(sold_qty)::int AS total_sold
          FROM per_food
          GROUP BY lower(trim(name))
        ),
        top_visual AS (
          SELECT
            lower(trim(name)) AS name_key,
            id AS food_id,
            image_url,
            ROW_NUMBER() OVER (
              PARTITION BY lower(trim(name))
              ORDER BY sold_qty DESC, review_count DESC NULLS LAST, rating DESC NULLS LAST, id
            ) AS rn
          FROM per_food
        )
        SELECT
          b.name,
          b.total_sold,
          tv.food_id,
          tv.image_url
        FROM by_name b
        LEFT JOIN top_visual tv
          ON tv.name_key = b.name_key
         AND tv.rn = 1
        ORDER BY b.total_sold DESC, b.name ASC
        LIMIT $1
      `,
      [limit],
    );

    const data = rows.map((r) => ({
      id: r.food_id ?? `dish-${String(r.name ?? "").toLowerCase()}`,
      name: r.name as string,
      imageUrl: (r.image_url as string | null) ?? null,
      totalSold: Number(r.total_sold ?? 0),
    }));

    res.json({ data });
  } catch (err) {
    console.error("[foods] top sold error:", err);
    res.status(500).json({
      error: { code: "INTERNAL_ERROR", message: "Failed to load top sold foods" },
    });
  }
});

/**
 * GET /v1/foods/recommendations
 * Personalized recommendations for current buyer:
 * - prioritize foods the buyer has not ordered before
 * - mix in top sellers
 * - occasionally include familiar top sellers
 */
foodsRouter.get("/recommendations", async (req, res) => {
  try {
    const rawLimit = Number.parseInt(String(req.query.limit ?? "8"), 10);
    const limit = Number.isFinite(rawLimit) ? Math.min(Math.max(rawLimit, 1), 30) : 8;
    const buyerId = req.auth?.userId;

    const { rows } = await pool.query(
      `
        WITH available_foods AS (
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
            f.ingredients_json,
            f.cuisine,
            (
              SELECT pl.id
              FROM production_lots pl
              WHERE pl.food_id = f.id
                AND pl.status IN ('open', 'active')
                AND pl.quantity_available > 0
                AND (pl.sale_starts_at IS NULL OR pl.sale_starts_at <= NOW())
                AND (pl.sale_ends_at IS NULL OR pl.sale_ends_at > NOW())
              ORDER BY pl.quantity_available DESC, pl.created_at DESC
              LIMIT 1
            ) AS lot_id,
            c.name_tr AS category,
            u.id AS seller_id,
            u.display_name AS seller_name,
            u.profile_image_url AS seller_image,
            COALESCE(
              (SELECT SUM(pl.quantity_available)
               FROM production_lots pl
               WHERE pl.food_id = f.id
                 AND pl.status IN ('open', 'active')
                 AND pl.quantity_available > 0
                 AND (pl.sale_starts_at IS NULL OR pl.sale_starts_at <= NOW())
                 AND (pl.sale_ends_at IS NULL OR pl.sale_ends_at > NOW())
              ), 0
            )::int AS stock
          FROM foods f
          JOIN users u ON u.id = f.seller_id
          LEFT JOIN categories c ON c.id = f.category_id
          WHERE f.is_active = TRUE
            AND EXISTS (
              SELECT 1
              FROM production_lots plx
              WHERE plx.food_id = f.id
                AND plx.status IN ('open', 'active')
                AND plx.quantity_available > 0
                AND (plx.sale_starts_at IS NULL OR plx.sale_starts_at <= NOW())
                AND (plx.sale_ends_at IS NULL OR plx.sale_ends_at > NOW())
            )
        ),
        user_history AS (
          SELECT
            oi.food_id,
            SUM(oi.quantity)::int AS user_order_count
          FROM order_items oi
          JOIN orders o ON o.id = oi.order_id
          WHERE o.buyer_id = $1
            AND o.payment_completed = TRUE
            AND o.status IN ('delivered', 'completed')
          GROUP BY oi.food_id
        ),
        global_sales AS (
          SELECT
            oi.food_id,
            SUM(oi.quantity)::int AS total_sold
          FROM order_items oi
          JOIN orders o ON o.id = oi.order_id
          WHERE o.payment_completed = TRUE
            AND o.status IN ('paid', 'preparing', 'ready', 'in_delivery', 'delivered', 'completed')
          GROUP BY oi.food_id
        )
        SELECT
          af.*,
          COALESCE(uh.user_order_count, 0)::int AS user_order_count,
          COALESCE(gs.total_sold, 0)::int AS total_sold
        FROM available_foods af
        LEFT JOIN user_history uh ON uh.food_id = af.id
        LEFT JOIN global_sales gs ON gs.food_id = af.id
      `,
      [buyerId],
    );

    const maxSold = rows.reduce((max, r) => Math.max(max, Number(r.total_sold ?? 0)), 0);
    const topSoldThreshold = Math.max(3, Math.floor(maxSold * 0.4));

    const scored = rows.map((r) => {
      const userOrderCount = Number(r.user_order_count ?? 0);
      const totalSold = Number(r.total_sold ?? 0);
      const isUntried = userOrderCount === 0;
      const isTopSold = totalSold >= topSoldThreshold;

      let score = 0;
      if (isUntried) score += 55;
      else score += Math.max(6, 22 - userOrderCount * 4);

      score += Math.log1p(totalSold) * 12;
      if (isTopSold) score += 18;
      if (!isUntried && isTopSold && Math.random() < 0.3) score += 10;
      if (isUntried && totalSold === 0) score -= 10;
      score += Math.random() * 12;

      const reason = buildRecommendationReason({
        foodName: String(r.name ?? ""),
        isUntried,
        isTopSold,
        userOrderCount,
      });

      return {
        score,
        item: {
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
          ingredients: parseAllergens(r.ingredients_json),
          cuisine: r.cuisine ?? null,
          lotId: r.lot_id ?? null,
          category: r.category,
          stock: Number(r.stock ?? 0),
          totalSold,
          reason,
          seller: {
            id: r.seller_id,
            name: r.seller_name,
            image: r.seller_image,
          },
        },
      };
    });

    scored.sort((a, b) => b.score - a.score);
    res.json({ data: scored.slice(0, limit).map((x) => x.item) });
  } catch (err) {
    console.error("[foods] recommendations error:", err);
    res.status(500).json({
      error: { code: "INTERNAL_ERROR", message: "Failed to load recommendations" },
    });
  }
});

/**
 * GET /v1/foods/sellers/:sellerId/foods
 * List active/available foods for a specific seller.
 */
foodsRouter.get("/sellers/:sellerId/foods", async (req, res) => {
  try {
    const { sellerId } = req.params;
    const { rows } = await pool.query(
      `
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
          f.ingredients_json,
          f.cuisine,
          (
            SELECT pl.id
            FROM production_lots pl
            WHERE pl.food_id = f.id
              AND pl.status IN ('open', 'active')
              AND pl.quantity_available > 0
              AND (pl.sale_starts_at IS NULL OR pl.sale_starts_at <= NOW())
              AND (pl.sale_ends_at IS NULL OR pl.sale_ends_at > NOW())
            ORDER BY pl.quantity_available DESC, pl.created_at DESC
            LIMIT 1
          ) AS lot_id,
          c.name_tr AS category,
          u.id AS seller_id,
          u.display_name AS seller_name,
          u.profile_image_url AS seller_image,
          COALESCE(
            (SELECT SUM(pl.quantity_available)
             FROM production_lots pl
             WHERE pl.food_id = f.id
               AND pl.status IN ('open', 'active')
               AND pl.quantity_available > 0
               AND (pl.sale_starts_at IS NULL OR pl.sale_starts_at <= NOW())
               AND (pl.sale_ends_at IS NULL OR pl.sale_ends_at > NOW())
            ), 0
          )::int AS stock
        FROM foods f
        JOIN users u ON u.id = f.seller_id
        LEFT JOIN categories c ON c.id = f.category_id
        WHERE f.seller_id = $1
          AND f.is_active = true
          AND EXISTS (
            SELECT 1
            FROM production_lots plx
            WHERE plx.food_id = f.id
              AND plx.status IN ('open', 'active')
              AND plx.quantity_available > 0
              AND (plx.sale_starts_at IS NULL OR plx.sale_starts_at <= NOW())
              AND (plx.sale_ends_at IS NULL OR plx.sale_ends_at > NOW())
          )
        ORDER BY f.rating DESC NULLS LAST, f.created_at DESC
      `,
      [sellerId],
    );

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
      ingredients: parseAllergens(r.ingredients_json),
      cuisine: r.cuisine ?? null,
      lotId: r.lot_id ?? null,
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
    console.error("[foods] seller foods error:", err);
    res.status(500).json({
      error: { code: "INTERNAL_ERROR", message: "Failed to load seller foods" },
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
