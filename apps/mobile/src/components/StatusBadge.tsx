import React from 'react';
import { View, Text, StyleSheet } from 'react-native';

const STATUS_MAP: Record<string, { label: string; color: string; bg: string }> = {
  pending_seller_approval: { label: 'Ödeme Bekleniyor', color: '#B86A00', bg: '#FFF3E0' },
  seller_approved: { label: 'Ödeme Bekleniyor', color: '#B86A00', bg: '#FFF3E0' },
  confirmed: { label: 'Ödeme Bekleniyor', color: '#B86A00', bg: '#FFF3E0' },
  awaiting_payment: { label: 'Ödeme Bekleniyor', color: '#B86A00', bg: '#FFF3E0' },
  paid: { label: 'Ödeme Alındı', color: '#166534', bg: '#EAF7EE' },
  preparing: { label: 'Hazırlanıyor', color: '#B86A00', bg: '#FFF3E0' },
  ready: { label: 'Hazır', color: '#166534', bg: '#EAF7EE' },
  pickup_ready: { label: 'Hazırlandı, seni bekliyor', color: '#166534', bg: '#EAF7EE' },
  pickup_ready_seller: { label: 'Hazırlandı', color: '#166534', bg: '#EAF7EE' },
  in_delivery: { label: 'Yola Çıktı', color: '#1D4ED8', bg: '#E7F0FF' },
  approaching: { label: 'Yaklaştı', color: '#0F766E', bg: '#E6FFFB' },
  at_door: { label: 'Kapıda', color: '#0F766E', bg: '#E6FFFB' },
  delivered: { label: 'Teslim Edildi', color: '#166534', bg: '#EAF7EE' },
  completed: { label: 'Teslim Edildi', color: '#166534', bg: '#EAF7EE' },
  rejected: { label: 'Reddedildi', color: '#C0392B', bg: '#FDECEC' },
  cancelled: { label: 'İptal Edildi', color: '#C0392B', bg: '#FDECEC' },
};

type Props = {
  status: string;
  size?: 'sm' | 'md';
  deliveryType?: 'pickup' | 'delivery' | string;
};

function statusKeyByDeliveryType(status: string, deliveryType?: string): string {
  const normalizedStatus = String(status ?? '').trim().toLowerCase();
  const normalizedDeliveryType = String(deliveryType ?? '').trim().toLowerCase();
  if (normalizedDeliveryType === 'pickup' && normalizedStatus === 'ready') {
    return 'pickup_ready';
  }
  if (normalizedDeliveryType === 'pickup' && ['in_delivery', 'approaching', 'at_door'].includes(normalizedStatus)) {
    return 'pickup_ready';
  }
  return normalizedStatus;
}

export default function StatusBadge({ status, size = 'sm', deliveryType }: Props) {
  const key = statusKeyByDeliveryType(status, deliveryType);
  const info = STATUS_MAP[key] ?? { label: status, color: '#71685F', bg: '#F0EBE4' };
  const isMd = size === 'md';

  return (
    <View style={[styles.badge, { backgroundColor: info.bg }, isMd && styles.badgeMd]}>
      <Text style={[styles.text, { color: info.color }, isMd && styles.textMd]}>
        {info.label}
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
