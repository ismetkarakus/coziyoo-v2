import React, { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import type { AuthSession } from "../utils/auth";
import { refreshAuthSession } from "../utils/auth";
import { actorRoleHeader } from "../utils/actorRole";
import { loadSettings } from "../utils/settings";
import { theme } from "../theme/colors";

type Props = {
  auth: AuthSession;
  onAuthRefresh?: (session: AuthSession) => void;
  onOpenProfile: () => void;
  onOpenFoods: () => void;
  onOpenLots: () => void;
  onOpenOrders: () => void;
  onOpenSettings: () => void;
  onLogout: () => void;
  onSwitchToBuyer?: () => void;
};

type SellerProfileResponse = {
  data?: {
    status?: "incomplete" | "pending_review" | "active";
    displayName?: string | null;
    requirements?: Record<string, boolean>;
  };
};

type OrdersResponse = {
  data?: Array<{ id: string; sellerId: string; status: string }>;
};

export default function SellerHomeScreen({
  auth,
  onAuthRefresh,
  onOpenProfile,
  onOpenFoods,
  onOpenLots,
  onOpenOrders,
  onOpenSettings,
  onLogout,
  onSwitchToBuyer,
}: Props) {
  const [apiUrl, setApiUrl] = useState("http://localhost:3000");
  const [currentAuth, setCurrentAuth] = useState(auth);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState<"incomplete" | "pending_review" | "active">("incomplete");
  const [displayName, setDisplayName] = useState<string>("Usta");
  const [stats, setStats] = useState({ today: 0, preparing: 0, waiting: 0 });
  const [error, setError] = useState<string | null>(null);

  useEffect(() => setCurrentAuth(auth), [auth]);

  const isLocked = status === "incomplete";
  const statusText = useMemo(() => {
    if (status === "active") return "Aktif";
    if (status === "pending_review") return "İncelemede";
    return "Eksik";
  }, [status]);

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
    res = await fetch(`${baseUrl}${path}`, {
      headers: {
        ...headers,
        Authorization: `Bearer ${refreshed.accessToken}`,
        ...actorRoleHeader(refreshed, "seller"),
      },
    });
    return res;
  }

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const settings = await loadSettings();
      const baseUrl = settings.apiUrl;
      setApiUrl(baseUrl);
      const [profileRes, ordersRes] = await Promise.all([
        fetchWithAuth("/v1/seller/profile", baseUrl),
        fetchWithAuth("/v1/orders?page=1&pageSize=200", baseUrl),
      ]);
      const profileJson = (await profileRes.json()) as SellerProfileResponse;
      if (!profileRes.ok) throw new Error("Satıcı profili yüklenemedi");
      const sellerStatus = profileJson.data?.status ?? "incomplete";
      setStatus(sellerStatus);
      setDisplayName(profileJson.data?.displayName?.trim() || "Usta");

      if (ordersRes.ok) {
        const ordersJson = (await ordersRes.json()) as OrdersResponse;
        const todayKey = new Date().toISOString().slice(0, 10);
        const sellerOrders = (ordersJson.data ?? []).filter((order) => order.sellerId === currentAuth.userId);
        setStats({
          today: sellerOrders.filter((order: any) => String(order.createdAt ?? "").slice(0, 10) === todayKey).length,
          preparing: sellerOrders.filter((order) => order.status === "preparing").length,
          waiting: sellerOrders.filter((order) => order.status === "pending_seller_approval").length,
        });
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : "Satıcı paneli yüklenemedi");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <View style={styles.header}>
        <Text style={styles.title}>Merhaba {displayName}</Text>
        <Text style={styles.subtitle}>Satıcı panelin hazır. Durum: {statusText}</Text>
      </View>

      {loading ? (
        <ActivityIndicator size="large" color={theme.primary} />
      ) : (
        <>
          <View style={styles.statsRow}>
            <View style={styles.statCard}><Text style={styles.statValue}>{stats.today}</Text><Text style={styles.statLabel}>Bugünkü</Text></View>
            <View style={styles.statCard}><Text style={styles.statValue}>{stats.preparing}</Text><Text style={styles.statLabel}>Hazırlanıyor</Text></View>
            <View style={styles.statCard}><Text style={styles.statValue}>{stats.waiting}</Text><Text style={styles.statLabel}>Onay Bekliyor</Text></View>
          </View>

          {isLocked ? (
            <View style={styles.lockCard}>
              <Text style={styles.lockTitle}>Önce profili tamamla</Text>
              <Text style={styles.lockText}>Yemek ekleme, lot açma ve sipariş aksiyonları profil tamamlanınca açılır.</Text>
            </View>
          ) : null}

          <TouchableOpacity style={styles.actionBtn} onPress={onOpenProfile}><Text style={styles.actionText}>Satıcı Profili</Text></TouchableOpacity>
          <TouchableOpacity style={[styles.actionBtn, isLocked && styles.actionBtnDisabled]} disabled={isLocked} onPress={onOpenFoods}><Text style={styles.actionText}>Yemeklerim</Text></TouchableOpacity>
          <TouchableOpacity style={[styles.actionBtn, isLocked && styles.actionBtnDisabled]} disabled={isLocked} onPress={onOpenLots}><Text style={styles.actionText}>Lot / Stok</Text></TouchableOpacity>
          <TouchableOpacity style={[styles.actionBtn, isLocked && styles.actionBtnDisabled]} disabled={isLocked} onPress={onOpenOrders}><Text style={styles.actionText}>Sipariş Yönetimi</Text></TouchableOpacity>
          <TouchableOpacity style={styles.ghostBtn} onPress={onOpenSettings}><Text style={styles.ghostText}>Ayarlar</Text></TouchableOpacity>
          {onSwitchToBuyer ? (
            <TouchableOpacity style={styles.ghostBtn} onPress={onSwitchToBuyer}><Text style={styles.ghostText}>Alıcı Moduna Geç</Text></TouchableOpacity>
          ) : null}
          <TouchableOpacity style={styles.logoutBtn} onPress={onLogout}><Text style={styles.logoutText}>Çıkış yap</Text></TouchableOpacity>
          {!!error && <Text style={styles.error}>{error}</Text>}
        </>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#F7F4EF" },
  content: { padding: 16, paddingBottom: 36 },
  header: { marginBottom: 16 },
  title: { fontSize: 28, fontWeight: "800", color: "#2E241C" },
  subtitle: { marginTop: 6, fontSize: 14, color: "#6F6358" },
  statsRow: { flexDirection: "row", gap: 10, marginBottom: 12 },
  statCard: { flex: 1, backgroundColor: "#fff", borderRadius: 12, borderWidth: 1, borderColor: "#E6DED1", padding: 12, alignItems: "center" },
  statValue: { fontSize: 22, fontWeight: "800", color: "#2E241C" },
  statLabel: { fontSize: 12, color: "#6F6358", marginTop: 2 },
  lockCard: { backgroundColor: "#FFF5E9", borderColor: "#F0C995", borderWidth: 1, borderRadius: 12, padding: 12, marginBottom: 12 },
  lockTitle: { fontWeight: "700", color: "#7A4D1B" },
  lockText: { marginTop: 4, color: "#7A4D1B", fontSize: 13 },
  actionBtn: { backgroundColor: "#3F855C", borderRadius: 12, paddingVertical: 14, paddingHorizontal: 14, marginTop: 10 },
  actionBtnDisabled: { opacity: 0.45 },
  actionText: { color: "#fff", fontSize: 15, fontWeight: "700" },
  ghostBtn: { backgroundColor: "#fff", borderRadius: 12, borderWidth: 1, borderColor: "#E6DED1", paddingVertical: 12, paddingHorizontal: 14, marginTop: 10 },
  ghostText: { color: "#2E241C", fontSize: 14, fontWeight: "700" },
  logoutBtn: { backgroundColor: "#FBE9E8", borderRadius: 12, paddingVertical: 12, paddingHorizontal: 14, marginTop: 10 },
  logoutText: { color: "#9B2C2C", fontSize: 14, fontWeight: "700" },
  error: { marginTop: 10, color: "#B42318" },
});
