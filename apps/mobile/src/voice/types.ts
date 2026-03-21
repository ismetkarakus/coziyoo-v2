export type VoiceStatus = 'connecting' | 'listening' | 'speaking' | 'error';
export type ConnectStage = 'session' | 'audio' | 'joining';
export type VoiceProviderName = 'vapi' | 'livekit';

export type VoiceState = {
  status: VoiceStatus;
  connectStage: ConnectStage;
  isMuted: boolean;
  isEnding: boolean;
  errorMessage: string | null;
  endTick: number;
};

export type VoiceStateListener = (state: VoiceState) => void;

