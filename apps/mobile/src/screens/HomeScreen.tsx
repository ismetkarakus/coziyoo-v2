import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  FlatList,
  Modal,
  Platform,
  SafeAreaView,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
let getColors: typeof import('react-native-image-colors').getColors | null = null;
try {
  getColors = require('react-native-image-colors').getColors;
} catch {
  // Native module not available — adaptive colors will use fallback
}
import { loadSettings } from '../utils/settings';
import { refreshAuthSession, type AuthSession } from '../utils/auth';
import VoiceSessionScreen from './VoiceSessionScreen';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export type SessionData = {
  wsUrl: string;
  token: string;
  roomName: string;
  userIdentity: string;
};

type Props = {
  auth: AuthSession;
  onOpenSettings: () => void;
  onLogout: () => void;
  onAuthRefresh?: (session: AuthSession) => void;
};

type ApiErrorPayload = {
  error?: { code?: string; message?: string };
};

type VoiceState = 'idle' | 'starting' | 'active' | 'error';
type TabKey = 'home' | 'messages' | 'cart' | 'notifications' | 'profile';
type AgentMode = 'voice' | 'text';

type MealCard = {
  id: string;
  emoji: string;
  title: string;
  seller: string;
  rating: string;
  time: string;
  distance: string;
  price: string;
  backgroundColor: string;
  category: string;
  imageUrl?: string;
};

type CardColors = {
  bg: string;
  border: string;
  title: string;
  subtitle: string;
  price: string;
  meta: string;
};

type ChatMessage = {
  id: string;
  text: string;
  isUser: boolean;
};

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function darken(hex: string, amount: number): string {
  const h = hex.replace('#', '');
  const r = Math.max(
    0,
    Math.round(parseInt(h.substring(0, 2), 16) * (1 - amount)),
  );
  const g = Math.max(
    0,
    Math.round(parseInt(h.substring(2, 4), 16) * (1 - amount)),
  );
  const b = Math.max(
    0,
    Math.round(parseInt(h.substring(4, 6), 16) * (1 - amount)),
  );
  return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
}

function deriveCardColors(dominant: string): CardColors {
  return {
    bg: dominant + '20',
    border: dominant + '30',
    title: darken(dominant, 0.6),
    subtitle: darken(dominant, 0.3),
    price: darken(dominant, 0.5),
    meta: dominant + '90',
  };
}

/* ------------------------------------------------------------------ */
/*  Constants                                                          */
/* ------------------------------------------------------------------ */

const CATEGORIES = ['Tumu', 'Corbalar', 'Ana yemek', 'Tatli', 'Salata'];

const INITIAL_CHAT: ChatMessage[] = [
  {
    id: '1',
    text: 'Canin ne cekiyor? Anlatir misin, sana en uygun ev yemeklerini bulayim.',
    isUser: false,
  },
];

const meals: MealCard[] = [
  {
    id: 'mercimek',
    emoji: '🍲',
    title: 'Mercimek Corbasi',
    seller: 'Zeynep Hanim',
    rating: '4.5',
    time: '25 dk',
    distance: '2 km',
    price: '₺15',
    backgroundColor: '#F1DED0',
    category: 'Corbalar',
  },
  {
    id: 'karniyarik',
    emoji: '🥘',
    title: 'Karniyarik',
    seller: 'Ayse Teyze',
    rating: '4.8',
    time: '35 dk',
    distance: '3 km',
    price: '₺35',
    backgroundColor: '#D8E5D8',
    category: 'Ana yemek',
  },
  {
    id: 'sutlac',
    emoji: '🍰',
    title: 'Sutlac',
    seller: 'Fatma Anne',
    rating: '4.7',
    time: '15 dk',
    distance: '1 km',
    price: '₺25',
    backgroundColor: '#ECD4D8',
    category: 'Tatli',
  },
];

/* ------------------------------------------------------------------ */
/*  FoodCard                                                           */
/* ------------------------------------------------------------------ */

