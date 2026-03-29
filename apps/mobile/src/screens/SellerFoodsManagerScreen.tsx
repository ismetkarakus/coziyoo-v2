import React, { useEffect, useState } from "react";
import { ActivityIndicator, Alert, FlatList, Platform, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import type { AuthSession } from "../utils/auth";
import { loadAuthSession, refreshAuthSession } from "../utils/auth";
import { actorRoleHeader } from "../utils/actorRole";
import { loadSettings } from "../utils/settings";
import { getSellerFoodsCache, setSellerFoodsCache } from "../utils/sellerFoodsCache";
import { theme } from "../theme/colors";

type Props = {
  auth: AuthSession;
  onBack: () => void;
  onOpenFoodsForm: (mode: "add" | "edit", foodId?: string, food?: SellerFood) => void;
  onAuthRefresh?: (session: AuthSession) => void;
};

type SellerFood = {
  id: string;
  name: string;
  cardSummary?: string | null;
  price: number;
  isActive: boolean;
  stock?: number;
  [key: string]: unknown;
};

export default function SellerFoodsManagerScreen({ auth, onBack, onOpenFoodsForm, onAuthRefresh }: Props) {
  const initialCache = getSellerFoodsCache() as SellerFood[] | null;
  const [apiUrl, setApiUrl] = useState("http://localhost:3000");
  const [currentAuth, setCurrentAuth] = useState(auth);
  const [foods, setFoods] = useState<SellerFood[]>(initialCache ?? []);
  const [loading, setLoading] = useState(!(initialCache && initialCache.length > 0));

  useEffect(() => setCurrentAuth(auth), [auth]);

  async function authedFetch(path: string, init?: RequestInit, baseUrl = apiUrl): Promise<Response> {
    const makeHeaders = (session: AuthSession): Record<string, string> => ({
      "Content-Type": "application/json",
      Authorization: `Bearer ${session.accessToken}`,
      ...actorRoleHeader(session, "seller"),
      ...(init?.headers as Record<string, string> | undefined),
    });

    const headers = makeHeaders(currentAuth);
    let res = await fetch(`${baseUrl}${path}`, { ...init, headers });
    if (res.status !== 401) return res;

    const persisted = await loadAuthSession();
    if (persisted && persisted.userId === currentAuth.userId && persisted.accessToken !== currentAuth.accessToken) {
      setCurrentAuth(persisted);
      onAuthRefresh?.(persisted);
      res = await fetch(`${baseUrl}${path}`, { ...init, headers: makeHeaders(persisted) });
      if (res.status !== 401) return res;
    }

    const refreshed = await refreshAuthSession(baseUrl, persisted && persisted.userId === currentAuth.userId ? persisted : currentAuth);
    if (!refreshed) return res;
    setCurrentAuth(refreshed);
    onAuthRefresh?.(refreshed);
    return fetch(`${baseUrl}${path}`, {
      ...init,
      headers: makeHeaders(refreshed),
    });
  }

  async function loadFoods(options?: { silent?: boolean }) {
    if (!options?.silent || foods.length === 0) setLoading(true);
    try {
      const settings = await loadSettings();
      setApiUrl(settings.apiUrl);
      const res = await authedFetch("/v1/seller/foods", undefined, settings.apiUrl);
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error?.message ?? "Yemekler yüklenemedi");
      const list: SellerFood[] = Array.isArray(json?.data) ? json.data.map((item: any) => ({
        ...item,
        id: String(item.id),
        name: String(item.name ?? ""),
        cardSummary: typeof item.cardSummary === "string" ? item.cardSummary : null,
        price: Number(item.price ?? 0),
        isActive: Boolean(item.isActive),
        stock: Number(item.stock ?? 0),
      })) : [];
      setFoods(list);
      setSellerFoodsCache(list as unknown as Record<string, unknown>[]);
    } catch (e) {
      const cache = getSellerFoodsCache();
      if (!cache || cache.length === 0) {
        Alert.alert("Hata", e instanceof Error ? e.message : "Yemekler yüklenemedi");
      }
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    const cache = getSellerFoodsCache();
    void loadFoods({ silent: Boolean(cache && cache.length > 0) });
  }, []);

  return (
    <View style={styles.container}>
      <View style={styles.headerRow}>
        <TouchableOpacity onPress={onBack} style={styles.backBtn}>
          <Ionicons name="chevron-back" size={24} color={theme.text} />
        </TouchableOpacity>
        <TouchableOpacity style={styles.addBtn} activeOpacity={0.85} onPress={() => onOpenFoodsForm("add")}>
          <Text style={styles.addBtnText}>Yemek Ekle</Text>
        </TouchableOpacity>
      </View>
      <Text style={styles.pageTitle}>Yemek Düzenle</Text>

      <FlatList
        data={foods}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.listContent}
        ListHeaderComponent={
          loading ? (
            <View style={styles.inlineLoading}>
              <ActivityIndicator size="small" color="#3F855C" />
              <Text style={styles.inlineLoadingText}>Yemekler hazırlanıyor...</Text>
            </View>
          ) : null
        }
        renderItem={({ item }) => (
          <TouchableOpacity style={styles.card} activeOpacity={0.82} onPress={() => onOpenFoodsForm("edit", item.id, item)}>
            <View style={styles.rowTop}>
              <Text style={styles.name}>{item.name}</Text>
              <Text style={[styles.badge, item.isActive ? styles.badgeActive : styles.badgePassive]}>
                {item.isActive ? "Aktif" : "Pasif"}
              </Text>
            </View>
            <Text style={styles.summary}>{item.cardSummary || "Özet yok"}</Text>
            <View style={styles.rowBottom}>
              <Text style={styles.price}>{item.price.toFixed(2)} TL</Text>
              <Text style={styles.stock}>Stok: {item.stock ?? 0}</Text>
            </View>
            <Text style={styles.editHint}>Yemek Düzenle</Text>
          </TouchableOpacity>
        )}
        ListEmptyComponent={
          !loading ? (
            <View style={styles.emptyCard}>
              <Text style={styles.emptyTitle}>Henüz yemek yok</Text>
              <Text style={styles.emptySub}>Yemek eklediğinde burada göreceksin.</Text>
            </View>
          ) : null
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#F7F4EF" },
  headerRow: {
    alignItems: "center",
    justifyContent: "center",
    paddingTop: Platform.OS === "ios" ? 56 : 16,
    paddingHorizontal: 16,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: "#E6DED1",
    backgroundColor: "#F7F4EF",
    position: "relative",
  },
  backBtn: {
    position: "absolute",
    left: 16,
    top: Platform.OS === "ios" ? 56 : 16,
    width: 40,
    height: 40,
    alignItems: "center",
    justifyContent: "center",
  },
  addBtn: {
    height: 36,
    borderRadius: 999,
    backgroundColor: "#3F855C",
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 14,
  },
  addBtnText: { color: "#fff", fontWeight: "800", fontSize: 13 },
  pageTitle: {
    color: "#2E241C",
    fontWeight: "900",
    fontSize: 27,
    textAlign: "center",
    marginTop: 8,
    marginBottom: 2,
  },
  center: { flex: 1, alignItems: "center", justifyContent: "center" },
  inlineLoading: { flexDirection: "row", alignItems: "center", gap: 8, paddingVertical: 8, paddingHorizontal: 4 },
  inlineLoadingText: { color: "#6C6055", fontWeight: "600" },
  listContent: { padding: 14, gap: 10, paddingBottom: 24 },
  card: { backgroundColor: "#fff", borderRadius: 12, borderWidth: 1, borderColor: "#E5DDCF", padding: 12, gap: 6 },
  rowTop: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  name: { color: "#2E241C", fontWeight: "800", fontSize: 16, flex: 1, paddingRight: 8 },
  badge: { borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4, fontSize: 11, fontWeight: "700", overflow: "hidden" },
  badgeActive: { color: "#2F6D49", backgroundColor: "#EAF4EE" },
  badgePassive: { color: "#7C6A58", backgroundColor: "#F3ECE5" },
  summary: { color: "#6C6055", fontSize: 13 },
  rowBottom: { flexDirection: "row", justifyContent: "space-between", marginTop: 2 },
  price: { color: "#2E241C", fontWeight: "800" },
  stock: { color: "#6C6055", fontWeight: "600" },
  editHint: { color: "#6C6055", fontSize: 12, fontWeight: "700", marginTop: 6 },
  emptyCard: { backgroundColor: "#fff", borderRadius: 12, borderWidth: 1, borderColor: "#E5DDCF", padding: 14 },
  emptyTitle: { color: "#2E241C", fontSize: 16, fontWeight: "800" },
  emptySub: { color: "#6C6055", marginTop: 4 },
});
