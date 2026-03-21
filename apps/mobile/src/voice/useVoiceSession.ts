import { useState } from 'react';
import { refreshAuthSession, type AuthSession } from '../utils/auth';
import { t } from '../copy/brandCopy';
import type { SessionData, VoiceState } from './types';

type ApiErrorPayload = {
  error?: { code?: string; message?: string };
};

function resolveStartSessionError(
  payload: ApiErrorPayload,
  status: number,
): string {
  const code = payload?.error?.code;
  if (code === 'AGENT_UNAVAILABLE')
    return 'Ses asistani su an kullanilamiyor. Lutfen biraz sonra tekrar deneyin.';
  if (code === 'N8N_UNAVAILABLE')
    return 'AI sunucusuna ulasilamiyor. Lutfen n8n sunucusunu kontrol edin.';
  if (code === 'N8N_WORKFLOW_UNAVAILABLE')
    return 'AI is akisi kullanilamiyor veya aktif degil.';
  if (code === 'STT_UNAVAILABLE')
    return 'Konusma tanima kullanilamiyor. STT sunucusunu kontrol edin.';
  if (code === 'TTS_UNAVAILABLE')
    return 'Ses sentezi kullanilamiyor. TTS sunucusunu kontrol edin.';
  if (status === 401) return t('error.home.sessionExpired');
  return payload?.error?.message ?? `Sunucu hatasi ${status}`;
}

type UseVoiceSessionOptions = {
  apiUrl: string;
  auth: AuthSession;
  onAuthRefresh?: (session: AuthSession) => void;
  onLogout: () => void;
};

export function useVoiceSession({
  apiUrl,
  auth,
  onAuthRefresh,
  onLogout,
}: UseVoiceSessionOptions) {
  const [voiceState, setVoiceState] = useState<VoiceState>('idle');
  const [voiceError, setVoiceError] = useState<string | null>(null);
  const [voiceSession, setVoiceSession] = useState<SessionData | null>(null);
  const [currentAuth, setCurrentAuth] = useState(auth);

  async function startSessionWithToken(accessToken: string): Promise<void> {
    const response = await fetch(`${apiUrl}/v1/livekit/session/start`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({ autoDispatchAgent: true, channel: 'mobile' }),
    });

    const json = await response.json();

    if (response.status === 401) {
      const refreshed = await refreshAuthSession(apiUrl, currentAuth);
      if (refreshed) {
        setCurrentAuth(refreshed);
        onAuthRefresh?.(refreshed);
        return startSessionWithToken(refreshed.accessToken);
      }
      onLogout();
      return;
    }

    if (!response.ok || (json as ApiErrorPayload).error) {
      throw new Error(
        resolveStartSessionError(json as ApiErrorPayload, response.status),
      );
    }

    const { data } = json as {
      data: {
        roomName: string;
        wsUrl: string;
        user: { participantIdentity: string; token: string };
      };
    };

    setVoiceSession({
      wsUrl: data.wsUrl,
      token: data.user.token,
      roomName: data.roomName,
      userIdentity: data.user.participantIdentity,
    });
    setVoiceState('active');
    setVoiceError(null);
  }

  async function startVoice() {
    if (voiceState === 'starting' || voiceState === 'active') return;
    setVoiceError(null);
    setVoiceState('starting');
    try {
      await startSessionWithToken(currentAuth.accessToken);
    } catch (err) {
      setVoiceSession(null);
      setVoiceState('error');
      setVoiceError(
        err instanceof Error ? err.message : 'Oturum baslatilamadi',
      );
    }
  }

  function endVoice() {
    setVoiceSession(null);
    setVoiceState('idle');
    setVoiceError(null);
  }

  return {
    voiceState,
    voiceError,
    voiceSession,
    startVoice,
    endVoice,
  };
}
