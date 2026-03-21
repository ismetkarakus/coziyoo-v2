// In-memory settings — persisted across the session but not between app launches.
// AsyncStorage can be wired up once the core app is stable.

export type AppSettings = {
  apiUrl: string;
};

export const DEVICE_PROFILE = 'default';

const defaults: AppSettings = {
  apiUrl: (process.env.EXPO_PUBLIC_API_URL || 'http://localhost:3000').trim().replace(/\/$/, ''),
};

let current: AppSettings = { ...defaults };

export async function loadSettings(): Promise<AppSettings> {
  return { ...current };
}

export async function saveSettings(settings: AppSettings): Promise<void> {
  current = {
    apiUrl: settings.apiUrl.trim().replace(/\/$/, '') || defaults.apiUrl,
  };
}
