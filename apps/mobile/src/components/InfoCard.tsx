import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { theme } from '../theme/colors';

type Props = {
  icon: keyof typeof Ionicons.glyphMap;
  iconBg?: string;
  label: string;
  value: string;
  secondary?: string;
};

export default function InfoCard({ icon, iconBg = '#F0ECE6', label, value, secondary }: Props) {
  return (
    <View style={styles.card}>
      <View style={[styles.iconWrap, { backgroundColor: iconBg }]}>
        <Ionicons name={icon} size={18} color="#71685F" />
      </View>
      <View style={styles.body}>
        <Text style={styles.label}>{label}</Text>
        <Text style={styles.value} numberOfLines={2}>{value}</Text>
        {secondary ? <Text style={styles.secondary}>{secondary}</Text> : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    gap: 12,
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#F0EBE4',
  },
  iconWrap: {
    width: 36,
    height: 36,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  body: { flex: 1 },
  label: { color: '#71685F', fontSize: 13, fontWeight: '600', marginBottom: 2 },
  value: { color: theme.text, fontSize: 15, fontWeight: '600' },
  secondary: { color: '#9B8E80', fontSize: 12, marginTop: 2 },
});
