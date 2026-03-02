import React, { useEffect } from 'react';
import { NavigationContainer, createNavigationContainerRef } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { ActivityIndicator, View } from 'react-native';
import { LoginScreen } from '../features/auth/LoginScreen';
import { HomeScreen } from '../features/home/HomeScreen';
import { SettingsScreen } from '../features/settings/SettingsScreen';
import { ProfileScreen } from '../features/profile/ProfileScreen';
import { NotesScreen } from '../features/notes/NotesScreen';
import { loadStoredAuth } from '../services/storage/authStorage';
import { useSessionStore } from '../state/sessionStore';
import type { RootStackParamList } from '../types/navigation';

const Stack = createNativeStackNavigator<RootStackParamList>();
export const navigationRef = createNavigationContainerRef<RootStackParamList>();

export function AppRoot() {
  const auth = useSessionStore((s) => s.auth);
  const hydrated = useSessionStore((s) => s.hydrated);
  const setAuth = useSessionStore((s) => s.setAuth);
  const setHydrated = useSessionStore((s) => s.setHydrated);

  useEffect(() => {
    const hydrate = async () => {
      const stored = await loadStoredAuth();
      if (stored) {
        setAuth(stored);
      }
      setHydrated(true);
    };

    void hydrate();
  }, [setAuth, setHydrated]);

  if (!hydrated) {
    return (
      <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center' }}>
        <ActivityIndicator size="large" />
      </View>
    );
  }

  return (
    <NavigationContainer ref={navigationRef}>
      <Stack.Navigator>
        {!auth ? (
          <Stack.Screen name="Login" component={LoginScreen} options={{ headerShown: false }} />
        ) : (
          <>
            <Stack.Screen name="Home" component={HomeScreen} options={{ title: 'Voice Home' }} />
            <Stack.Screen name="Settings" component={SettingsScreen} options={{ title: 'Settings' }} />
            <Stack.Screen name="Profile" component={ProfileScreen} options={{ title: 'Profile' }} />
            <Stack.Screen name="Notes" component={NotesScreen} options={{ title: 'Notes' }} />
          </>
        )}
      </Stack.Navigator>
    </NavigationContainer>
  );
}
