import React, { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Alert, FlatList, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
import type { AuthSession } from "../utils/auth";
import { refreshAuthSession } from "../utils/auth";
import { actorRoleHeader } from "../utils/actorRole";
import { loadSettings } from "../utils/settings";
import { theme } from "../theme/colors";
import ScreenHeader from "../components/ScreenHeader";
import StatusBadge from "../components/StatusBadge";

type Props = {
  auth: AuthSession;
  onBack: () => void;
  onOpenOrder: (orderId: string) => void;
  onAuthRefresh?: (session: AuthSession) => void;
};

type SellerOrder = {
  id: string;
  sellerId?: string | null;
  orderNo?: string | null;
  buyerName?: string | null;
  primaryFoodName?: string | null;
  itemCount?: number | null;
  status: string;
  totalPrice: number;
  createdAt?: string;
};

type StatusFilter = "all" | "paid" | "preparing" | "ready" | "in_delivery" | "delivered" | "completed" | "cancelled";

function formatOrderDate(iso: string | undefined): string {
  if (!iso) return "-";
  const normalized = iso.trim().replace(" ", "T").replace(/(\.\d+)?([+-]\d{2})$/, "$1$2:00");
  const d = new Date(normalized);
  if (isNaN(d.getTime())) return "-";
  const months = ["Oca", "Şub", "Mar", "Nis", "May", "Haz", "Tem", "Ağu", "Eyl", "Eki", "Kas", "Ara"];
  const h = d.getHours().toString().padStart(2, "0");
  const m = d.getMinutes().toString().padStart(2, "0");
  return `${d.getDate()} ${months[d.getMonth()]} ${d.getFullYear()} ${h}:${m}`;
}

function parseDateInput(value: string): Date | null {
  const raw = value.trim();
  if (!raw) return null;
  const parts = raw.split("-");
  if (parts.length !== 3) return null;
  const [y, m, d] = parts.map((x) => Number(x));
  if (!Number.isInteger(y) || !Number.isInteger(m) || !Number.isInteger(d)) return null;
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  const date = new Date(y, m - 1, d);
  if (Number.isNaN(date.getTime())) return null;
  return date;
}

export default function SellerOrdersScreen({ auth, onBack, onOpenOrder, onAuthRefresh }: Props) {
  const [apiUrl, setApiUrl] = useState("http://localhost:3000");
  const [currentAuth, setCurrentAuth] = useState(auth);
  const [loading, setLoading] = useState(true);
  const [orders, setOrders] = useState<SellerOrder[]>([]);
  const [errorText, setErrorText] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");

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
        const fallbackRes = await authedFetch("/v1/orders?page=1&pageSize=200&role=seller", baseUrl);
        const fallbackJson = await fallbackRes.json();
        if (fallbackRes.ok && Array.isArray(fallbackJson?.data)) {
          const fromAll = fallbackJson.data.filter((row: SellerOrder & { sellerId?: string }) => row.sellerId === currentAuth.userId);
          sellerOrders = fromAll.length > 0 ? fromAll : fallbackJson.data;
        }
      }

      setOrders(
        sellerOrders.filter((row: SellerOrder) =>
          ["paid", "preparing", "ready", "in_delivery", "delivered", "completed", "cancelled"].includes(row.status),
        ),
      );
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

  const filteredOrders = useMemo(() => {
    const from = parseDateInput(fromDate);
    const to = parseDateInput(toDate);
    const toEnd = to ? new Date(to.getFullYear(), to.getMonth(), to.getDate(), 23, 59, 59, 999) : null;

    return orders.filter((order) => {
      if (statusFilter !== "all" && order.status !== statusFilter) return false;
      if (!from && !toEnd) return true;
      const createdAt = order.createdAt ? new Date(order.createdAt) : null;
      if (!createdAt || Number.isNaN(createdAt.getTime())) return false;
      if (from && createdAt < from) return false;
      if (toEnd && createdAt > toEnd) return false;
      return true;
    });
  }, [orders, statusFilter, fromDate, toDate]);

  return (
    <View style={styles.container}>
      <ScreenHeader title="Sipariş Yönetimi" onBack={onBack} />
      <View style={styles.filtersCard}>
        <Text style={styles.filtersTitle}>Filtreler</Text>
        <View style={styles.filterRow}>
          <TextInput
            value={fromDate}
            onChangeText={setFromDate}
            placeholder="Başlangıç (YYYY-MM-DD)"
            placeholderTextColor="#9A8C82"
            style={styles.dateInput}
          />
          <TextInput
            value={toDate}
            onChangeText={setToDate}
            placeholder="Bitiş (YYYY-MM-DD)"
            placeholderTextColor="#9A8C82"
            style={styles.dateInput}
          />
        </View>
      </View>
      {loading ? (
        <ActivityIndicator size="large" color={theme.primary} />
      ) : (
        <>
          {filteredOrders.length === 0 ? (
            <View style={styles.emptyWrap}>
              <Text style={styles.emptyTitle}>Filtreye uygun sipariş bulunamadı</Text>
              <Text style={styles.emptySub}>
                {errorText
                  ? "Bağlantıyı kontrol edip tekrar yenile."
                  : "Tarih aralığını veya durum seçimini değiştirip tekrar dene."}
              </Text>
            </View>
          ) : (
            <FlatList
              data={filteredOrders}
              keyExtractor={(item) => item.id}
              contentContainerStyle={{ padding: 14, gap: 10 }}
              renderItem={({ item }) => (
                <TouchableOpacity style={styles.card} onPress={() => onOpenOrder(item.id)}>
                  <View style={styles.cardHeader}>
                    <Text style={styles.orderNo}>{item.orderNo || "#" + item.id.slice(0, 8).toUpperCase()}</Text>
                    <StatusBadge status={item.status} size="sm" />
                  </View>
                  {item.primaryFoodName ? (
                    <Text style={styles.foodName}>
                      {item.primaryFoodName}{item.itemCount && item.itemCount > 1 ? ` +${item.itemCount - 1}` : ""}
                    </Text>
                  ) : null}
                  <Text style={styles.meta}>Alıcı: {item.buyerName || "-"}</Text>
                  {item.createdAt ? <Text style={styles.meta}>{formatOrderDate(item.createdAt)}</Text> : null}
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
  filtersCard: {
    marginHorizontal: 14,
    marginBottom: 8,
    backgroundColor: "#fff",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#E5DDCF",
    padding: 10,
    gap: 8,
  },
  filtersTitle: { color: "#2E241C", fontWeight: "800", fontSize: 14 },
  filterRow: { flexDirection: "row", gap: 8 },
  dateInput: {
    flex: 1,
    borderWidth: 1,
    borderColor: "#E0D6C9",
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 9,
    color: "#2E241C",
    backgroundColor: "#FCFAF7",
    fontSize: 13,
    fontWeight: "500",
  },
  card: { backgroundColor: "#fff", borderRadius: 12, borderWidth: 1, borderColor: "#E5DDCF", padding: 12 },
  cardHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 4 },
  orderNo: { color: "#2E241C", fontWeight: "800", fontSize: 16 },
  foodName: { color: "#2E241C", fontWeight: "700", fontSize: 14, marginTop: 4 },
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
