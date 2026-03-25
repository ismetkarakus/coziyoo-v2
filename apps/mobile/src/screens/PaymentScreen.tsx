import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Animated, Easing, StyleSheet, Text, View, StatusBar, Linking } from 'react-native';
import { theme } from '../theme/colors';
import { type AuthSession } from '../utils/auth';
import { apiRequest } from '../utils/api';
import ScreenHeader from '../components/ScreenHeader';
import ActionButton from '../components/ActionButton';
import LoadingState from '../components/LoadingState';
import ErrorState from '../components/ErrorState';
import { Ionicons } from '@expo/vector-icons';

let PaymentWebView: React.ComponentType<{
  source: { uri: string };
  onNavigationStateChange?: (state: { url?: string }) => void;
  startInLoadingState?: boolean;
  renderLoading?: () => React.ReactElement | null;
  style?: unknown;
}> | null = null;
try {
  PaymentWebView = require('react-native-webview').WebView;
} catch {}

const STEPS = [
  'Bağlantı kuruluyor...',
  'Güvenlik doğrulanıyor...',
  'Ödeme işleniyor...',
  'Tamamlanıyor...',
];

const STEP_DURATION = 700;
const TOTAL_DURATION = STEP_DURATION * STEPS.length + 600;

function PaymentProcessingAnimation({ onDone }: { onDone: () => void }) {
  const cardScale = useRef(new Animated.Value(0.8)).current;
  const cardOpacity = useRef(new Animated.Value(0)).current;
  const rippleScale = useRef(new Animated.Value(0.6)).current;
  const rippleOpacity = useRef(new Animated.Value(0)).current;
  const dot1 = useRef(new Animated.Value(0.3)).current;
  const dot2 = useRef(new Animated.Value(0.3)).current;
  const dot3 = useRef(new Animated.Value(0.3)).current;
  const stepOpacity = useRef(STEPS.map(() => new Animated.Value(0))).current;
  const checkOpacity = useRef(STEPS.map(() => new Animated.Value(0))).current;

  const [currentStep, setCurrentStep] = useState(0);

  useEffect(() => {
    // Card entrance
    Animated.parallel([
      Animated.spring(cardScale, { toValue: 1, friction: 6, tension: 60, useNativeDriver: true }),
      Animated.timing(cardOpacity, { toValue: 1, duration: 350, useNativeDriver: true }),
    ]).start();

    // Ripple loop
    const rippleLoop = Animated.loop(
      Animated.sequence([
        Animated.parallel([
          Animated.timing(rippleScale, { toValue: 1.5, duration: 900, easing: Easing.out(Easing.ease), useNativeDriver: true }),
          Animated.timing(rippleOpacity, { toValue: 0, duration: 900, useNativeDriver: true }),
        ]),
        Animated.parallel([
          Animated.timing(rippleScale, { toValue: 0.6, duration: 0, useNativeDriver: true }),
          Animated.timing(rippleOpacity, { toValue: 0.25, duration: 0, useNativeDriver: true }),
        ]),
      ])
    );
    rippleLoop.start();

    // Dots bounce loop
    const dotLoop = Animated.loop(
      Animated.stagger(160, [
        Animated.sequence([
          Animated.timing(dot1, { toValue: 1, duration: 280, useNativeDriver: true }),
          Animated.timing(dot1, { toValue: 0.3, duration: 280, useNativeDriver: true }),
        ]),
        Animated.sequence([
          Animated.timing(dot2, { toValue: 1, duration: 280, useNativeDriver: true }),
          Animated.timing(dot2, { toValue: 0.3, duration: 280, useNativeDriver: true }),
        ]),
        Animated.sequence([
          Animated.timing(dot3, { toValue: 1, duration: 280, useNativeDriver: true }),
          Animated.timing(dot3, { toValue: 0.3, duration: 280, useNativeDriver: true }),
        ]),
      ])
    );
    dotLoop.start();

    // Steps sequence
    const stepAnimations = STEPS.map((_, i) =>
      Animated.sequence([
        Animated.delay(i * STEP_DURATION),
        Animated.timing(stepOpacity[i], { toValue: 1, duration: 250, useNativeDriver: true }),
      ])
    );

    Animated.parallel(stepAnimations).start(() => {
      // Show check marks one by one except last
      const checkAnims = STEPS.slice(0, -1).map((_, i) =>
        Animated.sequence([
          Animated.delay(i * 120),
          Animated.timing(checkOpacity[i], { toValue: 1, duration: 200, useNativeDriver: true }),
        ])
      );
      Animated.parallel(checkAnims).start(() => {
        // Final check
        Animated.timing(checkOpacity[STEPS.length - 1], { toValue: 1, duration: 250, useNativeDriver: true }).start(() => {
          rippleLoop.stop();
          dotLoop.stop();
          setTimeout(onDone, 500);
        });
      });
    });

    // Update currentStep label
    STEPS.forEach((_, i) => {
      setTimeout(() => setCurrentStep(i), i * STEP_DURATION + 50);
    });
  }, []);

  return (
    <View style={anim.container}>
      {/* Card with ripple */}
      <View style={anim.cardWrap}>
        <Animated.View style={[anim.ripple, { transform: [{ scale: rippleScale }], opacity: rippleOpacity }]} />
        <Animated.View style={[anim.card, { opacity: cardOpacity, transform: [{ scale: cardScale }] }]}>
          <Ionicons name="card" size={38} color="#fff" />
        </Animated.View>
      </View>

      <Text style={anim.title}>Ödeme İşleniyor</Text>

      {/* Dots */}
      <View style={anim.dots}>
        {[dot1, dot2, dot3].map((dot, i) => (
          <Animated.View key={i} style={[anim.dot, { opacity: dot }]} />
        ))}
      </View>

      {/* Steps */}
      <View style={anim.steps}>
        {STEPS.map((label, i) => (
          <Animated.View key={i} style={[anim.stepRow, { opacity: stepOpacity[i] }]}>
            <Animated.View style={{ opacity: checkOpacity[i] }}>
              <Ionicons name="checkmark-circle" size={16} color="#3E845B" />
            </Animated.View>
            <Animated.View style={[anim.stepDot, { opacity: Animated.subtract(new Animated.Value(1), checkOpacity[i]) }]} />
            <Text style={[anim.stepText, i === currentStep && anim.stepTextActive]}>
              {label}
            </Text>
          </Animated.View>
        ))}
      </View>
    </View>
  );
}

