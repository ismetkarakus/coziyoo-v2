import React from 'react';
import { View, Text, StyleSheet } from 'react-native';

const STATUS_MAP: Record<string, { label: string; color: string; bg: string }> = {
  pending_seller_approval: { label: 'Satıcı Onayı Bekleniyor', color: '#B86A00', bg: '#FFF3E0' },
  seller_approved: { label: 'Sipariş Onaylandı', color: '#A16207', bg: '#FFF8EB' },
  confirmed: { label: 'Ödeme Bekleniyor', color: '#9A3412', bg: '#FFF1EB' },
  awaiting_payment: { label: 'Ödeme Bekleniyor', color: '#7C5D00', bg: '#FFF7D6' },
  paid: { label: 'Ödeme Alındı', color: '#0F766E', bg: '#E6FFFB' },
  preparing: { label: 'Hazırlanıyor', color: '#B45309', bg: '#FFF4E8' },
  ready: { label: 'Hazır', color: '#15803D', bg: '#EAF7EE' },
  pickup_ready: { label: 'Hazırlandı, seni bekliyor', color: '#15803D', bg: '#EAF7EE' },
  pickup_ready_seller: { label: 'Hazırlandı', color: '#15803D', bg: '#EAF7EE' },
  in_delivery: { label: 'Yola Çıktı', color: '#1D4ED8', bg: '#E7F0FF' },
  approaching: { label: 'Yaklaştı', color: '#0E7490', bg: '#E6F7FB' },
  at_door: { label: 'Kapıda', color: '#C2410C', bg: '#FFF1EB' },
  delivered: { label: 'Teslim Edildi', color: '#047857', bg: '#E8FBF4' },
  completed: { label: 'Teslim Edildi', color: '#166534', bg: '#EAF7EE' },
  rejected: { label: 'Reddedildi', color: '#B91C1C', bg: '#FEECEC' },
  cancelled: { label: 'İptal Edildi', color: '#7F1D1D', bg: '#FDECEC' },
};

type Props = {
  status: string;
  size?: 'sm' | 'md';
  deliveryType?: 'pickup' | 'delivery' | string;
  audience?: 'buyer' | 'seller';
};

function statusKeyByDeliveryType(status: string, deliveryType?: string): string {
  const normalizedStatus = String(status ?? '').trim().toLowerCase();
  const normalizedDeliveryType = String(deliveryType ?? '').trim().toLowerCase();
  if (normalizedDeliveryType === 'pickup' && normalizedStatus === 'ready') {
    return 'pickup_ready';
  }
  return normalizedStatus;
}

function resolveLabel(statusKey: string, fallbackLabel: string, audience?: 'buyer' | 'seller'): string {
  if (audience === 'buyer' && statusKey === 'paid') return 'Ödeme Alındı';
  return fallbackLabel;
}

export default function StatusBadge({ status, size = 'sm', deliveryType, audience }: Props) {
  const key = statusKeyByDeliveryType(status, deliveryType);
  const info = STATUS_MAP[key] ?? { label: status, color: '#71685F', bg: '#F0EBE4' };
  const label = resolveLabel(key, info.label, audience);
  const isMd = size === 'md';

  return (
    <View style={[styles.badge, { backgroundColor: info.bg }, isMd && styles.badgeMd]}>
      <Text style={[styles.text, { color: info.color }, isMd && styles.textMd]}>
        {label}
      </Text>
    </View>
  );
}

export function getStatusInfo(status: string, deliveryType?: string) {
  const key = statusKeyByDeliveryType(status, deliveryType);
  return STATUS_MAP[key] ?? { label: status, color: '#71685F', bg: '#F0EBE4' };
}

const styles = StyleSheet.create({
  badge: { borderRadius: 12, paddingHorizontal: 10, paddingVertical: 4 },
  badgeMd: { paddingHorizontal: 14, paddingVertical: 6 },
  text: { fontSize: 12, fontWeight: '700' },
  textMd: { fontSize: 14 },
});
