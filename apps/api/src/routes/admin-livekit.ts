import crypto from "node:crypto";
import { Router } from "express";
import jwt from "jsonwebtoken";
import { z } from "zod";
import { env } from "../config/env.js";
import { pool } from "../db/client.js";
import { requireAuth } from "../middleware/auth.js";
import { askOllamaChat, listOllamaModels } from "../services/ollama.js";
import { getN8nStatus } from "../services/n8n.js";
import {
  buildRoomScopedAgentIdentity,
  dispatchAgentJoin,
  ensureLiveKitRoom,
  isLiveKitConfigured,
  isParticipantInRoom,
  mintLiveKitToken,
  sendRoomData,
} from "../services/livekit.js";
import {
  ensureStarterAgentIsActiveColumn,
  getStarterAgentSettings,
  hasStarterAgentIsActiveColumn,
  upsertStarterAgentSettings,
} from "../services/starter-agent-settings.js";
import { normalizeTtsEngine } from "../services/tts-engines.js";

const UserTokenSchema = z.object({
  roomName: z.string().min(1).max(128),
  participantIdentity: z.string().min(3).max(128).optional(),
  participantName: z.string().min(1).max(128).optional(),
  metadata: z.string().max(2_000).optional(),
  canPublish: z.boolean().optional(),
  canSubscribe: z.boolean().optional(),
  canPublishData: z.boolean().optional(),
  ttlSeconds: z.coerce.number().int().positive().max(86_400).optional(),
});

const AgentTokenSchema = z.object({
  roomName: z.string().min(1).max(128),
  participantIdentity: z.string().min(3).max(128).optional(),
  participantName: z.string().min(1).max(128).optional(),
  metadata: z.string().max(2_000).optional(),
  ttlSeconds: z.coerce.number().int().positive().max(86_400).optional(),
});

const DispatchAgentSchema = AgentTokenSchema.extend({
  payload: z.record(z.string(), z.unknown()).optional(),
});

const StartSessionSchema = z.object({
  roomName: z.string().min(1).max(128).optional(),
  participantIdentity: z.string().min(3).max(128).optional(),
  participantName: z.string().min(1).max(128).optional(),
  metadata: z.string().max(2_000).optional(),
  ttlSeconds: z.coerce.number().int().positive().max(86_400).optional(),
});

const AgentChatSchema = z.object({
  roomName: z.string().min(1).max(128),
  text: z.string().min(1).max(8_000),
});

function tokenPreview(token: string) {
  const payload = jwt.decode(token);
  if (!payload || typeof payload !== "object") {
    return null;
  }

  const iat = typeof payload.iat === "number" ? new Date(payload.iat * 1000).toISOString() : null;
  const exp = typeof payload.exp === "number" ? new Date(payload.exp * 1000).toISOString() : null;

  return {
    iat,
    exp,
    claims: payload,
  };
}

export const adminLiveKitRouter = Router();

adminLiveKitRouter.use(requireAuth("admin"));

adminLiveKitRouter.get("/status", (_req, res) => {
  return res.json({
    data: {
      configured: isLiveKitConfigured(),
      wsUrl: env.LIVEKIT_URL ?? null,
      aiServerUrl: env.AI_SERVER_URL ?? null,
      aiServerJoinPath: env.AI_SERVER_LIVEKIT_JOIN_PATH,
      hasApiKey: Boolean(env.LIVEKIT_API_KEY),
      hasApiSecret: Boolean(env.LIVEKIT_API_SECRET),
      hasAiSharedSecret: Boolean(env.AI_SERVER_SHARED_SECRET),
      defaultTtlSeconds: env.LIVEKIT_TOKEN_TTL_SECONDS,
      agentIdentityDefault: env.LIVEKIT_AGENT_IDENTITY,
    },
  });
});

