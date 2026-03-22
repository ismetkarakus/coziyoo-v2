export type AdminUser = {
  id: string;
  email: string;
  role: "admin" | "super_admin";
  is_active?: boolean;
  last_login_at?: string | null;
};

export type Tokens = {
  accessToken: string;
  refreshToken: string;
};

export type ApiError = {
  error?: {
    code?: string;
    message?: string;
    details?: unknown;
  };
};

export type AgentProfile = {
  id: string;
  name: string;
  is_active: boolean;
  speaks_first: boolean;
  system_prompt: string | null;
  greeting_enabled: boolean;
  greeting_instruction: string | null;
  voice_language: string;
  llm_config: Record<string, unknown>;
  stt_config: Record<string, unknown>;
  tts_config: Record<string, unknown>;
  n8n_config: Record<string, unknown>;
  created_at: string;
  updated_at: string;
};
