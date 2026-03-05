import React, { useEffect, useRef } from 'react';
import { Animated, Pressable, StyleSheet, Text, View } from 'react-native';
import type { VoiceUiState } from '../domains/voice/types';

type Props = {
  state: VoiceUiState;
  unreadSuggestion: boolean;
  onPress: () => void;
};

const STATE_COLOR: Record<VoiceUiState, string> = {
  idle: '#6B7280',
  connecting: '#0EA5E9',
  listening: '#10B981',
  thinking: '#F59E0B',
  speaking: '#7C3AED',
  error: '#EF4444',
};

export function FloatingAvatar({ state, unreadSuggestion, onPress }: Props) {
  const pulse = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    const looping = Animated.loop(
      Animated.sequence([
        Animated.timing(pulse, { toValue: 1.08, duration: 600, useNativeDriver: true }),
        Animated.timing(pulse, { toValue: 1, duration: 600, useNativeDriver: true }),
      ]),
    );

    if (state === 'listening' || state === 'speaking' || state === 'thinking' || state === 'connecting') {
      looping.start();
    }

    return () => looping.stop();
  }, [pulse, state]);

  return (
    <View pointerEvents="box-none" style={styles.container}>
      <Pressable onPress={onPress}>
        <Animated.View style={[styles.avatar, { backgroundColor: STATE_COLOR[state], transform: [{ scale: pulse }] }]}>
          <Text style={styles.label}>AI</Text>
          {unreadSuggestion && <View style={styles.dot} />}
        </Animated.View>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: 'absolute',
    right: 16,
    bottom: 28,
    zIndex: 100,
  },
  avatar: {
    width: 64,
    height: 64,
    borderRadius: 32,
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#000',
    shadowOpacity: 0.28,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 4 },
    elevation: 8,
  },
  label: {
    color: '#fff',
    fontWeight: '700',
    fontSize: 18,
  },
  dot: {
    position: 'absolute',
    right: 6,
    top: 6,
    width: 10,
    height: 10,
    borderRadius: 5,
    backgroundColor: '#FACC15',
  },
});
