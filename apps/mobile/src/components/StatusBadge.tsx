import React from 'react';
import { View, Text, StyleSheet } from 'react-native';

const STATUS_MAP: Record<string, { label: string; color: string; bg: string }> = {
  pending_seller_approval: { label: 'Onay Bekliyor', color: '#B8860B', bg: '#FFF4E5' },
  seller_approved: { label: 'Onaylandı', color: '#5D7394', bg: '#E8EDF3' },
  awaiting_payment: { label: 'Ödeme Bekleniyor', color: '#D4740B', bg: '#FFF0E0' },
  paid: { label: 'Ödendi', color: '#5D7394', bg: '#E8EDF3' },
  preparing: { label: 'Hazırlanıyor', color: '#B8860B', bg: '#FFF4E5' },
  ready: { label: 'Hazır', color: '#6B4FA2', bg: '#EDE8F5' },
  in_delivery: { label: 'Yolda', color: '#6B4FA2', bg: '#EDE8F5' },
  delivered: { label: 'Teslim Edildi', color: '#3E845B', bg: '#E4F2E7' },
  completed: { label: 'Tamamlandı', color: '#3E845B', bg: '#E4F2E7' },
  rejected: { label: 'Reddedildi', color: '#C0392B', bg: '#FDECEC' },
  cancelled: { label: 'İptal Edildi', color: '#C0392B', bg: '#FDECEC' },
};

type Props = {
  status: string;
  size?: 'sm' | 'md';
};

export default function StatusBadge({ status, size = 'sm' }: Props) {
  const info = STATUS_MAP[status] ?? { label: status, color: '#71685F', bg: '#F0EBE4' };
  const isMd = size === 'md';

  return (
    <View style={[styles.badge, { backgroundColor: info.bg }, isMd && styles.badgeMd]}>
      <Text style={[styles.text, { color: info.color }, isMd && styles.textMd]}>
        {info.label}
      </Text>
    </View>
  );
}

export function getStatusInfo(status: string) {
  return STATUS_MAP[status] ?? { label: status, color: '#71685F', bg: '#F0EBE4' };
}

const styles = StyleSheet.create({
  badge: { borderRadius: 12, paddingHorizontal: 10, paddingVertical: 4 },
  badgeMd: { paddingHorizontal: 14, paddingVertical: 6 },
  text: { fontSize: 12, fontWeight: '700' },
  textMd: { fontSize: 14 },
});
