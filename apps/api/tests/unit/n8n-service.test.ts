import { afterEach, describe, expect, it, vi } from "vitest";

async function loadService() {
  vi.resetModules();
  return import("../../src/services/n8n.js");
}

function stubCoreEnv() {
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
}

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("n8n service status", () => {
  it("checks workflow accessibility after health check", async () => {
    stubCoreEnv();
    vi.stubEnv("N8N_BASE_URL", "https://n8n.example.com");
    vi.stubEnv("N8N_API_KEY", "test-n8n-key");

    const fetchMock = vi
      .fn<typeof fetch>()
      .mockImplementation(async (input: RequestInfo | URL): Promise<Response> => {
        const url = String(input);
        if (url.endsWith("/healthz")) {
          return new Response("ok", { status: 200 });
        }
        if (url.includes("/api/v1/workflows/6KFFgjd26nF0kNCA")) {
          return new Response("{}", { status: 200 });
        }
        if (url.includes("/api/v1/workflows/XYiIkxpa4PlnddQt")) {
          return new Response("{}", { status: 404 });
        }
        return new Response("not-found", { status: 404 });
      });
    vi.stubGlobal("fetch", fetchMock);

    const { getN8nStatus } = await loadService();
    const status = await getN8nStatus({
      workflowIds: ["6KFFgjd26nF0kNCA", "XYiIkxpa4PlnddQt"],
    });

    expect(status.configured).toBe(true);
    expect(status.reachable).toBe(true);
    expect(status.baseUrl).toBe("https://n8n.example.com");
    expect(status.workflows["6KFFgjd26nF0kNCA"]).toEqual({ reachable: true, status: 200 });
    expect(status.workflows["XYiIkxpa4PlnddQt"]).toEqual({ reachable: false, status: 404 });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});
