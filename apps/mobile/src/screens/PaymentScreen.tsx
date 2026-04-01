import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Animated, Easing, Modal, StatusBar, StyleSheet, Text, View } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { theme } from '../theme/colors';
import { type AuthSession } from '../utils/auth';
import { apiRequest } from '../utils/api';
import ScreenHeader from '../components/ScreenHeader';
import ActionButton from '../components/ActionButton';
import LoadingState from '../components/LoadingState';
import ErrorState from '../components/ErrorState';

const STEPS = ['Bağlantı kuruluyor...', 'Güvenlik doğrulanıyor...', 'Ödeme işleniyor...', 'Tamamlanıyor...'];
const STEP_DURATION = 700;

function PaymentProcessingAnimation({ onDone }: { onDone: () => void }) {
  const cardScale = useRef(new Animated.Value(0.85)).current;
  const cardOpacity = useRef(new Animated.Value(0)).current;
  const rippleScale = useRef(new Animated.Value(1)).current;
  const rippleOpacity = useRef(new Animated.Value(0.35)).current;
  const dot1 = useRef(new Animated.Value(0)).current;
  const dot2 = useRef(new Animated.Value(0)).current;
  const dot3 = useRef(new Animated.Value(0)).current;
  const stepOpacities = useRef(STEPS.map(() => new Animated.Value(0))).current;
  const checkOpacities = useRef(STEPS.map(() => new Animated.Value(0))).current;

  useEffect(() => {
    Animated.parallel([
      Animated.spring(cardScale, { toValue: 1, useNativeDriver: true, tension: 120, friction: 8 }),
      Animated.timing(cardOpacity, { toValue: 1, duration: 250, useNativeDriver: true }),
    ]).start();

    const rippleLoop = Animated.loop(
      Animated.sequence([
        Animated.parallel([
          Animated.timing(rippleScale, { toValue: 1.6, duration: 900, easing: Easing.out(Easing.ease), useNativeDriver: true }),
          Animated.timing(rippleOpacity, { toValue: 0, duration: 900, useNativeDriver: true }),
        ]),
        Animated.parallel([
          Animated.timing(rippleScale, { toValue: 1, duration: 0, useNativeDriver: true }),
          Animated.timing(rippleOpacity, { toValue: 0.35, duration: 0, useNativeDriver: true }),
        ]),
      ]),
    );
    rippleLoop.start();

    const makeBounce = (dot: Animated.Value, delay: number) =>
      Animated.loop(
        Animated.sequence([
          Animated.delay(delay),
          Animated.timing(dot, { toValue: -7, duration: 280, easing: Easing.out(Easing.ease), useNativeDriver: true }),
          Animated.timing(dot, { toValue: 0, duration: 280, easing: Easing.in(Easing.ease), useNativeDriver: true }),
          Animated.delay(640),
        ]),
      );
    const dotLoop = Animated.parallel([makeBounce(dot1, 0), makeBounce(dot2, 160), makeBounce(dot3, 320)]);
    dotLoop.start();

    const stepSeq: Animated.CompositeAnimation[] = [];
    STEPS.forEach((_, i) => {
      stepSeq.push(Animated.delay(i * STEP_DURATION));
      stepSeq.push(Animated.timing(stepOpacities[i], { toValue: 1, duration: 200, useNativeDriver: true }));
      stepSeq.push(Animated.delay(STEP_DURATION - 260));
      stepSeq.push(Animated.timing(checkOpacities[i], { toValue: 1, duration: 200, useNativeDriver: true }));
    });

    Animated.sequence(stepSeq).start(() => {
      rippleLoop.stop();
      dotLoop.stop();
      setTimeout(onDone, 500);
    });

    return () => {
      rippleLoop.stop();
      dotLoop.stop();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <Modal transparent animationType="fade" visible>
      <View style={anim.overlay}>
        <Animated.View style={[anim.card, { opacity: cardOpacity, transform: [{ scale: cardScale }] }]}>
          <View style={anim.iconWrap}>
            <Animated.View style={[anim.ripple, { opacity: rippleOpacity, transform: [{ scale: rippleScale }] }]} />
            <Ionicons name="card-outline" size={36} color="#3E845B" />
          </View>
          <Text style={anim.title}>Ödeme İşleniyor</Text>
          <View style={anim.dotsRow}>
            <Animated.View style={[anim.dot, { transform: [{ translateY: dot1 }] }]} />
            <Animated.View style={[anim.dot, { transform: [{ translateY: dot2 }] }]} />
            <Animated.View style={[anim.dot, { transform: [{ translateY: dot3 }] }]} />
          </View>
          <View style={anim.stepsList}>
            {STEPS.map((step, i) => (
              <Animated.View key={i} style={[anim.stepRow, { opacity: stepOpacities[i] }]}>
                <Animated.View style={[anim.checkWrap, { opacity: checkOpacities[i] }]}>
                  <Ionicons name="checkmark-circle" size={18} color="#3E845B" />
                </Animated.View>
                <Text style={anim.stepText}>{step}</Text>
              </Animated.View>
            ))}
          </View>
        </Animated.View>
      </View>
    </Modal>
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
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<'success' | 'failed' | null>(null);
  const [processing, setProcessing] = useState(false);
  const paymentSessionIdRef = useRef<string | null>(null);

  const startMockPayment = useCallback(async () => {
    setLoading(true);
    setError(null);
    setResult(null);
    paymentSessionIdRef.current = null;

    const res = await apiRequest<{ sessionId?: string }>(
      '/v1/payments/start',
      auth,
      { method: 'POST', body: { orderId }, actorRole: 'buyer' },
      onAuthRefresh,
    );

    if (!res.ok) {
      setError(res.message ?? 'Ödeme başlatılamadı');
      setLoading(false);
      return;
    }

    const sessionId = String(res.data.sessionId ?? '').trim();
    if (!sessionId) {
      setError('Ödeme oturumu oluşturulamadı');
      setLoading(false);
      return;
    }

    paymentSessionIdRef.current = sessionId;
    setLoading(false);
    setProcessing(true);
  }, [auth, onAuthRefresh, orderId]);

  useEffect(() => {
    void startMockPayment();
  }, [startMockPayment]);

  const finalizeMockPayment = useCallback(async () => {
    setProcessing(false);
    setLoading(true);
    setError(null);

    const sessionId = paymentSessionIdRef.current;
    if (!sessionId) {
      setError('Ödeme oturumu bulunamadı.');
      setResult('failed');
      setLoading(false);
      return;
    }

    const processRes = await apiRequest<{ ok?: boolean; result?: string }>(
      '/v1/payments/mock-process',
      auth,
      { method: 'POST', body: { sessionId, result: 'success' }, actorRole: 'buyer' },
      onAuthRefresh,
    );
    if (!processRes.ok) {
      setError(processRes.message ?? 'Ödeme doğrulanamadı');
      setResult('failed');
      setLoading(false);
      return;
    }

    let isPaid = false;
    for (let attempt = 0; attempt < 4; attempt += 1) {
      const statusRes = await apiRequest<{
        paymentCompleted?: boolean;
        latestAttempt?: { status?: string };
      }>(`/v1/payments/${orderId}/status`, auth, { actorRole: 'buyer' }, onAuthRefresh);
      if (statusRes.ok && statusRes.data.paymentCompleted) {
        isPaid = true;
        break;
      }
      await new Promise((resolve) => setTimeout(resolve, 250));
    }

    if (!isPaid) {
      setError('Ödeme tamamlanamadı. Lütfen tekrar dene.');
      setResult('failed');
      setLoading(false);
      return;
    }

    setResult('success');
    setLoading(false);
  }, [auth, onAuthRefresh, orderId]);

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
          <Text style={styles.resultSub}>{error ?? 'Ödeme işlemi tamamlanamadı. Tekrar deneyebilirsin.'}</Text>
          <View style={styles.resultActions}>
            <ActionButton label="Tekrar Dene" onPress={() => { void startMockPayment(); }} variant="primary" />
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

      {processing ? (
        <PaymentProcessingAnimation onDone={() => void finalizeMockPayment()} />
      ) : loading ? (
        <LoadingState message="Ödeme hazırlanıyor..." />
      ) : error ? (
        <ErrorState message={error} onRetry={() => { void startMockPayment(); }} />
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.background },
  resultCenter: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32, gap: 12 },
  resultIcon: { width: 88, height: 88, borderRadius: 44, alignItems: 'center', justifyContent: 'center', marginBottom: 8 },
  resultTitle: { color: theme.text, fontSize: 22, fontWeight: '800' },
  resultSub: { color: '#71685F', fontSize: 14, textAlign: 'center', lineHeight: 22, marginBottom: 8 },
  resultActions: { gap: 10, width: '100%', marginTop: 8 },
});

const anim = StyleSheet.create({
  overlay: { flex: 1, backgroundColor: 'rgba(0,0,0,0.48)', alignItems: 'center', justifyContent: 'center' },
  card: {
    backgroundColor: '#fff',
    borderRadius: 22,
    paddingVertical: 32,
    paddingHorizontal: 28,
    width: '82%',
    alignItems: 'center',
    gap: 16,
    shadowColor: '#000',
    shadowOpacity: 0.18,
    shadowRadius: 24,
    shadowOffset: { width: 0, height: 8 },
    elevation: 12,
  },
  iconWrap: { width: 72, height: 72, alignItems: 'center', justifyContent: 'center' },
  ripple: { position: 'absolute', width: 72, height: 72, borderRadius: 36, backgroundColor: '#3E845B' },
  title: { color: '#2F2A25', fontSize: 20, fontWeight: '800' },
  dotsRow: { flexDirection: 'row', gap: 8 },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#3E845B' },
  stepsList: { width: '100%', gap: 8, marginTop: 4 },
  stepRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  checkWrap: { width: 18, alignItems: 'center' },
  stepText: { color: '#6C6157', fontSize: 13, fontWeight: '600' },
});

