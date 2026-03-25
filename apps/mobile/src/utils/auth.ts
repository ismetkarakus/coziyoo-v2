import AsyncStorage from '@react-native-async-storage/async-storage';
import { readJsonSafe } from './http';

const STORAGE_KEY = '@coziyoo:auth';

export type AuthSession = {
  accessToken: string;
  refreshToken: string;
  userId: string;
  userType: string;
  email: string;
};

export async function saveAuthSession(session: AuthSession): Promise<void> {
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(session));
}

export async function loadAuthSession(): Promise<AuthSession | null> {
  try {
    const raw = await AsyncStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as AuthSession;
  } catch {
    return null;
  }
}

export async function clearAuthSession(): Promise<void> {
  await AsyncStorage.removeItem(STORAGE_KEY);
}

export async function refreshAuthSession(
  apiUrl: string,
  session: AuthSession,
): Promise<AuthSession | null> {
  try {
    const response = await fetch(`${apiUrl}/v1/auth/refresh`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ refreshToken: session.refreshToken }),
    });
    if (!response.ok) return null;
    const json = await readJsonSafe<{
      data?: { tokens?: { accessToken?: string; refreshToken?: string } };
    }>(response);
    const tokens = json.data?.tokens;
    if (!tokens?.accessToken || !tokens?.refreshToken) return null;
    const next: AuthSession = {
      ...session,
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
    };
    await saveAuthSession(next);
    return next;
  } catch {
    return null;
  }
}
