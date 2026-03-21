import type { VoiceProviderName } from './types';

export type VoiceConfig = {
  provider: VoiceProviderName;
  vapiPublicKey: string;
  vapiAssistantId: string;
};

function normalizeProvider(value: string): VoiceProviderName {
  const provider = value.trim().toLowerCase();
  if (provider === 'livekit') return 'livekit';
  return 'vapi';
}

export function resolveVoiceConfig(): VoiceConfig {
  return {
    provider: normalizeProvider(process.env.EXPO_PUBLIC_VOICE_PROVIDER ?? 'vapi'),
    vapiPublicKey: (
      process.env.EXPO_PUBLIC_VAPI_PUBLIC_KEY ??
      process.env.VAPI_PUBLIC_API_KEY ??
      process.env.VAPI_PUBLIC_KEY ??
      ''
    ).trim(),
    vapiAssistantId: (
      process.env.EXPO_PUBLIC_VAPI_ASSISTANT_ID ??
      process.env.VAPI_ASSISTANT_ID ??
      ''
    ).trim(),
  };
}

export function getVapiEnvError(config: VoiceConfig): string | null {
  if (config.provider !== 'vapi') return null;
  if (config.vapiPublicKey && config.vapiAssistantId) return null;
  return 'VAPI env eksik: EXPO_PUBLIC_VAPI_PUBLIC_KEY + EXPO_PUBLIC_VAPI_ASSISTANT_ID (veya legacy VAPI_PUBLIC_API_KEY + VAPI_ASSISTANT_ID).';
}

