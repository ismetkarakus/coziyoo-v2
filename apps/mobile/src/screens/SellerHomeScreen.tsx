import React, { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import type { AuthSession } from "../utils/auth";
import { refreshAuthSession } from "../utils/auth";
import { actorRoleHeader } from "../utils/actorRole";
import { loadSettings } from "../utils/settings";
import { setSellerFoodsCache } from "../utils/sellerFoodsCache";
import { subscribeSellerOrdersRealtime } from "../utils/realtime";
import ActionButton from "../components/ActionButton";

type Props = {
  auth: AuthSession;
  onAuthRefresh?: (session: AuthSession) => void;
  onOpenProfile: () => void;
  onOpenFoodsManager: () => void;
  onOpenOrderHistory: () => void;
  onOpenOrder: (orderId: string) => void;
  onOpenSettings: () => void;
  onLogout: () => void;
  onSwitchToBuyer?: () => void;
};

type SellerOrder = {
  id: string;
  orderNo?: string | null;
  buyerName?: string | null;
  status: string;
  totalPrice: number;
  createdAt?: string;
};

type KpiFilter = "all" | "today" | "preparing" | "waiting";

export default function SellerHomeScreen({
  auth,
  onAuthRefresh,
  onOpenProfile,
  onOpenFoodsManager,
  onOpenOrderHistory,
  onOpenOrder,
  onOpenSettings,
  onLogout,
  onSwitchToBuyer,
}: Props) {
  const [apiUrl, setApiUrl] = useState("http://localhost:3000");
  const [currentAuth, setCurrentAuth] = useState(auth);
  const [loading, setLoading] = useState(true);
  const [displayName, setDisplayName] = useState<string>("Usta");
  const [stats, setStats] = useState({ today: 0, preparing: 0, waiting: 0 });
  const [orders, setOrders] = useState<SellerOrder[]>([]);
  const [activeFilter, setActiveFilter] = useState<KpiFilter>("all");

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
        const orders: SellerOrder[] = Array.isArray(ordersJson.data) ? ordersJson.data : [];
        setOrders(orders);
        setStats({
          today: orders.filter((o) => String(o.createdAt ?? "").slice(0, 10) === todayKey).length,
          preparing: orders.filter((o) => o.status === "preparing").length,
          waiting: orders.filter((o) => o.status === "pending_seller_approval").length,
        });
      }

      // Warm up foods cache so "Yemek Yönetimi" opens instantly on first try.
      void (async () => {
        try {
          const foodsRes = await fetchWithAuth("/v1/seller/foods", baseUrl);
          if (!foodsRes.ok) return;
          const foodsJson = await foodsRes.json();
          if (Array.isArray(foodsJson?.data)) {
            setSellerFoodsCache(foodsJson.data as Record<string, unknown>[]);
          }
        } catch {
          // best-effort warmup
        }
      })();
    } catch {
      // best-effort
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); }, []);

  useEffect(() => {
    const unsubscribe = subscribeSellerOrdersRealtime(currentAuth.userId, () => {
      void load();
    });
    return unsubscribe;
  }, [currentAuth.userId]);

  const filteredOrders = useMemo(() => {
    const todayKey = new Date().toISOString().slice(0, 10);
    if (activeFilter === "today") {
      return orders.filter((o) => String(o.createdAt ?? "").slice(0, 10) === todayKey);
    }
    if (activeFilter === "preparing") {
      return orders.filter((o) => o.status === "preparing");
    }
    if (activeFilter === "waiting") {
      return orders.filter((o) => o.status === "pending_seller_approval");
    }
    return orders;
  }, [orders, activeFilter]);

  const initials = displayName
    .split(" ")
    .slice(0, 2)
    .map((w: string) => w[0]?.toUpperCase() ?? "")
    .join("");

  return (
    <View style={styles.container}>
      <View style={styles.stickyTop}>
        {/* Greeting + Avatar */}
        <View style={styles.header}>
          <View style={styles.headerLeft}>
            <Text style={styles.title} numberOfLines={1}>Merhaba, {displayName} 👋</Text>
          </View>
          <TouchableOpacity style={styles.avatar} onPress={onOpenProfile} activeOpacity={0.8}>
            {loading ? (
              <ActivityIndicator size="small" color="#fff" />
            ) : (
              <Text style={styles.avatarText}>{initials}</Text>
            )}
          </TouchableOpacity>
        </View>

        {/* KPI + Filtre Chips (sticky) */}
        <View style={styles.quickButtonsRow}>
          <TouchableOpacity style={styles.quickButton} activeOpacity={0.85} onPress={onOpenFoodsManager}>
            <Text style={styles.quickButtonText}>Yemek Yönetimi</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.quickButton} activeOpacity={0.85} onPress={onOpenOrderHistory}>
            <Text style={styles.quickButtonText}>Sipariş Geçmişim</Text>
          </TouchableOpacity>
        </View>
        <View style={styles.statsRow}>
          <TouchableOpacity
            style={[styles.statChip, activeFilter === "today" && styles.statChipActive]}
            onPress={() => setActiveFilter((prev) => (prev === "today" ? "all" : "today"))}
            activeOpacity={0.8}
          >
            <Text style={styles.statValue}>{stats.today}</Text>
            <Text style={styles.statLabel}>Bugünkü</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.statChip, activeFilter === "preparing" && styles.statChipActive]}
            onPress={() => setActiveFilter((prev) => (prev === "preparing" ? "all" : "preparing"))}
            activeOpacity={0.8}
          >
            <Text style={styles.statValue}>{stats.preparing}</Text>
            <Text style={styles.statLabel}>Hazırlanıyor</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.statChip, activeFilter === "waiting" && styles.statChipActive]}
            onPress={() => setActiveFilter((prev) => (prev === "waiting" ? "all" : "waiting"))}
            activeOpacity={0.8}
          >
            <Text style={styles.statValue}>{stats.waiting}</Text>
            <Text style={styles.statLabel}>Onay Bekliyor</Text>
          </TouchableOpacity>
        </View>
      </View>

      <ScrollView style={styles.ordersScroll} contentContainerStyle={styles.ordersContent}>
        {/* Sipariş listesi */}
        <View style={styles.ordersSection}>
          <View style={styles.ordersHead}>
            <Text style={styles.ordersTitle}>Siparişler</Text>
          </View>

          {filteredOrders.length === 0 ? (
            <View style={styles.emptyCard}>
              <Text style={styles.emptyTitle}>Bu filtrede sipariş yok</Text>
              <Text style={styles.emptySub}>Filtreyi kapatmak için seçili KPI'ya tekrar dokun.</Text>
            </View>
          ) : (
            filteredOrders.map((item) => (
              <TouchableOpacity key={item.id} style={styles.orderCard} activeOpacity={0.82} onPress={() => onOpenOrder(item.id)}>
                <Text style={styles.orderNo}>{item.orderNo || `#${item.id.slice(0, 8).toUpperCase()}`}</Text>
                <Text style={styles.orderMeta}>Alıcı: {item.buyerName || "-"}</Text>
                <Text style={styles.orderMeta}>Durum: {item.status}</Text>
                <Text style={styles.orderTotal}>{Number(item.totalPrice ?? 0).toFixed(2)} TL</Text>
              </TouchableOpacity>
            ))
          )}
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
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#F7F4EF" },
  stickyTop: {
    paddingHorizontal: 16,
    paddingTop: 60,
    paddingBottom: 12,
    backgroundColor: "#F7F4EF",
    borderBottomWidth: 1,
    borderBottomColor: "#E6DED1",
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 14,
  },
  headerLeft: {
    flex: 1,
    paddingRight: 14,
  },
  title: { fontSize: 26, fontWeight: "800", color: "#2E241C" },
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
  quickButtonsRow: { flexDirection: "row", gap: 10, marginBottom: 10 },
  quickButton: {
    flex: 1,
    backgroundColor: "#fff",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#E6DED1",
    paddingVertical: 10,
    alignItems: "center",
  },
  quickButtonText: { color: "#2E241C", fontSize: 14, fontWeight: "700" },
  statChip: { flex: 1, backgroundColor: "#fff", borderRadius: 12, borderWidth: 1, borderColor: "#E6DED1", padding: 12, alignItems: "center" },
  statChipActive: { borderColor: "#3F855C", backgroundColor: "#EDF7F0" },
  statValue: { fontSize: 22, fontWeight: "800", color: "#2E241C" },
  statLabel: { fontSize: 12, color: "#6F6358", marginTop: 2 },
  ordersScroll: { flex: 1 },
  ordersContent: { paddingHorizontal: 16, paddingTop: 12, paddingBottom: 36 },
  ordersSection: { marginBottom: 14 },
  ordersHead: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 8 },
  ordersTitle: { fontSize: 18, fontWeight: "800", color: "#2E241C" },
  emptyCard: { backgroundColor: "#fff", borderRadius: 12, borderWidth: 1, borderColor: "#E5DDCF", padding: 12 },
  emptyTitle: { color: "#2E241C", fontWeight: "800" },
  emptySub: { color: "#6C6055", marginTop: 4 },
  orderCard: { backgroundColor: "#fff", borderRadius: 12, borderWidth: 1, borderColor: "#E5DDCF", padding: 12, marginBottom: 10 },
  orderNo: { color: "#2E241C", fontWeight: "800", fontSize: 16 },
  orderMeta: { color: "#6C6055", marginTop: 3 },
  orderTotal: { marginTop: 8, color: "#2E241C", fontWeight: "800" },
  actions: { gap: 10 },
});
