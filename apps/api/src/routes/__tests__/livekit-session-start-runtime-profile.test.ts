import { beforeEach, describe, expect, it, vi } from "vitest";
import express from "express";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";

const mockResolveRuntimeProfileConfig = vi.fn();
const mockMintLiveKitToken = vi.fn();

vi.mock("../../middleware/auth.js", () => ({
  requireAuth: () => (req: Record<string, unknown>, _res: unknown, next: () => void) => {
    req.auth = { userId: "user-1", role: "buyer" };
    next();
  },
}));

vi.mock("../../services/agent-profile-runtime.js", () => ({
  resolveRuntimeProfileConfig: (...args: unknown[]) => mockResolveRuntimeProfileConfig(...args),
}));

vi.mock("../../services/livekit.js", () => ({
  isLiveKitConfigured: () => true,
  ensureLiveKitRoom: vi.fn().mockResolvedValue(undefined),
  mintLiveKitToken: (...args: unknown[]) => mockMintLiveKitToken(...args),
  buildRoomScopedAgentIdentity: vi.fn().mockReturnValue("agent-1"),
  isParticipantInRoom: vi.fn().mockResolvedValue(false),
  dispatchAgentJoin: vi.fn().mockResolvedValue({ ok: true, status: 200, body: {}, endpoint: "http://agent.local/join" }),
  sendRoomData: vi.fn(),
}));

vi.mock("../../services/n8n.js", () => ({
  getN8nStatus: vi.fn().mockResolvedValue({ configured: false, reachable: false, workflows: {} }),
  runN8nToolWebhook: vi.fn(),
  sendSessionEndEvent: vi.fn(),
}));

vi.mock("../../services/ollama.js", () => ({
  askOllamaChat: vi.fn(),
  listOllamaModels: vi.fn().mockResolvedValue([]),
}));

vi.mock("../../services/starter-agent-settings.js", () => ({
  getStarterAgentSettings: vi.fn(),
  createDefaultStarterAgentSettings: vi.fn(),
  createDefaultStarterTtsConfig: vi.fn(),
  upsertStarterAgentSettings: vi.fn(),
}));

vi.mock("../../services/resolve-providers.js", () => ({
  resolveProviders: vi.fn(),
}));

async function shutdown(server: Server) {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) reject(error);
      else resolve();
    });
  });
}

describe("livekit /session/start runtime profile source-of-truth", () => {
  beforeEach(() => {
    vi.resetModules();
    mockResolveRuntimeProfileConfig.mockReset();
    mockMintLiveKitToken.mockReset();
    mockMintLiveKitToken.mockResolvedValue("token-1");
  });

  it("returns ACTIVE_PROFILE_NOT_FOUND when runtime profile is missing", async () => {
    mockResolveRuntimeProfileConfig.mockResolvedValue(null);

    const { liveKitRouter } = await import("../livekit.js");
    const app = express();
    app.use(express.json());
    app.use("/v1/livekit", liveKitRouter);
    const server = createServer(app);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
    const baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

    try {
      const response = await fetch(`${baseUrl}/v1/livekit/session/start`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: "Bearer test-token" },
        body: JSON.stringify({ autoDispatchAgent: false, channel: "mobile" }),
      });

      expect(response.status).toBe(422);
      const json = (await response.json()) as { error?: { code?: string } };
      expect(json.error?.code).toBe("ACTIVE_PROFILE_NOT_FOUND");
      expect(mockMintLiveKitToken).not.toHaveBeenCalled();
    } finally {
      await shutdown(server);
    }
  });

  it("uses runtime profile providers and profile id in agent metadata", async () => {
    mockResolveRuntimeProfileConfig.mockResolvedValue({
      profileId: "profile-active-1",
      voiceLanguage: "tr",
      systemPrompt: "runtime prompt",
      greetingEnabled: true,
      greetingInstruction: "runtime greet",
      providers: {
        stt: { provider: "remote-speech-server", baseUrl: null, transcribePath: "/v1/audio/transcriptions", model: "whisper-1", queryParams: {}, authHeader: null },
        llm: { baseUrl: "http://runtime-llm.local", model: "llama3.1:8b", authHeader: null },
        tts: { engine: "f5-tts", baseUrl: null, synthPath: "/tts", textFieldName: "text", bodyParams: {}, queryParams: {}, authHeader: null },
        n8n: { baseUrl: null, workflowId: null, mcpWorkflowId: null, webhookUrl: null, webhookPath: null, mcpWebhookPath: null, authHeader: null },
      },
    });

    const { liveKitRouter } = await import("../livekit.js");
    const app = express();
    app.use(express.json());
    app.use("/v1/livekit", liveKitRouter);
    const server = createServer(app);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
    const baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

    try {
      const response = await fetch(`${baseUrl}/v1/livekit/session/start`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: "Bearer test-token" },
        body: JSON.stringify({ autoDispatchAgent: false, channel: "mobile", settingsProfileId: "profile-active-1" }),
      });

      expect(response.status).toBe(201);
      expect(mockResolveRuntimeProfileConfig).toHaveBeenCalledWith("profile-active-1");

      const agentTokenInput = mockMintLiveKitToken.mock.calls[1]?.[0] as { metadata?: string };
      const metadata = JSON.parse(agentTokenInput.metadata ?? "{}");
      expect(metadata.settingsProfileId).toBe("profile-active-1");
      expect(metadata.providers?.llm?.baseUrl).toBe("http://runtime-llm.local");
      expect(metadata.systemPrompt).toBe("runtime prompt");
      expect(metadata.greetingInstruction).toBe("runtime greet");
    } finally {
      await shutdown(server);
    }
  });
});

