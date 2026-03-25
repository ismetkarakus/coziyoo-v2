import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, StatusBar, Alert } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { theme } from '../theme/colors';
import { type AuthSession } from '../utils/auth';
import { apiRequest } from '../utils/api';
import ScreenHeader from '../components/ScreenHeader';
import StatusBadge from '../components/StatusBadge';
import ItemRow from '../components/ItemRow';
import SectionDivider from '../components/SectionDivider';
import TimelineStep from '../components/TimelineStep';
import ActionButton from '../components/ActionButton';
import LoadingState from '../components/LoadingState';
import ErrorState from '../components/ErrorState';
import BottomSheet from '../components/BottomSheet';
import TextInputField from '../components/TextInputField';
import { formatPrice, formatDate, orderNo } from '../components/OrderCard';

type OrderDetail = {
  id: string;
  buyerId: string;
  sellerId: string;
  status: string;
  deliveryType: 'pickup' | 'delivery';
  deliveryAddress: unknown;
  totalPrice: number;
  paymentCompleted: boolean;
  createdAt: string;
  sellerName: string;
  sellerImage: string | null;
  buyerName: string;
  items: { name: string; image: string | null; quantity: number; unitPrice: number; lineTotal: number }[];
  events: { eventType: string; fromStatus: string | null; toStatus: string | null; createdAt: string; reason?: string | null }[];
};

function formatDeliveryAddress(value: unknown): string | null {
  if (!value) return null;

  let parsed: Record<string, unknown> | null = null;
  if (typeof value === 'string') {
    try {
      const asJson = JSON.parse(value);
      if (asJson && typeof asJson === 'object') parsed = asJson as Record<string, unknown>;
    } catch {
      return value.trim() || null;
    }
  } else if (typeof value === 'object') {
    parsed = value as Record<string, unknown>;
  }

  if (!parsed) return null;

  const chunks = [
    String(parsed.addressLine ?? '').trim(),
    String(parsed.line ?? '').trim(),
    String(parsed.street ?? '').trim(),
    String(parsed.neighborhood ?? '').trim(),
    String(parsed.district ?? '').trim(),
    String(parsed.city ?? '').trim(),
    String(parsed.title ?? '').trim(),
  ].filter(Boolean);

  if (chunks.length === 0) return null;
  return Array.from(new Set(chunks)).join(', ');
}

type Props = {
  auth: AuthSession;
  orderId: string;
  onBack: () => void;
  onOpenPayment?: (orderId: string) => void;
  onOpenReview?: (orderId: string) => void;
  onOpenComplaint?: (orderId: string) => void;
  onAuthRefresh?: (session: AuthSession) => void;
};

const CANCELLABLE = ['pending_seller_approval', 'seller_approved', 'awaiting_payment', 'paid'];
const COMPLETABLE = ['delivered'];

