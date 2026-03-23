import express from "express";
import http from "node:http";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { upsertStarterAgentSettingsMock, getStarterAgentSettingsMock } = vi.hoisted(() => ({
  upsertStarterAgentSettingsMock: vi.fn(),
  getStarterAgentSettingsMock: vi.fn(),
}));

vi.mock("../../middleware/auth.js", () => ({
  requireAuth: () => (_req: express.Request, _res: express.Response, next: express.NextFunction) => next(),
}));

vi.mock("../../services/starter-agent-settings.js", () => ({
  createDefaultStarterAgentSettings: vi.fn((deviceId: string) => ({
    deviceId,
    agentName: "coziyoo-agent",
    voiceLanguage: "tr",
    ollamaModel: "llama3.1:8b",
    ttsEngine: "chatterbox",
    ttsConfig: {},
    ttsServers: null,
    activeTtsServerId: null,
    ttsEnabled: true,
    sttEnabled: true,
    systemPrompt: null,
    greetingEnabled: true,
    greetingInstruction: null,
    updatedAt: new Date().toISOString(),
  })),
  createDefaultStarterTtsConfig: vi.fn(() => ({})),
  ensureStarterAgentIsActiveColumn: vi.fn(),
  getStarterAgentSettings: getStarterAgentSettingsMock,
  hasStarterAgentIsActiveColumn: vi.fn(async () => true),
  upsertStarterAgentSettings: upsertStarterAgentSettingsMock,
}));

import { adminLiveKitRouter } from "../admin-livekit.js";

describe("PUT /v1/admin/livekit/agent-settings/:deviceId", () => {
  let app: express.Express;
  let server: ReturnType<express.Express["listen"]> | null = null;

  beforeEach(() => {
    upsertStarterAgentSettingsMock.mockReset();
    getStarterAgentSettingsMock.mockReset();

    getStarterAgentSettingsMock.mockResolvedValue({
      deviceId: "default",
      agentName: "coziyoo-agent",
      voiceLanguage: "tr",
      ollamaModel: "llama3.1:8b",
      ttsEngine: "chatterbox",
      ttsConfig: {
        baseUrl: "https://chatter.drascom.uk",
        llm: {
          baseUrl: "https://ollama.drascom.uk",
          model: "llama3.1:8b",
        },
      },
      ttsServers: null,
      activeTtsServerId: null,
      ttsEnabled: true,
      sttEnabled: true,
      systemPrompt: "",
      greetingEnabled: true,
      greetingInstruction: "",
      updatedAt: new Date().toISOString(),
    });

    upsertStarterAgentSettingsMock.mockImplementation(async (input: Record<string, unknown>) => ({
      deviceId: "default",
      agentName: input.agentName,
      voiceLanguage: input.voiceLanguage,
      ollamaModel: input.ollamaModel,
      ttsEngine: "chatterbox",
      ttsConfig: input.ttsConfig,
      ttsServers: null,
      activeTtsServerId: null,
      ttsEnabled: input.ttsEnabled,
      sttEnabled: input.sttEnabled,
      systemPrompt: input.systemPrompt,
      greetingEnabled: input.greetingEnabled,
      greetingInstruction: input.greetingInstruction,
      updatedAt: new Date().toISOString(),
    }));

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

  async function putAgentSettings(deviceId: string, body: Record<string, unknown>) {
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
          path: `/v1/admin/livekit/agent-settings/${deviceId}`,
          method: "PUT",
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

  it("preserves nested ttsConfig.llm from dashboard payload", async () => {
    const response = await putAgentSettings("default", {
      agentName: "coziyoo-agent",
      voiceLanguage: "tr",
      ttsEnabled: true,
      sttEnabled: true,
      ttsConfig: {
        llm: {
          baseUrl: "https://api.openai.com",
          model: "ministral-3:8b",
          endpointPath: "/v1/chat/completions",
        },
      },
    });

    expect(response.status).toBe(200);
    expect(upsertStarterAgentSettingsMock).toHaveBeenCalledTimes(1);

    const [upsertArg] = upsertStarterAgentSettingsMock.mock.calls[0] as [Record<string, unknown>];
    const ttsConfig = upsertArg.ttsConfig as Record<string, unknown>;
    const llm = ttsConfig.llm as Record<string, unknown>;

    expect(llm.baseUrl).toBe("https://api.openai.com");
    expect(llm.model).toBe("ministral-3:8b");
    expect(llm.endpointPath).toBe("/v1/chat/completions");
  });
});
