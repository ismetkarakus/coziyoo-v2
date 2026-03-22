import React, { useState } from 'react';
import { View, Text, ScrollView, StyleSheet, StatusBar, Alert, TouchableOpacity } from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { theme } from '../theme/colors';
import { type AuthSession } from '../utils/auth';
import { apiRequest } from '../utils/api';
import ScreenHeader from '../components/ScreenHeader';
import TextInputField from '../components/TextInputField';
import ActionButton from '../components/ActionButton';

const CATEGORIES = [
  { id: 'food_quality', label: 'Yemek kalitesi', icon: 'fast-food-outline' as const },
  { id: 'delivery', label: 'Teslimat sorunu', icon: 'car-outline' as const },
  { id: 'hygiene', label: 'Hijyen', icon: 'medkit-outline' as const },
  { id: 'wrong_order', label: 'Yanlış sipariş', icon: 'swap-horizontal-outline' as const },
  { id: 'seller_behavior', label: 'Satıcı davranışı', icon: 'person-outline' as const },
  { id: 'other', label: 'Diğer', icon: 'ellipsis-horizontal-outline' as const },
];

type Props = {
  auth: AuthSession;
  orderId: string;
  onBack: () => void;
  onAuthRefresh?: (session: AuthSession) => void;
};

export default function ComplaintScreen({ auth, orderId, onBack, onAuthRefresh }: Props) {
  const [selectedCategory, setSelectedCategory] = useState<string | null>(null);
  const [description, setDescription] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);

  async function handleSubmit() {
    if (!selectedCategory) {
      Alert.alert('Kategori seç', 'Lütfen bir şikayet kategorisi seç.');
      return;
    }
    if (description.trim().length < 10) {
      Alert.alert('Açıklama yaz', 'Şikayetini en az 10 karakter ile açıkla.');
      return;
    }
    setSubmitting(true);
    const result = await apiRequest(
      '/v1/complaints',
      auth,
      {
        method: 'POST',
        body: {
          orderId,
          category: selectedCategory,
          description: description.trim(),
        },
        actorRole: 'buyer',
      },
      onAuthRefresh,
    );
    setSubmitting(false);
    if (result.ok) {
      setSubmitted(true);
    } else {
      Alert.alert('Hata', result.message ?? 'Şikayet gönderilemedi');
    }
  }

  if (submitted) {
    return (
      <View style={styles.container}>
        <StatusBar barStyle="dark-content" backgroundColor={theme.background} />
        <ScreenHeader title="Şikayet" onBack={onBack} />
        <View style={styles.successCenter}>
          <View style={styles.successIcon}>
            <Ionicons name="checkmark-circle" size={56} color="#3E845B" />
          </View>
          <Text style={styles.successTitle}>Şikayetin Alındı</Text>
          <Text style={styles.successSub}>En kısa sürede incelenecek. Teşekkürler.</Text>
          <ActionButton label="Geri Dön" onPress={onBack} variant="primary" />
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <StatusBar barStyle="dark-content" backgroundColor={theme.background} />
      <ScreenHeader title="Şikayet Oluştur" onBack={onBack} />

      <ScrollView contentContainerStyle={styles.content} showsVerticalScrollIndicator={false}>
        {/* Category Selection */}
        <Text style={styles.sectionTitle}>Şikayet Kategorisi</Text>
        <View style={styles.categoryGrid}>
          {CATEGORIES.map((cat) => {
            const selected = selectedCategory === cat.id;
            return (
              <TouchableOpacity
                key={cat.id}
                style={[styles.categoryCard, selected && styles.categoryCardSelected]}
                activeOpacity={0.7}
                onPress={() => setSelectedCategory(cat.id)}
              >
                <View style={[styles.categoryIcon, selected && styles.categoryIconSelected]}>
                  <Ionicons name={cat.icon} size={22} color={selected ? '#FFFFFF' : '#71685F'} />
                </View>
                <Text style={[styles.categoryLabel, selected && styles.categoryLabelSelected]}>
                  {cat.label}
                </Text>
              </TouchableOpacity>
            );
          })}
        </View>

        {/* Description */}
        <View style={styles.descCard}>
          <TextInputField
            label="Açıklama"
            value={description}
            onChangeText={setDescription}
            placeholder="Yaşadığın sorunu detaylıca anlat..."
            multiline
            numberOfLines={5}
            maxLength={2000}
          />
        </View>

        <ActionButton
          label="Şikayeti Gönder"
          onPress={handleSubmit}
          loading={submitting}
          disabled={!selectedCategory || description.trim().length < 10}
          variant="primary"
          fullWidth
        />
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: theme.background },
  content: { padding: 16, paddingBottom: 40 },
  sectionTitle: { color: theme.text, fontSize: 16, fontWeight: '700', marginBottom: 12 },
  categoryGrid: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginBottom: 20 },
  categoryCard: {
    width: '47%',
    backgroundColor: '#FCFBF9',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#E6DDD3',
    padding: 14,
    alignItems: 'center',
    gap: 8,
  },
  categoryCardSelected: { borderColor: theme.primary, backgroundColor: '#F0F7F2' },
  categoryIcon: {
    width: 42,
    height: 42,
    borderRadius: 12,
    backgroundColor: '#F0ECE6',
    alignItems: 'center',
    justifyContent: 'center',
  },
  categoryIconSelected: { backgroundColor: theme.primary },
  categoryLabel: { color: '#71685F', fontSize: 13, fontWeight: '600', textAlign: 'center' },
  categoryLabelSelected: { color: theme.primary, fontWeight: '700' },
  descCard: {
    backgroundColor: '#FCFBF9',
    borderRadius: 16,
    borderWidth: 1,
    borderColor: '#E6DDD3',
    padding: 16,
    marginBottom: 16,
  },
  successCenter: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32, gap: 10 },
  successIcon: {
    width: 88,
    height: 88,
    borderRadius: 44,
    backgroundColor: '#E4F2E7',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 8,
  },
  successTitle: { color: theme.text, fontSize: 22, fontWeight: '800' },
  successSub: { color: '#71685F', fontSize: 14, marginBottom: 12 },
});
