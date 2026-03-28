import React, { useEffect, useState } from "react";
import { ActivityIndicator, ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import type { AuthSession } from "../utils/auth";
import { refreshAuthSession } from "../utils/auth";
import { actorRoleHeader } from "../utils/actorRole";
import { loadSettings } from "../utils/settings";
import ActionButton from "../components/ActionButton";

type Props = {
  auth: AuthSession;
  onAuthRefresh?: (session: AuthSession) => void;
  onOpenProfile: () => void;
  onOpenSettings: () => void;
  onLogout: () => void;
  onSwitchToBuyer?: () => void;
};

export default function SellerHomeScreen({
  auth,
  onAuthRefresh,
  onOpenProfile,
  onOpenSettings,
  onLogout,
  onSwitchToBuyer,
}: Props) {
  const [apiUrl, setApiUrl] = useState("http://localhost:3000");
  const [currentAuth, setCurrentAuth] = useState(auth);
  const [loading, setLoading] = useState(true);
  const [displayName, setDisplayName] = useState<string>("Usta");
  const [stats, setStats] = useState({ today: 0, preparing: 0, waiting: 0 });

  useEffect(() => setCurrentAuth(auth), [auth]);

  async function fetchWithAuth(path: string, baseUrl = apiUrl): Promise<Response> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Authorization: `Bearer ${currentAuth.accessToken}`,
      ...actorRoleHeader(currentAuth, "seller"),
    };
    let res = await fetch(`${baseUrl}${path}`, { headers });
    if (res.status !== 401) return res;
    const refreshed = await refreshAuthSession(baseUrl, currentAuth);
    if (!refreshed) return res;
    setCurrentAuth(refreshed);
    onAuthRefresh?.(refreshed);
    return fetch(`${baseUrl}${path}`, {
      headers: { ...headers, Authorization: `Bearer ${refreshed.accessToken}`, ...actorRoleHeader(refreshed, "seller") },
    });
  }

  async function load() {
    setLoading(true);
    try {
      const settings = await loadSettings();
      const baseUrl = settings.apiUrl;
      setApiUrl(baseUrl);
      const [profileRes, ordersRes] = await Promise.all([
        fetchWithAuth("/v1/seller/profile", baseUrl),
        fetchWithAuth("/v1/seller/orders?page=1&pageSize=200", baseUrl),
      ]);
      const profileJson = await profileRes.json();
      if (profileRes.ok) setDisplayName(profileJson.data?.displayName?.trim() || "Usta");
      if (ordersRes.ok) {
        const ordersJson = await ordersRes.json();
        const todayKey = new Date().toISOString().slice(0, 10);
        const orders: Array<{ status: string; createdAt?: string }> = Array.isArray(ordersJson.data) ? ordersJson.data : [];
        setStats({
          today: orders.filter((o) => String(o.createdAt ?? "").slice(0, 10) === todayKey).length,
          preparing: orders.filter((o) => o.status === "preparing").length,
          waiting: orders.filter((o) => o.status === "pending_seller_approval").length,
        });
      }
    } catch {
      // best-effort
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); }, []);

  const initials = displayName
    .split(" ")
    .slice(0, 2)
    .map((w: string) => w[0]?.toUpperCase() ?? "")
    .join("");

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>

      {/* Greeting + Avatar */}
      <View style={styles.header}>
        <View>
          <Text style={styles.title}>Merhaba, {displayName} 👋</Text>
          <Text style={styles.subtitle}>Satıcı Paneli</Text>
        </View>
        <TouchableOpacity style={styles.avatar} onPress={onOpenProfile} activeOpacity={0.8}>
          {loading ? (
            <ActivityIndicator size="small" color="#fff" />
          ) : (
            <Text style={styles.avatarText}>{initials}</Text>
          )}
        </TouchableOpacity>
      </View>

      {/* Stats Chips */}
      <View style={styles.statsRow}>
        <View style={styles.statChip}>
          <Text style={styles.statValue}>{stats.today}</Text>
          <Text style={styles.statLabel}>Bugünkü</Text>
        </View>
        <View style={styles.statChip}>
          <Text style={styles.statValue}>{stats.preparing}</Text>
          <Text style={styles.statLabel}>Hazırlanıyor</Text>
        </View>
        <View style={styles.statChip}>
          <Text style={styles.statValue}>{stats.waiting}</Text>
          <Text style={styles.statLabel}>Onay Bekliyor</Text>
        </View>
      </View>

      {/* Action Buttons */}
      <View style={styles.actions}>
        <ActionButton label="Ayarlar" onPress={onOpenSettings} variant="soft" fullWidth />
        {onSwitchToBuyer ? (
          <ActionButton label="Alıcı Moduna Geç" onPress={onSwitchToBuyer} variant="outline" fullWidth />
        ) : null}
        <ActionButton label="Çıkış Yap" onPress={onLogout} variant="danger" fullWidth />
      </View>

    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#F7F4EF" },
  content: { padding: 16, paddingTop: 60, paddingBottom: 36 },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 24,
  },
  title: { fontSize: 26, fontWeight: "800", color: "#2E241C" },
  subtitle: { marginTop: 4, fontSize: 13, color: "#9A8C82", fontWeight: "500" },
  avatar: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: "#3F855C",
    alignItems: "center",
    justifyContent: "center",
  },
  avatarText: { color: "#fff", fontSize: 18, fontWeight: "800" },
  statsRow: { flexDirection: "row", gap: 10, marginBottom: 16 },
  statChip: { flex: 1, backgroundColor: "#fff", borderRadius: 12, borderWidth: 1, borderColor: "#E6DED1", padding: 12, alignItems: "center" },
  statValue: { fontSize: 22, fontWeight: "800", color: "#2E241C" },
  statLabel: { fontSize: 12, color: "#6F6358", marginTop: 2 },
  actions: { gap: 10 },
});
