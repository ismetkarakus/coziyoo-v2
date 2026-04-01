import React from 'react';
import { View, Text, StyleSheet } from 'react-native';

const STATUS_MAP: Record<string, { label: string; color: string; bg: string }> = {
  pending_seller_approval: { label: 'Hazırlanıyor', color: '#B86A00', bg: '#FFF3E0' },
  seller_approved: { label: 'Hazırlanıyor', color: '#B86A00', bg: '#FFF3E0' },
  confirmed: { label: 'Hazırlanıyor', color: '#B86A00', bg: '#FFF3E0' },
  awaiting_payment: { label: 'Hazırlanıyor', color: '#B86A00', bg: '#FFF3E0' },
  paid: { label: 'Hazırlanıyor', color: '#B86A00', bg: '#FFF3E0' },
  preparing: { label: 'Hazırlanıyor', color: '#B86A00', bg: '#FFF3E0' },
  ready: { label: 'Yola Çıktı', color: '#1D4ED8', bg: '#E7F0FF' },
  in_delivery: { label: 'Yola Çıktı', color: '#1D4ED8', bg: '#E7F0FF' },
  delivered: { label: 'Kapıda Teslim Edildi', color: '#0F766E', bg: '#E6FFFB' },
  completed: { label: 'Tamamlandı', color: '#166534', bg: '#EAF7EE' },
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
