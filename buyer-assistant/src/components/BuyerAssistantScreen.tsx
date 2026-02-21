import { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  SafeAreaView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from "react-native";
import * as Location from "expo-location";
import * as Speech from "expo-speech";

import { DEFAULT_RADIUS_KM, GREETING_TEXT } from "../config/env";
import { chatWithBuyerAssistant } from "../services/buyerAssistantApi";
import type { BuyerAssistantResponse } from "../types/assistant";

type ChatItem = {
  id: string;
  role: "assistant" | "user";
  text: string;
  meta?: string;
};

function toMetaText(data: BuyerAssistantResponse): string | undefined {
  const latency = data.meta?.latencyMs;
  const model = data.meta?.model;
  if (!latency && !model) return undefined;
  if (latency && model) return `${model} • ${latency}ms`;
  if (latency) return `${latency}ms`;
  return model;
}

export function BuyerAssistantScreen() {
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [voiceEnabled, setVoiceEnabled] = useState(true);
  const [chat, setChat] = useState<ChatItem[]>([{ id: "greeting", role: "assistant", text: GREETING_TEXT }]);
  const [coords, setCoords] = useState<{ lat?: number; lng?: number }>({});

  useEffect(() => {
    if (!voiceEnabled) return;
    Speech.speak(GREETING_TEXT, { language: "tr-TR", rate: 0.95 });
  }, []);

  useEffect(() => {
    (async () => {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== "granted") return;
      const position = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      setCoords({ lat: position.coords.latitude, lng: position.coords.longitude });
    })().catch(() => undefined);
  }, []);

  const canSend = useMemo(() => input.trim().length > 0 && !loading, [input, loading]);

  async function onSend() {
    if (!canSend) return;

    const message = input.trim();
    setInput("");
    setChat((prev) => [...prev, { id: `u-${Date.now()}`, role: "user", text: message }]);
    setLoading(true);

    try {
      const data = await chatWithBuyerAssistant({
        message,
        context: {
          lat: coords.lat,
          lng: coords.lng,
          radiusKm: DEFAULT_RADIUS_KM,
        },
        client: {
          channel: voiceEnabled ? "voice" : "text",
        },
      });

      const assistantText = [data.replyText, data.followUpQuestion].filter(Boolean).join("\n\n");
      const recommendations = (data.recommendations ?? []).slice(0, 3);
      const recommendationLines = recommendations.map((item, index) => {
        const name = item.title ?? item.name ?? "Oneri";
        const rating = typeof item.rating === "number" ? `⭐ ${item.rating.toFixed(1)}` : "";
        const distance = typeof item.distanceKm === "number" ? `${item.distanceKm.toFixed(1)} km` : "";
        const reason = item.reason ?? item.popularitySignal ?? "";
        return `${index + 1}. ${name} ${rating} ${distance}\n${reason}`.trim();
      });
      const fullText = [assistantText, ...recommendationLines].filter(Boolean).join("\n\n");

      setChat((prev) => [
        ...prev,
        {
          id: `a-${Date.now()}`,
          role: "assistant",
          text: fullText,
          meta: toMetaText(data),
        },
      ]);

      if (voiceEnabled) {
        Speech.stop();
        Speech.speak(data.replyText, { language: "tr-TR", rate: 0.95 });
      }
    } catch (error) {
      const messageText = error instanceof Error ? error.message : "Asistan baglantisinda hata olustu.";
      setChat((prev) => [...prev, { id: `e-${Date.now()}`, role: "assistant", text: messageText }]);
      Alert.alert("Hata", messageText);
    } finally {
      setLoading(false);
    }
  }

  return (
    <SafeAreaView style={styles.root}>
      <KeyboardAvoidingView style={styles.root} behavior={Platform.OS === "ios" ? "padding" : undefined}>
        <View style={styles.header}>
          <Text style={styles.title}>Buyer Assistant</Text>
          <Text style={styles.subtitle}>Mobil sesli yardimci (v1)</Text>
          <View style={styles.voiceRow}>
            <Text style={styles.voiceLabel}>Sesli yanit</Text>
            <Switch value={voiceEnabled} onValueChange={setVoiceEnabled} />
          </View>
          <Text style={styles.locationText}>
            Konum: {coords.lat && coords.lng ? `${coords.lat.toFixed(4)}, ${coords.lng.toFixed(4)}` : "izin bekleniyor"}
          </Text>
        </View>

        <FlatList
          data={chat}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.listContent}
          renderItem={({ item }) => (
            <View style={[styles.bubble, item.role === "user" ? styles.userBubble : styles.assistantBubble]}>
              <Text style={[styles.bubbleRole, item.role === "user" ? styles.userBubbleRole : styles.assistantBubbleRole]}>
                {item.role === "user" ? "Sen" : "Asistan"}
              </Text>
              <Text style={styles.bubbleText}>{item.text}</Text>
              {item.meta ? <Text style={styles.metaText}>{item.meta}</Text> : null}
            </View>
          )}
        />

        <View style={styles.composer}>
          <TextInput
            style={styles.input}
            placeholder="Ne yemek istedigini yaz..."
            value={input}
            onChangeText={setInput}
            editable={!loading}
            multiline
          />
          <Pressable style={[styles.sendButton, !canSend && styles.sendButtonDisabled]} onPress={onSend} disabled={!canSend}>
            {loading ? <ActivityIndicator color="#fff" /> : <Text style={styles.sendButtonText}>Gonder</Text>}
          </Pressable>
        </View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: "#0f172a",
  },
  header: {
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: "#1e293b",
  },
  title: {
    color: "#f8fafc",
    fontSize: 22,
    fontWeight: "700",
  },
  subtitle: {
    marginTop: 4,
    color: "#94a3b8",
  },
  voiceRow: {
    marginTop: 10,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  voiceLabel: {
    color: "#e2e8f0",
    fontWeight: "600",
  },
  locationText: {
    marginTop: 6,
    color: "#94a3b8",
    fontSize: 12,
  },
  listContent: {
    padding: 16,
    gap: 10,
  },
  bubble: {
    borderRadius: 12,
    padding: 12,
    borderWidth: 1,
  },
  userBubble: {
    backgroundColor: "#1d4ed8",
    borderColor: "#2563eb",
    marginLeft: 30,
  },
  assistantBubble: {
    backgroundColor: "#111827",
    borderColor: "#334155",
    marginRight: 30,
  },
  bubbleRole: {
    marginBottom: 6,
    fontSize: 12,
    fontWeight: "700",
  },
  userBubbleRole: {
    color: "#dbeafe",
  },
  assistantBubbleRole: {
    color: "#86efac",
  },
  bubbleText: {
    color: "#f8fafc",
    lineHeight: 21,
  },
  metaText: {
    marginTop: 8,
    color: "#94a3b8",
    fontSize: 12,
  },
  composer: {
    borderTopWidth: 1,
    borderTopColor: "#1e293b",
    padding: 12,
    gap: 10,
  },
  input: {
    minHeight: 50,
    maxHeight: 120,
    color: "#f8fafc",
    backgroundColor: "#111827",
    borderWidth: 1,
    borderColor: "#334155",
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    textAlignVertical: "top",
  },
  sendButton: {
    height: 46,
    borderRadius: 10,
    backgroundColor: "#16a34a",
    alignItems: "center",
    justifyContent: "center",
  },
  sendButtonDisabled: {
    opacity: 0.45,
  },
  sendButtonText: {
    color: "#f8fafc",
    fontWeight: "700",
    fontSize: 16,
  },
});