adminLiveKitRouter.post("/token/user", async (req, res) => {
  if (!isLiveKitConfigured()) {
    return res.status(503).json({
      error: {
        code: "LIVEKIT_NOT_CONFIGURED",
        message: "Set LIVEKIT_URL, LIVEKIT_API_KEY and LIVEKIT_API_SECRET in API environment.",
      },
    });
  }

  const parsed = UserTokenSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: { code: "VALIDATION_ERROR", details: parsed.error.flatten() } });
  }

  const input = parsed.data;
  const identity = input.participantIdentity ?? `admin-preview-user-${Date.now()}`;
  const metadata = input.metadata ?? JSON.stringify({ source: "admin-panel", kind: "user-token-preview" });

  const token = await mintLiveKitToken({
    identity,
    name: input.participantName,
    metadata,
    ttlSeconds: input.ttlSeconds,
    grant: {
      roomJoin: true,
      room: input.roomName,
      canPublish: input.canPublish ?? true,
      canSubscribe: input.canSubscribe ?? true,
      canPublishData: input.canPublishData ?? true,
    },
  });

  return res.status(201).json({
    data: {
      roomName: input.roomName,
      participantIdentity: identity,
      wsUrl: env.LIVEKIT_URL,
      token,
      preview: tokenPreview(token),
    },
  });
});

adminLiveKitRouter.post("/token/agent", async (req, res) => {
  if (!isLiveKitConfigured()) {
    return res.status(503).json({
      error: {
        code: "LIVEKIT_NOT_CONFIGURED",
        message: "Set LIVEKIT_URL, LIVEKIT_API_KEY and LIVEKIT_API_SECRET in API environment.",
      },
    });
  }

  const parsed = AgentTokenSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: { code: "VALIDATION_ERROR", details: parsed.error.flatten() } });
  }

  const input = parsed.data;
  const identity = input.participantIdentity ?? `${env.LIVEKIT_AGENT_IDENTITY}-${Date.now()}`;
  const metadata = input.metadata ?? JSON.stringify({ source: "admin-panel", kind: "agent-token-preview" });

  const token = await mintLiveKitToken({
    identity,
    name: input.participantName ?? env.LIVEKIT_AGENT_IDENTITY,
    metadata,
    ttlSeconds: input.ttlSeconds,
    grant: {
      roomJoin: true,
      room: input.roomName,
      canPublish: true,
      canSubscribe: true,
      canPublishData: true,
    },
  });

  return res.status(201).json({
    data: {
      roomName: input.roomName,
      participantIdentity: identity,
      wsUrl: env.LIVEKIT_URL,
      token,
      preview: tokenPreview(token),
    },
  });
});

adminLiveKitRouter.post("/dispatch/agent", async (req, res) => {
  if (!isLiveKitConfigured()) {
    return res.status(503).json({
      error: {
        code: "LIVEKIT_NOT_CONFIGURED",
        message: "Set LIVEKIT_URL, LIVEKIT_API_KEY and LIVEKIT_API_SECRET in API environment.",
      },
    });
  }

  if (!env.AI_SERVER_URL) {
    return res.status(503).json({
      error: {
        code: "AI_SERVER_URL_MISSING",
        message: "Set AI_SERVER_URL to dispatch agent tokens.",
      },
    });
  }

  const parsed = DispatchAgentSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: { code: "VALIDATION_ERROR", details: parsed.error.flatten() } });
  }

  const input = parsed.data;
  const identity = input.participantIdentity ?? `${env.LIVEKIT_AGENT_IDENTITY}-${Date.now()}`;
  const metadata = input.metadata ?? JSON.stringify({ source: "admin-panel", kind: "agent-dispatch" });

  const token = await mintLiveKitToken({
    identity,
    name: input.participantName ?? env.LIVEKIT_AGENT_IDENTITY,
    metadata,
    ttlSeconds: input.ttlSeconds,
    grant: {
      roomJoin: true,
      room: input.roomName,
      canPublish: true,
      canSubscribe: true,
      canPublishData: true,
    },
  });

  try {
    const dispatch = await dispatchAgentJoin({
      roomName: input.roomName,
      participantIdentity: identity,
      participantName: input.participantName ?? env.LIVEKIT_AGENT_IDENTITY,
      token,
      metadata,
      voiceMode: "assistant_native_audio",
      payload: input.payload,
    });

    return res.status(201).json({
      data: {
        roomName: input.roomName,
        participantIdentity: identity,
        wsUrl: env.LIVEKIT_URL,
        token,
        preview: tokenPreview(token),
        dispatch,
      },
    });
  } catch (error) {
    return res.status(502).json({
      error: {
        code: "AI_SERVER_DISPATCH_FAILED",
        message: error instanceof Error ? error.message : "Dispatch failed",
      },
    });
  }
});

