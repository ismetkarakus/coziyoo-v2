import * as SecureStore from 'expo-secure-store';
import type { LoginResponse } from '../../types/api';

const AUTH_KEY = 'coziyoo_mobile_auth';

export async function loadStoredAuth(): Promise<LoginResponse | null> {
  const raw = await SecureStore.getItemAsync(AUTH_KEY);
  if (!raw) return null;

  try {
    const parsed = JSON.parse(raw) as LoginResponse;
    if (!parsed?.tokens?.accessToken || !parsed?.tokens?.refreshToken) {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export async function saveStoredAuth(auth: LoginResponse): Promise<void> {
  await SecureStore.setItemAsync(AUTH_KEY, JSON.stringify(auth));
}

export async function clearStoredAuth(): Promise<void> {
  await SecureStore.deleteItemAsync(AUTH_KEY);
}
