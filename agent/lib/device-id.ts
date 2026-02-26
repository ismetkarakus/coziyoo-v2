'use client';

const DEVICE_ID_KEY = 'coziyoo_device_id';

export function getOrCreateDeviceId() {
  const existing =
    typeof window !== 'undefined' ? window.localStorage.getItem(DEVICE_ID_KEY) : null;
  if (existing && isValidDeviceId(existing)) {
    syncCookie(existing);
    return existing;
  }

  const generated = createDeviceId();
  if (typeof window !== 'undefined') {
    window.localStorage.setItem(DEVICE_ID_KEY, generated);
  }
  syncCookie(generated);
  return generated;
}

export function isValidDeviceId(value: string) {
  return /^[a-zA-Z0-9_-]{8,128}$/.test(value);
}

function createDeviceId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `dv_${crypto.randomUUID().replace(/-/g, '')}`;
  }
  return `dv_${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
}

function syncCookie(deviceId: string) {
  if (typeof document === 'undefined') return;
  document.cookie = `${DEVICE_ID_KEY}=${encodeURIComponent(deviceId)}; path=/; max-age=31536000; samesite=lax`;
}
