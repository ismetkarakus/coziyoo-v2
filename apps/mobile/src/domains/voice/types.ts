import type { ConnectionState } from 'livekit-client';
import type { AgentAction } from '../agent/types';

export type VoiceUiState = 'idle' | 'listening' | 'thinking' | 'speaking' | 'error' | 'connecting';

export type VoiceEvent =
  | { type: 'state_changed'; state: ConnectionState }
  | { type: 'transcript_partial'; text: string }
  | { type: 'transcript_final'; text: string }
  | { type: 'agent_reply'; text: string }
  | { type: 'agent_action'; action: AgentAction }
  | { type: 'error'; message: string };

export type VoiceProviderSnapshot = {
  sttProvider?: string;
  sttBaseUrl?: string;
  ttsProvider?: string;
  ttsBaseUrl?: string;
  llmProvider?: string;
  llmBaseUrl?: string;
  llmModel?: string;
  n8nWorkflowEndpoint?: string;
};
