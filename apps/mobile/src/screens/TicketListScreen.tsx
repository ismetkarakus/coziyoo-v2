import React, { useEffect, useState } from 'react';
import { View, Text, StyleSheet, StatusBar, ScrollView, RefreshControl, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { theme } from '../theme/colors';
import { type AuthSession } from '../utils/auth';
import { apiRequest } from '../utils/api';
import ScreenHeader from '../components/ScreenHeader';
import ActionButton from '../components/ActionButton';

type TicketSummary = {
  id: string;
  ticketNo: number;
  orderId: string;
  category?: string | null;
  categoryName?: string | null;
  status: 'open' | 'in_review' | 'resolved' | 'closed';
  priority: 'low' | 'medium' | 'high' | 'urgent';
  createdAt: string;
  lastActivityAt: string;
};

type Props = {
  auth: AuthSession;
  onBack: () => void;
  onOpenTicket: (ticketId: string) => void;
  onCreateTicket: () => void;
  onAuthRefresh?: (session: AuthSession) => void;
};

function statusLabel(status: TicketSummary['status']) {
  if (status === 'open') return 'Açık';
  if (status === 'in_review') return 'İnceleniyor';
  if (status === 'resolved') return 'Çözüldü';
  return 'Kapandı';
}

function statusColor(status: TicketSummary['status']) {
  if (status === 'open') return '#D87A16';
  if (status === 'in_review') return '#2F6CA6';
  if (status === 'resolved') return '#3E845B';
  return '#6C6258';
}

export default function TicketListScreen({ auth, onBack, onOpenTicket, onCreateTicket, onAuthRefresh }: Props) {
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [tickets, setTickets] = useState<TicketSummary[]>([]);

  async function loadData(showRefresh = false) {
    if (showRefresh) setRefreshing(true);
    else setLoading(true);
    setError(null);
    const result = await apiRequest<TicketSummary[]>(
      '/v1/tickets',
      auth,
      { method: 'GET', actorRole: 'buyer' },
      onAuthRefresh,
    );
    if (result.ok) {
      setTickets(result.data);
    } else {
      setError(result.message ?? 'Ticketlar yüklenemedi.');
    }
    if (showRefresh) setRefreshing(false);
    else setLoading(false);
  }

  useEffect(() => {
    void loadData();
  }, []);

  return (
    <View style={styles.container}>
      <StatusBar barStyle="dark-content" backgroundColor={theme.background} />
      <ScreenHeader title="Destek Ticketları" onBack={onBack} />

      <ScrollView
        style={styles.scroll}
        contentContainerStyle={styles.content}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void loadData(true)} />}
      >
        <View style={styles.topCta}>
          <ActionButton label="Yeni Ticket Aç" onPress={onCreateTicket} variant="primary" fullWidth />
        </View>

        {loading ? <Text style={styles.meta}>Yükleniyor...</Text> : null}
        {error ? <Text style={styles.error}>{error}</Text> : null}

        {!loading && !error && tickets.length === 0 ? (
          <View style={styles.emptyCard}>
            <Ionicons name="chatbubble-ellipses-outline" size={22} color="#8A7D70" />
            <Text style={styles.emptyTitle}>Henüz ticket yok</Text>
            <Text style={styles.emptySub}>Bir sorun olursa siparişinden hızlıca ticket açabilirsin.</Text>
          </View>
        ) : null}

        {tickets.map((item) => (
          <TouchableOpacity key={item.id} style={styles.ticketCard} activeOpacity={0.75} onPress={() => onOpenTicket(item.id)}>
            <View style={styles.ticketHead}>
              <Text style={styles.ticketNo}>#{item.ticketNo}</Text>
              <View style={[styles.badge, { backgroundColor: `${statusColor(item.status)}1A` }]}>
                <Text style={[styles.badgeText, { color: statusColor(item.status) }]}>{statusLabel(item.status)}</Text>
              </View>
            </View>
            <Text style={styles.ticketCategory}>{item.categoryName ?? 'Genel'}</Text>
            <Text style={styles.ticketMeta}>Sipariş: #{item.orderId.slice(0, 8).toUpperCase()}</Text>
            <Text style={styles.ticketMeta}>Son hareket: {new Date(item.lastActivityAt).toLocaleString('tr-TR')}</Text>
          </TouchableOpacity>
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.background },
  scroll: { flex: 1 },
  content: { padding: 16, paddingBottom: 20, gap: 12 },
  topCta: { marginBottom: 4 },
  meta: { color: '#7A6E61', fontSize: 14 },
  error: { color: '#B2432D', fontWeight: '600' },
  emptyCard: {
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#E5DBCF',
    backgroundColor: '#FCFBF9',
    padding: 16,
    alignItems: 'center',
    gap: 6,
  },
  emptyTitle: { fontSize: 16, fontWeight: '700', color: theme.text },
  emptySub: { fontSize: 13, color: '#7D7062', textAlign: 'center' },
  ticketCard: {
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#E5DBCF',
    backgroundColor: '#FFFFFF',
    padding: 14,
    gap: 6,
  },
  ticketHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  ticketNo: { color: theme.text, fontSize: 16, fontWeight: '800' },
  badge: { borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 },
  badgeText: { fontSize: 11, fontWeight: '700' },
  ticketCategory: { color: theme.text, fontSize: 15, fontWeight: '700' },
  ticketMeta: { color: '#7A6E61', fontSize: 13, fontWeight: '500' },
});
