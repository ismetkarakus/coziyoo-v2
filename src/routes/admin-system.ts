import { readFile } from "node:fs/promises";
import path from "node:path";
import { Router } from "express";
import { z } from "zod";
import { pool } from "../db/client.js";
import { requireSuperAdmin } from "../middleware/admin-rbac.js";
import { requireAuth } from "../middleware/auth.js";

const ResetDatabaseSchema = z.object({
  confirmText: z.literal("RESET DATABASE"),
});

export const adminSystemRouter = Router();

adminSystemRouter.post("/system/reset-database", requireAuth("admin"), requireSuperAdmin, async (req, res) => {
  const parsed = ResetDatabaseSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    return res.status(400).json({
      error: {
        code: "VALIDATION_ERROR",
        message: 'confirmText must be "RESET DATABASE"',
        details: parsed.error.flatten(),
      },
    });
  }

  const sqlPath = path.resolve(process.cwd(), "src/db/reset-and-init-schema.sql");
  const sql = await readFile(sqlPath, "utf8");
  await pool.query(sql);

  return res.json({
    data: {
      ok: true,
      message: "Database reset and schema reinitialized.",
    },
  });
});
