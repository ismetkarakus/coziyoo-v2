import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  StatusBar,
  SafeAreaView,
} from 'react-native';
import { loadSettings } from '../utils/settings';
import { refreshAuthSession, type AuthSession } from '../utils/auth';

export type SessionData = {
  wsUrl: string;
  token: string;
  roomName: string;
  userIdentity: string;
};

type Props = {
  auth: AuthSession;
  onSessionStart: (session: SessionData) => void;
  onOpenSettings: () => void;
  onLogout: () => void;
};

type ApiErrorPayload = {
  error?: {
    code?: string;
    message?: string;
  };
};

export default function HomeScreen({ auth, onSessionStart, onOpenSettings, onLogout }: Props) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [apiUrl, setApiUrl] = useState('http://localhost:3000');

  useEffect(() => {
    loadSettings().then((s) => setApiUrl(s.apiUrl));
  }, []);

  function resolveStartSessionError(payload: ApiErrorPayload, status: number): string {
    const code = payload?.error?.code;
    if (code === 'AGENT_UNAVAILABLE') {
      return 'Voice agent unavailable right now. Please try again in a moment.';
    }
    if (code === 'N8N_UNAVAILABLE') {
      return 'AI workflow server is unreachable. Please check the n8n server and try again.';
    }
    if (code === 'N8N_WORKFLOW_UNAVAILABLE') {
      return 'AI workflow is unavailable or inactive. Please check n8n and try again.';
    }
    if (code === 'STT_UNAVAILABLE') {
      return 'Speech recognition unavailable. Please check the STT server and try again.';
    }
    if (code === 'TTS_UNAVAILABLE') {
      return 'Voice synthesis unavailable. Please check the TTS server and try again.';
    }
    if (status === 401) {
      return 'Session expired. Please log in again.';
    }
    return payload?.error?.message ?? `Server error ${status}`;
  }

  async function startSession(accessToken: string): Promise<void> {
    const response = await fetch(`${apiUrl}/v1/livekit/session/start`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${accessToken}`,
      },
      body: JSON.stringify({
        autoDispatchAgent: true,
        channel: 'mobile',
      }),
    });
    const json = await response.json();

    if (response.status === 401) {
      // Try to refresh once
      const refreshed = await refreshAuthSession(apiUrl, auth);
      if (refreshed) {
        return startSession(refreshed.accessToken);
      }
      onLogout();
      return;
    }

    if (!response.ok || (json as ApiErrorPayload).error) {
      throw new Error(resolveStartSessionError(json as ApiErrorPayload, response.status));
    }

    const { data } = json as { data: { roomName: string; wsUrl: string; user: { participantIdentity: string; token: string } } };
    onSessionStart({
      wsUrl: data.wsUrl,
      token: data.user.token,
      roomName: data.roomName,
      userIdentity: data.user.participantIdentity,
    });
  }

  async function handleStart() {
    setError(null);
    setLoading(true);
    try {
      await startSession(auth.accessToken);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start session');
    } finally {
      setLoading(false);
    }
  }

  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar barStyle="light-content" backgroundColor="#0a0a0a" />
      <View style={styles.container}>
        <View style={styles.topRow}>
          <TouchableOpacity style={styles.topBtn} onPress={onOpenSettings}>
            <Text style={styles.topBtnText}>Settings</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.topBtn} onPress={onLogout}>
            <Text style={[styles.topBtnText, styles.logoutText]}>Sign out</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.center}>
          <View style={styles.logoCircle}>
            <Text style={styles.logoText}>C</Text>
          </View>
          <Text style={styles.title}>Coziyoo</Text>
          <Text style={styles.subtitle}>VOICE AGENT</Text>
          <Text style={styles.userEmail}>{auth.email}</Text>
        </View>

        <View style={styles.bottom}>
          {!!error && <Text style={styles.error}>{error}</Text>}
          <TouchableOpacity
            style={[styles.button, !!error && styles.buttonError, loading && styles.buttonDisabled]}
            onPress={handleStart}
            disabled={loading}
          >
            {loading
              ? <ActivityIndicator color="#fff" />
              : <Text style={styles.buttonText}>{error ? 'Try Again' : 'Start Voice Session'}</Text>
            }
          </TouchableOpacity>
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: '#0a0a0a',
  },
  container: {
    flex: 1,
    paddingHorizontal: 32,
  },
  topRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingTop: 16,
  },
  topBtn: {
    padding: 8,
  },
  topBtnText: {
    fontSize: 13,
    color: '#888',
    fontWeight: '500',
  },
  logoutText: {
    color: '#c0392b',
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  logoCircle: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: '#6C63FF',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
  },
  logoText: {
    color: '#fff',
    fontSize: 36,
    fontWeight: '700',
  },
  title: {
    color: '#fff',
    fontSize: 32,
    fontWeight: '700',
  },
  subtitle: {
    color: '#888',
    fontSize: 12,
    letterSpacing: 2,
  },
  userEmail: {
    color: '#555',
    fontSize: 12,
    marginTop: 4,
  },
  bottom: {
    paddingBottom: 48,
    gap: 12,
  },
  error: {
    color: '#ff6b6b',
    fontSize: 13,
    textAlign: 'center',
  },
  button: {
    backgroundColor: '#6C63FF',
    borderRadius: 12,
    paddingVertical: 16,
    alignItems: 'center',
  },
  buttonError: {
    backgroundColor: '#c0392b',
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  buttonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
});
