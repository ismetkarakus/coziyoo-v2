import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import React from 'react';
import { StyleSheet, Text, View } from 'react-native';
import type { RootStackParamList } from '../../types/navigation';

type Props = NativeStackScreenProps<RootStackParamList, 'Notes'>;

export function NotesScreen({ route }: Props) {
  const prefill = route.params?.prefill;
  return (
    <View style={styles.root}>
      <Text style={styles.title}>Notes</Text>
      <Text>{prefill ? `Prefill: ${String(prefill)}` : 'No prefill note provided.'}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, padding: 16, backgroundColor: '#fff' },
  title: { fontSize: 24, fontWeight: '700', marginBottom: 8 },
});
