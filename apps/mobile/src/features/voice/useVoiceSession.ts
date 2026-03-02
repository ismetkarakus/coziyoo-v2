import { AudioSession } from '@livekit/react-native';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ConnectionState, LocalAudioTrack, Room, RoomEvent, createLocalAudioTrack } from 'livekit-client';
import { AgentActionEnvelopeSchema } from '../actions/schema';

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

  const ready = useMemo(() => Boolean(input.wsUrl && input.token), [input.wsUrl, input.token]);

  useEffect(() => {
    if (!ready || !input.wsUrl || !input.token) {
      return;
    }

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
      input.onError(message);
    };

    room
      .on(RoomEvent.ConnectionStateChanged, (state) => {
        setConnectionState(state);
        input.onStateChange?.(state);
      })
      .on(RoomEvent.Disconnected, () => {
        if (!cancelled) {
          input.onError('LiveKit room disconnected');
        }
      })
      .on(RoomEvent.DataReceived, (payload) => {
        try {
          const text = new TextDecoder().decode(payload);
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
