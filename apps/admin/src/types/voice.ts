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

export type VoiceSettingsTab = "summary" | "general" | "stt" | "tts" | "llm" | "n8n" | "behaviour";
