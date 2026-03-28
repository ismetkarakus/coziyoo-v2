import React, { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Alert, FlatList, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import type { AuthSession } from "../utils/auth";
import { refreshAuthSession } from "../utils/auth";
import { actorRoleHeader } from "../utils/actorRole";
import { loadSettings } from "../utils/settings";
import { theme } from "../theme/colors";
import ScreenHeader from "../components/ScreenHeader";

type Props = {
  auth: AuthSession;
  onBack: () => void;
  onOpenOrder: (orderId: string) => void;
  onAuthRefresh?: (session: AuthSession) => void;
};

type SellerOrder = {
  id: string;
  orderNo?: string | null;
  buyerName?: string | null;
  status: string;
  totalPrice: number;
  createdAt?: string;
};

export default function SellerOrdersScreen({ auth, onBack, onOpenOrder, onAuthRefresh }: Props) {
  const [apiUrl, setApiUrl] = useState("http://localhost:3000");
  const [currentAuth, setCurrentAuth] = useState(auth);
  const [loading, setLoading] = useState(true);
  const [orders, setOrders] = useState<SellerOrder[]>([]);
  const [errorText, setErrorText] = useState<string | null>(null);

  useEffect(() => setCurrentAuth(auth), [auth]);

  async function authedFetch(path: string, baseUrl = apiUrl): Promise<Response> {
    const headers = {
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
      headers: {
        ...headers,
        Authorization: `Bearer ${refreshed.accessToken}`,
        ...actorRoleHeader(refreshed, "seller"),
      },
    });
  }

  async function loadOrders() {
    setLoading(true);
    setErrorText(null);
    try {
      const settings = await loadSettings();
      const baseUrl = settings.apiUrl;
      setApiUrl(baseUrl);
      const primaryRes = await authedFetch("/v1/seller/orders?page=1&pageSize=200", baseUrl);
      const primaryJson = await primaryRes.json();
      if (!primaryRes.ok) throw new Error(primaryJson?.error?.message ?? "Siparişler yüklenemedi");
      let sellerOrders = Array.isArray(primaryJson?.data) ? primaryJson.data : [];

      // Some environments may return empty for role=seller due to legacy actor filtering.
      // Fallback to unscoped list and extract seller-owned rows client-side.
      if (sellerOrders.length === 0) {
        const fallbackRes = await authedFetch("/v1/orders?page=1&pageSize=200", baseUrl);
        const fallbackJson = await fallbackRes.json();
        if (fallbackRes.ok && Array.isArray(fallbackJson?.data)) {
          const fromAll = fallbackJson.data.filter((row: SellerOrder & { sellerId?: string }) => row.sellerId === currentAuth.userId);
          sellerOrders = fromAll.length > 0 ? fromAll : fallbackJson.data;
        }
      }

      setOrders(sellerOrders);
    } catch (e) {
      const message = e instanceof Error ? e.message : "Siparişler yüklenemedi";
      setErrorText(message);
      Alert.alert("Hata", message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadOrders();
  }, []);

  const grouped = useMemo(() => {
    const waiting = orders.filter((x) => x.status === "pending_seller_approval").length;
    const prep = orders.filter((x) => x.status === "preparing").length;
    const road = orders.filter((x) => x.status === "in_delivery").length;
    return { waiting, prep, road };
  }, [orders]);

  return (
    <View style={styles.container}>
      <ScreenHeader
        title="Sipariş Yönetimi"
        onBack={onBack}
        rightAction={
          <TouchableOpacity onPress={() => void loadOrders()}>
            <Text style={styles.refresh}>Yenile</Text>
          </TouchableOpacity>
        }
      />
      <View style={styles.stats}>
        <Text style={styles.stat}>Onay: {grouped.waiting}</Text>
        <Text style={styles.stat}>Hazırlık: {grouped.prep}</Text>
        <Text style={styles.stat}>Yolda: {grouped.road}</Text>
      </View>
      {loading ? (
        <ActivityIndicator size="large" color={theme.primary} />
      ) : (
        <>
          {orders.length === 0 ? (
            <View style={styles.emptyWrap}>
              <Text style={styles.emptyTitle}>Henüz sipariş görünmüyor</Text>
              <Text style={styles.emptySub}>
                {errorText
                  ? "Bağlantıyı kontrol edip tekrar yenile."
                  : "Yeni sipariş gelince burada listelenecek. Üstten Yenile'ye basabilirsin."}
              </Text>
            </View>
          ) : (
            <FlatList
              data={orders}
              keyExtractor={(item) => item.id}
              contentContainerStyle={{ padding: 14, gap: 10 }}
              renderItem={({ item }) => (
                <TouchableOpacity style={styles.card} onPress={() => onOpenOrder(item.id)}>
                  <Text style={styles.orderNo}>{item.orderNo || item.id.slice(0, 8)}</Text>
                  <Text style={styles.meta}>Alıcı: {item.buyerName || "-"}</Text>
                  <Text style={styles.meta}>Durum: {item.status}</Text>
                  <Text style={styles.total}>{Number(item.totalPrice ?? 0).toFixed(2)} TL</Text>
                </TouchableOpacity>
              )}
            />
          )}
        </>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#F7F4EF" },
  refresh: { color: "#3F855C", fontWeight: "700", fontSize: 14 },
  stats: { flexDirection: "row", gap: 12, paddingHorizontal: 16, paddingBottom: 8 },
  stat: { backgroundColor: "#EFE9DF", borderRadius: 16, paddingHorizontal: 10, paddingVertical: 6, color: "#5D5145", fontWeight: "700" },
  card: { backgroundColor: "#fff", borderRadius: 12, borderWidth: 1, borderColor: "#E5DDCF", padding: 12 },
  orderNo: { color: "#2E241C", fontWeight: "800", fontSize: 16 },
  meta: { color: "#6C6055", marginTop: 3 },
  total: { marginTop: 8, color: "#2E241C", fontWeight: "800" },
  emptyWrap: {
    marginHorizontal: 14,
    marginTop: 8,
    backgroundColor: "#fff",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#E5DDCF",
    padding: 14,
  },
  emptyTitle: { color: "#2E241C", fontWeight: "800", fontSize: 16 },
  emptySub: { color: "#6C6055", marginTop: 4, lineHeight: 20 },
});
