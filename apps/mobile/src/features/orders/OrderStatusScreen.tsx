import React from 'react';
import { FlatList, StyleSheet, Text, View } from 'react-native';
import { getDishById } from '../../domains/catalog/catalogService';
import { useOrderStore } from '../../domains/orders/orderStore';
import { useScreenContextStore } from '../../domains/voice/screenContextStore';

export function OrderStatusScreen() {
  const status = useOrderStore((s) => s.status);
  const items = useOrderStore((s) => s.items);
  const lastPlacedOrderId = useOrderStore((s) => s.lastPlacedOrderId);
  const setContext = useScreenContextStore((s) => s.setContext);

  React.useEffect(() => {
    setContext({
      screenName: 'OrderStatus',
      routeParams: {},
      visibleProducts: items.slice(0, 10).map((item) => {
        const dish = getDishById(item.productId);
        return {
          id: item.productId,
          title: dish?.title ?? item.productId,
        };
      }),
      sessionCapabilities: {
        canPlaceOrder: true,
        hasAddress: false,
        paymentAvailable: false,
      },
    });
  }, [items, setContext]);

  return (
    <View style={styles.root}>
      <Text style={styles.title}>Order Status</Text>
      <Text style={styles.status}>Current: {status.replace('_', ' ')}</Text>
      {lastPlacedOrderId ? <Text style={styles.orderId}>Last order: {lastPlacedOrderId}</Text> : null}
      <FlatList
        data={items}
        keyExtractor={(item) => item.productId}
        ListEmptyComponent={<Text style={styles.empty}>No draft items yet.</Text>}
        renderItem={({ item }) => {
          const dish = getDishById(item.productId);
          return (
            <View style={styles.row}>
              <Text style={styles.itemText}>{dish?.title ?? item.productId}</Text>
              <Text style={styles.itemQty}>x{item.quantity}</Text>
            </View>
          );
        }}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, padding: 16, backgroundColor: '#fff' },
  title: { fontSize: 24, fontWeight: '800', color: '#0F172A', marginBottom: 6 },
  status: { color: '#334155', marginBottom: 4 },
  orderId: { color: '#0F766E', marginBottom: 12 },
  empty: { color: '#94A3B8', marginTop: 14 },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    borderBottomWidth: 1,
    borderBottomColor: '#E2E8F0',
    paddingVertical: 12,
  },
  itemText: { color: '#1E293B', fontWeight: '600' },
  itemQty: { color: '#334155' },
});
