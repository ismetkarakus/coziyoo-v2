import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  Easing,
  SafeAreaView,
  ScrollView,
  StatusBar,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { loadSettings } from '../utils/settings';
import { refreshAuthSession, type AuthSession } from '../utils/auth';
import VoiceSessionScreen from './VoiceSessionScreen';

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
  error?: {
    code?: string;
    message?: string;
  };
};

type VoiceState = 'idle' | 'starting' | 'active' | 'error';
type TabKey = 'home' | 'messages' | 'cart' | 'notifications' | 'profile';

type MealCard = {
  id: string;
  emoji: string;
  title: string;
  seller: string;
  goldRating: string;
  greenRating: string;
  meta: string;
  tags: string[];
  price: string;
  backgroundColor: string;
};

const meals: MealCard[] = [
  {
    id: 'mercimek',
    emoji: '🍲',
    title: 'Mercimek Corbasi',
    seller: 'Zeynep Hanim',
    goldRating: '4.5',
    greenRating: '5.0',
    meta: '2 km teslimat · Turk yemegi · 15 adet',
    tags: ['Gel Al', 'Teslimat'],
    price: '₺15',
    backgroundColor: '#F1DED0',
  },
  {
    id: 'karniyarik',
    emoji: '🥘',
    title: 'Karniyarik',
    seller: 'Ayse Teyze',
    goldRating: '4.8',
    greenRating: '4.9',
    meta: '3 km teslimat · Turk yemegi · 8 adet',
    tags: ['Gel Al', 'Teslimat'],
    price: '₺35',
    backgroundColor: '#D8E5D8',
  },
  {
    id: 'sutlac',
    emoji: '🍰',
    title: 'Sutlac',
    seller: 'Fatma Anne',
    goldRating: '4.7',
    greenRating: '5.0',
    meta: '1 km teslimat · Tatli · 20 adet',
    tags: ['Gel Al'],
    price: '₺25',
    backgroundColor: '#ECD4D8',
  },
];

const quickPrompts = [
  'Aksam yemegi oner',
  'Yakinimdaki ev yemekleri',
  'Diyet tarif oner',
];

