'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Room, RoomEvent, Track } from 'livekit-client';
import type { StarterAgentSettings } from '@/lib/starter-settings';

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const MAX_EVENTS = 500;
const AGENT_CHAT_TIMEOUT_MS = 15000;

export type SessionConnectionState =
  | 'idle'
  | 'connecting'
  | 'connected'
  | 'reconnecting'
  | 'disconnected'
  | 'failed';

export type ChatMessage = {
  id: string;
  from: 'user' | 'agent' | 'system';
  text: string;
  ts: string;
};

export type VerboseEvent = {
  id: string;
  ts: string;
  source: 'client' | 'room' | 'participant' | 'track' | 'chat' | 'api' | 'error';
  eventType: string;
  summary: string;
  payload: unknown;
};

type ConnectionDetails = {
  serverUrl: string;
  roomName: string;
  participantName: string;
  participantToken: string;
};

type ControllerInput = {
  deviceId: string;
  settings: StarterAgentSettings;
};

function nextId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `${Date.now()}_${Math.random().toString(36).slice(2)}`;
}

function resolveGreetingContext(now: Date) {
  const weekday = now.toLocaleDateString(undefined, { weekday: 'long' });
  const hour = now.getHours();
  const timeOfDay =
    hour < 5 ? 'night' : hour < 12 ? 'morning' : hour < 18 ? 'afternoon' : 'evening';
  return { weekday, hour, timeOfDay };
}

function isLikelyAgentParticipant(identity: string | undefined, configuredAgentName: string) {
  const normalizedIdentity = (identity ?? '').trim().toLowerCase();
  const normalizedConfigured = configuredAgentName.trim().toLowerCase();
  if (!normalizedIdentity) return false;
  return (
    normalizedIdentity.includes('agent') ||
    (normalizedConfigured.length > 0 && normalizedIdentity.includes(normalizedConfigured))
  );
}

