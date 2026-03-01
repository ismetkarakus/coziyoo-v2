import jwt from "jsonwebtoken";
import { env } from "../config/env.js";

export type AuthRealm = "app" | "admin";

export type AccessTokenPayload = {
  sub: string;
  sessionId: string;
  realm: AuthRealm;
  role: string;
};

type SignAccessTokenOptions = {
  expiresInMinutes?: number | null;
};

export function signAccessToken(payload: AccessTokenPayload, options: SignAccessTokenOptions = {}): string {
  const secret = payload.realm === "admin" ? env.ADMIN_JWT_SECRET : env.APP_JWT_SECRET;
  if (options.expiresInMinutes === null) {
    return jwt.sign(payload, secret);
  }

  const expiresInMinutes = options.expiresInMinutes ?? env.ACCESS_TOKEN_TTL_MINUTES;
  return jwt.sign(payload, secret, {
    expiresIn: `${expiresInMinutes}m`,
  });
}

export function verifyAccessToken(token: string, realm: AuthRealm): AccessTokenPayload {
  const secret = realm === "admin" ? env.ADMIN_JWT_SECRET : env.APP_JWT_SECRET;
  return jwt.verify(token, secret) as AccessTokenPayload;
}

export function refreshTokenExpiresAt(): Date {
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + env.REFRESH_TOKEN_TTL_DAYS);
  return expiresAt;
}
