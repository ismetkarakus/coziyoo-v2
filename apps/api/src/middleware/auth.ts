import type { NextFunction, Request, Response } from "express";
import { verifyAccessToken, type AuthRealm } from "../services/token-service.js";

export function requireAuth(realm: AuthRealm) {
  return (req: Request, res: Response, next: NextFunction) => {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith("Bearer ")) {
      return res.status(401).json({ error: { code: "UNAUTHORIZED", message: "Missing bearer token" } });
    }

    const token = authHeader.slice("Bearer ".length);
    try {
      const payload = verifyAccessToken(token, realm);
      if (payload.realm !== realm) {
        return res.status(403).json({
          error: { code: "AUTH_REALM_MISMATCH", message: "Token realm not allowed for this endpoint" },
        });
      }
      req.auth = {
        userId: payload.sub,
        sessionId: payload.sessionId,
        realm: payload.realm,
        role: payload.role,
      };
      return next();
    } catch {
      return res.status(401).json({ error: { code: "TOKEN_INVALID", message: "Invalid or expired token" } });
    }
  };
}

