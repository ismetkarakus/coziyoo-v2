// In-memory settings — persisted across the session but not between app launches.
// AsyncStorage can be wired up once the core app is stable.

export type AppSettings = {
  apiUrl: string;
  deviceProfile: string;
};

const defaults: AppSettings = {
  apiUrl: 'https://api.coziyoo.com',
  deviceProfile: 'coziyoo-default',  // min 8 chars required by public API
};

let current: AppSettings = { ...defaults };

export async function loadSettings(): Promise<AppSettings> {
  return { ...current };
}

export async function saveSettings(settings: AppSettings): Promise<void> {
  current = {
    apiUrl: settings.apiUrl.trim().replace(/\/$/, '') || defaults.apiUrl,
    deviceProfile: settings.deviceProfile.trim() || defaults.deviceProfile,
  };
}
