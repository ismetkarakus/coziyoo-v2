import React, { useCallback, useEffect, useState } from 'react';
import { View, FlatList, StyleSheet, StatusBar, RefreshControl } from 'react-native';
import { theme } from '../theme/colors';
import { type AuthSession } from '../utils/auth';
import { apiRequest } from '../utils/api';
import ScreenHeader from '../components/ScreenHeader';
import OrderCard, { type OrderSummary } from '../components/OrderCard';
import LoadingState from '../components/LoadingState';
import ErrorState from '../components/ErrorState';
import EmptyState from '../components/EmptyState';

type ApiOrder = {
  id: string;
  buyerId: string;
  sellerId: string;
  status: string;
  deliveryType: 'pickup' | 'delivery';
  deliveryAddress: unknown;
  totalPrice: number;
  createdAt: string;
  sellerName: string;
  sellerImage: string | null;
  buyerName: string;
  items: { name: string; quantity: number; unitPrice: number; lineTotal: number }[];
};

type Props = {
  auth: AuthSession;
  onBack: () => void;
  onOpenOrderDetail: (orderId: string) => void;
  onAuthRefresh?: (session: AuthSession) => void;
};

export default function OrdersScreen({ auth, onBack, onOpenOrderDetail, onAuthRefresh }: Props) {
  const [orders, setOrders] = useState<OrderSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const fetchOrders = useCallback(async (isRefresh = false) => {
    if (!isRefresh) setLoading(true);
    setError(null);

    const result = await apiRequest<ApiOrder[]>(
      '/v1/orders?pageSize=50&sortDir=desc',
      auth,
      { actorRole: 'buyer' },
      onAuthRefresh,
    );

    if (result.ok) {
      setOrders(
        (result.data as unknown as ApiOrder[]).map((o: ApiOrder) => ({
          id: o.id,
          status: o.status,
          sellerName: o.sellerName ?? 'Satıcı',
          items: o.items.map((i) => ({ name: i.name, quantity: i.quantity })),
          totalPrice: o.totalPrice,
          createdAt: o.createdAt,
          deliveryType: o.deliveryType,
        }))
      );
    } else {
      setError(result.message ?? 'Siparişler yüklenemedi');
    }

    setLoading(false);
    setRefreshing(false);
  }, [auth, onAuthRefresh]);

  useEffect(() => { fetchOrders(); }, [fetchOrders]);

  const handleRefresh = () => {
    setRefreshing(true);
    fetchOrders(true);
  };

  return (
    <View style={styles.container}>
      <StatusBar barStyle="dark-content" backgroundColor={theme.background} />
      <ScreenHeader title="Siparişlerim" onBack={onBack} />

      {loading ? (
        <LoadingState message="Siparişler yükleniyor..." />
      ) : error ? (
        <ErrorState message={error} onRetry={() => fetchOrders()} />
      ) : orders.length === 0 ? (
        <EmptyState
          icon="receipt-outline"
          title="Henüz siparişin yok"
          subtitle="Sipariş verdiğinde burada görünecek."
        />
      ) : (
        <FlatList
          data={orders}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.list}
          showsVerticalScrollIndicator={false}
          refreshControl={
            <RefreshControl refreshing={refreshing} onRefresh={handleRefresh} tintColor={theme.primary} />
          }
          renderItem={({ item }) => (
            <OrderCard order={item} onPress={() => onOpenOrderDetail(item.id)} />
          )}
          ItemSeparatorComponent={() => <View style={styles.sep} />}
        />
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.background },
  list: { padding: 16, paddingBottom: 40 },
  sep: { height: 12 },
});
