import express from "express";
import http from "node:http";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

vi.mock("../../middleware/auth.js", () => ({
  requireAuth: () => (_req: express.Request, _res: express.Response, next: express.NextFunction) => next(),
}));

import { adminLiveKitRouter } from "../admin-livekit.js";

describe("POST /v1/admin/livekit/llm/models", () => {
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

  async function postModels(body: Record<string, unknown>) {
    server = app.listen(0);
    await new Promise<void>((resolve) => server!.once("listening", () => resolve()));
    const address = server.address();
    const port = typeof address === "object" && address ? address.port : 0;

    return new Promise<{ status: number; json: unknown }>((resolve, reject) => {
      const payload = JSON.stringify(body);
      const req = http.request(
        {
          hostname: "127.0.0.1",
          port,
          path: "/v1/admin/livekit/llm/models",
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Content-Length": Buffer.byteLength(payload),
          },
        },
        (res) => {
          let responseText = "";
          res.setEncoding("utf8");
          res.on("data", (chunk) => {
            responseText += chunk;
          });
          res.on("end", () => {
            try {
              resolve({
                status: res.statusCode ?? 0,
                json: JSON.parse(responseText || "{}"),
              });
            } catch (err) {
              reject(err);
            }
          });
        },
      );

      req.on("error", reject);
      req.write(payload);
      req.end();
    });
  }

  it("parses ollama /api/tags model shape", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue(
        new Response(
          JSON.stringify({
            models: [
              { name: "llama3.1:8b" },
              { model: "qwen2.5:7b" },
            ],
          }),
          { status: 200, headers: { "Content-Type": "application/json" } },
        ),
      ),
    );

    const response = await postModels({
      baseUrl: "https://ollama.drascom.uk",
      modelsPath: "/api/tags",
      apiKey: "",
      customHeaders: {},
    });

    expect(response.status).toBe(200);
    const payload = response.json as { data?: { models?: string[] } };
    expect(payload.data?.models).toEqual(["llama3.1:8b", "qwen2.5:7b"]);
  });
});

