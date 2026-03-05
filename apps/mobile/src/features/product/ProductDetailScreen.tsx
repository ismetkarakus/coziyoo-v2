import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import React, { useMemo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { getDishById } from '../../domains/catalog/catalogService';
import { useOrderStore } from '../../domains/orders/orderStore';
import { useScreenContextStore } from '../../domains/voice/screenContextStore';
import type { RootStackParamList } from '../../types/navigation';

type Props = NativeStackScreenProps<RootStackParamList, 'ProductDetail'>;

export function ProductDetailScreen({ route, navigation }: Props) {
  const productId = route.params.productId;
  const dish = useMemo(() => getDishById(productId), [productId]);
  const addItem = useOrderStore((s) => s.addItem);
  const setContext = useScreenContextStore((s) => s.setContext);

  React.useEffect(() => {
    setContext({
      screenName: 'ProductDetail',
      routeParams: route.params,
      visibleProducts: dish ? [{ id: dish.id, title: dish.title }] : [],
      selectedProductId: dish?.id,
      sessionCapabilities: {
        canPlaceOrder: true,
        hasAddress: false,
        paymentAvailable: false,
      },
    });
  }, [dish, route.params, setContext]);

  if (!dish) {
    return (
      <View style={styles.root}>
        <Text style={styles.title}>Dish not found</Text>
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <Text style={styles.title}>{dish.title}</Text>
      <Text style={styles.meta}>{dish.category} • £{dish.price.toFixed(2)}</Text>
      <Text style={styles.description}>{dish.description}</Text>
      <Text style={styles.meta}>Availability: {dish.availability}</Text>
      <Pressable
        style={styles.button}
        onPress={() => {
          addItem(dish.id, 1);
          navigation.navigate('OrderStatus');
        }}
      >
        <Text style={styles.buttonText}>Add To Draft Order</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#fff', padding: 16, gap: 10 },
  title: { fontSize: 26, fontWeight: '800', color: '#0F172A' },
  meta: { color: '#475569' },
  description: { color: '#334155', lineHeight: 22 },
  button: {
    marginTop: 14,
    backgroundColor: '#0F172A',
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: 'center',
  },
  buttonText: { color: '#fff', fontWeight: '700' },
});
