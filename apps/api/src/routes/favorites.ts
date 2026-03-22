import { Router } from "express";
import { pool } from "../db/client.js";
import { requireAuth } from "../middleware/auth.js";

export const favoritesRouter = Router();

favoritesRouter.use(requireAuth("app"));

/**
 * GET /v1/favorites
 * List favorite foods for the authenticated user.
 */
favoritesRouter.get("/", async (req, res) => {
  try {
    const { rows } = await pool.query(
      `SELECT
         f.id,
         f.name,
         f.price,
         f.image_url,
         f.rating,
         u.display_name AS seller_name
       FROM favorites fav
       JOIN foods f ON f.id = fav.food_id
       JOIN users u ON u.id = f.seller_id
       WHERE fav.user_id = $1
       ORDER BY fav.created_at DESC`,
      [req.auth!.userId],
    );

    const favorites = rows.map((r) => ({
      id: r.id as string,
      name: r.name as string,
      price: parseFloat(r.price),
      imageUrl: (r.image_url as string | null) ?? null,
      rating: r.rating ? parseFloat(r.rating).toFixed(1) : null,
      sellerName: r.seller_name as string,
    }));

    res.json({ data: favorites });
  } catch (err) {
    console.error("[favorites] list error:", err);
    res.status(500).json({ error: { code: "INTERNAL_ERROR", message: "Failed to load favorites" } });
  }
});

/**
 * POST /v1/favorites/:foodId
 * Add a food to favorites.
 */
favoritesRouter.post("/:foodId", async (req, res) => {
  try {
    const { foodId } = req.params;

    // Check food exists
    const food = await pool.query("SELECT id FROM foods WHERE id = $1", [foodId]);
    if (food.rows.length === 0) {
      return res.status(404).json({ error: { code: "FOOD_NOT_FOUND", message: "Food not found" } });
    }

    await pool.query(
      `INSERT INTO favorites (user_id, food_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`,
      [req.auth!.userId, foodId],
    );

    res.status(201).json({ data: { foodId, added: true } });
  } catch (err) {
    console.error("[favorites] add error:", err);
    res.status(500).json({ error: { code: "INTERNAL_ERROR", message: "Failed to add favorite" } });
  }
});

/**
 * DELETE /v1/favorites/:foodId
 * Remove a food from favorites.
 */
favoritesRouter.delete("/:foodId", async (req, res) => {
  try {
    const { foodId } = req.params;

    const result = await pool.query(
      "DELETE FROM favorites WHERE user_id = $1 AND food_id = $2",
      [req.auth!.userId, foodId],
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ error: { code: "NOT_FOUND", message: "Favorite not found" } });
    }

    res.json({ data: { foodId, removed: true } });
  } catch (err) {
    console.error("[favorites] remove error:", err);
    res.status(500).json({ error: { code: "INTERNAL_ERROR", message: "Failed to remove favorite" } });
  }
});
