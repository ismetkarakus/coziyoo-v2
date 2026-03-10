import { env } from "../config/env.js";
import type { StarterAgentSettings } from "./starter-agent-settings.js";

export type ResolvedProviders = {
  stt: {
    provider: string;
    baseUrl: string | null;
    transcribePath: string;
    model: string;
    queryParams: Record<string, string>;
    authHeader: string | null;
  };
  tts: {
    engine: string;
    baseUrl: string | null;
    synthPath: string;
    textFieldName: string;
    bodyParams: Record<string, unknown>;
    queryParams: Record<string, string>;
    authHeader: string | null;
  };
  llm: {
    baseUrl: string | null;
    model: string;
    authHeader: string | null;
  };
  n8n: {
    baseUrl: string | null;
    workflowId: string | null;
    mcpWorkflowId: string | null;
    webhookUrl: string | null;
    webhookPath: string | null;
    mcpWebhookPath: string | null;
    authHeader: string | null;
  };
};

type ServerRecord = Record<string, unknown>;

function findDefaultServer(
  servers: ServerRecord[] | undefined,
  defaultId: string | undefined,
): ServerRecord | null {
  if (!Array.isArray(servers) || servers.length === 0) return null;
  if (defaultId) {
    const match = servers.find((s) => s.id === defaultId);
    if (match) return match;
  }
  // Fallback: first enabled server, or just the first one
  const enabled = servers.find((s) => s.enabled !== false);
  return enabled ?? servers[0];
}

function str(value: unknown, fallback: string): string {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : fallback;
}

function strOrNull(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function recordOf(value: unknown): Record<string, string> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return {};
  const result: Record<string, string> = {};
  for (const [k, v] of Object.entries(value)) {
    if (typeof v === "string") result[k] = v;
  }
  return result;
}

function coerceScalar(value: string): string | number | boolean {
  const trimmed = value.trim();
  if (trimmed === "true") return true;
  if (trimmed === "false") return false;
  if (/^-?\d+(\.\d+)?$/.test(trimmed)) return Number(trimmed);
  return value;
}

function bodyRecordOf(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return {};
  const result: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value)) {
    if (typeof v === "string") result[k] = coerceScalar(v);
    else if (typeof v === "number" || typeof v === "boolean") result[k] = v;
  }
  return result;
}

