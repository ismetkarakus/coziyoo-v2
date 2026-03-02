import { AudioSession } from '@livekit/react-native';
import { useEffect, useMemo, useRef, useState } from 'react';
import { ConnectionState, Room, RoomEvent, createLocalAudioTrack } from 'livekit-client';
import { AgentActionEnvelopeSchema } from '../actions/schema';

type VoiceSessionInput = {
  wsUrl?: string;
  token?: string;
  onAction: (jsonText: string) => void;
  onError: (message: string) => void;
};

export function useVoiceSession(input: VoiceSessionInput) {
  const roomRef = useRef<Room | null>(null);
  const [connectionState, setConnectionState] = useState<ConnectionState>(ConnectionState.Disconnected);

  const ready = useMemo(() => Boolean(input.wsUrl && input.token), [input.wsUrl, input.token]);

  useEffect(() => {
    if (!ready || !input.wsUrl || !input.token) {
      return;
    }

    const room = new Room({
      adaptiveStream: true,
      dynacast: true,
    });
    roomRef.current = room;

    const connect = async () => {
      try {
        await AudioSession.startAudioSession();
        await room.connect(input.wsUrl!, input.token!, {
          autoSubscribe: true,
        });

        const micTrack = await createLocalAudioTrack();
        await room.localParticipant.publishTrack(micTrack);
      } catch (error) {
        input.onError(error instanceof Error ? error.message : 'LiveKit connect failed');
      }
    };

    room
      .on(RoomEvent.ConnectionStateChanged, (state) => setConnectionState(state))
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
      void room.disconnect();
      void AudioSession.stopAudioSession();
    };
  }, [ready, input.onAction, input.onError, input.token, input.wsUrl]);

  return {
    connectionState,
    disconnect: async () => {
      if (roomRef.current) {
        await roomRef.current.disconnect();
      }
      await AudioSession.stopAudioSession();
    },
  };
}