adminLiveKitRouter.post("/session/start", async (req, res) => {
  if (!isLiveKitConfigured()) {
    return res.status(503).json({
      error: {
        code: "LIVEKIT_NOT_CONFIGURED",
        message: "Set LIVEKIT_URL, LIVEKIT_API_KEY and LIVEKIT_API_SECRET in API environment.",
      },
    });
  }

  if (!env.AI_SERVER_URL) {
    return res.status(503).json({
      error: {
        code: "AI_SERVER_URL_MISSING",
        message: "Set AI_SERVER_URL to auto-join agent.",
      },
    });
  }

  const parsed = StartSessionSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: { code: "VALIDATION_ERROR", details: parsed.error.flatten() } });
  }

  const input = parsed.data;
  const roomName = input.roomName ?? `coziyoo-room-${crypto.randomUUID().slice(0, 8)}`;
  const userIdentity = input.participantIdentity ?? `admin-preview-user-${Date.now()}`;
  const userMetadata = input.metadata ?? JSON.stringify({ source: "admin-panel", kind: "session-start-user" });
  const agentIdentity = buildRoomScopedAgentIdentity(roomName);
  const agentName = env.LIVEKIT_AGENT_IDENTITY;
  const agentMetadata = JSON.stringify({ source: "admin-panel", kind: "session-start-agent", roomName });

  try {
    await ensureLiveKitRoom(roomName);
  } catch (error) {
    return res.status(502).json({
      error: {
        code: "LIVEKIT_ROOM_CREATE_FAILED",
        message: error instanceof Error ? error.message : "Room create failed",
      },
    });
  }

  const userToken = await mintLiveKitToken({
    identity: userIdentity,
    name: input.participantName,
    metadata: userMetadata,
    ttlSeconds: input.ttlSeconds,
    grant: {
      roomJoin: true,
      room: roomName,
      canPublish: true,
      canSubscribe: true,
      canPublishData: true,
    },
  });

  const agentToken = await mintLiveKitToken({
    identity: agentIdentity,
    name: agentName,
    metadata: agentMetadata,
    ttlSeconds: input.ttlSeconds,
    grant: {
      roomJoin: true,
      room: roomName,
      canPublish: true,
      canSubscribe: true,
      canPublishData: true,
    },
  });

  try {
    const alreadyRunning = await isParticipantInRoom(roomName, agentIdentity);
    const dispatch = alreadyRunning
      ? null
      : await dispatchAgentJoin({
          roomName,
          participantIdentity: agentIdentity,
          participantName: agentName,
          token: agentToken,
          metadata: agentMetadata,
          voiceMode: "assistant_native_audio",
        });

    return res.status(201).json({
      data: {
        roomName,
        wsUrl: env.LIVEKIT_URL,
        user: {
          participantIdentity: userIdentity,
          token: userToken,
        },
        agent: {
          participantIdentity: agentIdentity,
          dispatched: alreadyRunning ? false : (dispatch?.ok ?? false),
          alreadyRunning,
          dispatch,
          preview: tokenPreview(agentToken),
        },
      },
    });
  } catch (error) {
    return res.status(502).json({
      error: {
        code: "AI_SERVER_DISPATCH_FAILED",
        message: error instanceof Error ? error.message : "Agent dispatch failed",
      },
    });
  }
});

adminLiveKitRouter.post("/agent/chat", async (req, res) => {
  if (!isLiveKitConfigured()) {
    return res.status(503).json({
      error: {
        code: "LIVEKIT_NOT_CONFIGURED",
        message: "Set LIVEKIT_URL, LIVEKIT_API_KEY and LIVEKIT_API_SECRET in API environment.",
      },
    });
  }

  const parsed = AgentChatSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: { code: "VALIDATION_ERROR", details: parsed.error.flatten() } });
  }

  const input = parsed.data;
  const agentIdentity = buildRoomScopedAgentIdentity(input.roomName);

  try {
    const answer = await askOllamaChat(input.text);
    const payload = {
      type: "agent_message",
      from: agentIdentity,
      text: answer.text,
      ts: new Date().toISOString(),
      model: answer.model,
    };

    await sendRoomData(input.roomName, payload, { topic: "chat" });

    return res.status(201).json({
      data: {
        roomName: input.roomName,
        agentIdentity,
        message: payload,
      },
    });
  } catch (error) {
    return res.status(502).json({
      error: {
        code: "AGENT_CHAT_FAILED",
        message: error instanceof Error ? error.message : "Agent chat failed",
      },
    });
  }
});

