import React, { useEffect, useState } from "react";
import { ActivityIndicator, Alert, ScrollView, StyleSheet, Text, View } from "react-native";
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

type CompliancePayload = {
  data?: {
    profile?: {
      status?: string;
      required_count?: number;
      approved_required_count?: number;
      uploaded_required_count?: number;
      requested_required_count?: number;
      rejected_required_count?: number;
    };
    documents?: Array<{ id: string; name?: string; code?: string; status?: string; is_required?: boolean }>;
    optionalUploads?: Array<{ id: string; custom_title?: string | null; status?: string }>;
  };
};

export default function SellerComplianceScreen({ auth, onBack, onAuthRefresh }: Props) {
  const [apiUrl, setApiUrl] = useState("http://localhost:3000");
  const [currentAuth, setCurrentAuth] = useState(auth);
  const [loading, setLoading] = useState(true);
  const [payload, setPayload] = useState<CompliancePayload["data"] | null>(null);

  useEffect(() => setCurrentAuth(auth), [auth]);

  async function authedFetch(path: string, baseUrl = apiUrl): Promise<Response> {
    const headers = {
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

  async function loadData() {
    setLoading(true);
    try {
      const settings = await loadSettings();
      const baseUrl = settings.apiUrl;
      setApiUrl(baseUrl);
      const res = await authedFetch("/v1/seller/compliance/profile", baseUrl);
      const json = (await res.json()) as CompliancePayload;
      if (!res.ok) throw new Error((json as any)?.error?.message ?? "Compliance yüklenemedi");
      setPayload(json.data ?? null);
    } catch (e) {
      Alert.alert("Hata", e instanceof Error ? e.message : "Compliance yüklenemedi");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadData();
  }, []);

  return (
    <ScrollView style={styles.container} contentContainerStyle={styles.content}>
      <Text style={styles.back} onPress={onBack}>Geri</Text>
      <Text style={styles.title}>Compliance</Text>
      {loading || !payload ? (
        <ActivityIndicator size="large" color={theme.primary} />
      ) : (
        <>
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Profil durumu: {payload.profile?.status ?? "-"}</Text>
            <Text style={styles.meta}>Zorunlu: {payload.profile?.required_count ?? 0}</Text>
            <Text style={styles.meta}>Onaylı: {payload.profile?.approved_required_count ?? 0}</Text>
            <Text style={styles.meta}>Yüklü: {payload.profile?.uploaded_required_count ?? 0}</Text>
            <Text style={styles.meta}>İstenen: {payload.profile?.requested_required_count ?? 0}</Text>
            <Text style={styles.meta}>Reddedilen: {payload.profile?.rejected_required_count ?? 0}</Text>
          </View>
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Belgeler</Text>
            {(payload.documents ?? []).map((doc) => (
              <Text key={doc.id} style={styles.meta}>
                {(doc.name || doc.code || doc.id)} · {doc.status || "-"} {doc.is_required ? "(zorunlu)" : "(opsiyonel)"}
              </Text>
            ))}
          </View>
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Opsiyonel Yüklemeler</Text>
            {(payload.optionalUploads ?? []).map((upload) => (
              <Text key={upload.id} style={styles.meta}>{upload.custom_title || upload.id} · {upload.status || "-"}</Text>
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
});
