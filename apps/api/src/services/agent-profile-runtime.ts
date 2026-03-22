import { env } from "../config/env.js";
import { pool } from "../db/client.js";

type JsonRecord = Record<string, unknown>;

type AgentProfileRow = {
  id: string;
  is_active: boolean;
  system_prompt: string | null;
  greeting_enabled: boolean;
  greeting_instruction: string | null;
  voice_language: string | null;
  llm_config: JsonRecord | null;
  stt_config: JsonRecord | null;
  tts_config: JsonRecord | null;
  n8n_config: JsonRecord | null;
};

export type RuntimeProfileProviders = {
  stt: {
    provider: string;
    baseUrl: string | null;
    transcribePath: string;
    model: string;
    queryParams: Record<string, string>;
    authHeader: string | null;
  };
  llm: {
    baseUrl: string | null;
    model: string;
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

export type RuntimeProfileConfig = {
  profileId: string;
  voiceLanguage: string;
  systemPrompt: string | null;
  greetingEnabled: boolean;
  greetingInstruction: string | null;
  providers: RuntimeProfileProviders;
};

function toRecord(value: unknown): JsonRecord {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return {};
  return value as JsonRecord;
}

function str(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function strWithFallback(value: unknown, fallback: string): string {
  return str(value) ?? fallback;
}

function pick(config: JsonRecord, ...keys: string[]): unknown {
  for (const key of keys) {
    if (key in config) return config[key];
  }
  return undefined;
}

function queryParamsOf(value: unknown): Record<string, string> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return {};
  const output: Record<string, string> = {};
  for (const [key, raw] of Object.entries(value)) {
    if (typeof raw === "string") output[key] = raw;
  }
  return output;
}

function bodyParamsOf(value: unknown): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return {};
  const output: Record<string, unknown> = {};
  for (const [key, raw] of Object.entries(value)) {
    if (typeof raw === "string" || typeof raw === "number" || typeof raw === "boolean") {
      output[key] = raw;
    }
  }
  return output;
}

function normalizeProviders(row: AgentProfileRow): RuntimeProfileProviders {
  const stt = toRecord(row.stt_config);
  const llm = toRecord(row.llm_config);
  const tts = toRecord(row.tts_config);
  const n8n = toRecord(row.n8n_config);

  return {
    stt: {
      provider: strWithFallback(pick(stt, "provider"), "remote-speech-server"),
      baseUrl: str(pick(stt, "baseUrl", "base_url")) ?? env.SPEECH_TO_TEXT_BASE_URL ?? null,
      transcribePath: strWithFallback(
        pick(stt, "transcribePath", "transcribe_path"),
        env.SPEECH_TO_TEXT_TRANSCRIBE_PATH,
      ),
      model: strWithFallback(pick(stt, "model"), env.SPEECH_TO_TEXT_MODEL),
      queryParams: queryParamsOf(pick(stt, "queryParams", "query_params")),
      authHeader: str(pick(stt, "authHeader", "auth_header")),
    },
    llm: {
      baseUrl: str(pick(llm, "baseUrl", "base_url")) ?? env.OLLAMA_BASE_URL ?? null,
      model: strWithFallback(pick(llm, "model"), env.OLLAMA_CHAT_MODEL),
      authHeader: str(pick(llm, "authHeader", "auth_header")),
    },
    tts: {
      engine: strWithFallback(pick(tts, "engine"), "f5-tts"),
      baseUrl: str(pick(tts, "baseUrl", "base_url")),
      synthPath: strWithFallback(pick(tts, "synthPath", "synth_path", "path"), "/tts"),
      textFieldName: strWithFallback(pick(tts, "textFieldName", "text_field_name"), "text"),
      bodyParams: bodyParamsOf(pick(tts, "bodyParams", "body_params")),
      queryParams: queryParamsOf(pick(tts, "queryParams", "query_params")),
      authHeader: str(pick(tts, "authHeader", "auth_header")),
    },
    n8n: {
      baseUrl: str(pick(n8n, "baseUrl", "base_url")) ?? env.N8N_HOST ?? null,
      workflowId: str(pick(n8n, "workflowId", "workflow_id")) ?? env.N8N_LLM_WORKFLOW_ID,
      mcpWorkflowId: str(pick(n8n, "mcpWorkflowId", "mcp_workflow_id")) ?? env.N8N_MCP_WORKFLOW_ID,
      webhookUrl: str(pick(n8n, "webhookUrl", "webhook_url", "endpoint", "url")) ?? env.N8N_LLM_WEBHOOK_URL ?? null,
      webhookPath: str(pick(n8n, "webhookPath", "webhook_path")) ?? env.N8N_LLM_WEBHOOK_PATH ?? null,
      mcpWebhookPath: str(pick(n8n, "mcpWebhookPath", "mcp_webhook_path")) ?? env.N8N_MCP_WEBHOOK_PATH ?? null,
      authHeader: str(pick(n8n, "authHeader", "auth_header")),
    },
  };
}

export async function resolveRuntimeProfileConfig(settingsProfileId?: string): Promise<RuntimeProfileConfig | null> {
  const selectedProfileId = typeof settingsProfileId === "string" && settingsProfileId.trim().length > 0
    ? settingsProfileId.trim()
    : null;

  const query = selectedProfileId
    ? `
      SELECT id, is_active, system_prompt, greeting_enabled, greeting_instruction, voice_language,
             llm_config, stt_config, tts_config, n8n_config
      FROM agent_profiles
      WHERE id = $1
      LIMIT 1
    `
    : `
      SELECT id, is_active, system_prompt, greeting_enabled, greeting_instruction, voice_language,
             llm_config, stt_config, tts_config, n8n_config
      FROM agent_profiles
      WHERE is_active = TRUE
      ORDER BY updated_at DESC
      LIMIT 1
    `;

  const params = selectedProfileId ? [selectedProfileId] : [];
  const result = await pool.query<AgentProfileRow>(query, params);
  const row = result.rows[0];
  if (!row) return null;

  return {
    profileId: row.id,
    voiceLanguage: str(row.voice_language) ?? "en",
    systemPrompt: row.system_prompt,
    greetingEnabled: row.greeting_enabled !== false,
    greetingInstruction: row.greeting_instruction,
    providers: normalizeProviders(row),
  };
}
