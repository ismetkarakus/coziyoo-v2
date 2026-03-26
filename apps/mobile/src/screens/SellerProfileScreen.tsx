import React, { useEffect, useState } from "react";
import { Alert, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
import type { AuthSession } from "../utils/auth";
import { apiRequest } from "../utils/api";
import { theme } from "../theme/colors";
import ScreenHeader from "../components/ScreenHeader";
import ActionButton from "../components/ActionButton";

type Props = {
  auth: AuthSession;
  onBack: () => void;
  onOpenAddresses: () => void;
  onAuthRefresh?: (session: AuthSession) => void;
};

type SellerProfileData = {
  displayName?: string | null;
  phone?: string | null;
  kitchenTitle?: string | null;
  kitchenDescription?: string | null;
  deliveryRadiusKm?: number | null;
  workingHours?: Array<{ day: string; open: string; close: string; enabled?: boolean }>;
  status?: "incomplete" | "pending_review" | "active";
  defaultAddress?: { title: string; addressLine: string } | null;
};

export default function SellerProfileScreen({ auth, onBack, onOpenAddresses, onAuthRefresh }: Props) {
  const [currentAuth, setCurrentAuth] = useState(auth);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<"incomplete" | "pending_review" | "active">("incomplete");
  const [defaultAddress, setDefaultAddress] = useState<string>("");
  const [kitchenTitle, setKitchenTitle] = useState("");
  const [kitchenDescription, setKitchenDescription] = useState("");
  const [deliveryRadiusKm, setDeliveryRadiusKm] = useState("3");
  const [workingHoursText, setWorkingHoursText] = useState("Pzt-Cuma 10:00-20:00");

  useEffect(() => setCurrentAuth(auth), [auth]);

  function handleRefresh(session: AuthSession) {
    setCurrentAuth(session);
    onAuthRefresh?.(session);
  }

  async function loadProfile() {
    setLoading(true);
    try {
      const res = await apiRequest<SellerProfileData>("/v1/seller/profile", currentAuth, { actorRole: "seller" }, handleRefresh);
      if (!res.ok) throw new Error(res.message ?? "Satıcı profili yüklenemedi");
      const data = res.data;
      setKitchenTitle(data?.kitchenTitle?.trim() ?? "");
      setKitchenDescription(data?.kitchenDescription?.trim() ?? "");
      setDeliveryRadiusKm(String(data?.deliveryRadiusKm ?? 3));
      setStatus(data?.status ?? "incomplete");
      setDefaultAddress(
        data?.defaultAddress
          ? `${data.defaultAddress.title} - ${data.defaultAddress.addressLine}`
          : "Varsayılan adres yok"
      );
      const hours = (data?.workingHours ?? []).map((x) => `${x.day} ${x.open}-${x.close}`).join(", ");
      if (hours.trim()) setWorkingHoursText(hours);
    } catch (e) {
      Alert.alert("Hata", e instanceof Error ? e.message : "Profil yüklenemedi");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadProfile();
  }, []);

  function parseWorkingHours(value: string): Array<{ day: string; open: string; close: string; enabled: boolean }> {
    const parts = value.split(",").map((x) => x.trim()).filter(Boolean);
    const parsed = parts
      .map((part) => {
        const [day, range] = part.split(" ");
        if (!day || !range || !range.includes("-")) return null;
        const [open, close] = range.split("-");
        return { day, open, close, enabled: true };
      })
      .filter((x): x is { day: string; open: string; close: string; enabled: boolean } => Boolean(x));
    return parsed.length > 0 ? parsed : [{ day: "Her gün", open: "09:00", close: "20:00", enabled: true }];
  }

  async function saveProfile(submitForReview = false) {
    setSaving(true);
    try {
      const res = await apiRequest<SellerProfileData>("/v1/seller/profile", currentAuth, {
        method: "PUT",
        body: {
          kitchenTitle: kitchenTitle.trim(),
          kitchenDescription: kitchenDescription.trim(),
          deliveryRadiusKm: Number(deliveryRadiusKm),
          workingHours: parseWorkingHours(workingHoursText),
          submitForReview,
        },
        actorRole: "seller",
      }, handleRefresh);
      if (!res.ok) throw new Error(res.message ?? "Kaydedilemedi");
      setStatus(res.data?.status ?? "incomplete");
      Alert.alert("Tamam", submitForReview ? "Profil incelemeye gönderildi." : "Profil kaydedildi.");
    } catch (e) {
      Alert.alert("Hata", e instanceof Error ? e.message : "Kaydedilemedi");
    } finally {
      setSaving(false);
    }
  }

  const statusLabel =
    status === "active" ? "Aktif ✓" : status === "pending_review" ? "İncelemede" : "Eksik — profili tamamla";

  return (
    <View style={styles.container}>
      <ScreenHeader title="Satıcı Profili" onBack={onBack} />
      <ScrollView contentContainerStyle={styles.content}>
        {loading ? (
          <Text style={styles.loadingText}>Yükleniyor...</Text>
        ) : (
          <>
            <View style={styles.heroCard}>
              <Text style={styles.heroTitle}>Profilin ne kadar net olursa o kadar iyi satış olur.</Text>
              <Text style={styles.heroText}>Bilgilerini birlikte toparlayalım, müşteri seni daha hızlı keşfetsin.</Text>
            </View>

            <View style={[styles.statusBadge, status === "active" ? styles.statusActive : styles.statusPending]}>
              <Text style={[styles.statusText, status === "active" ? styles.statusTextActive : styles.statusTextPending]}>
                {statusLabel}
              </Text>
            </View>

            <Text style={styles.label}>Varsayılan adres</Text>
            <TouchableOpacity style={styles.addressCard} onPress={onOpenAddresses} activeOpacity={0.85}>
              <Text style={styles.addressText}>{defaultAddress}</Text>
              <Text style={styles.addressAction}>Adresi güncelle →</Text>
            </TouchableOpacity>

            <Text style={styles.label}>Mutfak başlığı</Text>
            <TextInput style={styles.input} value={kitchenTitle} onChangeText={setKitchenTitle} placeholder="Örn: İsmet'in Ev Mutfağı" />

            <Text style={styles.label}>Mutfak açıklaması</Text>
            <TextInput
              style={[styles.input, styles.textArea]}
              value={kitchenDescription}
              onChangeText={setKitchenDescription}
              placeholder="Yemek tarzını ve servis yapını anlat."
              multiline
            />

            <Text style={styles.label}>Teslimat yarıçapı (km)</Text>
            <TextInput style={styles.input} value={deliveryRadiusKm} onChangeText={setDeliveryRadiusKm} keyboardType="numeric" />

            <Text style={styles.label}>Çalışma saatleri</Text>
            <TextInput
              style={styles.input}
              value={workingHoursText}
              onChangeText={setWorkingHoursText}
              placeholder="Pzt 10:00-19:00, Salı 10:00-19:00"
            />

            <View style={styles.gap} />
            <ActionButton label={saving ? "Kaydediliyor..." : "Bilgileri Kaydet"} onPress={() => void saveProfile(false)} disabled={saving} loading={saving} fullWidth />
            <View style={styles.gap} />
            <ActionButton label="İncelemeye Gönder" onPress={() => void saveProfile(true)} disabled={saving} variant="soft" fullWidth />
          </>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#F7F4EF" },
  content: { padding: 16, paddingBottom: 40 },
  loadingText: { textAlign: "center", marginTop: 40, color: "#6C6055" },
  heroCard: { backgroundColor: "#F1E8D9", borderColor: "#E8D6BB", borderWidth: 1, borderRadius: 14, padding: 12, marginBottom: 10 },
  heroTitle: { color: "#4B3422", fontWeight: "800", fontSize: 15, lineHeight: 20 },
  heroText: { color: "#6B5545", marginTop: 4, lineHeight: 18 },
  statusBadge: { borderRadius: 10, paddingHorizontal: 12, paddingVertical: 8, marginBottom: 14, alignSelf: "flex-start" },
  statusActive: { backgroundColor: "#EAF4ED" },
  statusPending: { backgroundColor: "#FFF4E5" },
  statusText: { fontWeight: "700", fontSize: 13 },
  statusTextActive: { color: "#2E6B44" },
  statusTextPending: { color: "#7A4D1B" },
  label: { marginTop: 12, marginBottom: 6, color: "#2E241C", fontWeight: "700" },
  addressCard: { backgroundColor: "#fff", borderRadius: 12, borderWidth: 1, borderColor: "#E4DBCD", padding: 12 },
  addressText: { color: "#4E433A" },
  addressAction: { marginTop: 6, color: theme.primary, fontWeight: "700" },
  input: { backgroundColor: "#fff", borderRadius: 12, borderWidth: 1, borderColor: "#E4DBCD", paddingHorizontal: 12, paddingVertical: 10, color: "#2E241C" },
  textArea: { minHeight: 92, textAlignVertical: "top" },
  gap: { height: 10 },
});
