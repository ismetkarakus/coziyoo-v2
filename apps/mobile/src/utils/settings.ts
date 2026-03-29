import AsyncStorage from '@react-native-async-storage/async-storage';

export type AppSettings = {
  apiUrl: string;
};

export const DEVICE_PROFILE = 'default';
const STORAGE_KEY = '@coziyoo:settings';

const defaults: AppSettings = {
  apiUrl: (process.env.EXPO_PUBLIC_API_URL || 'http://localhost:3000').trim().replace(/\/$/, ''),
};

const RELEASE_FALLBACK_API_URL = "https://api.coziyoo.com";

function isLocalhostLike(url: string): boolean {
  const lower = url.toLowerCase();
  return (
    lower.includes("localhost") ||
    lower.includes("127.0.0.1") ||
    lower.includes("0.0.0.0")
  );
}

function normalizeApiUrlForMode(rawUrl: string): string {
  const trimmed = rawUrl.trim().replace(/\/$/, "");
  const fallback = (process.env.EXPO_PUBLIC_API_URL || RELEASE_FALLBACK_API_URL).trim().replace(/\/$/, "");
  if (!trimmed) return fallback;
  if (__DEV__) {
    // In dev, physical devices cannot reach localhost values saved in settings.
    if (isLocalhostLike(trimmed) && fallback && !isLocalhostLike(fallback)) {
      return fallback;
    }
    return trimmed;
  }
  const lower = trimmed.toLowerCase();
  if (
    isLocalhostLike(lower) ||
    lower.includes("192.168.")
  ) {
    return fallback || RELEASE_FALLBACK_API_URL;
  }
  return trimmed;
}

let current: AppSettings = { ...defaults };
let hydrated = false;

export async function loadSettings(): Promise<AppSettings> {
  if (!hydrated) {
    try {
      const raw = await AsyncStorage.getItem(STORAGE_KEY);
      if (raw) {
        const parsed = JSON.parse(raw) as Partial<AppSettings>;
        const normalized = normalizeApiUrlForMode(parsed.apiUrl || '');
        current = {
          apiUrl: normalized || normalizeApiUrlForMode(defaults.apiUrl),
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
  const normalized = normalizeApiUrlForMode(settings.apiUrl);
  current = {
    apiUrl: normalized || normalizeApiUrlForMode(defaults.apiUrl),
  };
  hydrated = true;
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(current));
}
