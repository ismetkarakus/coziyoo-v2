import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { getStatusInfo } from './StatusBadge';

type Props = {
  status: string;
  date: string;
  isLast?: boolean;
  isActive?: boolean;
  reason?: string | null;
};

export default function TimelineStep({ status, date, isLast, isActive, reason }: Props) {
  const info = getStatusInfo(status);

  return (
    <View style={styles.row}>
      <View style={styles.lineCol}>
        <View style={[styles.dot, { backgroundColor: isActive ? info.color : '#D5CFC7' }]}>
          {isActive ? <Ionicons name="checkmark" size={12} color="#FFFFFF" /> : null}
        </View>
        {!isLast && <View style={[styles.line, { backgroundColor: isActive ? info.color : '#E6E0D8' }]} />}
      </View>
      <View style={styles.content}>
        <Text style={[styles.label, isActive && { color: info.color, fontWeight: '700' }]}>
          {info.label}
        </Text>
        <Text style={styles.date}>{date}</Text>
        {reason ? <Text style={styles.reason}>{reason}</Text> : null}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', minHeight: 48 },
  lineCol: { width: 28, alignItems: 'center' },
  dot: {
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: 'center',
    justifyContent: 'center',
  },
  line: { width: 2, flex: 1, marginVertical: 2 },
  content: { flex: 1, paddingLeft: 10, paddingBottom: 16 },
  label: { color: '#71685F', fontSize: 14, fontWeight: '500' },
  date: { color: '#9B8E80', fontSize: 12, marginTop: 2 },
  reason: { color: '#71685F', fontSize: 12, marginTop: 4, fontStyle: 'italic' },
});