export default function HomeScreen({ auth, onOpenSettings, onLogout, onAuthRefresh }: Props) {
  const [currentAuth, setCurrentAuth] = useState<AuthSession>(auth);
  const [apiUrl, setApiUrl] = useState('http://localhost:3000');
  const [activeTab, setActiveTab] = useState<TabKey>('home');
  const [voiceState, setVoiceState] = useState<VoiceState>('idle');
  const [voiceError, setVoiceError] = useState<string | null>(null);
  const [voiceSession, setVoiceSession] = useState<SessionData | null>(null);
  const [agentOpen, setAgentOpen] = useState(false);
  const [draftMessage, setDraftMessage] = useState('');

  const cardTranslate = useRef(new Animated.Value(24)).current;
  const cardScale = useRef(new Animated.Value(0.96)).current;
  const cardOpacity = useRef(new Animated.Value(0)).current;
  const overlayOpacity = useRef(new Animated.Value(0)).current;
  const buttonLift = useRef(new Animated.Value(0)).current;
  const pulseScale = useRef(new Animated.Value(1)).current;
  const pulseOpacity = useRef(new Animated.Value(0.55)).current;

  useEffect(() => {
    setCurrentAuth(auth);
  }, [auth]);

  useEffect(() => {
    loadSettings().then((s) => setApiUrl(s.apiUrl));
  }, []);

  useEffect(() => {
    Animated.parallel([
      Animated.timing(cardTranslate, {
        toValue: agentOpen ? 0 : 24,
        duration: 280,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
      Animated.timing(cardScale, {
        toValue: agentOpen ? 1 : 0.96,
        duration: 280,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
      Animated.timing(cardOpacity, {
        toValue: agentOpen ? 1 : 0,
        duration: 220,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
      Animated.timing(overlayOpacity, {
        toValue: agentOpen ? 1 : 0,
        duration: 220,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
      Animated.spring(buttonLift, {
        toValue: agentOpen ? -190 : 0,
        friction: 7,
        tension: 90,
        useNativeDriver: true,
      }),
    ]).start();
  }, [agentOpen, buttonLift, cardOpacity, cardScale, cardTranslate, overlayOpacity]);

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.parallel([
          Animated.timing(pulseScale, {
            toValue: 1.28,
            duration: 1400,
            easing: Easing.out(Easing.quad),
            useNativeDriver: true,
          }),
          Animated.timing(pulseOpacity, {
            toValue: 0,
            duration: 1400,
            easing: Easing.out(Easing.quad),
            useNativeDriver: true,
          }),
        ]),
        Animated.parallel([
          Animated.timing(pulseScale, {
            toValue: 1,
            duration: 0,
            useNativeDriver: true,
          }),
          Animated.timing(pulseOpacity, {
            toValue: 0.55,
            duration: 0,
            useNativeDriver: true,
          }),
        ]),
      ])
    );

    if (!agentOpen && voiceState !== 'starting') {
      loop.start();
    }

    return () => loop.stop();
  }, [agentOpen, pulseOpacity, pulseScale, voiceState]);

  function resolveStartSessionError(payload: ApiErrorPayload, status: number): string {
    const code = payload?.error?.code;
    if (code === 'AGENT_UNAVAILABLE') return 'Voice agent unavailable right now. Please try again in a moment.';
    if (code === 'N8N_UNAVAILABLE') return 'AI workflow server is unreachable. Please check the n8n server and try again.';
    if (code === 'N8N_WORKFLOW_UNAVAILABLE') return 'AI workflow is unavailable or inactive. Please check n8n and try again.';
    if (code === 'STT_UNAVAILABLE') return 'Speech recognition unavailable. Please check the STT server and try again.';
    if (code === 'TTS_UNAVAILABLE') return 'Voice synthesis unavailable. Please check the TTS server and try again.';
    if (status === 401) return 'Session expired. Please log in again.';
    return payload?.error?.message ?? `Server error ${status}`;
  }

  async function startSessionWithToken(accessToken: string): Promise<void> {
    const response = await fetch(`${apiUrl}/v1/livekit/session/start`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${accessToken}`,
      },
      body: JSON.stringify({
        autoDispatchAgent: true,
        channel: 'mobile',
      }),
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
      throw new Error(resolveStartSessionError(json as ApiErrorPayload, response.status));
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
    setAgentOpen(false);
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
      setVoiceError(err instanceof Error ? err.message : 'Failed to start session');
    }
  }

  function handleVoiceEnd() {
    setVoiceSession(null);
    setVoiceState('idle');
    setVoiceError(null);
  }

  function handleAgentToggle() {
    if (voiceSession && voiceState === 'active') return;
    setAgentOpen((prev) => !prev);
  }

  function handlePromptTap(prompt: string) {
    setDraftMessage(prompt);
  }

  function handleSend() {
    void handleStartVoice();
  }

  function handleTabPress(tab: TabKey) {
    setActiveTab(tab);
    if (tab !== 'home') {
      setAgentOpen(false);
    }
  }

  function renderHomeFeed() {
    return (
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.scrollContent}
        style={styles.scroll}
      >
        <View style={styles.headerRow}>
          <View style={styles.headerTextWrap}>
            <Text style={styles.greetingTitle}>Gunaydin, Lale</Text>
            <Text style={styles.greetingSubtitle}>Bugun ne yiyelim?</Text>
          </View>
          <TouchableOpacity activeOpacity={0.85} style={styles.avatarCircle} onPress={() => handleTabPress('profile')}>
            <Text style={styles.avatarEmoji}>👩‍🍳</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.searchBox}>
          <Text style={styles.searchIcon}>⌕</Text>
          <Text style={styles.searchText}>Tarif veya malzeme ara...</Text>
        </View>

        <View style={styles.topActionRow}>
          <TouchableOpacity style={styles.topChip} activeOpacity={0.85} onPress={onOpenSettings}>
            <Text style={styles.topChipText}>Ayarlar</Text>
          </TouchableOpacity>
          <View style={styles.userBadge}>
            <Text numberOfLines={1} style={styles.userBadgeText}>{currentAuth.email}</Text>
          </View>
        </View>

        {meals.map((meal) => (
          <View key={meal.id} style={styles.mealCard}>
            <View style={[styles.mealThumb, { backgroundColor: meal.backgroundColor }]}>
              <Text style={styles.mealEmoji}>{meal.emoji}</Text>
            </View>
            <View style={styles.mealInfo}>
              <Text style={styles.mealName}>{meal.title}</Text>
              <Text style={styles.mealSeller}>{meal.seller} →</Text>
              <View style={styles.ratingRow}>
                <Text style={styles.ratingGold}>★ {meal.goldRating}</Text>
                <Text style={styles.ratingGreen}>★ {meal.greenRating}</Text>
              </View>
              <Text style={styles.mealMeta}>{meal.meta}</Text>
              <View style={styles.tagRow}>
                {meal.tags.map((tag) => (
                  <View key={tag} style={styles.tagPill}>
                    <Text style={styles.tagText}>{tag}</Text>
                  </View>
                ))}
              </View>
            </View>
            <Text style={styles.mealPrice}>{meal.price}</Text>
            <TouchableOpacity style={styles.addCartButton} activeOpacity={0.85}>
              <Text style={styles.addCartButtonText}>Sepete Ekle</Text>
            </TouchableOpacity>
          </View>
        ))}

        {voiceError ? <Text style={styles.inlineError}>{voiceError}</Text> : null}
      </ScrollView>
    );
  }

  function renderContent() {
    if (voiceSession && voiceState === 'active') {
      return (
        <View style={styles.voiceSessionWrap}>
          <VoiceSessionScreen session={voiceSession} onEnd={handleVoiceEnd} />
        </View>
      );
    }

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

          <TouchableOpacity style={styles.profileButton} onPress={onOpenSettings}>
            <Text style={styles.profileButtonText}>Ayarlar</Text>
          </TouchableOpacity>
          <TouchableOpacity style={styles.profileDangerButton} onPress={onLogout}>
            <Text style={styles.profileDangerButtonText}>Cikis Yap</Text>
          </TouchableOpacity>
          {voiceError ? <Text style={styles.inlineError}>{voiceError}</Text> : null}
        </View>
      );
    }

    return renderHomeFeed();
  }

  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar barStyle="dark-content" backgroundColor="#E8E3DB" />
      <View style={styles.container}>
        <View style={styles.inner}>
          <Animated.View pointerEvents={agentOpen ? 'auto' : 'none'} style={[styles.overlay, { opacity: overlayOpacity }]} />
          <View style={styles.content}>{renderContent()}</View>

          {!voiceSession ? (
            <>
              <Animated.View
                pointerEvents={agentOpen ? 'auto' : 'none'}
                style={[
                  styles.agentCard,
                  {
                    opacity: cardOpacity,
                    transform: [{ translateY: cardTranslate }, { scale: cardScale }],
                  },
                ]}
              >
                <View style={styles.agentTop}>
                  <View style={styles.agentAvatar}>
                    <Text style={styles.agentAvatarText}>🧑‍🍳</Text>
                  </View>
                  <View style={styles.agentInfo}>
                    <Text style={styles.agentTitle}>Mutfak Asistani</Text>
                    <Text style={styles.agentSubtitle}>AI destekli yemek rehberiniz</Text>
                    <View style={styles.onlineRow}>
                      <View style={styles.onlineDot} />
                      <Text style={styles.onlineText}>Cevrimici</Text>
                    </View>
                  </View>
                </View>

                <Text style={styles.agentMessage}>
                  Merhaba! Bugun ne pisirmek istiyorsun? Sana kisisel oneriler sunabilirim.
                </Text>

                <View style={styles.chipsWrap}>
                  {quickPrompts.map((prompt) => (
                    <TouchableOpacity key={prompt} style={styles.promptChip} activeOpacity={0.85} onPress={() => handlePromptTap(prompt)}>
                      <Text style={styles.promptChipText}>{prompt}</Text>
                    </TouchableOpacity>
                  ))}
                </View>

                <View style={styles.inputRow}>
                  <TextInput
                    value={draftMessage}
                    onChangeText={setDraftMessage}
                    placeholder="Mesaj yazin..."
                    placeholderTextColor="#C5C0B8"
                    style={styles.input}
                    returnKeyType="send"
                    onSubmitEditing={handleSend}
                  />
                  <TouchableOpacity
                    style={[styles.sendButton, voiceState === 'error' && styles.sendButtonError]}
                    activeOpacity={0.85}
                    onPress={handleSend}
                    disabled={voiceState === 'starting'}
                  >
                    {voiceState === 'starting'
                      ? <ActivityIndicator color="#FFFFFF" size="small" />
                      : <Text style={styles.sendButtonText}>➜</Text>}
                  </TouchableOpacity>
                </View>
              </Animated.View>

              <Animated.View style={[styles.floatingWrap, { transform: [{ translateY: buttonLift }] }]}>
                {!agentOpen && voiceState !== 'starting' ? (
                  <Animated.View
                    pointerEvents="none"
                    style={[
                      styles.pulseRing,
                      {
                        opacity: pulseOpacity,
                        transform: [{ scale: pulseScale }],
                      },
                    ]}
                  />
                ) : null}

                <TouchableOpacity
                  style={[
                    styles.floatingButton,
                    agentOpen && styles.floatingButtonOpen,
                    voiceState === 'error' && styles.floatingButtonError,
                  ]}
                  activeOpacity={0.9}
                  onPress={handleAgentToggle}
                >
                  {voiceState === 'starting'
                    ? <ActivityIndicator color="#FFFFFF" size="small" />
                    : <Text style={styles.floatingButtonText}>{agentOpen ? '×' : 'C'}</Text>}
                </TouchableOpacity>
              </Animated.View>
            </>
          ) : null}

          {!voiceSession ? (
            <View style={styles.bottomBar}>
              <TouchableOpacity style={styles.navItem} onPress={() => handleTabPress('home')}>
                <Text style={[styles.navIcon, activeTab === 'home' && styles.navIconActive]}>⌂</Text>
                <Text style={[styles.navLabel, activeTab === 'home' && styles.navLabelActive]}>Ana Sayfa</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.navItem} onPress={() => handleTabPress('messages')}>
                <Text style={[styles.navIcon, activeTab === 'messages' && styles.navIconActive]}>◌</Text>
                <Text style={[styles.navLabel, activeTab === 'messages' && styles.navLabelActive]}>Mesajlar</Text>
              </TouchableOpacity>
              <View style={styles.navSpacer} />
              <TouchableOpacity style={styles.navItem} onPress={() => handleTabPress('cart')}>
                <Text style={[styles.navIcon, activeTab === 'cart' && styles.navIconActive]}>◍</Text>
                <Text style={[styles.navLabel, activeTab === 'cart' && styles.navLabelActive]}>Sepet</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.navItem} onPress={() => handleTabPress('notifications')}>
                <Text style={[styles.navIcon, activeTab === 'notifications' && styles.navIconActive]}>◔</Text>
                <Text style={[styles.navLabel, activeTab === 'notifications' && styles.navLabelActive]}>Bildirim</Text>
              </TouchableOpacity>
            </View>
          ) : null}
        </View>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: '#E8E3DB',
  },
  container: {
    flex: 1,
    backgroundColor: '#E8E3DB',
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  inner: {
    flex: 1,
    backgroundColor: '#FAF7F2',
    borderRadius: 34,
    overflow: 'hidden',
    shadowColor: '#2C2C2C',
    shadowOffset: { width: 0, height: 18 },
    shadowOpacity: 0.12,
    shadowRadius: 28,
    elevation: 10,
  },
  overlay: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: 'rgba(44,44,44,0.25)',
    zIndex: 40,
  },
  content: {
    flex: 1,
    zIndex: 10,
  },
  scroll: {
    flex: 1,
  },
  scrollContent: {
    paddingTop: 24,
    paddingHorizontal: 18,
    paddingBottom: 130,
  },
  headerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'flex-start',
    marginBottom: 16,
  },
  headerTextWrap: {
    flex: 1,
    paddingRight: 12,
  },
  greetingTitle: {
    color: '#2C2C2C',
    fontSize: 28,
    lineHeight: 34,
    fontWeight: '700',
  },
  greetingSubtitle: {
    marginTop: 4,
    color: '#9E9892',
    fontSize: 13,
  },
  avatarCircle: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: '#C5D4C6',
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarEmoji: {
    fontSize: 18,
  },
  searchBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    paddingHorizontal: 16,
    paddingVertical: 13,
    shadowColor: '#2C2C2C',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.06,
    shadowRadius: 20,
    elevation: 2,
    marginBottom: 16,
  },
  searchIcon: {
    color: '#9E9892',
    fontSize: 16,
    fontWeight: '700',
  },
  searchText: {
    color: '#9E9892',
    fontSize: 14,
  },
  topActionRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    marginBottom: 16,
  },
  topChip: {
    backgroundColor: '#E8EFE8',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  topChipText: {
    color: '#5B6E5F',
    fontSize: 13,
    fontWeight: '700',
  },
  userBadge: {
    flex: 1,
    backgroundColor: '#F5EFE6',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  userBadgeText: {
    color: '#6B6560',
    fontSize: 12,
    fontWeight: '600',
  },
  mealCard: {
    position: 'relative',
    flexDirection: 'row',
    gap: 14,
    backgroundColor: '#FFFFFF',
    borderRadius: 24,
    padding: 14,
    marginBottom: 14,
    shadowColor: '#2C2C2C',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.06,
    shadowRadius: 20,
    elevation: 3,
  },
  mealThumb: {
    width: 100,
    height: 100,
    borderRadius: 16,
    alignItems: 'center',
    justifyContent: 'center',
  },
  mealEmoji: {
    fontSize: 44,
  },
  mealInfo: {
    flex: 1,
    paddingRight: 54,
  },
  mealName: {
    color: '#2C2C2C',
    fontSize: 15,
    fontWeight: '700',
    marginBottom: 2,
  },
  mealSeller: {
    color: '#7A8F7E',
    fontSize: 12,
    fontWeight: '700',
    marginBottom: 5,
  },
  ratingRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 5,
  },
  ratingGold: {
    color: '#D4A843',
    fontSize: 12,
    fontWeight: '700',
  },
  ratingGreen: {
    color: '#5B8C5A',
    fontSize: 12,
    fontWeight: '700',
  },
  mealMeta: {
    color: '#9E9892',
    fontSize: 11.5,
    lineHeight: 16,
    marginBottom: 8,
  },
  tagRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 6,
  },
  tagPill: {
    backgroundColor: '#E8EFE8',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#C5D4C6',
    paddingHorizontal: 12,
    paddingVertical: 5,
  },
  tagText: {
    color: '#5B6E5F',
    fontSize: 11,
    fontWeight: '700',
  },
  mealPrice: {
    position: 'absolute',
    top: 14,
    right: 14,
    color: '#5B6E5F',
    fontSize: 16,
    fontWeight: '700',
  },
  addCartButton: {
    position: 'absolute',
    right: 14,
    bottom: 14,
    backgroundColor: '#7A8F7E',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  addCartButtonText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: '700',
  },
  inlineError: {
    color: '#C0392B',
    fontSize: 13,
    lineHeight: 18,
    textAlign: 'center',
    marginTop: 6,
  },
  profileCard: {
    marginTop: 24,
    marginHorizontal: 18,
    backgroundColor: '#FFFFFF',
    borderRadius: 28,
    padding: 22,
    shadowColor: '#2C2C2C',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.08,
    shadowRadius: 24,
    elevation: 4,
  },
  profileHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    marginBottom: 20,
  },
  profileAvatar: {
    width: 56,
    height: 56,
    borderRadius: 18,
    backgroundColor: '#C5D4C6',
    alignItems: 'center',
    justifyContent: 'center',
  },
  profileAvatarText: {
    fontSize: 26,
  },
  profileMeta: {
    flex: 1,
  },
  profileTitle: {
    color: '#2C2C2C',
    fontSize: 20,
    fontWeight: '700',
  },
  profileEmail: {
    color: '#6B6560',
    fontSize: 13,
    marginTop: 4,
  },
  profileButton: {
    backgroundColor: '#E8EFE8',
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: 'center',
    marginBottom: 10,
  },
  profileButtonText: {
    color: '#5B6E5F',
    fontSize: 14,
    fontWeight: '700',
  },
  profileDangerButton: {
    backgroundColor: '#C4836A',
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: 'center',
  },
  profileDangerButtonText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '700',
  },
  voiceSessionWrap: {
    flex: 1,
    backgroundColor: '#0A0A0A',
  },
  agentCard: {
    position: 'absolute',
    left: 16,
    right: 16,
    bottom: 96,
    backgroundColor: '#FFFFFF',
    borderRadius: 32,
    zIndex: 60,
    shadowColor: '#2C2C2C',
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.1,
    shadowRadius: 30,
    elevation: 12,
  },
  agentTop: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 14,
    paddingHorizontal: 22,
    paddingTop: 22,
    paddingBottom: 14,
  },
  agentAvatar: {
    width: 48,
    height: 48,
    borderRadius: 16,
    backgroundColor: '#C5D4C6',
    alignItems: 'center',
    justifyContent: 'center',
  },
  agentAvatarText: {
    fontSize: 24,
  },
  agentInfo: {
    flex: 1,
  },
  agentTitle: {
    color: '#2C2C2C',
    fontSize: 17,
    fontWeight: '700',
  },
  agentSubtitle: {
    color: '#9E9892',
    fontSize: 12,
    marginTop: 2,
  },
  onlineRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginTop: 4,
  },
  onlineDot: {
    width: 6,
    height: 6,
    borderRadius: 3,
    backgroundColor: '#7A8F7E',
  },
  onlineText: {
    color: '#7A8F7E',
    fontSize: 11,
    fontWeight: '700',
  },
  agentMessage: {
    color: '#6B6560',
    fontSize: 13.5,
    lineHeight: 20,
    paddingHorizontal: 22,
    paddingBottom: 16,
  },
  chipsWrap: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    paddingHorizontal: 22,
    paddingBottom: 18,
  },
  promptChip: {
    backgroundColor: '#E8EFE8',
    borderWidth: 1,
    borderColor: '#C5D4C6',
    borderRadius: 20,
    paddingHorizontal: 14,
    paddingVertical: 9,
  },
  promptChipText: {
    color: '#5B6E5F',
    fontSize: 12.5,
    fontWeight: '700',
  },
  inputRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingHorizontal: 22,
    paddingBottom: 22,
  },
  input: {
    flex: 1,
    backgroundColor: '#FAF7F2',
    borderRadius: 20,
    borderWidth: 1.5,
    borderColor: '#E5E0D8',
    paddingHorizontal: 16,
    paddingVertical: 12,
    color: '#2C2C2C',
    fontSize: 13,
  },
  sendButton: {
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: '#7A8F7E',
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendButtonError: {
    backgroundColor: '#C4836A',
  },
  sendButtonText: {
    color: '#FFFFFF',
    fontSize: 18,
    fontWeight: '700',
  },
  floatingWrap: {
    position: 'absolute',
    left: '50%',
    bottom: 30,
    marginLeft: -28,
    zIndex: 80,
    width: 56,
    height: 56,
    alignItems: 'center',
    justifyContent: 'center',
  },
  pulseRing: {
    position: 'absolute',
    width: 68,
    height: 68,
    borderRadius: 34,
    borderWidth: 2,
    borderColor: '#A8BCA9',
  },
  floatingButton: {
    width: 56,
    height: 56,
    borderRadius: 28,
    backgroundColor: '#7A8F7E',
    borderWidth: 4,
    borderColor: '#FAF7F2',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#5B6E5F',
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.35,
    shadowRadius: 20,
    elevation: 10,
  },
  floatingButtonOpen: {
    backgroundColor: '#5B6E5F',
  },
  floatingButtonError: {
    backgroundColor: '#C4836A',
  },
  floatingButtonText: {
    color: '#FFFFFF',
    fontSize: 24,
    fontWeight: '700',
    lineHeight: 26,
  },
  bottomBar: {
    height: 86,
    backgroundColor: 'rgba(250,247,242,0.96)',
    borderTopWidth: 1,
    borderTopColor: 'rgba(0,0,0,0.05)',
    flexDirection: 'row',
    alignItems: 'flex-start',
    justifyContent: 'space-around',
    paddingTop: 10,
    paddingHorizontal: 8,
    zIndex: 50,
  },
  navItem: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
  },
  navSpacer: {
    width: 56,
  },
  navIcon: {
    color: '#9E9892',
    fontSize: 18,
    fontWeight: '700',
    marginBottom: 4,
  },
  navIconActive: {
    color: '#5B6E5F',
  },
  navLabel: {
    color: '#9E9892',
    fontSize: 10,
    fontWeight: '700',
  },
  navLabelActive: {
    color: '#5B6E5F',
  },
});
