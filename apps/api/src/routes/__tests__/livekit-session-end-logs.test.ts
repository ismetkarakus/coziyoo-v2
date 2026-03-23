import express from "express";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { beforeEach, describe, expect, it, vi } from "vitest";

const mockPoolQuery = vi.fn();
const mockSendSessionEndEvent = vi.fn();

vi.mock("../../db/client.js", () => ({
  pool: {
    query: (...args: unknown[]) => mockPoolQuery(...args),
  },
}));

vi.mock("../../config/env.js", () => ({
  env: {
    AI_SERVER_SHARED_SECRET: "super-secret-123456",
    OLLAMA_CHAT_MODEL: "llama3.1:8b",
    SPEECH_TO_TEXT_TRANSCRIBE_PATH: "/v1/audio/transcriptions",
    SPEECH_TO_TEXT_MODEL: "whisper-1",
    AI_SERVER_URL: "http://localhost:9000",
    AI_SERVER_TIMEOUT_MS: 3000,
    LIVEKIT_AGENT_IDENTITY: "agent",
    LIVEKIT_URL: "wss://livekit.local",
  },
}));

vi.mock("../../services/n8n.js", () => ({
  getN8nStatus: vi.fn(),
  runN8nToolWebhook: vi.fn(),
  sendSessionEndEvent: (...args: unknown[]) => mockSendSessionEndEvent(...args),
}));

vi.mock("../../services/livekit.js", () => ({
  isLiveKitConfigured: () => true,
  buildRoomScopedAgentIdentity: vi.fn(),
  dispatchAgentJoin: vi.fn(),
  ensureLiveKitRoom: vi.fn(),
  isParticipantInRoom: vi.fn(),
  mintLiveKitToken: vi.fn(),
  sendRoomData: vi.fn(),
}));

vi.mock("../../services/starter-agent-settings.js", () => ({
  createDefaultStarterAgentSettings: vi.fn(),
  createDefaultStarterTtsConfig: vi.fn(),
  getStarterAgentSettings: vi.fn(),
  upsertStarterAgentSettings: vi.fn(),
}));

vi.mock("../../services/resolve-providers.js", () => ({
  resolveProviders: vi.fn(),
}));

vi.mock("../../services/ollama.js", () => ({
  askOllamaChat: vi.fn(),
  listOllamaModels: vi.fn(),
}));

async function shutdown(server: Server) {
  await new Promise<void>((resolve, reject) => {
    server.close((error) => {
      if (error) reject(error);
      else resolve();
    });
  });
}

describe("livekit /session/end call-log persistence", () => {
  beforeEach(() => {
    mockPoolQuery.mockReset();
    mockSendSessionEndEvent.mockReset();
    mockPoolQuery.mockResolvedValue({ rowCount: 1, rows: [] });
    mockSendSessionEndEvent.mockResolvedValue({ ok: true, status: 200, body: {}, endpoint: "http://n8n.local/hook" });
  });

  it("persists call log with profile and duration before forwarding to n8n", async () => {
    const { liveKitRouter } = await import("../livekit.js");
    const app = express();
    app.use(express.json());
    app.use("/v1/livekit", liveKitRouter);
    const server = createServer(app);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
    const address = server.address() as AddressInfo;
    const baseUrl = `http://127.0.0.1:${address.port}`;

    try {
      const response = await fetch(`${baseUrl}/v1/livekit/session/end`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-ai-server-secret": "super-secret-123456",
        },
        body: JSON.stringify({
          roomName: "room-1",
          summary: "session done",
          startedAt: "2026-03-22T10:00:00.000Z",
          endedAt: "2026-03-22T10:01:30.000Z",
          outcome: "completed",
          metadata: {
            settingsProfileId: "d8b4a349-b9d2-4d70-9daf-58a89f983dd8",
          },
        }),
      });

      expect(response.status).toBe(201);
      expect(mockPoolQuery).toHaveBeenCalledTimes(1);
      expect(String(mockPoolQuery.mock.calls[0]?.[0] ?? "")).toContain("INSERT INTO agent_call_logs");
      expect(mockPoolQuery.mock.calls[0]?.[1]).toEqual([
        "room-1",
        "d8b4a349-b9d2-4d70-9daf-58a89f983dd8",
        "2026-03-22T10:00:00.000Z",
        "2026-03-22T10:01:30.000Z",
        90,
        "completed",
        "session done",
        null,
      ]);
      expect(mockSendSessionEndEvent).toHaveBeenCalledTimes(1);
    } finally {
      await shutdown(server);
    }
  });

  it("returns unauthorized when shared secret is missing", async () => {
    const { liveKitRouter } = await import("../livekit.js");
    const app = express();
    app.use(express.json());
    app.use("/v1/livekit", liveKitRouter);
    const server = createServer(app);
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
    const address = server.address() as AddressInfo;
    const baseUrl = `http://127.0.0.1:${address.port}`;

    try {
      const response = await fetch(`${baseUrl}/v1/livekit/session/end`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          roomName: "room-1",
          summary: "session done",
        }),
      });

      expect(response.status).toBe(401);
      expect(mockPoolQuery).not.toHaveBeenCalled();
    } finally {
      await shutdown(server);
    }
  });
});

