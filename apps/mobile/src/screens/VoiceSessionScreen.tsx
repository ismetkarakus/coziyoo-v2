import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import Vapi from '@vapi-ai/react-native';
import type { AssistantOverrides } from '@vapi-ai/react-native/dist/api';
import type { SessionData } from './HomeScreen';

type Props = {
  session: SessionData;
  onEnd: () => void;
  onSwitchToText: () => void;
};

type VoiceStatus = 'connecting' | 'listening' | 'speaking' | 'error';
type ConnectStage = 'session' | 'audio' | 'joining';

const VAPI_PUBLIC_KEY = (
  process.env.EXPO_PUBLIC_VAPI_PUBLIC_KEY ??
  process.env.VAPI_PUBLIC_API_KEY ??
  process.env.VAPI_PUBLIC_KEY ??
  ''
).trim();

const VAPI_ASSISTANT_ID = (
  process.env.EXPO_PUBLIC_VAPI_ASSISTANT_ID ??
  process.env.VAPI_ASSISTANT_ID ??
  ''
).trim();

let sharedVapi: Vapi | null = VAPI_PUBLIC_KEY ? new Vapi(VAPI_PUBLIC_KEY) : null;
let startInFlight = false;
let callActive = false;

function toErrorMessage(value: unknown): string {
  if (value instanceof Error) return value.message;
  if (typeof value === 'string') return value;
  if (value && typeof value === 'object' && 'message' in value) {
    const message = (value as { message?: unknown }).message;
    if (typeof message === 'string') return message;
  }
  return 'Ses baglantisi basarisiz oldu. Lutfen tekrar deneyin.';
}

