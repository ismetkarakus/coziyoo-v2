import React from 'react';
import { NavigationContainer, createNavigationContainerRef } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import { LoginScreen } from '../features/auth/LoginScreen';
import { HomeScreen } from '../features/home/HomeScreen';
import { SettingsScreen } from '../features/settings/SettingsScreen';
import { ProfileScreen } from '../features/profile/ProfileScreen';
import { NotesScreen } from '../features/notes/NotesScreen';
import { useSessionStore } from '../state/sessionStore';

const Stack = createNativeStackNavigator();
export const navigationRef = createNavigationContainerRef();

export function AppRoot() {
  const auth = useSessionStore((s) => s.auth);

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
