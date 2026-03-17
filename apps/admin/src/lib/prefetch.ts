import { request, parseJson } from "./api";

const TTL_MS = 5 * 60 * 1000; // 5 minutes

interface CacheEntry {
  data: any;
  ts: number;
}

const userCache = new Map<string, CacheEntry>();
const inFlight = new Set<string>();

export function getCachedUser(id: string): any | null {
  const entry = userCache.get(id);
  if (!entry) return null;
  if (Date.now() - entry.ts > TTL_MS) {
    userCache.delete(id);
    return null;
  }
  return entry.data;
}

export function setCachedUser(id: string, data: any) {
  userCache.set(id, { data, ts: Date.now() });
}

export function prefetchUserDetail(id: string) {
  if (!id || userCache.has(id) || inFlight.has(id)) return;
  inFlight.add(id);
  request(`/v1/admin/users/${id}`)
    .then((res) => {
      if (res.status === 200) {
        return parseJson<{ data: any }>(res).then((body) => {
          setCachedUser(id, body.data);
        });
      }
    })
    .catch(() => undefined)
    .finally(() => inFlight.delete(id));
}
