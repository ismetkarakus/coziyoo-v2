import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  FlatList,
  Image,
  KeyboardAvoidingView,
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

type ApiFoodItem = {
  id: string;
  name: string;
  cardSummary: string;
  description: string;
  price: number;
  imageUrl: string | null;
  rating: string | null;
  reviewCount: number;
  prepTime: number | null;
  maxDistance: number | null;
  category: string | null;
  allergens?: string[];
  stock: number;
  seller: { id: string; name: string; image: string | null };
};

type MealCard = {
  id: string;
  title: string;
  sellerId: string;
  seller: string;
  sellerImage?: string | null;
  allergens: string[];
  rating: string;
  time: string;
  distance: string;
  price: string;
  backgroundColor: string;
  category: string;
  imageUrl?: string;
};

type UiCategory =
  | 'Corbalar'
  | 'Ana Yemekler'
  | 'Salata'
  | 'Meze'
  | 'Tatlilar'
  | 'Icecekler';

type CardColors = {
  bg: string;
  border: string;
  title: string;
  subtitle: string;
  price: string;
  meta: string;
};

type SellerProfile = {
  startedYear: number;
  experienceYears: number;
  bio: string;
};

type ChatMessage = {
  id: string;
  text: string;
  isUser: boolean;
};

type SellerReview = {
  id: string;
  rating: number;
  comment: string;
  foodName: string;
  buyerName: string;
  createdAt: string;
};

function formatReviewDate(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString("tr-TR", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
  });
}

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

