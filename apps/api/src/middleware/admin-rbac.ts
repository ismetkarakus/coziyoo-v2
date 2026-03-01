import type { NextFunction, Request, Response } from "express";

export function requireSuperAdmin(req: Request, res: Response, next: NextFunction) {
  if (!req.auth) {
    return res.status(401).json({ error: { code: "UNAUTHORIZED", message: "Missing auth context" } });
  }

  if (req.auth.role !== "super_admin") {
    return res.status(403).json({
      error: {
        code: "FORBIDDEN_ROLE",
        message: "This action requires super_admin role",
      },
    });
  }

  return next();
}
