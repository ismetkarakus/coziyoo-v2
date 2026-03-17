import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// ── Shared mock function references ──────────────────────────────────────────
// These are closed over by vi.mock() factories, so they survive vi.resetModules().

const mockGetStarterAgentSettings = vi.fn();
const mockCreateDefaultStarterAgentSettings = vi.fn();
const mockResolveProviders = vi.fn();
const mockGetN8nStatus = vi.fn();
const mockIsLiveKitConfigured = vi.fn();
const mockEnsureLiveKitRoom = vi.fn();
const mockMintLiveKitToken = vi.fn();
const mockBuildRoomScopedAgentIdentity = vi.fn();
const mockIsParticipantInRoom = vi.fn();
const mockDispatchAgentJoin = vi.fn();

vi.mock("../../src/db/client.js", () => ({
  pool: { connect: vi.fn(), query: vi.fn() },
}));

vi.mock("../../src/services/starter-agent-settings.js", () => ({
  getStarterAgentSettings: (...args: unknown[]) => mockGetStarterAgentSettings(...args),
  createDefaultStarterAgentSettings: (...args: unknown[]) => mockCreateDefaultStarterAgentSettings(...args),
  upsertStarterAgentSettings: vi.fn(),
  createDefaultStarterTtsConfig: vi.fn().mockReturnValue({}),
}));

vi.mock("../../src/services/resolve-providers.js", () => ({
  resolveProviders: (...args: unknown[]) => mockResolveProviders(...args),
}));

vi.mock("../../src/services/n8n.js", () => ({
  getN8nStatus: (...args: unknown[]) => mockGetN8nStatus(...args),
  runN8nToolWebhook: vi.fn(),
  sendSessionEndEvent: vi.fn(),
}));

vi.mock("../../src/services/livekit.js", () => ({
  isLiveKitConfigured: () => mockIsLiveKitConfigured(),
  ensureLiveKitRoom: (...args: unknown[]) => mockEnsureLiveKitRoom(...args),
  mintLiveKitToken: (...args: unknown[]) => mockMintLiveKitToken(...args),
  buildRoomScopedAgentIdentity: (...args: unknown[]) => mockBuildRoomScopedAgentIdentity(...args),
  isParticipantInRoom: (...args: unknown[]) => mockIsParticipantInRoom(...args),
  dispatchAgentJoin: (...args: unknown[]) => mockDispatchAgentJoin(...args),
  sendRoomData: vi.fn(),
}));

// ── Constants ────────────────────────────────────────────────────────────────

const STT_URL = "http://stt.test:8000";
const TTS_URL = "http://tts.test:7000";
const AGENT_HEALTH_URL = "http://agent.test:9000/health";

// ── Helpers ──────────────────────────────────────────────────────────────────

