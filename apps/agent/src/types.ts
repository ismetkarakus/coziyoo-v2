export type Tokens = {
  accessToken: string;
  refreshToken: string;
};

export type AgentSettings = {
  agentName: string;
  voiceLanguage: string;
  ollamaModel: string;
  ollamaBaseUrl?: string;
  n8nBaseUrl?: string;
  sttProvider?: string;
  sttBaseUrl?: string;
  sttTranscribePath?: string;
  sttModel?: string;
  ttsEngine: "f5-tts" | "xtts" | "chatterbox";
  ttsEnabled: boolean;
  sttEnabled: boolean;
  systemPrompt?: string;
  greetingEnabled: boolean;
  greetingInstruction?: string;
  ttsConfig?: {
    baseUrl?: string;
    path?: string;
    stt?: {
      provider?: string;
      baseUrl?: string;
      transcribePath?: string;
      model?: string;
    };
    llm?: {
      ollamaBaseUrl?: string;
    };
    n8n?: {
      baseUrl?: string;
    };
    [key: string]: unknown;
  };
  updatedAt?: string;
};
