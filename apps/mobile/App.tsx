import React, { useState } from 'react';
import HomeScreen, { SessionData } from './src/screens/HomeScreen';
import VoiceSessionScreen from './src/screens/VoiceSessionScreen';
import SettingsScreen from './src/screens/SettingsScreen';

type Screen = 'home' | 'session' | 'settings';

export default function App() {
  const [screen, setScreen] = useState<Screen>('home');
  const [session, setSession] = useState<SessionData | null>(null);

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
      onSessionStart={(s) => { setSession(s); setScreen('session'); }}
      onOpenSettings={() => setScreen('settings')}
    />
  );
}
