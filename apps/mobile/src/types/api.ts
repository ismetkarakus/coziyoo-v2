export type AuthTokens = {
  accessToken: string;
  refreshToken: string;
  tokenType: 'Bearer';
};

export type LoginResponse = {
  user: {
    id: string;
    email: string;
    userType: string;
  };
  tokens: AuthTokens;
};

export type StartSessionRequest = {
  roomName?: string;
  participantName?: string;
  metadata?: string;
  ttlSeconds?: number;
  autoDispatchAgent?: boolean;
  locale?: string;
  campaignId?: string;
  leadId?: string;
  channel?: string;
  deviceId?: string;
  settingsProfileId?: string;
};

export type StartSessionResponse = {
  roomName: string;
  wsUrl: string;
  user: {
    participantIdentity: string;
    token: string;
  };
  agent: {
    participantIdentity: string;
    dispatched: boolean;
    alreadyRunning: boolean;
    dispatch: {
      endpoint: string;
      ok: boolean;
      status: number;
      body: unknown;
    } | null;
  };
};