function FoodCard({
  meal,
  onPress,
}: {
  meal: MealCard;
  onPress: () => void;
}) {
  const [colors, setColors] = useState<CardColors>(
    deriveCardColors(meal.backgroundColor),
  );

  useEffect(() => {
    if (!meal.imageUrl || !getColors) {
      setColors(deriveCardColors(meal.backgroundColor));
      return;
    }
    getColors(meal.imageUrl, {
      fallback: meal.backgroundColor,
      cache: true,
      key: meal.imageUrl,
    })
      .then((result) => {
        let dominant = meal.backgroundColor;
        if (Platform.OS === 'ios' && 'background' in result) {
          dominant = result.background;
        } else if (Platform.OS === 'android' && 'dominant' in result) {
          dominant = result.dominant;
        }
        setColors(deriveCardColors(dominant));
      })
      .catch(() => {
        setColors(deriveCardColors(meal.backgroundColor));
      });
  }, [meal.imageUrl, meal.backgroundColor]);

  return (
    <TouchableOpacity
      style={[
        styles.foodCard,
        { backgroundColor: colors.bg, borderColor: colors.border },
      ]}
      activeOpacity={0.85}
      onPress={onPress}
    >
      <View
        style={[styles.foodPhoto, { backgroundColor: meal.backgroundColor }]}
      >
        <Text style={styles.foodEmoji}>{meal.emoji}</Text>
        <View style={styles.ratingBadge}>
          <Text style={styles.ratingBadgeStar}>★</Text>
          <Text style={styles.ratingBadgeText}>{meal.rating}</Text>
        </View>
      </View>
      <View style={styles.foodInfo}>
        <View style={styles.foodInfoRow}>
          <View style={styles.foodInfoLeft}>
            <Text style={[styles.foodName, { color: colors.title }]}>
              {meal.title}
            </Text>
            <Text style={[styles.foodSeller, { color: colors.subtitle }]}>
              {meal.seller}
            </Text>
          </View>
          <Text style={[styles.foodPrice, { color: colors.price }]}>
            {meal.price}
          </Text>
        </View>
        <Text style={[styles.foodMeta, { color: colors.meta }]}>
          🕐 {meal.time} · {meal.distance}
        </Text>
      </View>
    </TouchableOpacity>
  );
}

/* ------------------------------------------------------------------ */
/*  HomeScreen                                                         */
/* ------------------------------------------------------------------ */

