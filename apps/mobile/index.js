if (typeof global.crypto !== 'object') {
  global.crypto = {};
}
if (typeof global.crypto.getRandomValues !== 'function') {
  try {
    const ExpoCrypto = require('expo-crypto');
    if (typeof ExpoCrypto.getRandomValues === 'function') {
      if (typeof global.expo !== 'object') global.expo = {};
      if (typeof global.expo.modules !== 'object') global.expo.modules = {};
      if (typeof global.expo.modules.ExpoCrypto !== 'object') {
        global.expo.modules.ExpoCrypto = {};
      }
      global.expo.modules.ExpoCrypto.getRandomValues = ExpoCrypto.getRandomValues;
      global.crypto.getRandomValues = (typedArray) => {
        ExpoCrypto.getRandomValues(typedArray);
        return typedArray;
      };
    }
  } catch (error) {
    console.warn('[mobile] expo-crypto unavailable, using Math.random fallback for getRandomValues:', error);
    global.crypto.getRandomValues = (typedArray) => {
      for (let i = 0; i < typedArray.length; i += 1) {
        typedArray[i] = Math.floor(Math.random() * 256);
      }
      return typedArray;
    };
  }
}

// Register the root component
import { registerRootComponent } from 'expo';
import App from './App';
registerRootComponent(App);
