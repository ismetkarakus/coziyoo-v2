import React, { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Alert, Platform, ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import type { AuthSession } from "../utils/auth";
import { refreshAuthSession } from "../utils/auth";
import { actorRoleHeader } from "../utils/actorRole";
import { loadSettings } from "../utils/settings";
import { setSellerFoodsCache } from "../utils/sellerFoodsCache";
import { subscribeSellerOrdersRealtime } from "../utils/realtime";

type Props = {
  auth: AuthSession;
  onAuthRefresh?: (session: AuthSession) => void;
  onOpenProfile: () => void;
  onOpenFoodsManager: () => void;
  onOpenOrderHistory: () => void;
  onOpenOrder: (orderId: string) => void;
  onSwitchToBuyer?: () => void;
};

type SellerOrder = {
  id: string;
  orderNo?: string | null;
  buyerName?: string | null;
  primaryFoodName?: string | null;
  itemCount?: number | null;
  status: string;
  deliveryType?: "pickup" | "delivery" | string;
  totalPrice: number;
  createdAt?: string;
};

type SellerAction =
  | { label: "Onayla"; kind: "approve_then_prepare"; tone?: "primary" }
  | { label: "Reddet"; kind: "reject"; tone?: "danger" }
  | { label: "Hazırlanıyor"; kind: "to_preparing"; tone?: "primary" }
  | { label: "Hazır"; kind: "to_ready"; tone?: "primary" }
  | { label: "Yola Çıktı"; kind: "to_in_delivery"; tone?: "primary" }
  | { label: "Teslim Edildi"; kind: "to_delivered"; tone?: "primary" }
  | { label: "Tamamlandı"; kind: "to_completed"; tone?: "primary" };

function statusLabel(status: string): string {
  if (status === "pending_seller_approval") return "Onay Bekliyor";
  if (status === "seller_approved") return "Onaylandı";
  if (status === "awaiting_payment") return "Ödeme Bekliyor";
  if (status === "paid") return "Ödendi";
  if (status === "preparing") return "Hazırlanıyor";
  if (status === "ready") return "Hazır";
  if (status === "in_delivery") return "Yolda";
  if (status === "delivered") return "Teslim Edildi";
  if (status === "completed") return "Tamamlandı";
  if (status === "cancelled") return "İptal";
  if (status === "rejected") return "Reddedildi";
  return status;
}

function cardActionsByStatus(status: string): SellerAction[] {
  if (status === "pending_seller_approval") return [{ label: "Reddet", kind: "reject", tone: "danger" }, { label: "Onayla", kind: "approve_then_prepare", tone: "primary" }];
  if (status === "seller_approved" || status === "awaiting_payment" || status === "paid") return [{ label: "Hazırlanıyor", kind: "to_preparing", tone: "primary" }];
  if (status === "preparing") return [{ label: "Hazır", kind: "to_ready", tone: "primary" }];
  if (status === "ready") return [{ label: "Yola Çıktı", kind: "to_in_delivery", tone: "primary" }];
  if (status === "in_delivery") return [{ label: "Teslim Edildi", kind: "to_delivered", tone: "primary" }];
  if (status === "delivered") return [{ label: "Tamamlandı", kind: "to_completed", tone: "primary" }];
  return [];
}

export default function SellerHomeScreen({
  auth,
  onAuthRefresh,
  onOpenProfile,
  onOpenFoodsManager,
  onOpenOrderHistory,
  onOpenOrder,
  onSwitchToBuyer,
}: Props) {
  const [apiUrl, setApiUrl] = useState("http://localhost:3000");
  const [currentAuth, setCurrentAuth] = useState(auth);
  const [loading, setLoading] = useState(true);
  const [displayName, setDisplayName] = useState<string>("Usta");
  const [orders, setOrders] = useState<SellerOrder[]>([]);
  const [updatingOrderId, setUpdatingOrderId] = useState<string | null>(null);

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

  async function fetchWithAuthInit(path: string, init: RequestInit, baseUrl = apiUrl): Promise<Response> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Authorization: `Bearer ${currentAuth.accessToken}`,
      ...actorRoleHeader(currentAuth, "seller"),
      ...(init.headers as Record<string, string> | undefined),
    };
    let res = await fetch(`${baseUrl}${path}`, { ...init, headers });
    if (res.status !== 401) return res;
    const refreshed = await refreshAuthSession(baseUrl, currentAuth);
    if (!refreshed) return res;
    setCurrentAuth(refreshed);
    onAuthRefresh?.(refreshed);
    return fetch(`${baseUrl}${path}`, {
      ...init,
      headers: {
        ...headers,
        Authorization: `Bearer ${refreshed.accessToken}`,
        ...actorRoleHeader(refreshed, "seller"),
      },
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
        const orders: SellerOrder[] = Array.isArray(ordersJson.data) ? ordersJson.data : [];
        setOrders(orders);
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

  const activeOrders = useMemo(
    () => orders.filter((o) => !["completed", "cancelled", "rejected"].includes(o.status)),
    [orders],
  );

  async function changeStatus(orderId: string, toStatus: "ready" | "in_delivery" | "delivered" | "completed" | "preparing"): Promise<void> {
    const res = await fetchWithAuthInit(
      `/v1/orders/${orderId}/status`,
      {
        method: "POST",
        body: JSON.stringify({ toStatus }),
      },
      apiUrl,
    );
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body?.error?.message ?? "Durum güncellenemedi");
  }

  async function approveThenPrepare(orderId: string): Promise<void> {
    const approveRes = await fetchWithAuthInit(
      `/v1/orders/${orderId}/approve`,
      { method: "POST", body: JSON.stringify({}) },
      apiUrl,
    );
    const approveBody = await approveRes.json().catch(() => ({}));
    if (!approveRes.ok) throw new Error(approveBody?.error?.message ?? "Sipariş onaylanamadı");

    await changeStatus(orderId, "preparing");
  }

  async function rejectOrder(orderId: string): Promise<void> {
    const rejectRes = await fetchWithAuthInit(
      `/v1/orders/${orderId}/reject`,
      { method: "POST", body: JSON.stringify({ reason: "Şu an hazırlanamıyor." }) },
      apiUrl,
    );
    const rejectBody = await rejectRes.json().catch(() => ({}));
    if (!rejectRes.ok) throw new Error(rejectBody?.error?.message ?? "Sipariş reddedilemedi");
  }

  async function runCardAction(orderId: string, action: SellerAction) {
    try {
      setUpdatingOrderId(orderId);
      if (action.kind === "approve_then_prepare") {
        await approveThenPrepare(orderId);
      } else if (action.kind === "reject") {
        await rejectOrder(orderId);
      } else if (action.kind === "to_preparing") {
        await changeStatus(orderId, "preparing");
      } else if (action.kind === "to_ready") {
        await changeStatus(orderId, "ready");
      } else if (action.kind === "to_in_delivery") {
        await changeStatus(orderId, "in_delivery");
      } else if (action.kind === "to_delivered") {
        await changeStatus(orderId, "delivered");
      } else if (action.kind === "to_completed") {
        await changeStatus(orderId, "completed");
      }
      await load();
    } catch (error) {
      Alert.alert("Hata", error instanceof Error ? error.message : "İşlem başarısız");
    } finally {
      setUpdatingOrderId(null);
    }
  }

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

        {/* Üst Hızlı Butonlar */}
        <View style={styles.quickButtonsRow}>
          <TouchableOpacity style={styles.quickButton} activeOpacity={0.85} onPress={onOpenFoodsManager}>
            <Text style={styles.quickButtonText}>Yemek Yönetimi</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.quickButton} activeOpacity={0.85} onPress={onOpenOrderHistory}>
            <Text style={styles.quickButtonText}>Sipariş Geçmişim</Text>
          </TouchableOpacity>
        </View>
      </View>

      <ScrollView style={styles.ordersScroll} contentContainerStyle={styles.ordersContent}>
        {/* Sipariş listesi */}
        <View style={styles.ordersSection}>
          <View style={styles.ordersHead}>
            <View style={styles.ordersTitleRow}>
              <Text style={styles.ordersTitle}>Bugünkü Siparişler</Text>
              <View style={styles.ordersCountChip}>
                <Text style={styles.ordersCountChipText}>{activeOrders.length}</Text>
              </View>
            </View>
          </View>

          {activeOrders.length === 0 ? (
            <View style={styles.emptyCard}>
              <Text style={styles.emptyTitle}>Aktif sipariş yok</Text>
              <Text style={styles.emptySub}>Yeni sipariş geldiğinde burada görünecek.</Text>
            </View>
          ) : (
            activeOrders.map((item) => {
              const actions = cardActionsByStatus(item.status);
              const isUpdating = updatingOrderId === item.id;
              return (
                <View key={item.id} style={styles.orderCard}>
                  <TouchableOpacity activeOpacity={0.82} onPress={() => onOpenOrder(item.id)}>
                    <View style={styles.orderTopRow}>
                      <Text style={styles.orderNo} numberOfLines={1}>
                        {item.primaryFoodName?.trim() || item.orderNo || `#${item.id.slice(0, 8).toUpperCase()}`}
                        {item.itemCount && item.itemCount > 1 ? ` +${item.itemCount - 1}` : ""}
                      </Text>
                      <View style={styles.statusBadge}>
                        <Text style={styles.statusBadgeText}>{statusLabel(item.status)}</Text>
                      </View>
                    </View>
                    <Text style={styles.orderSubNo}>{item.orderNo || `#${item.id.slice(0, 8).toUpperCase()}`}</Text>
                    <Text style={styles.orderMeta}>Alıcı: {item.buyerName || "-"}</Text>
                    <Text style={styles.orderMeta}>Teslimat: {item.deliveryType === "delivery" ? "Teslimat" : "Gel Al"}</Text>
                    <Text style={styles.orderTotal}>{Number(item.totalPrice ?? 0).toFixed(2)} TL</Text>
                  </TouchableOpacity>
                  {actions.length > 0 ? (
                    <View style={styles.cardActionRow}>
                      {actions.map((action) => (
                        <TouchableOpacity
                          key={`${item.id}-${action.kind}`}
                          activeOpacity={0.86}
                          style={[
                            styles.cardActionBtn,
                            action.tone === "danger" ? styles.cardActionBtnDanger : styles.cardActionBtnPrimary,
                            isUpdating && styles.cardActionBtnDisabled,
                          ]}
                          disabled={isUpdating}
                          onPress={() => {
                            void runCardAction(item.id, action);
                          }}
                        >
                          <Text
                            style={[
                              styles.cardActionBtnText,
                              action.tone === "danger" ? styles.cardActionBtnTextDanger : styles.cardActionBtnTextPrimary,
                            ]}
                          >
                            {isUpdating ? "İşleniyor..." : action.label}
                          </Text>
                        </TouchableOpacity>
                      ))}
                    </View>
                  ) : null}
                </View>
              );
            })
          )}
        </View>

        {onSwitchToBuyer ? (
          <View style={styles.actions}>
            <TouchableOpacity
              activeOpacity={0.86}
              style={styles.switchRoleButton}
              onPress={onSwitchToBuyer}
            >
              <Text style={styles.switchRoleButtonText}>Alıcı Moduna Geç</Text>
            </TouchableOpacity>
          </View>
        ) : null}
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
  title: {
    fontSize: 26,
    color: "#2E241C",
    letterSpacing: -0.5,
    ...(Platform.OS === "ios"
      ? { fontFamily: "AvenirNextCondensed-Bold", fontWeight: "700" }
      : { fontFamily: "sans-serif-condensed", fontWeight: "700" }),
  },
  avatar: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: "#3F855C",
    alignItems: "center",
    justifyContent: "center",
  },
  avatarText: { color: "#fff", fontSize: 18, fontWeight: "800" },
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
  ordersScroll: { flex: 1 },
  ordersContent: { paddingHorizontal: 16, paddingTop: 12, paddingBottom: 36 },
  ordersSection: { marginBottom: 14 },
  ordersHead: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 8 },
  ordersTitleRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  ordersTitle: { fontSize: 18, fontWeight: "800", color: "#2E241C" },
  ordersCountChip: {
    minWidth: 28,
    height: 24,
    borderRadius: 999,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 8,
    borderWidth: 1,
    borderColor: "#D6CCBD",
    backgroundColor: "#fff",
  },
  ordersCountChipText: { color: "#5C4A3A", fontSize: 12, fontWeight: "800" },
  emptyCard: { backgroundColor: "#fff", borderRadius: 12, borderWidth: 1, borderColor: "#E5DDCF", padding: 12 },
  emptyTitle: { color: "#2E241C", fontWeight: "800" },
  emptySub: { color: "#6C6055", marginTop: 4 },
  orderCard: { backgroundColor: "#fff", borderRadius: 12, borderWidth: 1, borderColor: "#E5DDCF", padding: 12, marginBottom: 10 },
  orderTopRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", gap: 8 },
  orderNo: { color: "#2E241C", fontWeight: "800", fontSize: 16, flex: 1 },
  orderSubNo: { color: "#887766", fontSize: 12, marginTop: 2, marginBottom: 2 },
  statusBadge: {
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderWidth: 1,
    borderColor: "#D6CCBD",
    backgroundColor: "#F7EFE2",
  },
  statusBadgeText: { color: "#5C4A3A", fontSize: 11, fontWeight: "700" },
  orderMeta: { color: "#6C6055", marginTop: 3 },
  orderTotal: { marginTop: 8, color: "#2E241C", fontWeight: "800" },
  cardActionRow: { marginTop: 10, flexDirection: "row", gap: 8 },
  cardActionBtn: { flex: 1, borderRadius: 10, borderWidth: 1, paddingVertical: 10, alignItems: "center" },
  cardActionBtnPrimary: { backgroundColor: "#3F855C", borderColor: "#3F855C" },
  cardActionBtnDanger: { backgroundColor: "#FFF0EE", borderColor: "#F9CECA" },
  cardActionBtnDisabled: { opacity: 0.6 },
  cardActionBtnText: { fontWeight: "700", fontSize: 13 },
  cardActionBtnTextPrimary: { color: "#FFFFFF" },
  cardActionBtnTextDanger: { color: "#B42318" },
  actions: { gap: 10 },
  switchRoleButton: {
    height: 44,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#CFC5B6",
    backgroundColor: "#F7F4EF",
    alignItems: "center",
    justifyContent: "center",
  },
  switchRoleButtonText: {
    color: "#5C4A3A",
    fontSize: 14,
    fontWeight: "700",
  },
});
