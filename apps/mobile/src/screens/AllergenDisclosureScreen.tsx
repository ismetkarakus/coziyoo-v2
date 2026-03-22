import React, { useCallback, useEffect, useState } from 'react';
import { View, Text, ScrollView, StyleSheet, StatusBar, Alert } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { theme } from '../theme/colors';
import { type AuthSession } from '../utils/auth';
import { apiRequest } from '../utils/api';
import ScreenHeader from '../components/ScreenHeader';
import ActionButton from '../components/ActionButton';
import LoadingState from '../components/LoadingState';

type AllergenRecord = {
  id: string;
  phase: 'pre_order' | 'handover';
  allergenSnapshotJson: unknown;
  disclosureMethod: string;
  buyerConfirmation: string;
  createdAt: string;
};

type Props = {
  auth: AuthSession;
  orderId: string;
  onBack: () => void;
  onAuthRefresh?: (session: AuthSession) => void;
};

export default function AllergenDisclosureScreen({ auth, orderId, onBack, onAuthRefresh }: Props) {
  const [records, setRecords] = useState<AllergenRecord[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);

  const fetchRecords = useCallback(async () => {
    setLoading(true);
    const result = await apiRequest<AllergenRecord[]>(
      `/v1/orders/${orderId}/allergen-disclosure`,
      auth,
      { actorRole: 'buyer' },
      onAuthRefresh,
    );
    if (result.ok) {
      setRecords(Array.isArray(result.data) ? result.data : []);
    }
    setLoading(false);
  }, [orderId, auth, onAuthRefresh]);

  useEffect(() => { fetchRecords(); }, [fetchRecords]);

  const hasPreOrder = records.some((r) => r.phase === 'pre_order');

  async function handleAcknowledge() {
    setSubmitting(true);
    const result = await apiRequest(
      `/v1/orders/${orderId}/allergen-disclosure/pre-order`,
      auth,
      {
        method: 'POST',
        body: {
          allergenSnapshot: {},
          disclosureMethod: 'ui_ack',
          buyerConfirmation: 'acknowledged',
        },
        actorRole: 'buyer',
      },
      onAuthRefresh,
    );
    setSubmitting(false);
    if (result.ok) {
      Alert.alert('Onaylandı', 'Alerjen bildirimi kaydedildi.');
      fetchRecords();
    } else {
      Alert.alert('Hata', result.message ?? 'İşlem başarısız');
    }
  }

  async function handleRefuse() {
    setSubmitting(true);
    const result = await apiRequest(
      `/v1/orders/${orderId}/allergen-disclosure/pre-order`,
      auth,
      {
        method: 'POST',
        body: {
          allergenSnapshot: {},
          disclosureMethod: 'ui_ack',
          buyerConfirmation: 'refused',
        },
        actorRole: 'buyer',
      },
      onAuthRefresh,
    );
    setSubmitting(false);
    if (result.ok) {
      Alert.alert('Kaydedildi', 'Alerjen bildirimini reddettin.');
      fetchRecords();
    } else {
      Alert.alert('Hata', result.message ?? 'İşlem başarısız');
    }
  }

  return (
    <View style={styles.container}>
      <StatusBar barStyle="dark-content" backgroundColor={theme.background} />
      <ScreenHeader title="Alerjen Bildirimi" onBack={onBack} />

      {loading ? (
        <LoadingState message="Yükleniyor..." />
      ) : (
        <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
          {/* Warning Card */}
          <View style={styles.warningCard}>
            <View style={styles.warningIcon}>
              <Ionicons name="warning" size={28} color="#D4740B" />
            </View>
            <Text style={styles.warningTitle}>Alerjen Uyarısı</Text>
            <Text style={styles.warningText}>
              Bu siparişi tamamlayabilmek için alerjen bildirimini onaylaman gerekiyor.
              Eğer herhangi bir alerjenin varsa lütfen satıcıyla iletişime geç.
            </Text>
          </View>

          {/* Existing Records */}
          {records.length > 0 && (
            <View style={styles.recordsCard}>
              <Text style={styles.recordsTitle}>Mevcut Kayıtlar</Text>
              {records.map((r) => (
                <View key={r.id} style={styles.recordRow}>
                  <View style={styles.recordDot}>
                    <Ionicons
                      name={r.buyerConfirmation === 'acknowledged' ? 'checkmark-circle' : 'close-circle'}
                      size={18}
                      color={r.buyerConfirmation === 'acknowledged' ? '#3E845B' : '#C0392B'}
                    />
                  </View>
                  <View style={styles.recordBody}>
                    <Text style={styles.recordPhase}>
                      {r.phase === 'pre_order' ? 'Sipariş Öncesi' : 'Teslim Anı'}
                    </Text>
                    <Text style={styles.recordStatus}>
                      {r.buyerConfirmation === 'acknowledged' ? 'Onaylandı' : 'Reddedildi'}
                    </Text>
                  </View>
                </View>
              ))}
            </View>
          )}

          {/* Action Buttons */}
          {!hasPreOrder && (
            <View style={styles.actions}>
              <ActionButton
                label="Okudum, Onaylıyorum"
                onPress={handleAcknowledge}
                loading={submitting}
                variant="primary"
                fullWidth
              />
              <ActionButton
                label="Kabul Etmiyorum"
                onPress={handleRefuse}
                loading={submitting}
                variant="danger"
                fullWidth
              />
            </View>
          )}
        </ScrollView>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.background },
  content: { padding: 16, paddingBottom: 40 },
  warningCard: {
    backgroundColor: '#FFFBF0',
    borderRadius: 16,
    borderWidth: 1.5,
    borderColor: '#F5D8A0',
    padding: 20,
    alignItems: 'center',
    marginBottom: 16,
  },
  warningIcon: { marginBottom: 10 },
  warningTitle: { color: '#D4740B', fontSize: 18, fontWeight: '800', marginBottom: 8 },
  warningText: { color: '#71685F', fontSize: 14, lineHeight: 22, textAlign: 'center' },
  recordsCard: {
    backgroundColor: '#FCFBF9',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#E6DDD3',
    padding: 16,
    marginBottom: 16,
  },
  recordsTitle: { color: theme.text, fontSize: 16, fontWeight: '700', marginBottom: 12 },
  recordRow: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 8 },
  recordDot: {},
  recordBody: { flex: 1 },
  recordPhase: { color: theme.text, fontSize: 14, fontWeight: '600' },
  recordStatus: { color: '#71685F', fontSize: 12, marginTop: 2 },
  actions: { gap: 10 },
});
