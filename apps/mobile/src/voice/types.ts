export type SessionData = {
  wsUrl: string;
  token: string;
  roomName: string;
  userIdentity: string;
};

export type VoiceState = 'idle' | 'starting' | 'active' | 'error';

export type AgentMode = 'voice' | 'text';
