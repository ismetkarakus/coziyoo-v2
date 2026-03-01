import type { Request } from "express";

export type AppActorRole = "buyer" | "seller";

export function resolveActorRole(req: Request): AppActorRole | null {
  const tokenRole = req.auth?.role;
  if (!tokenRole) return null;

  if (tokenRole === "buyer" || tokenRole === "seller") {
    return tokenRole;
  }

  if (tokenRole === "both") {
    const headerRole = String(req.headers["x-actor-role"] ?? "").toLowerCase();
    if (headerRole === "buyer" || headerRole === "seller") {
      return headerRole;
    }
    return null;
  }

  return null;
}

