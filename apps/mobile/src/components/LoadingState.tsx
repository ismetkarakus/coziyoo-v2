import React from 'react';
import { View, ActivityIndicator, Text, StyleSheet } from 'react-native';
import { theme } from '../theme/colors';

type Props = {
  message?: string;
};

export default function LoadingState({ message }: Props) {
  return (
    <View style={styles.container}>
      <ActivityIndicator size="large" color={theme.primary} />
      {message ? <Text style={styles.message}>{message}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: 60 },
  message: { color: theme.textSecondary, fontSize: 14, marginTop: 12 },
});