// ── Voice Agent Settings ─────────────────────────────────────────────────────

const AdminAgentSettingsSchema = z.object({
  agentName: z.string().max(128).optional(),
  voiceLanguage: z.string().min(2).max(16).optional(),
  ollamaModel: z.string().max(128).optional(),
  ollamaBaseUrl: z.string().optional(),
  ttsEnabled: z.boolean().optional(),
  ttsBaseUrl: z.string().optional(),
  ttsSynthPath: z.string().max(256).optional(),
  sttEnabled: z.boolean().optional(),
  sttProvider: z.string().max(64).optional(),
  sttBaseUrl: z.string().optional(),
  sttTranscribePath: z.string().max(256).optional(),
  sttModel: z.string().max(128).optional(),
  n8nBaseUrl: z.string().optional(),
  systemPrompt: z.string().max(4_000).optional(),
  greetingEnabled: z.boolean().optional(),
  greetingInstruction: z.string().max(2_000).optional(),
  sttQueryParams: z.record(z.string(), z.string()).optional(),
  ttsQueryParams: z.record(z.string(), z.string()).optional(),
  sttAuthHeader: z.string().max(512).optional(),
  ttsAuthHeader: z.string().max(512).optional(),
  llmAuthHeader: z.string().max(512).optional(),
});

adminLiveKitRouter.get("/agent-settings", async (_req, res) => {
  try {
    const hasIsActive = await hasStarterAgentIsActiveColumn();
    const result = hasIsActive
      ? await pool.query(
          `SELECT device_id, agent_name, voice_language, ollama_model, tts_engine, tts_enabled, stt_enabled,
                  COALESCE(is_active, FALSE) AS is_active, updated_at
           FROM starter_agent_settings ORDER BY is_active DESC, updated_at DESC`,
        )
      : await pool.query(
          `SELECT device_id, agent_name, voice_language, ollama_model, tts_engine, tts_enabled, stt_enabled,
                  FALSE AS is_active, updated_at
           FROM starter_agent_settings ORDER BY updated_at DESC`,
        );
    return res.json({ data: result.rows });
  } catch (err) {
    return res.status(500).json({ error: { code: "DB_ERROR", message: err instanceof Error ? err.message : "Query failed" } });
  }
});

adminLiveKitRouter.delete("/agent-settings/:deviceId", async (req, res) => {
  try {
    const result = await pool.query(
      `DELETE FROM starter_agent_settings WHERE device_id = $1 RETURNING device_id`,
      [req.params.deviceId],
    );
    if (result.rowCount === 0) {
      return res.status(404).json({ error: { code: "NOT_FOUND", message: "Profile not found" } });
    }
    return res.json({ data: { deleted: req.params.deviceId } });
  } catch (err) {
    return res.status(500).json({ error: { code: "DB_ERROR", message: err instanceof Error ? err.message : "Query failed" } });
  }
});

adminLiveKitRouter.post("/agent-settings/:deviceId/activate", async (req, res) => {
  try {
    const hasIsActive = await hasStarterAgentIsActiveColumn();
    if (!hasIsActive) {
      await ensureStarterAgentIsActiveColumn();
    }

    // Clear any existing active flag, then set the new one — in a transaction
    await pool.query("BEGIN");
    await pool.query(`UPDATE starter_agent_settings SET is_active = FALSE WHERE is_active = TRUE`);
    const result = await pool.query(
      `UPDATE starter_agent_settings SET is_active = TRUE WHERE device_id = $1 RETURNING device_id`,
      [req.params.deviceId],
    );
    if (result.rowCount === 0) {
      await pool.query("ROLLBACK");
      return res.status(404).json({ error: { code: "NOT_FOUND", message: "Profile not found" } });
    }
    await pool.query("COMMIT");
    return res.json({ data: { active: req.params.deviceId } });
  } catch (err) {
    await pool.query("ROLLBACK").catch(() => undefined);
    return res.status(500).json({ error: { code: "DB_ERROR", message: err instanceof Error ? err.message : "Query failed" } });
  }
});

adminLiveKitRouter.get("/agent-settings/:deviceId", async (req, res) => {
  try {
    const settings = await getStarterAgentSettings(req.params.deviceId);
    if (!settings) {
      return res.status(404).json({ error: { code: "NOT_FOUND", message: "No settings found for this device" } });
    }
    return res.json({ data: settings });
  } catch (err) {
    return res.status(500).json({ error: { code: "DB_ERROR", message: err instanceof Error ? err.message : "Query failed" } });
  }
});

