import Constants from "expo-constants";
import { Platform } from "react-native";

function resolveApiBaseUrl(): string {
  const explicit = process.env.EXPO_PUBLIC_API_BASE_URL;
  if (explicit && explicit.trim().length > 0) return explicit;

  // On real devices, localhost points to the phone itself.
  const hostUri =
    (Constants.expoConfig as { hostUri?: string } | null)?.hostUri ??
    (Constants as { manifest2?: { extra?: { expoClient?: { hostUri?: string } } } }).manifest2?.extra?.expoClient?.hostUri;
  const host = hostUri?.split(":")[0];
  if (host && host !== "localhost" && host !== "127.0.0.1") {
    return `http://${host}:3000`;
  }

  if (Platform.OS === "android") {
    // Android emulator localhost bridge.
    return "http://10.0.2.2:3000";
  }

  return "http://localhost:3000";
}

export const API_BASE_URL = resolveApiBaseUrl();
export const DEFAULT_RADIUS_KM = 5;
export const GREETING_TEXT =
  "Merhaba, bugun ne yemek istersin? Sana yakin ve populer secenekleri hemen bulabilirim.";
