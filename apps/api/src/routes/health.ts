import { Router } from "express";
import { pingDatabase } from "../db/client.js";

export const healthRouter = Router();

healthRouter.get("/", async (_req, res) => {
  try {
    const db = await pingDatabase();
    res.json({
      data: {
        service: "coziyoo-api-v2",
        version: "v1",
        status: "ok",
        db: "connected",
        dbTime: db.now,
      },
    });
  } catch (error) {
    res.status(503).json({
      data: {
        service: "coziyoo-api-v2",
        version: "v1",
        status: "degraded",
        db: "disconnected",
      },
      error: error instanceof Error ? error.message : "Database unavailable",
    });
  }
});

