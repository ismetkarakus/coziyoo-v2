import React from 'react';
import { StyleSheet, Text, View } from 'react-native';

export function ProfileScreen({ route }: { route: any }) {
  const userId = route?.params?.userId ?? 'current-user';
  return (
    <View style={styles.root}>
      <Text style={styles.title}>Profile</Text>
      <Text>User ID: {String(userId)}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, padding: 16, backgroundColor: '#fff' },
  title: { fontSize: 24, fontWeight: '700', marginBottom: 8 },
});