export default function HomeScreen({
  auth,
  onOpenSettings,
  onLogout,
  onAuthRefresh,
}: Props) {
  const [currentAuth, setCurrentAuth] = useState<AuthSession>(auth);
  const [apiUrl, setApiUrl] = useState('http://localhost:3000');
  const [activeTab, setActiveTab] = useState<TabKey>('home');
  const [activeCategory, setActiveCategory] = useState('Tumu');
  const [voiceState, setVoiceState] = useState<VoiceState>('idle');
  const [voiceError, setVoiceError] = useState<string | null>(null);
  const [voiceSession, setVoiceSession] = useState<SessionData | null>(null);
  const [agentModalVisible, setAgentModalVisible] = useState(false);
  const [agentMode, setAgentMode] = useState<AgentMode>('voice');
  const [chatMessages, setChatMessages] =
    useState<ChatMessage[]>(INITIAL_CHAT);
  const [chatInput, setChatInput] = useState('');
  const [selectedMeal, setSelectedMeal] = useState<MealCard | null>(null);
  const [cartCount, setCartCount] = useState(0);

  // FAB animations
  const pulse1Scale = useRef(new Animated.Value(1)).current;
  const pulse1Opacity = useRef(new Animated.Value(0.8)).current;
  const pulse2Scale = useRef(new Animated.Value(1)).current;
  const pulse2Opacity = useRef(new Animated.Value(0.6)).current;
  const breatheScale = useRef(new Animated.Value(1)).current;
  const pulse2Timer = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => {
    setCurrentAuth(auth);
  }, [auth]);

  useEffect(() => {
    loadSettings().then((s) => setApiUrl(s.apiUrl));
  }, []);

  // FAB pulse & breathe animations
  useEffect(() => {
    const pulse1 = Animated.loop(
      Animated.sequence([
        Animated.parallel([
          Animated.timing(pulse1Scale, {
            toValue: 1.8,
            duration: 2600,
            useNativeDriver: true,
          }),
          Animated.timing(pulse1Opacity, {
            toValue: 0,
            duration: 2600,
            useNativeDriver: true,
          }),
        ]),
        Animated.parallel([
          Animated.timing(pulse1Scale, {
            toValue: 1,
            duration: 0,
            useNativeDriver: true,
          }),
          Animated.timing(pulse1Opacity, {
            toValue: 0.8,
            duration: 0,
            useNativeDriver: true,
          }),
        ]),
      ]),
    );

    const pulse2 = Animated.loop(
      Animated.sequence([
        Animated.parallel([
          Animated.timing(pulse2Scale, {
            toValue: 2.2,
            duration: 2600,
            useNativeDriver: true,
          }),
          Animated.timing(pulse2Opacity, {
            toValue: 0,
            duration: 2600,
            useNativeDriver: true,
          }),
        ]),
        Animated.parallel([
          Animated.timing(pulse2Scale, {
            toValue: 1,
            duration: 0,
            useNativeDriver: true,
          }),
          Animated.timing(pulse2Opacity, {
            toValue: 0.6,
            duration: 0,
            useNativeDriver: true,
          }),
        ]),
      ]),
    );

    const breathe = Animated.loop(
      Animated.sequence([
        Animated.timing(breatheScale, {
          toValue: 1.06,
          duration: 1300,
          useNativeDriver: true,
        }),
        Animated.timing(breatheScale, {
          toValue: 1,
          duration: 1300,
          useNativeDriver: true,
        }),
      ]),
    );

    pulse1.start();
    pulse2Timer.current = setTimeout(() => pulse2.start(), 500);
    breathe.start();

    return () => {
      pulse1.stop();
      pulse2.stop();
      breathe.stop();
      if (pulse2Timer.current) clearTimeout(pulse2Timer.current);
    };
  }, [pulse1Scale, pulse1Opacity, pulse2Scale, pulse2Opacity, breatheScale]);

  /* ---------- Voice session helpers ---------- */

  function resolveStartSessionError(
    payload: ApiErrorPayload,
    status: number,
  ): string {
    const code = payload?.error?.code;
    if (code === 'AGENT_UNAVAILABLE')
      return 'Ses asistani su an kullanilamiyor. Lutfen biraz sonra tekrar deneyin.';
    if (code === 'N8N_UNAVAILABLE')
      return 'AI sunucusuna ulasilamiyor. Lutfen n8n sunucusunu kontrol edin.';
    if (code === 'N8N_WORKFLOW_UNAVAILABLE')
      return 'AI is akisi kullanilamiyor veya aktif degil.';
    if (code === 'STT_UNAVAILABLE')
      return 'Konusma tanima kullanilamiyor. STT sunucusunu kontrol edin.';
    if (code === 'TTS_UNAVAILABLE')
      return 'Ses sentezi kullanilamiyor. TTS sunucusunu kontrol edin.';
    if (status === 401) return 'Oturum suresi doldu. Lutfen tekrar giris yapin.';
    return payload?.error?.message ?? `Sunucu hatasi ${status}`;
  }

  async function startSessionWithToken(accessToken: string): Promise<void> {
    const response = await fetch(`${apiUrl}/v1/livekit/session/start`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({ autoDispatchAgent: true, channel: 'mobile' }),
    });

    const json = await response.json();

    if (response.status === 401) {
      const refreshed = await refreshAuthSession(apiUrl, currentAuth);
      if (refreshed) {
        setCurrentAuth(refreshed);
        onAuthRefresh?.(refreshed);
        return startSessionWithToken(refreshed.accessToken);
      }
      onLogout();
      return;
    }

    if (!response.ok || (json as ApiErrorPayload).error) {
      throw new Error(
        resolveStartSessionError(json as ApiErrorPayload, response.status),
      );
    }

    const { data } = json as {
      data: {
        roomName: string;
        wsUrl: string;
        user: { participantIdentity: string; token: string };
      };
    };

    setVoiceSession({
      wsUrl: data.wsUrl,
      token: data.user.token,
      roomName: data.roomName,
      userIdentity: data.user.participantIdentity,
    });
    setVoiceState('active');
    setVoiceError(null);
  }

  async function handleStartVoice() {
    if (voiceState === 'starting' || voiceState === 'active') return;
    setVoiceError(null);
    setVoiceState('starting');
    try {
      await startSessionWithToken(currentAuth.accessToken);
    } catch (err) {
      setVoiceSession(null);
      setVoiceState('error');
      setVoiceError(
        err instanceof Error ? err.message : 'Oturum baslatilamadi',
      );
    }
  }

  function handleVoiceEnd() {
    setVoiceSession(null);
    setVoiceState('idle');
    setVoiceError(null);
  }

  /* ---------- Agent modal handlers ---------- */

  function handleFabPress() {
    setAgentMode('voice');
    setAgentModalVisible(true);
    if (voiceState !== 'active' && voiceState !== 'starting') {
      void handleStartVoice();
    }
  }

  function handleCloseAgent() {
    setAgentModalVisible(false);
    if (voiceSession) handleVoiceEnd();
    setVoiceState('idle');
    setVoiceError(null);
  }

  function handleSwitchToText() {
    setAgentMode('text');
    if (voiceSession) handleVoiceEnd();
  }

  function handleSwitchToVoice() {
    setAgentMode('voice');
    void handleStartVoice();
  }

  function handleChatSend() {
    if (!chatInput.trim()) return;
    setChatMessages((prev) => [
      ...prev,
      { id: Date.now().toString(), text: chatInput.trim(), isUser: true },
    ]);
    setChatInput('');
  }

  function handleTabPress(tab: TabKey) {
    setActiveTab(tab);
  }

  /* ---------- Filtered meals ---------- */

  const filteredMeals =
    activeCategory === 'Tumu'
      ? meals
      : meals.filter((m) => m.category === activeCategory);

  /* ---------- Render helpers ---------- */

  function renderHomeFeed() {
    return (
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.scrollContent}
        style={styles.scroll}
      >
        {/* Header */}
        <View style={styles.headerRow}>
          <View style={styles.headerTextWrap}>
            <Text style={styles.greetingTitle}>Gunaydin, Lale</Text>
            <Text style={styles.greetingSubtitle}>Bugun ne yiyelim?</Text>
          </View>
          <TouchableOpacity
            activeOpacity={0.85}
            style={styles.avatarCircle}
            onPress={() => handleTabPress('profile')}
          >
            <Text style={styles.avatarEmoji}>👩‍🍳</Text>
          </TouchableOpacity>
        </View>

        {/* Search */}
        <View style={styles.searchBox}>
          <Text style={styles.searchIcon}>⌕</Text>
          <Text style={styles.searchText}>Tarif veya malzeme ara...</Text>
        </View>

        {/* Category filters */}
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          style={styles.categoryScroll}
          contentContainerStyle={styles.categoryContent}
        >
          {CATEGORIES.map((cat) => (
            <TouchableOpacity
              key={cat}
              style={[
                styles.categoryChip,
                activeCategory === cat && styles.categoryChipActive,
              ]}
              activeOpacity={0.85}
              onPress={() => setActiveCategory(cat)}
            >
              <Text
                style={[
                  styles.categoryText,
                  activeCategory === cat && styles.categoryTextActive,
                ]}
              >
                {cat}
              </Text>
            </TouchableOpacity>
          ))}
        </ScrollView>

        {/* Food cards */}
        {filteredMeals.map((meal) => (
          <FoodCard
            key={meal.id}
            meal={meal}
            onPress={() => setSelectedMeal(meal)}
          />
        ))}

        {voiceError && !agentModalVisible ? (
          <Text style={styles.inlineError}>{voiceError}</Text>
        ) : null}
      </ScrollView>
    );
  }

  function renderContent() {
    if (activeTab === 'profile') {
      return (
        <View style={styles.profileCard}>
          <View style={styles.profileHeader}>
            <View style={styles.profileAvatar}>
              <Text style={styles.profileAvatarText}>👩‍🍳</Text>
            </View>
            <View style={styles.profileMeta}>
              <Text style={styles.profileTitle}>Profil</Text>
              <Text style={styles.profileEmail}>{currentAuth.email}</Text>
            </View>
          </View>
          <TouchableOpacity
            style={styles.profileButton}
            onPress={onOpenSettings}
          >
            <Text style={styles.profileButtonText}>Ayarlar</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.profileDangerButton}
            onPress={onLogout}
          >
            <Text style={styles.profileDangerButtonText}>Cikis Yap</Text>
          </TouchableOpacity>
        </View>
      );
    }
    return renderHomeFeed();
  }

  function renderChatMessage({ item }: { item: ChatMessage }) {
    if (item.isUser) {
      return (
        <View style={styles.chatRowUser}>
          <View style={styles.chatBubbleUser}>
            <Text style={styles.chatTextUser}>{item.text}</Text>
          </View>
        </View>
      );
    }
    return (
      <View style={styles.chatRowBot}>
        <View style={styles.chatAvatar}>
          <Text style={styles.chatAvatarEmoji}>🧑‍🍳</Text>
        </View>
        <View style={styles.chatBubbleBot}>
          <Text style={styles.chatTextBot}>{item.text}</Text>
        </View>
      </View>
    );
  }

  /* ---------- Main render ---------- */

  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar barStyle="dark-content" backgroundColor="#FFFDF9" />

      {/* Meal detail modal */}
      <Modal
        visible={!!selectedMeal}
        animationType="slide"
        transparent
        onRequestClose={() => setSelectedMeal(null)}
      >
        {selectedMeal && (
          <View style={styles.modalOverlay}>
            <View style={styles.modalContent}>
              <TouchableOpacity
                style={styles.modalClose}
                onPress={() => setSelectedMeal(null)}
              >
                <Text style={styles.modalCloseText}>✕</Text>
              </TouchableOpacity>
              <View
                style={[
                  styles.modalThumb,
                  { backgroundColor: selectedMeal.backgroundColor },
                ]}
              >
                <Text style={styles.modalEmoji}>{selectedMeal.emoji}</Text>
              </View>
              <Text style={styles.modalTitle}>{selectedMeal.title}</Text>
              <Text style={styles.modalSeller}>{selectedMeal.seller}</Text>
              <Text style={styles.modalRating}>★ {selectedMeal.rating}</Text>
              <Text style={styles.modalMeta}>
                🕐 {selectedMeal.time} · {selectedMeal.distance}
              </Text>
              <Text style={styles.modalPrice}>{selectedMeal.price}</Text>
              <TouchableOpacity
                style={styles.modalCartButton}
                activeOpacity={0.85}
                onPress={() => {
                  setCartCount((c) => c + 1);
                  setSelectedMeal(null);
                }}
              >
                <Text style={styles.modalCartButtonText}>Sepete Ekle</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}
      </Modal>

      {/* Agent modal */}
      <Modal
        visible={agentModalVisible}
        animationType="slide"
        onRequestClose={handleCloseAgent}
      >
        <SafeAreaView style={styles.agentModalSafe}>
          <StatusBar barStyle="dark-content" />

          {/* Header */}
          <View style={styles.agentHeader}>
            <TouchableOpacity
              style={styles.agentCloseBtn}
              onPress={handleCloseAgent}
            >
              <Ionicons name="close" size={18} color="#6B5D4F" />
            </TouchableOpacity>
            <Text style={styles.agentHeaderTitle}>Mutfak asistani</Text>
            <View style={styles.modePill}>
              <TouchableOpacity
                style={[
                  styles.modeBtn,
                  agentMode === 'voice' && styles.modeBtnActive,
                ]}
                onPress={handleSwitchToVoice}
              >
                <Text
                  style={[
                    styles.modeBtnText,
                    agentMode === 'voice' && styles.modeBtnTextActive,
                  ]}
                >
                  Sesli
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[
                  styles.modeBtn,
                  agentMode === 'text' && styles.modeBtnActive,
                ]}
                onPress={handleSwitchToText}
              >
                <Text
                  style={[
                    styles.modeBtnText,
                    agentMode === 'text' && styles.modeBtnTextActive,
                  ]}
                >
                  Yazili
                </Text>
              </TouchableOpacity>
            </View>
          </View>

          {/* Content */}
          <View style={styles.agentContent}>
            {agentMode === 'voice' ? (
              voiceSession && voiceState === 'active' ? (
                <VoiceSessionScreen
                  session={voiceSession}
                  onEnd={handleCloseAgent}
                  onSwitchToText={handleSwitchToText}
                />
              ) : voiceState === 'error' ? (
                <View style={styles.agentCenter}>
                  <Ionicons
                    name="alert-circle-outline"
                    size={48}
                    color="#D45454"
                  />
                  <Text style={styles.agentErrorText}>{voiceError}</Text>
                  <TouchableOpacity
                    style={styles.agentRetryBtn}
                    onPress={() => void handleStartVoice()}
                  >
                    <Text style={styles.agentRetryText}>Tekrar Dene</Text>
                  </TouchableOpacity>
                </View>
              ) : (
                <View style={styles.agentCenter}>
                  <ActivityIndicator size="large" color="#4A7C59" />
                  <Text style={styles.agentStatusText}>Baglaniyor...</Text>
                </View>
              )
            ) : (
              <>
                <FlatList
                  data={chatMessages}
                  renderItem={renderChatMessage}
                  keyExtractor={(item) => item.id}
                  contentContainerStyle={styles.chatList}
                  style={styles.chatListContainer}
                />
                <View style={styles.chatInputRow}>
                  <TouchableOpacity
                    style={styles.chatMicBtn}
                    onPress={handleSwitchToVoice}
                  >
                    <Ionicons name="mic" size={20} color="#6B5D4F" />
                  </TouchableOpacity>
                  <TextInput
                    value={chatInput}
                    onChangeText={setChatInput}
                    placeholder="Mesaj yazin..."
                    placeholderTextColor="#A89B8C"
                    style={styles.chatTextInput}
                    returnKeyType="send"
                    onSubmitEditing={handleChatSend}
                  />
                  <TouchableOpacity
                    style={styles.chatSendBtn}
                    onPress={handleChatSend}
                  >
                    <Ionicons name="arrow-up" size={18} color="#fff" />
                  </TouchableOpacity>
                </View>
              </>
            )}
          </View>
        </SafeAreaView>
      </Modal>

      {/* Main screen */}
      <View style={styles.container}>
          <View style={styles.content}>{renderContent()}</View>

          {/* FAB */}
          <View style={styles.floatingWrap}>
            <Animated.View
              pointerEvents="none"
              style={[
                styles.pulseRing1,
                {
                  opacity: pulse1Opacity,
                  transform: [{ scale: pulse1Scale }],
                },
              ]}
            />
            <Animated.View
              pointerEvents="none"
              style={[
                styles.pulseRing2,
                {
                  opacity: pulse2Opacity,
                  transform: [{ scale: pulse2Scale }],
                },
              ]}
            />
            <Animated.View style={{ transform: [{ scale: breatheScale }] }}>
              <TouchableOpacity
                style={styles.floatingButton}
                activeOpacity={0.9}
                onPress={handleFabPress}
              >
                <Text style={styles.floatingButtonText}>C</Text>
              </TouchableOpacity>
            </Animated.View>
          </View>

          {/* Bottom tab bar */}
          <View style={styles.bottomBar}>
            <TouchableOpacity
              style={styles.navItem}
              onPress={() => handleTabPress('home')}
            >
              <Text
                style={[
                  styles.navIcon,
                  activeTab === 'home' && styles.navIconActive,
                ]}
              >
                ⌂
              </Text>
              <Text
                style={[
                  styles.navLabel,
                  activeTab === 'home' && styles.navLabelActive,
                ]}
              >
                Ana Sayfa
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.navItem}
              onPress={() => handleTabPress('messages')}
            >
              <Text
                style={[
                  styles.navIcon,
                  activeTab === 'messages' && styles.navIconActive,
                ]}
              >
                ◌
              </Text>
              <Text
                style={[
                  styles.navLabel,
                  activeTab === 'messages' && styles.navLabelActive,
                ]}
              >
                Mesajlar
              </Text>
            </TouchableOpacity>
            <View style={styles.navSpacer} />
            <TouchableOpacity
              style={styles.navItem}
              onPress={() => handleTabPress('cart')}
            >
              <Text
                style={[
                  styles.navIcon,
                  activeTab === 'cart' && styles.navIconActive,
                ]}
              >
                ◍
              </Text>
              <Text
                style={[
                  styles.navLabel,
                  activeTab === 'cart' && styles.navLabelActive,
                ]}
              >
                Sepet{cartCount > 0 ? ` (${cartCount})` : ''}
              </Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={styles.navItem}
              onPress={() => handleTabPress('notifications')}
            >
              <Text
                style={[
                  styles.navIcon,
                  activeTab === 'notifications' && styles.navIconActive,
                ]}
              >
                ◔
              </Text>
              <Text
                style={[
                  styles.navLabel,
                  activeTab === 'notifications' && styles.navLabelActive,
                ]}
              >
                Bildirim
              </Text>
            </TouchableOpacity>
          </View>
      </View>
    </SafeAreaView>
  );
}