adminLiveKitRouter.put("/agent-settings/:deviceId", async (req, res) => {
  const parsed = AdminAgentSettingsSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: { code: "VALIDATION_ERROR", details: parsed.error.flatten() } });
  }

  const { deviceId } = req.params;
  const input = parsed.data;
  try {
  const existing = await getStarterAgentSettings(deviceId);

  const existingTtsConfig = (existing?.ttsConfig ?? {}) as Record<string, unknown>;
  const existingStt = (typeof existingTtsConfig.stt === "object" && existingTtsConfig.stt !== null ? existingTtsConfig.stt : {}) as Record<string, unknown>;
  const existingLlm = (typeof existingTtsConfig.llm === "object" && existingTtsConfig.llm !== null ? existingTtsConfig.llm : {}) as Record<string, unknown>;
  const existingN8n = (typeof existingTtsConfig.n8n === "object" && existingTtsConfig.n8n !== null ? existingTtsConfig.n8n : {}) as Record<string, unknown>;

  const mergedTtsConfig = {
    ...existingTtsConfig,
    ...(input.ttsBaseUrl !== undefined ? { baseUrl: input.ttsBaseUrl || null } : {}),
    ...(input.ttsSynthPath !== undefined ? { path: input.ttsSynthPath || null } : {}),
    ...(input.ttsQueryParams !== undefined ? { queryParams: input.ttsQueryParams } : {}),
    ...(input.ttsAuthHeader !== undefined ? { authHeader: input.ttsAuthHeader || null } : {}),
    stt: {
      ...existingStt,
      ...(input.sttProvider !== undefined ? { provider: input.sttProvider } : {}),
      ...(input.sttBaseUrl !== undefined ? { baseUrl: input.sttBaseUrl || null } : {}),
      ...(input.sttTranscribePath !== undefined ? { transcribePath: input.sttTranscribePath } : {}),
      ...(input.sttModel !== undefined ? { model: input.sttModel } : {}),
      ...(input.sttQueryParams !== undefined ? { queryParams: input.sttQueryParams } : {}),
      ...(input.sttAuthHeader !== undefined ? { authHeader: input.sttAuthHeader || null } : {}),
    },
    llm: {
      ...existingLlm,
      ...(input.ollamaBaseUrl !== undefined ? { ollamaBaseUrl: input.ollamaBaseUrl || null } : {}),
      ...(input.llmAuthHeader !== undefined ? { authHeader: input.llmAuthHeader || null } : {}),
    },
    n8n: {
      ...existingN8n,
      ...(input.n8nBaseUrl !== undefined ? { baseUrl: input.n8nBaseUrl || null } : {}),
    },
  };

    const settings = await upsertStarterAgentSettings({
      deviceId,
      agentName: input.agentName ?? existing?.agentName ?? "coziyoo-agent",
      voiceLanguage: input.voiceLanguage ?? existing?.voiceLanguage ?? "en",
      ollamaModel: input.ollamaModel ?? existing?.ollamaModel ?? "llama3.1:8b",
      ttsEngine: normalizeTtsEngine(existing?.ttsEngine),
      ttsEnabled: input.ttsEnabled ?? existing?.ttsEnabled ?? true,
      sttEnabled: input.sttEnabled ?? existing?.sttEnabled ?? true,
      ttsConfig: mergedTtsConfig,
      systemPrompt: input.systemPrompt ?? existing?.systemPrompt ?? undefined,
      greetingEnabled: input.greetingEnabled ?? existing?.greetingEnabled ?? true,
      greetingInstruction: input.greetingInstruction ?? existing?.greetingInstruction ?? undefined,
    });
    return res.json({ data: settings });
  } catch (err) {
    return res.status(500).json({ error: { code: "DB_ERROR", message: err instanceof Error ? err.message : "Query failed" } });
  }
});

// ── Connection Tests ──────────────────────────────────────────────────────────

