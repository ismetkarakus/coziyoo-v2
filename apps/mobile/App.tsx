import { registerGlobals } from '@livekit/react-native';
import { StatusBar } from 'expo-status-bar';
import React from 'react';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { AppRoot } from './src/app/AppRoot';

registerGlobals();

export default function App() {
  return (
    <SafeAreaProvider>
      <AppRoot />
      <StatusBar style="dark" />
    </SafeAreaProvider>
  );
}
