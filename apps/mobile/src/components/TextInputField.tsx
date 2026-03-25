import React, { useRef } from 'react';
import { View, Text, TextInput, StyleSheet, type KeyboardTypeOptions, type NativeSyntheticEvent, type TextInputSelectionChangeEventData } from 'react-native';
import { theme } from '../theme/colors';

type Props = {
  label: string;
  value: string;
  onChangeText: (text: string) => void;
  placeholder?: string;
  multiline?: boolean;
  numberOfLines?: number;
  maxLength?: number;
  keyboardType?: KeyboardTypeOptions;
  autoCapitalize?: 'none' | 'sentences' | 'words' | 'characters';
  error?: string;
  editable?: boolean;
};

export default function TextInputField({
  label, value, onChangeText, placeholder, multiline, numberOfLines,
  maxLength, keyboardType, autoCapitalize, error, editable = true,
}: Props) {
  const inputRef = useRef<TextInput>(null);

  function handleSelectionChange(e: NativeSyntheticEvent<TextInputSelectionChangeEventData>) {
    if (!multiline) return;
    const { start } = e.nativeEvent.selection;
    (inputRef.current as any)?.scrollTo?.({ y: start, animated: false });
  }

  return (
    <View style={styles.container}>
      <Text style={styles.label}>{label}</Text>
      <TextInput
        ref={inputRef}
        style={[
          styles.input,
          multiline && { minHeight: (numberOfLines ?? 3) * 24, maxHeight: (numberOfLines ?? 3) * 24, textAlignVertical: 'top' },
          error && styles.inputError,
          !editable && styles.inputDisabled,
        ]}
        value={value}
        onChangeText={onChangeText}
        placeholder={placeholder}
        placeholderTextColor={theme.textSecondary}
        multiline={multiline}
        numberOfLines={numberOfLines}
        maxLength={maxLength}
        keyboardType={keyboardType}
        autoCapitalize={autoCapitalize}
        editable={editable}
        scrollEnabled={multiline}
        onSelectionChange={multiline ? handleSelectionChange : undefined}
      />
      {error ? <Text style={styles.error}>{error}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { marginBottom: 14 },
  label: { color: theme.text, fontSize: 13, fontWeight: '600', marginBottom: 6 },
  input: {
    backgroundColor: theme.surface,
    borderWidth: 1,
    borderColor: theme.border,
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 12,
    fontSize: 16,
    color: theme.text,
  },
  inputError: { borderColor: theme.error },
  inputDisabled: { opacity: 0.5 },
  error: { color: theme.error, fontSize: 12, marginTop: 4, marginLeft: 4 },
});
