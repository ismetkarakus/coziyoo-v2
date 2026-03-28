import { createClient, type RealtimeChannel } from "@supabase/supabase-js";

const SUPABASE_URL = (import.meta.env.VITE_SUPABASE_URL as string | undefined)?.trim() ?? "";
const SUPABASE_ANON_KEY = (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined)?.trim() ?? "";

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

export function subscribeOrdersAndFoodsRealtime(onChange: () => void): RealtimeUnsubscribe {
  const client = getClient();
  if (!client) return () => {};

  const channel: RealtimeChannel = client
    .channel(`admin-live-${Date.now()}`)
    .on("postgres_changes", { event: "*", schema: "public", table: "orders" }, onChange)
    .on("postgres_changes", { event: "*", schema: "public", table: "order_items" }, onChange)
    .on("postgres_changes", { event: "*", schema: "public", table: "foods" }, onChange)
    .on("postgres_changes", { event: "*", schema: "public", table: "production_lots" }, onChange)
    .subscribe();

  return () => {
    void client.removeChannel(channel);
  };
}

