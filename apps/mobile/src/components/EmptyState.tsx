import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import ActionButton from './ActionButton';
import { theme } from '../theme/colors';

type Props = {
  icon: keyof typeof Ionicons.glyphMap;
  title: string;
  subtitle?: string;
  actionLabel?: string;
  onAction?: () => void;
};

export default function EmptyState({ icon, title, subtitle, actionLabel, onAction }: Props) {
  return (
    <View style={styles.container}>
      <View style={styles.iconWrap}>
        <Ionicons name={icon} size={48} color={theme.textSecondary} />
      </View>
      <Text style={styles.title}>{title}</Text>
      {subtitle ? <Text style={styles.subtitle}>{subtitle}</Text> : null}
      {actionLabel && onAction ? (
        <View style={styles.actionWrap}>
          <ActionButton label={actionLabel} onPress={onAction} variant="soft" />
        </View>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { alignItems: 'center', paddingVertical: 60, paddingHorizontal: 32 },
  iconWrap: { marginBottom: 16 },
  title: { color: theme.text, fontSize: 17, fontWeight: '700', textAlign: 'center' },
  subtitle: { color: theme.textSecondary, fontSize: 14, textAlign: 'center', marginTop: 6, lineHeight: 20 },
  actionWrap: { marginTop: 20 },
});