export function resolveProviders(settings: StarterAgentSettings | null): ResolvedProviders {
  const ttsConfig = (settings?.ttsConfig ?? {}) as ServerRecord;

  // Legacy sub-objects from tts_config_json
  const legacyStt = (typeof ttsConfig.stt === "object" && ttsConfig.stt !== null ? ttsConfig.stt : {}) as ServerRecord;
  const legacyLlm = (typeof ttsConfig.llm === "object" && ttsConfig.llm !== null ? ttsConfig.llm : {}) as ServerRecord;
  const legacyN8n = (typeof ttsConfig.n8n === "object" && ttsConfig.n8n !== null ? ttsConfig.n8n : {}) as ServerRecord;

  // Multi-server arrays stored in tts_config_json
  const sttServers = ttsConfig.sttServers as ServerRecord[] | undefined;
  const ttsServers = ttsConfig.ttsServers as ServerRecord[] | undefined;
  const llmServers = ttsConfig.llmServers as ServerRecord[] | undefined;
  const n8nServers = ttsConfig.n8nServers as ServerRecord[] | undefined;

  const defaultSttServer = findDefaultServer(sttServers, ttsConfig.defaultSttServerId as string | undefined);
  const defaultTtsServer = findDefaultServer(ttsServers, ttsConfig.defaultTtsServerId as string | undefined);
  const defaultLlmServer = findDefaultServer(llmServers, ttsConfig.defaultLlmServerId as string | undefined);
  const defaultN8nServer = findDefaultServer(n8nServers, ttsConfig.defaultN8nServerId as string | undefined);

  // --- STT ---
  const stt: ResolvedProviders["stt"] = defaultSttServer
    ? {
        provider: str(defaultSttServer.provider, "remote-speech-server"),
        baseUrl: strOrNull(defaultSttServer.baseUrl) ?? env.SPEECH_TO_TEXT_BASE_URL ?? null,
        transcribePath: str(defaultSttServer.transcribePath, env.SPEECH_TO_TEXT_TRANSCRIBE_PATH),
        model: str(defaultSttServer.model, env.SPEECH_TO_TEXT_MODEL),
        queryParams: recordOf(defaultSttServer.queryParams),
        authHeader: strOrNull(defaultSttServer.authHeader),
      }
    : {
        provider: str(legacyStt.provider, "remote-speech-server"),
        baseUrl: strOrNull(legacyStt.baseUrl) ?? env.SPEECH_TO_TEXT_BASE_URL ?? null,
        transcribePath: str(legacyStt.transcribePath, env.SPEECH_TO_TEXT_TRANSCRIBE_PATH),
        model: str(legacyStt.model, env.SPEECH_TO_TEXT_MODEL),
        queryParams: recordOf(legacyStt.queryParams),
        authHeader: strOrNull(legacyStt.authHeader),
      };

  // --- TTS ---
  const tts: ResolvedProviders["tts"] = defaultTtsServer
    ? {
        engine: str(defaultTtsServer.engine, settings?.ttsEngine ?? "f5-tts"),
        baseUrl: strOrNull(defaultTtsServer.baseUrl),
        synthPath: str(defaultTtsServer.synthPath ?? defaultTtsServer.path, "/tts"),
        textFieldName: str(defaultTtsServer.textFieldName, "text"),
        bodyParams: bodyRecordOf(defaultTtsServer.bodyParams),
        queryParams: recordOf(defaultTtsServer.queryParams),
        authHeader: strOrNull(defaultTtsServer.authHeader),
      }
    : {
        engine: settings?.ttsEngine ?? "f5-tts",
        baseUrl: strOrNull(ttsConfig.baseUrl),
        synthPath: str(ttsConfig.path, "/tts"),
        textFieldName: str(ttsConfig.textFieldName, "text"),
        bodyParams: bodyRecordOf(ttsConfig.bodyParams),
        queryParams: recordOf(ttsConfig.queryParams),
        authHeader: strOrNull(ttsConfig.authHeader),
      };

  // --- LLM ---
  const llm: ResolvedProviders["llm"] = defaultLlmServer
    ? {
        baseUrl: strOrNull(defaultLlmServer.baseUrl ?? defaultLlmServer.ollamaBaseUrl) ?? env.OLLAMA_BASE_URL,
        model: str(defaultLlmServer.model, settings?.ollamaModel ?? env.OLLAMA_CHAT_MODEL),
        authHeader: strOrNull(defaultLlmServer.authHeader),
      }
    : {
        baseUrl: strOrNull(legacyLlm.ollamaBaseUrl) ?? env.OLLAMA_BASE_URL,
        model: settings?.ollamaModel ?? env.OLLAMA_CHAT_MODEL,
        authHeader: strOrNull(legacyLlm.authHeader),
      };

  // --- N8N ---
  const n8n: ResolvedProviders["n8n"] = defaultN8nServer
    ? {
        baseUrl: strOrNull(defaultN8nServer.baseUrl) ?? env.N8N_HOST ?? null,
        workflowId: strOrNull(defaultN8nServer.workflowId) ?? env.N8N_LLM_WORKFLOW_ID,
        mcpWorkflowId: strOrNull(defaultN8nServer.mcpWorkflowId) ?? env.N8N_MCP_WORKFLOW_ID,
        webhookUrl:
          strOrNull(defaultN8nServer.webhookUrl ?? defaultN8nServer.endpoint ?? defaultN8nServer.url) ??
          (env.N8N_LLM_WEBHOOK_URL || null),
        webhookPath: strOrNull(defaultN8nServer.webhookPath) ?? (env.N8N_LLM_WEBHOOK_PATH || null),
        mcpWebhookPath: strOrNull(defaultN8nServer.mcpWebhookPath) ?? (env.N8N_MCP_WEBHOOK_PATH || null),
        authHeader: strOrNull(defaultN8nServer.authHeader),
      }
    : {
        baseUrl: strOrNull(legacyN8n.baseUrl) ?? env.N8N_HOST ?? null,
        workflowId: strOrNull(legacyN8n.workflowId) ?? env.N8N_LLM_WORKFLOW_ID,
        mcpWorkflowId: strOrNull(legacyN8n.mcpWorkflowId) ?? env.N8N_MCP_WORKFLOW_ID,
        webhookUrl:
          strOrNull(legacyN8n.webhookUrl ?? legacyN8n.endpoint ?? legacyN8n.url) ??
          (env.N8N_LLM_WEBHOOK_URL || null),
        webhookPath: strOrNull(legacyN8n.webhookPath) ?? (env.N8N_LLM_WEBHOOK_PATH || null),
        mcpWebhookPath: strOrNull(legacyN8n.mcpWebhookPath) ?? (env.N8N_MCP_WEBHOOK_PATH || null),
        authHeader: strOrNull(legacyN8n.authHeader),
      };

  return { stt, tts, llm, n8n };
}
