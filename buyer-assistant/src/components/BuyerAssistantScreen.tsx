import { Ionicons } from "@expo/vector-icons";
import { LinearGradient } from "expo-linear-gradient";
import * as Location from "expo-location";
import { requireOptionalNativeModule } from "expo-modules-core";
import * as Speech from "expo-speech";
import { useEffect, useMemo, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  Animated,
  Easing,
  ImageBackground,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  SafeAreaView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from "react-native";

import { DEFAULT_RADIUS_KM, GREETING_TEXT } from "../config/env";
import { chatWithBuyerAssistant, chatWithBuyerAssistantDemo, fetchAssistantModels, fetchFoodsTest } from "../services/buyerAssistantApi";
import type { BuyerAssistantResponse } from "../types/assistant";

type AssistantState = "listening" | "thinking" | "responding";

type SpeechRecognitionModuleType = {
  requestPermissionsAsync: () => Promise<{ granted: boolean }>;
  start: (options: Record<string, unknown>) => void;
  stop: () => void;
  addListener: (eventName: string, listener: (event: any) => void) => { remove: () => void };
};

const SpeechRecognitionModule = requireOptionalNativeModule<SpeechRecognitionModuleType>("ExpoSpeechRecognition");
const sttAvailable = Boolean(SpeechRecognitionModule);

const chefBackgroundSource =
  Platform.OS === "web"
    ? {
        uri: "https://images.pexels.com/photos/4252137/pexels-photo-4252137.jpeg?auto=compress&cs=tinysrgb&w=1200",
      }
    : require("../../assets/chef-bg.jpg");

const useNativeDriver = Platform.OS !== "web";

function toMetaText(data: BuyerAssistantResponse): string | null {
  const latency = data.meta?.latencyMs;
  const model = data.meta?.model;
  if (!latency && !model) return null;
  if (latency && model) return `${model} • ${latency}ms`;
  if (latency) return `${latency}ms`;
  return model ?? null;
}

function Waveform({
  phase,
  active,
  bars = 14,
  mirrored = false,
  align = "start",
}: {
  phase: number;
  active: boolean;
  bars?: number;
  mirrored?: boolean;
  align?: "start" | "end";
}) {
  return (
    <View
      style={[
        styles.waveTrack,
        align === "end" ? styles.waveTrackEnd : styles.waveTrackStart,
        mirrored && styles.waveTrackMirrored,
      ]}
    >
      {Array.from({ length: bars }).map((_, index) => {
        const seed = Math.sin(index * 0.34 + phase * 0.15);
        const amplitude = active ? Math.abs(seed) * 16 + 2 : 3;
        const centerWeight = 1 - Math.abs(index - (bars - 1) / 2) / ((bars + 1) / 2);
        const height = Math.max(3, amplitude * (0.3 + centerWeight * 0.9));
        return <View key={String(index)} style={[styles.waveBar, { height }]} />;
      })}
    </View>
  );
}

export function BuyerAssistantScreen() {
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [isSpeaking, setIsSpeaking] = useState(false);
  const [recognizing, setRecognizing] = useState(false);
  const [transcript, setTranscript] = useState("");
  const [phase, setPhase] = useState(0);
  const [coords, setCoords] = useState<{ lat?: number; lng?: number }>({});
  const [latestReply, setLatestReply] = useState(GREETING_TEXT);
  const [latestMeta, setLatestMeta] = useState<string | null>(null);
  const [availableModels, setAvailableModels] = useState<string[]>(["ministral-3:8b"]);
  const [selectedModel, setSelectedModel] = useState("ministral-3:8b");
  const [modelModalVisible, setModelModalVisible] = useState(false);
  const pulse = useState(new Animated.Value(1))[0];
  const spin = useState(new Animated.Value(0))[0];

  useEffect(() => {
    if (!SpeechRecognitionModule) return;

    const startSub = SpeechRecognitionModule.addListener("start", () => {
      setRecognizing(true);
      setTranscript("");
    });
    const endSub = SpeechRecognitionModule.addListener("end", () => {
      setRecognizing(false);
    });
    const resultSub = SpeechRecognitionModule.addListener("result", (event) => {
      const text = event.results?.[0]?.transcript ?? "";
      setTranscript(text);
      setInput(text);
    });
    const errorSub = SpeechRecognitionModule.addListener("error", (event) => {
      setRecognizing(false);
      Alert.alert("STT Hatasi", event?.message ?? "Bilinmeyen STT hatasi");
    });

    return () => {
      startSub.remove();
      endSub.remove();
      resultSub.remove();
      errorSub.remove();
    };
  }, []);

  useEffect(() => {
    const timer = setInterval(() => setPhase((value) => value + 1), 80);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    Speech.speak(GREETING_TEXT, { language: "tr-TR", rate: 0.95 });
  }, []);

  useEffect(() => {
    fetchFoodsTest("", 3)
      .then((foods) => {
        if (foods.length === 0) {
          setLatestMeta("foods test: 0 kayit");
          return;
        }
        const preview = foods.map((item, idx) => `${idx + 1}) ${item.name} • ${item.rating.toFixed(1)}★ • ${item.price} TL`).join("\n");
        setLatestReply(`${GREETING_TEXT}\n\nFoods tablosu test baglantisi basarili:\n${preview}`);
        setLatestMeta(`foods test: ${foods.length} kayit`);
      })
      .catch(() => {
        setLatestMeta("foods test baglantisi basarisiz");
      });
  }, []);

  useEffect(() => {
    fetchAssistantModels()
      .then((data) => {
        const models = data.models.length > 0 ? data.models : [data.defaultModel];
        setAvailableModels(models);
        setSelectedModel((prev) => (models.includes(prev) ? prev : data.defaultModel));
      })
      .catch(() => {
        setAvailableModels(["ministral-3:8b"]);
      });
  }, []);

  useEffect(() => {
    if (Platform.OS !== "web") return;

    const timer = setTimeout(() => {
      chatWithBuyerAssistantDemo({
        message: "Bugun icin bana 3 populer ve kaliteli yemek onerisi ver. Kisa acikla.",
        model: selectedModel,
        context: { radiusKm: DEFAULT_RADIUS_KM },
        client: { channel: "voice" },
      })
        .then(async (data) => {
          const recommendations = (data.recommendations ?? []).slice(0, 3);
          const recommendationLines = recommendations.map((item, index) => {
            const name = item.title ?? item.name ?? "Oneri";
            const reason = item.reason ?? item.popularitySignal ?? "";
            return `${index + 1}) ${name}${reason ? ` - ${reason}` : ""}`;
          });
          const text = [data.replyText, ...recommendationLines, data.followUpQuestion].filter(Boolean).join("\n\n");
          setLatestReply(text);
          setLatestMeta(toMetaText(data));

          const spoken = [data.replyText, ...recommendations.map((r, i) => `${i + 1}. ${r.title ?? r.name ?? "onerim"}`)].join(". ");
          await speak(spoken);
        })
        .catch(() => undefined);
    }, 1200);

    return () => clearTimeout(timer);
  }, [selectedModel]);

  useEffect(() => {
    (async () => {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== "granted") return;
      const position = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
      setCoords({ lat: position.coords.latitude, lng: position.coords.longitude });
    })().catch(() => undefined);
  }, []);

  const assistantState: AssistantState = useMemo(() => {
    if (loading) return "thinking";
    if (isSpeaking) return "responding";
    return "listening";
  }, [loading, isSpeaking]);

  const statusSubtext = assistantState === "thinking" ? "Biraz bekleyin..." : "Konusmaya basla";

  useEffect(() => {
    pulse.stopAnimation();
    const minScale = assistantState === "thinking" ? 0.9 : 0.96;
    const maxScale = assistantState === "thinking" ? 1.12 : 1.05;
    const duration = assistantState === "thinking" ? 560 : assistantState === "responding" ? 820 : 1000;

    const animation = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: maxScale, duration, easing: Easing.inOut(Easing.quad), useNativeDriver }),
        Animated.timing(pulse, { toValue: minScale, duration, easing: Easing.inOut(Easing.quad), useNativeDriver }),
      ])
    );
    animation.start();

    return () => animation.stop();
  }, [assistantState, pulse]);

  useEffect(() => {
    if (assistantState !== "thinking") return;
    spin.setValue(0);
    const animation = Animated.loop(
      Animated.timing(spin, { toValue: 1, duration: 1400, easing: Easing.linear, useNativeDriver })
    );
    animation.start();
    return () => animation.stop();
  }, [assistantState, spin]);

  async function speak(text: string) {
    const trimmed = text.trim();
    if (!trimmed) return;

    if (Platform.OS === "web" && typeof window !== "undefined" && "speechSynthesis" in window) {
      await new Promise<void>((resolve) => {
        setIsSpeaking(true);
        const synth = window.speechSynthesis;
        synth.cancel();

        const utterance = new SpeechSynthesisUtterance(trimmed);
        utterance.lang = "tr-TR";
        utterance.rate = 0.95;
        utterance.pitch = 1;
        utterance.volume = 1;
        utterance.onend = () => {
          setIsSpeaking(false);
          resolve();
        };
        utterance.onerror = () => {
          setIsSpeaking(false);
          resolve();
        };

        synth.speak(utterance);
      });
      return;
    }

    return new Promise<void>((resolve) => {
      setIsSpeaking(true);
      Speech.stop();
      Speech.speak(trimmed, {
        language: "tr-TR",
        rate: 0.95,
        onDone: () => {
          setIsSpeaking(false);
          resolve();
        },
        onStopped: () => {
          setIsSpeaking(false);
          resolve();
        },
        onError: () => {
          setIsSpeaking(false);
          resolve();
        },
      });
    });
  }

  async function onAskAssistant() {
    if (loading) return;

    const message = input.trim() || "Bana yakin ve populer 3 yemek onerisi ver.";
    setLoading(true);

    try {
      const data = await chatWithBuyerAssistant({
        message,
        model: selectedModel,
        context: {
          lat: coords.lat,
          lng: coords.lng,
          radiusKm: DEFAULT_RADIUS_KM,
        },
        client: {
          channel: "voice",
        },
      });

      const recommendations = (data.recommendations ?? []).slice(0, 3);
      const recommendationLines = recommendations.map((item, index) => {
        const name = item.title ?? item.name ?? "Oneri";
        const rating = typeof item.rating === "number" ? ` • ${item.rating.toFixed(1)}★` : "";
        const distance = typeof item.distanceKm === "number" ? ` • ${item.distanceKm.toFixed(1)} km` : "";
        const reason = item.reason ?? item.popularitySignal ?? "";
        return `${index + 1}) ${name}${rating}${distance}${reason ? `\n${reason}` : ""}`;
      });

      const text = [data.replyText, data.followUpQuestion, ...recommendationLines].filter(Boolean).join("\n\n");
      setLatestReply(text);
      setLatestMeta(toMetaText(data));
      setInput("");

      const speechText = [data.replyText, ...recommendations.map((item, index) => `${index + 1}. ${item.title ?? item.name ?? "oneri"}`), data.followUpQuestion]
        .filter(Boolean)
        .join(". ");
      await speak(speechText);
    } catch (error) {
      const messageText = error instanceof Error ? error.message : "Asistan baglantisinda hata olustu.";
      Alert.alert("Hata", messageText);
      setLatestReply(messageText);
      setLatestMeta(null);
    } finally {
      setLoading(false);
    }
  }

  async function startListening() {
    if (!SpeechRecognitionModule) {
      Alert.alert("STT Kullanilamiyor", "Expo Go icinde bu native modul yok. STT icin development build kullanmalisin.");
      return;
    }
    try {
      const permission = await SpeechRecognitionModule.requestPermissionsAsync();
      if (!permission.granted) {
        Alert.alert("Izin Gerekli", "Mikrofon ve konusma tanima izni vermelisin.");
        return;
      }
      SpeechRecognitionModule.start({
        lang: "tr-TR",
        interimResults: true,
        maxAlternatives: 1,
        continuous: false,
        addsPunctuation: true,
      });
    } catch {
      Alert.alert("STT Kullanilamiyor", "Bu ozellik Expo Go yerine development build ile daha stabil calisir.");
    }
  }

  function stopListening() {
    if (!SpeechRecognitionModule) return;
    SpeechRecognitionModule.stop();
  }

  return (
    <SafeAreaView style={styles.root}>
      <ImageBackground source={chefBackgroundSource} resizeMode="cover" style={styles.imageBg} imageStyle={styles.imageBgStyle}>
        <LinearGradient colors={["rgba(11,18,32,0.20)", "rgba(7,13,24,0.45)", "rgba(2,6,23,0.72)"]} style={styles.gradientBg} />
        <View style={styles.blurLayer} />

        <KeyboardAvoidingView style={styles.screen} behavior={Platform.OS === "ios" ? "padding" : undefined}>
          <View style={styles.centerArea}>
            {assistantState === "thinking" ? (
              <View style={styles.thinkingWrap}>
                <Text style={styles.dotRow}>• • •</Text>
                <Text style={styles.thinkingText}>{statusSubtext}</Text>
                <ActivityIndicator color="#e2e8f0" style={styles.loader} />
              </View>
            ) : null}

            <View style={styles.replyCard}>
              <Text style={styles.replyText}>{latestReply}</Text>
              {latestMeta ? <Text style={styles.replyMeta}>{latestMeta}</Text> : null}
            </View>
          </View>

          <View style={styles.bottomDock}>
            <View style={styles.voiceVisualizerRow}>
              <View style={[styles.equalizerSide, styles.equalizerLeft]}>
                <Waveform phase={phase} active bars={14} align="end" />
              </View>

              <Pressable
                style={styles.centerMicWrap}
                onPress={recognizing ? stopListening : startListening}
                disabled={loading || !sttAvailable}
                accessibilityRole="button"
                accessibilityLabel="Bas Konuş"
              >
                <Animated.View
                  style={[
                    styles.statusHalo,
                    {
                      transform: [
                        { scale: pulse },
                        {
                          rotate:
                            assistantState === "thinking"
                              ? spin.interpolate({ inputRange: [0, 1], outputRange: ["0deg", "360deg"] })
                              : "0deg",
                        },
                      ],
                    },
                  ]}
                />
                <View style={styles.statusCore}>
                  <Ionicons
                    name={assistantState === "thinking" ? "sparkles" : assistantState === "responding" ? "volume-high" : "mic"}
                    size={28}
                    color={recognizing ? "#ef4444" : "#e2e8f0"}
                  />
                </View>
              </Pressable>

              <View style={[styles.equalizerSide, styles.equalizerRight]}>
                <Waveform phase={phase} active bars={14} mirrored align="end" />
              </View>
            </View>

            <Text style={styles.micButtonHint}>{recognizing ? "Dinleniyor..." : "Bas Konuş"}</Text>

            <View style={styles.inputRow}>
              <TextInput
                style={[styles.input, styles.inputFlex]}
                placeholder="Komut girmek için buraya yazın"
                placeholderTextColor="#94a3b8"
                value={input}
                onChangeText={setInput}
                editable={!loading}
                onSubmitEditing={onAskAssistant}
                returnKeyType="send"
              />
              <Pressable style={[styles.sendButton, loading && styles.sendButtonDisabled]} onPress={onAskAssistant} disabled={loading}>
                <Ionicons name="send" size={16} color="#e2e8f0" />
                <Text style={styles.sendButtonText}>Gonder</Text>
              </Pressable>
            </View>

            <View style={styles.modelPickerWrap}>
              <Pressable style={styles.modelSelector} onPress={() => setModelModalVisible(true)} accessibilityRole="button">
                <Text style={styles.modelSelectorText} numberOfLines={1}>{`Model: ${selectedModel}`}</Text>
              </Pressable>
            </View>

            <View style={styles.bottomNav}>
              <NavItem icon="compass" label="Kesfet" active />
              <NavItem icon="heart" label="Favoriler" />
              <NavItem icon="restaurant" label="Yemekler" />
              <NavItem icon="briefcase" label="Sepet" />
              <NavItem icon="person" label="Profil" />
            </View>
          </View>
        </KeyboardAvoidingView>
      </ImageBackground>

      <Modal
        visible={modelModalVisible}
        transparent
        animationType="fade"
        onRequestClose={() => setModelModalVisible(false)}
      >
        <Pressable style={styles.modalBackdrop} onPress={() => setModelModalVisible(false)}>
          <Pressable style={styles.modelModalCard} onPress={() => undefined}>
            <Text style={styles.modelModalTitle}>Model sec</Text>
            {availableModels.map((model) => {
              const active = model === selectedModel;
              return (
                <Pressable
                  key={model}
                  style={[styles.modelOption, active && styles.modelOptionActive]}
                  onPress={() => {
                    setSelectedModel(model);
                    setModelModalVisible(false);
                  }}
                >
                  <Text style={[styles.modelOptionText, active && styles.modelOptionTextActive]}>{model}</Text>
                  {active ? <Ionicons name="checkmark" size={18} color="#38bdf8" /> : null}
                </Pressable>
              );
            })}
          </Pressable>
        </Pressable>
      </Modal>
    </SafeAreaView>
  );
}

