export type ActionName = 'navigate' | 'open_profile' | 'append_note' | 'set_settings_hint';

export type AgentActionEnvelope = {
  type: 'action';
  version: '1.0';
  requestId: string;
  timestamp: string;
  action: {
    name: ActionName;
    params: Record<string, unknown>;
    policy?: {
      requiresConfirmation?: boolean;
    };
  };
};