function normalizeHexColor(color: string, fallback = '#8A7B6A'): string {
  const normalized = color.trim();
  const withHash = normalized.startsWith('#') ? normalized : `#${normalized}`;
  if (!/^#[0-9a-fA-F]{6}$/.test(withHash)) return fallback;
  return withHash.toUpperCase();
}

function lighten(hex: string, amount: number): string {
  const h = hex.replace('#', '');
  const r = Math.min(
    255,
    Math.round(parseInt(h.substring(0, 2), 16) + (255 - parseInt(h.substring(0, 2), 16)) * amount),
  );
  const g = Math.min(
    255,
    Math.round(parseInt(h.substring(2, 4), 16) + (255 - parseInt(h.substring(2, 4), 16)) * amount),
  );
  const b = Math.min(
    255,
    Math.round(parseInt(h.substring(4, 6), 16) + (255 - parseInt(h.substring(4, 6), 16)) * amount),
  );
  return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
}

function hexToRgb(hex: string): { r: number; g: number; b: number } {
  const clean = normalizeHexColor(hex).replace('#', '');
  return {
    r: parseInt(clean.slice(0, 2), 16),
    g: parseInt(clean.slice(2, 4), 16),
    b: parseInt(clean.slice(4, 6), 16),
  };
}

function rgbToHex(r: number, g: number, b: number): string {
  return `#${Math.round(r).toString(16).padStart(2, '0')}${Math.round(g).toString(16).padStart(2, '0')}${Math.round(b).toString(16).padStart(2, '0')}`.toUpperCase();
}

function rgbToHsl(r: number, g: number, b: number): { h: number; s: number; l: number } {
  const rn = r / 255;
  const gn = g / 255;
  const bn = b / 255;
  const max = Math.max(rn, gn, bn);
  const min = Math.min(rn, gn, bn);
  const delta = max - min;
  let h = 0;
  const l = (max + min) / 2;
  const s = delta === 0 ? 0 : delta / (1 - Math.abs(2 * l - 1));

  if (delta !== 0) {
    if (max === rn) h = ((gn - bn) / delta) % 6;
    else if (max === gn) h = (bn - rn) / delta + 2;
    else h = (rn - gn) / delta + 4;
  }
  h = Math.round(h * 60);
  if (h < 0) h += 360;

  return { h, s, l };
}

function hslToRgb(h: number, s: number, l: number): { r: number; g: number; b: number } {
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const hp = h / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  let r1 = 0;
  let g1 = 0;
  let b1 = 0;

  if (hp >= 0 && hp < 1) {
    r1 = c;
    g1 = x;
  } else if (hp >= 1 && hp < 2) {
    r1 = x;
    g1 = c;
  } else if (hp >= 2 && hp < 3) {
    g1 = c;
    b1 = x;
  } else if (hp >= 3 && hp < 4) {
    g1 = x;
    b1 = c;
  } else if (hp >= 4 && hp < 5) {
    r1 = x;
    b1 = c;
  } else {
    r1 = c;
    b1 = x;
  }

  const m = l - c / 2;
  return {
    r: (r1 + m) * 255,
    g: (g1 + m) * 255,
    b: (b1 + m) * 255,
  };
}

function toneFromHue(h: number, saturation: number, lightness: number): string {
  const { r, g, b } = hslToRgb(h, saturation, lightness);
  return rgbToHex(r, g, b);
}

function deriveCardColors(dominant: string): CardColors {
  const safe = normalizeHexColor(dominant);
  const { r, g, b } = hexToRgb(safe);
  const { h, s } = rgbToHsl(r, g, b);
  const sat = Math.min(0.45, Math.max(0.18, s));
  const title = toneFromHue(h, sat, 0.24);
  const subtitle = toneFromHue(h, sat * 0.92, 0.34);
  const price = toneFromHue(h, sat, 0.28);
  const metaBase = toneFromHue(h, sat * 0.85, 0.44);
  return {
    bg: toneFromHue(h, sat * 0.55, 0.93),
    border: toneFromHue(h, sat * 0.5, 0.84),
    title,
    subtitle,
    price,
    meta: metaBase,
  };
}

/* ------------------------------------------------------------------ */
/*  Constants                                                          */
/* ------------------------------------------------------------------ */

const CATEGORIES = [
  'Tumu',
  'Corbalar',
  'Ana Yemekler',
  'Salata',
  'Meze',
  'Tatlilar',
  'Icecekler',
] as const;

const CATEGORY_BG_COLORS: Record<string, string> = {
  Corbalar: '#F1DED0',
  'Ana Yemekler': '#D8E5D8',
  Salata: '#D9EAD9',
  Meze: '#E1DDF1',
  Tatlilar: '#ECD4D8',
  Icecekler: '#D4DEE8',
};

function normalizeDishText(value: string): string {
  return value
    .toLocaleLowerCase('tr-TR')
    .replace(/ı/g, 'i')
    .replace(/ğ/g, 'g')
    .replace(/ü/g, 'u')
    .replace(/ş/g, 's')
    .replace(/ö/g, 'o')
    .replace(/ç/g, 'c');
}

function inferUiCategory(item: ApiFoodItem): UiCategory {
  const title = normalizeDishText(item.name);
  const sourceCategory = normalizeDishText(item.category ?? '');
  const haystack = `${title} ${sourceCategory}`;

  if (
    haystack.includes('corba') ||
    haystack.includes('mercimek') ||
    haystack.includes('ezogelin') ||
    haystack.includes('iskembe') ||
    haystack.includes('tarhana')
  ) {
    return 'Corbalar';
  }
  if (
    haystack.includes('salata') ||
    haystack.includes('piyaz') ||
    haystack.includes('kisir') ||
    haystack.includes('cacik')
  ) {
    return 'Salata';
  }
  if (
    haystack.includes('meze') ||
    haystack.includes('haydari') ||
    haystack.includes('ezme') ||
    haystack.includes('humus') ||
    haystack.includes('icli kofte') ||
    haystack.includes('cig kofte')
  ) {
    return 'Meze';
  }
  if (
    haystack.includes('tatli') ||
    haystack.includes('sutlac') ||
    haystack.includes('baklava') ||
    haystack.includes('kunefe')
  ) {
    return 'Tatlilar';
  }
  if (
    haystack.includes('icecek') ||
    haystack.includes('ayran') ||
    haystack.includes('serbet') ||
    haystack.includes('limonata')
  ) {
    return 'Icecekler';
  }
  return 'Ana Yemekler';
}

function resolveDishImage(title: string, category: string | null): string {
  const query = encodeURIComponent(`${title} ${category ?? ''} turkish dish plated`);
  const lock = [...title].reduce((sum, ch) => sum + ch.charCodeAt(0), 0) % 997;
  return `https://loremflickr.com/1200/800/${query}?lock=${lock}`;
}

function resolveSecondaryDishImage(title: string, category: string | null): string {
  const normalized = title.toLocaleLowerCase('tr-TR');
  const bucket =
    normalized.includes('çorba') ||
    normalized.includes('corba') ||
    normalized.includes('mercimek') ||
    normalized.includes('ezogelin') ||
    normalized.includes('işkembe') ||
    normalized.includes('iskembe')
      ? [
          'https://images.unsplash.com/photo-1547592166-23ac45744acd?auto=format&fit=crop&w=1200&q=80',
          'https://images.unsplash.com/photo-1604908176997-125f25cc6f3d?auto=format&fit=crop&w=1200&q=80',
        ]
      : normalized.includes('tatlı') ||
          normalized.includes('tatli') ||
          normalized.includes('sütlaç') ||
          normalized.includes('sutlac') ||
          normalized.includes('baklava') ||
          normalized.includes('künefe') ||
          normalized.includes('kunefe')
        ? [
            'https://images.unsplash.com/photo-1551024506-0bccd828d307?auto=format&fit=crop&w=1200&q=80',
            'https://images.unsplash.com/photo-1563729784474-d77dbb933a9e?auto=format&fit=crop&w=1200&q=80',
          ]
        : [
            'https://images.unsplash.com/photo-1544025162-d76694265947?auto=format&fit=crop&w=1200&q=80',
            'https://images.unsplash.com/photo-1529563021893-cc83c992d75d?auto=format&fit=crop&w=1200&q=80',
          ];
  const seed = [...`${title}${category ?? ''}`].reduce(
    (sum, ch) => sum + ch.charCodeAt(0),
    0,
  );
  return bucket[seed % bucket.length];
}

function apiToMealCard(item: ApiFoodItem): MealCard {
  const uiCategory = inferUiCategory(item);
  return {
    id: item.id,
    title: item.name,
    sellerId: item.seller.id,
    seller: item.seller.name,
    sellerImage: item.seller.image,
    allergens: item.allergens ?? [],
    rating: item.rating ?? '0.0',
    time: item.prepTime ? `${item.prepTime} dk` : '',
    distance: item.maxDistance ? `${item.maxDistance} km` : '',
    price: `₺${item.price}`,
    backgroundColor: CATEGORY_BG_COLORS[uiCategory] ?? '#E8E3DB',
    category: uiCategory,
    imageUrl: resolveDishImage(item.name, uiCategory),
  };
}

function hashString(input: string): number {
  let hash = 0;
  for (let i = 0; i < input.length; i += 1) {
    hash = (hash * 31 + input.charCodeAt(i)) >>> 0;
  }
  return hash;
}

function buildSellerProfile(
  sellerId: string,
  sellerName: string,
  sellerMeals: MealCard[],
): SellerProfile {
  const nowYear = new Date().getFullYear();
  const seed = hashString(`${sellerId}:${sellerName}`);
  const experienceYears = 4 + (seed % 13); // 4-16 yil
  const startedYear = nowYear - experienceYears;
  const topCategories = Array.from(
    new Set(
      sellerMeals
        .map((meal) => meal.category)
        .filter((category) => category && category !== 'Tumu'),
    ),
  )
    .slice(0, 2)
    .join(' ve ');
  const speciality = topCategories || 'ev yemegi';
  return {
    startedYear,
    experienceYears,
    bio: `${sellerName}, ${startedYear} yilindan beri mutfakta aktif olarak calisiyor. Ozellikle ${speciality} konusunda deneyimli; gunluk taze uretim, dengeli lezzet ve duzenli kaliteye odaklaniyor.`,
  };
}

const INITIAL_CHAT: ChatMessage[] = [
  {
    id: '1',
    text: 'Canin ne cekiyor? Anlatir misin, sana en uygun ev yemeklerini bulayim.',
    isUser: false,
  },
];

const INITIAL_INBOX_MESSAGES: ChatMessage[] = [
  {
    id: 'seed-1',
    text: 'Merhaba, yarin icin mercimek corbasi ve pilav hazirlayabilirim.',
    isUser: false,
  },
  {
    id: 'seed-2',
    text: 'Tesekkurler, saat 19:00 gibi teslim olur mu?',
    isUser: true,
  },
  {
    id: 'seed-3',
    text: 'Olur. Alerjen bilgisi olarak sut ve kereviz mevcut.',
    isUser: false,
  },
];

const MESSAGE_WALLPAPERS = [
  {
    kind: 'blobs',
    bg: '#F7F3EC',
    c1: 'rgba(74,124,89,0.10)',
    c2: 'rgba(201,149,58,0.10)',
    c3: 'rgba(109,93,79,0.08)',
  },
  {
    kind: 'stripes',
    bg: '#F2F7F3',
    c1: 'rgba(74,124,89,0.16)',
    c2: 'rgba(120,170,132,0.14)',
    c3: 'rgba(61,50,41,0.10)',
  },
  {
    kind: 'grid',
    bg: '#F8F2F4',
    c1: 'rgba(181,112,129,0.18)',
    c2: 'rgba(221,168,128,0.14)',
    c3: 'rgba(107,93,79,0.10)',
  },
  {
    kind: 'rings',
    bg: '#F1F5FA',
    c1: 'rgba(88,120,168,0.20)',
    c2: 'rgba(153,183,220,0.16)',
    c3: 'rgba(93,108,130,0.10)',
  },
  {
    kind: 'diagonal',
    bg: '#F8F5EE',
    c1: 'rgba(187,137,79,0.18)',
    c2: 'rgba(214,179,129,0.14)',
    c3: 'rgba(120,96,74,0.10)',
  },
  {
    kind: 'cards',
    bg: '#F2F8F8',
    c1: 'rgba(67,143,143,0.16)',
    c2: 'rgba(137,199,190,0.12)',
    c3: 'rgba(78,112,110,0.10)',
  },
  {
    kind: 'waves',
    bg: '#F8F2EE',
    c1: 'rgba(197,118,84,0.16)',
    c2: 'rgba(228,165,134,0.12)',
    c3: 'rgba(124,87,72,0.10)',
  },
  {
    kind: 'dots',
    bg: '#F4F3F9',
    c1: 'rgba(122,109,176,0.18)',
    c2: 'rgba(177,166,220,0.14)',
    c3: 'rgba(93,87,126,0.10)',
  },
  {
    kind: 'sunset',
    bg: '#F3F8F0',
    c1: 'rgba(120,163,88,0.16)',
    c2: 'rgba(171,210,137,0.12)',
    c3: 'rgba(95,121,72,0.10)',
  },
  {
    kind: 'minimal',
    bg: '#F9F1F5',
    c1: 'rgba(179,96,143,0.16)',
    c2: 'rgba(219,157,190,0.12)',
    c3: 'rgba(118,81,103,0.10)',
  },
] as const;

/* ------------------------------------------------------------------ */
/*  FoodCard                                                           */
/* ------------------------------------------------------------------ */

function FoodCard({
  meal,
  onPress,
  onSellerPress,
}: {
  meal: MealCard;
  onPress: () => void;
  onSellerPress: () => void;
}) {
  const [colors, setColors] = useState<CardColors>(
    deriveCardColors(meal.backgroundColor),
  );
  const [imageFailed, setImageFailed] = useState(false);
  const [imageUrl, setImageUrl] = useState<string | undefined>(meal.imageUrl);
  const [didTrySecondary, setDidTrySecondary] = useState(false);

  useEffect(() => {
    setImageFailed(false);
    setDidTrySecondary(false);
    setImageUrl(meal.imageUrl);
  }, [meal.imageUrl]);

  useEffect(() => {
    if (!imageUrl || imageFailed || !getColors) {
      setColors(deriveCardColors(meal.backgroundColor));
      return;
    }
    getColors(imageUrl, {
      fallback: meal.backgroundColor,
      cache: true,
      key: imageUrl,
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
  }, [imageUrl, meal.backgroundColor, imageFailed]);

  const allergens = Array.isArray(meal.allergens) ? meal.allergens : [];

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
        {imageUrl && !imageFailed ? (
          <Image
            source={{ uri: imageUrl }}
            style={styles.foodImage}
            resizeMode="cover"
            onError={() => {
              if (!didTrySecondary) {
                setDidTrySecondary(true);
                setImageUrl(resolveSecondaryDishImage(meal.title, meal.category));
                return;
              }
              setImageFailed(true);
            }}
          />
        ) : (
          <Text style={styles.foodEmoji}>🍽️</Text>
        )}
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
            <TouchableOpacity
              activeOpacity={0.8}
              onPress={onSellerPress}
              style={styles.foodSellerLink}
            >
              <Text style={[styles.foodSeller, { color: colors.subtitle }]}>
                {meal.seller}
              </Text>
              <Ionicons
                name="chevron-forward-outline"
                size={14}
                color={colors.subtitle}
                style={styles.foodSellerChevron}
              />
            </TouchableOpacity>
          </View>
          <View style={styles.foodRightCol}>
            <Text style={[styles.foodPrice, { color: colors.price }]}>
              {meal.price}
            </Text>
          </View>
        </View>
        <View style={styles.foodBottomRow}>
          <Text style={[styles.foodMeta, { color: colors.meta }]}>
            🕐 {meal.time} · {meal.distance}
          </Text>
          {allergens.length > 0 ? (
            <Text style={styles.foodBottomAllergenText}>
              Alerjen: {allergens.slice(0, 3).join(', ')}
            </Text>
          ) : null}
        </View>
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
  const [searchMode, setSearchMode] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [meals, setMeals] = useState<MealCard[]>([]);
  const [mealsLoading, setMealsLoading] = useState(true);
  const [mealsError, setMealsError] = useState<string | null>(null);
  const [voiceState, setVoiceState] = useState<VoiceState>('idle');
  const [voiceError, setVoiceError] = useState<string | null>(null);
  const [voiceSession, setVoiceSession] = useState<SessionData | null>(null);
  const [agentModalVisible, setAgentModalVisible] = useState(false);
  const [agentMode, setAgentMode] = useState<AgentMode>('voice');
  const [chatMessages, setChatMessages] =
    useState<ChatMessage[]>(INITIAL_CHAT);
  const [chatInput, setChatInput] = useState('');
  const [inboxMessages, setInboxMessages] =
    useState<ChatMessage[]>(INITIAL_INBOX_MESSAGES);
  const [inboxInput, setInboxInput] = useState('');
  const [messagesWallpaperIndex, setMessagesWallpaperIndex] = useState(0);
  const [selectedMeal, setSelectedMeal] = useState<MealCard | null>(null);
  const [selectedSeller, setSelectedSeller] = useState<{
    id: string;
    name: string;
    image?: string | null;
  } | null>(null);
  const [sellerReviews, setSellerReviews] = useState<SellerReview[]>([]);
  const [sellerReviewsLoading, setSellerReviewsLoading] = useState(false);
  const [sellerReviewsError, setSellerReviewsError] = useState<string | null>(null);
  const [cartCount, setCartCount] = useState(0);

  // FAB animations
  const breatheScale = useRef(new Animated.Value(1)).current;
  const searchInputRef = useRef<TextInput>(null);

  useEffect(() => {
    setCurrentAuth(auth);
  }, [auth]);

  useEffect(() => {
    loadSettings().then((s) => setApiUrl(s.apiUrl));
  }, []);

  // Fetch foods from API
  useEffect(() => {
    if (!apiUrl || apiUrl === 'http://localhost:3000') {
      // Wait until apiUrl is loaded from settings
      loadSettings().then((s) => {
        if (s.apiUrl) fetchFoods(s.apiUrl);
      });
      return;
    }
    fetchFoods(apiUrl);
  }, [apiUrl, currentAuth.accessToken]);

  async function fetchFoods(url: string) {
    setMealsLoading(true);
    setMealsError(null);
    try {
      const response = await fetch(`${url}/v1/foods`, {
        headers: { Authorization: `Bearer ${currentAuth.accessToken}` },
      });
      if (response.status === 401) {
        const refreshed = await refreshAuthSession(url, currentAuth);
        if (refreshed) {
          setCurrentAuth(refreshed);
          onAuthRefresh?.(refreshed);
          const retryRes = await fetch(`${url}/v1/foods`, {
            headers: { Authorization: `Bearer ${refreshed.accessToken}` },
          });
          if (!retryRes.ok) {
            setMeals([]);
            setMealsError(`retry failed (${retryRes.status})`);
            return;
          }
          const retryJson = await retryRes.json();
          if (Array.isArray(retryJson.data)) {
            setMeals(retryJson.data.map(apiToMealCard));
          } else {
            setMeals([]);
            setMealsError('retry response has no data');
          }
        }
        return;
      }
      if (!response.ok) {
        setMeals([]);
        setMealsError(`request failed (${response.status})`);
        return;
      }
      const json = await response.json();
      if (Array.isArray(json.data)) {
        setMeals(json.data.map(apiToMealCard));
      } else {
        setMeals([]);
        setMealsError('response has no data');
      }
    } catch (err) {
      console.warn('[HomeScreen] failed to fetch foods:', err);
      setMeals([]);
      setMealsError(err instanceof Error ? err.message : 'fetch failed');
    } finally {
      setMealsLoading(false);
    }
  }

  // FAB pulse & breathe animations
  useEffect(() => {
    const breathe = Animated.loop(
      Animated.sequence([
        Animated.timing(breatheScale, {
          toValue: 1.065,
          duration: 900,
          useNativeDriver: true,
        }),
        Animated.timing(breatheScale, {
          toValue: 1,
          duration: 1100,
          useNativeDriver: true,
        }),
      ]),
    );

    breathe.start();

    return () => {
      breathe.stop();
    };
  }, [breatheScale]);

  useEffect(() => {
    if (searchMode) {
      const t = setTimeout(() => searchInputRef.current?.focus(), 80);
      return () => clearTimeout(t);
    }
    return undefined;
  }, [searchMode]);

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

  function handleInboxSend() {
    const text = inboxInput.trim();
    if (!text) return;
    setInboxMessages((prev) => [
      ...prev,
      { id: `inbox-${Date.now()}`, text, isUser: true },
    ]);
    setInboxInput('');
  }

  function handleWallpaperSwitch() {
    setMessagesWallpaperIndex((prev) => (prev + 1) % MESSAGE_WALLPAPERS.length);
  }

  function renderMessagesWallpaper(
    wallpaper: (typeof MESSAGE_WALLPAPERS)[number],
  ) {
    switch (wallpaper.kind) {
      case 'stripes':
        return (
          <>
            <View style={[styles.messagesStripeA, { backgroundColor: wallpaper.c1 }]} />
            <View style={[styles.messagesStripeB, { backgroundColor: wallpaper.c2 }]} />
            <View style={[styles.messagesStripeC, { backgroundColor: wallpaper.c3 }]} />
          </>
        );
      case 'grid':
        return (
          <>
            <View style={[styles.messagesGridVertical, { borderColor: wallpaper.c1 }]} />
            <View style={[styles.messagesGridHorizontal, { borderColor: wallpaper.c2 }]} />
            <View style={[styles.messagesGridSpot, { backgroundColor: wallpaper.c3 }]} />
          </>
        );
      case 'rings':
        return (
          <>
            <View style={[styles.messagesRingA, { borderColor: wallpaper.c1 }]} />
            <View style={[styles.messagesRingB, { borderColor: wallpaper.c2 }]} />
            <View style={[styles.messagesRingC, { borderColor: wallpaper.c3 }]} />
          </>
        );
      case 'diagonal':
        return (
          <>
            <View style={[styles.messagesDiagA, { backgroundColor: wallpaper.c1 }]} />
            <View style={[styles.messagesDiagB, { backgroundColor: wallpaper.c2 }]} />
            <View style={[styles.messagesDiagC, { backgroundColor: wallpaper.c3 }]} />
          </>
        );
      case 'cards':
        return (
          <>
            <View style={[styles.messagesCardA, { backgroundColor: wallpaper.c1 }]} />
            <View style={[styles.messagesCardB, { backgroundColor: wallpaper.c2 }]} />
            <View style={[styles.messagesCardC, { backgroundColor: wallpaper.c3 }]} />
          </>
        );
      case 'waves':
        return (
          <>
            <View style={[styles.messagesWaveA, { backgroundColor: wallpaper.c1 }]} />
            <View style={[styles.messagesWaveB, { backgroundColor: wallpaper.c2 }]} />
            <View style={[styles.messagesWaveC, { backgroundColor: wallpaper.c3 }]} />
          </>
        );
      case 'dots':
        return (
          <>
            <View style={[styles.messagesDotsA, { backgroundColor: wallpaper.c1 }]} />
            <View style={[styles.messagesDotsB, { backgroundColor: wallpaper.c2 }]} />
            <View style={[styles.messagesDotsC, { backgroundColor: wallpaper.c3 }]} />
          </>
        );
      case 'sunset':
        return (
          <>
            <View style={[styles.messagesSunsetSky, { backgroundColor: wallpaper.c1 }]} />
            <View style={[styles.messagesSunsetHorizon, { backgroundColor: wallpaper.c2 }]} />
            <View style={[styles.messagesSunsetSun, { backgroundColor: wallpaper.c3 }]} />
          </>
        );
      case 'minimal':
        return (
          <>
            <View style={[styles.messagesMinLineA, { backgroundColor: wallpaper.c1 }]} />
            <View style={[styles.messagesMinLineB, { backgroundColor: wallpaper.c2 }]} />
            <View style={[styles.messagesMinDot, { backgroundColor: wallpaper.c3 }]} />
          </>
        );
      case 'blobs':
      default:
        return (
          <>
            <View style={[styles.messagesBlob1, { backgroundColor: wallpaper.c1 }]} />
            <View style={[styles.messagesBlob2, { backgroundColor: wallpaper.c2 }]} />
            <View style={[styles.messagesBlob3, { backgroundColor: wallpaper.c3 }]} />
          </>
        );
    }
  }

  function handleTabPress(tab: TabKey) {
    setActiveTab(tab);
  }

  /* ---------- Filtered meals ---------- */

  const filteredMeals =
    activeCategory === 'Tumu'
      ? meals
      : meals.filter((m) => m.category === activeCategory);
  const visibleMeals = searchQuery.trim()
    ? filteredMeals.filter((m) => {
        const q = searchQuery.trim().toLocaleLowerCase('tr-TR');
        return (
          m.title.toLocaleLowerCase('tr-TR').includes(q) ||
          m.seller.toLocaleLowerCase('tr-TR').includes(q)
        );
      })
    : filteredMeals;
  const sellerMeals = selectedSeller
    ? meals.filter((meal) => meal.sellerId === selectedSeller.id)
    : [];
  const sellerAverageRating = sellerMeals.length
    ? (
        sellerMeals.reduce(
          (sum, meal) => sum + (Number.parseFloat(meal.rating) || 0),
          0,
        ) / sellerMeals.length
      ).toFixed(1)
    : '0.0';
  const sellerProfile = selectedSeller
    ? buildSellerProfile(selectedSeller.id, selectedSeller.name, sellerMeals)
    : null;

  useEffect(() => {
    if (!selectedSeller) {
      setSellerReviews([]);
      setSellerReviewsLoading(false);
      setSellerReviewsError(null);
      return;
    }
    let cancelled = false;
    setSellerReviewsLoading(true);
    setSellerReviewsError(null);
    fetch(`${apiUrl}/v1/foods/sellers/${selectedSeller.id}/reviews`, {
      headers: { Authorization: `Bearer ${currentAuth.accessToken}` },
    })
      .then(async (response) => {
        const json = (await response.json()) as { data?: SellerReview[]; error?: { message?: string } };
        if (!response.ok) {
          throw new Error(json.error?.message ?? `request failed (${response.status})`);
        }
        return json.data ?? [];
      })
      .then((reviews) => {
        if (cancelled) return;
        setSellerReviews(reviews);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setSellerReviews([]);
        setSellerReviewsError(err instanceof Error ? err.message : "Yorumlar yuklenemedi");
      })
      .finally(() => {
        if (cancelled) return;
        setSellerReviewsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [selectedSeller?.id, apiUrl, currentAuth.accessToken]);

  /* ---------- Render helpers ---------- */

  function renderHomeFeed() {
    return (
      <ScrollView
        showsVerticalScrollIndicator={false}
        contentContainerStyle={styles.scrollContent}
        style={styles.scroll}
        stickyHeaderIndices={[1]}
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

        {/* Sticky search + category chips */}
        <View style={styles.searchStickyWrap}>
          <View style={styles.searchBox}>
            {!searchMode ? (
              <View pointerEvents="none" style={styles.searchFadeWrap}>
                <View style={styles.searchFadeSolid} />
                <View style={styles.searchFadeSoft} />
              </View>
            ) : null}
            <TouchableOpacity
              activeOpacity={0.8}
              onPress={() => {
                if (searchMode) {
                  setSearchMode(false);
                  setSearchQuery('');
                  return;
                }
                setSearchMode(true);
              }}
              style={styles.searchIconButton}
            >
            <Ionicons
                name={searchMode ? 'close-outline' : 'search-outline'}
                size={28}
                color="#5F5246"
                style={!searchMode ? styles.searchIconGlyph : undefined}
              />
            </TouchableOpacity>
            <View style={styles.searchContent}>
              {searchMode ? (
                <TextInput
                  ref={searchInputRef}
                  value={searchQuery}
                  onChangeText={setSearchQuery}
                  placeholder="Yemek veya satici ara..."
                  placeholderTextColor="#A89B8C"
                  style={styles.searchInput}
                  returnKeyType="search"
                />
              ) : (
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={styles.categoryContent}
                  style={styles.searchCategoryScroller}
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
              )}
            </View>
          </View>
        </View>
        {__DEV__ ? (
          <View style={styles.debugBox}>
            <Text style={styles.debugText}>API: {apiUrl}</Text>
            <Text style={styles.debugText}>
              foods: {meals.length} | filtered: {visibleMeals.length} | loading:{' '}
              {mealsLoading ? 'yes' : 'no'}
            </Text>
            {mealsError ? (
              <Text style={styles.debugError}>error: {mealsError}</Text>
            ) : null}
          </View>
        ) : null}

        {/* Food cards */}
        {visibleMeals.map((meal) => (
          <FoodCard
            key={meal.id}
            meal={meal}
            onPress={() => setSelectedMeal(meal)}
            onSellerPress={() =>
              setSelectedSeller({
                id: meal.sellerId,
                name: meal.seller,
                image: meal.sellerImage ?? null,
              })
            }
          />
        ))}

        {voiceError && !agentModalVisible ? (
          <Text style={styles.inlineError}>{voiceError}</Text>
        ) : null}
      </ScrollView>
    );
  }

  function renderContent() {
    if (activeTab === 'messages') {
      const wallpaper = MESSAGE_WALLPAPERS[messagesWallpaperIndex];
      return (
        <KeyboardAvoidingView
          style={styles.messagesTabWrap}
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          keyboardVerticalOffset={Platform.OS === 'ios' ? 78 : 0}
        >
          <View
            pointerEvents="none"
            style={[styles.messagesWallpaper, { backgroundColor: wallpaper.bg }]}
          >
            {renderMessagesWallpaper(wallpaper)}
          </View>
          <View style={styles.messagesTabHeader}>
            <View style={styles.messagesTabHeaderText}>
              <Text style={styles.messagesTabTitle}>Mesajlar</Text>
              <Text style={styles.messagesTabSubtitle}>Ustalarla iletisim kur</Text>
            </View>
            <TouchableOpacity
              style={styles.messagesWallpaperBtn}
              onPress={handleWallpaperSwitch}
              activeOpacity={0.85}
            >
              <Ionicons name="color-palette-outline" size={19} color="#5F5246" />
            </TouchableOpacity>
          </View>
          <FlatList
            data={inboxMessages}
            renderItem={renderChatMessage}
            keyExtractor={(item) => item.id}
            contentContainerStyle={styles.chatList}
            style={styles.chatListContainer}
          />
          <View style={styles.chatInputRow}>
            <TextInput
              value={inboxInput}
              onChangeText={setInboxInput}
              placeholder="Mesaj yaz..."
              placeholderTextColor="#A89B8C"
              style={styles.chatTextInput}
              returnKeyType="send"
              onSubmitEditing={handleInboxSend}
            />
            <TouchableOpacity
              style={styles.chatSendBtn}
              onPress={handleInboxSend}
            >
              <Ionicons name="arrow-up" size={18} color="#fff" />
            </TouchableOpacity>
          </View>
        </KeyboardAvoidingView>
      );
    }
    if (activeTab === 'cart') {
      return (
        <View style={styles.tabPanelCard}>
          <Text style={styles.tabPanelTitle}>Sepet</Text>
          <Text style={styles.tabPanelText}>
            Sepetindeki urun sayisi: {cartCount}
          </Text>
        </View>
      );
    }
    if (activeTab === 'notifications') {
      return (
        <View style={styles.tabPanelCard}>
          <Text style={styles.tabPanelTitle}>Bildirimler</Text>
          <Text style={styles.tabPanelText}>
            Yeni bildirimlerin burada listelenecek.
          </Text>
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
                {selectedMeal.imageUrl ? (
                  <Image
                    source={{ uri: selectedMeal.imageUrl }}
                    style={styles.modalImage}
                    resizeMode="cover"
                  />
                ) : (
                  <Text style={styles.modalEmoji}>🍽️</Text>
                )}
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
        visible={!!selectedSeller}
        animationType="slide"
        transparent
        onRequestClose={() => setSelectedSeller(null)}
      >
        {selectedSeller ? (
          <View style={styles.modalOverlay}>
            <View style={styles.sellerModalContent}>
              <TouchableOpacity
                style={styles.modalClose}
                onPress={() => setSelectedSeller(null)}
              >
                <Text style={styles.modalCloseText}>✕</Text>
              </TouchableOpacity>

              <View style={styles.sellerHeader}>
                <View style={styles.sellerAvatar}>
                  <Text style={styles.sellerAvatarEmoji}>👩‍🍳</Text>
                </View>
                <View style={styles.sellerHeaderText}>
                  <Text style={styles.sellerTitle}>{selectedSeller.name}</Text>
                  <Text style={styles.sellerSubtitle}>Usta Mutfagi</Text>
                </View>
              </View>

              <View style={styles.sellerStatsRow}>
                <View style={styles.sellerStatCard}>
                  <Text style={styles.sellerStatValue}>{sellerMeals.length}</Text>
                  <Text style={styles.sellerStatLabel}>Yemek</Text>
                </View>
                <View style={styles.sellerStatCard}>
                  <Text style={styles.sellerStatValue}>★ {sellerAverageRating}</Text>
                  <Text style={styles.sellerStatLabel}>Ortalama</Text>
                </View>
              </View>
              {sellerProfile ? (
                <View style={styles.sellerAboutCard}>
                  <Text style={styles.sellerAboutTitle}>Usta Ozgecmisi</Text>
                  <Text style={styles.sellerAboutMeta}>
                    {sellerProfile.startedYear} yilindan beri • {sellerProfile.experienceYears} yil tecrube
                  </Text>
                  <Text style={styles.sellerAboutText}>{sellerProfile.bio}</Text>
                </View>
              ) : null}

              <Text style={styles.sellerSectionTitle}>Yorumlar</Text>
              {sellerReviewsLoading ? (
                <View style={styles.sellerReviewsLoadingRow}>
                  <ActivityIndicator size="small" color="#4A7C59" />
                  <Text style={styles.sellerReviewsLoadingText}>Yorumlar yukleniyor...</Text>
                </View>
              ) : null}
              {sellerReviewsError ? (
                <Text style={styles.sellerReviewsErrorText}>{sellerReviewsError}</Text>
              ) : null}
              {!sellerReviewsLoading && !sellerReviewsError && sellerReviews.length === 0 ? (
                <Text style={styles.sellerEmptyReviewsText}>Bu usta icin henuz yorum yok.</Text>
              ) : null}
              {!sellerReviewsLoading && !sellerReviewsError ? (
                <ScrollView
                  style={styles.sellerReviewList}
                  showsVerticalScrollIndicator={false}
                >
                  {sellerReviews.map((review) => (
                    <View key={review.id} style={styles.sellerReviewItem}>
                      <View style={styles.sellerReviewHead}>
                        <Text style={styles.sellerReviewBuyer}>{review.buyerName}</Text>
                        <View style={styles.sellerReviewRight}>
                          <View style={styles.sellerReviewStars}>
                            {[1, 2, 3, 4, 5].map((idx) => (
                              <Ionicons
                                key={`${review.id}-star-${idx}`}
                                name={idx <= review.rating ? 'star' : 'star-outline'}
                                size={13}
                                color="#D4A017"
                              />
                            ))}
                          </View>
                          <Text style={styles.sellerReviewDate}>{formatReviewDate(review.createdAt)}</Text>
                        </View>
                      </View>
                      <Text style={styles.sellerReviewFood}>Yemek: {review.foodName}</Text>
                      <Text style={styles.sellerReviewComment}>
                        {review.comment?.trim() || 'Yorum metni birakilmadi.'}
                      </Text>
                    </View>
                  ))}
                </ScrollView>
              ) : null}

              <Text style={styles.sellerSectionTitle}>Ustanin Yemekleri</Text>
              <ScrollView
                style={styles.sellerMealList}
                showsVerticalScrollIndicator={false}
              >
                {sellerMeals.map((meal) => (
                  <TouchableOpacity
                    key={meal.id}
                    style={styles.sellerMealItem}
                    activeOpacity={0.85}
                    onPress={() => {
                      setSelectedSeller(null);
                      setSelectedMeal(meal);
                    }}
                  >
                    <View style={styles.sellerMealTextWrap}>
                      <Text style={styles.sellerMealTitle}>{meal.title}</Text>
                      <Text style={styles.sellerMealMeta}>
                        🕐 {meal.time} · {meal.distance}
                      </Text>
                    </View>
                    <View style={styles.sellerMealRight}>
                      <Text style={styles.sellerMealPrice}>{meal.price}</Text>
                      <Ionicons
                        name="chevron-forward-outline"
                        size={16}
                        color="#8D8072"
                      />
                    </View>
                  </TouchableOpacity>
                ))}
              </ScrollView>
            </View>
          </View>
        ) : null}
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
            <View pointerEvents="none" style={styles.pulseRing1} />
            <View pointerEvents="none" style={styles.pulseRing2} />
            <Animated.View
              style={{
                transform: [{ scale: breatheScale }],
              }}
            >
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
              <Ionicons
                name="home-outline"
                size={21}
                style={[
                  styles.navIcon,
                  activeTab === 'home' && styles.navIconActive,
                ]}
              />
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
              <Ionicons
                name="chatbubble-ellipses-outline"
                size={21}
                style={[
                  styles.navIcon,
                  activeTab === 'messages' && styles.navIconActive,
                ]}
              />
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
              <Ionicons
                name="basket-outline"
                size={21}
                style={[
                  styles.navIcon,
                  activeTab === 'cart' && styles.navIconActive,
                ]}
              />
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
              <Ionicons
                name="notifications-outline"
                size={21}
                style={[
                  styles.navIcon,
                  activeTab === 'notifications' && styles.navIconActive,
                ]}
              />
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
  searchStickyWrap: {
    backgroundColor: '#FFFDF9',
    zIndex: 1,
    paddingTop: 0,
    paddingBottom: 0,
    marginHorizontal: -12,
  },
  searchBox: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#FFFDF9',
    borderRadius: 16,
    paddingVertical: 4,
    paddingHorizontal: 10,
    borderWidth: 1, borderColor: '#EDE8E0',
    marginBottom: 6,
    position: 'relative',
    overflow: 'hidden',
  },
  searchIcon: { color: '#6B5D4F', fontSize: 34, fontWeight: '800' },
  searchIconButton: {
    position: 'absolute',
    left: 6,
    top: 0,
    bottom: 0,
    width: 26,
    alignItems: 'center',
    justifyContent: 'center',
    zIndex: 3,
  },
  searchIconGlyph: {
    transform: [{ scaleX: -1 }],
  },
  searchText: { color: '#A89B8C', fontSize: 14 },
  searchFadeWrap: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    width: 40,
    zIndex: 2,
    overflow: 'hidden',
    borderTopLeftRadius: 16,
    borderBottomLeftRadius: 16,
  },
  searchFadeSolid: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    width: 22,
    backgroundColor: 'rgba(255,253,249,0.45)',
  },
  searchFadeSoft: {
    position: 'absolute',
    left: 22,
    top: 0,
    bottom: 0,
    width: 18,
    backgroundColor: 'rgba(255,253,249,0.18)',
  },
  searchContent: {
    flex: 1,
    marginLeft: 28,
  },
  searchInput: {
    flex: 1,
    color: '#3D3229',
    fontSize: 15,
    fontWeight: '500',
    paddingRight: 8,
    paddingVertical: 4,
  },
  searchCategoryScroller: { flex: 1 },
  debugBox: {
    backgroundColor: '#FFF3CD',
    borderWidth: 1,
    borderColor: '#E8D9A8',
    borderRadius: 10,
    paddingHorizontal: 10,
    paddingVertical: 8,
    marginBottom: 12,
  },
  debugText: { color: '#5C4B1D', fontSize: 12, fontWeight: '500' },
  debugError: { color: '#B42318', fontSize: 12, fontWeight: '600', marginTop: 4 },

  /* --- Categories --- */
  categoryScroll: { marginBottom: 16 },
  categoryContent: { gap: 6 },
  categoryChip: { backgroundColor: '#EDE8E0', borderRadius: 20, paddingHorizontal: 16, paddingVertical: 7 },
  categoryChipActive: { backgroundColor: '#3D3229' },
  categoryText: { color: '#6B5D4F', fontSize: 13, fontWeight: '600' },
  categoryTextActive: { color: '#F5F1EB' },

  /* --- Food card --- */
  foodCard: {
    borderWidth: 1,
    borderRadius: 18,
    overflow: 'hidden',
    marginBottom: 12,
    marginHorizontal: -12,
  },
  foodPhoto: { width: '100%', height: 155, alignItems: 'center', justifyContent: 'center', overflow: 'hidden' },
  foodImage: { width: '100%', height: '100%' },
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
  foodRightCol: { alignItems: 'flex-end', maxWidth: '45%' },
  foodName: { fontSize: 16, fontWeight: '600' },
  foodSeller: { fontSize: 13, fontWeight: '500', marginTop: 2 },
  foodSellerLink: { flexDirection: 'row', alignItems: 'center', alignSelf: 'flex-start' },
  foodSellerChevron: { marginTop: 2, marginLeft: 2 },
  foodPrice: { fontSize: 18, fontWeight: '700' },
  foodBottomRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginTop: 2 },
  foodBottomAllergenText: { marginLeft: 8, fontSize: 11, fontWeight: '700', color: '#C2362F', textAlign: 'right', flexShrink: 1 },
  foodMeta: { fontSize: 12 },

  /* --- Tab panels --- */
  tabPanelCard: {
    marginTop: 24,
    marginHorizontal: 18,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#EDE8E0',
    backgroundColor: '#FFFDF9',
    padding: 18,
  },
  tabPanelTitle: { color: '#3D3229', fontSize: 20, fontWeight: '700' },
  tabPanelText: { color: '#8D8072', fontSize: 14, marginTop: 8, lineHeight: 20 },
  messagesTabWrap: { flex: 1, marginTop: 16, paddingBottom: 72 },
  messagesWallpaper: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: '#F7F3EC',
  },
  messagesBlob1: {
    position: 'absolute',
    width: 300,
    height: 300,
    borderRadius: 150,
    top: -70,
    right: -80,
    backgroundColor: 'rgba(74,124,89,0.10)',
  },
  messagesBlob2: {
    position: 'absolute',
    width: 240,
    height: 240,
    borderRadius: 120,
    top: 210,
    left: -100,
    backgroundColor: 'rgba(201,149,58,0.10)',
  },
  messagesBlob3: {
    position: 'absolute',
    width: 220,
    height: 220,
    borderRadius: 110,
    bottom: 40,
    right: -60,
    backgroundColor: 'rgba(109,93,79,0.08)',
  },
  messagesStripeA: {
    position: 'absolute',
    left: -30,
    right: -30,
    top: 80,
    height: 60,
    transform: [{ rotate: '-7deg' }],
  },
  messagesStripeB: {
    position: 'absolute',
    left: -40,
    right: -40,
    top: 220,
    height: 48,
    transform: [{ rotate: '5deg' }],
  },
  messagesStripeC: {
    position: 'absolute',
    left: -30,
    right: -30,
    top: 360,
    height: 68,
    transform: [{ rotate: '-6deg' }],
  },
  messagesGridVertical: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    left: 26,
    right: 26,
    borderLeftWidth: 1,
    borderRightWidth: 1,
  },
  messagesGridHorizontal: {
    position: 'absolute',
    left: 0,
    right: 0,
    top: 130,
    height: 180,
    borderTopWidth: 1,
    borderBottomWidth: 1,
  },
  messagesGridSpot: {
    position: 'absolute',
    width: 110,
    height: 110,
    borderRadius: 55,
    bottom: 120,
    right: 40,
  },
  messagesRingA: {
    position: 'absolute',
    width: 300,
    height: 300,
    borderRadius: 150,
    borderWidth: 16,
    top: -40,
    right: -90,
  },
  messagesRingB: {
    position: 'absolute',
    width: 220,
    height: 220,
    borderRadius: 110,
    borderWidth: 12,
    top: 210,
    left: -80,
  },
  messagesRingC: {
    position: 'absolute',
    width: 160,
    height: 160,
    borderRadius: 80,
    borderWidth: 10,
    bottom: 70,
    right: 26,
  },
  messagesDiagA: {
    position: 'absolute',
    width: 420,
    height: 120,
    transform: [{ rotate: '-28deg' }],
    top: 40,
    left: -130,
  },
  messagesDiagB: {
    position: 'absolute',
    width: 420,
    height: 88,
    transform: [{ rotate: '-28deg' }],
    top: 210,
    left: -110,
  },
  messagesDiagC: {
    position: 'absolute',
    width: 420,
    height: 70,
    transform: [{ rotate: '-28deg' }],
    top: 350,
    left: -95,
  },
  messagesCardA: {
    position: 'absolute',
    width: 180,
    height: 100,
    borderRadius: 18,
    top: 40,
    right: 30,
    transform: [{ rotate: '8deg' }],
  },
  messagesCardB: {
    position: 'absolute',
    width: 160,
    height: 90,
    borderRadius: 16,
    top: 200,
    left: 24,
    transform: [{ rotate: '-7deg' }],
  },
  messagesCardC: {
    position: 'absolute',
    width: 150,
    height: 84,
    borderRadius: 16,
    top: 340,
    right: 18,
    transform: [{ rotate: '6deg' }],
  },
  messagesWaveA: {
    position: 'absolute',
    left: -60,
    right: -60,
    top: 72,
    height: 110,
    borderRadius: 55,
  },
  messagesWaveB: {
    position: 'absolute',
    left: -80,
    right: -80,
    top: 230,
    height: 100,
    borderRadius: 50,
  },
  messagesWaveC: {
    position: 'absolute',
    left: -70,
    right: -70,
    top: 370,
    height: 90,
    borderRadius: 45,
  },
  messagesDotsA: {
    position: 'absolute',
    width: 10,
    height: 10,
    borderRadius: 5,
    top: 100,
    left: 44,
    shadowColor: '#000',
    shadowOpacity: 0.01,
    shadowRadius: 1,
    shadowOffset: { width: 1, height: 1 },
  },
  messagesDotsB: {
    position: 'absolute',
    width: 12,
    height: 12,
    borderRadius: 6,
    top: 230,
    right: 72,
  },
  messagesDotsC: {
    position: 'absolute',
    width: 14,
    height: 14,
    borderRadius: 7,
    top: 360,
    left: 130,
  },
  messagesSunsetSky: {
    position: 'absolute',
    top: 30,
    left: 24,
    right: 24,
    height: 130,
    borderTopLeftRadius: 26,
    borderTopRightRadius: 26,
  },
  messagesSunsetHorizon: {
    position: 'absolute',
    top: 160,
    left: 24,
    right: 24,
    height: 44,
    borderBottomLeftRadius: 18,
    borderBottomRightRadius: 18,
  },
  messagesSunsetSun: {
    position: 'absolute',
    width: 86,
    height: 86,
    borderRadius: 43,
    top: 112,
    left: '50%',
    marginLeft: -43,
  },
  messagesMinLineA: {
    position: 'absolute',
    left: 26,
    right: 26,
    top: 120,
    height: 2,
  },
  messagesMinLineB: {
    position: 'absolute',
    left: 56,
    right: 56,
    top: 250,
    height: 2,
  },
  messagesMinDot: {
    position: 'absolute',
    width: 80,
    height: 80,
    borderRadius: 40,
    top: 340,
    right: 42,
  },
  messagesTabHeader: { paddingHorizontal: 18, paddingBottom: 8, flexDirection: 'row', alignItems: 'center' },
  messagesWallpaperBtn: {
    width: 34,
    height: 34,
    borderRadius: 17,
    borderWidth: 1,
    borderColor: '#DFD7CC',
    backgroundColor: 'rgba(255,255,255,0.72)',
    alignItems: 'center',
    justifyContent: 'center',
    marginLeft: 10,
  },
  messagesTabHeaderText: { flex: 1 },
  messagesTabTitle: { color: '#3D3229', fontSize: 22, fontWeight: '700' },
  messagesTabSubtitle: { color: '#8D8072', fontSize: 13, marginTop: 2 },

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
    position: 'absolute', left: '50%', bottom: 15, marginLeft: -26,
    zIndex: 80, width: 52, height: 52, alignItems: 'center', justifyContent: 'center',
  },
  pulseRing1: {
    position: 'absolute',
    width: 60,
    height: 60,
    borderRadius: 30,
    borderWidth: 2.2,
    borderColor: 'rgba(74,124,89,0.30)',
    backgroundColor: 'transparent',
  },
  pulseRing2: {
    position: 'absolute',
    width: 68,
    height: 68,
    borderRadius: 34,
    borderWidth: 1.8,
    borderColor: 'rgba(74,124,89,0.18)',
    backgroundColor: 'transparent',
  },
  floatingButton: {
    width: 52, height: 52, borderRadius: 26, backgroundColor: '#4A7C59',
    alignItems: 'center', justifyContent: 'center',
    shadowColor: '#4A7C59', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.35, shadowRadius: 18,
    elevation: 10,
  },
  floatingButtonText: { color: '#FFFFFF', fontSize: 19, fontWeight: '700' },

  /* --- Bottom bar --- */
  bottomBar: {
    height: 82, backgroundColor: '#FFFDF9',
    borderTopWidth: 1, borderTopColor: '#EDE8E0',
    flexDirection: 'row', alignItems: 'center', justifyContent: 'space-around',
    paddingTop: 2, paddingBottom: 0, paddingHorizontal: 8, zIndex: 50,
  },
  navItem: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'flex-end',
    paddingTop: 0,
    paddingBottom: 0,
    transform: [{ translateY: 5 }],
  },
  navSpacer: { width: 64 },
  navIcon: { color: '#A89B8C', marginBottom: 3 },
  navIconActive: { color: '#4A7C59' },
  navLabel: { color: '#A89B8C', fontSize: 12, lineHeight: 14, fontWeight: '600' },
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
  modalThumb: { width: 120, height: 120, borderRadius: 24, alignItems: 'center', justifyContent: 'center', marginBottom: 16, overflow: 'hidden' },
  modalImage: { width: '100%', height: '100%' },
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

  /* --- Seller modal --- */
  sellerModalContent: {
    backgroundColor: '#FFFDF9',
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    paddingHorizontal: 20,
    paddingTop: 24,
    paddingBottom: 28,
    maxHeight: '82%',
  },
  sellerHeader: { flexDirection: 'row', alignItems: 'center', marginBottom: 14 },
  sellerAvatar: {
    width: 56,
    height: 56,
    borderRadius: 16,
    backgroundColor: '#EFE9E1',
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  sellerAvatarEmoji: { fontSize: 28 },
  sellerHeaderText: { flex: 1, paddingRight: 34 },
  sellerTitle: { color: '#3D3229', fontSize: 22, fontWeight: '700' },
  sellerSubtitle: { color: '#8D8072', fontSize: 13, fontWeight: '600', marginTop: 2 },
  sellerStatsRow: { flexDirection: 'row', gap: 10, marginBottom: 14 },
  sellerStatCard: {
    flex: 1,
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#EDE8E0',
    backgroundColor: '#FAF7F2',
    paddingVertical: 10,
    alignItems: 'center',
  },
  sellerStatValue: { color: '#3D3229', fontSize: 18, fontWeight: '700' },
  sellerStatLabel: { color: '#8D8072', fontSize: 12, fontWeight: '600', marginTop: 2 },
  sellerAboutCard: {
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#EDE8E0',
    backgroundColor: '#FAF7F2',
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 12,
  },
  sellerAboutTitle: { color: '#3D3229', fontSize: 13, fontWeight: '700' },
  sellerAboutMeta: { color: '#7E7163', fontSize: 12, fontWeight: '600', marginTop: 3 },
  sellerAboutText: { color: '#6E6256', fontSize: 12, lineHeight: 18, marginTop: 5 },
  sellerReviewList: { maxHeight: 200, marginBottom: 12 },
  sellerReviewsLoadingRow: { flexDirection: 'row', alignItems: 'center', gap: 8, marginBottom: 10 },
  sellerReviewsLoadingText: { color: '#7E7163', fontSize: 12, fontWeight: '600' },
  sellerReviewsErrorText: { color: '#B42318', fontSize: 12, fontWeight: '600', marginBottom: 10 },
  sellerEmptyReviewsText: { color: '#8D8072', fontSize: 12, marginBottom: 10 },
  sellerReviewItem: {
    borderWidth: 1,
    borderColor: '#EDE8E0',
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 8,
    marginBottom: 8,
    backgroundColor: '#FFFFFF',
  },
  sellerReviewHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 },
  sellerReviewBuyer: { color: '#3D3229', fontSize: 13, fontWeight: '700', flex: 1, paddingRight: 8 },
  sellerReviewRight: { alignItems: 'flex-end' },
  sellerReviewStars: { flexDirection: 'row', alignItems: 'center', gap: 1 },
  sellerReviewDate: { color: '#8D8072', fontSize: 10, marginTop: 2 },
  sellerReviewFood: { color: '#7E7163', fontSize: 11, marginBottom: 3 },
  sellerReviewComment: { color: '#5F5246', fontSize: 12, lineHeight: 17 },
  sellerSectionTitle: {
    color: '#3D3229',
    fontSize: 15,
    fontWeight: '700',
    marginBottom: 8,
    marginTop: 2,
  },
  sellerMealList: { maxHeight: 320 },
  sellerMealItem: {
    borderWidth: 1,
    borderColor: '#EDE8E0',
    backgroundColor: '#FFF',
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 8,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  sellerMealTextWrap: { flex: 1, paddingRight: 8 },
  sellerMealTitle: { color: '#3D3229', fontSize: 15, fontWeight: '600' },
  sellerMealMeta: { color: '#8D8072', fontSize: 12, marginTop: 2 },
  sellerMealRight: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  sellerMealPrice: { color: '#3D3229', fontSize: 15, fontWeight: '700' },

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
