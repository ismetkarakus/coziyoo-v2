import Vapi from '@vapi-ai/react-native';
import type { AssistantOverrides } from '@vapi-ai/react-native/dist/api';
import type { VoiceProvider } from './provider';
import type { VoiceState, VoiceStateListener } from './types';
import type { VoiceConfig } from './config';
import { getVapiEnvError } from './config';

const INITIAL_STATE: VoiceState = {
  status: 'connecting',
  connectStage: 'session',
  isMuted: false,
  isEnding: false,
  errorMessage: null,
  endTick: 0,
};

function toErrorMessage(value: unknown): string {
  if (value instanceof Error) return value.message;
  if (typeof value === 'string') return value;
  if (value && typeof value === 'object' && 'message' in value) {
    const message = (value as { message?: unknown }).message;
    if (typeof message === 'string') return message;
  }
  return 'Ses baglantisi basarisiz oldu. Lutfen tekrar deneyin.';
}

class VapiVoiceProvider implements VoiceProvider {
  private readonly config: VoiceConfig;
  private readonly listeners = new Set<VoiceStateListener>();
  private readonly state: VoiceState = { ...INITIAL_STATE };

  private vapi: Vapi | null = null;
  private startInFlight = false;
  private callActive = false;

  constructor(config: VoiceConfig) {
    this.config = config;
    if (config.vapiPublicKey) {
      this.vapi = new Vapi(config.vapiPublicKey);
      this.attachEventHandlers();
    }
  }

  getState(): VoiceState {
    return { ...this.state };
  }

  subscribe(listener: VoiceStateListener): () => void {
    this.listeners.add(listener);
    listener(this.getState());
    return () => {
      this.listeners.delete(listener);
    };
  }

  async start(userId: string): Promise<void> {
    const envError = getVapiEnvError(this.config);
    if (envError) {
      this.patchState({ status: 'error', errorMessage: envError });
      return;
    }

    if (!this.vapi && this.config.vapiPublicKey) {
      this.vapi = new Vapi(this.config.vapiPublicKey);
      this.attachEventHandlers();
    }

    if (!this.vapi) {
      this.patchState({ status: 'error', errorMessage: 'VAPI baslatilamadi.' });
      return;
    }

    if (this.startInFlight || this.callActive) return;
    this.startInFlight = true;

    this.patchState({
      status: 'connecting',
      connectStage: 'session',
      isEnding: false,
      isMuted: false,
      errorMessage: null,
    });

    const initTs = Date.now();
    const overrides: AssistantOverrides & { firstMessageMode?: string } = {
      variableValues: { userId },
      firstMessageMode: 'assistant-waits-for-user',
    };

    console.log('[VAPI] start() called');
    try {
      await this.vapi.start(this.config.vapiAssistantId, overrides);
    } catch (error) {
      console.warn('[VAPI] start failed:', error);
      this.startInFlight = false;
      this.callActive = false;
      this.patchState({ status: 'error', errorMessage: toErrorMessage(error) });
    } finally {
      console.log(`[VAPI] start attempt total: ${Date.now() - initTs}ms`);
    }
  }

  stop(): void {
    if (!this.vapi) return;
    this.patchState({ isEnding: true });
    try {
      this.vapi.stop();
    } catch {
      this.startInFlight = false;
      this.callActive = false;
      this.patchState({
        isEnding: false,
        isMuted: false,
        endTick: Date.now(),
      });
    }
  }

  setMuted(muted: boolean): void {
    if (!this.vapi) return;
    this.vapi.setMuted(muted);
    this.patchState({ isMuted: muted });
  }

  private attachEventHandlers(): void {
    if (!this.vapi) return;

    this.vapi.on('call-start', () => {
      this.startInFlight = false;
      this.callActive = true;
      this.patchState({ status: 'listening', connectStage: 'joining', isEnding: false });
      console.log('[VAPI] call-start');
    });

    this.vapi.on('call-end', () => {
      this.startInFlight = false;
      this.callActive = false;
      this.patchState({
        isEnding: false,
        isMuted: false,
        endTick: Date.now(),
      });
    });

    this.vapi.on('speech-start', () => {
      this.patchState({ status: 'speaking' });
    });

    this.vapi.on('speech-end', () => {
      this.patchState({ status: 'listening' });
    });

    this.vapi.on('error', (error: unknown) => {
      this.startInFlight = false;
      this.callActive = false;
      this.patchState({ status: 'error', errorMessage: toErrorMessage(error), isEnding: false });
    });

    this.vapi.on('call-start-progress', (event: { stage: string; status: string; duration?: number }) => {
      if (event.status === 'started') {
        if (event.stage === 'daily-call-object-creation') {
          this.patchState({ connectStage: 'audio' });
        } else if (event.stage === 'daily-call-join') {
          this.patchState({ connectStage: 'joining' });
        } else if (event.stage === 'web-call-creation') {
          this.patchState({ connectStage: 'session' });
        }
      }
      console.log(
        `[VAPI] ${event.stage} -> ${event.status}${event.duration != null ? ` (${event.duration}ms)` : ''}`
      );
    });

    this.vapi.on('call-start-success', (event: { totalDuration: number }) => {
      console.log(`[VAPI] connected - total: ${event.totalDuration}ms`);
    });

    this.vapi.on('call-start-failed', (event: { stage: string; totalDuration: number; error: string }) => {
      console.warn(`[VAPI] connect failed at ${event.stage} after ${event.totalDuration}ms: ${event.error}`);
    });
  }

  private patchState(patch: Partial<VoiceState>): void {
    Object.assign(this.state, patch);
    const snapshot = this.getState();
    this.listeners.forEach((listener) => listener(snapshot));
  }
}

export function createVapiVoiceProvider(config: VoiceConfig): VoiceProvider {
  return new VapiVoiceProvider(config);
}

