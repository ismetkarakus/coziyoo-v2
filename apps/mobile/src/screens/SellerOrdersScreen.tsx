import React, { useEffect, useMemo, useState } from "react";
import { Alert, FlatList, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import type { AuthSession } from "../utils/auth";
import { apiRequest } from "../utils/api";
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
  sellerId: string;
  buyerName?: string | null;
  status: string;
  totalPrice: number;
  createdAt?: string;
};

export default function SellerOrdersScreen({ auth, onBack, onOpenOrder, onAuthRefresh }: Props) {
  const [currentAuth, setCurrentAuth] = useState(auth);
  const [loading, setLoading] = useState(true);
  const [orders, setOrders] = useState<SellerOrder[]>([]);

  useEffect(() => setCurrentAuth(auth), [auth]);

  function handleRefresh(session: AuthSession) {
    setCurrentAuth(session);
    onAuthRefresh?.(session);
  }

  async function loadOrders() {
    setLoading(true);
    try {
      const res = await apiRequest<SellerOrder[]>("/v1/orders?role=seller&page=1&pageSize=50", currentAuth, { actorRole: "seller" }, handleRefresh);
      if (!res.ok) throw new Error(res.message ?? "Siparişler yüklenemedi");
      setOrders(Array.isArray(res.data) ? res.data : []);
    } catch (e) {
      Alert.alert("Hata", e instanceof Error ? e.message : "Siparişler yüklenemedi");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadOrders();
  }, []);

  const grouped = useMemo(() => ({
    waiting: orders.filter((x) => x.status === "pending_seller_approval").length,
    prep: orders.filter((x) => x.status === "preparing").length,
    road: orders.filter((x) => x.status === "in_delivery").length,
  }), [orders]);

  return (
    <View style={styles.container}>
      <ScreenHeader
        title="Sipariş Yönetimi"
        onBack={onBack}
        rightAction={
          <TouchableOpacity onPress={() => void loadOrders()} style={styles.refreshBtn}>
            <Text style={styles.refreshText}>↻</Text>
          </TouchableOpacity>
        }
      />
      <View style={styles.stats}>
        <View style={styles.statChip}><Text style={styles.statText}>Onay: {grouped.waiting}</Text></View>
        <View style={styles.statChip}><Text style={styles.statText}>Hazırlık: {grouped.prep}</Text></View>
        <View style={styles.statChip}><Text style={styles.statText}>Yolda: {grouped.road}</Text></View>
      </View>
      <View style={styles.heroCard}>
        <Text style={styles.heroTitle}>Siparişlerin burada akıyor.</Text>
        <Text style={styles.heroText}>Duruma göre ilerlet, müşteriyi bekletmeden süreci yönet.</Text>
      </View>
      {loading ? (
        <Text style={styles.loadingText}>Yükleniyor...</Text>
      ) : orders.length === 0 ? (
        <Text style={styles.emptyText}>Şu an sipariş yok, yeni sipariş geldiğinde burada göreceksin.</Text>
      ) : (
        <FlatList
          data={orders}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.list}
          renderItem={({ item }) => (
            <TouchableOpacity style={styles.card} onPress={() => onOpenOrder(item.id)} activeOpacity={0.85}>
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
  stats: { flexDirection: "row", gap: 8, paddingHorizontal: 16, paddingBottom: 10 },
  statChip: { backgroundColor: "#EFE9DF", borderRadius: 16, paddingHorizontal: 10, paddingVertical: 6 },
  statText: { color: "#5D5145", fontWeight: "700", fontSize: 13 },
  heroCard: {
    marginHorizontal: 16,
    marginBottom: 8,
    backgroundColor: "#F1E8D9",
    borderColor: "#E8D6BB",
    borderWidth: 1,
    borderRadius: 14,
    padding: 12,
  },
  heroTitle: { color: "#4B3422", fontWeight: "800", fontSize: 16 },
  heroText: { marginTop: 4, color: "#6B5545", lineHeight: 18 },
  list: { padding: 14, gap: 10 },
  loadingText: { textAlign: "center", marginTop: 40, color: "#6C6055" },
  emptyText: { textAlign: "center", marginTop: 40, color: "#9E8E7E" },
  refreshBtn: { padding: 4, alignItems: "center", justifyContent: "center" },
  refreshText: { color: theme.primary, fontSize: 22, fontWeight: "700" },
  card: { backgroundColor: "#fff", borderRadius: 12, borderWidth: 1, borderColor: "#E5DDCF", padding: 12 },
  orderNo: { color: "#2E241C", fontWeight: "800", fontSize: 16 },
  meta: { color: "#6C6055", marginTop: 3 },
  total: { marginTop: 8, color: "#2E241C", fontWeight: "800" },
});
