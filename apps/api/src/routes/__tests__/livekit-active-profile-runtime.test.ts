import { beforeEach, describe, expect, it, vi } from "vitest";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import express from "express";

const mockPoolQuery = vi.fn();

vi.mock("../../db/client.js", () => ({
  pool: {
    query: (...args: unknown[]) => mockPoolQuery(...args),
  },
}));

describe("resolveRuntimeProfileConfig", () => {
  beforeEach(() => {
    mockPoolQuery.mockReset();
  });

  it("returns normalized providers from active profile", async () => {
    mockPoolQuery.mockResolvedValue({
      rowCount: 1,
      rows: [
        {
          id: "profile-active",
          is_active: true,
          system_prompt: "aktif prompt",
          greeting_enabled: true,
          greeting_instruction: "merhaba de",
          voice_language: "tr",
          llm_config: { model: "gpt-4o-mini", base_url: "http://llm.local" },
          stt_config: { provider: "remote-speech-server", base_url: "http://stt.local" },
          tts_config: { engine: "f5-tts", base_url: "http://tts.local" },
          n8n_config: { base_url: "http://n8n.local", workflow_id: "wf-1" },
        },
      ],
    });

    const { resolveRuntimeProfileConfig } = await import("../../services/agent-profile-runtime.js");
    const resolved = await resolveRuntimeProfileConfig();

    expect(resolved).not.toBeNull();
    expect(resolved?.profileId).toBe("profile-active");
    expect(resolved?.voiceLanguage).toBe("tr");
    expect(resolved?.systemPrompt).toBe("aktif prompt");
    expect(resolved?.greetingEnabled).toBe(true);
    expect(resolved?.greetingInstruction).toBe("merhaba de");
    expect(resolved?.providers.stt.baseUrl).toBe("http://stt.local");
    expect(resolved?.providers.tts.baseUrl).toBe("http://tts.local");
    expect(resolved?.providers.n8n.baseUrl).toBe("http://n8n.local");
  });

  it("prefers explicit settingsProfileId over active profile", async () => {
    mockPoolQuery.mockResolvedValue({
      rowCount: 1,
      rows: [
        {
          id: "profile-explicit",
          is_active: false,
          system_prompt: null,
          greeting_enabled: false,
          greeting_instruction: null,
          voice_language: "en",
          llm_config: {},
          stt_config: {},
          tts_config: {},
          n8n_config: {},
        },
      ],
    });

    const { resolveRuntimeProfileConfig } = await import("../../services/agent-profile-runtime.js");
    const resolved = await resolveRuntimeProfileConfig("profile-explicit");

    expect(resolved?.profileId).toBe("profile-explicit");
    expect(mockPoolQuery).toHaveBeenCalledTimes(1);
    expect(String(mockPoolQuery.mock.calls[0]?.[0] ?? "")).toContain("WHERE id = $1");
    expect(mockPoolQuery.mock.calls[0]?.[1]).toEqual(["profile-explicit"]);
  });

  it("returns null when there is no active profile", async () => {
    mockPoolQuery.mockResolvedValue({
      rowCount: 0,
      rows: [],
    });

    const { resolveRuntimeProfileConfig } = await import("../../services/agent-profile-runtime.js");
    const resolved = await resolveRuntimeProfileConfig();

    expect(resolved).toBeNull();
  });
});

async function shutdown(server: Server) {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) reject(error);
      else resolve();
    });
  });
}

