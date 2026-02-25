export type TtsServerConfig = {
  baseUrl?: string;
  path?: string;
  f5?: {
    speakerId?: string;
    speakerWavPath?: string;
  };
  xtts?: {
    speakerWavUrl?: string;
  };
  chatterbox?: {
    voiceMode?: 'predefined' | 'clone';
    predefinedVoiceId?: string;
    referenceAudioFilename?: string;
    outputFormat?: 'wav' | 'opus';
    splitText?: boolean;
    chunkSize?: number;
    temperature?: number;
    exaggeration?: number;
    cfgWeight?: number;
    seed?: number;
    speedFactor?: number;
  };
};

export type StarterAgentSettings = {
  agentName: string;
  voiceLanguage: string;
  ollamaModel: string;
  ttsEngine: 'f5-tts' | 'xtts' | 'chatterbox';
  ttsConfig?: TtsServerConfig;
  ttsEnabled: boolean;
  sttEnabled: boolean;
  systemPrompt?: string;
  greetingEnabled: boolean;
  greetingInstruction?: string;
  updatedAt?: string;
};

export const STARTER_AGENT_SETTINGS_DEFAULTS: StarterAgentSettings = {
  agentName: '',
  voiceLanguage: 'tr',
  ollamaModel: 'llama3.1',
  ttsEngine: 'f5-tts',
  ttsConfig: {},
  ttsEnabled: true,
  sttEnabled: true,
  systemPrompt: '',
  greetingEnabled: true,
  greetingInstruction: '',
};

export function normalizeStarterAgentSettings(input: unknown): StarterAgentSettings {
  if (!input || typeof input !== 'object') {
    return STARTER_AGENT_SETTINGS_DEFAULTS;
  }

  const value = input as Record<string, unknown>;
  const agentName = typeof value.agentName === 'string' ? value.agentName.trim() : '';
  const voiceLanguage = typeof value.voiceLanguage === 'string' ? value.voiceLanguage.trim() : 'tr';
  const ollamaModel = typeof value.ollamaModel === 'string' ? value.ollamaModel.trim() : 'llama3.1';
  const ttsEngine =
    value.ttsEngine === 'xtts' || value.ttsEngine === 'chatterbox' ? value.ttsEngine : 'f5-tts';
  const ttsConfig = normalizeTtsConfig(value.ttsConfig);
  const ttsEnabled = typeof value.ttsEnabled === 'boolean' ? value.ttsEnabled : true;
  const sttEnabled = typeof value.sttEnabled === 'boolean' ? value.sttEnabled : true;
  const systemPrompt = typeof value.systemPrompt === 'string' ? value.systemPrompt : '';
  const greetingEnabled = typeof value.greetingEnabled === 'boolean' ? value.greetingEnabled : true;
  const greetingInstruction =
    typeof value.greetingInstruction === 'string' ? value.greetingInstruction : '';
  const updatedAt = typeof value.updatedAt === 'string' ? value.updatedAt : undefined;

  return {
    agentName,
    voiceLanguage: voiceLanguage || 'tr',
    ollamaModel: ollamaModel || 'llama3.1',
    ttsEngine,
    ttsConfig,
    ttsEnabled,
    sttEnabled,
    systemPrompt,
    greetingEnabled,
    greetingInstruction,
    updatedAt,
  };
}

function normalizeTtsConfig(input: unknown): TtsServerConfig {
  if (!input || typeof input !== 'object') {
    return {};
  }
  const value = input as Record<string, unknown>;
  const f5Raw = value.f5 && typeof value.f5 === 'object' ? (value.f5 as Record<string, unknown>) : {};
  const xttsRaw =
    value.xtts && typeof value.xtts === 'object' ? (value.xtts as Record<string, unknown>) : {};
  const chatterRaw =
    value.chatterbox && typeof value.chatterbox === 'object'
      ? (value.chatterbox as Record<string, unknown>)
      : {};

  const chunkSize = typeof chatterRaw.chunkSize === 'number' ? chatterRaw.chunkSize : undefined;
  const temperature =
    typeof chatterRaw.temperature === 'number' ? chatterRaw.temperature : undefined;
  const exaggeration =
    typeof chatterRaw.exaggeration === 'number' ? chatterRaw.exaggeration : undefined;
  const cfgWeight = typeof chatterRaw.cfgWeight === 'number' ? chatterRaw.cfgWeight : undefined;
  const seed = typeof chatterRaw.seed === 'number' ? chatterRaw.seed : undefined;
  const speedFactor =
    typeof chatterRaw.speedFactor === 'number' ? chatterRaw.speedFactor : undefined;

  return {
    baseUrl: typeof value.baseUrl === 'string' ? value.baseUrl : '',
    path: typeof value.path === 'string' ? value.path : '',
    f5: {
      speakerId: typeof f5Raw.speakerId === 'string' ? f5Raw.speakerId : '',
      speakerWavPath: typeof f5Raw.speakerWavPath === 'string' ? f5Raw.speakerWavPath : '',
    },
    xtts: {
      speakerWavUrl: typeof xttsRaw.speakerWavUrl === 'string' ? xttsRaw.speakerWavUrl : '',
    },
    chatterbox: {
      voiceMode: chatterRaw.voiceMode === 'clone' ? 'clone' : 'predefined',
      predefinedVoiceId:
        typeof chatterRaw.predefinedVoiceId === 'string' ? chatterRaw.predefinedVoiceId : '',
      referenceAudioFilename:
        typeof chatterRaw.referenceAudioFilename === 'string'
          ? chatterRaw.referenceAudioFilename
          : '',
      outputFormat: chatterRaw.outputFormat === 'opus' ? 'opus' : 'wav',
      splitText: typeof chatterRaw.splitText === 'boolean' ? chatterRaw.splitText : true,
      chunkSize,
      temperature,
      exaggeration,
      cfgWeight,
      seed,
      speedFactor,
    },
  };
}
