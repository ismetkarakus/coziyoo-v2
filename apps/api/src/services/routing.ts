import { env } from "../config/env.js";

export type LatLng = { lat: number; lng: number };

function toNum(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string") {
    const n = Number(value);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

export function extractLatLng(value: unknown): LatLng | null {
  if (!value || typeof value !== "object") return null;
  const obj = value as Record<string, unknown>;
  const lat = toNum(obj.lat ?? obj.latitude);
  const lng = toNum(obj.lng ?? obj.lon ?? obj.longitude);
  if (lat === null || lng === null) return null;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
  return { lat, lng };
}

export function extractAddressLine(value: unknown): string | null {
  if (!value) return null;
  if (typeof value === "string") return value.trim() || null;
  if (typeof value !== "object") return null;
  const obj = value as Record<string, unknown>;
  const parts = [
    String(obj.addressLine ?? "").trim(),
    String(obj.line ?? "").trim(),
    String(obj.neighborhood ?? "").trim(),
    String(obj.district ?? "").trim(),
    String(obj.city ?? "").trim(),
  ].filter(Boolean);
  return parts.length > 0 ? parts.join(", ") : null;
}

function haversineKm(a: LatLng, b: LatLng): number {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const x =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.sin(dLng / 2) * Math.sin(dLng / 2) * Math.cos(lat1) * Math.cos(lat2);
  return 6371 * (2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x)));
}

export async function geocodeAddress(address: string): Promise<LatLng | null> {
  const provider = env.ROUTING_PROVIDER;
  if (!address.trim()) return null;

  if ((provider === "google" || provider === "auto") && env.GOOGLE_MAPS_API_KEY) {
    try {
      const url = new URL("https://maps.googleapis.com/maps/api/geocode/json");
      url.searchParams.set("address", address);
      url.searchParams.set("key", env.GOOGLE_MAPS_API_KEY);
      const response = await fetch(url);
      if (!response.ok) return null;
      const json = (await response.json()) as {
        status?: string;
        results?: Array<{ geometry?: { location?: { lat?: number; lng?: number } } }>;
      };
      if (json.status !== "OK") return null;
      const loc = json.results?.[0]?.geometry?.location;
      if (!loc || typeof loc.lat !== "number" || typeof loc.lng !== "number") return null;
      return { lat: loc.lat, lng: loc.lng };
    } catch {
      return null;
    }
  }

  return null;
}

export async function estimateRouteDurationSeconds(origin: LatLng, destination: LatLng): Promise<number | null> {
  const provider = env.ROUTING_PROVIDER;

  if ((provider === "google" || provider === "auto") && env.GOOGLE_MAPS_API_KEY) {
    try {
      const url = new URL("https://maps.googleapis.com/maps/api/distancematrix/json");
      url.searchParams.set("origins", `${origin.lat},${origin.lng}`);
      url.searchParams.set("destinations", `${destination.lat},${destination.lng}`);
      url.searchParams.set("departure_time", "now");
      url.searchParams.set("mode", "driving");
      url.searchParams.set("key", env.GOOGLE_MAPS_API_KEY);
      const response = await fetch(url);
      if (response.ok) {
        const json = (await response.json()) as {
          status?: string;
          rows?: Array<{ elements?: Array<{ status?: string; duration?: { value?: number }; duration_in_traffic?: { value?: number } }> }>;
        };
        const element = json.rows?.[0]?.elements?.[0];
        const duration = element?.duration_in_traffic?.value ?? element?.duration?.value;
        if (json.status === "OK" && element?.status === "OK" && typeof duration === "number" && duration > 0) {
          return Math.round(duration);
        }
      }
    } catch {
      // fallback below
    }
  }

  const km = haversineKm(origin, destination);
  const seconds = (km / Math.max(5, env.DELIVERY_AVG_SPEED_KMH)) * 3600;
  return Math.max(60, Math.round(seconds));
}
