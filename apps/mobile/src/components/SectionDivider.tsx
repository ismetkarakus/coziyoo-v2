import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';

type Props = {
  icon?: keyof typeof Ionicons.glyphMap;
  label: string;
};

export default function SectionDivider({ icon, label }: Props) {
  return (
    <View style={styles.container}>
      {icon ? <Ionicons name={icon} size={16} color="#71685F" /> : null}
      <Text style={styles.label}>{label}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 8,
    marginTop: 4,
  },
  label: { color: '#71685F', fontSize: 13, fontWeight: '600' },
});
