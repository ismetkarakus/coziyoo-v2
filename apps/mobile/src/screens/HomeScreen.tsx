import React, { useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  StatusBar,
  SafeAreaView,
  Animated,
} from 'react-native';
import { loadSettings } from '../utils/settings';
import { refreshAuthSession, type AuthSession } from '../utils/auth';
import VoiceSessionScreen from './VoiceSessionScreen';
import { theme } from '../theme/colors';

export type SessionData = {
  wsUrl: string;
  token: string;
  roomName: string;
  userIdentity: string;
};

type Props = {
  auth: AuthSession;
  onOpenSettings: () => void;
  onLogout: () => void;
  onAuthRefresh?: (session: AuthSession) => void;
};

type ApiErrorPayload = {
  error?: {
    code?: string;
    message?: string;
  };
};

type VoiceState = 'idle' | 'starting' | 'active' | 'error';
type TabKey = 'home' | 'explore' | 'messages' | 'profile';

export default function HomeScreen({ auth, onOpenSettings, onLogout, onAuthRefresh }: Props) {
  const [currentAuth, setCurrentAuth] = useState<AuthSession>(auth);
  const [apiUrl, setApiUrl] = useState('http://localhost:3000');
  const [activeTab, setActiveTab] = useState<TabKey>('home');
  const [voiceState, setVoiceState] = useState<VoiceState>('idle');
  const [voiceError, setVoiceError] = useState<string | null>(null);
  const [voiceSession, setVoiceSession] = useState<SessionData | null>(null);

  const centerScale = useRef(new Animated.Value(0.85)).current;
  const centerLift = useRef(new Animated.Value(-14)).current;

  useEffect(() => {
    setCurrentAuth(auth);
  }, [auth]);

  useEffect(() => {
    loadSettings().then((s) => setApiUrl(s.apiUrl));
  }, []);

  useEffect(() => {
    Animated.sequence([
      Animated.spring(centerScale, {
        toValue: 1.08,
        friction: 6,
        tension: 120,
        useNativeDriver: true,
      }),
      Animated.spring(centerScale, {
        toValue: 1,
        friction: 7,
        tension: 110,
        useNativeDriver: true,
      }),
    ]).start();
  }, [centerScale]);

  useEffect(() => {
    const targetY = voiceState === 'active' ? -34 : voiceState === 'starting' ? -24 : -14;
    Animated.spring(centerLift, {
      toValue: targetY,
      friction: 7,
      tension: 100,
      useNativeDriver: true,
    }).start();
  }, [voiceState, centerLift]);

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

  async function startSessionWithToken(accessToken: string): Promise<void> {
    const response = await fetch(`${apiUrl}/v1/livekit/session/start`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({
        autoDispatchAgent: true,
        channel: 'mobile',
      }),
    });

    const json = await response.json();

    if (response.status === 401) {
      const refreshed = await refreshAuthSession(apiUrl, currentAuth);
      if (refreshed) {
        setCurrentAuth(refreshed);
        onAuthRefresh?.(refreshed);
        return startSessionWithToken(refreshed.accessToken);
      }
      onLogout();
      return;
    }

    if (!response.ok || (json as ApiErrorPayload).error) {
      throw new Error(resolveStartSessionError(json as ApiErrorPayload, response.status));
    }

    const { data } = json as {
      data: {
        roomName: string;
        wsUrl: string;
        user: { participantIdentity: string; token: string };
      };
    };

    setVoiceSession({
      wsUrl: data.wsUrl,
      token: data.user.token,
      roomName: data.roomName,
      userIdentity: data.user.participantIdentity,
    });
    setVoiceState('active');
    setVoiceError(null);
  }

  async function handleStartVoice() {
    if (voiceState === 'starting' || voiceState === 'active') return;
    setVoiceError(null);
    setVoiceState('starting');
    try {
      await startSessionWithToken(currentAuth.accessToken);
    } catch (err) {
      setVoiceSession(null);
      setVoiceState('error');
      setVoiceError(err instanceof Error ? err.message : 'Failed to start session');
    }
  }

  function handleVoiceEnd() {
    setVoiceSession(null);
    setVoiceState('idle');
    setVoiceError(null);
  }

  function renderContent() {
    if (voiceSession && voiceState === 'active') {
      return (
        <View style={styles.voiceSessionWrap}>
          <VoiceSessionScreen session={voiceSession} onEnd={handleVoiceEnd} />
        </View>
      );
    }

    if (activeTab === 'profile') {
      return (
        <View style={styles.panel}>
          <Text style={styles.panelTitle}>Profile</Text>
          <Text style={styles.panelText}>{currentAuth.email}</Text>
          <View style={styles.profileActions}>
            <TouchableOpacity style={styles.secondaryBtn} onPress={onOpenSettings}>
              <Text style={styles.secondaryBtnText}>Settings</Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.dangerBtn} onPress={onLogout}>
              <Text style={styles.dangerBtnText}>Sign out</Text>
            </TouchableOpacity>
          </View>
        </View>
      );
    }

    return (
      <View style={styles.emptyState}>
        <Text style={styles.emptyTitle}>Home</Text>
        <Text style={styles.emptySubtitle}>Your new mobile shell is ready.</Text>
        {voiceError ? <Text style={styles.errorText}>{voiceError}</Text> : null}
      </View>
    );
  }

  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar barStyle="dark-content" backgroundColor={theme.background} />
      <View style={styles.container}>
        <View style={styles.content}>{renderContent()}</View>

        <View style={styles.navBar}>
          <TouchableOpacity style={styles.navItem} onPress={() => setActiveTab('home')}>
            <Text style={[styles.navIcon, activeTab === 'home' && styles.navIconActive]}>H</Text>
            <Text style={[styles.navLabel, activeTab === 'home' && styles.navLabelActive]}>Home</Text>
          </TouchableOpacity>

          <TouchableOpacity style={styles.navItem} onPress={() => setActiveTab('explore')}>
            <Text style={[styles.navIcon, activeTab === 'explore' && styles.navIconActive]}>E</Text>
            <Text style={[styles.navLabel, activeTab === 'explore' && styles.navLabelActive]}>Explore</Text>
          </TouchableOpacity>

          <View style={styles.centerSlot}>
            <Animated.View
              style={[
                styles.centerButtonWrap,
                { transform: [{ translateY: centerLift }, { scale: centerScale }] },
              ]}
            >
              <TouchableOpacity
                style={[
                  styles.centerButton,
                  voiceState === 'active' && styles.centerButtonActive,
                  voiceState === 'error' && styles.centerButtonError,
                ]}
                onPress={handleStartVoice}
                activeOpacity={0.85}
              >
                {voiceState === 'starting' ? (
                  <ActivityIndicator color={theme.onPrimary} size="small" />
                ) : (
                  <Text style={styles.centerButtonText}>C</Text>
                )}
              </TouchableOpacity>
            </Animated.View>
          </View>

          <TouchableOpacity style={styles.navItem} onPress={() => setActiveTab('messages')}>
            <Text style={[styles.navIcon, activeTab === 'messages' && styles.navIconActive]}>M</Text>
            <Text style={[styles.navLabel, activeTab === 'messages' && styles.navLabelActive]}>Messages</Text>
          </TouchableOpacity>

          <TouchableOpacity style={styles.navItem} onPress={() => setActiveTab('profile')}>
            <Text style={[styles.navIcon, activeTab === 'profile' && styles.navIconActive]}>P</Text>
            <Text style={[styles.navLabel, activeTab === 'profile' && styles.navLabelActive]}>Profile</Text>
          </TouchableOpacity>
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: theme.background,
  },
  container: {
    flex: 1,
    backgroundColor: theme.background,
  },
  content: {
    flex: 1,
    paddingHorizontal: 16,
    paddingTop: 12,
  },
  emptyState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
  },
  emptyTitle: {
    color: theme.text,
    fontSize: 34,
    fontWeight: '700',
  },
  emptySubtitle: {
    color: theme.textSecondary,
    fontSize: 14,
  },
  errorText: {
    color: theme.error,
    fontSize: 13,
    textAlign: 'center',
    maxWidth: 280,
    marginTop: 8,
  },
  panel: {
    marginTop: 24,
    backgroundColor: theme.card,
    borderWidth: 1,
    borderColor: theme.border,
    borderRadius: 14,
    padding: 16,
    gap: 10,
  },
  panelTitle: {
    color: theme.text,
    fontSize: 20,
    fontWeight: '700',
  },
  panelText: {
    color: theme.textSecondary,
    fontSize: 14,
  },
  profileActions: {
    marginTop: 10,
    flexDirection: 'row',
    gap: 10,
  },
  secondaryBtn: {
    backgroundColor: theme.surface,
    borderWidth: 1,
    borderColor: theme.border,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  secondaryBtnText: {
    color: theme.text,
    fontSize: 14,
    fontWeight: '600',
  },
  dangerBtn: {
    backgroundColor: theme.error,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  dangerBtnText: {
    color: theme.onPrimary,
    fontSize: 14,
    fontWeight: '600',
  },
  voiceSessionWrap: {
    flex: 1,
    borderRadius: 16,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: theme.border,
    backgroundColor: '#0a0a0a',
  },
  navBar: {
    height: 88,
    borderTopWidth: 1,
    borderTopColor: theme.border,
    backgroundColor: theme.card,
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-between',
    paddingHorizontal: 8,
    paddingTop: 8,
    paddingBottom: 8,
  },
  navItem: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
  },
  navIcon: {
    color: theme.tabInactive,
    fontSize: 16,
    fontWeight: '700',
  },
  navIconActive: {
    color: theme.tabActive,
  },
  navLabel: {
    color: theme.tabInactive,
    fontSize: 11,
    fontWeight: '500',
  },
  navLabelActive: {
    color: theme.tabActive,
  },
  centerSlot: {
    width: 76,
    alignItems: 'center',
  },
  centerButtonWrap: {
    alignItems: 'center',
    justifyContent: 'center',
  },
  centerButton: {
    width: 60,
    height: 60,
    borderRadius: 30,
    backgroundColor: theme.primary,
    borderWidth: 2,
    borderColor: theme.card,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: theme.shadow,
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.18,
    shadowRadius: 8,
    elevation: 8,
  },
  centerButtonActive: {
    backgroundColor: '#4A9B7F',
  },
  centerButtonError: {
    backgroundColor: theme.error,
  },
  centerButtonText: {
    color: theme.onPrimary,
    fontSize: 24,
    fontWeight: '700',
  },
});
