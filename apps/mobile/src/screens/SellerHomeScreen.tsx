import React, { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, ScrollView, StyleSheet, Text, TouchableOpacity, View } from "react-native";
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
  onOpenCompliance: () => void;
  onOpenFinance: () => void;
  onOpenSettings: () => void;
  onLogout: () => void;
  onSwitchToBuyer?: () => void;
};

type SellerProfileResponse = {
  data?: {
    status?: "incomplete" | "pending_review" | "active";
    displayName?: string | null;
    requirements?: {
      canOperate?: boolean;
      complianceRequiredCount?: number;
      complianceUploadedRequiredCount?: number;
      complianceMissingRequiredCount?: number;
    };
  };
};

type OrdersResponse = {
  data?: Array<{ id: string; sellerId: string; status: string; createdAt?: string }>;
};

export default function SellerHomeScreen({
  auth,
  onAuthRefresh,
  onOpenProfile,
  onOpenFoods,
  onOpenLots,
  onOpenOrders,
  onOpenCompliance,
  onOpenFinance,
  onOpenSettings,
  onLogout,
  onSwitchToBuyer,
}: Props) {
  const [apiUrl, setApiUrl] = useState("http://localhost:3000");
  const [currentAuth, setCurrentAuth] = useState(auth);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState<"incomplete" | "pending_review" | "active">("incomplete");
  const [displayName, setDisplayName] = useState<string>("Usta");
  const [canOperate, setCanOperate] = useState(false);
  const [complianceRequiredCount, setComplianceRequiredCount] = useState(0);
  const [complianceUploadedRequiredCount, setComplianceUploadedRequiredCount] = useState(0);
  const [stats, setStats] = useState({ today: 0, preparing: 0, waiting: 0 });
  const [error, setError] = useState<string | null>(null);

  useEffect(() => setCurrentAuth(auth), [auth]);

  const isLocked = !canOperate;
  const statusText = useMemo(() => {
    if (status === "active") return "Aktif ✓";
    if (status === "pending_review") return "İncelemede";
    return "Eksik — profili tamamla";
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
      const [profileRes, ordersRes] = await Promise.all([
        fetchWithAuth("/v1/seller/profile", baseUrl),
        fetchWithAuth("/v1/orders?page=1&pageSize=200", baseUrl),
      ]);
      const profileJson = (await profileRes.json()) as SellerProfileResponse;
      if (!profileRes.ok) throw new Error("Satıcı profili yüklenemedi");
      const sellerStatus = profileJson.data?.status ?? "incomplete";
      setStatus(sellerStatus);
      setDisplayName(profileJson.data?.displayName?.trim() || "Usta");
      setCanOperate(Boolean(profileJson.data?.requirements?.canOperate));
      setComplianceRequiredCount(Number(profileJson.data?.requirements?.complianceRequiredCount ?? 0));
      setComplianceUploadedRequiredCount(Number(profileJson.data?.requirements?.complianceUploadedRequiredCount ?? 0));

      if (ordersRes.ok) {
        const ordersJson = (await ordersRes.json()) as OrdersResponse;
        const todayKey = new Date().toISOString().slice(0, 10);
        const sellerOrders = (ordersJson.data ?? []).filter((order) => order.sellerId === currentAuth.userId);
        setStats({
          today: sellerOrders.filter((order) => String(order.createdAt ?? "").slice(0, 10) === todayKey).length,
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
        <Text style={styles.title}>Merhaba, {displayName} 👋</Text>
        <Text style={[styles.statusText, status === "active" ? styles.statusActive : styles.statusPending]}>
          {statusText}
        </Text>
      </View>

      {loading ? (
        <ActivityIndicator size="large" color={theme.primary} style={styles.loader} />
      ) : (
        <>
          <View style={styles.statsRow}>
            <View style={styles.statCard}>
              <Text style={styles.statValue}>{stats.today}</Text>
              <Text style={styles.statLabel}>Bugünkü</Text>
            </View>
            <View style={styles.statCard}>
              <Text style={styles.statValue}>{stats.preparing}</Text>
              <Text style={styles.statLabel}>Hazırlanıyor</Text>
            </View>
            <View style={styles.statCard}>
              <Text style={styles.statValue}>{stats.waiting}</Text>
              <Text style={styles.statLabel}>Onay Bekliyor</Text>
            </View>
          </View>

          <TouchableOpacity style={styles.complianceCard} activeOpacity={0.85} onPress={onOpenCompliance}>
            <Text style={styles.complianceTitle}>Belge Durumu</Text>
            <Text style={styles.complianceText}>
              Tamamlanan: {complianceUploadedRequiredCount}/{complianceRequiredCount}
            </Text>
            <Text style={styles.complianceAction}>Belgeleri aç →</Text>
          </TouchableOpacity>

          {isLocked ? (
            <View style={styles.lockCard}>
              <Text style={styles.lockTitle}>Önce profili tamamla</Text>
              <Text style={styles.lockText}>
                Lütfen profilini ve zorunlu belgelerini tamamla.
              </Text>
              <View style={styles.lockCtas}>
                <TouchableOpacity style={styles.lockCtaPrimary} onPress={onOpenProfile}>
                  <Text style={styles.lockCtaPrimaryText}>Profili Düzenle</Text>
                </TouchableOpacity>
                <TouchableOpacity style={styles.lockCtaSecondary} onPress={onOpenCompliance}>
                  <Text style={styles.lockCtaSecondaryText}>Belgeleri Tamamla</Text>
                </TouchableOpacity>
              </View>
            </View>
          ) : null}

          <View style={styles.actions}>
            <ActionButton label="Satıcı Profili" onPress={onOpenProfile} fullWidth />
            <ActionButton label="Yemeklerim" onPress={onOpenFoods} disabled={isLocked} fullWidth />
            <ActionButton label="Lot / Stok" onPress={onOpenLots} disabled={isLocked} fullWidth />
            <ActionButton label="Sipariş Yönetimi" onPress={onOpenOrders} disabled={isLocked} fullWidth />
            <ActionButton label="Compliance" onPress={onOpenCompliance} fullWidth />
            <ActionButton label="Finans / Payout" onPress={onOpenFinance} disabled={isLocked} fullWidth />
            <ActionButton label="Ayarlar" onPress={onOpenSettings} variant="soft" fullWidth />
            {onSwitchToBuyer ? (
              <ActionButton label="Alıcı Moduna Geç" onPress={onSwitchToBuyer} variant="outline" fullWidth />
            ) : null}
            <ActionButton label="Çıkış Yap" onPress={onLogout} variant="danger" fullWidth />
          </View>

          {error ? <Text style={styles.error}>{error}</Text> : null}
        </>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#F7F4EF" },
  content: { padding: 16, paddingTop: 60, paddingBottom: 36 },
  header: { marginBottom: 16 },
  title: { fontSize: 26, fontWeight: "800", color: "#2E241C" },
  statusText: { marginTop: 6, fontSize: 13, fontWeight: "700" },
  statusActive: { color: "#2E6B44" },
  statusPending: { color: "#7A4D1B" },
  loader: { marginTop: 40 },
  statsRow: { flexDirection: "row", gap: 10, marginBottom: 12 },
  statCard: { flex: 1, backgroundColor: "#fff", borderRadius: 12, borderWidth: 1, borderColor: "#E6DED1", padding: 12, alignItems: "center" },
  statValue: { fontSize: 22, fontWeight: "800", color: "#2E241C" },
  statLabel: { fontSize: 12, color: "#6F6358", marginTop: 2 },
  complianceCard: {
    backgroundColor: "#EFF6F1",
    borderColor: "#CFE2D5",
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
    marginBottom: 12,
  },
  complianceTitle: { color: "#2E6B44", fontWeight: "800" },
  complianceText: { marginTop: 4, color: "#2E6B44" },
  complianceAction: { marginTop: 6, color: "#2E6B44", fontWeight: "700" },
  lockCard: { backgroundColor: "#FFF5E9", borderColor: "#F0C995", borderWidth: 1, borderRadius: 12, padding: 12, marginBottom: 12 },
  lockTitle: { fontWeight: "700", color: "#7A4D1B" },
  lockText: { marginTop: 4, color: "#7A4D1B", fontSize: 13 },
  lockCtas: { flexDirection: "row", gap: 8, marginTop: 10 },
  lockCtaPrimary: { flex: 1, backgroundColor: "#7A4D1B", borderRadius: 10, paddingVertical: 10, alignItems: "center" },
  lockCtaPrimaryText: { color: "#fff", fontWeight: "700", fontSize: 12 },
  lockCtaSecondary: { flex: 1, backgroundColor: "#fff", borderColor: "#E2B782", borderWidth: 1, borderRadius: 10, paddingVertical: 10, alignItems: "center" },
  lockCtaSecondaryText: { color: "#7A4D1B", fontWeight: "700", fontSize: 12 },
  actions: { gap: 10 },
  error: { marginTop: 12, color: "#B42318", textAlign: "center" },
});
