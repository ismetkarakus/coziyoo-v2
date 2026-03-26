import React, { useEffect, useMemo, useState } from "react";
import { Alert, FlatList, StyleSheet, Text, View } from "react-native";
import type { AuthSession } from "../utils/auth";
import { apiRequest } from "../utils/api";
import ScreenHeader from "../components/ScreenHeader";

type Props = {
  auth: AuthSession;
  onBack: () => void;
  onAuthRefresh?: (session: AuthSession) => void;
};

type ReviewRow = {
  id: string;
  rating: number;
  comment: string;
  foodName: string;
  buyerName: string;
  createdAt: string;
};

export default function SellerReviewsScreen({ auth, onBack, onAuthRefresh }: Props) {
  const [loading, setLoading] = useState(true);
  const [reviews, setReviews] = useState<ReviewRow[]>([]);

  async function loadReviews() {
    setLoading(true);
    try {
      const result = await apiRequest<ReviewRow[]>(`/v1/foods/sellers/${auth.userId}/reviews`, auth, { actorRole: "seller" }, onAuthRefresh);
      if (!result.ok) throw new Error(result.message ?? "Yorumlar yüklenemedi");
      setReviews(Array.isArray(result.data) ? result.data : []);
    } catch (e) {
      Alert.alert("Hata", e instanceof Error ? e.message : "Yorumlar yüklenemedi");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadReviews();
  }, []);

  const avg = useMemo(() => {
    if (!reviews.length) return 0;
    return reviews.reduce((sum, review) => sum + Number(review.rating || 0), 0) / reviews.length;
  }, [reviews]);

  function stars(count: number) {
    return "★★★★★".slice(0, count) + "☆☆☆☆☆".slice(0, 5 - count);
  }

  return (
    <View style={styles.container}>
      <ScreenHeader title="Usta Yorumları" onBack={onBack} />
      {loading ? (
        <Text style={styles.loadingText}>Yükleniyor...</Text>
      ) : (
        <FlatList
          data={reviews}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.list}
          ListHeaderComponent={
            <View style={styles.summaryCard}>
              <Text style={styles.summaryTitle}>Puan özeti</Text>
              <Text style={styles.score}>{avg.toFixed(1)}</Text>
              <Text style={styles.scoreMeta}>{reviews.length} değerlendirme</Text>
            </View>
          }
          ListEmptyComponent={<Text style={styles.emptyText}>Henüz yorum yok.</Text>}
          renderItem={({ item }) => (
            <View style={styles.card}>
              <View style={styles.cardHead}>
                <View>
                  <Text style={styles.buyer}>{item.buyerName}</Text>
                  <Text style={styles.food}>{item.foodName}</Text>
                </View>
                <Text style={styles.stars}>{stars(Math.max(1, Math.min(5, Math.round(item.rating || 0))))}</Text>
              </View>
              <Text style={styles.comment}>{item.comment || "Yorum bırakılmamış."}</Text>
            </View>
          )}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#ECEBE7" },
  loadingText: { textAlign: "center", marginTop: 40, color: "#6C6055" },
  list: { padding: 14, gap: 8, paddingBottom: 24 },
  summaryCard: { backgroundColor: "#F8F8F6", borderRadius: 12, borderWidth: 1, borderColor: "#D4D3CD", padding: 14, marginBottom: 8 },
  summaryTitle: { color: "#2E241C", fontWeight: "800", fontSize: 17 },
  score: { marginTop: 8, color: "#2F2D2B", fontWeight: "800", fontSize: 36 },
  scoreMeta: { color: "#777068", marginTop: 2 },
  emptyText: { textAlign: "center", marginTop: 30, color: "#9E8E7E" },
  card: { backgroundColor: "#F8F8F6", borderRadius: 12, borderWidth: 1, borderColor: "#D4D3CD", padding: 12 },
  cardHead: { flexDirection: "row", alignItems: "center", justifyContent: "space-between", gap: 8 },
  buyer: { color: "#2F2D2B", fontWeight: "800", fontSize: 16 },
  food: { color: "#6E675D", marginTop: 3, fontWeight: "700" },
  stars: { color: "#F2BD00", fontWeight: "800" },
  comment: { color: "#3F3B35", marginTop: 10, lineHeight: 20 },
});
