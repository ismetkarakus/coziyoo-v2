import React from 'react';
import { TouchableOpacity, Text, StyleSheet, ActivityIndicator } from 'react-native';
import { theme } from '../theme/colors';

type Variant = 'primary' | 'outline' | 'soft' | 'danger';

type Props = {
  label: string;
  onPress: () => void;
  variant?: Variant;
  disabled?: boolean;
  loading?: boolean;
  fullWidth?: boolean;
  size?: 'sm' | 'md';
};

const VARIANTS: Record<Variant, { bg: string; text: string; border?: string }> = {
  primary: { bg: theme.primary, text: '#FFFFFF' },
  outline: { bg: 'transparent', text: theme.primary, border: theme.primary },
  soft: { bg: '#EFEBE7', text: '#6B5D4F' },
  danger: { bg: '#FDECEC', text: '#C0392B' },
};

export default function ActionButton({
  label, onPress, variant = 'primary', disabled, loading, fullWidth, size = 'md',
}: Props) {
  const v = VARIANTS[variant];
  const isSm = size === 'sm';

  return (
    <TouchableOpacity
      style={[
        styles.btn,
        { backgroundColor: v.bg },
        v.border ? { borderWidth: 1.5, borderColor: v.border } : undefined,
        fullWidth && styles.fullWidth,
        isSm && styles.btnSm,
        disabled && styles.disabled,
      ]}
      onPress={onPress}
      disabled={disabled || loading}
      activeOpacity={0.7}
    >
      {loading ? (
        <ActivityIndicator size="small" color={v.text} />
      ) : (
        <Text style={[styles.label, { color: v.text }, isSm && styles.labelSm]}>{label}</Text>
      )}
    </TouchableOpacity>
  );
}

const styles = StyleSheet.create({
  btn: {
    paddingHorizontal: 20,
    paddingVertical: 14,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
  },
  btnSm: { paddingHorizontal: 14, paddingVertical: 10, borderRadius: 12 },
  fullWidth: { width: '100%' },
  label: { fontSize: 15, fontWeight: '700' },
  labelSm: { fontSize: 13 },
  disabled: { opacity: 0.5 },
});
