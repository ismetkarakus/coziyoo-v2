import React from 'react';
import { View, TouchableOpacity, StyleSheet } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { theme } from '../theme/colors';

type Props = {
  rating: number;
  onChange?: (value: number) => void;
  size?: number;
  maxStars?: number;
};

export default function StarRating({ rating, onChange, size = 28, maxStars = 5 }: Props) {
  const interactive = !!onChange;

  return (
    <View style={styles.container}>
      {Array.from({ length: maxStars }, (_, i) => {
        const starNum = i + 1;
        const filled = starNum <= rating;
        const half = !filled && starNum - 0.5 <= rating;
        const iconName = filled ? 'star' : half ? 'star-half' : 'star-outline';

        const star = (
          <Ionicons
            key={i}
            name={iconName}
            size={size}
            color={theme.starGold}
            style={styles.star}
          />
        );

        if (interactive) {
          return (
            <TouchableOpacity key={i} onPress={() => onChange(starNum)} activeOpacity={0.6}>
              {star}
            </TouchableOpacity>
          );
        }
        return star;
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flexDirection: 'row', alignItems: 'center' },
  star: { marginRight: 4 },
});
