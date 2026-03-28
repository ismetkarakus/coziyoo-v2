import { createClient, type RealtimeChannel } from "@supabase/supabase-js";

const SUPABASE_URL = (process.env.EXPO_PUBLIC_SUPABASE_URL ?? "").trim();
const SUPABASE_ANON_KEY = (process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY ?? "").trim();

let singleton: ReturnType<typeof createClient> | null = null;

function getClient() {
  if (!SUPABASE_URL || !SUPABASE_ANON_KEY) return null;
  if (!singleton) {
    singleton = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
      auth: {
        autoRefreshToken: false,
        persistSession: false,
        detectSessionInUrl: false,
      },
    });
  }
  return singleton;
}

export type RealtimeUnsubscribe = () => void;

export function subscribeBuyerFeedRealtime(onChange: () => void): RealtimeUnsubscribe {
  const client = getClient();
  if (!client) return () => {};

  const channel: RealtimeChannel = client
    .channel(`mobile-feed-${Date.now()}`)
    .on("postgres_changes", { event: "*", schema: "public", table: "foods" }, onChange)
    .on("postgres_changes", { event: "*", schema: "public", table: "production_lots" }, onChange)
    .on("postgres_changes", { event: "*", schema: "public", table: "orders" }, onChange)
    .subscribe();

  return () => {
    void client.removeChannel(channel);
  };
}