type Props = {
  auth: AuthSession;
  orderId: string;
  onBack: () => void;
  onPaymentComplete: () => void;
  onAuthRefresh?: (session: AuthSession) => void;
};

export default function PaymentScreen({ auth, orderId, onBack, onPaymentComplete, onAuthRefresh }: Props) {
  const [checkoutUrl, setCheckoutUrl] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<'success' | 'failed' | null>(null);
  const [processing, setProcessing] = useState(false);

  const startPayment = useCallback(async () => {
    setLoading(true);
    setError(null);
    setProcessing(false);
    const res = await apiRequest<{ checkoutUrl: string; sessionId: string }>(
      '/v1/payments/start',
      auth,
      { method: 'POST', body: { orderId }, actorRole: 'buyer' },
      onAuthRefresh,
    );
    if (res.ok) {
      setCheckoutUrl(res.data.checkoutUrl);
      setProcessing(true);
    } else {
      setError(res.message ?? 'Ödeme başlatılamadı');
    }
    setLoading(false);
  }, [auth, orderId, onAuthRefresh]);

  useEffect(() => { startPayment(); }, [startPayment]);

  function handleNavChange(state: { url?: string }) {
    if (!state.url) return;
    if (state.url.includes('result=success')) {
      setResult('success');
    } else if (state.url.includes('result=failed')) {
      setResult('failed');
    }
  }

  if (result === 'success') {
    return (
      <View style={styles.container}>
        <StatusBar barStyle="dark-content" backgroundColor={theme.background} />
        <ScreenHeader title="Ödeme" onBack={onBack} />
        <View style={styles.resultCenter}>
          <View style={[styles.resultIcon, { backgroundColor: '#E4F2E7' }]}>
            <Ionicons name="checkmark-circle" size={56} color="#3E845B" />
          </View>
          <Text style={styles.resultTitle}>Ödeme Başarılı</Text>
          <Text style={styles.resultSub}>Siparişin onaylandı. Satıcı hazırlamaya başlayacak.</Text>
          <ActionButton label="Siparişe Dön" onPress={onPaymentComplete} variant="primary" />
        </View>
      </View>
    );
  }

  if (result === 'failed') {
    return (
      <View style={styles.container}>
        <StatusBar barStyle="dark-content" backgroundColor={theme.background} />
        <ScreenHeader title="Ödeme" onBack={onBack} />
        <View style={styles.resultCenter}>
          <View style={[styles.resultIcon, { backgroundColor: '#FDECEC' }]}>
            <Ionicons name="close-circle" size={56} color="#C0392B" />
          </View>
          <Text style={styles.resultTitle}>Ödeme Başarısız</Text>
          <Text style={styles.resultSub}>Ödeme işlemi tamamlanamadı. Tekrar deneyebilirsin.</Text>
          <View style={styles.resultActions}>
            <ActionButton label="Tekrar Dene" onPress={() => { setResult(null); startPayment(); }} variant="primary" />
            <ActionButton label="Geri Dön" onPress={onBack} variant="soft" />
          </View>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <StatusBar barStyle="dark-content" backgroundColor={theme.background} />
      <ScreenHeader title="Ödeme" onBack={onBack} />

      {loading ? (
        <LoadingState message="Ödeme hazırlanıyor..." />
      ) : error ? (
        <ErrorState message={error} onRetry={startPayment} />
      ) : processing ? (
        <PaymentProcessingAnimation
          onDone={() => {
            setProcessing(false);
            setResult('success');
          }}
        />
      ) : checkoutUrl ? (
        PaymentWebView ? (
          <PaymentWebView
            source={{ uri: checkoutUrl }}
            onNavigationStateChange={handleNavChange}
            startInLoadingState
            renderLoading={() => <LoadingState message="Sayfa yükleniyor..." />}
            style={styles.webview}
          />
        ) : (
          <View style={styles.resultCenter}>
            <Ionicons name="open-outline" size={48} color={theme.textSecondary} />
            <Text style={styles.resultTitle}>Tarayıcıda Aç</Text>
            <Text style={styles.resultSub}>Uygulama içi ödeme modülü bulunamadı.</Text>
            <ActionButton
              label="Tarayıcıda Öde"
              onPress={() => Linking.openURL(checkoutUrl)}
              variant="primary"
            />
          </View>
        )
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.background },
  webview: { flex: 1 },
  resultCenter: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32, gap: 12 },
  resultIcon: { width: 88, height: 88, borderRadius: 44, alignItems: 'center', justifyContent: 'center', marginBottom: 8 },
  resultTitle: { color: theme.text, fontSize: 22, fontWeight: '800' },
  resultSub: { color: '#71685F', fontSize: 14, textAlign: 'center', lineHeight: 22, marginBottom: 8 },
  resultActions: { gap: 10, width: '100%', marginTop: 8 },
});

const anim = StyleSheet.create({
  container: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 32,
    backgroundColor: theme.background,
  },
  cardWrap: {
    width: 110,
    height: 110,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 28,
  },
  ripple: {
    position: 'absolute',
    width: 110,
    height: 110,
    borderRadius: 55,
    backgroundColor: theme.primary,
  },
  card: {
    width: 80,
    height: 80,
    borderRadius: 24,
    backgroundColor: theme.primary,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: theme.primary,
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.38,
    shadowRadius: 16,
    elevation: 10,
  },
  title: {
    color: theme.text,
    fontSize: 20,
    fontWeight: '800',
    marginBottom: 12,
  },
  dots: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 36,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: theme.primary,
  },
  steps: {
    width: '100%',
    gap: 12,
  },
  stepRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  stepDot: {
    position: 'absolute',
    left: 0,
    width: 16,
    height: 16,
    borderRadius: 8,
    borderWidth: 2,
    borderColor: '#C8C0B8',
  },
  stepText: {
    color: '#9B8E80',
    fontSize: 14,
    fontWeight: '500',
  },
  stepTextActive: {
    color: theme.text,
    fontWeight: '700',
  },
});