function NavItem({ icon, label, active = false }: { icon: keyof typeof Ionicons.glyphMap; label: string; active?: boolean }) {
  return (
    <View style={styles.navItem}>
      <Ionicons name={icon} size={22} color={active ? "#38bdf8" : "#cbd5e1"} />
      <Text style={[styles.navLabel, active && styles.navLabelActive]}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
    backgroundColor: "#070d18",
  },
  screen: {
    flex: 1,
  },
  imageBg: {
    flex: 1,
  },
  imageBgStyle: {
    opacity: 0.98,
  },
  gradientBg: {
    ...StyleSheet.absoluteFillObject,
  },
  blurLayer: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(6, 10, 19, 0.16)",
  },
  statusHalo: {
    position: "absolute",
    width: 62,
    height: 62,
    borderRadius: 31,
    borderWidth: 2,
    borderColor: "rgba(56, 189, 248, 0.65)",
    backgroundColor: "rgba(56, 189, 248, 0.16)",
  },
  statusCore: {
    width: 50,
    height: 50,
    borderRadius: 25,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(30, 41, 59, 0.9)",
  },
  centerArea: {
    flex: 1,
    paddingHorizontal: 20,
    justifyContent: "center",
    gap: 12,
  },
  thinkingWrap: {
    alignItems: "center",
    justifyContent: "center",
  },
  dotRow: {
    color: "#f8fafc",
    fontSize: 36,
    lineHeight: 36,
    fontWeight: "700",
  },
  thinkingText: {
    color: "#e2e8f0",
    marginTop: 8,
    fontSize: 24,
  },
  loader: {
    marginTop: 10,
  },
  replyCard: {
    borderRadius: 18,
    padding: 16,
    borderWidth: 1,
    borderColor: "rgba(148, 163, 184, 0.25)",
    backgroundColor: "rgba(2, 6, 23, 0.62)",
    maxHeight: 260,
  },
  replyText: {
    color: "#e2e8f0",
    fontSize: 16,
    lineHeight: 22,
  },
  replyMeta: {
    marginTop: 10,
    color: "#93c5fd",
    fontSize: 12,
  },
  bottomDock: {
    borderTopWidth: 1,
    borderTopColor: "rgba(100, 116, 139, 0.35)",
    backgroundColor: "rgba(2, 6, 23, 0.72)",
    paddingHorizontal: 14,
    paddingTop: 12,
    paddingBottom: 16,
  },
  voiceVisualizerRow: {
    width: "100%",
    flexDirection: "row",
    alignItems: "center",
    gap: 0,
    minHeight: 62,
    paddingHorizontal: "15%",
  },
  equalizerSide: {
    flex: 1,
    height: 44,
    borderRadius: 24,
    backgroundColor: "transparent",
    paddingHorizontal: 10,
    justifyContent: "center",
    zIndex: 1,
  },
  equalizerLeft: {
    borderTopRightRadius: 0,
    borderBottomRightRadius: 0,
    marginRight: -4,
  },
  equalizerRight: {
    borderTopLeftRadius: 0,
    borderBottomLeftRadius: 0,
    marginLeft: -4,
  },
  centerMicWrap: {
    width: 66,
    height: 66,
    borderRadius: 33,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(15, 23, 42, 0.82)",
    borderWidth: 1,
    borderColor: "rgba(59, 130, 246, 0.25)",
    zIndex: 3,
  },
  waveTrack: {
    flex: 1,
    height: 30,
    flexDirection: "row",
    alignItems: "center",
    gap: 3,
  },
  waveTrackStart: {
    justifyContent: "flex-start",
  },
  waveTrackEnd: {
    justifyContent: "flex-end",
  },
  waveTrackMirrored: {
    transform: [{ scaleX: -1 }],
  },
  waveBar: {
    width: 4,
    borderRadius: 6,
    backgroundColor: "#38bdf8",
  },
  input: {
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "rgba(148, 163, 184, 0.35)",
    backgroundColor: "rgba(15, 23, 42, 0.75)",
    color: "#f8fafc",
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 16,
  },
  inputRow: {
    marginTop: 10,
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  inputFlex: {
    flex: 1,
  },
  sendButton: {
    minHeight: 44,
    borderRadius: 12,
    paddingHorizontal: 12,
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    backgroundColor: "rgba(30, 64, 175, 0.75)",
    borderWidth: 1,
    borderColor: "rgba(125, 211, 252, 0.35)",
  },
  sendButtonDisabled: {
    opacity: 0.65,
  },
  sendButtonText: {
    color: "#e2e8f0",
    fontSize: 13,
    fontWeight: "700",
  },
  modelPickerWrap: {
    marginTop: 8,
    alignItems: "flex-start",
  },
  modelSelector: {
    minHeight: 30,
    paddingHorizontal: 2,
    paddingVertical: 4,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "flex-start",
  },
  modelSelectorText: {
    color: "#cbd5e1",
    fontSize: 13,
    textDecorationLine: "underline",
  },
  modalBackdrop: {
    flex: 1,
    backgroundColor: "rgba(2, 6, 23, 0.6)",
    justifyContent: "center",
    paddingHorizontal: 24,
  },
  modelModalCard: {
    borderRadius: 14,
    borderWidth: 1,
    borderColor: "rgba(148, 163, 184, 0.35)",
    backgroundColor: "rgba(15, 23, 42, 0.96)",
    paddingVertical: 10,
    paddingHorizontal: 12,
    maxHeight: "65%",
  },
  modelModalTitle: {
    color: "#f8fafc",
    fontSize: 16,
    fontWeight: "700",
    marginBottom: 8,
  },
  modelOption: {
    minHeight: 42,
    borderRadius: 10,
    paddingHorizontal: 10,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  modelOptionActive: {
    backgroundColor: "rgba(56, 189, 248, 0.12)",
  },
  modelOptionText: {
    color: "#e2e8f0",
    fontSize: 14,
  },
  modelOptionTextActive: {
    color: "#f8fafc",
    fontWeight: "700",
  },
  micButtonHint: {
    marginTop: 8,
    color: "#e2e8f0",
    fontSize: 14,
    fontWeight: "700",
    textAlign: "center",
  },
  bottomNav: {
    marginTop: 14,
    flexDirection: "row",
    justifyContent: "space-between",
  },
  navItem: {
    alignItems: "center",
    gap: 2,
    width: "19%",
  },
  navLabel: {
    color: "#cbd5e1",
    fontSize: 12,
  },
  navLabelActive: {
    color: "#7dd3fc",
  },
});