export default function VoiceSessionScreen({ session, onEnd, onSwitchToText }: Props) {
  const [status, setStatus] = useState<VoiceStatus>('connecting');
  const [connectStage, setConnectStage] = useState<ConnectStage>('session');
  const [isMuted, setIsMuted] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [ending, setEnding] = useState(false);

  const onEndRef = useRef(onEnd);
  const vapiRef = useRef<Vapi | null>(null);
  const startedRef = useRef(false);

  useEffect(() => {
    onEndRef.current = onEnd;
  }, [onEnd]);

  const statusLabel = useMemo(() => {
    if (status === 'connecting') {
      if (connectStage === 'audio') return 'Ses kuruluyor...';
      if (connectStage === 'joining') return 'Oturuma katiliniyor...';
      return 'Baglanti baslatiliyor...';
    }
    if (status === 'listening') return 'Aktif (dinliyor)';
    if (status === 'speaking') return 'Aktif (konusuyor)';
    return 'Baglanti hatasi';
  }, [connectStage, status]);

  useEffect(() => {
    if (!VAPI_PUBLIC_KEY || !VAPI_ASSISTANT_ID) {
      setStatus('error');
      setErrorMessage(
        'VAPI env eksik: EXPO_PUBLIC_VAPI_PUBLIC_KEY + EXPO_PUBLIC_VAPI_ASSISTANT_ID (veya legacy VAPI_PUBLIC_API_KEY + VAPI_ASSISTANT_ID).'
      );
      return;
    }

    if (!sharedVapi) {
      sharedVapi = new Vapi(VAPI_PUBLIC_KEY);
    }

    const vapi = sharedVapi;
    vapiRef.current = vapi;

    const initTsRef = { current: Date.now() };

    const handleCallStart = () => {
      startedRef.current = true;
      startInFlight = false;
      callActive = true;
      setStatus('listening');
      setConnectStage('joining');
      console.log('[VAPI] call-start');
    };

    const handleCallEnd = () => {
      startedRef.current = false;
      startInFlight = false;
      callActive = false;
      setEnding(false);
      setIsMuted(false);
      onEndRef.current();
    };

    const handleSpeechStart = () => {
      setStatus('speaking');
    };

    const handleSpeechEnd = () => {
      setStatus('listening');
    };

    const handleError = (error: unknown) => {
      startInFlight = false;
      callActive = false;
      startedRef.current = false;
      setStatus('error');
      setErrorMessage(toErrorMessage(error));
    };

    const handleProgress = (event: { stage: string; status: string; duration?: number }) => {
      const elapsed = Date.now() - initTsRef.current;
      console.log(
        `[VAPI] ${event.stage} -> ${event.status}${event.duration != null ? ` (${event.duration}ms)` : ''} | total: ${elapsed}ms`
      );
      if (event.status === 'started') {
        if (event.stage === 'daily-call-object-creation') setConnectStage('audio');
        else if (event.stage === 'daily-call-join') setConnectStage('joining');
        else if (event.stage === 'web-call-creation') setConnectStage('session');
      }
    };

    const handleCallStartSuccess = (event: { totalDuration: number }) => {
      console.log(`[VAPI] connected - total: ${event.totalDuration}ms`);
    };

    const handleCallStartFailed = (event: { stage: string; totalDuration: number; error: string }) => {
      console.warn(`[VAPI] connect failed at ${event.stage} after ${event.totalDuration}ms: ${event.error}`);
    };

    vapi.on('call-start', handleCallStart);
    vapi.on('call-end', handleCallEnd);
    vapi.on('speech-start', handleSpeechStart);
    vapi.on('speech-end', handleSpeechEnd);
    vapi.on('error', handleError);
    vapi.on('call-start-progress', handleProgress);
    vapi.on('call-start-success', handleCallStartSuccess);
    vapi.on('call-start-failed', handleCallStartFailed);

    const start = async () => {
      if (startInFlight || callActive) return;
      startInFlight = true;
      initTsRef.current = Date.now();
      setStatus('connecting');
      setConnectStage('session');
      setErrorMessage(null);
      setEnding(false);
      setIsMuted(false);

      const overrides: AssistantOverrides & { firstMessageMode?: string } = {
        variableValues: { userId: session.userIdentity },
        firstMessageMode: 'assistant-waits-for-user',
      };

      console.log('[VAPI] start() called');
      try {
        await vapi.start(VAPI_ASSISTANT_ID, overrides);
      } catch (error) {
        handleError(error);
      }
    };

    void start();

    return () => {
      vapi.off('call-start', handleCallStart);
      vapi.off('call-end', handleCallEnd);
      vapi.off('speech-start', handleSpeechStart);
      vapi.off('speech-end', handleSpeechEnd);
      vapi.off('error', handleError);
      vapi.off('call-start-progress', handleProgress);
      vapi.off('call-start-success', handleCallStartSuccess);
      vapi.off('call-start-failed', handleCallStartFailed);

      if (callActive || startedRef.current) {
        try {
          vapi.stop();
        } catch {
          // ignore
        }
      }
      startInFlight = false;
      callActive = false;
      startedRef.current = false;
    };
  }, [session.userIdentity]);

  function handleMuteToggle() {
    if (!vapiRef.current || status === 'connecting' || status === 'error') return;
    const next = !isMuted;
    setIsMuted(next);
    vapiRef.current.setMuted(next);
  }

  function handleEndCall() {
    if (!vapiRef.current) {
      onEndRef.current();
      return;
    }
    setEnding(true);
    try {
      vapiRef.current.stop();
    } catch {
      onEndRef.current();
    }
  }

  return (
    <View style={styles.container}>
      <View style={styles.centerWrap}>
        {status === 'connecting' ? (
          <>
            <ActivityIndicator size="large" color="#4A7C59" />
            <Text style={styles.statusText}>{statusLabel}</Text>
          </>
        ) : status === 'error' ? (
          <>
            <Ionicons name="alert-circle-outline" size={48} color="#D45454" />
            <Text style={styles.errorText}>{errorMessage ?? 'Baglanti hatasi'}</Text>
          </>
        ) : (
          <>
            <Ionicons
              name={status === 'speaking' ? 'volume-high' : 'mic'}
              size={52}
              color="#4A7C59"
            />
            <Text style={styles.statusText}>{statusLabel}</Text>
          </>
        )}
      </View>

      <View style={styles.controlsRow}>
        <TouchableOpacity
          style={[styles.controlBtn, styles.textModeBtn]}
          onPress={onSwitchToText}
          activeOpacity={0.9}
        >
          <Ionicons name="chatbubble-ellipses-outline" size={18} color="#6B5D4F" />
          <Text style={styles.textModeText}>Yazi Modu</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.controlBtn, styles.muteBtn, isMuted && styles.muteBtnActive]}
          onPress={handleMuteToggle}
          disabled={status === 'connecting' || status === 'error' || ending}
          activeOpacity={0.9}
        >
          <Ionicons name={isMuted ? 'mic-off' : 'mic'} size={18} color="#fff" />
          <Text style={styles.controlText}>{isMuted ? 'Unmute' : 'Mute'}</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.controlBtn, styles.endBtn]}
          onPress={handleEndCall}
          disabled={ending}
          activeOpacity={0.9}
        >
          {ending ? (
            <ActivityIndicator color="#fff" size="small" />
          ) : (
            <>
              <Ionicons name="call-outline" size={18} color="#fff" />
              <Text style={styles.controlText}>Bitir</Text>
            </>
          )}
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    paddingHorizontal: 18,
    paddingVertical: 20,
    justifyContent: 'space-between',
  },
  centerWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
  },
  statusText: {
    color: '#5F7063',
    fontSize: 15,
    fontWeight: '700',
    textAlign: 'center',
  },
  errorText: {
    color: '#C44747',
    fontSize: 14,
    lineHeight: 20,
    textAlign: 'center',
    paddingHorizontal: 12,
  },
  controlsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingBottom: 8,
  },
  controlBtn: {
    flex: 1,
    minHeight: 48,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 8,
  },
  textModeBtn: {
    backgroundColor: '#EFE6DB',
  },
  textModeText: {
    color: '#6B5D4F',
    fontSize: 13,
    fontWeight: '700',
  },
  muteBtn: {
    backgroundColor: '#5B6E5F',
  },
  muteBtnActive: {
    backgroundColor: '#3F4D42',
  },
  endBtn: {
    backgroundColor: '#B64B38',
  },
  controlText: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '700',
  },
});
