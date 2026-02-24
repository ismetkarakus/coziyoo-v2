export type StarterAgentSettings = {
  agentName: string;
  voiceLanguage: string;
  ttsEnabled: boolean;
  sttEnabled: boolean;
  systemPrompt?: string;
  updatedAt?: string;
};

export const STARTER_AGENT_SETTINGS_DEFAULTS: StarterAgentSettings = {
  agentName: '',
  voiceLanguage: 'tr',
  ttsEnabled: true,
  sttEnabled: true,
  systemPrompt: '',
};

export function normalizeStarterAgentSettings(input: unknown): StarterAgentSettings {
  if (!input || typeof input !== 'object') {
    return STARTER_AGENT_SETTINGS_DEFAULTS;
  }

  const value = input as Record<string, unknown>;
  const agentName = typeof value.agentName === 'string' ? value.agentName.trim() : '';
  const voiceLanguage = typeof value.voiceLanguage === 'string' ? value.voiceLanguage.trim() : 'tr';
  const ttsEnabled = typeof value.ttsEnabled === 'boolean' ? value.ttsEnabled : true;
  const sttEnabled = typeof value.sttEnabled === 'boolean' ? value.sttEnabled : true;
  const systemPrompt = typeof value.systemPrompt === 'string' ? value.systemPrompt : '';
  const updatedAt = typeof value.updatedAt === 'string' ? value.updatedAt : undefined;

  return {
    agentName,
    voiceLanguage: voiceLanguage || 'tr',
    ttsEnabled,
    sttEnabled,
    systemPrompt,
    updatedAt,
  };
}
