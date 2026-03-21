import type { VoiceState, VoiceStateListener } from './types';
import { resolveVoiceConfig } from './config';
import { createVapiVoiceProvider } from './vapiProvider';

export interface VoiceProvider {
  getState(): VoiceState;
  subscribe(listener: VoiceStateListener): () => void;
  start(userId: string): Promise<void>;
  stop(): void;
  setMuted(muted: boolean): void;
}

let singleton: VoiceProvider | null = null;

export function getVoiceProvider(): VoiceProvider {
  if (singleton) return singleton;

  const config = resolveVoiceConfig();
  // Currently only VAPI is implemented. Keeping this switch allows future providers
  // without touching UI screens.
  switch (config.provider) {
    case 'vapi':
    default:
      singleton = createVapiVoiceProvider(config);
      return singleton;
  }
}