adminLiveKitRouter.post("/test/livekit", async (_req, res) => {
  try {
    const configured = isLiveKitConfigured();
    if (!configured) {
      return res.json({ data: { ok: false, reason: "LIVEKIT_NOT_CONFIGURED" } });
    }
    const { RoomServiceClient } = await import("livekit-server-sdk");
    const client = new RoomServiceClient(
      env.LIVEKIT_URL!.replace(/^wss?:\/\//, "https://"),
      env.LIVEKIT_API_KEY!,
      env.LIVEKIT_API_SECRET!,
    );
    await client.listRooms();
    return res.json({ data: { ok: true, wsUrl: env.LIVEKIT_URL } });
  } catch (err) {
    return res.json({ data: { ok: false, reason: err instanceof Error ? err.message : "Connection failed" } });
  }
});

const TestSttSchema = z.object({
  baseUrl: z.string().min(1),
  transcribePath: z.string().optional(),
});

adminLiveKitRouter.post("/test/stt", async (req, res) => {
  const parsed = TestSttSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: { code: "VALIDATION_ERROR", details: parsed.error.flatten() } });
  }
  const { baseUrl, transcribePath = "/v1/transcribe" } = parsed.data;
  try {
    const url = `${baseUrl.replace(/\/$/, "")}${transcribePath}`;
    const response = await fetch(url, { method: "OPTIONS", signal: AbortSignal.timeout(5_000) });
    return res.json({ data: { ok: true, status: response.status, url } });
  } catch (err) {
    return res.json({ data: { ok: false, reason: err instanceof Error ? err.message : "Unreachable" } });
  }
});

const TestOllamaSchema = z.object({
  baseUrl: z.string().optional(),
  modelsPath: z.string().optional(),
});

adminLiveKitRouter.post("/test/ollama", async (req, res) => {
  const parsed = TestOllamaSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: { code: "VALIDATION_ERROR", details: parsed.error.flatten() } });
  }
  try {
    const result = await listOllamaModels({ baseUrl: parsed.data.baseUrl || undefined, modelsPath: parsed.data.modelsPath || undefined });
    return res.json({ data: { ok: true, models: result.models } });
  } catch (err) {
    return res.json({ data: { ok: false, reason: err instanceof Error ? err.message : "Unreachable" } });
  }
});

const TestN8nSchema = z.object({
  baseUrl: z.string().optional(),
});

adminLiveKitRouter.post("/test/n8n", async (req, res) => {
  const parsed = TestN8nSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: { code: "VALIDATION_ERROR", details: parsed.error.flatten() } });
  }
  try {
    const status = await getN8nStatus({ baseUrl: parsed.data.baseUrl || undefined });
    return res.json({ data: { ok: status.reachable, status } });
  } catch (err) {
    return res.json({ data: { ok: false, reason: err instanceof Error ? err.message : "Unreachable" } });
  }
});

const TestTtsSchema = z.object({
  text: z.string().min(1).max(500),
  baseUrl: z.string().min(1),
  synthPath: z.string().optional(),
  queryParams: z.record(z.string(), z.string()).optional(),
  authHeader: z.string().optional(),
});

adminLiveKitRouter.post("/test/tts", async (req, res) => {
  const parsed = TestTtsSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: { code: "VALIDATION_ERROR", details: parsed.error.flatten() } });
  }
  const { text, baseUrl, synthPath, queryParams, authHeader } = parsed.data;

  const path = synthPath?.trim() || "/tts";
  let url = `${baseUrl.replace(/\/$/, "")}${path}`;

  if (queryParams && Object.keys(queryParams).length > 0) {
    const qs = new URLSearchParams(queryParams).toString();
    url = `${url}?${qs}`;
  }

  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (authHeader?.trim()) {
    headers["Authorization"] = authHeader.trim();
  }

  try {
    const upstream = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify({ text }),
      signal: AbortSignal.timeout(30_000),
    });

    if (!upstream.ok) {
      const errText = await upstream.text().catch(() => "");
      return res.status(502).json({
        error: { code: "TTS_ERROR", message: `TTS server responded ${upstream.status}: ${errText.slice(0, 200)}` },
      });
    }

    const contentType = upstream.headers.get("content-type") ?? "audio/wav";
    res.setHeader("Content-Type", contentType);
    res.setHeader("Cache-Control", "no-store");

    const buffer = await upstream.arrayBuffer();
    return res.send(Buffer.from(buffer));
  } catch (err) {
    return res.status(502).json({
      error: { code: "TTS_UNREACHABLE", message: err instanceof Error ? err.message : "TTS server unreachable" },
    });
  }
});
