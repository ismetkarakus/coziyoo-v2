import type { NavigationContainerRef } from '@react-navigation/native';
import { ConnectionState } from 'livekit-client';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { executeAgentAction } from '../agent/actionExecutor';
import { evaluatePolicy } from '../agent/policyGuard';
import type { ConversationState, IntentContext, N8nTurnResponse, UserIntent } from '../agent/types';
import { useOrderStore } from '../orders/orderStore';
import { sendN8nTurn } from '../../infrastructure/orchestration/n8nClient';
import { startLiveKitSession } from '../../services/api/livekit';
import { trackEvent } from '../../services/telemetry/client';
import { useSessionStore } from '../../state/sessionStore';
import type { RootStackParamList } from '../../types/navigation';
import { useScreenContextStore } from './screenContextStore';
import type { VoiceUiState } from './types';
import { VoiceEngine } from './voiceEngine';

const YES_WORDS = ['yes', 'confirm', 'go ahead', 'do it', 'place order'];

function inferIntent(text: string): UserIntent {
  const lower = text.toLowerCase();
  if (lower.includes('checkout') || lower.includes('place order')) return 'checkout';
  if (lower.includes('add') || lower.includes('remove')) return 'add_item';
  if (lower.includes('compare')) return 'compare';
  if (lower.includes('help') || lower.includes('support')) return 'support';
  return 'browse';
}

function extractText(payload: string): string {
  try {
    const parsed = JSON.parse(payload) as { text?: string; message?: string };
    if (typeof parsed.text === 'string') return parsed.text;
    if (typeof parsed.message === 'string') return parsed.message;
    return payload;
  } catch {
    return payload;
  }
}

type UseAvatarSessionControllerInput = {
  navigationRef: { current: NavigationContainerRef<RootStackParamList> | null };
};

export function useAvatarSessionController(input: UseAvatarSessionControllerInput) {
  const auth = useSessionStore((s) => s.auth);
  const livekitSession = useSessionStore((s) => s.livekitSession);
  const setLivekitSession = useSessionStore((s) => s.setLivekitSession);
  const selectedDeviceId = useSessionStore((s) => s.selectedDeviceId);
  const settingsProfileId = useSessionStore((s) => s.settingsProfileId);
  const screenContext = useScreenContextStore((s) => s.context);
  const orderStatus = useOrderStore((s) => s.status);
  const markPendingConfirmation = useOrderStore((s) => s.markPendingConfirmation);

  const engineRef = useRef<VoiceEngine | null>(null);
  const [uiState, setUiState] = useState<VoiceUiState>('idle');
  const [lastAssistantText, setLastAssistantText] = useState('');
  const [lastTranscript, setLastTranscript] = useState('');
  const [unreadSuggestion, setUnreadSuggestion] = useState(false);
  const [conversation, setConversation] = useState<ConversationState>({
    conversationId: `conv_${Date.now()}`,
    turnId: 0,
    pendingConfirmation: 'none',
    activeOrderDraftId: undefined,
  });

  const isConnected = useMemo(
    () => uiState === 'listening' || uiState === 'thinking' || uiState === 'speaking' || uiState === 'connecting',
    [uiState],
  );

  const handleN8nResponse = useCallback(
    async (response: N8nTurnResponse, userText: string) => {
      setLastAssistantText(response.assistantText);
      setUnreadSuggestion(true);
      setConversation((prev) => ({ ...prev, turnId: prev.turnId + 1 }));

      for (const action of response.actions) {
        const confirmed = YES_WORDS.some((word) => userText.toLowerCase().includes(word));
        const decision = evaluatePolicy(action, conversation, confirmed);
        if (!decision.allowed) {
          markPendingConfirmation();
          setConversation((prev) => ({ ...prev, pendingConfirmation: 'place_order' }));
          await trackEvent(auth?.tokens.accessToken, {
            level: 'warn',
            eventType: 'policy_blocked',
            message: decision.reason ?? 'Action blocked by policy',
            metadata: { action: action.type, idempotencyKey: decision.idempotencyKey },
          });
          continue;
        }

        executeAgentAction(action, { navigationRef: input.navigationRef });
        await trackEvent(auth?.tokens.accessToken, {
          level: 'info',
          eventType: 'policy_allowed',
          message: 'Action executed',
          metadata: { action: action.type, idempotencyKey: decision.idempotencyKey },
        });
      }
    },
    [auth?.tokens.accessToken, conversation, input.navigationRef, markPendingConfirmation],
  );

  const start = useCallback(async () => {
    if (!auth?.tokens.accessToken || isConnected) return;

    setUiState('connecting');
    const engine = new VoiceEngine();
    engineRef.current = engine;

    engine.onEvent(async (event) => {
      if (event.type === 'state_changed') {
        if (event.state === ConnectionState.Connected) {
          setUiState('listening');
        } else if (event.state === ConnectionState.Connecting || event.state === ConnectionState.Reconnecting) {
          setUiState('connecting');
        } else if (event.state === ConnectionState.Disconnected) {
          setUiState('idle');
        }
      } else if (event.type === 'transcript_final') {
        const text = extractText(event.text);
        setLastTranscript(text);
        setUiState('thinking');
        const intentContext: IntentContext = {
          intent: inferIntent(text),
          confidence: 0.7,
          entities: {},
          lastUserGoal: text,
        };

        try {
          const response = await sendN8nTurn(auth.tokens.accessToken, {
            conversation,
            screenContext,
            intentContext,
            catalogSnapshotRef: 'mobile_catalog_v1',
            userProfileRef: auth.user.id,
            audioMeta: {
              roomName: livekitSession?.roomName,
              language: 'en-US',
            },
            userText: text,
          });
          await handleN8nResponse(response, text);
          setUiState('speaking');
        } catch {
          setLastAssistantText('I could not reach the assistant brain. Please try again.');
          setUiState('error');
        }
      } else if (event.type === 'error') {
        setUiState('error');
      }
    });

    try {
      const session = await startLiveKitSession(auth.tokens.accessToken, {
        participantName: auth.user.email,
        autoDispatchAgent: true,
        channel: 'mobile',
        deviceId: selectedDeviceId,
        settingsProfileId,
      });
      setLivekitSession(session);
      await engine.start({ wsUrl: session.wsUrl, token: session.user.token });
    } catch {
      setUiState('error');
    }
  }, [
    auth?.tokens.accessToken,
    auth?.user.email,
    auth?.user.id,
    conversation,
    handleN8nResponse,
    isConnected,
    livekitSession?.roomName,
    screenContext,
    selectedDeviceId,
    setLivekitSession,
    settingsProfileId,
  ]);

  const stop = useCallback(async () => {
    const engine = engineRef.current;
    if (engine) {
      await engine.stop();
      engineRef.current = null;
    }
    setLivekitSession(null);
    setUiState('idle');
  }, [setLivekitSession]);

  const markAvatarSeen = useCallback(() => setUnreadSuggestion(false), []);

  useEffect(() => {
    return () => {
      const engine = engineRef.current;
      if (engine) {
        void engine.stop();
      }
    };
  }, []);

  return {
    uiState,
    start,
    stop,
    isConnected,
    unreadSuggestion,
    markAvatarSeen,
    lastAssistantText,
    lastTranscript,
    orderStatus,
  };
}