export default function OrderDetailScreen({
  auth, orderId, onBack, onOpenPayment, onOpenReview, onOpenComplaint, onAuthRefresh,
}: Props) {
  const [order, setOrder] = useState<OrderDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState(false);
  const [cancelModal, setCancelModal] = useState(false);
  const [cancelReason, setCancelReason] = useState('');

  const fetchOrder = useCallback(async () => {
    setLoading(true);
    setError(null);
    const result = await apiRequest<OrderDetail>(
      `/v1/orders/${orderId}`,
      auth,
      { actorRole: 'buyer' },
      onAuthRefresh,
    );
    if (result.ok) {
      setOrder(result.data);
    } else {
      setError(result.message ?? 'Sipariş yüklenemedi');
    }
    setLoading(false);
  }, [orderId, auth, onAuthRefresh]);

  useEffect(() => { fetchOrder(); }, [fetchOrder]);

  const isBuyer = order?.buyerId === auth.userId;

  async function handleCancel() {
    if (!order) return;
    setActionLoading(true);
    const result = await apiRequest(
      `/v1/orders/${order.id}/cancel`,
      auth,
      { method: 'POST', body: { reason: cancelReason || undefined }, actorRole: 'buyer' },
      onAuthRefresh,
    );
    setActionLoading(false);
    if (result.ok) {
      setCancelModal(false);
      setCancelReason('');
      fetchOrder();
    } else {
      Alert.alert('Hata', result.message ?? 'İptal edilemedi');
    }
  }

  async function handleComplete() {
    if (!order) return;
    setActionLoading(true);
    const result = await apiRequest(
      `/v1/orders/${order.id}/status`,
      auth,
      { method: 'POST', body: { toStatus: 'completed' }, actorRole: 'buyer' },
      onAuthRefresh,
    );
    setActionLoading(false);
    if (result.ok) {
      fetchOrder();
    } else {
      Alert.alert('Hata', result.message ?? 'Tamamlanamadı');
    }
  }

  function formatEventDate(iso: string): string {
    if (!iso) return '-';
    const normalized = iso.trim().replace(' ', 'T').replace(/(\.\d+)?([+-]\d{2})$/, '$1$2:00');
    const d = new Date(normalized);
    if (isNaN(d.getTime())) return formatDate(iso);
    const h = d.getHours().toString().padStart(2, '0');
    const m = d.getMinutes().toString().padStart(2, '0');
    return `${formatDate(iso)} ${h}:${m}`;
  }

  if (loading) {
    return (
      <View style={styles.container}>
        <StatusBar barStyle="dark-content" backgroundColor={theme.background} />
        <ScreenHeader title="Sipariş Detayı" onBack={onBack} />
        <LoadingState message="Yükleniyor..." />
      </View>
    );
  }

  if (error || !order) {
    return (
      <View style={styles.container}>
        <StatusBar barStyle="dark-content" backgroundColor={theme.background} />
        <ScreenHeader title="Sipariş Detayı" onBack={onBack} />
        <ErrorState message={error ?? 'Sipariş bulunamadı'} onRetry={fetchOrder} />
      </View>
    );
  }

  const addressText = formatDeliveryAddress(order.deliveryAddress);

  const canCancel = isBuyer && CANCELLABLE.includes(order.status);
  const canComplete = isBuyer && COMPLETABLE.includes(order.status);
  const canPay = isBuyer && order.status === 'awaiting_payment';
  const canReview = isBuyer && order.status === 'completed';
  const canComplain = isBuyer && ['completed', 'delivered'].includes(order.status);

  return (
    <View style={styles.container}>
      <StatusBar barStyle="dark-content" backgroundColor={theme.background} />
      <ScreenHeader title="Sipariş Detayı" onBack={onBack} />

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {/* Status + Order No */}
        <View style={styles.topRow}>
          <StatusBadge status={order.status} size="md" />
          <Text style={styles.orderNo}>{orderNo(order.id)}</Text>
        </View>

        {/* Seller */}
        <View style={styles.section}>
          <SectionDivider icon="storefront-outline" label="Satıcı" />
          <Text style={styles.sectionValue}>{order.sellerName}</Text>
        </View>

        {/* Items */}
        <View style={styles.section}>
          <SectionDivider icon="fast-food-outline" label="Ürünler" />
          {order.items.map((item, idx) => (
            <ItemRow key={idx} name={item.name} quantity={item.quantity} price={formatPrice(item.lineTotal)} />
          ))}
          <View style={styles.totalRow}>
            <Text style={styles.totalLabel}>Toplam</Text>
            <Text style={styles.totalValue}>{formatPrice(order.totalPrice)}</Text>
          </View>
        </View>

        {/* Delivery */}
        <View style={styles.section}>
          <SectionDivider
            icon={order.deliveryType === 'delivery' ? 'location-outline' : 'storefront-outline'}
            label={order.deliveryType === 'delivery' ? 'Teslimat Adresi' : 'Gel Al'}
          />
          <Text style={styles.sectionValue}>
            {order.deliveryType === 'delivery'
              ? (addressText || 'Adres bilgisi yok')
              : 'Satıcıdan teslim alınacak'}
          </Text>
        </View>

        {/* Date */}
        <View style={styles.section}>
          <SectionDivider icon="calendar-outline" label="Sipariş Tarihi" />
          <Text style={styles.sectionValue}>{formatEventDate(order.createdAt)}</Text>
        </View>

        {/* Timeline */}
        {order.events.length > 0 && (
          <View style={styles.section}>
            <SectionDivider icon="time-outline" label="Sipariş Durumu" />
            <View style={styles.timeline}>
              {order.events
                .filter((e) => e.toStatus)
                .map((event, idx, arr) => (
                  <TimelineStep
                    key={idx}
                    status={event.toStatus!}
                    date={formatEventDate(event.createdAt)}
                    isLast={idx === arr.length - 1}
                    isActive={true}
                    reason={event.reason}
                  />
                ))}
            </View>
          </View>
        )}

        {/* Actions */}
        <View style={styles.actions}>
          {canPay && onOpenPayment && (
            <ActionButton label="Ödeme Yap" onPress={() => onOpenPayment(order.id)} variant="primary" fullWidth />
          )}
          {canComplete && (
            <ActionButton label="Siparişi Tamamla" onPress={handleComplete} loading={actionLoading} variant="primary" fullWidth />
          )}
          {canReview && onOpenReview && (
            <ActionButton label="Yorum Yap" onPress={() => onOpenReview(order.id)} variant="outline" fullWidth />
          )}
          {canComplain && onOpenComplaint && (
            <ActionButton label="Şikayet Et" onPress={() => onOpenComplaint(order.id)} variant="soft" fullWidth />
          )}
          {canCancel && (
            <ActionButton label="Siparişi İptal Et" onPress={() => setCancelModal(true)} variant="danger" fullWidth />
          )}
        </View>
      </ScrollView>

      {/* Cancel Modal */}
      <BottomSheet visible={cancelModal} onClose={() => setCancelModal(false)}>
        <Text style={styles.cancelTitle}>Siparişi İptal Et</Text>
        <Text style={styles.cancelSubtitle}>İptal etmek istediğine emin misin?</Text>
        <TextInputField
          label="İptal sebebi (opsiyonel)"
          value={cancelReason}
          onChangeText={setCancelReason}
          placeholder="Sebebini kısaca yaz..."
          multiline
          numberOfLines={3}
          maxLength={500}
        />
        <View style={styles.cancelActions}>
          <ActionButton label="Vazgeç" onPress={() => setCancelModal(false)} variant="soft" />
          <ActionButton label="İptal Et" onPress={handleCancel} loading={actionLoading} variant="danger" />
        </View>
      </BottomSheet>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.background },
  content: { padding: 16, paddingBottom: 40 },
  topRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 20,
    backgroundColor: '#FCFBF9',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#E6DDD3',
    padding: 16,
  },
  orderNo: { color: '#9B8E80', fontSize: 14, fontWeight: '600' },
  section: {
    marginBottom: 18,
    backgroundColor: '#FCFBF9',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#E6DDD3',
    padding: 14,
  },
  sectionValue: { color: theme.text, fontSize: 15, fontWeight: '600', lineHeight: 22 },
  totalRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderTopWidth: 1,
    borderTopColor: '#EDE8E1',
    marginTop: 8,
    paddingTop: 10,
  },
  totalLabel: { color: theme.text, fontSize: 15, fontWeight: '700' },
  totalValue: { color: theme.text, fontSize: 18, fontWeight: '800' },
  timeline: { marginTop: 4 },
  actions: { gap: 10, marginTop: 8 },
  cancelTitle: { color: theme.text, fontSize: 20, fontWeight: '800', marginBottom: 6 },
  cancelSubtitle: { color: '#71685F', fontSize: 14, marginBottom: 16 },
  cancelActions: { flexDirection: 'row', justifyContent: 'space-between', gap: 12, marginTop: 8 },
});
