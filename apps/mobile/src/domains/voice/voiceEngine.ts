import { AudioSession } from '@livekit/react-native';
import {
  ConnectionState,
  LocalAudioTrack,
  Room,
  RoomEvent,
  createLocalAudioTrack,
} from 'livekit-client';
import type { VoiceEvent } from './types';

const MAX_CONNECT_ATTEMPTS = 3;
const CONNECT_TIMEOUT_MS = 12_000;

type StartInput = {
  wsUrl: string;
  token: string;
};

type Listener = (event: VoiceEvent) => void;

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class VoiceEngine {
  private room: Room | null = null;
  private localTrack: LocalAudioTrack | null = null;
  private listeners = new Set<Listener>();

  onEvent(listener: Listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private emit(event: VoiceEvent) {
    this.listeners.forEach((listener) => listener(event));
  }

  async start(input: StartInput): Promise<void> {
    await this.stop();
    const room = new Room({ adaptiveStream: true, dynacast: true });
    this.room = room;

    room
      .on(RoomEvent.ConnectionStateChanged, (state) => {
        this.emit({ type: 'state_changed', state });
      })
      .on(RoomEvent.DataReceived, (payload, _participant, _kind, topic) => {
        const text = new TextDecoder().decode(payload);
        if (topic === 'transcript_partial') {
          this.emit({ type: 'transcript_partial', text });
          return;
        }
        if (topic === 'transcript' || topic === 'chat') {
          this.emit({ type: 'transcript_final', text });
          return;
        }
      })
      .on(RoomEvent.ActiveSpeakersChanged, (speakers) => {
        const remoteSpeaking = speakers.some((speaker) => !speaker.isLocal);
        if (remoteSpeaking) {
          this.emit({ type: 'agent_reply', text: 'Agent is speaking' });
        }
      })
      .on(RoomEvent.Disconnected, () => {
        this.emit({ type: 'error', message: 'Voice room disconnected' });
      });

    const withTimeout = async <T>(promise: Promise<T>) =>
      Promise.race([
        promise,
        new Promise<T>((_, reject) => setTimeout(() => reject(new Error('connect_timeout')), CONNECT_TIMEOUT_MS)),
      ]);

    let lastError: unknown = null;
    for (let attempt = 1; attempt <= MAX_CONNECT_ATTEMPTS; attempt += 1) {
      try {
        await AudioSession.startAudioSession();
        await withTimeout(room.connect(input.wsUrl, input.token, { autoSubscribe: true }));
        const track = await createLocalAudioTrack();
        this.localTrack = track;
        await room.localParticipant.publishTrack(track);
        return;
      } catch (error) {
        lastError = error;
        if (attempt < MAX_CONNECT_ATTEMPTS) {
          await wait(attempt * 500);
        }
      }
    }

    const message = lastError instanceof Error ? lastError.message : 'Failed to connect voice session';
    this.emit({ type: 'error', message });
    throw new Error(message);
  }

  async stop() {
    if (this.localTrack) {
      this.localTrack.stop();
      this.localTrack = null;
    }
    if (this.room) {
      await this.room.disconnect();
      this.room = null;
    }
    await AudioSession.stopAudioSession();
    this.emit({ type: 'state_changed', state: ConnectionState.Disconnected });
  }
}
