import React, { useEffect, useMemo, useState } from "react";
import { ActivityIndicator, Alert, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import type { AuthSession } from "../utils/auth";
import { refreshAuthSession } from "../utils/auth";
import { actorRoleHeader } from "../utils/actorRole";
import { loadSettings } from "../utils/settings";
import { readJsonSafe } from "../utils/http";
import { theme } from "../theme/colors";
import ScreenHeader from "../components/ScreenHeader";

type Props = {
  auth: AuthSession;
  onBack: () => void;
  onAuthRefresh?: (session: AuthSession) => void;
};

type SellerFinanceSummary = {
  totalSellingAmount: number;
  totalCommission: number;
  totalNetEarnings: number;
};

type SellerBalance = {
  availableBalance: number;
  pendingPayoutAmount: number;
  currency: string;
};

type SellerPayout = {
  batchId: string;
  status: string;
  totalAmount: number;
  payoutDate: string;
};

type SellerBankAccount = {
  iban: string;
  accountHolderName: string;
  cardNumber?: string | null;
};

type WalletTab = "overview" | "transactions" | "withdraw";

const MIN_PAYOUT_AMOUNT = 50;

function parseApiDate(value?: string | null): Date | null {
  if (!value?.trim()) return null;
  const normalized = value.trim().replace(" ", "T").replace(/(\.\d+)?([+-]\d{2})$/, "$1$2:00");
  const parsed = new Date(normalized);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed;
}

function formatDate(value?: string | null): string {
  const parsed = parseApiDate(value);
  if (!parsed) return "-";
  const dd = String(parsed.getDate()).padStart(2, "0");
  const mm = String(parsed.getMonth() + 1).padStart(2, "0");
  const yyyy = String(parsed.getFullYear());
  return `${dd}.${mm}.${yyyy}`;
}

function isCompletedPayout(status: string): boolean {
  const normalized = status.trim().toLowerCase();
  return ["completed", "paid", "success", "done"].includes(normalized);
}

function isPendingPayout(status: string): boolean {
  const normalized = status.trim().toLowerCase();
  return ["pending", "queued", "processing", "scheduled"].includes(normalized);
}

function formatMoney(value: number, currency: string): string {
  const amount = Number(value ?? 0);
  if ((currency || "").toUpperCase() === "TRY") return `₺${amount.toFixed(2)}`;
  return `${amount.toFixed(2)} ${currency || "TRY"}`;
}

export default function SellerFinanceScreen({ auth, onBack, onAuthRefresh }: Props) {
  const [apiUrl, setApiUrl] = useState("http://localhost:3000");
  const [currentAuth, setCurrentAuth] = useState(auth);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<WalletTab>("overview");
  const [summary, setSummary] = useState<SellerFinanceSummary | null>(null);
  const [balance, setBalance] = useState<SellerBalance | null>(null);
  const [payouts, setPayouts] = useState<SellerPayout[]>([]);
  const [iban, setIban] = useState("");
  const [holder, setHolder] = useState("");
  const [cardNumber, setCardNumber] = useState("");

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
      const [summaryRes, balanceRes, payoutsRes, bankRes] = await Promise.all([
        authedFetch(`/v1/sellers/${sellerId}/finance/summary`, undefined, baseUrl),
        authedFetch(`/v1/sellers/${sellerId}/finance/balance`, undefined, baseUrl),
        authedFetch(`/v1/sellers/${sellerId}/finance/payouts?page=1&pageSize=20`, undefined, baseUrl),
        authedFetch(`/v1/sellers/${sellerId}/bank-account`, undefined, baseUrl),
      ]);
      const summaryJson = await summaryRes.json();
      const balanceJson = await balanceRes.json();
      const payoutsJson = await payoutsRes.json();
      const bankJson = await readJsonSafe<{ data?: SellerBankAccount | null; error?: { message?: string } }>(bankRes);
      if (!summaryRes.ok) throw new Error(summaryJson?.error?.message ?? "Finans özeti alınamadı");
      if (!balanceRes.ok) throw new Error(balanceJson?.error?.message ?? "Bakiye alınamadı");
      if (!payoutsRes.ok) throw new Error(payoutsJson?.error?.message ?? "Payout listesi alınamadı");
      setSummary(summaryJson?.data ?? null);
      setBalance(balanceJson?.data ?? null);
      setPayouts(Array.isArray(payoutsJson?.data) ? payoutsJson.data : []);
      if (!bankRes.ok && bankRes.status !== 404) {
        throw new Error(bankJson?.error?.message ?? "Banka hesabı alınamadı");
      }
      const bankData = bankRes.ok ? ((bankJson?.data ?? null) as SellerBankAccount | null) : null;
      setIban(typeof bankData?.iban === "string" ? bankData.iban : "");
      setHolder(typeof bankData?.accountHolderName === "string" ? bankData.accountHolderName : "");
      setCardNumber(typeof bankData?.cardNumber === "string" ? bankData.cardNumber : "");
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
        body: JSON.stringify({
          iban: iban.trim(),
          accountHolderName: holder.trim(),
          cardNumber: cardNumber.trim() || undefined,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error?.message ?? "Banka hesabı kaydedilemedi");
      Alert.alert("Tamam", "Banka hesabı güncellendi.");
    } catch (e) {
      Alert.alert("Hata", e instanceof Error ? e.message : "Banka hesabı kaydedilemedi");
    }
  }

  const currency = (balance?.currency || "TRY").toUpperCase();

  const payoutsSorted = useMemo(
    () => [...payouts].sort((a, b) => (parseApiDate(b.payoutDate)?.getTime() ?? 0) - (parseApiDate(a.payoutDate)?.getTime() ?? 0)),
    [payouts],
  );

  const weekEarnings = useMemo(() => {
    const from = Date.now() - 7 * 24 * 60 * 60 * 1000;
    return payoutsSorted
      .filter((row) => isCompletedPayout(row.status))
      .filter((row) => (parseApiDate(row.payoutDate)?.getTime() ?? 0) >= from)
      .reduce((sum, row) => sum + Number(row.totalAmount ?? 0), 0);
  }, [payoutsSorted]);

  const monthEarnings = useMemo(() => {
    const from = Date.now() - 30 * 24 * 60 * 60 * 1000;
    return payoutsSorted
      .filter((row) => isCompletedPayout(row.status))
      .filter((row) => (parseApiDate(row.payoutDate)?.getTime() ?? 0) >= from)
      .reduce((sum, row) => sum + Number(row.totalAmount ?? 0), 0);
  }, [payoutsSorted]);

  const totalEarnings = Number(summary?.totalNetEarnings ?? 0);

  const lastPayoutDate = useMemo(() => {
    const latest = payoutsSorted.find((row) => isCompletedPayout(row.status));
    return formatDate(latest?.payoutDate);
  }, [payoutsSorted]);

  const nextPayoutDate = useMemo(() => {
    const now = Date.now();
    const next = payoutsSorted.find((row) => {
      if (!isPendingPayout(row.status)) return false;
      const ts = parseApiDate(row.payoutDate)?.getTime();
      return typeof ts === "number" && ts >= now;
    });
    return formatDate(next?.payoutDate);
  }, [payoutsSorted]);

  return (
    <View style={styles.container}>
      <ScreenHeader title="Cüzdanım" onBack={onBack} />
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.segmentedTabs}>
          <TouchableOpacity
            style={[styles.tabBtn, activeTab === "overview" && styles.tabBtnActive]}
            onPress={() => setActiveTab("overview")}
          >
            <Ionicons name="grid-outline" size={12} color={activeTab === "overview" ? "#FFFFFF" : "#2E241C"} />
            <Text style={[styles.tabText, activeTab === "overview" && styles.tabTextActive]}>Genel Bakış</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.tabBtn, activeTab === "transactions" && styles.tabBtnActive]}
            onPress={() => setActiveTab("transactions")}
          >
            <Ionicons name="list-outline" size={12} color={activeTab === "transactions" ? "#FFFFFF" : "#2E241C"} />
            <Text style={[styles.tabText, activeTab === "transactions" && styles.tabTextActive]}>İşlemler</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[styles.tabBtn, activeTab === "withdraw" && styles.tabBtnActive]}
            onPress={() => setActiveTab("withdraw")}
          >
            <Ionicons name="cash-outline" size={12} color={activeTab === "withdraw" ? "#FFFFFF" : "#2E241C"} />
            <Text style={[styles.tabText, activeTab === "withdraw" && styles.tabTextActive]}>Para Çek</Text>
          </TouchableOpacity>
        </View>

        {loading ? <ActivityIndicator size="large" color={theme.primary} style={styles.loading} /> : null}

        {!loading && activeTab === "overview" ? (
          <>
            <View style={styles.balanceCard}>
              <View>
                <View style={styles.balanceTitleRow}>
                  <Ionicons name="wallet-outline" size={14} color="#FFFFFF" />
                  <Text style={styles.balanceTitle}>Mevcut Bakiye</Text>
                </View>
                <Text style={styles.balanceAmount}>{formatMoney(balance?.availableBalance ?? 0, currency)}</Text>
                <View style={styles.pendingRow}>
                  <Ionicons name="time-outline" size={12} color="#FFFFFF" />
                  <Text style={styles.pendingText}>Bekleyen: {formatMoney(balance?.pendingPayoutAmount ?? 0, currency)}</Text>
                </View>
              </View>
              <TouchableOpacity style={styles.withdrawBtn} onPress={() => setActiveTab("withdraw")} activeOpacity={0.9}>
                <Text style={styles.withdrawBtnText}>Para Çek</Text>
                <Ionicons name="arrow-forward" size={12} color="#FFFFFF" />
              </TouchableOpacity>
            </View>

            <Text style={styles.sectionTitle}>Kazanç İstatistikleri</Text>
            <View style={styles.statsRow}>
              <View style={styles.statCard}>
                <Ionicons name="calendar-outline" size={14} color="#22C55E" />
                <Text style={styles.statLabel}>Bu Hafta</Text>
                <Text style={[styles.statValue, styles.statValueGreen]}>{formatMoney(weekEarnings, currency)}</Text>
              </View>
              <View style={styles.statCard}>
                <Ionicons name="calendar-clear-outline" size={14} color="#7C7C7C" />
                <Text style={styles.statLabel}>Bu Ay</Text>
                <Text style={styles.statValue}>{formatMoney(monthEarnings, currency)}</Text>
              </View>
              <View style={styles.statCard}>
                <Ionicons name="trophy-outline" size={14} color="#F59E0B" />
                <Text style={styles.statLabel}>Toplam Kazanç</Text>
                <Text style={[styles.statValue, styles.statValueOrange]}>{formatMoney(totalEarnings, currency)}</Text>
              </View>
            </View>

            <View style={styles.infoCard}>
              <View style={styles.infoTitleRow}>
                <Ionicons name="information-circle-outline" size={14} color="#6C6055" />
                <Text style={styles.infoTitle}>Ödeme Bilgileri</Text>
              </View>
              <View style={styles.infoRow}><Text style={styles.infoKey}>Son Ödeme:</Text><Text style={styles.infoVal}>{lastPayoutDate}</Text></View>
              <View style={styles.infoRow}><Text style={styles.infoKey}>Sonraki Ödeme:</Text><Text style={styles.infoVal}>{nextPayoutDate}</Text></View>
              <View style={styles.infoRow}><Text style={styles.infoKey}>Minimum Tutar:</Text><Text style={styles.infoVal}>{formatMoney(MIN_PAYOUT_AMOUNT, currency)}</Text></View>
            </View>
          </>
        ) : null}

        {!loading && activeTab === "transactions" ? (
          <View style={styles.listWrap}>
            {payoutsSorted.length === 0 ? (
              <View style={styles.emptyCard}><Text style={styles.emptyText}>Henüz işlem kaydı yok.</Text></View>
            ) : (
              payoutsSorted.map((row) => (
                <View key={row.batchId} style={styles.txnCard}>
                  <View style={styles.txnTop}>
                    <Text style={styles.txnDate}>{formatDate(row.payoutDate)}</Text>
                    <Text style={[styles.txnStatus, isCompletedPayout(row.status) ? styles.txnStatusOk : styles.txnStatusPending]}>
                      {row.status}
                    </Text>
                  </View>
                  <Text style={styles.txnAmount}>{formatMoney(Number(row.totalAmount ?? 0), currency)}</Text>
                </View>
              ))
            )}
          </View>
        ) : null}

        {!loading && activeTab === "withdraw" ? (
          <View style={styles.withdrawCard}>
            <Text style={styles.withdrawTitle}>Para Çek</Text>
            <Text style={styles.withdrawMeta}>Kullanılabilir: {formatMoney(balance?.availableBalance ?? 0, currency)}</Text>
            <Text style={styles.withdrawMeta}>Bekleyen: {formatMoney(balance?.pendingPayoutAmount ?? 0, currency)}</Text>
            <Text style={styles.withdrawMeta}>Minimum: {formatMoney(MIN_PAYOUT_AMOUNT, currency)}</Text>
            <TextInput style={styles.input} value={iban} onChangeText={setIban} placeholder="IBAN (TR...)" placeholderTextColor="#8A7A6A" />
            <TextInput
              style={styles.input}
              value={cardNumber}
              onChangeText={setCardNumber}
              placeholder="Kart Numarası"
              placeholderTextColor="#8A7A6A"
              keyboardType="number-pad"
            />
            <TextInput style={styles.input} value={holder} onChangeText={setHolder} placeholder="Hesap sahibi" placeholderTextColor="#8A7A6A" />
            <TouchableOpacity style={styles.saveBtn} onPress={() => void saveBankAccount()}>
              <Text style={styles.saveText}>Banka Hesabını Kaydet</Text>
            </TouchableOpacity>
          </View>
        ) : null}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#F1EFEB" },
  content: { padding: 12, paddingBottom: 28, gap: 10 },
  loading: { marginTop: 26 },
  segmentedTabs: {
    flexDirection: "row",
    gap: 8,
    borderBottomWidth: 1,
    borderBottomColor: "#D8D2C8",
    paddingBottom: 8,
  },
  tabBtn: {
    flex: 1,
    borderRadius: 999,
    paddingVertical: 10,
    flexDirection: "row",
    justifyContent: "center",
    alignItems: "center",
    gap: 5,
    backgroundColor: "#E9E5DE",
  },
  tabBtnActive: { backgroundColor: "#8EA08A" },
  tabText: { color: "#2E241C", fontWeight: "700", fontSize: 15 },
  tabTextActive: { color: "#FFFFFF" },

  balanceCard: {
    backgroundColor: "#8A9C86",
    borderRadius: 10,
    padding: 12,
    minHeight: 98,
    justifyContent: "space-between",
  },
  balanceTitleRow: { flexDirection: "row", alignItems: "center", gap: 6 },
  balanceTitle: { color: "#FFFFFF", fontSize: 15, fontWeight: "700" },
  balanceAmount: { color: "#FFFFFF", fontSize: 38, fontWeight: "900", marginTop: 2 },
  pendingRow: { flexDirection: "row", alignItems: "center", gap: 4, marginTop: 2 },
  pendingText: { color: "#FFFFFF", fontSize: 12, fontWeight: "600" },
  withdrawBtn: {
    alignSelf: "flex-end",
    marginTop: 8,
    backgroundColor: "rgba(255,255,255,0.22)",
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 7,
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
  },
  withdrawBtnText: { color: "#FFFFFF", fontWeight: "700", fontSize: 12 },

  sectionTitle: { color: "#2E241C", fontSize: 19, fontWeight: "800", marginTop: 6, textAlign: "center" },
  statsRow: { flexDirection: "row", gap: 6, paddingHorizontal: 6 },
  statCard: {
    flex: 1,
    backgroundColor: "#FFFFFF",
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#E3DBCF",
    paddingVertical: 11,
    alignItems: "center",
    justifyContent: "center",
    gap: 3,
  },
  statLabel: { color: "#5E564D", fontSize: 12, fontWeight: "600" },
  statValue: { color: "#5E564D", fontSize: 15, fontWeight: "800" },
  statValueGreen: { color: "#22C55E" },
  statValueOrange: { color: "#F97316" },

  infoCard: {
    backgroundColor: "#FFFFFF",
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#E3DBCF",
    padding: 12,
  },
  infoTitleRow: { flexDirection: "row", alignItems: "center", gap: 4, marginBottom: 6 },
  infoTitle: { color: "#3B3129", fontWeight: "800", fontSize: 16 },
  infoRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginTop: 3 },
  infoKey: { color: "#7A7065", fontSize: 14 },
  infoVal: { color: "#2E241C", fontSize: 14, fontWeight: "700" },

  listWrap: { gap: 8 },
  emptyCard: {
    backgroundColor: "#FFFFFF",
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#E3DBCF",
    padding: 12,
  },
  emptyText: { color: "#6C6055", fontWeight: "600" },
  txnCard: {
    backgroundColor: "#FFFFFF",
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#E3DBCF",
    padding: 12,
  },
  txnTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  txnDate: { color: "#6C6055", fontWeight: "700" },
  txnStatus: { fontWeight: "800", fontSize: 12, textTransform: "capitalize" },
  txnStatusOk: { color: "#1B7A42" },
  txnStatusPending: { color: "#B45309" },
  txnAmount: { color: "#2E241C", fontWeight: "900", marginTop: 6, fontSize: 16 },

  withdrawCard: {
    backgroundColor: "#FFFFFF",
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#E3DBCF",
    padding: 12,
  },
  withdrawTitle: { color: "#2E241C", fontWeight: "900", fontSize: 18, marginBottom: 6 },
  withdrawMeta: { color: "#6C6055", marginTop: 2, fontWeight: "600" },
  input: {
    backgroundColor: "#F8F5EF",
    borderRadius: 10,
    borderWidth: 1,
    borderColor: "#E5DDCF",
    paddingHorizontal: 10,
    paddingVertical: 10,
    marginTop: 8,
    color: "#2E241C",
  },
  saveBtn: { marginTop: 10, backgroundColor: "#3F855C", borderRadius: 10, paddingVertical: 11, alignItems: "center" },
  saveText: { color: "#fff", fontWeight: "800" },
});