/* ------------------------------------------------------------------ */
/*  Styles                                                             */
/* ------------------------------------------------------------------ */

const styles = StyleSheet.create({
  /* --- Layout --- */
  safe: { flex: 1, backgroundColor: '#FFFDF9' },
  container: { flex: 1, backgroundColor: '#FFFDF9' },
  content: { flex: 1, zIndex: 10 },
  scroll: { flex: 1 },
  scrollContent: { paddingTop: 24, paddingHorizontal: 18, paddingBottom: 130 },

  /* --- Header --- */
  headerRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 },
  headerTextWrap: { flex: 1, paddingRight: 12 },
  greetingTitle: { color: '#3D3229', fontSize: 28, lineHeight: 34, fontWeight: '700' },
  greetingSubtitle: { marginTop: 4, color: '#A89B8C', fontSize: 13 },
  avatarCircle: { width: 42, height: 42, borderRadius: 21, backgroundColor: '#EDE8E0', alignItems: 'center', justifyContent: 'center' },
  avatarEmoji: { fontSize: 18 },

  /* --- Search --- */
  searchBox: {
    flexDirection: 'row', alignItems: 'center', gap: 10,
    backgroundColor: '#FFFDF9', borderRadius: 16, paddingHorizontal: 16, paddingVertical: 13,
    borderWidth: 1, borderColor: '#EDE8E0',
    marginBottom: 16,
  },
  searchIcon: { color: '#A89B8C', fontSize: 16, fontWeight: '700' },
  searchText: { color: '#A89B8C', fontSize: 14 },

  /* --- Categories --- */
  categoryScroll: { marginBottom: 16 },
  categoryContent: { gap: 6 },
  categoryChip: { backgroundColor: '#EDE8E0', borderRadius: 20, paddingHorizontal: 16, paddingVertical: 7 },
  categoryChipActive: { backgroundColor: '#3D3229' },
  categoryText: { color: '#6B5D4F', fontSize: 13, fontWeight: '600' },
  categoryTextActive: { color: '#F5F1EB' },

  /* --- Food card --- */
  foodCard: { borderWidth: 1, borderRadius: 18, overflow: 'hidden', marginBottom: 12 },
  foodPhoto: { width: '100%', height: 155, alignItems: 'center', justifyContent: 'center' },
  foodEmoji: { fontSize: 56 },
  ratingBadge: {
    position: 'absolute', top: 10, right: 10,
    backgroundColor: 'rgba(255,255,255,0.9)', borderRadius: 8,
    paddingHorizontal: 9, paddingVertical: 3,
    flexDirection: 'row', alignItems: 'center', gap: 3,
  },
  ratingBadgeStar: { color: '#C4953A', fontSize: 12, fontWeight: '700' },
  ratingBadgeText: { color: '#3D3229', fontSize: 12, fontWeight: '700' },
  foodInfo: { paddingHorizontal: 12, paddingVertical: 14 },
  foodInfoRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 6 },
  foodInfoLeft: { flex: 1, paddingRight: 8 },
  foodName: { fontSize: 16, fontWeight: '600' },
  foodSeller: { fontSize: 13, fontWeight: '500', marginTop: 2 },
  foodPrice: { fontSize: 18, fontWeight: '700' },
  foodMeta: { fontSize: 12 },

  /* --- Profile --- */
  profileCard: {
    marginTop: 24, marginHorizontal: 18, backgroundColor: '#FFFDF9',
    borderRadius: 28, padding: 22, borderWidth: 1, borderColor: '#EDE8E0',
  },
  profileHeader: { flexDirection: 'row', alignItems: 'center', gap: 14, marginBottom: 20 },
  profileAvatar: { width: 56, height: 56, borderRadius: 18, backgroundColor: '#EDE8E0', alignItems: 'center', justifyContent: 'center' },
  profileAvatarText: { fontSize: 26 },
  profileMeta: { flex: 1 },
  profileTitle: { color: '#3D3229', fontSize: 20, fontWeight: '700' },
  profileEmail: { color: '#A89B8C', fontSize: 13, marginTop: 4 },
  profileButton: { backgroundColor: '#EDE8E0', borderRadius: 14, paddingVertical: 14, alignItems: 'center', marginBottom: 10 },
  profileButtonText: { color: '#6B5D4F', fontSize: 14, fontWeight: '700' },
  profileDangerButton: { backgroundColor: '#D45454', borderRadius: 14, paddingVertical: 14, alignItems: 'center' },
  profileDangerButtonText: { color: '#FFFFFF', fontSize: 14, fontWeight: '700' },

  /* --- Inline error --- */
  inlineError: { color: '#D45454', fontSize: 13, lineHeight: 18, textAlign: 'center', marginTop: 6 },

  /* --- FAB --- */
  floatingWrap: {
    position: 'absolute', left: '50%', bottom: 52, marginLeft: -28,
    zIndex: 80, width: 56, height: 56, alignItems: 'center', justifyContent: 'center',
  },
  pulseRing1: {
    position: 'absolute', width: 70, height: 70, borderRadius: 35,
    borderWidth: 2.5, borderColor: 'rgba(74,124,89,0.45)',
    backgroundColor: 'transparent',
  },
  pulseRing2: {
    position: 'absolute', width: 70, height: 70, borderRadius: 35,
    borderWidth: 2, borderColor: 'rgba(74,124,89,0.30)',
    backgroundColor: 'transparent',
  },
  floatingButton: {
    width: 56, height: 56, borderRadius: 28, backgroundColor: '#4A7C59',
    alignItems: 'center', justifyContent: 'center',
    shadowColor: '#4A7C59', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.35, shadowRadius: 18,
    elevation: 10,
  },
  floatingButtonText: { color: '#FFFFFF', fontSize: 20, fontWeight: '700' },

  /* --- Bottom bar --- */
  bottomBar: {
    height: 82, backgroundColor: '#FFFDF9',
    borderTopWidth: 1, borderTopColor: '#EDE8E0',
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-around',
    paddingBottom: 16, paddingHorizontal: 8, zIndex: 50,
  },
  navItem: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  navSpacer: { width: 64 },
  navIcon: { color: '#A89B8C', fontSize: 18, fontWeight: '700', marginBottom: 4 },
  navIconActive: { color: '#4A7C59' },
  navLabel: { color: '#A89B8C', fontSize: 10, fontWeight: '700' },
  navLabelActive: { color: '#4A7C59' },

  /* --- Meal detail modal --- */
  modalOverlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)', justifyContent: 'flex-end' },
  modalContent: {
    backgroundColor: '#FFFDF9', borderTopLeftRadius: 28, borderTopRightRadius: 28,
    padding: 24, paddingBottom: 40, alignItems: 'center',
  },
  modalClose: {
    position: 'absolute', top: 16, right: 20,
    width: 32, height: 32, borderRadius: 16, backgroundColor: '#EDE8E0',
    alignItems: 'center', justifyContent: 'center', zIndex: 10,
  },
  modalCloseText: { color: '#6B5D4F', fontSize: 16, fontWeight: '700' },
  modalThumb: { width: 120, height: 120, borderRadius: 24, alignItems: 'center', justifyContent: 'center', marginBottom: 16 },
  modalEmoji: { fontSize: 56 },
  modalTitle: { color: '#3D3229', fontSize: 22, fontWeight: '700', marginBottom: 4 },
  modalSeller: { color: '#7A8B6E', fontSize: 14, fontWeight: '600', marginBottom: 8 },
  modalRating: { color: '#C4953A', fontSize: 14, fontWeight: '700', marginBottom: 8 },
  modalMeta: { color: '#A89B8C', fontSize: 13, marginBottom: 12, textAlign: 'center' },
  modalPrice: { color: '#5B7A4A', fontSize: 28, fontWeight: '700', marginTop: 8, marginBottom: 20 },
  modalCartButton: {
    backgroundColor: '#4A7C59', borderRadius: 16, paddingVertical: 16,
    paddingHorizontal: 48, width: '100%', alignItems: 'center',
  },
  modalCartButtonText: { color: '#FFFFFF', fontSize: 16, fontWeight: '700' },

  /* --- Agent modal --- */
  agentModalSafe: { flex: 1, backgroundColor: '#F5F1EB' },
  agentHeader: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between',
    paddingHorizontal: 16, paddingVertical: 12,
  },
  agentCloseBtn: {
    width: 34, height: 34, borderRadius: 17, backgroundColor: 'rgba(0,0,0,0.05)',
    alignItems: 'center', justifyContent: 'center',
  },
  agentHeaderTitle: { fontSize: 15, fontWeight: '600', color: '#3D3229' },
  modePill: { backgroundColor: 'rgba(0,0,0,0.05)', borderRadius: 12, padding: 3, flexDirection: 'row' },
  modeBtn: { paddingHorizontal: 16, paddingVertical: 6, borderRadius: 10 },
  modeBtnActive: {
    backgroundColor: '#fff',
    shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.1, shadowRadius: 2, elevation: 2,
  },
  modeBtnText: { color: '#A89B8C', fontSize: 13, fontWeight: '600' },
  modeBtnTextActive: { color: '#3D3229' },
  agentContent: { flex: 1 },
  agentCenter: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 16, paddingHorizontal: 32 },
  agentStatusText: { color: '#3D3229', fontSize: 16, fontWeight: '600' },
  agentErrorText: { color: '#D45454', fontSize: 14, textAlign: 'center', lineHeight: 20 },
  agentRetryBtn: { backgroundColor: '#4A7C59', borderRadius: 12, paddingHorizontal: 24, paddingVertical: 12 },
  agentRetryText: { color: '#fff', fontSize: 14, fontWeight: '600' },

  /* --- Chat (text mode) --- */
  chatListContainer: { flex: 1 },
  chatList: { padding: 16, paddingBottom: 8 },
  chatRowBot: { flexDirection: 'row', alignItems: 'flex-start', marginBottom: 12, gap: 8 },
  chatAvatar: { width: 28, height: 28, borderRadius: 14, backgroundColor: '#EDE8E0', alignItems: 'center', justifyContent: 'center' },
  chatAvatarEmoji: { fontSize: 14 },
  chatBubbleBot: {
    backgroundColor: '#FFFFFF', borderRadius: 16, borderTopLeftRadius: 4,
    paddingHorizontal: 13, paddingVertical: 10, maxWidth: '75%',
  },
  chatTextBot: { color: '#3D3229', fontSize: 14, lineHeight: 20 },
  chatRowUser: { flexDirection: 'row', justifyContent: 'flex-end', marginBottom: 12 },
  chatBubbleUser: {
    backgroundColor: '#4A7C59', borderRadius: 16, borderTopRightRadius: 4,
    paddingHorizontal: 13, paddingVertical: 10, maxWidth: '75%',
  },
  chatTextUser: { color: '#FFFFFF', fontSize: 14, lineHeight: 20 },
  chatInputRow: {
    flexDirection: 'row', alignItems: 'center', gap: 8,
    paddingHorizontal: 16, paddingVertical: 12,
    borderTopWidth: 1, borderTopColor: '#EDE8E0',
  },
  chatMicBtn: {
    width: 36, height: 36, borderRadius: 18, backgroundColor: 'rgba(0,0,0,0.05)',
    alignItems: 'center', justifyContent: 'center',
  },
  chatTextInput: {
    flex: 1, borderWidth: 1, borderColor: '#DDD7CC', borderRadius: 24,
    paddingHorizontal: 16, paddingVertical: 10, color: '#3D3229', fontSize: 14,
  },
  chatSendBtn: {
    width: 36, height: 36, borderRadius: 18, backgroundColor: '#4A7C59',
    alignItems: 'center', justifyContent: 'center',
  },
});