describe("livekit session start runtime profile wiring", () => {
  beforeEach(() => {
    vi.resetModules();
  });

  it("injects profile-driven providers to dispatch metadata", async () => {
    const mockGetStarterAgentSettings = vi.fn().mockResolvedValue({
      deviceId: "device-1234",
      ttsEnabled: true,
      sttEnabled: true,
      systemPrompt: "legacy prompt",
      greetingEnabled: true,
      greetingInstruction: "legacy greeting",
      voiceLanguage: "tr",
    });
    const mockCreateDefaultStarterAgentSettings = vi.fn();
    const mockResolveProviders = vi.fn().mockReturnValue({
      stt: { baseUrl: "http://old-stt.local" },
      tts: { baseUrl: "http://old-tts.local" },
      n8n: { baseUrl: null },
    });
    const mockResolveRuntimeProfileConfig = vi.fn().mockResolvedValue({
      profileId: "profile-active-1",
      voiceLanguage: "tr",
      systemPrompt: "profile prompt",
      greetingEnabled: true,
      greetingInstruction: "profile greeting",
      providers: {
        stt: { baseUrl: "http://new-stt.local", provider: "remote-speech-server", transcribePath: "/v1/audio/transcriptions", model: "whisper-1", queryParams: {}, authHeader: null },
        llm: { baseUrl: "http://new-llm.local", model: "gpt-4o-mini", authHeader: null },
        tts: { baseUrl: "http://new-tts.local", engine: "f5-tts", synthPath: "/tts", textFieldName: "text", bodyParams: {}, queryParams: {}, authHeader: null },
        n8n: { baseUrl: "http://new-n8n.local", workflowId: "wf", mcpWorkflowId: null, webhookUrl: null, webhookPath: null, mcpWebhookPath: null, authHeader: null },
      },
    });
    const mockDispatchAgentJoin = vi.fn().mockResolvedValue({ ok: true, status: 200, body: {}, endpoint: "http://agent.local/join" });

    vi.doMock("../../middleware/auth.js", () => ({
      requireAuth: () => (req: Record<string, unknown>, _res: unknown, next: () => void) => {
        req.auth = { userId: "user-1", role: "buyer" };
        next();
      },
    }));
    vi.doMock("../../services/starter-agent-settings.js", () => ({
      getStarterAgentSettings: (...args: unknown[]) => mockGetStarterAgentSettings(...args),
      createDefaultStarterAgentSettings: (...args: unknown[]) => mockCreateDefaultStarterAgentSettings(...args),
      upsertStarterAgentSettings: vi.fn(),
      createDefaultStarterTtsConfig: vi.fn().mockReturnValue({}),
    }));
    vi.doMock("../../services/resolve-providers.js", () => ({
      resolveProviders: (...args: unknown[]) => mockResolveProviders(...args),
    }));
    vi.doMock("../../services/agent-profile-runtime.js", () => ({
      resolveRuntimeProfileConfig: (...args: unknown[]) => mockResolveRuntimeProfileConfig(...args),
    }));
    vi.doMock("../../services/n8n.js", () => ({
      getN8nStatus: vi.fn().mockResolvedValue({ configured: false, reachable: false, workflows: [] }),
      runN8nToolWebhook: vi.fn(),
      sendSessionEndEvent: vi.fn(),
    }));
    vi.doMock("../../services/livekit.js", () => ({
      isLiveKitConfigured: () => true,
      ensureLiveKitRoom: vi.fn().mockResolvedValue(undefined),
      mintLiveKitToken: vi.fn().mockResolvedValue("token"),
      buildRoomScopedAgentIdentity: vi.fn().mockReturnValue("agent-1"),
      isParticipantInRoom: vi.fn().mockResolvedValue(false),
      dispatchAgentJoin: (...args: unknown[]) => mockDispatchAgentJoin(...args),
      sendRoomData: vi.fn(),
    }));
    vi.doMock("../../services/ollama.js", () => ({
      askOllamaChat: vi.fn(),
      listOllamaModels: vi.fn().mockResolvedValue([]),
    }));

    const originalFetch = global.fetch;
    vi.spyOn(global, "fetch").mockImplementation(async (input, init) => {
      const url = typeof input === "string" ? input : (input as Request).url;
      if (url.includes("/health")) {
        return new Response(JSON.stringify({ worker: { running: true } }), { status: 200 });
      }
      if (url.includes("new-stt.local") || url.includes("new-tts.local")) {
        return new Response("", { status: 200 });
      }
      return originalFetch(input as RequestInfo, init);
    });

    const { liveKitRouter } = await import("../livekit.js");
    const app = express();
    app.use(express.json());
    app.use("/v1/livekit", liveKitRouter);
    const server = createServer(app);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
    const address = server.address() as AddressInfo;
    const baseUrl = `http://127.0.0.1:${address.port}`;

    try {
      const response = await fetch(`${baseUrl}/v1/livekit/session/start`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: "Bearer test-token",
        },
        body: JSON.stringify({
          autoDispatchAgent: true,
          participantName: "tester",
          deviceId: "device-1234",
          settingsProfileId: "profile-active-1",
        }),
      });

      expect(response.status).toBe(201);
      expect(mockResolveRuntimeProfileConfig).toHaveBeenCalledWith("profile-active-1");
      const firstDispatchArg = mockDispatchAgentJoin.mock.calls[0]?.[0] as { metadata?: string; payload?: Record<string, unknown> };
      const metadata = JSON.parse(firstDispatchArg.metadata ?? "{}");
      expect(firstDispatchArg.payload?.providers).toEqual(metadata.providers);
      expect(metadata.providers.stt.baseUrl).toBe("http://new-stt.local");
      expect(metadata.providers.tts.baseUrl).toBe("http://new-tts.local");
    } finally {
      await shutdown(server);
    }
  });

  it("returns explicit error when runtime profile cannot be resolved", async () => {
    const mockResolveRuntimeProfileConfig = vi.fn().mockResolvedValue(null);

    vi.doMock("../../middleware/auth.js", () => ({
      requireAuth: () => (req: Record<string, unknown>, _res: unknown, next: () => void) => {
        req.auth = { userId: "user-1", role: "buyer" };
        next();
      },
    }));
    vi.doMock("../../services/starter-agent-settings.js", () => ({
      getStarterAgentSettings: vi.fn().mockResolvedValue({
        deviceId: "device-1234",
        ttsEnabled: true,
        sttEnabled: true,
      }),
      createDefaultStarterAgentSettings: vi.fn(),
      upsertStarterAgentSettings: vi.fn(),
      createDefaultStarterTtsConfig: vi.fn().mockReturnValue({}),
    }));
    vi.doMock("../../services/resolve-providers.js", () => ({
      resolveProviders: vi.fn().mockReturnValue({
        stt: { baseUrl: "http://old-stt.local" },
        tts: { baseUrl: "http://old-tts.local" },
        n8n: { baseUrl: null },
      }),
    }));
    vi.doMock("../../services/agent-profile-runtime.js", () => ({
      resolveRuntimeProfileConfig: (...args: unknown[]) => mockResolveRuntimeProfileConfig(...args),
    }));
    vi.doMock("../../services/n8n.js", () => ({
      getN8nStatus: vi.fn().mockResolvedValue({ configured: false, reachable: false, workflows: [] }),
      runN8nToolWebhook: vi.fn(),
      sendSessionEndEvent: vi.fn(),
    }));
    vi.doMock("../../services/livekit.js", () => ({
      isLiveKitConfigured: () => true,
      ensureLiveKitRoom: vi.fn().mockResolvedValue(undefined),
      mintLiveKitToken: vi.fn().mockResolvedValue("token"),
      buildRoomScopedAgentIdentity: vi.fn().mockReturnValue("agent-1"),
      isParticipantInRoom: vi.fn().mockResolvedValue(false),
      dispatchAgentJoin: vi.fn().mockResolvedValue({ ok: true, status: 200, body: {}, endpoint: "http://agent.local/join" }),
      sendRoomData: vi.fn(),
    }));
    vi.doMock("../../services/ollama.js", () => ({
      askOllamaChat: vi.fn(),
      listOllamaModels: vi.fn().mockResolvedValue([]),
    }));

    vi.spyOn(global, "fetch").mockResolvedValue(new Response(JSON.stringify({ worker: { running: true } }), { status: 200 }));

    const { liveKitRouter } = await import("../livekit.js");
    const app = express();
    app.use(express.json());
    app.use("/v1/livekit", liveKitRouter);
    const server = createServer(app);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
    const address = server.address() as AddressInfo;
    const baseUrl = `http://127.0.0.1:${address.port}`;

    try {
      const response = await fetch(`${baseUrl}/v1/livekit/session/start`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: "Bearer test-token",
        },
        body: JSON.stringify({
          autoDispatchAgent: true,
          participantName: "tester",
          deviceId: "device-1234",
        }),
      });

      expect(response.status).toBe(422);
      const json = (await response.json()) as { error?: { code?: string } };
      expect(json.error?.code).toBe("ACTIVE_PROFILE_NOT_FOUND");
    } finally {
      await shutdown(server);
    }
  });

  it("includes runtime profile id in dispatch metadata payload", async () => {
    const mockResolveRuntimeProfileConfig = vi.fn().mockResolvedValue({
      profileId: "profile-trace-1",
      voiceLanguage: "en",
      systemPrompt: null,
      greetingEnabled: false,
      greetingInstruction: null,
      providers: {
        stt: { baseUrl: "http://stt.local", provider: "remote-speech-server", transcribePath: "/v1/audio/transcriptions", model: "whisper-1", queryParams: {}, authHeader: null },
        llm: { baseUrl: "http://llm.local", model: "llama3.1", authHeader: null },
        tts: { baseUrl: "http://tts.local", engine: "f5-tts", synthPath: "/tts", textFieldName: "text", bodyParams: {}, queryParams: {}, authHeader: null },
        n8n: { baseUrl: null, workflowId: null, mcpWorkflowId: null, webhookUrl: null, webhookPath: null, mcpWebhookPath: null, authHeader: null },
      },
    });
    const mockDispatchAgentJoin = vi.fn().mockResolvedValue({ ok: true, status: 200, body: {}, endpoint: "http://agent.local/join" });

    vi.doMock("../../middleware/auth.js", () => ({
      requireAuth: () => (req: Record<string, unknown>, _res: unknown, next: () => void) => {
        req.auth = { userId: "user-1", role: "buyer" };
        next();
      },
    }));
    vi.doMock("../../services/starter-agent-settings.js", () => ({
      getStarterAgentSettings: vi.fn().mockResolvedValue({
        deviceId: "device-1234",
        ttsEnabled: true,
        sttEnabled: true,
      }),
      createDefaultStarterAgentSettings: vi.fn(),
      upsertStarterAgentSettings: vi.fn(),
      createDefaultStarterTtsConfig: vi.fn().mockReturnValue({}),
    }));
    vi.doMock("../../services/resolve-providers.js", () => ({
      resolveProviders: vi.fn().mockReturnValue({
        stt: { baseUrl: "http://old-stt.local" },
        tts: { baseUrl: "http://old-tts.local" },
        n8n: { baseUrl: null },
      }),
    }));
    vi.doMock("../../services/agent-profile-runtime.js", () => ({
      resolveRuntimeProfileConfig: (...args: unknown[]) => mockResolveRuntimeProfileConfig(...args),
    }));
    vi.doMock("../../services/n8n.js", () => ({
      getN8nStatus: vi.fn().mockResolvedValue({ configured: false, reachable: false, workflows: [] }),
      runN8nToolWebhook: vi.fn(),
      sendSessionEndEvent: vi.fn(),
    }));
    vi.doMock("../../services/livekit.js", () => ({
      isLiveKitConfigured: () => true,
      ensureLiveKitRoom: vi.fn().mockResolvedValue(undefined),
      mintLiveKitToken: vi.fn().mockResolvedValue("token"),
      buildRoomScopedAgentIdentity: vi.fn().mockReturnValue("agent-1"),
      isParticipantInRoom: vi.fn().mockResolvedValue(false),
      dispatchAgentJoin: (...args: unknown[]) => mockDispatchAgentJoin(...args),
      sendRoomData: vi.fn(),
    }));
    vi.doMock("../../services/ollama.js", () => ({
      askOllamaChat: vi.fn(),
      listOllamaModels: vi.fn().mockResolvedValue([]),
    }));

    const originalFetch = global.fetch;
    vi.spyOn(global, "fetch").mockImplementation(async (input, init) => {
      const url = typeof input === "string" ? input : (input as Request).url;
      if (url.includes("/health") || url.includes("stt.local") || url.includes("tts.local")) {
        return new Response(JSON.stringify({ worker: { running: true } }), { status: 200 });
      }
      return originalFetch(input as RequestInfo, init);
    });

    const { liveKitRouter } = await import("../livekit.js");
    const app = express();
    app.use(express.json());
    app.use("/v1/livekit", liveKitRouter);
    const server = createServer(app);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
    const address = server.address() as AddressInfo;
    const baseUrl = `http://127.0.0.1:${address.port}`;

    try {
      const response = await fetch(`${baseUrl}/v1/livekit/session/start`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          authorization: "Bearer test-token",
        },
        body: JSON.stringify({
          autoDispatchAgent: true,
          participantName: "tester",
          deviceId: "device-1234",
        }),
      });

      expect(response.status).toBe(201);
      const firstDispatchArg = mockDispatchAgentJoin.mock.calls[0]?.[0] as { metadata?: string; payload?: Record<string, unknown> };
      const metadata = JSON.parse(firstDispatchArg.metadata ?? "{}");
      expect(firstDispatchArg.payload?.settingsProfileId).toBe("profile-trace-1");
      expect(metadata.settingsProfileId).toBe("profile-trace-1");
    } finally {
      await shutdown(server);
    }
  });
});
