import express from "express";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../middleware/auth.js", () => ({
  requireAuth: () => (_req: express.Request, _res: express.Response, next: express.NextFunction) => next(),
}));

import { adminLiveKitRouter } from "../admin-livekit.js";

describe("POST /v1/admin/livekit/test/llm", () => {
  let app: express.Express;
  let server: ReturnType<express.Express["listen"]> | null = null;

  beforeEach(() => {
    app = express();
    app.use(express.json());
    app.use("/v1/admin/livekit", adminLiveKitRouter);
  });

  afterEach(async () => {
    vi.restoreAllMocks();
    if (server) {
      await new Promise<void>((resolve, reject) => {
        server!.close((err) => (err ? reject(err) : resolve()));
      });
      server = null;
    }
  });

  async function post(body: Record<string, unknown>) {
    server = app.listen(0);
    await new Promise<void>((resolve) => server!.once("listening", () => resolve()));
    const address = server.address();
    const port = typeof address === "object" && address ? address.port : 0;
    return fetch(`http://127.0.0.1:${port}/v1/admin/livekit/test/llm`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  it("returns success payload with upstream status for valid request", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(JSON.stringify({ id: "chatcmpl_123" }), {
          status: 200,
          headers: { "Content-Type": "application/json" },
        }),
      ),
    );

    const response = await post({
      baseUrl: "https://api.example.com",
      endpointPath: "/v1/chat/completions",
      apiKey: "sk-test-key",
      model: "gpt-4o-mini",
      customHeaders: {},
      customBodyParams: {},
    });

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.data.ok).toBe(true);
    expect(payload.data.status).toBe(200);
  });

  it("returns non-2xx error payload when upstream is unreachable", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("connect ECONNREFUSED")));

    const response = await post({
      baseUrl: "https://api.example.com",
      endpointPath: "/v1/chat/completions",
      apiKey: "sk-test-key",
      model: "gpt-4o-mini",
      customHeaders: {},
      customBodyParams: {},
    });

    expect(response.status).toBe(502);
    const payload = await response.json();
    expect(payload.error?.code).toBe("LLM_TEST_FAILED");
    expect(payload.error?.message).toContain("ECONNREFUSED");
  });

  it("forwards endpoint path, headers, and body overrides from model config", async () => {
    const mockedFetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ id: "chatcmpl_abc" }), {
        status: 201,
        headers: { "Content-Type": "application/json" },
      }),
    );
    vi.stubGlobal("fetch", mockedFetch);

    const response = await post({
      baseUrl: "https://api.example.com/",
      endpointPath: "/custom/chat",
      apiKey: "sk-override",
      model: "gpt-4.1-mini",
      customHeaders: {
        "x-tenant-id": "coziyoo",
      },
      customBodyParams: {
        temperature: "0.7",
        stream: "false",
      },
      prompt: "Merhaba",
    });

    expect(response.status).toBe(200);
    expect(mockedFetch).toHaveBeenCalledTimes(1);

    const [url, init] = mockedFetch.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.example.com/custom/chat");
    expect(init.method).toBe("POST");

    const headers = init.headers as Record<string, string>;
    expect(headers.Authorization).toBe("Bearer sk-override");
    expect(headers["x-tenant-id"]).toBe("coziyoo");

    const body = JSON.parse(String(init.body)) as Record<string, unknown>;
    expect(body.model).toBe("gpt-4.1-mini");
    expect(body.messages).toEqual([{ role: "user", content: "Merhaba" }]);
    expect(body.temperature).toBe(0.7);
    expect(body.stream).toBe(false);
  });
});
