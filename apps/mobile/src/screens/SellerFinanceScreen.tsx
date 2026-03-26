import React, { useEffect, useState } from "react";
import { ActivityIndicator, Alert, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
import type { AuthSession } from "../utils/auth";
import { apiRequest } from "../utils/api";
import { theme } from "../theme/colors";
import ScreenHeader from "../components/ScreenHeader";
import ActionButton from "../components/ActionButton";

type Props = {
  auth: AuthSession;
  onBack: () => void;
  onAuthRefresh?: (session: AuthSession) => void;
};

type FinanceSummary = { totalSellingAmount: number; totalCommission: number; totalNetEarnings: number };
type FinanceBalance = { availableBalance: number; pendingPayoutAmount: number; currency: string };
type PayoutRow = { batchId: string; status: string; totalAmount: number; payoutDate: string };

export default function SellerFinanceScreen({ auth, onBack, onAuthRefresh }: Props) {
  const [currentAuth, setCurrentAuth] = useState(auth);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [tab, setTab] = useState<"overview" | "transactions" | "withdraw">("overview");
  const [summary, setSummary] = useState<FinanceSummary | null>(null);
  const [balance, setBalance] = useState<FinanceBalance | null>(null);
  const [payouts, setPayouts] = useState<PayoutRow[]>([]);
  const [iban, setIban] = useState("");
  const [holder, setHolder] = useState("");
  const [withdrawAmount, setWithdrawAmount] = useState("0");

  useEffect(() => setCurrentAuth(auth), [auth]);

  function handleRefresh(session: AuthSession) {
    setCurrentAuth(session);
    onAuthRefresh?.(session);
  }

  async function loadData() {
    setLoading(true);
    try {
      const sellerId = currentAuth.userId;
      const [summaryRes, balanceRes, payoutsRes] = await Promise.all([
        apiRequest<FinanceSummary>(`/v1/sellers/${sellerId}/finance/summary`, currentAuth, { actorRole: "seller" }, handleRefresh),
        apiRequest<FinanceBalance>(`/v1/sellers/${sellerId}/finance/balance`, currentAuth, { actorRole: "seller" }, handleRefresh),
        apiRequest<PayoutRow[]>(`/v1/sellers/${sellerId}/finance/payouts?page=1&pageSize=20`, currentAuth, { actorRole: "seller" }, handleRefresh),
      ]);
      if (!summaryRes.ok) throw new Error(summaryRes.message ?? "Finans özeti alınamadı");
      if (!balanceRes.ok) throw new Error(balanceRes.message ?? "Bakiye alınamadı");
      if (!payoutsRes.ok) throw new Error(payoutsRes.message ?? "Payout listesi alınamadı");
      setSummary(summaryRes.data ?? null);
      setBalance(balanceRes.data ?? null);
      setPayouts(Array.isArray(payoutsRes.data) ? payoutsRes.data : []);
    } catch (e) {
      Alert.alert("Hata", e instanceof Error ? e.message : "Finans yüklenemedi");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadData();
  }, []);

  async function saveBankAccount() {
    if (!iban.trim() || !holder.trim()) {
      Alert.alert("Hata", "IBAN ve hesap sahibi zorunlu.");
      return;
    }
    setSaving(true);
    try {
      const res = await apiRequest(`/v1/sellers/${currentAuth.userId}/bank-account`, currentAuth, {
        method: "PUT",
        body: { iban: iban.trim(), accountHolderName: holder.trim() },
        actorRole: "seller",
      }, handleRefresh);
      if (!res.ok) throw new Error(res.message ?? "Banka hesabı kaydedilemedi");
      Alert.alert("Tamam", "Banka hesabı güncellendi.");
    } catch (e) {
      Alert.alert("Hata", e instanceof Error ? e.message : "Banka hesabı kaydedilemedi");
    } finally {
      setSaving(false);
    }
  }

  return (
    <View style={styles.container}>
      <ScreenHeader title="Cüzdanım" onBack={onBack} />
      <ScrollView contentContainerStyle={styles.content}>
        {loading ? (
          <ActivityIndicator size="large" color={theme.primary} style={styles.loader} />
        ) : (
          <>
            <View style={styles.tabsRow}>
              <TouchableOpacity style={[styles.tabBtn, tab === "overview" && styles.tabBtnActive]} onPress={() => setTab("overview")}>
                <Text style={[styles.tabText, tab === "overview" && styles.tabTextActive]}>Genel Bakış</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.tabBtn, tab === "transactions" && styles.tabBtnActive]} onPress={() => setTab("transactions")}>
                <Text style={[styles.tabText, tab === "transactions" && styles.tabTextActive]}>İşlemler</Text>
              </TouchableOpacity>
              <TouchableOpacity style={[styles.tabBtn, tab === "withdraw" && styles.tabBtnActive]} onPress={() => setTab("withdraw")}>
                <Text style={[styles.tabText, tab === "withdraw" && styles.tabTextActive]}>Para Çek</Text>
              </TouchableOpacity>
            </View>
            {tab === "overview" ? (
              <>
                <View style={styles.balanceHero}>
                  <Text style={styles.balanceLabel}>Mevcut Bakiye</Text>
                  <Text style={styles.balanceAmount}>₺{(balance?.availableBalance ?? 0).toFixed(2)}</Text>
                  <Text style={styles.pendingText}>Bekleyen: ₺{(balance?.pendingPayoutAmount ?? 0).toFixed(2)}</Text>
                </View>
                <Text style={styles.sectionTitle}>Kazanç İstatistikleri</Text>
                <View style={styles.statsRow}>
                  <View style={styles.statCard}>
                    <Text style={styles.statTitle}>Bu Ay</Text>
                    <Text style={styles.statValue}>₺{(summary?.totalNetEarnings ?? 0).toFixed(2)}</Text>
                  </View>
                  <View style={styles.statCard}>
                    <Text style={styles.statTitle}>Komisyon</Text>
                    <Text style={styles.statValue}>₺{(summary?.totalCommission ?? 0).toFixed(2)}</Text>
                  </View>
                  <View style={styles.statCard}>
                    <Text style={styles.statTitle}>Toplam Kazanç</Text>
                    <Text style={[styles.statValue, styles.statGold]}>₺{(summary?.totalSellingAmount ?? 0).toFixed(2)}</Text>
                  </View>
                </View>
                <View style={styles.card}>
                  <Text style={styles.cardTitle}>Ödeme Bilgileri</Text>
                  <Text style={styles.meta}>Sonraki Ödeme: Haftalık otomatik</Text>
                  <Text style={styles.meta}>Minimum Tutar: ₺50.00</Text>
                </View>
              </>
            ) : null}

            {tab === "transactions" ? (
              <View style={styles.txWrap}>
                <Text style={styles.sectionTitle}>İşlem Geçmişi</Text>
                {payouts.length === 0 ? <Text style={styles.empty}>Henüz işlem yok.</Text> : null}
                {payouts.map((row) => (
                  <View key={row.batchId} style={styles.txCard}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.txTitle}>Kazanç</Text>
                      <Text style={styles.txDate}>{row.payoutDate}</Text>
                      <Text style={styles.txDesc}>Sipariş #{row.batchId.slice(0, 8)} - Satış kazancı</Text>
                    </View>
                    <View style={{ alignItems: "flex-end" }}>
                      <Text style={styles.txAmount}>+₺{Number(row.totalAmount ?? 0).toFixed(2)}</Text>
                      <Text style={[styles.txStatus, row.status === "paid" ? styles.txDone : styles.txWait]}>
                        {row.status === "paid" ? "Tamamlandı" : "Bekliyor"}
                      </Text>
                    </View>
                  </View>
                ))}
              </View>
            ) : null}

            {tab === "withdraw" ? (
              <>
                <View style={styles.card}>
                  <Text style={styles.cardTitle}>Çekmek İstediğiniz Tutar</Text>
                  <TextInput
                    style={styles.amountInput}
                    value={withdrawAmount}
                    onChangeText={setWithdrawAmount}
                    keyboardType="decimal-pad"
                  />
                  <View style={styles.quickRow}>
                    {["100", "250", "500"].map((preset) => (
                      <TouchableOpacity key={preset} style={styles.quickBtn} onPress={() => setWithdrawAmount(preset)}>
                        <Text style={styles.quickText}>₺{preset}</Text>
                      </TouchableOpacity>
                    ))}
                    <TouchableOpacity style={styles.quickBtn} onPress={() => setWithdrawAmount(String(Math.floor(balance?.availableBalance ?? 0)))}>
                      <Text style={styles.quickText}>Tümü</Text>
                    </TouchableOpacity>
                  </View>
                  <View style={styles.infoBox}>
                    <Text style={styles.meta}>• Minimum çekim tutarı: ₺50.00</Text>
                    <Text style={styles.meta}>• İşlem süresi: 1-3 iş günü</Text>
                    <Text style={styles.meta}>• Haftalık otomatik ödeme: Pazartesi</Text>
                  </View>
                  <ActionButton
                    label="Para Çekme Talebi Oluştur"
                    onPress={() => Alert.alert("Bilgi", "Bu sürümde para çekme talebi yakında açılacak.")}
                    fullWidth
                  />
                </View>

                <View style={styles.card}>
                  <Text style={styles.cardTitle}>Banka Hesap Bilgileri</Text>
                  <TextInput style={styles.input} value={holder} onChangeText={setHolder} placeholder="Hesap sahibi" />
                  <TextInput style={styles.input} value={iban} onChangeText={setIban} placeholder="TRxxxxxxxx..." autoCapitalize="characters" />
                  <ActionButton label="Hesap Bilgilerini Kaydet" onPress={() => void saveBankAccount()} loading={saving} fullWidth />
                </View>
              </>
            ) : null}
          </>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#ECEBE7" },
  content: { padding: 16, paddingBottom: 40, gap: 10 },
  loader: { marginTop: 40 },
  tabsRow: { flexDirection: "row", gap: 8, marginBottom: 4 },
  tabBtn: { flex: 1, borderRadius: 999, paddingVertical: 10, alignItems: "center", backgroundColor: "#F4F4F1", borderWidth: 1, borderColor: "#D1D0CB" },
  tabBtnActive: { backgroundColor: "#8EA18F", borderColor: "#8EA18F" },
  tabText: { color: "#2F2D2B", fontWeight: "700", fontSize: 13 },
  tabTextActive: { color: "#fff", fontWeight: "800" },
  balanceHero: { backgroundColor: "#8EA18F", borderRadius: 12, borderWidth: 1, borderColor: "#819782", padding: 16 },
  balanceLabel: { color: "#F0F4EF", fontWeight: "700" },
  balanceAmount: { color: "#fff", marginTop: 2, fontSize: 38 / 2, fontWeight: "800" },
  pendingText: { marginTop: 6, color: "#F2F5F1", fontWeight: "600" },
  sectionTitle: { color: "#2F2D2B", fontWeight: "800", fontSize: 24 / 2, marginTop: 6 },
  statsRow: { flexDirection: "row", gap: 8 },
  statCard: { flex: 1, backgroundColor: "#F8F8F6", borderRadius: 12, borderWidth: 1, borderColor: "#D4D3CD", paddingVertical: 12, alignItems: "center" },
  statTitle: { color: "#6F6A62", fontWeight: "600" },
  statValue: { marginTop: 4, color: "#2A7A44", fontWeight: "800" },
  statGold: { color: "#E58A00" },
  card: { backgroundColor: "#F8F8F6", borderRadius: 12, borderWidth: 1, borderColor: "#D4D3CD", padding: 12 },
  cardTitle: { color: "#2E241C", fontWeight: "800", marginBottom: 6 },
  meta: { color: "#6C6055", marginTop: 4, fontSize: 15 },
  empty: { color: "#9E8E7E", fontSize: 13, fontStyle: "italic" },
  input: { backgroundColor: "#ECEBE8", borderRadius: 10, borderWidth: 1, borderColor: "#CFCFC9", paddingHorizontal: 10, paddingVertical: 10, marginBottom: 8, color: "#2F2D2B" },
  txWrap: { gap: 8 },
  txCard: { backgroundColor: "#F8F8F6", borderRadius: 12, borderWidth: 1, borderColor: "#D4D3CD", padding: 12, flexDirection: "row", alignItems: "flex-start" },
  txTitle: { color: "#2F2D2B", fontWeight: "800", fontSize: 16 },
  txDate: { color: "#777068", marginTop: 2 },
  txDesc: { color: "#6E675D", marginTop: 8 },
  txAmount: { color: "#2A8E4A", fontWeight: "800", fontSize: 22 / 2 },
  txStatus: { marginTop: 4, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 3, overflow: "hidden", fontWeight: "800", fontSize: 11 },
  txDone: { backgroundColor: "#E6F4E8", color: "#2A7A44" },
  txWait: { backgroundColor: "#FFE9CC", color: "#C77700" },
  amountInput: { backgroundColor: "#ECEBE8", borderRadius: 10, borderWidth: 1, borderColor: "#CFCFC9", paddingHorizontal: 10, paddingVertical: 10, marginBottom: 10, textAlign: "center", color: "#2F2D2B", fontWeight: "800", fontSize: 18 },
  quickRow: { flexDirection: "row", gap: 8, marginBottom: 10 },
  quickBtn: { flex: 1, borderWidth: 1, borderColor: "#C4C4BF", borderRadius: 999, alignItems: "center", paddingVertical: 8, backgroundColor: "#F4F4F2" },
  quickText: { color: "#403A33", fontWeight: "700" },
  infoBox: { borderWidth: 1, borderColor: "#D4D3CD", borderRadius: 10, padding: 10, backgroundColor: "#EFEFEB", marginBottom: 10 },
});
