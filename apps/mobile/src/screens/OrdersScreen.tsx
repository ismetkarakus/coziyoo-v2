import React from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  Platform,
  StatusBar,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { theme } from '../theme/colors';

const DEMO_ORDERS = [
  {
    id: '1',
    shop: 'Annem Mutfağı',
    items: 'Kuru Fasulye, Pilav, Ayran',
    total: '₺185,00',
    date: '19 Mar 2026',
    status: 'Teslim Edildi',
    statusColor: '#3E845B',
    statusBg: '#E4F2E7',
  },
  {
    id: '2',
    shop: "Zeynep'in Böreği",
    items: 'Su Böreği (2), Çay',
    total: '₺120,00',
    date: '22 Mar 2026',
    status: 'Hazırlanıyor',
    statusColor: '#B8860B',
    statusBg: '#FFF4E5',
  },
  {
    id: '3',
    shop: 'Hatay Künefe',
    items: 'Künefe (1), Türk Kahvesi',
    total: '₺95,00',
    date: '22 Mar 2026',
    status: 'Yolda',
    statusColor: '#6B4FA2',
    statusBg: '#EDE8F5',
  },
  {
    id: '4',
    shop: 'Adana Sofrası',
    items: 'Adana Kebap, Şalgam, Künefe',
    total: '₺310,00',
    date: '15 Mar 2026',
    status: 'Teslim Edildi',
    statusColor: '#3E845B',
    statusBg: '#E4F2E7',
  },
  {
    id: '5',
    shop: 'Karadeniz Pidesi',
    items: 'Kuşbaşılı Pide, Ayran',
    total: '₺145,00',
    date: '12 Mar 2026',
    status: 'İptal Edildi',
    statusColor: '#C0392B',
    statusBg: '#FDECEC',
  },
];

type Props = {
  onBack: () => void;
};

export default function OrdersScreen({ onBack }: Props) {
  return (
    <View style={styles.container}>
      <StatusBar barStyle="dark-content" backgroundColor={theme.background} />

      <View style={styles.header}>
        <TouchableOpacity onPress={onBack} style={styles.backBtn}>
          <Ionicons name="chevron-back" size={24} color={theme.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Siparişlerim</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {DEMO_ORDERS.map((order) => (
          <View key={order.id} style={styles.orderCard}>
            <View style={styles.orderHeader}>
              <View style={[styles.statusBadge, { backgroundColor: order.statusBg }]}>
                <Text style={[styles.statusText, { color: order.statusColor }]}>{order.status}</Text>
              </View>
              <Text style={styles.orderDate}>{order.date}</Text>
            </View>
            <View style={styles.orderBody}>
              <Text style={styles.orderShop}>{order.shop}</Text>
              <Text style={styles.orderItems}>{order.items}</Text>
            </View>
            <View style={styles.orderFooter}>
              <Text style={styles.orderTotal}>{order.total}</Text>
              <TouchableOpacity style={styles.detailBtn} activeOpacity={0.7}>
                <Text style={styles.detailBtnText}>Detay</Text>
                <Ionicons name="chevron-forward" size={14} color="#5D7394" />
              </TouchableOpacity>
            </View>
          </View>
        ))}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.background },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: Platform.OS === 'ios' ? 56 : 16,
    paddingHorizontal: 16,
    paddingBottom: 12,
    backgroundColor: theme.background,
    borderBottomWidth: 1,
    borderBottomColor: theme.border,
  },
  backBtn: { width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  headerTitle: { color: theme.text, fontSize: 18, fontWeight: '700' },
  content: { padding: 16, paddingBottom: 40, gap: 12 },
  orderCard: {
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#E6DDD3',
    backgroundColor: '#FCFBF9',
    padding: 14,
  },
  orderHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  },
  statusBadge: { borderRadius: 12, paddingHorizontal: 10, paddingVertical: 4 },
  statusText: { fontSize: 12, fontWeight: '700' },
  orderDate: { color: '#9B8E80', fontSize: 12, fontWeight: '500' },
  orderBody: { marginBottom: 10 },
  orderShop: { color: '#332C25', fontSize: 15, fontWeight: '700' },
  orderItems: { color: '#71685F', fontSize: 13, marginTop: 2 },
  orderFooter: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderTopWidth: 1,
    borderTopColor: '#EDE8E1',
    paddingTop: 10,
  },
  orderTotal: { color: '#332C25', fontSize: 16, fontWeight: '800' },
  detailBtn: { flexDirection: 'row', alignItems: 'center', gap: 2 },
  detailBtnText: { color: '#5D7394', fontSize: 13, fontWeight: '600' },
});
