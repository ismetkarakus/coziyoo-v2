import React, { useCallback, useEffect, useRef, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, StatusBar, Alert, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Location from 'expo-location';
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
import { subscribeOrderRealtime } from '../utils/realtime';

type OrderDetail = {
  id: string;
  buyerId: string;
  sellerId: string;
  status: string;
  deliveryType: 'pickup' | 'delivery';
  deliveryAddress: unknown;
  sellerAddress?: { title?: string; addressLine?: string } | null;
  totalPrice: number;
  paymentCompleted: boolean;
  createdAt: string;
  sellerName: string;
  sellerImage: string | null;
  buyerName: string;
  items: Array<{
    name: string;
    image: string | null;
    quantity: number;
    unitPrice: number;
    lineTotal: number;
    selectedAddons?: {
      free?: Array<{ name: string; kind?: "sauce" | "extra" | "appetizer" }>;
      paid?: Array<{ name: string; kind?: "sauce" | "extra" | "appetizer"; price: number; quantity?: number }>;
    };
  }>;
  events: { eventType: string; fromStatus: string | null; toStatus: string | null; createdAt: string; reason?: string | null }[];
};

type OrderTracking = {
  orderId: string;
  status: string;
  statusLabel: string;
  isDelivery: boolean;
  estimatedDeliveryTime: string | null;
  remainingMinutes: number | null;
  lastSellerLocationAt: string | null;
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
const DELIVERY_FLOW_STEPS = ['preparing', 'in_delivery', 'approaching', 'at_door', 'delivered'] as const;
const PICKUP_FLOW_STEPS = ['preparing', 'ready'] as const;
type BuyerFlowStep = (typeof DELIVERY_FLOW_STEPS)[number] | (typeof PICKUP_FLOW_STEPS)[number];

function flowStepsByDeliveryType(deliveryType: 'pickup' | 'delivery'): readonly BuyerFlowStep[] {
  return deliveryType === 'pickup' ? PICKUP_FLOW_STEPS : DELIVERY_FLOW_STEPS;
}

function normalizeBuyerFlowStatus(
  status: string,
  deliveryType: 'pickup' | 'delivery',
): BuyerFlowStep | 'cancelled' | 'rejected' {
  const normalized = String(status ?? '').trim().toLowerCase();
  if (deliveryType === 'pickup') {
    if (['pending_seller_approval', 'seller_approved', 'awaiting_payment', 'paid', 'preparing'].includes(normalized)) return 'preparing';
    if (['ready', 'in_delivery', 'approaching', 'at_door', 'delivered', 'completed'].includes(normalized)) return 'ready';
    if (normalized === 'cancelled') return 'cancelled';
    if (normalized === 'rejected') return 'rejected';
    return 'preparing';
  }

  if (['pending_seller_approval', 'seller_approved', 'awaiting_payment', 'paid', 'preparing', 'ready'].includes(normalized)) return 'preparing';
  if (normalized === 'in_delivery') return 'in_delivery';
  if (normalized === 'approaching') return 'approaching';
  if (normalized === 'at_door') return 'at_door';
  if (normalized === 'delivered') return 'delivered';
  if (normalized === 'completed') return 'delivered';
  if (normalized === 'cancelled') return 'cancelled';
  if (normalized === 'rejected') return 'rejected';
  return 'preparing';
}

function buyerFlowLabel(step: BuyerFlowStep): string {
  if (step === 'preparing') return 'Hazırlanıyor';
  if (step === 'ready') return 'Hazır';
  if (step === 'in_delivery') return 'Yola Çıktı';
  if (step === 'approaching') return 'Yaklaştı';
  if (step === 'at_door') return 'Kapıda';
  return 'Teslim Edildi';
}

function buyerFlowLabelByDeliveryType(step: BuyerFlowStep, deliveryType: 'pickup' | 'delivery'): string {
  if (deliveryType === 'pickup') {
    if (step === 'preparing') return 'Hazırlanıyor';
    return 'Hazırlandı, seni bekliyor';
  }
  return buyerFlowLabel(step);
}

export default function OrderDetailScreen({
  auth, orderId, onBack, onOpenPayment, onOpenReview, onOpenComplaint, onAuthRefresh,
}: Props) {
  const [order, setOrder] = useState<OrderDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [actionLoading, setActionLoading] = useState(false);
  const [cancelModal, setCancelModal] = useState(false);
  const [cancelReason, setCancelReason] = useState('');
  const [tracking, setTracking] = useState<OrderTracking | null>(null);
  const [trackingFocused, setTrackingFocused] = useState(false);
  const locationTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const statusPollRef = useRef<ReturnType<typeof setInterval> | null>(null);

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

  const refreshOrderStatus = useCallback(async () => {
    const result = await apiRequest<OrderDetail>(
      `/v1/orders/${orderId}`,
      auth,
      { actorRole: 'buyer' },
      onAuthRefresh,
    );
    if (result.ok) {
      setOrder(result.data);
    }
  }, [orderId, auth, onAuthRefresh]);

  const isBuyer = order?.buyerId === auth.userId;
  const actorRole = isBuyer ? 'buyer' : 'seller';

  const fetchTracking = useCallback(async () => {
    if (!order || order.deliveryType !== 'delivery') {
      setTracking(null);
      return;
    }
    const result = await apiRequest<OrderTracking>(
      `/v1/orders/${order.id}/tracking`,
      auth,
      { actorRole },
      onAuthRefresh,
    );
    if (result.ok) {
      setTracking(result.data);
    }
  }, [actorRole, auth, onAuthRefresh, order]);

  useEffect(() => {
    if (!order || order.deliveryType !== 'delivery') return;
    void fetchTracking();
    const active = ['preparing', 'ready', 'in_delivery', 'approaching', 'at_door'].includes(order.status);
    if (!active) return;
    const timer = setInterval(() => { void fetchTracking(); }, 20_000);
    return () => clearInterval(timer);
  }, [fetchTracking, order]);

  useEffect(() => {
    if (statusPollRef.current) {
      clearInterval(statusPollRef.current);
      statusPollRef.current = null;
    }
    if (!order) return;
    const terminal = ['completed', 'cancelled', 'rejected'].includes(order.status);
    if (terminal) return;
    statusPollRef.current = setInterval(() => { void refreshOrderStatus(); }, 8_000);
    return () => {
      if (statusPollRef.current) {
        clearInterval(statusPollRef.current);
        statusPollRef.current = null;
      }
    };
  }, [order, refreshOrderStatus]);

  useEffect(() => {
    if (!order?.id) return () => {};
    return subscribeOrderRealtime(order.id, () => {
      void refreshOrderStatus();
      void fetchTracking();
    });
  }, [order?.id, refreshOrderStatus, fetchTracking]);

  // Seller location ping — only when seller + in_delivery + delivery type
  useEffect(() => {
    const isSeller = order?.sellerId === auth.userId;
    if (!order || !isSeller || order.deliveryType !== 'delivery' || order.status !== 'in_delivery') {
      if (locationTimerRef.current) {
        clearInterval(locationTimerRef.current);
        locationTimerRef.current = null;
      }
      return;
    }

    async function pingLocation() {
      try {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status !== 'granted') return;
        const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High });
        await apiRequest(
          `/v1/orders/${order!.id}/location`,
          auth,
          {
            method: 'POST',
            body: {
              lat: loc.coords.latitude,
              lng: loc.coords.longitude,
              accuracyM: loc.coords.accuracy ?? undefined,
            },
            actorRole: 'seller',
          },
          onAuthRefresh,
        );
      } catch {
        // Best-effort, silently ignore
      }
    }

    void pingLocation();
    locationTimerRef.current = setInterval(() => { void pingLocation(); }, 15_000);

    return () => {
      if (locationTimerRef.current) {
        clearInterval(locationTimerRef.current);
        locationTimerRef.current = null;
      }
    };
  }, [auth, onAuthRefresh, order]);

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
    const previousStatus = order.status;
    const result = await apiRequest(
      `/v1/orders/${order.id}/status`,
      auth,
      { method: 'POST', body: { toStatus: 'completed' }, actorRole: 'buyer' },
      onAuthRefresh,
    );
    setActionLoading(false);
    if (result.ok) {
      const nowIso = new Date().toISOString();
      setOrder((prev) => {
        if (!prev) return prev;
        const hasCompletedEvent = prev.events.some((event) => String(event.toStatus ?? '') === 'completed');
        return {
          ...prev,
          status: 'completed',
          updatedAt: nowIso,
          events: hasCompletedEvent
            ? prev.events
            : [
                ...prev.events,
                {
                  eventType: 'buyer_completed',
                  fromStatus: previousStatus,
                  toStatus: 'completed',
                  createdAt: nowIso,
                  reason: null,
                },
              ],
        };
      });
      setTracking((prev) =>
        prev
          ? {
              ...prev,
              status: 'completed',
              statusLabel: 'Tamamlandı',
              remainingMinutes: 0,
            }
          : prev,
      );
      void fetchOrder();
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

  function formatLastUpdate(iso: string | null | undefined): string {
    if (!iso) return 'Az önce güncelleniyor';
    const d = new Date(iso);
    if (Number.isNaN(d.getTime())) return 'Az önce güncelleniyor';
    const hh = d.getHours().toString().padStart(2, '0');
    const mm = d.getMinutes().toString().padStart(2, '0');
    return `Son güncelleme: ${hh}:${mm}`;
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
  const canComplete = isBuyer && order.deliveryType === 'delivery' && COMPLETABLE.includes(order.status);
  const canPay =
    isBuyer &&
    !order.paymentCompleted &&
    ['pending_seller_approval', 'seller_approved', 'awaiting_payment'].includes(order.status);
  const canReview = isBuyer && ['delivered', 'completed'].includes(order.status);
  const canComplain = isBuyer && ['at_door', 'delivered', 'completed'].includes(order.status);
  const flowSteps = flowStepsByDeliveryType(order.deliveryType);
  const buyerFlowStatus = normalizeBuyerFlowStatus(order.status, order.deliveryType);
  const buyerFlowCurrentIndex = flowSteps.indexOf(
    buyerFlowStatus === 'cancelled' || buyerFlowStatus === 'rejected' ? 'preparing' : buyerFlowStatus
  );
  const buyerFlowReachedAt = order.events.reduce<Record<string, string | null>>((acc, event) => {
    if (!event.toStatus) return acc;
    const mapped = normalizeBuyerFlowStatus(event.toStatus, order.deliveryType);
    if (mapped === 'cancelled' || mapped === 'rejected') return acc;
    if (!flowSteps.includes(mapped)) return acc;
    if (!acc[mapped]) acc[mapped] = event.createdAt;
    return acc;
  }, flowSteps.reduce<Record<string, string | null>>((acc, step) => {
    acc[step] = null;
    return acc;
  }, {}));

  return (
    <View style={styles.container}>
      <StatusBar barStyle="dark-content" backgroundColor={theme.background} />
      <ScreenHeader title="Sipariş Detayı" onBack={onBack} />

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {/* Status + Order No */}
        <View style={styles.topRow}>
          <StatusBadge status={buyerFlowStatus} size="md" deliveryType={order.deliveryType} />
          <Text style={styles.orderNo}>{orderNo(order.id)}</Text>
        </View>

        {/* Seller */}
        <View style={styles.section}>
          <SectionDivider icon="storefront-outline" label="Satıcı" />
          <Text style={styles.sectionValue}>{order.sellerName}</Text>
        </View>

        {order.deliveryType === 'delivery' && (
          <View style={styles.section}>
            <SectionDivider icon="navigate-outline" label="Canlı Teslimat Durumu" />
            <TouchableOpacity
              style={[styles.liveWatchButton, trackingFocused && styles.liveWatchButtonActive]}
              activeOpacity={0.85}
              onPress={() => setTrackingFocused((prev) => !prev)}
            >
              <Text style={[styles.liveWatchButtonText, trackingFocused && styles.liveWatchButtonTextActive]}>
                {trackingFocused ? 'Canlı izleme açık' : 'Canlı izle'}
              </Text>
            </TouchableOpacity>

            {trackingFocused ? (
              <View style={styles.trackingPanel}>
                <Text style={styles.trackingStatus}>{tracking?.statusLabel ?? 'Durum güncelleniyor'}</Text>
                <Text style={styles.trackingEta}>
                  {tracking?.remainingMinutes !== null && tracking?.remainingMinutes !== undefined
                    ? `${tracking.remainingMinutes} dk kaldı`
                    : 'Kalan süre hesaplanıyor'}
                </Text>
                <Text style={styles.trackingLastUpdate}>{formatLastUpdate(tracking?.lastSellerLocationAt)}</Text>
              </View>
            ) : (
              <Text style={styles.trackingHint}>Canlı süre bilgisini görmek için "Canlı izle"ye dokun.</Text>
            )}
          </View>
        )}

        {/* Items */}
        <View style={styles.section}>
          <SectionDivider icon="fast-food-outline" label="Ürünler" />
          {order.items.map((item, idx) => (
            <View key={`${item.name}-${idx}`} style={styles.itemRowWrap}>
              <ItemRow name={item.name} quantity={item.quantity} price={formatPrice(item.lineTotal)} />
              {(item.selectedAddons?.free?.length ?? 0) > 0 ? (
                <Text style={styles.itemAddonLine}>
                  Ücretsiz: {(item.selectedAddons?.free ?? []).map((addon) => addon.name).join(", ")}
                </Text>
              ) : null}
              {(item.selectedAddons?.paid?.length ?? 0) > 0
                ? (item.selectedAddons?.paid ?? []).map((addon, addonIndex) => {
                    const qty = Number.isInteger(addon.quantity) && Number(addon.quantity) > 0 ? Number(addon.quantity) : 1;
                    const subtotal = Number(addon.price ?? 0) * qty;
                    return (
                      <Text key={`${item.name}-${idx}-paid-${addon.name}-${addonIndex}`} style={styles.itemAddonLine}>
                        • {addon.name} x{qty} (+{formatPrice(subtotal)})
                      </Text>
                    );
                  })
                : null}
            </View>
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
              : [order.sellerAddress?.title, order.sellerAddress?.addressLine].filter(Boolean).join(' · ') || 'Satıcıdan teslim alınacak'}
          </Text>
        </View>

        {/* Date */}
        <View style={styles.section}>
          <SectionDivider icon="calendar-outline" label="Sipariş Tarihi" />
          <Text style={styles.sectionValue}>{formatEventDate(order.createdAt)}</Text>
        </View>

        {/* Timeline */}
        <View style={styles.section}>
          <SectionDivider icon="time-outline" label="Sipariş Durumu" />
          <View style={styles.timeline}>
            {flowSteps.map((step, idx) => {
              const reached = idx <= buyerFlowCurrentIndex && buyerFlowStatus !== 'cancelled' && buyerFlowStatus !== 'rejected';
              const dateValue = buyerFlowReachedAt[step] ?? null;
              const fallbackDate = reached ? order.createdAt : '';
              return (
                <TimelineStep
                  key={step}
                  status={step}
                  label={buyerFlowLabelByDeliveryType(step, order.deliveryType)}
                  date={dateValue ? formatEventDate(dateValue) : (fallbackDate ? formatEventDate(fallbackDate) : 'Bekleniyor')}
                  isLast={idx === flowSteps.length - 1}
                  isActive={reached}
                />
              );
            })}
            {(buyerFlowStatus === 'cancelled' || buyerFlowStatus === 'rejected') ? (
              <TimelineStep
                status={buyerFlowStatus}
                label="İptal Edildi"
                date={formatEventDate(order.createdAt)}
                isLast
                isActive
                reason={order.events.find((event) => normalizeBuyerFlowStatus(event.toStatus ?? '', order.deliveryType) === buyerFlowStatus)?.reason ?? null}
              />
            ) : null}
          </View>
        </View>

        {/* Actions */}
        <View style={styles.actions}>
          {order.status === 'completed' ? (
            <View style={styles.completeNotice}>
              <Ionicons name="checkmark-circle" size={18} color="#2F7B4B" />
              <Text style={styles.completeNoticeText}>Sipariş tamamlandı.</Text>
            </View>
          ) : null}
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
  itemRowWrap: { marginBottom: 6 },
  itemAddonLine: { marginTop: 4, marginLeft: 6, color: '#71685F', fontSize: 13 },
  liveWatchButton: {
    marginTop: 4,
    alignSelf: 'flex-start',
    borderRadius: 10,
    backgroundColor: '#EAF4EE',
    borderWidth: 1,
    borderColor: '#CDE0D4',
    paddingVertical: 8,
    paddingHorizontal: 12,
  },
  liveWatchButtonActive: {
    backgroundColor: '#3F855C',
    borderColor: '#3F855C',
  },
  liveWatchButtonText: { color: '#2E241C', fontSize: 13, fontWeight: '700' },
  liveWatchButtonTextActive: { color: '#FFFFFF' },
  trackingPanel: {
    marginTop: 10,
    borderWidth: 1,
    borderColor: '#E6DDD3',
    borderRadius: 12,
    padding: 10,
    backgroundColor: '#FFFCF7',
  },
  trackingStatus: { color: theme.text, fontSize: 16, fontWeight: '800' },
  trackingEta: { color: '#71685F', fontSize: 14, fontWeight: '600', marginTop: 4 },
  trackingLastUpdate: { color: '#9B8E80', fontSize: 12, marginTop: 6, fontWeight: '600' },
  trackingHint: { color: '#71685F', fontSize: 13, marginTop: 8, fontWeight: '600' },
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
  completeNotice: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    borderWidth: 1,
    borderColor: '#CDE7D8',
    backgroundColor: '#ECF8F0',
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  completeNoticeText: { color: '#2F7B4B', fontSize: 14, fontWeight: '700' },
  cancelTitle: { color: theme.text, fontSize: 20, fontWeight: '800', marginBottom: 6 },
  cancelSubtitle: { color: '#71685F', fontSize: 14, marginBottom: 16 },
  cancelActions: { flexDirection: 'row', justifyContent: 'space-between', gap: 12, marginTop: 8 },
});
