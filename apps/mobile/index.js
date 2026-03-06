// 1. Polyfill TextDecoder/TextEncoder for Hermes before anything else
import 'fast-text-encoding';

// 2. Register LiveKit WebRTC globals
import { registerGlobals } from '@livekit/react-native';
registerGlobals();

// 3. Register the root component
import { registerRootComponent } from 'expo';
import App from './App';
registerRootComponent(App);
