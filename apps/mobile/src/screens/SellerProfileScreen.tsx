import React, { useEffect, useMemo, useState } from "react";
import { Alert, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
import * as ImagePicker from "expo-image-picker";
import type { AuthSession } from "../utils/auth";
import { apiRequest } from "../utils/api";
import ScreenHeader from "../components/ScreenHeader";
import { theme } from "../theme/colors";

type Props = {
  auth: AuthSession;
  onBack: () => void;
  onOpenAddresses: () => void;
  onOpenCompliance?: () => void;
  onAuthRefresh?: (session: AuthSession) => void;
  onLogout?: () => void;
};

type WorkingHour = { day: string; open: string; close: string; enabled?: boolean };

type SellerProfileData = {
  displayName?: string | null;
  phone?: string | null;
  kitchenTitle?: string | null;
  kitchenDescription?: string | null;
  deliveryRadiusKm?: number | null;
  workingHours?: WorkingHour[];
  status?: "incomplete" | "pending_review" | "active";
  defaultAddress?: { title: string; addressLine: string } | null;
  requirements?: {
    complianceRequiredCount?: number;
    complianceUploadedRequiredCount?: number;
    complianceMissingRequiredCount?: number;
    canOperate?: boolean;
  };
};

type ComplianceDocument = {
  id: string;
  name?: string;
  code?: string;
  status?: string;
  isRequired?: boolean;
  rejectionReason?: string | null;
  uploadedAt?: string | null;
};

type ComplianceData = {
  profile?: {
    requiredCount?: number;
    approvedRequiredCount?: number;
    uploadedRequiredCount?: number;
    requestedRequiredCount?: number;
    rejectedRequiredCount?: number;
  };
  documents?: ComplianceDocument[];
};

function normalizeDocuments(raw: Array<Record<string, unknown>> | undefined): ComplianceDocument[] {
  if (!Array.isArray(raw)) return [];
  return raw.map((doc) => ({
    id: String(doc.id ?? ""),
    name: typeof doc.name === "string" ? doc.name : undefined,
    code: typeof doc.code === "string" ? doc.code : undefined,
    status: typeof doc.status === "string" ? doc.status : undefined,
    isRequired: Boolean(doc.is_required ?? doc.isRequired),
    rejectionReason: typeof doc.rejection_reason === "string" ? doc.rejection_reason : null,
    uploadedAt: typeof doc.uploaded_at === "string" ? doc.uploaded_at : null,
  }));
}

export default function SellerProfileScreen({
  auth,
  onBack,
  onOpenAddresses,
  onOpenCompliance,
  onAuthRefresh,
  onLogout,
}: Props) {
  const [currentAuth, setCurrentAuth] = useState(auth);
  const [loading, setLoading] = useState(true);
  const [savingProfile, setSavingProfile] = useState(false);
  const [savingBank, setSavingBank] = useState(false);
  const [uploadingDocCode, setUploadingDocCode] = useState<string | null>(null);
  const [complianceExpanded, setComplianceExpanded] = useState(false);

  const [profileData, setProfileData] = useState<SellerProfileData | null>(null);
  const [complianceData, setComplianceData] = useState<ComplianceData | null>(null);

  const [kitchenTitle, setKitchenTitle] = useState("");
  const [kitchenDescription, setKitchenDescription] = useState("");
  const [deliveryRadiusKm, setDeliveryRadiusKm] = useState("3");
  const [workingHoursText, setWorkingHoursText] = useState("Pzt-Cuma 10:00-20:00");

  const [bankName, setBankName] = useState("");
  const [accountHolder, setAccountHolder] = useState("");
  const [iban, setIban] = useState("");
  const [accountNumber, setAccountNumber] = useState("");

  useEffect(() => setCurrentAuth(auth), [auth]);

  function handleRefresh(session: AuthSession) {
    setCurrentAuth(session);
    onAuthRefresh?.(session);
  }

  async function loadData() {
    setLoading(true);
    try {
      const [profileRes, complianceRes] = await Promise.all([
        apiRequest<SellerProfileData>("/v1/seller/profile", currentAuth, { actorRole: "seller" }, handleRefresh),
        apiRequest<{ profile?: Record<string, unknown>; documents?: Array<Record<string, unknown>> }>(
          "/v1/seller/compliance/profile",
          currentAuth,
          { actorRole: "seller" },
          handleRefresh,
        ),
      ]);

      if (!profileRes.ok) throw new Error(profileRes.message ?? "Satıcı profili yüklenemedi");
      if (!complianceRes.ok) throw new Error(complianceRes.message ?? "Belge durumu yüklenemedi");

      const p = profileRes.data ?? null;
      setProfileData(p);
      setKitchenTitle(p?.kitchenTitle?.trim() ?? "");
      setKitchenDescription(p?.kitchenDescription?.trim() ?? "");
      setDeliveryRadiusKm(String(p?.deliveryRadiusKm ?? 3));
      const hours = (p?.workingHours ?? [])
        .map((x) => `${x.day} ${x.open}-${x.close}`)
        .join(", ");
      setWorkingHoursText(hours.trim() ? hours : "Pzt-Cuma 10:00-20:00");

      const cp = complianceRes.data;
      setComplianceData({
        profile: {
          requiredCount: Number(cp?.profile?.required_count ?? 0),
          approvedRequiredCount: Number(cp?.profile?.approved_required_count ?? 0),
          uploadedRequiredCount: Number(cp?.profile?.uploaded_required_count ?? 0),
          requestedRequiredCount: Number(cp?.profile?.requested_required_count ?? 0),
          rejectedRequiredCount: Number(cp?.profile?.rejected_required_count ?? 0),
        },
        documents: normalizeDocuments(cp?.documents),
      });
    } catch (e) {
      Alert.alert("Hata", e instanceof Error ? e.message : "Profil yüklenemedi");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadData();
  }, []);

  const requiredDocs = useMemo(
    () => (complianceData?.documents ?? []).filter((doc) => doc.isRequired),
    [complianceData?.documents],
  );

  const totalRequired =
    Number(complianceData?.profile?.requiredCount ?? profileData?.requirements?.complianceRequiredCount ?? 0);
  const uploadedRequired =
    Number(complianceData?.profile?.uploadedRequiredCount ?? profileData?.requirements?.complianceUploadedRequiredCount ?? 0);

  function parseWorkingHours(value: string): WorkingHour[] {
    const parts = value
      .split(",")
      .map((x) => x.trim())
      .filter(Boolean);
    const parsed = parts
      .map((part): WorkingHour | null => {
        const [day, range] = part.split(" ");
        if (!day || !range || !range.includes("-")) return null;
        const [open, close] = range.split("-");
        return { day, open, close, enabled: true };
      })
      .filter((x): x is WorkingHour => x !== null);

    return parsed.length > 0
      ? parsed
      : [{ day: "Her gün", open: "09:00", close: "20:00", enabled: true }];
  }

  async function saveProfile() {
    setSavingProfile(true);
    try {
      const res = await apiRequest<SellerProfileData>(
        "/v1/seller/profile",
        currentAuth,
        {
          method: "PUT",
          body: {
            kitchenTitle: kitchenTitle.trim(),
            kitchenDescription: kitchenDescription.trim(),
            deliveryRadiusKm: Number(deliveryRadiusKm),
            workingHours: parseWorkingHours(workingHoursText),
          },
          actorRole: "seller",
        },
        handleRefresh,
      );
      if (!res.ok) throw new Error(res.message ?? "Profil kaydedilemedi");
      Alert.alert("Tamam", "Profil bilgilerin güncellendi.");
      await loadData();
    } catch (e) {
      Alert.alert("Hata", e instanceof Error ? e.message : "Profil kaydedilemedi");
    } finally {
      setSavingProfile(false);
    }
  }

  async function saveBankAccount() {
    if (!iban.trim() || !accountHolder.trim()) {
      Alert.alert("Eksik Bilgi", "IBAN ve hesap sahibi adı zorunlu.");
      return;
    }
    setSavingBank(true);
    try {
      const res = await apiRequest(`/v1/sellers/${currentAuth.userId}/bank-account`, currentAuth, {
        method: "PUT",
        body: {
          iban: iban.trim(),
          accountHolderName: accountHolder.trim(),
          bankCode: bankName.trim() || undefined,
        },
        actorRole: "seller",
      }, handleRefresh);

      if (!res.ok) throw new Error(res.message ?? "Banka bilgisi kaydedilemedi");
      Alert.alert("Tamam", "Banka bilgilerini kaydettim.");
    } catch (e) {
      Alert.alert("Hata", e instanceof Error ? e.message : "Banka bilgisi kaydedilemedi");
    } finally {
      setSavingBank(false);
    }
  }

  async function pickAndUploadDocument(docCode: string) {
    if (!docCode) return;
    try {
      const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted) {
        Alert.alert("İzin Gerekli", "Belge yüklemek için galeri izni gerekiyor.");
        return;
      }

      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ImagePicker.MediaTypeOptions.Images,
        quality: 0.8,
        allowsEditing: false,
        base64: true,
      });
      if (result.canceled || !result.assets?.length) return;

      const asset = result.assets[0];
      if (!asset.base64) {
        Alert.alert("Hata", "Belge okunamadı.");
        return;
      }

      setUploadingDocCode(docCode);
      const uploadRes = await apiRequest(
        "/v1/seller/compliance/documents",
        currentAuth,
        {
          method: "POST",
          body: {
            docType: docCode,
            dataBase64: asset.base64,
            contentType: asset.mimeType ?? "image/jpeg",
          },
          actorRole: "seller",
        },
        handleRefresh,
      );
      if (!uploadRes.ok) throw new Error(uploadRes.message ?? "Belge yüklenemedi");
      await loadData();
      Alert.alert("Tamam", "Belge yüklendi.");
    } catch (e) {
      Alert.alert("Hata", e instanceof Error ? e.message : "Belge yüklenemedi");
    } finally {
      setUploadingDocCode(null);
    }
  }

  const avatarLetter = (profileData?.displayName || profileData?.kitchenTitle || "U").slice(0, 1).toUpperCase();

  return (
    <View style={styles.container}>
      <ScreenHeader title="Satıcı Profili" onBack={onBack} />
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.avatarWrap}>
          <View style={styles.avatarCircle}>
            <Text style={styles.avatarLetter}>{avatarLetter}</Text>
          </View>
          <TouchableOpacity style={styles.avatarEdit} activeOpacity={0.85}>
            <Text style={styles.avatarEditText}>📷</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.card}>
          <TouchableOpacity style={styles.complianceHeader} onPress={() => setComplianceExpanded((v) => !v)} activeOpacity={0.85}>
            <View>
              <Text style={styles.cardTitle}>🇹🇷 Türkiye Gıda İşletmesi Uygunluğu</Text>
              <Text style={styles.muted}>{totalRequired} gereksinim</Text>
            </View>
            <View style={styles.complianceRight}>
              <Text style={styles.statusPill}>✅ TAMAMLANDI</Text>
              <Text style={styles.expandIcon}>{complianceExpanded ? "⌃" : "⌄"}</Text>
            </View>
          </TouchableOpacity>
          <View style={styles.progressTrack}>
            <View style={[styles.progressFill, { width: `${Math.max(0, Math.min(100, totalRequired ? (uploadedRequired / totalRequired) * 100 : 0))}%` }]} />
          </View>

          {complianceExpanded ? (
            <View style={styles.docsList}>
              {requiredDocs.map((doc) => {
                const isUploading = uploadingDocCode === (doc.code ?? "");
                return (
                  <View key={doc.id} style={styles.docRow}>
                    <View style={styles.docLeft}>
                      <Text style={styles.docName}>✅ {doc.name || doc.code || "Belge"}</Text>
                      <Text style={styles.docHint}>Durum: {doc.status || "-"}</Text>
                      {doc.rejectionReason ? <Text style={styles.docReject}>Red: {doc.rejectionReason}</Text> : null}
                    </View>
                    <TouchableOpacity
                      style={styles.docAction}
                      onPress={() => void pickAndUploadDocument(doc.code ?? "")}
                      disabled={isUploading || !doc.code}
                    >
                      <Text style={styles.docActionText}>{isUploading ? "Yükleniyor" : "Düzenle"}</Text>
                    </TouchableOpacity>
                  </View>
                );
              })}

              <TouchableOpacity style={styles.termsBtn} onPress={onOpenCompliance}>
                <Text style={styles.termsText}>Şartlar ve Koşullar</Text>
              </TouchableOpacity>
            </View>
          ) : null}
        </View>

        <View style={styles.card}>
          <View style={styles.cardHeadRow}>
            <Text style={styles.cardSectionTitle}>İletişim Bilgileri</Text>
            <TouchableOpacity onPress={() => Alert.alert("Bilgi", "İletişim bilgilerini profil düzenleme adımından güncelleyebilirsin.")}>
              <Text style={styles.editIcon}>✎</Text>
            </TouchableOpacity>
          </View>
          <Text style={styles.itemLine}>👤 {profileData?.displayName || "-"}</Text>
          <Text style={styles.itemLine}>✉️ {currentAuth.email}</Text>
          <Text style={styles.itemLine}>📞 {profileData?.phone || "Telefon bilgisi yok"}</Text>
        </View>

        <View style={styles.card}>
          <View style={styles.cardHeadRow}>
            <Text style={styles.cardSectionTitle}>Konum Bilgileri</Text>
            <TouchableOpacity onPress={onOpenAddresses}>
              <Text style={styles.editIcon}>✎</Text>
            </TouchableOpacity>
          </View>
          <Text style={styles.itemLine}>📍 {profileData?.defaultAddress?.title || "Şehir bilgisi yok"}</Text>
          <Text style={styles.itemLine}>🏠 {profileData?.defaultAddress?.addressLine || "Varsayılan adres yok"}</Text>

          <Text style={styles.inputLabel}>Teslimat Mesafesi (km)</Text>
          <TextInput
            style={styles.input}
            value={deliveryRadiusKm}
            onChangeText={setDeliveryRadiusKm}
            placeholder="Örn: 5"
            keyboardType="numeric"
            placeholderTextColor="#8F8A82"
          />

          <View style={styles.formActions}>
            <TouchableOpacity style={[styles.actionBtn, styles.actionBtnGhost]} onPress={() => void loadData()}>
              <Text style={styles.actionGhostText}>İptal</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.actionBtn, styles.actionBtnPrimary]} onPress={() => void saveProfile()} disabled={savingProfile}>
              <Text style={styles.actionPrimaryText}>{savingProfile ? "Kaydediliyor..." : "Kaydet"}</Text>
            </TouchableOpacity>
          </View>
        </View>

        <View style={styles.card}>
          <View style={styles.cardHeadRow}>
            <Text style={styles.cardSectionTitle}>Hakkımda</Text>
            <TouchableOpacity onPress={() => null}>
              <Text style={styles.editIcon}>✎</Text>
            </TouchableOpacity>
          </View>

          <Text style={styles.inputLabel}>Açıklama</Text>
          <TextInput
            style={[styles.input, styles.area]}
            value={kitchenDescription}
            onChangeText={setKitchenDescription}
            placeholder="Ev yapımı, sağlıklı ve geleneksel tarifler..."
            placeholderTextColor="#8F8A82"
            multiline
          />

          <Text style={styles.inputLabel}>Uzmanlık Alanları</Text>
          <View style={styles.chipsWrap}>
            <Text style={styles.chip}>Zeytinyağlılar</Text>
            <Text style={styles.chip}>Ev Yapımı Mantı</Text>
            <Text style={styles.chip}>Fırın Yemekleri</Text>
          </View>

          <Text style={styles.inputLabel}>Usta Adı / Mutfak Başlığı</Text>
          <TextInput
            style={styles.input}
            value={kitchenTitle}
            onChangeText={setKitchenTitle}
            placeholder="Örn: Ayşe Hanım Mutfağı"
            placeholderTextColor="#8F8A82"
          />

          <Text style={styles.inputLabel}>Çalışma Saatleri</Text>
          <TextInput
            style={styles.input}
            value={workingHoursText}
            onChangeText={setWorkingHoursText}
            placeholder="Pzt-Cuma 10:00-20:00"
            placeholderTextColor="#8F8A82"
          />

          <View style={styles.formActions}>
            <TouchableOpacity style={[styles.actionBtn, styles.actionBtnGhost]} onPress={() => void loadData()}>
              <Text style={styles.actionGhostText}>İptal</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.actionBtn, styles.actionBtnPrimary]} onPress={() => void saveProfile()} disabled={savingProfile}>
              <Text style={styles.actionPrimaryText}>{savingProfile ? "Kaydediliyor..." : "Kaydet"}</Text>
            </TouchableOpacity>
          </View>
        </View>

        <View style={styles.card}>
          <View style={styles.cardHeadRow}>
            <Text style={styles.cardSectionTitle}>Kimlik Doğrulama</Text>
            <TouchableOpacity onPress={onOpenCompliance}>
              <Text style={styles.editIcon}>✎</Text>
            </TouchableOpacity>
          </View>

          <View style={styles.identityGrid}>
            <View style={styles.identityBox}>
              <Text style={styles.identityTitle}>Kimlik Ön Yüzü</Text>
              <Text style={styles.identityHint}>Kimlik ön yüzü yükle</Text>
            </View>
            <View style={styles.identityBox}>
              <Text style={styles.identityTitle}>Kimlik Arka Yüzü</Text>
              <Text style={styles.identityHint}>Kimlik arka yüzü yükle</Text>
            </View>
          </View>

          <View style={styles.warnBox}>
            <Text style={styles.warnText}>
              ℹ️ Kimlik belgelerin güvenlik için şifreli tutulur ve sadece doğrulama amacıyla kullanılır.
            </Text>
          </View>

          <View style={styles.formActions}>
            <TouchableOpacity style={[styles.actionBtn, styles.actionBtnGhost]} onPress={() => null}>
              <Text style={styles.actionGhostText}>İptal</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.actionBtn, styles.actionBtnPrimary]} onPress={onOpenCompliance}>
              <Text style={styles.actionPrimaryText}>Kaydet</Text>
            </TouchableOpacity>
          </View>
        </View>

        <View style={styles.card}>
          <View style={styles.cardHeadRow}>
            <Text style={styles.cardSectionTitle}>Banka Bilgileri</Text>
            <TouchableOpacity onPress={() => null}>
              <Text style={styles.editIcon}>✎</Text>
            </TouchableOpacity>
          </View>

          <Text style={styles.inputLabel}>Banka Adı</Text>
          <TextInput
            style={styles.input}
            value={bankName}
            onChangeText={setBankName}
            placeholder="Örn: Türkiye İş Bankası"
            placeholderTextColor="#8F8A82"
          />

          <Text style={styles.inputLabel}>Hesap Sahibi Adı</Text>
          <TextInput
            style={styles.input}
            value={accountHolder}
            onChangeText={setAccountHolder}
            placeholder="Hesap sahibinin tam adı"
            placeholderTextColor="#8F8A82"
          />

          <Text style={styles.inputLabel}>IBAN</Text>
          <TextInput
            style={styles.input}
            value={iban}
            onChangeText={setIban}
            placeholder="TR00 0000 0000 0000 0000 0000 00"
            placeholderTextColor="#8F8A82"
            autoCapitalize="characters"
          />

          <Text style={styles.inputLabel}>Hesap Numarası</Text>
          <TextInput
            style={styles.input}
            value={accountNumber}
            onChangeText={setAccountNumber}
            placeholder="Hesap numaranız"
            placeholderTextColor="#8F8A82"
          />

          <View style={styles.formActions}>
            <TouchableOpacity style={[styles.actionBtn, styles.actionBtnGhost]} onPress={() => { setBankName(""); setAccountHolder(""); setIban(""); setAccountNumber(""); }}>
              <Text style={styles.actionGhostText}>İptal</Text>
            </TouchableOpacity>
            <TouchableOpacity style={[styles.actionBtn, styles.actionBtnPrimary]} onPress={() => void saveBankAccount()} disabled={savingBank}>
              <Text style={styles.actionPrimaryText}>{savingBank ? "Kaydediliyor..." : "Kaydet"}</Text>
            </TouchableOpacity>
          </View>
        </View>

        <TouchableOpacity style={styles.logoutBtn} onPress={onLogout ?? onBack}>
          <Text style={styles.logoutText}>Çıkış Yap</Text>
        </TouchableOpacity>

        {loading ? <Text style={styles.loading}>Yükleniyor...</Text> : null}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#ECEBE7" },
  content: { padding: 10, paddingBottom: 28, gap: 8 },
  avatarWrap: { alignItems: "center", marginBottom: 4 },
  avatarCircle: {
    width: 74,
    height: 74,
    borderRadius: 37,
    backgroundColor: "#A7B6AA",
    borderWidth: 2,
    borderColor: "#DCE4DB",
    alignItems: "center",
    justifyContent: "center",
  },
  avatarLetter: { color: "#fff", fontWeight: "800", fontSize: 28 },
  avatarEdit: {
    marginTop: -12,
    marginLeft: 52,
    width: 26,
    height: 26,
    borderRadius: 13,
    backgroundColor: "#8DA18F",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 2,
    borderColor: "#ECEBE7",
  },
  avatarEditText: { fontSize: 11 },

  card: {
    backgroundColor: "#F7F7F7",
    borderWidth: 1,
    borderColor: "#D4D4CF",
    borderRadius: 12,
    padding: 10,
  },
  cardTitle: { fontWeight: "800", fontSize: 18, color: "#2F2D2B" },
  muted: { marginTop: 6, color: "#7A756E" },

  complianceHeader: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  complianceRight: { flexDirection: "row", alignItems: "center", gap: 6 },
  statusPill: {
    color: "#2A7A44",
    backgroundColor: "#E6F4E8",
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 12,
    fontSize: 11,
    fontWeight: "800",
  },
  expandIcon: { color: "#7A756E", fontSize: 16, fontWeight: "700" },

  progressTrack: {
    marginTop: 10,
    backgroundColor: "#DDE4DB",
    borderRadius: 999,
    height: 6,
    overflow: "hidden",
  },
  progressFill: { height: 6, backgroundColor: "#34A853" },

  docsList: { marginTop: 10, gap: 8 },
  docRow: {
    borderWidth: 1,
    borderColor: "#D8D7D2",
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 10,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: "#EFEFEB",
  },
  docLeft: { flex: 1, paddingRight: 8 },
  docName: { color: "#2F2D2B", fontWeight: "700" },
  docHint: { color: "#7A756E", marginTop: 2 },
  docReject: { color: "#B42318", marginTop: 2, fontSize: 12 },
  docAction: { paddingHorizontal: 8, paddingVertical: 6 },
  docActionText: { color: "#7E987F", fontWeight: "700" },
  termsBtn: {
    marginTop: 4,
    borderRadius: 10,
    backgroundColor: "#ECEEEA",
    paddingVertical: 10,
    alignItems: "center",
  },
  termsText: { color: "#7E987F", fontWeight: "700" },

  cardHeadRow: { flexDirection: "row", justifyContent: "space-between", alignItems: "center", marginBottom: 6 },
  cardSectionTitle: { fontWeight: "800", fontSize: 30 / 2, color: "#2F2D2B" },
  editIcon: {
    color: "#849685",
    fontSize: 13,
    borderWidth: 1,
    borderColor: "#C9CEC5",
    width: 24,
    height: 24,
    borderRadius: 12,
    textAlign: "center",
    textAlignVertical: "center",
    lineHeight: 20,
    backgroundColor: "#EEF0EB",
  },

  itemLine: { color: "#36332F", marginTop: 4, fontSize: 14 },
  inputLabel: { marginTop: 10, marginBottom: 4, color: "#2F2D2B", fontWeight: "700" },
  input: {
    backgroundColor: "#ECEBE8",
    borderWidth: 1,
    borderColor: "#CFCFC9",
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 9,
    color: "#2F2D2B",
  },
  area: { minHeight: 78, textAlignVertical: "top" },
  chipsWrap: { flexDirection: "row", flexWrap: "wrap", gap: 8, marginTop: 4 },
  chip: {
    borderRadius: 999,
    borderWidth: 1,
    borderColor: "#C6D0C5",
    backgroundColor: "#EDF3ED",
    color: "#466347",
    paddingHorizontal: 10,
    paddingVertical: 5,
    fontWeight: "600",
    fontSize: 12,
  },

  identityGrid: { flexDirection: "row", gap: 10, marginTop: 4 },
  identityBox: {
    flex: 1,
    borderWidth: 1,
    borderColor: "#CECECA",
    borderStyle: "dashed",
    borderRadius: 10,
    minHeight: 90,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#F2F2F0",
  },
  identityTitle: { color: "#2F2D2B", fontWeight: "700", marginBottom: 4 },
  identityHint: { color: "#8A847C", fontSize: 12 },

  warnBox: {
    marginTop: 10,
    borderWidth: 1,
    borderColor: "#F59E0B",
    backgroundColor: "#FFF6E9",
    borderRadius: 8,
    padding: 10,
  },
  warnText: { color: "#C97900", fontWeight: "600", fontSize: 12 },

  formActions: { flexDirection: "row", gap: 8, marginTop: 10 },
  actionBtn: { flex: 1, borderRadius: 8, paddingVertical: 12, alignItems: "center", borderWidth: 1 },
  actionBtnGhost: { backgroundColor: "#F4F4F2", borderColor: "#CFCFC9" },
  actionBtnPrimary: { backgroundColor: "#8EA18F", borderColor: "#8EA18F" },
  actionGhostText: { color: "#38342F", fontWeight: "700" },
  actionPrimaryText: { color: "#fff", fontWeight: "800" },

  logoutBtn: {
    marginTop: 2,
    backgroundColor: "#FF3B30",
    borderRadius: 10,
    paddingVertical: 13,
    alignItems: "center",
  },
  logoutText: { color: "#fff", fontWeight: "800", fontSize: 16 },
  loading: { textAlign: "center", color: theme.primary, marginTop: 8, marginBottom: 10 },
});
