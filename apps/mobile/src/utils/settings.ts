import AsyncStorage from '@react-native-async-storage/async-storage';

export type AppSettings = {
  apiUrl: string;
};

export const DEVICE_PROFILE = 'default';
const STORAGE_KEY = '@coziyoo:settings';

const defaults: AppSettings = {
  apiUrl: (process.env.EXPO_PUBLIC_API_URL || 'http://localhost:3000').trim().replace(/\/$/, ''),
};

let current: AppSettings = { ...defaults };
let hydrated = false;

export async function loadSettings(): Promise<AppSettings> {
  if (!hydrated) {
    try {
      const raw = await AsyncStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as Partial<AppSettings>;
        const normalized = (parsed.apiUrl || '').trim().replace(/\/$/, '');
        current = {
          apiUrl: normalized || defaults.apiUrl,
        };
      }
    } catch {
      // ignore and keep defaults
    } finally {
      hydrated = true;
    }
  }
  return { ...current };
}

export async function saveSettings(settings: AppSettings): Promise<void> {
  current = {
    apiUrl: settings.apiUrl.trim().replace(/\/$/, '') || defaults.apiUrl,
  };
  hydrated = true;
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(current));
}
