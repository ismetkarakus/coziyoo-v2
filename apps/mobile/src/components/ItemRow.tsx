import React from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { theme } from '../theme/colors';

type Props = {
  name: string;
  quantity: number;
  price: string;
};

export default function ItemRow({ name, quantity, price }: Props) {
  return (
    <View style={styles.row}>
      <Text style={styles.name}>{quantity}x {name}</Text>
      <Text style={styles.price}>{price}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 6,
  },
  name: { color: theme.text, fontSize: 14, fontWeight: '500', flex: 1, marginRight: 8 },
  price: { color: '#71685F', fontSize: 14, fontWeight: '600' },
});
