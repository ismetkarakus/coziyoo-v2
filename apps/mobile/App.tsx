import React, { useState, useEffect } from 'react';
import { View, ActivityIndicator, StyleSheet } from 'react-native';
import LoginScreen from './src/screens/LoginScreen';
import HomeScreen, { SessionData } from './src/screens/HomeScreen';
import VoiceSessionScreen from './src/screens/VoiceSessionScreen';
import SettingsScreen from './src/screens/SettingsScreen';
import { loadAuthSession, clearAuthSession, type AuthSession } from './src/utils/auth';

type Screen = 'loading' | 'login' | 'home' | 'session' | 'settings';

export default function App() {
  const [screen, setScreen] = useState<Screen>('loading');
  const [auth, setAuth] = useState<AuthSession | null>(null);
  const [session, setSession] = useState<SessionData | null>(null);

  useEffect(() => {
    loadAuthSession().then((stored) => {
      if (stored) {
        setAuth(stored);
        setScreen('home');
      } else {
        setScreen('login');
      }
    });
  }, []);

  function handleLogin(session: AuthSession) {
    setAuth(session);
    setScreen('home');
  }

  async function handleLogout() {
    setScreen('login');
    setSession(null);
    setAuth(null);
    await clearAuthSession();
  }

  if (screen === 'loading') {
    return (
      <View style={styles.loading}>
        <ActivityIndicator color="#6C63FF" size="large" />
      </View>
    );
  }

  if (screen === 'login') {
    return <LoginScreen onLogin={handleLogin} />;
  }

  if (!auth) {
    return <LoginScreen onLogin={handleLogin} />;
  }

  if (screen === 'settings') {
    return <SettingsScreen onBack={() => setScreen('home')} />;
  }

  if (screen === 'session' && session) {
    return (
      <VoiceSessionScreen
        session={session}
        onEnd={() => { setSession(null); setScreen('home'); }}
      />
    );
  }

  return (
    <HomeScreen
      auth={auth}
      onSessionStart={(s) => { setSession(s); setScreen('session'); }}
      onOpenSettings={() => setScreen('settings')}
      onLogout={handleLogout}
    />
  );
}

const styles = StyleSheet.create({
  loading: {
    flex: 1,
    backgroundColor: '#0a0a0a',
    alignItems: 'center',
    justifyContent: 'center',
  },
});
