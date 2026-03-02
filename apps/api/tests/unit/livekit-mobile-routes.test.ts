import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";

async function bootApp() {
  vi.resetModules();
  vi.stubEnv("NODE_ENV", "test");
  vi.stubEnv("HOST", "127.0.0.1");
  vi.stubEnv("PORT", "3000");
  vi.stubEnv("APP_JWT_SECRET", "test_app_jwt_secret_1234567890_abcdef");
  vi.stubEnv("ADMIN_JWT_SECRET", "test_admin_jwt_secret_1234567890_abcd");
  vi.stubEnv("PAYMENT_WEBHOOK_SECRET", "test_payment_webhook_secret_12345");
  vi.stubEnv("PGHOST", "127.0.0.1");
  vi.stubEnv("PGPORT", "5432");
  vi.stubEnv("PGUSER", "coziyoo");
  vi.stubEnv("PGPASSWORD", "coziyoo");
  vi.stubEnv("PGDATABASE", "coziyoo");
  vi.stubEnv("LIVEKIT_URL", "wss://livekit.test.local");
  vi.stubEnv("LIVEKIT_API_KEY", "lk_test_key");
  vi.stubEnv("LIVEKIT_API_SECRET", "lk_test_secret");

  const { app } = await import("../../src/app.js");
  const { signAccessToken } = await import("../../src/services/token-service.js");

  const server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const address = server.address() as AddressInfo;

  const token = signAccessToken({
    sub: "user_test_1",
    sessionId: "session_test_1",
    realm: "app",
    role: "buyer",
  });

  return {
    server,
    baseUrl: `http://127.0.0.1:${address.port}`,
    token,
  };
}

async function shutdown(server: Server) {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) reject(error);
      else resolve();
    });
  });
}

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("livekit mobile routes", () => {
  it("accepts mobile telemetry payload with app auth", async () => {
    const app = await bootApp();

    try {
      const response = await fetch(`${app.baseUrl}/v1/livekit/mobile/telemetry`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${app.token}`,
        },
        body: JSON.stringify({
          level: "info",
          eventType: "session_started",
          message: "voice started",
          roomName: "coziyoo-room-test",
          metadata: { source: "mobile" },
        }),
      });

      expect(response.status).toBe(201);
      const json = (await response.json()) as { data?: { accepted?: boolean } };
      expect(json.data?.accepted).toBe(true);
    } finally {
      await shutdown(app.server);
    }
  });

  it("rejects invalid start session metadata payload", async () => {
    const app = await bootApp();

    try {
      const response = await fetch(`${app.baseUrl}/v1/livekit/session/start`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: `Bearer ${app.token}`,
        },
        body: JSON.stringify({
          participantName: "mobile-user",
          autoDispatchAgent: false,
          channel: "mobile",
          deviceId: "bad",
          settingsProfileId: "profile-a",
        }),
      });

      expect(response.status).toBe(400);
      const json = (await response.json()) as { error?: { code?: string } };
      expect(json.error?.code).toBe("VALIDATION_ERROR");
    } finally {
      await shutdown(app.server);
    }
  });
});
