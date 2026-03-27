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
    try {
      const settings = await loadSettings();
      const baseUrl = settings.apiUrl;
      setApiUrl(baseUrl);
      const res = await authedFetch("/v1/orders?role=seller&page=1&pageSize=200", baseUrl);
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error?.message ?? "Siparişler yüklenemedi");
      setOrders(Array.isArray(json?.data) ? json.data : []);
    } catch (e) {
      Alert.alert("Hata", e instanceof Error ? e.message : "Siparişler yüklenemedi");
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
});
