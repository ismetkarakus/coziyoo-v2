import React, { useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  Platform,
  StatusBar,
  Modal,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { theme } from '../theme/colors';

type DemoOrder = {
  id: string;
  shop: string;
  items: { name: string; qty: number; price: string }[];
  total: string;
  date: string;
  status: string;
  statusColor: string;
  statusBg: string;
  address: string;
  orderNo: string;
};

const DEMO_ORDERS: DemoOrder[] = [
  {
    id: '1',
    orderNo: 'CZY-20260319-001',
    shop: 'Annem Mutfağı',
    items: [
      { name: 'Kuru Fasulye', qty: 1, price: '₺85,00' },
      { name: 'Pilav', qty: 1, price: '₺45,00' },
      { name: 'Ayran', qty: 2, price: '₺27,50' },
    ],
    total: '₺185,00',
    date: '19 Mar 2026',
    status: 'Teslim Edildi',
    statusColor: '#3E845B',
    statusBg: '#E4F2E7',
    address: 'Kadıköy, Caferağa Mah. Moda Cad. No:12/A',
  },
  {
    id: '2',
    orderNo: 'CZY-20260322-002',
    shop: "Zeynep'in Böreği",
    items: [
      { name: 'Su Böreği', qty: 2, price: '₺50,00' },
      { name: 'Çay', qty: 1, price: '₺20,00' },
    ],
    total: '₺120,00',
    date: '22 Mar 2026',
    status: 'Hazırlanıyor',
    statusColor: '#B8860B',
    statusBg: '#FFF4E5',
    address: 'Beşiktaş, Sinanpaşa Mah. Çırağan Cad. No:5',
  },
  {
    id: '3',
    orderNo: 'CZY-20260322-003',
    shop: 'Hatay Künefe',
    items: [
      { name: 'Künefe', qty: 1, price: '₺65,00' },
      { name: 'Türk Kahvesi', qty: 1, price: '₺30,00' },
    ],
    total: '₺95,00',
    date: '22 Mar 2026',
    status: 'Yolda',
    statusColor: '#6B4FA2',
    statusBg: '#EDE8F5',
    address: 'Üsküdar, Altunizade Mah. Kısıklı Cad. No:8',
  },
  {
    id: '4',
    orderNo: 'CZY-20260315-004',
    shop: 'Adana Sofrası',
    items: [
      { name: 'Adana Kebap', qty: 1, price: '₺180,00' },
      { name: 'Şalgam', qty: 1, price: '₺25,00' },
      { name: 'Künefe', qty: 1, price: '₺105,00' },
    ],
    total: '₺310,00',
    date: '15 Mar 2026',
    status: 'Teslim Edildi',
    statusColor: '#3E845B',
    statusBg: '#E4F2E7',
    address: 'Şişli, Mecidiyeköy Mah. Büyükdere Cad. No:22',
  },
  {
    id: '5',
    orderNo: 'CZY-20260312-005',
    shop: 'Karadeniz Pidesi',
    items: [
      { name: 'Kuşbaşılı Pide', qty: 1, price: '₺120,00' },
      { name: 'Ayran', qty: 1, price: '₺25,00' },
    ],
    total: '₺145,00',
    date: '12 Mar 2026',
    status: 'İptal Edildi',
    statusColor: '#C0392B',
    statusBg: '#FDECEC',
    address: 'Bakırköy, Ataköy 7-8-9-10. Kısım Mah.',
  },
];

type Props = {
  onBack: () => void;
};

export default function OrdersScreen({ onBack }: Props) {
  const [selectedOrder, setSelectedOrder] = useState<DemoOrder | null>(null);

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
              <Text style={styles.orderItemsSummary}>
                {order.items.map((i) => i.name).join(', ')}
              </Text>
            </View>
            <View style={styles.orderFooter}>
              <Text style={styles.orderTotal}>{order.total}</Text>
              <TouchableOpacity
                style={styles.detailBtn}
                activeOpacity={0.7}
                onPress={() => setSelectedOrder(order)}
              >
                <Text style={styles.detailBtnText}>Detay</Text>
                <Ionicons name="chevron-forward" size={14} color="#5D7394" />
              </TouchableOpacity>
            </View>
          </View>
        ))}
      </ScrollView>

      {/* Sipariş Detay Modal */}
      <Modal
        visible={!!selectedOrder}
        transparent
        animationType="slide"
        onRequestClose={() => setSelectedOrder(null)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <View style={styles.modalHandle} />

            {selectedOrder && (
              <ScrollView showsVerticalScrollIndicator={false}>
                {/* Başlık ve Kapat */}
                <View style={styles.modalHeader}>
                  <Text style={styles.modalTitle}>Sipariş Detayı</Text>
                  <TouchableOpacity onPress={() => setSelectedOrder(null)} style={styles.modalCloseBtn}>
                    <Ionicons name="close" size={22} color="#71685F" />
                  </TouchableOpacity>
                </View>

                {/* Durum + Sipariş No */}
                <View style={styles.modalStatusRow}>
                  <View style={[styles.statusBadge, { backgroundColor: selectedOrder.statusBg }]}>
                    <Text style={[styles.statusText, { color: selectedOrder.statusColor }]}>
                      {selectedOrder.status}
                    </Text>
                  </View>
                  <Text style={styles.modalOrderNo}>{selectedOrder.orderNo}</Text>
                </View>

                {/* Dükkan */}
                <View style={styles.modalSection}>
                  <View style={styles.modalSectionHeader}>
                    <Ionicons name="storefront-outline" size={16} color="#71685F" />
                    <Text style={styles.modalSectionLabel}>Satıcı</Text>
                  </View>
                  <Text style={styles.modalSectionValue}>{selectedOrder.shop}</Text>
                </View>

                {/* Ürünler */}
                <View style={styles.modalSection}>
                  <View style={styles.modalSectionHeader}>
                    <Ionicons name="fast-food-outline" size={16} color="#71685F" />
                    <Text style={styles.modalSectionLabel}>Ürünler</Text>
                  </View>
                  {selectedOrder.items.map((item, idx) => (
                    <View key={idx} style={styles.modalItemRow}>
                      <Text style={styles.modalItemName}>
                        {item.qty}x {item.name}
                      </Text>
                      <Text style={styles.modalItemPrice}>{item.price}</Text>
                    </View>
                  ))}
                  <View style={styles.modalTotalRow}>
                    <Text style={styles.modalTotalLabel}>Toplam</Text>
                    <Text style={styles.modalTotalValue}>{selectedOrder.total}</Text>
                  </View>
                </View>

                {/* Teslimat Adresi */}
                <View style={styles.modalSection}>
                  <View style={styles.modalSectionHeader}>
                    <Ionicons name="location-outline" size={16} color="#71685F" />
                    <Text style={styles.modalSectionLabel}>Teslimat Adresi</Text>
                  </View>
                  <Text style={styles.modalSectionValue}>{selectedOrder.address}</Text>
                </View>

                {/* Tarih */}
                <View style={styles.modalSection}>
                  <View style={styles.modalSectionHeader}>
                    <Ionicons name="calendar-outline" size={16} color="#71685F" />
                    <Text style={styles.modalSectionLabel}>Sipariş Tarihi</Text>
                  </View>
                  <Text style={styles.modalSectionValue}>{selectedOrder.date}</Text>
                </View>
              </ScrollView>
            )}
          </View>
        </View>
      </Modal>
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
  orderItemsSummary: { color: '#71685F', fontSize: 13, marginTop: 2 },
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

  // Modal
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.35)',
    justifyContent: 'flex-end',
  },
  modalCard: {
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 24,
    borderTopRightRadius: 24,
    paddingHorizontal: 20,
    paddingBottom: Platform.OS === 'ios' ? 40 : 24,
    maxHeight: '85%',
  },
  modalHandle: {
    width: 40,
    height: 4,
    borderRadius: 2,
    backgroundColor: '#D5CFC7',
    alignSelf: 'center',
    marginTop: 12,
    marginBottom: 16,
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 16,
  },
  modalTitle: { color: '#332C25', fontSize: 20, fontWeight: '800' },
  modalCloseBtn: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#F2EDE6',
    alignItems: 'center',
    justifyContent: 'center',
  },
  modalStatusRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 20,
  },
  modalOrderNo: { color: '#9B8E80', fontSize: 12, fontWeight: '500' },
  modalSection: {
    marginBottom: 18,
    borderBottomWidth: 1,
    borderBottomColor: '#F0EBE4',
    paddingBottom: 16,
  },
  modalSectionHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    marginBottom: 8,
  },
  modalSectionLabel: { color: '#71685F', fontSize: 13, fontWeight: '600' },
  modalSectionValue: { color: '#332C25', fontSize: 15, fontWeight: '600' },
  modalItemRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 6,
  },
  modalItemName: { color: '#332C25', fontSize: 14, fontWeight: '500' },
  modalItemPrice: { color: '#71685F', fontSize: 14, fontWeight: '600' },
  modalTotalRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderTopWidth: 1,
    borderTopColor: '#EDE8E1',
    marginTop: 8,
    paddingTop: 10,
  },
  modalTotalLabel: { color: '#332C25', fontSize: 15, fontWeight: '700' },
  modalTotalValue: { color: '#332C25', fontSize: 18, fontWeight: '800' },
});
