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
    bodyParams: Record<string, string>;
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
        baseUrl: strOrNull(defaultSttServer.baseUrl),
        transcribePath: str(defaultSttServer.transcribePath, env.SPEECH_TO_TEXT_TRANSCRIBE_PATH),
        model: str(defaultSttServer.model, env.SPEECH_TO_TEXT_MODEL),
        queryParams: recordOf(defaultSttServer.queryParams),
        authHeader: strOrNull(defaultSttServer.authHeader),
      }
    : {
        provider: str(legacyStt.provider, "remote-speech-server"),
        baseUrl: strOrNull(legacyStt.baseUrl),
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
        bodyParams: recordOf(defaultTtsServer.bodyParams),
        queryParams: recordOf(defaultTtsServer.queryParams),
        authHeader: strOrNull(defaultTtsServer.authHeader),
      }
    : {
        engine: settings?.ttsEngine ?? "f5-tts",
        baseUrl: strOrNull(ttsConfig.baseUrl),
        synthPath: str(ttsConfig.path, "/tts"),
        textFieldName: str(ttsConfig.textFieldName, "text"),
        bodyParams: recordOf(ttsConfig.bodyParams),
        queryParams: recordOf(ttsConfig.queryParams),
        authHeader: strOrNull(ttsConfig.authHeader),
      };

  // --- LLM ---
  const llm: ResolvedProviders["llm"] = defaultLlmServer
    ? {
        baseUrl: strOrNull(defaultLlmServer.baseUrl ?? defaultLlmServer.ollamaBaseUrl),
        model: str(defaultLlmServer.model, settings?.ollamaModel ?? env.OLLAMA_CHAT_MODEL),
        authHeader: strOrNull(defaultLlmServer.authHeader),
      }
    : {
        baseUrl: strOrNull(legacyLlm.ollamaBaseUrl),
        model: settings?.ollamaModel ?? env.OLLAMA_CHAT_MODEL,
        authHeader: strOrNull(legacyLlm.authHeader),
      };

  // --- N8N ---
  const n8n: ResolvedProviders["n8n"] = defaultN8nServer
    ? { baseUrl: strOrNull(defaultN8nServer.baseUrl) }
    : { baseUrl: strOrNull(legacyN8n.baseUrl) };

  return { stt, tts, llm, n8n };
}
