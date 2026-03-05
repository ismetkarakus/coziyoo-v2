import { AudioSession } from '@livekit/react-native';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ConnectionState, LocalAudioTrack, Room, RoomEvent, createLocalAudioTrack } from 'livekit-client';
import { AgentActionEnvelopeSchema } from '../actions/schema';

export type VoiceStatus = 'connecting' | 'listening' | 'agent_speaking' | 'disconnected' | 'error';

type VoiceSessionInput = {
  wsUrl?: string;
  token?: string;
  onAction: (jsonText: string) => void;
  onError: (message: string) => void;
  onStateChange?: (state: ConnectionState) => void;
};

const MAX_CONNECT_ATTEMPTS = 3;
const CONNECT_TIMEOUT_MS = 12_000;

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function useVoiceSession(input: VoiceSessionInput) {
  const roomRef = useRef<Room | null>(null);
  const localTrackRef = useRef<LocalAudioTrack | null>(null);
  const [connectionState, setConnectionState] = useState<ConnectionState>(ConnectionState.Disconnected);
  const [isAgentSpeaking, setIsAgentSpeaking] = useState(false);
  const [isError, setIsError] = useState(false);
  const [lastAgentText, setLastAgentText] = useState('');

  const ready = useMemo(() => Boolean(input.wsUrl && input.token), [input.wsUrl, input.token]);

  const voiceStatus: VoiceStatus = useMemo(() => {
    if (isError) return 'error';
    if (
      connectionState === ConnectionState.Connecting ||
      connectionState === ConnectionState.Reconnecting ||
      connectionState === ConnectionState.SignalReconnecting
    ) {
      return 'connecting';
    }
    if (connectionState === ConnectionState.Connected) {
      return isAgentSpeaking ? 'agent_speaking' : 'listening';
    }
    return 'disconnected';
  }, [isError, connectionState, isAgentSpeaking]);

  useEffect(() => {
    if (!ready || !input.wsUrl || !input.token) {
      return;
    }

    setIsError(false);
    setIsAgentSpeaking(false);
    setLastAgentText('');

    let cancelled = false;
    const room = new Room({
      adaptiveStream: true,
      dynacast: true,
    });
    roomRef.current = room;

    const withTimeout = async <T>(promise: Promise<T>, timeoutMs: number) => {
      return await Promise.race([
        promise,
        new Promise<T>((_, reject) => setTimeout(() => reject(new Error('connect_timeout')), timeoutMs)),
      ]);
    };

    const connect = async () => {
      let lastError: unknown = null;

      for (let attempt = 1; attempt <= MAX_CONNECT_ATTEMPTS && !cancelled; attempt += 1) {
        try {
          await AudioSession.startAudioSession();
          await withTimeout(
            room.connect(input.wsUrl!, input.token!, {
              autoSubscribe: true,
            }),
            CONNECT_TIMEOUT_MS,
          );

          const micTrack = await createLocalAudioTrack();
          localTrackRef.current = micTrack;
          await room.localParticipant.publishTrack(micTrack);
          return;
        } catch (error) {
          lastError = error;
          if (attempt < MAX_CONNECT_ATTEMPTS) {
            await wait(attempt * 500);
          }
        }
      }

      const message =
        lastError instanceof Error ? `LiveKit connect failed: ${lastError.message}` : 'LiveKit connect failed after retries';
      setIsError(true);
      input.onError(message);
    };

    room
      .on(RoomEvent.ConnectionStateChanged, (state) => {
        setConnectionState(state);
        input.onStateChange?.(state);
      })
      .on(RoomEvent.Disconnected, () => {
        setIsAgentSpeaking(false);
        if (!cancelled) {
          input.onError('LiveKit room disconnected');
        }
      })
      .on(RoomEvent.ActiveSpeakersChanged, (speakers) => {
        setIsAgentSpeaking(speakers.some((s) => !s.isLocal));
      })
      .on(RoomEvent.DataReceived, (payload, _participant, _kind, topic) => {
        try {
          const text = new TextDecoder().decode(payload);

          // Capture transcript / chat messages for UI display
          if (topic === 'transcript' || topic === 'chat') {
            try {
              const parsed = JSON.parse(text);
              if (typeof parsed.text === 'string') {
                setLastAgentText(parsed.text);
              } else if (typeof parsed.message === 'string') {
                setLastAgentText(parsed.message);
              }
            } catch {
              setLastAgentText(text);
            }
            return;
          }

          // All other messages are action envelopes
          const parsed = JSON.parse(text);
          const valid = AgentActionEnvelopeSchema.safeParse(parsed);
          if (!valid.success) {
            input.onError('Rejected invalid action envelope from agent');
            return;
          }
          input.onAction(text);
        } catch {
          input.onError('Rejected malformed DataChannel message');
        }
      });

    void connect();

    return () => {
      cancelled = true;
      if (localTrackRef.current) {
        localTrackRef.current.stop();
        localTrackRef.current = null;
      }
      void room.disconnect();
      void AudioSession.stopAudioSession();
    };
  }, [ready, input.onAction, input.onError, input.onStateChange, input.token, input.wsUrl]);

  return {
    connectionState,
    voiceStatus,
    lastAgentText,
    disconnect: async () => {
      if (localTrackRef.current) {
        localTrackRef.current.stop();
        localTrackRef.current = null;
      }
      if (roomRef.current) {
        await roomRef.current.disconnect();
      }
      await AudioSession.stopAudioSession();
    },
  };
}
