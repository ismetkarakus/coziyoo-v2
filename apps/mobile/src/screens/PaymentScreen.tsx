import React, { useCallback, useEffect, useState } from 'react';
import { StyleSheet, Text, View, StatusBar, Linking } from 'react-native';
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

  const refreshPaymentStatus = useCallback(async (waitForSettlement = false) => {
    const loadStatus = async () =>
      apiRequest<{
        orderId: string;
        orderStatus: string;
        paymentCompleted: boolean;
        latestAttempt?: { status?: string };
      }>(`/v1/payments/${orderId}/status`, auth, { actorRole: 'buyer' }, onAuthRefresh);

    let response = await loadStatus();
    if (!response.ok) {
      setError(response.message ?? 'Ödeme durumu alınamadı');
      return;
    }

    if (waitForSettlement) {
      const isPending = (status?: string, paymentCompleted?: boolean) =>
        !paymentCompleted && !['failed', 'canceled'].includes((status ?? '').toLowerCase());
      for (let attempt = 0; attempt < 4 && isPending(response.data.latestAttempt?.status, response.data.paymentCompleted); attempt += 1) {
        await new Promise((resolve) => setTimeout(resolve, 900));
        response = await loadStatus();
        if (!response.ok) {
          setError(response.message ?? 'Ödeme durumu alınamadı');
          return;
        }
      }
    }

    if (response.data.paymentCompleted) {
      setResult('success');
      return;
    }
    setResult(response.data.latestAttempt?.status === 'failed' ? 'failed' : null);
    setError('Ödeme henüz tamamlanmadı. Sipariş satıcıya iletilmedi.');
  }, [auth, onAuthRefresh, orderId]);

  const startPayment = useCallback(async () => {
    setLoading(true);
    setError(null);
    const res = await apiRequest<{ checkoutUrl: string; sessionId: string }>(
      '/v1/payments/start',
      auth,
      { method: 'POST', body: { orderId }, actorRole: 'buyer' },
      onAuthRefresh,
    );
    if (res.ok) {
      setCheckoutUrl(res.data.checkoutUrl);
    } else {
      setError(res.message ?? 'Ödeme başlatılamadı');
    }
    setLoading(false);
  }, [auth, onAuthRefresh, orderId]);

  useEffect(() => { startPayment(); }, [startPayment]);

  function handleNavChange(state: { url?: string }) {
    if (!state.url) return;
    if (state.url.includes('result=success')) {
      void refreshPaymentStatus(true);
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
