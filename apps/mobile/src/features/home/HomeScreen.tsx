import type { NavigationContainerRef } from '@react-navigation/native';
import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert, Button, ScrollView, StyleSheet, Text, View } from 'react-native';
import { ConnectionState } from 'livekit-client';
import { dispatchAgentAction } from '../actions/dispatcher';
import { AgentActionEnvelopeSchema } from '../actions/schema';
import { useVoiceSession } from '../voice/useVoiceSession';
import { startLiveKitSession } from '../../services/api/livekit';
import { clearStoredAuth } from '../../services/storage/authStorage';
import { trackEvent } from '../../services/telemetry/client';
import { useSessionStore } from '../../state/sessionStore';
import type { RootStackParamList } from '../../types/navigation';

type Props = NativeStackScreenProps<RootStackParamList, 'Home'>;

export function HomeScreen({ navigation }: Props) {
  const auth = useSessionStore((s) => s.auth);
  const livekitSession = useSessionStore((s) => s.livekitSession);
  const setLivekitSession = useSessionStore((s) => s.setLivekitSession);
  const setAuth = useSessionStore((s) => s.setAuth);
  const deviceId = useSessionStore((s) => s.selectedDeviceId);
  const settingsProfileId = useSessionStore((s) => s.settingsProfileId);
  const [notes, setNotes] = useState<string[]>([]);
  const [settingsHint, setSettingsHint] = useState('');
  const [events, setEvents] = useState<string[]>([]);
  const autoStartedRef = useRef<string | null>(null);
  const navigationRef = useRef<NavigationContainerRef<RootStackParamList>>({
    navigate: (screen: any, params?: any) => navigation.navigate(screen, params),
  } as NavigationContainerRef<RootStackParamList>);

  const appendEvent = (line: string) => {
    setEvents((prev) => [`${new Date().toISOString()} ${line}`, ...prev].slice(0, 25));
  };

  const track = async (level: 'info' | 'warn' | 'error', eventType: string, message: string, metadata?: Record<string, unknown>) => {
    await trackEvent(auth?.tokens.accessToken, {
      level,
      eventType,
      message,
      roomName: livekitSession?.roomName,
      metadata,
    });
  };

  const voice = useVoiceSession({
    wsUrl: livekitSession?.wsUrl,
    token: livekitSession?.user.token,
    onAction: (text) => {
      appendEvent(`DataChannel <= ${text}`);
      const parsed = AgentActionEnvelopeSchema.safeParse(JSON.parse(text));
      if (!parsed.success) {
        appendEvent('Rejected action schema');
        void track('warn', 'action_rejected', 'Action schema rejected', {
          error: parsed.error.flatten(),
        });
        return;
      }
      dispatchAgentAction(parsed.data, {
        navigationRef,
        onAppendNote: (textToAppend) => setNotes((prev) => [textToAppend, ...prev]),
        onSettingsHint: (message) => setSettingsHint(message),
      });
      void track('info', 'action_accepted', 'Action accepted', {
        actionName: parsed.data.action.name,
        requestId: parsed.data.requestId,
      });
    },
    onError: (message) => {
      appendEvent(`Voice error: ${message}`);
      void track('error', 'voice_error', message);
    },
    onStateChange: (state) => {
      void track('info', 'voice_state', `State changed to ${state}`, { state });
    },
  });

  const status = useMemo(() => {
    if (!livekitSession) return 'Not connected';
    if (voice.connectionState === ConnectionState.Connected) return 'Connected';
    if (voice.connectionState === ConnectionState.Connecting) return 'Connecting';
    return 'Disconnected';
  }, [livekitSession, voice.connectionState]);

  const startVoice = useCallback(async () => {
    if (!auth?.tokens.accessToken) {
      Alert.alert('Not authenticated', 'Please sign in first.');
      return;
    }
    try {
      const session = await startLiveKitSession(auth.tokens.accessToken, {
        participantName: auth.user.email,
        autoDispatchAgent: true,
        channel: 'mobile',
        deviceId,
        settingsProfileId,
      });
      setLivekitSession(session);
      appendEvent(`Session started room=${session.roomName}`);
      await track('info', 'session_started', 'LiveKit voice session started', {
        roomName: session.roomName,
      });
    } catch (error) {
      Alert.alert('Session start failed', error instanceof Error ? error.message : 'Unknown error');
      await track('error', 'session_start_failed', 'Failed to start LiveKit session');
    }
  }, [auth?.tokens.accessToken, auth?.user.email, deviceId, settingsProfileId, setLivekitSession]);

  const stopVoice = useCallback(async () => {
    await voice.disconnect();
    setLivekitSession(null);
    appendEvent('Session disconnected');
    await track('info', 'session_stopped', 'LiveKit voice session disconnected');
  }, [setLivekitSession, voice]);

  useEffect(() => {
    const authSessionKey = auth?.tokens.accessToken ?? null;
    if (!authSessionKey) {
      autoStartedRef.current = null;
      return;
    }

    if (livekitSession) {
      return;
    }

    if (autoStartedRef.current === authSessionKey) {
      return;
    }

    autoStartedRef.current = authSessionKey;
    void startVoice();
  }, [auth?.tokens.accessToken, livekitSession, startVoice]);

  const logout = async () => {
    await stopVoice();
    await clearStoredAuth();
    setAuth(null);
  };

  return (
    <ScrollView style={styles.root} contentContainerStyle={styles.content}>
      <Text style={styles.title}>Voice Assistant</Text>
      <Text style={styles.label}>Connection: {status}</Text>
      <View style={styles.buttons}>
        <Button title="Start Voice" onPress={startVoice} />
        <Button title="Stop Voice" onPress={stopVoice} />
      </View>
      <View style={styles.buttons}>
        <Button title="Settings" onPress={() => navigation.navigate('Settings')} />
        <Button title="Profile" onPress={() => navigation.navigate('Profile')} />
        <Button title="Notes" onPress={() => navigation.navigate('Notes')} />
      </View>
      <View style={styles.buttons}>
        <Button title="Logout" onPress={logout} />
      </View>

      <Text style={styles.sectionTitle}>Settings Hint</Text>
      <Text>{settingsHint || 'No hints yet'}</Text>

      <Text style={styles.sectionTitle}>Captured Notes</Text>
      {notes.length === 0 ? <Text>No notes yet</Text> : notes.map((n, idx) => <Text key={`${n}-${idx}`}>- {n}</Text>)}

      <Text style={styles.sectionTitle}>Event Log</Text>
      {events.length === 0 ? <Text>Empty</Text> : events.map((e, idx) => <Text key={`${e}-${idx}`}>{e}</Text>)}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#fff' },
  content: { padding: 16, gap: 10 },
  title: { fontSize: 24, fontWeight: '700' },
  label: { fontSize: 16 },
  sectionTitle: { marginTop: 16, fontSize: 18, fontWeight: '600' },
  buttons: { flexDirection: 'row', gap: 10 },
});
