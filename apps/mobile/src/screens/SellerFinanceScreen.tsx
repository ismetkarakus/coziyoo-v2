import React, { useEffect, useState } from "react";
import { ActivityIndicator, Alert, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
import type { AuthSession } from "../utils/auth";
import { refreshAuthSession } from "../utils/auth";
import { actorRoleHeader } from "../utils/actorRole";
import { loadSettings } from "../utils/settings";
import { theme } from "../theme/colors";

type Props = {
  auth: AuthSession;
  onBack: () => void;
  onAuthRefresh?: (session: AuthSession) => void;
};

export default function SellerFinanceScreen({ auth, onBack, onAuthRefresh }: Props) {
  const [apiUrl, setApiUrl] = useState("http://localhost:3000");
  const [currentAuth, setCurrentAuth] = useState(auth);
  const [loading, setLoading] = useState(true);
  const [summary, setSummary] = useState<{ totalSellingAmount: number; totalCommission: number; totalNetEarnings: number } | null>(null);
  const [balance, setBalance] = useState<{ availableBalance: number; pendingPayoutAmount: number; currency: string } | null>(null);
  const [payouts, setPayouts] = useState<Array<{ batchId: string; status: string; totalAmount: number; payoutDate: string }>>([]);
  const [iban, setIban] = useState("");
  const [holder, setHolder] = useState("");

  useEffect(() => setCurrentAuth(auth), [auth]);

  async function authedFetch(path: string, init?: RequestInit, baseUrl = apiUrl): Promise<Response> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Authorization: `Bearer ${currentAuth.accessToken}`,
      ...actorRoleHeader(currentAuth, "seller"),
      ...(init?.headers as Record<string, string> | undefined),
    };
    let res = await fetch(`${baseUrl}${path}`, { ...init, headers });
    if (res.status !== 401) return res;
    const refreshed = await refreshAuthSession(baseUrl, currentAuth);
    if (!refreshed) return res;
    setCurrentAuth(refreshed);
    onAuthRefresh?.(refreshed);
    return fetch(`${baseUrl}${path}`, {
      ...init,
      headers: {
        ...headers,
        Authorization: `Bearer ${refreshed.accessToken}`,
        ...actorRoleHeader(refreshed, "seller"),
      },
    });
  }

  async function loadData() {
    setLoading(true);
    try {
      const settings = await loadSettings();
      const baseUrl = settings.apiUrl;
      setApiUrl(baseUrl);
      const sellerId = currentAuth.userId;
      const [summaryRes, balanceRes, payoutsRes] = await Promise.all([
        authedFetch(`/v1/sellers/${sellerId}/finance/summary`, undefined, baseUrl),
        authedFetch(`/v1/sellers/${sellerId}/finance/balance`, undefined, baseUrl),
        authedFetch(`/v1/sellers/${sellerId}/finance/payouts?page=1&pageSize=20`, undefined, baseUrl),
      ]);
      const summaryJson = await summaryRes.json();
      const balanceJson = await balanceRes.json();
      const payoutsJson = await payoutsRes.json();
      if (!summaryRes.ok) throw new Error(summaryJson?.error?.message ?? "Finans özeti alınamadı");
      if (!balanceRes.ok) throw new Error(balanceJson?.error?.message ?? "Bakiye alınamadı");
      if (!payoutsRes.ok) throw new Error(payoutsJson?.error?.message ?? "Payout listesi alınamadı");
      setSummary(summaryJson?.data ?? null);
      setBalance(balanceJson?.data ?? null);
      setPayouts(Array.isArray(payoutsJson?.data) ? payoutsJson.data : []);
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
    try {
      if (!iban.trim() || !holder.trim()) {
        Alert.alert("Hata", "IBAN ve hesap sahibi zorunlu.");
        return;
      }
      const res = await authedFetch(`/v1/sellers/${currentAuth.userId}/bank-account`, {
        method: "PUT",
        body: JSON.stringify({ iban: iban.trim(), accountHolderName: holder.trim() }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error?.message ?? "Banka hesabı kaydedilemedi");
      Alert.alert("Tamam", "Banka hesabı güncellendi.");
    } catch (e) {
      Alert.alert("Hata", e instanceof Error ? e.message : "Banka hesabı kaydedilemedi");
    }
  }

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.back} onPress={onBack}>Geri</Text>
      <Text style={styles.title}>Finans / Payout</Text>
      {loading ? (
        <ActivityIndicator size="large" color={theme.primary} />
      ) : (
        <>
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
            <TouchableOpacity style={styles.saveBtn} onPress={() => void saveBankAccount()}>
              <Text style={styles.saveText}>Banka Hesabını Kaydet</Text>
            </TouchableOpacity>
          </View>
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Payout Geçmişi</Text>
            {payouts.map((row) => (
              <Text key={row.batchId} style={styles.meta}>
                {row.payoutDate} · {row.status} · {Number(row.totalAmount ?? 0).toFixed(2)} TL
              </Text>
            ))}
          </View>
        </>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#F7F4EF" },
  content: { padding: 16, paddingBottom: 40, gap: 10 },
  back: { color: "#3F855C", fontWeight: "700" },
  title: { fontSize: 22, fontWeight: "800", color: "#2E241C", marginTop: 4, marginBottom: 6 },
  card: { backgroundColor: "#fff", borderRadius: 12, borderWidth: 1, borderColor: "#E5DDCF", padding: 12 },
  cardTitle: { color: "#2E241C", fontWeight: "800", marginBottom: 6 },
  meta: { color: "#6C6055", marginTop: 3 },
  input: { backgroundColor: "#F8F5EF", borderRadius: 10, borderWidth: 1, borderColor: "#E5DDCF", paddingHorizontal: 10, paddingVertical: 10, marginTop: 8 },
  saveBtn: { marginTop: 10, backgroundColor: "#3F855C", borderRadius: 10, paddingVertical: 11, alignItems: "center" },
  saveText: { color: "#fff", fontWeight: "700" },
});
