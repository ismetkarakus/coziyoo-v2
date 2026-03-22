import React, { useState, useEffect } from 'react';
import { View, ActivityIndicator, StyleSheet } from 'react-native';
import LoginScreen from './src/screens/LoginScreen';
import HomeScreen from './src/screens/HomeScreen';
import SettingsScreen from './src/screens/SettingsScreen';
import ProfileEditScreen from './src/screens/ProfileEditScreen';
import AddressScreen from './src/screens/AddressScreen';
import { loadAuthSession, clearAuthSession, type AuthSession } from './src/utils/auth';
import { theme } from './src/theme/colors';

type Screen = 'loading' | 'login' | 'home' | 'settings' | 'profileEdit' | 'addresses';
type TabKey = 'home' | 'messages' | 'cart' | 'notifications' | 'profile';

export default function App() {
  const [screen, setScreen] = useState<Screen>('loading');
  const [homeTab, setHomeTab] = useState<TabKey>('home');
  const [auth, setAuth] = useState<AuthSession | null>(null);

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
    setAuth(null);
    await clearAuthSession();
  }

  if (screen === 'loading') {
    return (
      <View style={styles.loading}>
        <ActivityIndicator color={theme.primary} size="large" />
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
    return (
      <SettingsScreen
        auth={auth}
        onBack={() => { setHomeTab('profile'); setScreen('home'); }}
        onAuthRefresh={setAuth}
        onOpenProfileEdit={() => setScreen('profileEdit')}
      />
    );
  }

  if (screen === 'profileEdit') {
    return (
      <ProfileEditScreen
        auth={auth}
        onBack={() => { setHomeTab('profile'); setScreen('home'); }}
        onAuthRefresh={setAuth}
      />
    );
  }

  if (screen === 'addresses') {
    return (
      <AddressScreen
        auth={auth}
        onBack={() => { setHomeTab('profile'); setScreen('home'); }}
        onAuthRefresh={setAuth}
      />
    );
  }

  return (
    <HomeScreen
      auth={auth}
      initialTab={homeTab}
      onOpenSettings={() => setScreen('settings')}
      onOpenProfileEdit={() => setScreen('profileEdit')}
      onOpenAddresses={() => setScreen('addresses')}
      onLogout={handleLogout}
      onAuthRefresh={setAuth}
    />
  );
}

const styles = StyleSheet.create({
  loading: {
    flex: 1,
    backgroundColor: theme.background,
    alignItems: 'center',
    justifyContent: 'center',
  },
});