function makeMockSettings(overrides: Record<string, unknown> = {}) {
  return {
    deviceId: "test-device",
    agentName: "Test Agent",
    voiceLanguage: "en",
    ollamaModel: "llama3.1",
    ttsEngine: "f5-tts",
    ttsConfig: null,
    ttsServers: null,
    activeTtsServerId: null,
    ttsEnabled: true,
    sttEnabled: true,
    systemPrompt: null,
    greetingEnabled: true,
    greetingInstruction: null,
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

function makeResolvedProviders(sttBaseUrl: string | null, ttsBaseUrl: string | null) {
  return {
    stt: {
      provider: "remote-speech-server",
      baseUrl: sttBaseUrl,
      transcribePath: "/v1/audio/transcriptions",
      model: "whisper-1",
      queryParams: {},
      authHeader: null,
    },
    tts: {
      engine: "f5-tts",
      baseUrl: ttsBaseUrl,
      synthPath: "/api/tts",
      textFieldName: "text",
      bodyParams: {},
      queryParams: {},
      authHeader: null,
    },
    n8n: {
      baseUrl: null,
      workflowId: null,
      mcpWorkflowId: null,
      webhookUrl: null,
      webhookPath: null,
      mcpWebhookPath: null,
      authHeader: null,
    },
  };
}

async function bootApp() {
  vi.resetModules();
  vi.stubEnv("NODE_ENV", "test");
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
  vi.stubEnv("AI_SERVER_URL", "http://agent.test:9000");
  vi.stubEnv("AI_SERVER_SHARED_SECRET", "test_shared_secret_1234567890_abcdef");

  const { app } = await import("../../src/app.js");

  const server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
  const address = server.address() as AddressInfo;
  return { server, baseUrl: `http://127.0.0.1:${address.port}` };
}

async function shutdown(server: Server) {
  await new Promise<void>((resolve, reject) => {
    server.close((err) => (err ? reject(err) : resolve()));
  });
}

// ── Tests ────────────────────────────────────────────────────────────────────

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

describe("starter session start — STT/TTS preflight checks", () => {
  let originalFetch: typeof global.fetch;

  beforeEach(() => {
    // Save real fetch so we can pass through calls to the local test server
    originalFetch = global.fetch;

    // Default happy-path mock implementations
    mockGetStarterAgentSettings.mockResolvedValue(null);
    mockCreateDefaultStarterAgentSettings.mockReturnValue(makeMockSettings());
    mockResolveProviders.mockReturnValue(makeResolvedProviders(STT_URL, TTS_URL));
    mockGetN8nStatus.mockResolvedValue({ ok: false, reason: "n8n_not_configured", workflows: [] });
    mockIsLiveKitConfigured.mockReturnValue(true);
    mockEnsureLiveKitRoom.mockResolvedValue(undefined);
    mockMintLiveKitToken.mockResolvedValue("mock-lk-token");
    mockBuildRoomScopedAgentIdentity.mockReturnValue("agent-test");
    mockIsParticipantInRoom.mockResolvedValue(false);
    mockDispatchAgentJoin.mockResolvedValue({ ok: true, status: 200, body: {}, endpoint: "http://agent.test:9000" });

    // Intercept external fetch calls but pass through local server calls
    vi.spyOn(global, "fetch").mockImplementation(async (input, init) => {
      const url = typeof input === "string" ? input : (input as Request).url;
      // Pass through calls to the local Express server
      if (url.startsWith("http://127.0.0.1")) {
        return originalFetch(input as RequestInfo, init);
      }
      // Agent health check — return worker running
      if (url === AGENT_HEALTH_URL) {
        return new Response(JSON.stringify({ worker: { running: true } }), { status: 200 });
      }
      // Default: any other external URL is reachable
      return new Response("", { status: 200 });
    });
  });

  it("returns STT_UNAVAILABLE when STT server is unreachable", async () => {
    vi.spyOn(global, "fetch").mockImplementation(async (input, init) => {
      const url = typeof input === "string" ? input : (input as Request).url;
      if (url.startsWith("http://127.0.0.1")) return originalFetch(input as RequestInfo, init);
      if (url === AGENT_HEALTH_URL) {
        return new Response(JSON.stringify({ worker: { running: true } }), { status: 200 });
      }
      if (url === STT_URL) throw new Error("ECONNREFUSED");
      return new Response("", { status: 200 });
    });

    const { server, baseUrl } = await bootApp();
    try {
      const response = await fetch(`${baseUrl}/v1/livekit/starter/session/start`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ username: "testuser", deviceId: "test-device-01" }),
      });

      expect(response.status).toBe(503);
      const json = (await response.json()) as { error?: { code?: string } };
      expect(json.error?.code).toBe("STT_UNAVAILABLE");
    } finally {
      await shutdown(server);
    }
  });

  it("returns TTS_UNAVAILABLE when TTS server is unreachable", async () => {
    vi.spyOn(global, "fetch").mockImplementation(async (input, init) => {
      const url = typeof input === "string" ? input : (input as Request).url;
      if (url.startsWith("http://127.0.0.1")) return originalFetch(input as RequestInfo, init);
      if (url === AGENT_HEALTH_URL) {
        return new Response(JSON.stringify({ worker: { running: true } }), { status: 200 });
      }
      if (url === TTS_URL) throw new Error("ECONNREFUSED");
      return new Response("", { status: 200 });
    });

    const { server, baseUrl } = await bootApp();
    try {
      const response = await fetch(`${baseUrl}/v1/livekit/starter/session/start`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ username: "testuser", deviceId: "test-device-01" }),
      });

      expect(response.status).toBe(503);
      const json = (await response.json()) as { error?: { code?: string } };
      expect(json.error?.code).toBe("TTS_UNAVAILABLE");
    } finally {
      await shutdown(server);
    }
  });

  it("proceeds past STT/TTS checks when both servers are reachable", async () => {
    // Default fetch mock — all external calls succeed
    const { server, baseUrl } = await bootApp();
    try {
      const response = await fetch(`${baseUrl}/v1/livekit/starter/session/start`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ username: "testuser", deviceId: "test-device-01" }),
      });

      const json = (await response.json()) as { error?: { code?: string }; data?: unknown };
      expect(json.error?.code).not.toBe("STT_UNAVAILABLE");
      expect(json.error?.code).not.toBe("TTS_UNAVAILABLE");
      expect(response.status).toBe(201);
    } finally {
      await shutdown(server);
    }
  });

  it("skips STT check when STT URL is not configured", async () => {
    mockResolveProviders.mockReturnValue(makeResolvedProviders(null, TTS_URL));

    const { server, baseUrl } = await bootApp();
    try {
      const response = await fetch(`${baseUrl}/v1/livekit/starter/session/start`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ username: "testuser", deviceId: "test-device-01" }),
      });

      const json = (await response.json()) as { error?: { code?: string } };
      expect(json.error?.code).not.toBe("STT_UNAVAILABLE");
    } finally {
      await shutdown(server);
    }
  });

  it("skips TTS check when ttsEnabled is false in device settings", async () => {
    mockCreateDefaultStarterAgentSettings.mockReturnValue(makeMockSettings({ ttsEnabled: false }));

    vi.spyOn(global, "fetch").mockImplementation(async (input, init) => {
      const url = typeof input === "string" ? input : (input as Request).url;
      if (url.startsWith("http://127.0.0.1")) return originalFetch(input as RequestInfo, init);
      if (url === AGENT_HEALTH_URL) {
        return new Response(JSON.stringify({ worker: { running: true } }), { status: 200 });
      }
      if (url === TTS_URL) throw new Error("should not probe TTS when ttsEnabled is false");
      return new Response("", { status: 200 });
    });

    const { server, baseUrl } = await bootApp();
    try {
      const response = await fetch(`${baseUrl}/v1/livekit/starter/session/start`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ username: "testuser", deviceId: "test-device-01" }),
      });

      const json = (await response.json()) as { error?: { code?: string } };
      expect(json.error?.code).not.toBe("TTS_UNAVAILABLE");
    } finally {
      await shutdown(server);
    }
  });
});