export function useVerboseSessionController({ deviceId, settings }: ControllerInput) {
  const [connectionState, setConnectionState] = useState<SessionConnectionState>('idle');
  const [events, setEvents] = useState<VerboseEvent[]>([]);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);
  const [micEnabled, setMicEnabled] = useState(true);
  const [speakerEnabled, setSpeakerEnabled] = useState(true);
  const [roomName, setRoomName] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [lastAgentTtsEngine, setLastAgentTtsEngine] = useState<string | null>(null);

  const roomRef = useRef<Room | null>(null);
  const audioElementsRef = useRef<Map<string, HTMLMediaElement>>(new Map());
  const audioRootRef = useRef<HTMLDivElement | null>(null);
  const speakerEnabledRef = useRef(true);
  const interruptTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const agentAudioTrackCountRef = useRef(0);
  const lastAgentAudioTrackTsRef = useRef<string | null>(null);
  speakerEnabledRef.current = speakerEnabled;

  const addEvent = useCallback(
    (event: Omit<VerboseEvent, 'id' | 'ts'>) => {
      const entry: VerboseEvent = {
        ...event,
        id: nextId(),
        ts: new Date().toISOString(),
      };
      setEvents((prev) => {
        const next = [...prev, entry];
        if (next.length > MAX_EVENTS) {
          return next.slice(next.length - MAX_EVENTS);
        }
        return next;
      });
      setSelectedEventId((current) => current ?? entry.id);
    },
    [setEvents, setSelectedEventId]
  );

  const clearLogs = useCallback(() => {
    setEvents([]);
    setSelectedEventId(null);
  }, []);

  const cleanupRoom = useCallback(() => {
    const room = roomRef.current;
    if (!room) return;

    for (const [, element] of audioElementsRef.current) {
      try {
        element.remove();
      } catch {
        // noop
      }
    }
    audioElementsRef.current.clear();
    agentAudioTrackCountRef.current = 0;
    lastAgentAudioTrackTsRef.current = null;
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      window.speechSynthesis.cancel();
    }
    if (interruptTimeoutRef.current) {
      clearTimeout(interruptTimeoutRef.current);
      interruptTimeoutRef.current = null;
    }
    room.removeAllListeners();
    room.disconnect();
    roomRef.current = null;
  }, []);

  const interruptAgentSpeech = useCallback(async () => {
    if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
      window.speechSynthesis.cancel();
    }

    // Locally cut current remote audio playback immediately.
    for (const [, audioElement] of audioElementsRef.current) {
      audioElement.muted = true;
      try {
        audioElement.pause();
      } catch {
        // noop
      }
    }
    if (interruptTimeoutRef.current) {
      clearTimeout(interruptTimeoutRef.current);
    }
    interruptTimeoutRef.current = setTimeout(() => {
      for (const [, audioElement] of audioElementsRef.current) {
        audioElement.muted = !speakerEnabledRef.current;
        if (speakerEnabledRef.current) {
          void audioElement.play().catch(() => undefined);
        }
      }
      interruptTimeoutRef.current = null;
    }, 1200);

    const room = roomRef.current;
    if (!room) {
      addEvent({
        source: 'chat',
        eventType: 'AGENT_SPEECH_INTERRUPTED_LOCAL',
        summary: 'Agent speech interrupted locally',
        payload: { hasRoom: false },
      });
      return;
    }

    const payload = {
      type: 'system_instruction',
      action: 'interrupt',
      reason: 'user_barge_in',
      ts: new Date().toISOString(),
    };

    try {
      await room.localParticipant.publishData(encoder.encode(JSON.stringify(payload)), {
        topic: 'system',
        reliable: true,
      });
      addEvent({
        source: 'chat',
        eventType: 'AGENT_SPEECH_INTERRUPTED',
        summary: 'Sent interrupt instruction to agent',
        payload,
      });
    } catch (error) {
      addEvent({
        source: 'error',
        eventType: 'AGENT_SPEECH_INTERRUPT_FAILED',
        summary: 'Failed to send interrupt instruction to agent',
        payload: { message: error instanceof Error ? error.message : 'Unknown error' },
      });
    }
  }, [addEvent]);

  const requestAgentChat = useCallback(
    async (currentRoomName: string, text: string, source: 'chat' | 'greeting') => {
      addEvent({
        source: 'api',
        eventType: source === 'greeting' ? 'GREETING_AGENT_CHAT_REQUEST_STARTED' : 'AGENT_CHAT_REQUEST_STARTED',
        summary: `${source === 'greeting' ? 'Greeting' : 'Agent chat'} request started`,
        payload: { roomName: currentRoomName, textLength: text.trim().length },
      });

      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), AGENT_CHAT_TIMEOUT_MS);
      try {
        const response = await fetch('/api/starter/agent-chat', {
          method: 'POST',
          headers: {
            'content-type': 'application/json',
            'x-device-id': deviceId,
          },
          body: JSON.stringify({
            roomName: currentRoomName,
            text,
            deviceId,
          }),
          signal: controller.signal,
        });
        const raw = await response.text();
        let parsed: unknown = raw;
        try {
          parsed = raw ? JSON.parse(raw) : null;
        } catch {
          parsed = raw;
        }
        if (!response.ok) {
          addEvent({
            source: 'error',
            eventType:
              source === 'greeting' ? 'GREETING_AGENT_CHAT_REQUEST_FAILED' : 'AGENT_CHAT_REQUEST_FAILED',
            summary: `${source === 'greeting' ? 'Greeting' : 'Agent chat'} request failed (${response.status})`,
            payload: parsed,
          });
          return;
        }
        addEvent({
          source: 'api',
          eventType: source === 'greeting' ? 'GREETING_AGENT_CHAT_REQUEST_OK' : 'AGENT_CHAT_REQUEST_OK',
          summary: `${source === 'greeting' ? 'Greeting' : 'Starter agent chat'} request succeeded`,
          payload: parsed,
        });
      } catch (error) {
        if (error instanceof Error && error.name === 'AbortError') {
          addEvent({
            source: 'error',
            eventType:
              source === 'greeting' ? 'GREETING_AGENT_CHAT_REQUEST_TIMEOUT' : 'AGENT_CHAT_REQUEST_TIMEOUT',
            summary: `${source === 'greeting' ? 'Greeting' : 'Starter agent chat'} request timed out`,
            payload: { timeoutMs: AGENT_CHAT_TIMEOUT_MS },
          });
          return;
        }
        addEvent({
          source: 'error',
          eventType:
            source === 'greeting' ? 'GREETING_AGENT_CHAT_REQUEST_ERROR' : 'AGENT_CHAT_REQUEST_ERROR',
          summary: `${source === 'greeting' ? 'Greeting' : 'Starter agent chat'} request errored`,
          payload: { message: error instanceof Error ? error.message : 'Unknown error' },
        });
      } finally {
        clearTimeout(timeout);
      }
    },
    [addEvent, deviceId]
  );

  const speakText = useCallback(
    (text: string) => {
      if (!settings.ttsEnabled || !speakerEnabledRef.current) return;
      if (typeof window === 'undefined' || !('speechSynthesis' in window)) return;
      const trimmed = text.trim();
      if (!trimmed) return;

      const utterance = new SpeechSynthesisUtterance(trimmed);
      utterance.lang = settings.voiceLanguage || 'tr';
      window.speechSynthesis.speak(utterance);
      addEvent({
        source: 'api',
        eventType: 'BROWSER_TTS_SPOKEN',
        summary: 'Agent response spoken via browser speech synthesis',
        payload: {
          textLength: trimmed.length,
          language: utterance.lang,
        },
      });
    },
    [addEvent, settings.ttsEnabled, settings.voiceLanguage]
  );

  const connect = useCallback(async () => {
    if (!deviceId) return;
    if (connectionState === 'connecting') return;

    cleanupRoom();
    setConnectionState('connecting');
    setError(null);
    setMessages([]);
    setRoomName(null);
    setMicEnabled(true);
    addEvent({
      source: 'client',
      eventType: 'CONNECT_REQUESTED',
      summary: 'Connect requested by user',
      payload: { deviceId, settings },
    });

    try {
      addEvent({
        source: 'api',
        eventType: 'CONNECTION_DETAILS_REQUEST',
        summary: 'Requesting connection details',
        payload: { deviceId },
      });
      const response = await fetch('/api/connection-details', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-device-id': deviceId,
        },
        body: JSON.stringify({
          deviceId,
          room_config: settings.agentName
            ? {
                agents: [{ agent_name: settings.agentName }],
              }
            : undefined,
        }),
      });
      if (!response.ok) {
        const text = await response.text();
        throw new Error(`CONNECTION_DETAILS_FAILED_${response.status}: ${text.slice(0, 250)}`);
      }
      const details = (await response.json()) as ConnectionDetails;

      addEvent({
        source: 'api',
        eventType: 'CONNECTION_DETAILS_SUCCESS',
        summary: 'Received connection details',
        payload: details,
      });

      const room = new Room();
      roomRef.current = room;
      setRoomName(details.roomName);

      room.on(RoomEvent.Connected, () => {
        setConnectionState('connected');
        addEvent({
          source: 'room',
          eventType: 'ROOM_CONNECTED',
          summary: `Connected to ${details.roomName}`,
          payload: {
            roomName: details.roomName,
            serverUrl: details.serverUrl,
          },
        });
      });

      room.on(RoomEvent.Disconnected, (reason) => {
        setConnectionState('disconnected');
        addEvent({
          source: 'room',
          eventType: 'ROOM_DISCONNECTED',
          summary: 'Room disconnected',
          payload: { reason },
        });
      });

      room.on(RoomEvent.Reconnecting, () => {
        setConnectionState('reconnecting');
        addEvent({
          source: 'room',
          eventType: 'ROOM_RECONNECTING',
          summary: 'Room reconnecting',
          payload: {},
        });
      });

      room.on(RoomEvent.Reconnected, () => {
        setConnectionState('connected');
        addEvent({
          source: 'room',
          eventType: 'ROOM_RECONNECTED',
          summary: 'Room reconnected',
          payload: {},
        });
      });

      room.on(RoomEvent.ParticipantConnected, (participant) => {
        addEvent({
          source: 'participant',
          eventType: 'PARTICIPANT_CONNECTED',
          summary: `Participant joined: ${participant.identity}`,
          payload: participant,
        });
      });

      room.on(RoomEvent.ParticipantDisconnected, (participant) => {
        addEvent({
          source: 'participant',
          eventType: 'PARTICIPANT_DISCONNECTED',
          summary: `Participant left: ${participant.identity}`,
          payload: participant,
        });
      });

      room.on(RoomEvent.TrackSubscribed, (track, publication, participant) => {
        if (track.kind !== Track.Kind.Audio) {
          return;
        }
        const key = `${participant.sid}:${publication.trackSid}`;
        const audioElement = track.attach();
        audioElement.autoplay = true;
        audioElement.muted = !speakerEnabledRef.current;
        audioElement.dataset['lkTrackKey'] = key;
        audioElement.style.display = 'none';
        audioRootRef.current?.appendChild(audioElement);
        audioElementsRef.current.set(key, audioElement);
        const configuredAgentName = settings.agentName.trim();
        if (isLikelyAgentParticipant(participant.identity, configuredAgentName)) {
          agentAudioTrackCountRef.current += 1;
          lastAgentAudioTrackTsRef.current = new Date().toISOString();
          addEvent({
            source: 'track',
            eventType: 'AGENT_AUDIO_TRACK_AVAILABLE',
            summary: `Agent audio track available (${agentAudioTrackCountRef.current})`,
            payload: { participant, publication, trackCount: agentAudioTrackCountRef.current },
          });
        }
        addEvent({
          source: 'track',
          eventType: 'TRACK_SUBSCRIBED',
          summary: `Audio track subscribed: ${participant.identity}`,
          payload: { participant, publication },
        });
      });

      room.on(RoomEvent.TrackUnsubscribed, (track, publication, participant) => {
        if (track.kind !== Track.Kind.Audio) {
          return;
        }
        const key = `${participant.sid}:${publication.trackSid}`;
        const audioElement = audioElementsRef.current.get(key);
        if (audioElement) {
          track.detach(audioElement);
          audioElement.remove();
          audioElementsRef.current.delete(key);
        }
        const configuredAgentName = settings.agentName.trim();
        if (isLikelyAgentParticipant(participant.identity, configuredAgentName)) {
          agentAudioTrackCountRef.current = Math.max(0, agentAudioTrackCountRef.current - 1);
          addEvent({
            source: 'track',
            eventType: 'AGENT_AUDIO_TRACK_UNAVAILABLE',
            summary: `Agent audio track unavailable (${agentAudioTrackCountRef.current})`,
            payload: { participant, publication, trackCount: agentAudioTrackCountRef.current },
          });
        }
        addEvent({
          source: 'track',
          eventType: 'TRACK_UNSUBSCRIBED',
          summary: `Audio track unsubscribed: ${participant.identity}`,
          payload: { participant, publication },
        });
      });

      room.on(RoomEvent.DataReceived, (payload, participant, kind, topic) => {
        const raw = decoder.decode(payload);
        let parsed: unknown = raw;
        try {
          parsed = JSON.parse(raw);
        } catch {
          parsed = raw;
        }

        const parsedFrom =
          typeof parsed === 'object' &&
          parsed !== null &&
          typeof (parsed as { from?: unknown }).from === 'string'
            ? ((parsed as { from: string }).from ?? '').toLowerCase()
            : '';
        const parsedType =
          typeof parsed === 'object' &&
          parsed !== null &&
          typeof (parsed as { type?: unknown }).type === 'string'
            ? ((parsed as { type: string }).type ?? '').toLowerCase()
            : '';
        const configuredAgentName = settings.agentName.trim().toLowerCase();

        const fromAgent =
          participant?.identity?.toLowerCase().includes('agent') === true ||
          parsedType === 'agent_message' ||
          parsedFrom === 'agent' ||
          (configuredAgentName.length > 0 && parsedFrom === configuredAgentName) ||
          parsedFrom.includes('agent');

        if (typeof parsed === 'object' && parsed !== null) {
          const maybeText = (parsed as { text?: unknown }).text;
          const maybeTtsEngine = (parsed as { ttsEngine?: unknown }).ttsEngine;
          const maybeTtsProfileId = (parsed as { ttsProfileId?: unknown }).ttsProfileId;
          const maybeTtsProfileName = (parsed as { ttsProfileName?: unknown }).ttsProfileName;
          if (typeof maybeTtsEngine === 'string' && maybeTtsEngine.trim()) {
            setLastAgentTtsEngine(maybeTtsEngine.trim());
            addEvent({
              source: 'api',
              eventType: 'AGENT_TTS_ENGINE_METADATA',
              summary: `Agent reports TTS engine: ${maybeTtsEngine.trim()}`,
              payload: {
                ttsEngine: maybeTtsEngine,
                ttsProfileId: typeof maybeTtsProfileId === 'string' ? maybeTtsProfileId : null,
                ttsProfileName: typeof maybeTtsProfileName === 'string' ? maybeTtsProfileName : null,
              },
            });
          }
          if (typeof maybeText === 'string' && maybeText.trim()) {
            const text = maybeText.trim();
            setMessages((prev) => [
              ...prev,
              {
                id: nextId(),
                from: fromAgent ? 'agent' : 'system',
                text,
                ts: new Date().toISOString(),
              },
            ]);
            if (fromAgent) {
              if (agentAudioTrackCountRef.current > 0) {
                addEvent({
                  source: 'track',
                  eventType: 'BROWSER_TTS_SKIPPED',
                  summary: 'Skipped browser TTS because agent audio track is available',
                  payload: {
                    trackCount: agentAudioTrackCountRef.current,
                    lastAgentAudioTrackTs: lastAgentAudioTrackTsRef.current,
                  },
                });
              } else {
                addEvent({
                  source: 'track',
                  eventType: 'BROWSER_TTS_FALLBACK',
                  summary: 'Browser TTS fallback used because no agent audio track is available',
                  payload: {
                    trackCount: agentAudioTrackCountRef.current,
                    lastAgentAudioTrackTs: lastAgentAudioTrackTsRef.current,
                  },
                });
                speakText(text);
              }
            }
          }
        }

        addEvent({
          source: 'chat',
          eventType: 'DATA_RECEIVED',
          summary: `Data received${topic ? ` (${topic})` : ''}`,
          payload: { participant, kind, topic, parsed },
        });
      });

      await room.connect(details.serverUrl, details.participantToken);
      await room.localParticipant.setMicrophoneEnabled(true);
      setMicEnabled(true);
      if (
        typeof (room as unknown as { startAudio?: () => Promise<void> }).startAudio === 'function'
      ) {
        await (room as unknown as { startAudio: () => Promise<void> }).startAudio();
      }

      addEvent({
        source: 'client',
        eventType: 'AUDIO_AUTO_STARTED',
        summary: 'Microphone enabled and audio started',
        payload: { micEnabled: true },
      });

      if (settings.greetingEnabled) {
        const now = new Date();
        const greetingContext = resolveGreetingContext(now);
        const greetingInstruction =
          settings.greetingInstruction?.trim() ||
          'Send a short welcome greeting appropriate to weekday and time of day. Do not use fixed canned text.';

        const greetingPayload = {
          type: 'system_instruction',
          action: 'send_greeting',
          instruction: greetingInstruction,
          context: {
            ...greetingContext,
            language: settings.voiceLanguage || 'tr',
            timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
          },
          ts: now.toISOString(),
        };

        try {
          await room.localParticipant.publishData(encoder.encode(JSON.stringify(greetingPayload)), {
            topic: 'system',
            reliable: true,
          });
          addEvent({
            source: 'chat',
            eventType: 'GREETING_REQUEST_SENT',
            summary: 'Greeting instruction sent to agent',
            payload: greetingPayload,
          });

          await requestAgentChat(
            details.roomName,
            `${greetingInstruction}

Context:
- Weekday: ${greetingContext.weekday}
- Hour: ${greetingContext.hour}
- Time of day: ${greetingContext.timeOfDay}
- Language: ${settings.voiceLanguage || 'tr'}

Return only the greeting message text.`,
            'greeting'
          );
        } catch (error) {
          addEvent({
            source: 'error',
            eventType: 'GREETING_REQUEST_FAILED',
            summary: 'Failed to send greeting instruction',
            payload: {
              message: error instanceof Error ? error.message : 'Unknown error',
              greetingPayload,
            },
          });
        }
      }
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : 'Unknown connection error';
      setConnectionState('failed');
      setError(message);
      addEvent({
        source: 'error',
        eventType: 'CONNECT_FAILED',
        summary: message,
        payload: { message },
      });
      cleanupRoom();
    }
  }, [addEvent, cleanupRoom, connectionState, deviceId, requestAgentChat, settings, speakText]);

  const disconnect = useCallback(() => {
    cleanupRoom();
    setConnectionState('disconnected');
    addEvent({
      source: 'client',
      eventType: 'DISCONNECT_REQUESTED',
      summary: 'Disconnect requested by user',
      payload: {},
    });
  }, [addEvent, cleanupRoom]);

  const toggleMic = useCallback(async () => {
    const room = roomRef.current;
    if (!room) return;
    const nextEnabled = !micEnabled;
    await room.localParticipant.setMicrophoneEnabled(nextEnabled);
    setMicEnabled(nextEnabled);
    addEvent({
      source: 'client',
      eventType: 'MIC_TOGGLED',
      summary: `Microphone ${nextEnabled ? 'enabled' : 'disabled'}`,
      payload: { enabled: nextEnabled },
    });
  }, [addEvent, micEnabled]);

  const toggleSpeaker = useCallback(() => {
    const nextEnabled = !speakerEnabledRef.current;
    setSpeakerEnabled(nextEnabled);
    for (const [, audioElement] of audioElementsRef.current) {
      audioElement.muted = !nextEnabled;
    }
    if (!nextEnabled && typeof window !== 'undefined' && 'speechSynthesis' in window) {
      window.speechSynthesis.cancel();
    }
    addEvent({
      source: 'client',
      eventType: 'SPEAKER_TOGGLED',
      summary: `Speaker ${nextEnabled ? 'enabled' : 'disabled'}`,
      payload: { enabled: nextEnabled },
    });
  }, [addEvent]);

  const sendChat = useCallback(
    async (text: string) => {
      const room = roomRef.current;
      const currentRoomName = roomName;
      if (!room || !currentRoomName || !text.trim()) return;
      const payload = {
        type: 'chat',
        from: 'user',
        text: text.trim(),
        ts: new Date().toISOString(),
      };
      await room.localParticipant.publishData(encoder.encode(JSON.stringify(payload)), {
        topic: 'chat',
        reliable: true,
      });
      setMessages((prev) => [
        ...prev,
        {
          id: nextId(),
          from: 'user',
          text: payload.text,
          ts: payload.ts,
        },
      ]);
      addEvent({
        source: 'chat',
        eventType: 'DATA_SENT',
        summary: 'Chat message sent',
        payload,
      });

      addEvent({
        source: 'chat',
        eventType: 'AGENT_NATIVE_RESPONSE_PENDING',
        summary: 'Awaiting assistant-native response over LiveKit',
        payload: { roomName: currentRoomName },
      });
      await requestAgentChat(currentRoomName, payload.text, 'chat');
    },
    [addEvent, requestAgentChat, roomName]
  );

  useEffect(() => {
    return () => {
      cleanupRoom();
    };
  }, [cleanupRoom]);

  const selectedEvent = useMemo(
    () => events.find((item) => item.id === selectedEventId) ?? null,
    [events, selectedEventId]
  );

  return {
    connectionState,
    roomName,
    error,
    micEnabled,
    speakerEnabled,
    lastAgentTtsEngine,
    messages,
    events,
    selectedEvent,
    selectedEventId,
    audioRootRef,
    setSelectedEventId,
    connect,
    disconnect,
    toggleMic,
    toggleSpeaker,
    interruptAgentSpeech,
    clearLogs,
    sendChat,
  };
}
