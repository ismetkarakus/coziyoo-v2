import type { NativeStackScreenProps } from '@react-navigation/native-stack';
import React, { useEffect, useMemo, useState } from 'react';
import { FlatList, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';
import { queryDishes } from '../../domains/catalog/catalogService';
import type { Dish } from '../../domains/catalog/types';
import { useOrderStore } from '../../domains/orders/orderStore';
import { useScreenContextStore } from '../../domains/voice/screenContextStore';
import type { RootStackParamList } from '../../types/navigation';

type Props = NativeStackScreenProps<RootStackParamList, 'Home'>;

const CATEGORIES: Array<Dish['category'] | 'All'> = ['All', 'Breakfast', 'Lunch', 'Dinner', 'Dessert'];

export function HomeScreen({ navigation }: Props) {
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState<Dish['category'] | 'All'>('All');
  const highlighted = useOrderStore((s) => s.highlightedProductId);
  const setContext = useScreenContextStore((s) => s.setContext);

  const dishes = useMemo(() => queryDishes(search, category), [category, search]);

  useEffect(() => {
    setContext({
      screenName: 'Home',
      routeParams: {},
      visibleProducts: dishes.slice(0, 10).map((dish) => ({ id: dish.id, title: dish.title })),
      sessionCapabilities: {
        canPlaceOrder: true,
        hasAddress: false,
        paymentAvailable: false,
      },
    });
  }, [dishes, setContext]);

  return (
    <View style={styles.root}>
      <Text style={styles.title}>Home-Made Dishes</Text>
      <Text style={styles.subtitle}>Browse manually or talk to the assistant avatar.</Text>
      <TextInput
        style={styles.search}
        value={search}
        onChangeText={setSearch}
        placeholder="Search dishes"
        placeholderTextColor="#9CA3AF"
      />
      <View style={styles.categoryRow}>
        {CATEGORIES.map((cat) => (
          <Pressable
            key={cat}
            onPress={() => setCategory(cat)}
            style={[styles.chip, category === cat && styles.chipActive]}
          >
            <Text style={[styles.chipText, category === cat && styles.chipTextActive]}>{cat}</Text>
          </Pressable>
        ))}
      </View>
      <FlatList
        data={dishes}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.list}
        renderItem={({ item }) => (
          <Pressable
            style={[styles.card, highlighted === item.id && styles.highlightedCard]}
            onPress={() => navigation.navigate('ProductDetail', { productId: item.id })}
          >
            <View>
              <Text style={styles.cardTitle}>{item.title}</Text>
              <Text style={styles.cardMeta}>{item.category} • £{item.price.toFixed(2)}</Text>
              <Text style={styles.cardDesc}>{item.description}</Text>
            </View>
            <Text style={[styles.availability, item.availability === 'sold_out' && styles.soldOut]}>{item.availability}</Text>
          </Pressable>
        )}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#F8FAFC', paddingHorizontal: 16, paddingTop: 16 },
  title: { fontSize: 26, fontWeight: '800', color: '#0F172A' },
  subtitle: { color: '#334155', marginTop: 4, marginBottom: 12 },
  search: {
    borderWidth: 1,
    borderColor: '#CBD5E1',
    backgroundColor: '#fff',
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  categoryRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 12, marginBottom: 8 },
  chip: { paddingHorizontal: 12, paddingVertical: 8, borderRadius: 999, backgroundColor: '#E2E8F0' },
  chipActive: { backgroundColor: '#0F172A' },
  chipText: { color: '#1E293B', fontWeight: '600' },
  chipTextActive: { color: '#fff' },
  list: { paddingBottom: 100, gap: 10 },
  card: {
    backgroundColor: '#fff',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    padding: 14,
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: 12,
  },
  highlightedCard: { borderColor: '#F59E0B', borderWidth: 2 },
  cardTitle: { fontSize: 17, fontWeight: '700', color: '#0F172A' },
  cardMeta: { color: '#475569', marginTop: 2 },
  cardDesc: { color: '#64748B', marginTop: 6, maxWidth: 240 },
  availability: { textTransform: 'capitalize', color: '#059669', fontWeight: '700' },
  soldOut: { color: '#B91C1C' },
});
