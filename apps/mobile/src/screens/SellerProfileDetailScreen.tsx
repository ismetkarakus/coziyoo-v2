import React, { useEffect, useState } from "react";
import { ActivityIndicator, KeyboardAvoidingView, Modal, Platform, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import type { AuthSession } from "../utils/auth";
import { refreshAuthSession } from "../utils/auth";
import { actorRoleHeader } from "../utils/actorRole";
import { loadSettings } from "../utils/settings";
import { theme } from "../theme/colors";
import ScreenHeader from "../components/ScreenHeader";

const MODAL_PLACEHOLDER_COLOR = "#A9A7A1";

type Props = {
  auth: AuthSession;
  onBack: () => void;
  onEdit: () => void;
  onOpenFoods: () => void;
  onOpenLots: () => void;
  onOpenOrders: () => void;
  onOpenCompliance: () => void;
  onOpenFinance: () => void;
  onOpenAddresses: () => void;
  onAuthRefresh?: (session: AuthSession) => void;
};

type SellerProfile = {
  displayName?: string | null;
  username?: string | null;
  email?: string | null;
  phone?: string | null;
  kitchenTitle?: string | null;
  kitchenDescription?: string | null;
  kitchenSpecialties?: string[] | null;
  deliveryRadiusKm?: number | null;
  workingHours?: Array<{ day: string; open: string; close: string; enabled?: boolean }>;
  status?: "incomplete" | "pending_review" | "active";
  defaultAddress?: { title: string; addressLine: string } | null;
  requirements?: {
    hasPhone: boolean;
    hasDefaultAddress: boolean;
    hasKitchenTitle: boolean;
    hasKitchenDescription: boolean;
    hasDeliveryRadius: boolean;
    hasWorkingHours: boolean;
    complianceRequiredCount: number;
    complianceUploadedRequiredCount: number;
  };
};

const STATUS_CONFIG = {
  active: { label: "Aktif", bg: "#EFF6F1", color: "#2E6B44", border: "#CFE2D5" },
  pending_review: { label: "İncelemede", bg: "#FFF5E9", color: "#7A4D1B", border: "#F0C995" },
  incomplete: { label: "Eksik", bg: "#FFF0EE", color: "#B42318", border: "#F9CECA" },
};

function InfoRow({ label, value }: { label: string; value: string | null | undefined }) {
  return (
    <View style={styles.infoRow}>
      <Text style={styles.infoLabel}>{label}</Text>
      <Text style={styles.infoValue}>{value?.trim() || "—"}</Text>
    </View>
  );
}

export default function SellerProfileDetailScreen({
  auth,
  onBack,
  onEdit,
  onOpenFoods,
  onOpenLots,
  onOpenOrders,
  onOpenCompliance,
  onOpenFinance,
  onOpenAddresses,
  onAuthRefresh,
}: Props) {
  const [apiUrl, setApiUrl] = useState("http://localhost:3000");
  const [currentAuth, setCurrentAuth] = useState(auth);
  const [loading, setLoading] = useState(true);
  const [profile, setProfile] = useState<SellerProfile | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [masterName, setMasterName] = useState("");
  const [fullName, setFullName] = useState("");
  const [contactEmail, setContactEmail] = useState("");
  const [contactPhone, setContactPhone] = useState("");
  const [cityDistrict, setCityDistrict] = useState("");
  const [addressLine, setAddressLine] = useState("");

  const [isKitchenModalOpen, setIsKitchenModalOpen] = useState(false);
  const [kitchenDescInput, setKitchenDescInput] = useState("");
  const [specialties, setSpecialties] = useState<string[]>([]);
  const [newSpecialty, setNewSpecialty] = useState("");
  const [kitchenSaving, setKitchenSaving] = useState(false);

  useEffect(() => setCurrentAuth(auth), [auth]);

  async function authedFetch(path: string, baseUrl = apiUrl, init?: RequestInit): Promise<Response> {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      Authorization: `Bearer ${currentAuth.accessToken}`,
      ...actorRoleHeader(currentAuth, "seller"),
    };
    let res = await fetch(`${baseUrl}${path}`, { ...init, headers });
    if (res.status !== 401) return res;
    const refreshed = await refreshAuthSession(baseUrl, currentAuth);
    if (!refreshed) return res;
    setCurrentAuth(refreshed);
    onAuthRefresh?.(refreshed);
    return fetch(`${baseUrl}${path}`, {
      ...init,
      headers: { ...headers, Authorization: `Bearer ${refreshed.accessToken}`, ...actorRoleHeader(refreshed, "seller") },
    });
  }

  async function load() {
    setLoading(true);
    setError(null);
    try {
      const settings = await loadSettings();
      const baseUrl = settings.apiUrl;
      setApiUrl(baseUrl);
      const profileRes = await authedFetch("/v1/seller/profile", baseUrl, undefined);
      const profileJson = await profileRes.json();
      if (!profileRes.ok) throw new Error(profileJson?.error?.message ?? "Profil yüklenemedi");
      const loaded = profileJson.data ?? null;
      setProfile(loaded);
      // İlk kayıt akışında sadece e-posta kesin geldiği için modalda sadece e-posta otomatik dolu kalır.
      setMasterName(String((loaded as { username?: string | null } | null)?.username ?? "").replace(/^@+/, ""));
      setFullName("");
      setContactEmail(currentAuth.email?.trim() || auth.email?.trim() || String((loaded as { email?: string | null } | null)?.email ?? "").trim());
      setContactPhone("");
      setCityDistrict("");
      setAddressLine("");
      setKitchenDescInput(loaded?.kitchenDescription?.trim() ?? "");
      setSpecialties(Array.isArray(loaded?.kitchenSpecialties) ? loaded.kitchenSpecialties : []);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Profil yüklenemedi");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { void load(); }, []);

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

  function addSpecialty() {
    const val = newSpecialty.trim();
    if (!val || specialties.includes(val)) return;
    setSpecialties((prev) => [...prev, val]);
    setNewSpecialty("");
  }

  function removeSpecialty(item: string) {
    setSpecialties((prev) => prev.filter((s) => s !== item));
  }

  async function saveKitchen() {
    setKitchenSaving(true);
    try {
      const settings = await loadSettings();
      const baseUrl = settings.apiUrl;
      const res = await authedFetch("/v1/seller/profile", baseUrl, {
        method: "PUT",
        body: JSON.stringify({
          kitchenDescription: kitchenDescInput.trim(),
          kitchenSpecialties: specialties,
        }),
      });
      const json = await res.json();
      if (!res.ok) throw new Error(json?.error?.message ?? "Kaydedilemedi");
      setIsKitchenModalOpen(false);
      void load();
    } catch (e) {
      console.error("[kitchen save]", e);
    } finally {
      setKitchenSaving(false);
    }
  }

  const statusCfg = STATUS_CONFIG[profile?.status ?? "incomplete"];
  const initials = (profile?.displayName ?? "?")
    .split(" ")
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");
  const complianceRequired = profile?.requirements?.complianceRequiredCount ?? 0;
  const complianceUploaded = profile?.requirements?.complianceUploadedRequiredCount ?? 0;

  return (
    <View style={styles.container}>
      <ScreenHeader
        title="Satıcı Profili"
        onBack={onBack}
      />

      {loading ? (
        <ActivityIndicator size="large" color={theme.primary} style={styles.loader} />
      ) : error ? (
        <Text style={styles.errorText}>{error}</Text>
      ) : (
        <ScrollView contentContainerStyle={styles.content}>

          {/* Avatar + İsim + Durum */}
          <View style={styles.heroCard}>
            <View style={styles.avatar}>
              <Text style={styles.avatarText}>{initials}</Text>
            </View>
            <View style={styles.heroInfo}>
              <Text style={styles.displayName}>{profile?.displayName ?? "—"}</Text>
              {profile?.username ? <Text style={styles.kitchenTitle}>@{profile.username}</Text> : null}
              {profile?.kitchenTitle ? <Text style={styles.kitchenTitle}>{profile.kitchenTitle}</Text> : null}
            </View>
            <View style={[styles.statusBadge, { backgroundColor: statusCfg.bg, borderColor: statusCfg.border }]}>
              <Text style={[styles.statusText, { color: statusCfg.color }]}>{statusCfg.label}</Text>
            </View>
          </View>

          {/* Belge Durumu */}
          <TouchableOpacity style={styles.complianceCard} activeOpacity={0.85} onPress={onOpenCompliance}>
            <Text style={styles.complianceTitle}>Belge Durumu</Text>
            <Text style={styles.complianceText}>Tamamlanan: {complianceUploaded}/{complianceRequired}</Text>
            <Text style={styles.complianceAction}>Belgeleri aç →</Text>
          </TouchableOpacity>

          {/* Profili Düzenle */}
          <View style={styles.card}>
            <View style={styles.profileEditCardHeader}>
              <Text style={styles.cardTitleNoCaps}>Profili Düzenle</Text>
              <TouchableOpacity
                style={styles.profileEditIconBtn}
                onPress={() => setIsEditModalOpen(true)}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              >
                <Ionicons name="pencil" size={18} color={theme.primary} />
              </TouchableOpacity>
            </View>
          </View>

          {/* Mutfak Bilgileri */}
          <View style={styles.card}>
            <View style={styles.profileEditCardHeader}>
              <Text style={styles.cardTitle}>Hakkımda</Text>
              <TouchableOpacity
                style={styles.profileEditIconBtn}
                onPress={() => setIsKitchenModalOpen(true)}
                hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}
              >
                <Ionicons name="pencil" size={18} color={theme.primary} />
              </TouchableOpacity>
            </View>
            <InfoRow label="Başlık" value={profile?.kitchenTitle} />
            <InfoRow label="Açıklama" value={profile?.kitchenDescription} />
            <InfoRow label="Teslimat" value={profile?.deliveryRadiusKm ? `${profile.deliveryRadiusKm} km` : null} />
            <InfoRow label="Telefon" value={profile?.phone} />
          </View>

          {/* Çalışma Saatleri */}
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Çalışma Saatleri</Text>
            {(profile?.workingHours ?? []).length > 0 ? (
              profile!.workingHours!.map((h, i) => (
                <View key={i} style={styles.hourRow}>
                  <Text style={styles.hourDay}>{h.day}</Text>
                  <Text style={styles.hourRange}>{h.open} – {h.close}</Text>
                </View>
              ))
            ) : (
              <Text style={styles.infoValue}>—</Text>
            )}
          </View>

          {/* Varsayılan Adres */}
          <TouchableOpacity style={styles.card} onPress={onOpenAddresses} activeOpacity={0.8}>
            <Text style={styles.cardTitle}>Varsayılan Adres</Text>
            {profile?.defaultAddress ? (
              <>
                <Text style={styles.infoValue}>{profile.defaultAddress.title}</Text>
                <Text style={[styles.infoValue, { marginTop: 2, textAlign: "left" }]}>{profile.defaultAddress.addressLine}</Text>
              </>
            ) : (
              <Text style={styles.infoValue}>Adres eklenmemiş</Text>
            )}
            <Text style={styles.addressLink}>Adresleri yönet →</Text>
          </TouchableOpacity>

          {/* Navigasyon Butonları */}
          <TouchableOpacity style={styles.navBtn} onPress={onOpenFoods}>
            <Text style={styles.navBtnText}>Yemeklerim</Text>
            <Text style={styles.navArrow}>›</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.navBtn} onPress={onOpenLots}>
            <Text style={styles.navBtnText}>Lot / Stok</Text>
            <Text style={styles.navArrow}>›</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.navBtn} onPress={onOpenOrders}>
            <Text style={styles.navBtnText}>Sipariş Yönetimi</Text>
            <Text style={styles.navArrow}>›</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.navBtn} onPress={onOpenCompliance}>
            <Text style={styles.navBtnText}>Compliance</Text>
            <Text style={styles.navArrow}>›</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.navBtn} onPress={onOpenFinance}>
            <Text style={styles.navBtnText}>Finans / Payout</Text>
            <Text style={styles.navArrow}>›</Text>
          </TouchableOpacity>

          <TouchableOpacity style={styles.editFullBtn} onPress={onEdit}>
            <Text style={styles.editFullText}>Profili Düzenle</Text>
          </TouchableOpacity>

        </ScrollView>
      )}

      <Modal visible={isEditModalOpen} transparent animationType="fade" onRequestClose={() => setIsEditModalOpen(false)}>
        <KeyboardAvoidingView
          style={styles.modalOverlay}
          behavior={Platform.OS === "ios" ? "padding" : "height"}
          keyboardVerticalOffset={Platform.OS === "ios" ? 18 : 0}
        >
          <View style={styles.modalCard}>
            <ScrollView
              style={styles.modalScroll}
              contentContainerStyle={styles.modalScrollContent}
              keyboardShouldPersistTaps="handled"
              showsVerticalScrollIndicator
            >
              <Text style={styles.modalTitle}>İletişim Bilgileri</Text>

              <Text style={styles.modalLabel}>Kullanıcı Adı (@username)</Text>
              <TextInput
                style={styles.modalInput}
                value={masterName}
                onChangeText={setMasterName}
                autoCapitalize="none"
                placeholder="Örn: lezzetduragi"
                placeholderTextColor={MODAL_PLACEHOLDER_COLOR}
              />

              <Text style={styles.modalLabel}>Adı Soyadı</Text>
              <TextInput
                style={styles.modalInput}
                value={fullName}
                onChangeText={setFullName}
                placeholder="Örn: Ayşe Hanım"
                placeholderTextColor={MODAL_PLACEHOLDER_COLOR}
              />

              <Text style={styles.modalLabel}>E-posta</Text>
              <View style={styles.modalEmailRow}>
                <TextInput
                  style={[styles.modalInput, styles.modalEmailInput]}
                  value={contactEmail}
                  onChangeText={setContactEmail}
                  keyboardType="email-address"
                  autoCapitalize="none"
                  placeholder="Örn: ayse@example.com"
                  placeholderTextColor={MODAL_PLACEHOLDER_COLOR}
                />
                <Ionicons name="shield-checkmark" size={18} color="#2563EB" />
              </View>

              <Text style={styles.modalLabel}>Telefon</Text>
              <TextInput
                style={styles.modalInput}
                value={contactPhone}
                onChangeText={setContactPhone}
                keyboardType="phone-pad"
                placeholder="Örn: 0555 111 22 33"
                placeholderTextColor={MODAL_PLACEHOLDER_COLOR}
              />

              <Text style={styles.modalLabel}>Şehir/İlçe</Text>
              <TextInput
                style={styles.modalInput}
                value={cityDistrict}
                onChangeText={setCityDistrict}
                placeholder="Örn: Kadıköy, İstanbul"
                placeholderTextColor={MODAL_PLACEHOLDER_COLOR}
              />

              <Text style={styles.modalLabel}>Adres</Text>
              <TextInput
                style={[styles.modalInput, styles.modalAddressInput]}
                value={addressLine}
                onChangeText={setAddressLine}
                placeholder="Örn: Rıhtım Cd. No:12, Kadıköy"
                placeholderTextColor={MODAL_PLACEHOLDER_COLOR}
                multiline
              />
            </ScrollView>
            <View style={styles.modalActions}>
              <TouchableOpacity style={styles.modalCancelBtn} onPress={() => setIsEditModalOpen(false)}>
                <Text style={styles.modalCancelText}>İptal</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.modalSaveBtn} onPress={() => setIsEditModalOpen(false)}>
                <Text style={styles.modalSaveText}>Kaydet</Text>
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
      <Modal visible={isKitchenModalOpen} transparent animationType="fade" onRequestClose={() => setIsKitchenModalOpen(false)}>
        <KeyboardAvoidingView
          style={styles.modalOverlay}
          behavior={Platform.OS === "ios" ? "padding" : "height"}
          keyboardVerticalOffset={Platform.OS === "ios" ? 18 : 0}
        >
          <View style={[styles.modalCard, styles.kitchenModalCard]}>
            <View style={styles.kitchenModalBody}>
              <Text style={styles.modalTitle}>Hakkımda</Text>

              <Text style={styles.modalLabel}>Açıklama</Text>
              <TextInput
                style={[styles.modalInput, styles.modalDescInput]}
                value={kitchenDescInput}
                onChangeText={setKitchenDescInput}
                placeholder="Kendinizi ve mutfak deneyiminizi tanıtın"
                placeholderTextColor={MODAL_PLACEHOLDER_COLOR}
                multiline
              />

              <Text style={[styles.modalLabel, { marginTop: 16 }]}>Uzmanlık Alanları</Text>
              {specialties.length > 0 && (
                <View style={styles.tagsRow}>
                  {specialties.map((item) => (
                    <View key={item} style={styles.tag}>
                      <Text style={styles.tagText}>{item}</Text>
                      <TouchableOpacity onPress={() => removeSpecialty(item)} hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}>
                        <Ionicons name="close-circle" size={18} color="#E53935" />
                      </TouchableOpacity>
                    </View>
                  ))}
                </View>
              )}

              <Text style={styles.modalLabel}>Yeni Kategori Ekle</Text>
              <View style={styles.addSpecialtyRow}>
                <TextInput
                  style={[styles.modalInput, styles.addSpecialtyInput]}
                  value={newSpecialty}
                  onChangeText={setNewSpecialty}
                  placeholder="Örn: İtalyan Mutfağı, Vegan Yemekler, Glutensiz Tarifler"
                  placeholderTextColor={MODAL_PLACEHOLDER_COLOR}
                  onSubmitEditing={addSpecialty}
                  returnKeyType="done"
                />
                <TouchableOpacity style={styles.addSpecialtyBtn} onPress={addSpecialty}>
                  <Ionicons name="add" size={22} color="#fff" />
                </TouchableOpacity>
              </View>
            </View>

            <View style={styles.modalActions}>
              <TouchableOpacity style={styles.modalCancelBtn} onPress={() => setIsKitchenModalOpen(false)} disabled={kitchenSaving}>
                <Text style={styles.modalCancelText}>İptal</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.modalSaveBtn} onPress={() => void saveKitchen()} disabled={kitchenSaving}>
                <Text style={styles.modalSaveText}>{kitchenSaving ? "Kaydediliyor..." : "Kaydet"}</Text>
              </TouchableOpacity>
            </View>
          </View>
        </KeyboardAvoidingView>
      </Modal>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#F7F4EF" },
  loader: { marginTop: 60 },
  errorText: { textAlign: "center", marginTop: 40, color: "#B42318" },
  content: { padding: 16, paddingBottom: 40, gap: 10 },

  heroCard: {
    backgroundColor: "#fff",
    borderRadius: 16,
    borderWidth: 1,
    borderColor: "#E5DDCF",
    padding: 16,
    flexDirection: "row",
    alignItems: "center",
    gap: 12,
  },
  avatar: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: "#3F855C",
    alignItems: "center",
    justifyContent: "center",
  },
  avatarText: { color: "#fff", fontSize: 20, fontWeight: "800" },
  heroInfo: { flex: 1 },
  displayName: { fontSize: 17, fontWeight: "800", color: "#2E241C" },
  kitchenTitle: { marginTop: 2, fontSize: 13, color: "#6C6055" },
  statusBadge: {
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 20,
    borderWidth: 1,
  },
  statusText: { fontSize: 12, fontWeight: "700" },


  complianceCard: {
    backgroundColor: "#EFF6F1",
    borderColor: "#CFE2D5",
    borderWidth: 1,
    borderRadius: 12,
    padding: 12,
  },
  complianceTitle: { color: "#2E6B44", fontWeight: "800" },
  complianceText: { marginTop: 4, color: "#2E6B44" },
  complianceAction: { marginTop: 6, color: "#2E6B44", fontWeight: "700" },

  card: {
    backgroundColor: "#fff",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#E5DDCF",
    padding: 14,
    gap: 6,
  },
  profileEditCardHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  cardTitleNoCaps: {
    fontSize: 15,
    fontWeight: "800",
    color: "#2E241C",
  },
  profileEditIconBtn: {
    width: 30,
    height: 30,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#D6CCBD",
    backgroundColor: "#F5F0E8",
    alignItems: "center",
    justifyContent: "center",
  },
  cardTitle: { fontSize: 12, fontWeight: "800", color: "#2E241C", marginBottom: 4, textTransform: "uppercase", letterSpacing: 0.5 },

  infoRow: { flexDirection: "row", justifyContent: "space-between" },
  infoLabel: { fontSize: 13, color: "#9A8C82", flex: 1 },
  infoValue: { fontSize: 13, color: "#2E241C", flex: 2, textAlign: "right" },

  hourRow: { flexDirection: "row", justifyContent: "space-between" },
  hourDay: { fontSize: 13, color: "#4E433A", fontWeight: "600" },
  hourRange: { fontSize: 13, color: "#6C6055" },

  addressLink: { marginTop: 6, color: "#3F855C", fontWeight: "700", fontSize: 13 },

  checkRow: { flexDirection: "row", alignItems: "center", gap: 8 },
  checkOk: { fontSize: 14, color: "#2E6B44", fontWeight: "700", width: 18 },
  checkMissing: { fontSize: 14, color: "#B42318", fontWeight: "700", width: 18 },
  checkLabel: { fontSize: 13, color: "#4E433A" },
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.45)",
    justifyContent: "center",
    padding: 16,
  },
  modalCard: {
    backgroundColor: "#F2F2F2",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#D8D8D8",
    padding: 14,
    maxHeight: "88%",
  },
  kitchenModalCard: {
    maxHeight: "92%",
  },
  kitchenModalBody: {
    paddingBottom: 4,
  },
  modalScroll: {
    maxHeight: "74%",
  },
  modalScrollContent: {
    paddingBottom: 24,
  },
  modalTitle: {
    fontSize: 22,
    fontWeight: "700",
    color: "#1F1F1F",
    marginBottom: 8,
  },
  modalLabel: {
    marginTop: 10,
    marginBottom: 6,
    color: "#2E2E2E",
    fontWeight: "600",
    fontSize: 14,
  },
  modalInput: {
    backgroundColor: "#E7E6E4",
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#C7C7C7",
    height: 42,
    paddingHorizontal: 12,
    color: "#242424",
  },
  modalAddressInput: {
    minHeight: 58,
    textAlignVertical: "top",
    paddingTop: 10,
    paddingBottom: 10,
  },
  modalDescInput: {
    minHeight: 90,
    textAlignVertical: "top",
    paddingTop: 10,
    paddingBottom: 10,
  },
  tagsRow: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 8,
    marginBottom: 10,
  },
  tag: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: "#E7E6E4",
    borderRadius: 20,
    paddingHorizontal: 10,
    paddingVertical: 5,
  },
  tagText: { fontSize: 13, color: "#2E2E2E", fontWeight: "500" },
  addSpecialtyRow: {
    flexDirection: "row",
    gap: 8,
    alignItems: "center",
    marginBottom: 2,
  },
  addSpecialtyInput: { flex: 1 },
  addSpecialtyBtn: {
    width: 42,
    height: 42,
    borderRadius: 8,
    backgroundColor: "#3F855C",
    alignItems: "center",
    justifyContent: "center",
  },
  modalEmailRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  modalEmailInput: {
    flex: 1,
  },
  modalActions: {
    flexDirection: "row",
    gap: 10,
    marginTop: 8,
    paddingTop: 8,
  },
  modalCancelBtn: {
    flex: 1,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#C9C9C9",
    backgroundColor: "#F0F0F0",
    height: 42,
    alignItems: "center",
    justifyContent: "center",
  },
  modalCancelText: {
    color: "#373737",
    fontWeight: "600",
  },
  modalSaveBtn: {
    flex: 1,
    borderRadius: 8,
    backgroundColor: "#8A9A87",
    height: 42,
    alignItems: "center",
    justifyContent: "center",
  },
  modalSaveText: {
    color: "#FFFFFF",
    fontWeight: "700",
  },

  navBtn: {
    backgroundColor: "#fff",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#E5DDCF",
    paddingHorizontal: 16,
    paddingVertical: 14,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  navBtnText: { fontSize: 15, fontWeight: "700", color: "#2E241C" },
  navArrow: { fontSize: 20, color: "#9A8C82" },

  editFullBtn: {
    backgroundColor: "#3F855C",
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: "center",
    marginTop: 4,
  },
  editFullText: { color: "#fff", fontWeight: "700", fontSize: 15 },
});
