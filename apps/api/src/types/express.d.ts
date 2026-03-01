import type { AuthRealm } from "../services/token-service.js";

declare global {
  namespace Express {
    interface Request {
      auth?: {
        userId: string;
        sessionId: string;
        realm: AuthRealm;
        role: string;
      };
      rawBody?: string;
      requestId?: string;
      idempotency?: {
        scope: string;
        keyHash: string;
        requestHash: string;
      };
    }
  }
}

export {};
