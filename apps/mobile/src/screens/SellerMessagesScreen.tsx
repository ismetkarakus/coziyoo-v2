import React, { useEffect, useState } from "react";
import { Alert, FlatList, StyleSheet, Text, TouchableOpacity, View } from "react-native";
import type { AuthSession } from "../utils/auth";
import { apiRequest } from "../utils/api";
import ScreenHeader from "../components/ScreenHeader";

type Props = {
  auth: AuthSession;
  onBack: () => void;
  onOpenChat: (chatId: string, peerName: string) => void;
  onAuthRefresh?: (session: AuthSession) => void;
};

type ChatSummary = {
  id: string;
  sellerId: string;
  sellerName: string;
  sellerImage: string | null;
  lastMessage: string | null;
  lastMessageTime: string | null;
  buyerUnreadCount: number;
};

export default function SellerMessagesScreen({ auth, onBack, onOpenChat, onAuthRefresh }: Props) {
  const [loading, setLoading] = useState(true);
  const [chats, setChats] = useState<ChatSummary[]>([]);

  async function loadChats() {
    setLoading(true);
    try {
      const res = await apiRequest<ChatSummary[]>("/v1/chats", auth, { actorRole: "seller" }, onAuthRefresh);
      if (!res.ok) throw new Error(res.message ?? "Mesajlar yüklenemedi");
      setChats(Array.isArray(res.data) ? res.data : []);
    } catch (e) {
      Alert.alert("Hata", e instanceof Error ? e.message : "Mesajlar yüklenemedi");
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadChats();
  }, []);

  function formatTime(value: string | null) {
    if (!value) return "";
    const date = new Date(value);
    const h = date.getHours().toString().padStart(2, "0");
    const m = date.getMinutes().toString().padStart(2, "0");
    return `${h}:${m}`;
  }

  return (
    <View style={styles.container}>
      <ScreenHeader title="Müşteri Mesajları" onBack={onBack} />
      {loading ? (
        <Text style={styles.loadingText}>Yükleniyor...</Text>
      ) : chats.length === 0 ? (
        <Text style={styles.emptyText}>Şu an mesaj yok.</Text>
      ) : (
        <FlatList
          data={chats}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.list}
          renderItem={({ item }) => (
            <TouchableOpacity style={styles.card} onPress={() => onOpenChat(item.id, item.sellerName)} activeOpacity={0.85}>
              <View style={styles.rowTop}>
                <Text style={styles.name}>{item.sellerName}</Text>
                <Text style={styles.time}>{formatTime(item.lastMessageTime)}</Text>
              </View>
              <Text style={styles.orderInfo}>Sohbet: {item.id.slice(0, 8)}</Text>
              <Text style={styles.preview}>{item.lastMessage || "Henüz mesaj yok"}</Text>
              {item.buyerUnreadCount > 0 ? <Text style={styles.unread}>{item.buyerUnreadCount}</Text> : null}
            </TouchableOpacity>
          )}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: "#ECEBE7" },
  list: { padding: 14, gap: 8 },
  loadingText: { textAlign: "center", marginTop: 40, color: "#6C6055" },
  emptyText: { textAlign: "center", marginTop: 40, color: "#9E8E7E" },
  card: { backgroundColor: "#F8F8F6", borderRadius: 12, borderWidth: 1, borderColor: "#D4D3CD", padding: 12 },
  rowTop: { flexDirection: "row", justifyContent: "space-between", alignItems: "center" },
  name: { color: "#2E241C", fontWeight: "800", fontSize: 16 },
  time: { color: "#7A756E", fontSize: 13 },
  orderInfo: { marginTop: 2, color: "#7A756E" },
  preview: { marginTop: 8, color: "#4B463E", fontSize: 18 / 1.2 },
  unread: { alignSelf: "flex-end", marginTop: 8, backgroundColor: "#8EA18F", color: "#fff", fontWeight: "800", borderRadius: 999, overflow: "hidden", paddingHorizontal: 8, paddingVertical: 3, fontSize: 11 },
});
