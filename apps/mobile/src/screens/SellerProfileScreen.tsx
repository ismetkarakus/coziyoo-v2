import React, { useEffect, useState } from "react";
import { ActivityIndicator, Alert, ScrollView, StyleSheet, Text, TextInput, TouchableOpacity, View } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import type { AuthSession } from "../utils/auth";
import { loadAuthSession, refreshAuthSession } from "../utils/auth";
import { actorRoleHeader } from "../utils/actorRole";
import { loadSettings } from "../utils/settings";
import { theme } from "../theme/colors";
import ScreenHeader from "../components/ScreenHeader";

type Props = {
  auth: AuthSession;
  onBack: () => void;
  onOpenAddresses: () => void;
  onAuthRefresh?: (session: AuthSession) => void;
};

type SellerProfilePayload = {
  data?: {
    displayName?: string | null;
    phone?: string | null;
    kitchenTitle?: string | null;
    kitchenDescription?: string | null;
    deliveryRadiusKm?: number | null;
    workingHours?: Array<{ day: string; open: string; close: string; enabled?: boolean }>;
    status?: "incomplete" | "pending_review" | "active";
    defaultAddress?: { title: string; addressLine: string } | null;
  };
  error?: { message?: string };
};

export default function SellerProfileScreen({ auth, onBack, onOpenAddresses, onAuthRefresh }: Props) {
  const [apiUrl, setApiUrl] = useState("http://localhost:3000");
  const [currentAuth, setCurrentAuth] = useState(auth);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState<"incomplete" | "pending_review" | "active">("incomplete");
  const [defaultAddress, setDefaultAddress] = useState<string>("");
  const [kitchenTitle, setKitchenTitle] = useState("");
  const [kitchenDescription, setKitchenDescription] = useState("");
  const [deliveryRadiusKm, setDeliveryRadiusKm] = useState("3");
  const [workingHoursText, setWorkingHoursText] = useState("Pzt-Cuma 10:00-20:00");
  const [editingDeliveryRadius, setEditingDeliveryRadius] = useState(false);
  const [editingWorkingHours, setEditingWorkingHours] = useState(false);

  useEffect(() => setCurrentAuth(auth), [auth]);

  async function readResponsePayload(res: Response): Promise<{ json: SellerProfilePayload | null; rawText: string }> {
    const rawText = await res.text();
    const trimmed = rawText.trim();
    if (!trimmed) return { json: {}, rawText };
    try {
      return { json: JSON.parse(trimmed) as SellerProfilePayload, rawText };
    } catch {
      return { json: null, rawText };
    }
  }

  function responseErrorMessage(
    res: Response,
    payload: { json: SellerProfilePayload | null; rawText: string },
    fallback: string,
  ): string {
    const apiMessage = payload.json?.error?.message?.trim();
    if (apiMessage) return apiMessage;
    const raw = payload.rawText.trim();
    if (raw.startsWith("<")) return `${fallback} (Sunucu JSON yerine HTML döndü, HTTP ${res.status})`;
    if (raw) return `${fallback}: ${raw.slice(0, 180)}`;
    return `${fallback} (${res.status})`;
  }

  async function authedFetch(path: string, init?: RequestInit, baseUrl = apiUrl): Promise<Response> {
    const makeHeaders = (session: AuthSession): Record<string, string> => ({
      "Content-Type": "application/json",
      Authorization: `Bearer ${session.accessToken}`,
      ...actorRoleHeader(session, "seller"),
      ...(init?.headers as Record<string, string> | undefined),
    });

    const headers = makeHeaders(currentAuth);
    let res = await fetch(`${baseUrl}${path}`, { ...init, headers });
    if (res.status !== 401) return res;

    const persisted = await loadAuthSession();
    if (persisted && persisted.userId === currentAuth.userId && persisted.accessToken !== currentAuth.accessToken) {
      setCurrentAuth(persisted);
      onAuthRefresh?.(persisted);
      res = await fetch(`${baseUrl}${path}`, { ...init, headers: makeHeaders(persisted) });
      if (res.status !== 401) return res;
    }

    const refreshed = await refreshAuthSession(
      baseUrl,
      persisted && persisted.userId === currentAuth.userId ? persisted : currentAuth,
    );
    if (!refreshed) return res;
    setCurrentAuth(refreshed);
    onAuthRefresh?.(refreshed);
    return fetch(`${baseUrl}${path}`, {
      ...init,
      headers: makeHeaders(refreshed),
    });
  }

  async function loadProfile() {
    setLoading(true);
    try {
      const settings = await loadSettings();
      const baseUrl = settings.apiUrl;
      setApiUrl(baseUrl);
      const res = await authedFetch("/v1/seller/profile", undefined, baseUrl);
      const payload = await readResponsePayload(res);
      if (!res.ok || payload.json === null) throw new Error(responseErrorMessage(res, payload, "Satıcı profili yüklenemedi"));
      const json = payload.json;
      setKitchenTitle(json.data?.kitchenTitle?.trim() ?? "");
      setKitchenDescription(json.data?.kitchenDescription?.trim() ?? "");
      setDeliveryRadiusKm(String(json.data?.deliveryRadiusKm ?? 3));
      setStatus(json.data?.status ?? "incomplete");
      setDefaultAddress(json.data?.defaultAddress ? `${json.data.defaultAddress.title} - ${json.data.defaultAddress.addressLine}` : "Varsayılan adres yok");
      const hours = (json.data?.workingHours ?? []).map((x) => `${x.day} ${x.open}-${x.close}`).join(", ");
      if (hours.trim()) setWorkingHoursText(hours);
      setEditingDeliveryRadius(false);
      setEditingWorkingHours(false);
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
      const baseUrl = (await loadSettings()).apiUrl;
      const res = await authedFetch("/v1/seller/profile", {
        method: "PUT",
        body: JSON.stringify({
          kitchenTitle: kitchenTitle.trim(),
          kitchenDescription: kitchenDescription.trim(),
          deliveryRadiusKm: Number(deliveryRadiusKm),
          workingHours: parseWorkingHours(workingHoursText),
          submitForReview,
        }),
      }, baseUrl);
      const payload = await readResponsePayload(res);
      if (!res.ok || payload.json === null) throw new Error(responseErrorMessage(res, payload, "Kaydedilemedi"));
      const json = payload.json;
      const nextStatus = json.data?.status ?? "incomplete";
      setStatus(nextStatus);
      Alert.alert("Tamam", submitForReview ? "Profil incelemeye gönderildi." : "Profil kaydedildi.");
    } catch (e) {
      Alert.alert("Hata", e instanceof Error ? e.message : "Kaydedilemedi");
    } finally {
      setSaving(false);
    }
  }

  return (
    <View style={styles.container}>
      <ScreenHeader title="Profili Düzenle" onBack={onBack} />
      <ScrollView contentContainerStyle={styles.content}>
      {loading ? (
        <ActivityIndicator size="large" color={theme.primary} />
      ) : (
        <>
          <Text style={styles.label}>Varsayılan adres</Text>
          <TouchableOpacity style={styles.addressCard} onPress={onOpenAddresses}>
            <Text style={styles.addressText}>{defaultAddress}</Text>
            <Text style={styles.addressAction}>Adresi düzenle</Text>
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
          <View style={styles.readOnlyCard}>
            <View style={styles.readOnlyHeader}>
              <Text style={styles.readOnlyValue}>{deliveryRadiusKm?.trim() ? `${deliveryRadiusKm} km` : "Henüz eklenmedi"}</Text>
              <TouchableOpacity
                style={styles.editIconBtn}
                onPress={() => setEditingDeliveryRadius((prev) => !prev)}
                hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
              >
                <Ionicons name="pencil" size={16} color="#3F855C" />
              </TouchableOpacity>
            </View>
            {editingDeliveryRadius ? (
              <TextInput
                style={styles.input}
                value={deliveryRadiusKm}
                onChangeText={setDeliveryRadiusKm}
                keyboardType="numeric"
                placeholder="Örn: 5"
              />
            ) : null}
          </View>

          <Text style={styles.label}>Çalışma saatleri</Text>
          <View style={styles.readOnlyCard}>
            <View style={styles.readOnlyHeader}>
              <Text style={styles.readOnlyValue}>
                {workingHoursText?.trim() ? workingHoursText : "Henüz eklenmedi"}
              </Text>
              <TouchableOpacity
                style={styles.editIconBtn}
                onPress={() => setEditingWorkingHours((prev) => !prev)}
                hitSlop={{ top: 6, bottom: 6, left: 6, right: 6 }}
              >
                <Ionicons name="pencil" size={16} color="#3F855C" />
              </TouchableOpacity>
            </View>
            {editingWorkingHours ? (
              <TextInput
                style={styles.input}
                value={workingHoursText}
                onChangeText={setWorkingHoursText}
                placeholder="Pzt 10:00-19:00, Salı 10:00-19:00"
              />
            ) : null}
          </View>

          <TouchableOpacity style={styles.saveBtn} disabled={saving} onPress={() => void saveProfile(false)}>
            <Text style={styles.saveText}>{saving ? "Kaydediliyor..." : "Kaydet"}</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.submitBtn} disabled={saving} onPress={() => void saveProfile(true)}>
            <Text style={styles.submitText}>İncelemeye Gönder</Text>
          </TouchableOpacity>
        </>
      )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#F7F4EF" },
  content: { padding: 16, paddingBottom: 40 },
  label: { marginTop: 10, marginBottom: 6, color: "#2E241C", fontWeight: "700" },
  addressCard: { backgroundColor: "#fff", borderRadius: 12, borderWidth: 1, borderColor: "#E4DBCD", padding: 12 },
  addressText: { color: "#4E433A" },
  addressAction: { marginTop: 6, color: "#3F855C", fontWeight: "700" },
  input: { backgroundColor: "#fff", borderRadius: 12, borderWidth: 1, borderColor: "#E4DBCD", paddingHorizontal: 12, paddingVertical: 10, color: "#2E241C" },
  textArea: { minHeight: 92, textAlignVertical: "top" },
  readOnlyCard: {
    backgroundColor: "#fff",
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#E4DBCD",
    padding: 10,
    gap: 8,
  },
  readOnlyHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: 12,
  },
  readOnlyValue: {
    flex: 1,
    color: "#2E241C",
    fontSize: 14,
    fontWeight: "600",
  },
  editIconBtn: {
    width: 28,
    height: 28,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#D6CCBD",
    backgroundColor: "#F5F0E8",
    alignItems: "center",
    justifyContent: "center",
  },
  saveBtn: { marginTop: 14, backgroundColor: "#3F855C", borderRadius: 12, paddingVertical: 13, alignItems: "center" },
  saveText: { color: "#fff", fontWeight: "700" },
  submitBtn: { marginTop: 10, backgroundColor: "#EFE9DF", borderRadius: 12, paddingVertical: 13, alignItems: "center" },
  submitText: { color: "#5F5348", fontWeight: "700" },
});
