export type DeviceRow = {
  device_id: string;
  agent_name: string;
  voice_language: string;
  ollama_model: string;
  tts_engine: string;
  tts_enabled: boolean;
  stt_enabled: boolean;
  is_active: boolean;
  updated_at: string;
};

export type AgentSettingsFull = {
  deviceId: string;
  agentName: string;
  voiceLanguage: string;
  ollamaModel: string;
  ttsEngine: string;
  ttsConfig: Record<string, unknown> | null;
  ttsEnabled: boolean;
  sttEnabled: boolean;
  systemPrompt: string | null;
  greetingEnabled: boolean;
  greetingInstruction: string | null;
  updatedAt: string;
};

export type SttServer = {
  id: string;
  name: string;
  enabled: boolean;
  provider: string;
  baseUrl: string;
  transcribePath: string;
  model: string;
  queryParams: Record<string, string>;
  authHeader: string;
};

export type TtsServer = {
  id: string;
  name: string;
  enabled: boolean;
  baseUrl: string;
  synthPath: string;
  /** Field name used to send the speech text in the JSON body (default: "text"; use "input" for OpenAI-compatible servers) */
  textFieldName: string;
  /** Static key-value pairs merged into the JSON request body (e.g. model, voice, temperature) */
  bodyParams: Record<string, string>;
  queryParams: Record<string, string>;
  authHeader: string;
};

export type N8nServer = {
  id: string;
  name: string;
  enabled: boolean;
  baseUrl: string;
  webhookPath: string;
  mcpWebhookPath: string;
};

export type VoiceSettingsTab = "summary" | "stt" | "tts" | "n8n" | "general";
