import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  StatusBar,
  SafeAreaView,
} from 'react-native';
import { loadSettings, DEVICE_PROFILE } from '../utils/settings';

export type SessionData = {
  wsUrl: string;
  token: string;
  roomName: string;
  userIdentity: string;
};

type Props = {
  onSessionStart: (session: SessionData) => void;
  onOpenSettings: () => void;
};

type ApiErrorPayload = {
  error?: {
    code?: string;
    message?: string;
  };
};

export default function HomeScreen({ onSessionStart, onOpenSettings }: Props) {
  const [username, setUsername] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [apiUrl, setApiUrl] = useState('http://localhost:3000');

  useEffect(() => {
    loadSettings().then((s) => {
      setApiUrl(s.apiUrl);
    });
  }, []);

  function resolveStartSessionError(payload: ApiErrorPayload, status: number): string {
    const code = payload?.error?.code;
    if (code === 'AGENT_UNAVAILABLE') {
      return 'Voice agent unavailable right now. Please try again in a moment.';
    }
    if (code === 'N8N_WORKFLOW_UNAVAILABLE') {
      return 'AI workflow is unavailable right now. Please try again shortly.';
    }
    return payload?.error?.message ?? `Server error ${status}`;
  }

  async function handleStart() {
    const name = username.trim();
    if (name.length < 2) {
      setError('Please enter at least 2 characters.');
      return;
    }
    setError(null);
    setLoading(true);
    try {
      const response = await fetch(`${apiUrl}/v1/livekit/starter/session/start`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ username: name, deviceId: DEVICE_PROFILE }),
      });
      const json = await response.json();
      if (!response.ok || json.error) {
        throw new Error(resolveStartSessionError(json, response.status));
      }
      const { data } = json;
      onSessionStart({
        wsUrl: data.wsUrl,
        token: data.user.token,
        roomName: data.roomName,
        userIdentity: data.user.participantIdentity,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to start session');
    } finally {
      setLoading(false);
    }
  }

  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar barStyle="light-content" backgroundColor="#0a0a0a" />
      <KeyboardAvoidingView
        style={styles.container}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <TouchableOpacity style={styles.settingsBtn} onPress={onOpenSettings}>
          <Text style={styles.settingsIcon}>Settings</Text>
        </TouchableOpacity>

        <View style={styles.header}>
          <View style={styles.logoCircle}>
            <Text style={styles.logoText}>C</Text>
          </View>
          <Text style={styles.title}>Coziyoo</Text>
          <Text style={styles.subtitle}>VOICE AGENT</Text>
        </View>

        <View style={styles.form}>
          <Text style={styles.label}>Your name</Text>
          <TextInput
            style={styles.input}
            value={username}
            onChangeText={setUsername}
            placeholder="Enter your name..."
            placeholderTextColor="#555"
            autoCapitalize="words"
            autoCorrect={false}
            returnKeyType="go"
            onSubmitEditing={handleStart}
            editable={!loading}
          />
          {!!error && <Text style={styles.error}>{error}</Text>}
          <TouchableOpacity
            style={[styles.button, loading && styles.buttonDisabled]}
            onPress={handleStart}
            disabled={loading}
          >
            {loading
              ? <ActivityIndicator color="#fff" />
              : <Text style={styles.buttonText}>Start Voice Session</Text>
            }
          </TouchableOpacity>
        </View>
      </KeyboardAvoidingView>
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
    justifyContent: 'center',
    paddingHorizontal: 32,
  },
  settingsBtn: {
    position: 'absolute',
    top: 16,
    right: 20,
    padding: 8,
  },
  settingsIcon: {
    fontSize: 13,
    color: '#888',
    fontWeight: '500',
  },
  header: {
    alignItems: 'center',
    marginBottom: 48,
  },
  logoCircle: {
    width: 80,
    height: 80,
    borderRadius: 40,
    backgroundColor: '#6C63FF',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 16,
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
    marginTop: 4,
    letterSpacing: 2,
  },
  form: {
    gap: 12,
  },
  label: {
    color: '#aaa',
    fontSize: 13,
  },
  input: {
    backgroundColor: '#1a1a1a',
    borderWidth: 1,
    borderColor: '#2a2a2a',
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 14,
    color: '#fff',
    fontSize: 16,
  },
  error: {
    color: '#ff6b6b',
    fontSize: 13,
  },
  button: {
    backgroundColor: '#6C63FF',
    borderRadius: 12,
    paddingVertical: 16,
    alignItems: 'center',
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
