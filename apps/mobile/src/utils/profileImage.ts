import AsyncStorage from '@react-native-async-storage/async-storage';

const PROFILE_IMAGE_URL_KEY = '@coziyoo:profile_image_url';

export async function loadCachedProfileImageUrl(): Promise<string | null> {
  try {
    const value = await AsyncStorage.getItem(PROFILE_IMAGE_URL_KEY);
    if (!value) return null;
    const normalized = value.trim();
    return normalized || null;
  } catch {
    return null;
  }
}

export async function saveCachedProfileImageUrl(url: string): Promise<void> {
  try {
    await AsyncStorage.setItem(PROFILE_IMAGE_URL_KEY, url.trim());
  } catch {
    // ignore cache write errors
  }
}

