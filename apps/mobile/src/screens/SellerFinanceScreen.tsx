import React, { useEffect, useState } from "react";
import { ActivityIndicator, Alert, ScrollView, StyleSheet, Text, TextInput, View } from "react-native";
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
  const [summary, setSummary] = useState<FinanceSummary | null>(null);
  const [balance, setBalance] = useState<FinanceBalance | null>(null);
  const [payouts, setPayouts] = useState<PayoutRow[]>([]);
  const [iban, setIban] = useState("");
  const [holder, setHolder] = useState("");

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
      <ScreenHeader title="Finans / Payout" onBack={onBack} />
      <ScrollView contentContainerStyle={styles.content}>
        {loading ? (
          <ActivityIndicator size="large" color={theme.primary} style={styles.loader} />
        ) : (
          <>
            <View style={styles.heroCard}>
              <Text style={styles.heroTitle}>Kazancın burada net görünür.</Text>
              <Text style={styles.heroText}>Bakiyeni, payout geçmişini ve banka hesabını tek yerden yönetebilirsin.</Text>
            </View>
            <View style={styles.card}>
              <Text style={styles.cardTitle}>Özet</Text>
              <Text style={styles.meta}>Brüt Satış: {(summary?.totalSellingAmount ?? 0).toFixed(2)} TL</Text>
              <Text style={styles.meta}>Komisyon: {(summary?.totalCommission ?? 0).toFixed(2)} TL</Text>
              <Text style={styles.meta}>Net Kazanç: {(summary?.totalNetEarnings ?? 0).toFixed(2)} TL</Text>
            </View>
            <View style={styles.card}>
              <Text style={styles.cardTitle}>Bakiye</Text>
              <Text style={styles.meta}>Kullanılabilir: {(balance?.availableBalance ?? 0).toFixed(2)} {balance?.currency ?? "TRY"}</Text>
              <Text style={styles.meta}>Bekleyen Payout: {(balance?.pendingPayoutAmount ?? 0).toFixed(2)} {balance?.currency ?? "TRY"}</Text>
            </View>
            <View style={styles.card}>
              <Text style={styles.cardTitle}>Banka Hesabı</Text>
              <TextInput style={styles.input} value={iban} onChangeText={setIban} placeholder="TRxxxxxxxx..." />
              <TextInput style={styles.input} value={holder} onChangeText={setHolder} placeholder="Hesap sahibi" />
              <ActionButton
                label="Banka Bilgisini Kaydet"
                onPress={() => void saveBankAccount()}
                loading={saving}
                fullWidth
              />
            </View>
            <View style={styles.card}>
              <Text style={styles.cardTitle}>Payout Geçmişi</Text>
              {payouts.length === 0 ? (
                <Text style={styles.empty}>Henüz payout yapılmadı.</Text>
              ) : null}
              {payouts.map((row) => (
                <Text key={row.batchId} style={styles.meta}>
                  {row.payoutDate} · {row.status} · {Number(row.totalAmount ?? 0).toFixed(2)} TL
                </Text>
              ))}
            </View>
          </>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#F7F4EF" },
  content: { padding: 16, paddingBottom: 40, gap: 10 },
  loader: { marginTop: 40 },
  heroCard: { backgroundColor: "#F1E8D9", borderColor: "#E8D6BB", borderWidth: 1, borderRadius: 14, padding: 12 },
  heroTitle: { color: "#4B3422", fontWeight: "800", fontSize: 15, lineHeight: 20 },
  heroText: { marginTop: 4, color: "#6B5545", lineHeight: 18 },
  card: { backgroundColor: "#fff", borderRadius: 12, borderWidth: 1, borderColor: "#E5DDCF", padding: 12 },
  cardTitle: { color: "#2E241C", fontWeight: "800", marginBottom: 6 },
  meta: { color: "#6C6055", marginTop: 3 },
  empty: { color: "#9E8E7E", fontSize: 13, fontStyle: "italic" },
  input: { backgroundColor: "#F8F5EF", borderRadius: 10, borderWidth: 1, borderColor: "#E5DDCF", paddingHorizontal: 10, paddingVertical: 10, marginBottom: 8 },
});
