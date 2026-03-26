import React, { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Image, ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import type { AuthSession } from "../utils/auth";
import { refreshAuthSession } from "../utils/auth";
import { actorRoleHeader } from "../utils/actorRole";
import { loadSettings } from "../utils/settings";
import { theme } from "../theme/colors";
import ActionButton from "../components/ActionButton";

type Props = {
  auth: AuthSession;
  onAuthRefresh?: (session: AuthSession) => void;
  onOpenProfile: () => void;
  onOpenFoods: () => void;
  onOpenLots: () => void;
  onOpenOrders: () => void;
  onOpenMessages: () => void;
  onOpenReviews: () => void;
  onOpenCompliance: () => void;
  onOpenFinance: () => void;
  onOpenDirectory: () => void;
  onOpenV1Preview: () => void;
  onOpenSettings: () => void;
  onLogout: () => void;
  onSwitchToBuyer?: () => void;
};

type SellerProfileResponse = {
  data?: {
    status?: "incomplete" | "pending_review" | "active";
    displayName?: string | null;
    requirements?: {
      complianceRequiredCount?: number;
      complianceUploadedRequiredCount?: number;
    };
  };
};

type OrdersResponse = {
  data?: Array<{ id: string; sellerId: string; status: string; createdAt?: string }>;
};

type SellerFood = {
  id: string;
  name: string;
  cardSummary: string | null;
  price: number;
  stock: number;
  isActive: boolean;
  imageUrl: string | null;
};

type FinanceSummary = { totalNetEarnings: number };

export default function SellerHomeScreen({
  auth,
  onAuthRefresh,
  onOpenProfile,
  onOpenFoods,
  onOpenLots,
  onOpenOrders,
  onOpenMessages,
  onOpenReviews,
  onOpenCompliance,
  onOpenFinance,
  onOpenDirectory,
  onOpenV1Preview,
  onOpenSettings,
  onLogout,
  onSwitchToBuyer,
}: Props) {
  const [apiUrl, setApiUrl] = useState("http://localhost:3000");
  const [currentAuth, setCurrentAuth] = useState(auth);
  const [loading, setLoading] = useState(true);
  const [displayName, setDisplayName] = useState<string>("Usta");
  const [complianceRequiredCount, setComplianceRequiredCount] = useState(0);
  const [complianceUploadedRequiredCount, setComplianceUploadedRequiredCount] = useState(0);
  const [stats, setStats] = useState({ orders: 0, wallet: 0, messages: 0, rating: 4.8 });
  const [foods, setFoods] = useState<SellerFood[]>([]);
  const [foodTab, setFoodTab] = useState<"active" | "passive">("active");
  const [manualStock, setManualStock] = useState<Record<string, number>>({});
  const [error, setError] = useState<string | null>(null);

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
      headers: {
        ...headers,
        Authorization: `Bearer ${refreshed.accessToken}`,
        ...actorRoleHeader(refreshed, "seller"),
      },
    });
  }

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const settings = await loadSettings();
      const baseUrl = settings.apiUrl;
      setApiUrl(baseUrl);
      const sellerId = currentAuth.userId;

      const [profileRes, ordersRes, foodsRes, financeRes] = await Promise.all([
        fetchWithAuth("/v1/seller/profile", baseUrl),
        fetchWithAuth("/v1/orders?page=1&pageSize=200", baseUrl),
        fetchWithAuth("/v1/seller/foods", baseUrl),
        fetchWithAuth(`/v1/sellers/${sellerId}/finance/summary`, baseUrl),
      ]);

      const profileJson = (await profileRes.json()) as SellerProfileResponse;
      if (!profileRes.ok) throw new Error("Satıcı profili yüklenemedi");
      setDisplayName(profileJson.data?.displayName?.trim() || "Usta");
      setComplianceRequiredCount(Number(profileJson.data?.requirements?.complianceRequiredCount ?? 0));
      setComplianceUploadedRequiredCount(Number(profileJson.data?.requirements?.complianceUploadedRequiredCount ?? 0));

      let ordersCount = 0;
      if (ordersRes.ok) {
        const ordersJson = (await ordersRes.json()) as OrdersResponse;
        const sellerOrders = (ordersJson.data ?? []).filter((order) => order.sellerId === sellerId);
        ordersCount = sellerOrders.length;
      }

      let wallet = 0;
      if (financeRes.ok) {
        const financeJson = (await financeRes.json()) as { data?: FinanceSummary };
        wallet = Number(financeJson.data?.totalNetEarnings ?? 0);
      }

      if (foodsRes.ok) {
        const foodsJson = (await foodsRes.json()) as { data?: SellerFood[] };
        const nextFoods = Array.isArray(foodsJson.data) ? foodsJson.data : [];
        setFoods(nextFoods);
        const stockSeed: Record<string, number> = {};
        nextFoods.forEach((food) => { stockSeed[food.id] = Number(food.stock ?? 0); });
        setManualStock(stockSeed);
      }

      setStats({ orders: ordersCount, wallet, messages: 0, rating: 4.8 });
    } catch (e) {
      setError(e instanceof Error ? e.message : "Satıcı paneli yüklenemedi");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  const filteredFoods = useMemo(
    () => foods.filter((food) => (foodTab === "active" ? food.isActive : !food.isActive)),
    [foods, foodTab],
  );

  function adjustManualStock(foodId: string, delta: number) {
    setManualStock((prev) => ({
      ...prev,
      [foodId]: Math.max(0, (prev[foodId] ?? 0) + delta),
    }));
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <View style={styles.topBar}>
        <Text style={styles.pageTitle}>Satıcı Paneli</Text>
      </View>

      {loading ? (
        <ActivityIndicator size="large" color={theme.primary} style={styles.loader} />
      ) : (
        <>
          <View style={styles.profileBand}>
            <View style={styles.avatarWrap}>
              <View style={styles.avatarFallback}>
                <Text style={styles.avatarText}>{displayName.slice(0, 1).toUpperCase()}</Text>
              </View>
            </View>
            <View style={styles.profileCenter}>
              <Text style={styles.sellerName}>{displayName}</Text>
              <Text style={styles.stars}>★ ★ ★ ★ ☆</Text>
            </View>
            <TouchableOpacity style={styles.profileBtn} onPress={onOpenProfile}>
              <Text style={styles.profileBtnText}>Profili Düzenle</Text>
            </TouchableOpacity>
          </View>

          <View style={styles.statsRow}>
            <View style={styles.statCard}><Text style={styles.statValue}>{stats.orders}</Text><Text style={styles.statLabel}>Sipariş</Text></View>
            <View style={styles.statCard}><Text style={[styles.statValue, styles.money]}>{`₺${Math.round(stats.wallet)}`}</Text><Text style={styles.statLabel}>Cüzdan</Text></View>
            <View style={styles.statCard}><Text style={styles.statValue}>{stats.messages}</Text><Text style={styles.statLabel}>Mesaj</Text></View>
            <View style={styles.statCard}><Text style={[styles.statValue, styles.rating]}>{stats.rating.toFixed(1)}</Text><Text style={styles.statLabel}>Puan</Text></View>
          </View>

          <TouchableOpacity style={styles.addMealBtn} onPress={onOpenFoods} activeOpacity={0.85}>
            <Text style={styles.addMealText}>Yemek Ekle</Text>
          </TouchableOpacity>

          <View style={styles.tabsRow}>
            <TouchableOpacity style={[styles.tab, foodTab === "active" && styles.tabActive]} onPress={() => setFoodTab("active")}>
              <Text style={[styles.tabText, foodTab === "active" && styles.tabTextActive]}>Aktif Yemekler ({foods.filter((x) => x.isActive).length})</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.tab, foodTab === "passive" && styles.tabActive]} onPress={() => setFoodTab("passive")}>
              <Text style={[styles.tabText, foodTab === "passive" && styles.tabTextActive]}>Pasif Yemekler ({foods.filter((x) => !x.isActive).length})</Text>
            </TouchableOpacity>
          </View>

          {filteredFoods.map((food) => (
            <View style={styles.foodCard} key={food.id}>
              <TouchableOpacity style={styles.editIconWrap} onPress={onOpenFoods}>
                <Text style={styles.editIconText}>✎</Text>
              </TouchableOpacity>
              <View style={styles.foodRow}>
                {food.imageUrl ? (
                  <Image source={{ uri: food.imageUrl }} style={styles.foodImage} />
                ) : (
                  <View style={styles.foodImagePlaceholder}><Text style={styles.foodImagePlaceholderText}>IMG</Text></View>
                )}
                <View style={styles.foodInfo}>
                  <Text style={styles.foodName}>{food.name}</Text>
                  <Text style={styles.foodMeta}>Stok: {manualStock[food.id] ?? food.stock}</Text>
                  <Text style={styles.foodDesc} numberOfLines={2}>{food.cardSummary || "Yemeğin kısa özeti burada görünür."}</Text>
                  <View style={styles.tagsRow}>
                    <Text style={styles.tagPill}>Satışta</Text>
                    <Text style={styles.tagPill}>Gel Al</Text>
                    <Text style={styles.tagPill}>Teslimat</Text>
                  </View>
                  <Text style={styles.manualTitle}>Manuel stok kontrolü</Text>
                  <View style={styles.stockRow}>
                    <TouchableOpacity style={styles.stockBtn} onPress={() => adjustManualStock(food.id, -1)}>
                      <Text style={styles.stockBtnText}>−</Text>
                    </TouchableOpacity>
                    <Text style={styles.stockValue}>{manualStock[food.id] ?? food.stock}</Text>
                    <TouchableOpacity style={styles.stockBtn} onPress={() => adjustManualStock(food.id, 1)}>
                      <Text style={styles.stockBtnText}>＋</Text>
                    </TouchableOpacity>
                  </View>
                </View>
                <Text style={styles.foodPrice}>₺{Number(food.price ?? 0).toFixed(0)}</Text>
              </View>
              <View style={styles.foodActions}>
                <ActionButton label="Düzenle" onPress={onOpenFoods} variant="soft" size="sm" />
                <ActionButton label={food.isActive ? "Satışı Kapat" : "Yayına Al"} onPress={onOpenFoods} variant={food.isActive ? "danger" : "outline"} size="sm" />
              </View>
            </View>
          ))}

          <View style={styles.bottomActions}>
            <ActionButton label="Sipariş Yönetimi" onPress={onOpenOrders} fullWidth />
            <ActionButton label="Müşteri Mesajları" onPress={onOpenMessages} fullWidth variant="soft" />
            <ActionButton label="Usta Yorumları" onPress={onOpenReviews} fullWidth variant="soft" />
            <ActionButton label="Lot / Stok" onPress={onOpenLots} fullWidth variant="soft" />
            <ActionButton label="Belgeler ve Uyum" onPress={onOpenCompliance} fullWidth variant="soft" />
            <ActionButton label="Finans" onPress={onOpenFinance} fullWidth variant="soft" />
            <ActionButton label="Tüm Satıcılar" onPress={onOpenDirectory} fullWidth variant="outline" />
            <ActionButton label="Ayarlar" onPress={onOpenSettings} fullWidth variant="outline" />
            {onSwitchToBuyer ? <ActionButton label="Alıcı Moduna Geç" onPress={onSwitchToBuyer} fullWidth variant="outline" /> : null}
            <ActionButton label="Çıkış Yap" onPress={onLogout} fullWidth variant="danger" />
          </View>

          <View style={styles.complianceHint}>
            <Text style={styles.complianceHintText}>Belge durumu: {complianceUploadedRequiredCount}/{complianceRequiredCount}</Text>
          </View>

          {error ? <Text style={styles.error}>{error}</Text> : null}
        </>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#EDECE8" },
  content: { padding: 14, paddingTop: 18, paddingBottom: 30 },
  topBar: { alignItems: "center", marginBottom: 10 },
  pageTitle: { fontSize: 30, fontWeight: "800", color: "#3A2B20" },
  loader: { marginTop: 40 },

  profileBand: {
    backgroundColor: "#F4F5F2",
    borderRadius: 16,
    padding: 12,
    borderWidth: 1,
    borderColor: "#D0D8CF",
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 10,
  },
  avatarWrap: { marginRight: 12 },
  avatarFallback: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: "#9EB1A2",
    alignItems: "center",
    justifyContent: "center",
  },
  avatarText: { color: "#fff", fontWeight: "800", fontSize: 22 },
  profileCenter: { flex: 1 },
  sellerName: { fontSize: 23, fontWeight: "800", color: "#2F2D2B" },
  stars: { color: "#E4931B", marginTop: 2 },
  profileBtn: { backgroundColor: "#8EA18F", borderRadius: 14, paddingHorizontal: 10, paddingVertical: 7 },
  profileBtnText: { color: "#fff", fontWeight: "700", fontSize: 12 },

  statsRow: { flexDirection: "row", gap: 8, marginBottom: 10 },
  statCard: {
    flex: 1,
    backgroundColor: "#fff",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#DCD9D3",
    paddingVertical: 8,
    alignItems: "center",
  },
  statValue: { fontSize: 20, fontWeight: "800", color: "#748B7A" },
  statLabel: { fontSize: 12, color: "#6A6259" },
  money: { color: "#21B15A" },
  rating: { color: "#E5890A" },

  addMealBtn: {
    backgroundColor: "#8EA18F",
    borderRadius: 10,
    paddingVertical: 11,
    alignItems: "center",
    marginBottom: 10,
  },
  addMealText: { color: "#fff", fontWeight: "800", fontSize: 15 },

  tabsRow: { flexDirection: "row", borderBottomWidth: 1, borderBottomColor: "#D4D0C9", marginBottom: 8 },
  tab: { flex: 1, paddingVertical: 8, alignItems: "center" },
  tabActive: { borderBottomWidth: 2, borderBottomColor: "#8EA18F" },
  tabText: { fontWeight: "700", color: "#9A9388", fontSize: 13 },
  tabTextActive: { color: "#4D443B" },

  foodCard: {
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: "#DDD9D2",
    borderRadius: 14,
    padding: 10,
    marginBottom: 10,
    position: "relative",
  },
  editIconWrap: {
    position: "absolute",
    right: 10,
    top: 10,
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: "#ECEAE5",
    alignItems: "center",
    justifyContent: "center",
    zIndex: 2,
  },
  editIconText: { color: "#7D7A73", fontSize: 12, fontWeight: "700" },
  foodRow: { flexDirection: "row", alignItems: "flex-start", gap: 10 },
  foodImage: { width: 64, height: 64, borderRadius: 10, backgroundColor: "#EAE6DF" },
  foodImagePlaceholder: { width: 64, height: 64, borderRadius: 10, backgroundColor: "#EFEDEA", alignItems: "center", justifyContent: "center" },
  foodImagePlaceholderText: { color: "#C2BCB2", fontWeight: "700" },
  foodInfo: { flex: 1 },
  foodName: { fontSize: 17, fontWeight: "800", color: "#2F2D2B" },
  foodMeta: { color: "#7A7368", marginTop: 2 },
  foodDesc: { marginTop: 6, color: "#6A6259" },
  tagsRow: { flexDirection: "row", gap: 6, marginTop: 8, flexWrap: "wrap" },
  tagPill: { paddingHorizontal: 8, paddingVertical: 3, borderRadius: 10, backgroundColor: "#EAF2EA", color: "#3E845B", fontSize: 11, fontWeight: "700" },
  manualTitle: { marginTop: 8, color: "#7A7368", fontSize: 12 },
  stockRow: { flexDirection: "row", alignItems: "center", gap: 10, marginTop: 5 },
  stockBtn: { width: 24, height: 24, borderRadius: 12, borderWidth: 1, borderColor: "#CFC8BC", alignItems: "center", justifyContent: "center", backgroundColor: "#F9F7F3" },
  stockBtnText: { color: "#5B534A", fontSize: 14, fontWeight: "700" },
  stockValue: { minWidth: 18, textAlign: "center", color: "#2F2D2B", fontWeight: "700" },
  foodPrice: { fontSize: 22, fontWeight: "800", color: "#8CA08D" },
  foodActions: { marginTop: 8, flexDirection: "row", gap: 8 },

  bottomActions: { marginTop: 8, gap: 8 },
  complianceHint: { marginTop: 10, alignItems: "center" },
  complianceHintText: { color: "#6D6458", fontWeight: "700" },
  error: { marginTop: 12, color: "#B42318", textAlign: "center" },
});
