import React, { useEffect, useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  StatusBar,
  Alert,
  Modal,
  Platform,
  Image,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as ImagePicker from 'expo-image-picker';
import { theme } from '../theme/colors';
import { loadSettings } from '../utils/settings';
import { refreshAuthSession, type AuthSession } from '../utils/auth';
import { loadCachedProfileImageUrl, saveCachedProfileImageUrl } from '../utils/profileImage';
import { t } from '../copy/brandCopy';

type UserProfile = {
  id: string;
  email: string;
  displayName: string;
  fullName: string | null;
  userType: string;
  countryCode: string | null;
  phone: string | null;
  dob: string | null;
  profileImageUrl: string | null;
};

type Props = {
  auth: AuthSession;
  onBack: () => void;
  onAuthRefresh?: (session: AuthSession) => void;
};

export default function ProfileEditScreen({ auth, onBack, onAuthRefresh }: Props) {
  const [currentAuth, setCurrentAuth] = useState<AuthSession>(auth);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const [displayName, setDisplayName] = useState('');
  const [fullName, setFullName] = useState('');
  const [phone, setPhone] = useState('');
  const [dob, setDob] = useState('');
  const [tcKimlikNo, setTcKimlikNo] = useState('');
  const [email, setEmail] = useState('');
  const [profileImageUrl, setProfileImageUrl] = useState<string | null>(null);
  const [cachedLocalImageUrl, setCachedLocalImageUrl] = useState<string | null>(null);
  const [profileImageLoadFailed, setProfileImageLoadFailed] = useState(false);
  const [uploadingImage, setUploadingImage] = useState(false);
  const [editField, setEditField] = useState<'displayName' | 'fullName' | 'phone' | 'email' | null>(null);
  const [editValue, setEditValue] = useState('');

  useEffect(() => {
    setCurrentAuth(auth);
  }, [auth]);

  useEffect(() => {
    fetchProfile();
  }, []);

  useEffect(() => {
    setProfileImageLoadFailed(false);
  }, [profileImageUrl]);

  useEffect(() => {
    loadCachedProfileImageUrl().then((cached) => {
      if (!cached) return;
      setCachedLocalImageUrl(cached);
    });
  }, []);

  async function authedFetch(url: string, options?: RequestInit) {
    const response = await fetch(url, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${currentAuth.accessToken}`,
        ...(options?.headers ?? {}),
      },
    });

    if (response.status === 401) {
      const settings = await loadSettings();
      const refreshed = await refreshAuthSession(settings.apiUrl, currentAuth);
      if (refreshed) {
        setCurrentAuth(refreshed);
        onAuthRefresh?.(refreshed);
        return fetch(url, {
          ...options,
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${refreshed.accessToken}`,
            ...(options?.headers ?? {}),
          },
        });
      }
    }

    return response;
  }

  async function fetchProfile() {
    setLoading(true);
    setError(null);
    try {
      const { apiUrl } = await loadSettings();
      const res = await authedFetch(`${apiUrl}/v1/auth/me`);
      const json = await res.json();
      if (!res.ok || json.error) {
        throw new Error(json.error?.message ?? `Hata (${res.status})`);
      }
      const data = json.data as UserProfile;
      setDisplayName(data.displayName ?? '');
      setFullName(data.fullName ?? '');
      setPhone(data.phone ?? '');
      setDob(data.dob ?? '');
      setTcKimlikNo(data.countryCode ?? '');
      setEmail(data.email ?? '');
      setProfileImageUrl(data.profileImageUrl ?? null);
    } catch (e) {
      setError(e instanceof Error ? e.message : t('helper.profileEdit.load'));
    } finally {
      setLoading(false);
    }
  }

  async function handlePickImage() {
    try {
      const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
      if (!permission.granted) {
        Alert.alert(t('helper.profileEdit.permissionTitle'), t('helper.profileEdit.permissionMessage'));
        return;
      }

      const result = await ImagePicker.launchImageLibraryAsync({
        mediaTypes: ['images'],
        allowsEditing: true,
        aspect: [1, 1],
        quality: 0.8,
      });

      if (result.canceled || !result.assets?.[0]) return;

      const asset = result.assets[0];
      const uri = asset.uri;
      const mimeType = asset.mimeType ?? 'image/jpeg';

      setProfileImageUrl(uri);
      setCachedLocalImageUrl(uri);
      await saveCachedProfileImageUrl(uri);

      if (!['image/jpeg', 'image/png', 'image/webp'].includes(mimeType)) {
        Alert.alert('Hata', t('error.profileEdit.imageType'));
        return;
      }

      setUploadingImage(true);

      const { apiUrl } = await loadSettings();

      // 1. Get presigned upload URL
      const urlRes = await authedFetch(`${apiUrl}/v1/auth/me/profile-image/upload-url`, {
        method: 'POST',
        body: JSON.stringify({ contentType: mimeType }),
      });
      const urlJson = await urlRes.json();
      if (!urlRes.ok || urlJson.error) {
        throw new Error(urlJson.error?.message ?? 'Upload URL alınamadı');
      }
      const { uploadUrl, imageUrl } = urlJson.data;

      // 2. Upload image to S3 via presigned URL
      const imageResponse = await fetch(uri);
      const imageBlob = await imageResponse.blob();
      const uploadRes = await fetch(uploadUrl, {
        method: 'PUT',
        headers: { 'Content-Type': mimeType },
        body: imageBlob,
      });
      if (!uploadRes.ok) {
        throw new Error('Resim yüklenemedi');
      }

      // 3. Save image URL to profile
      const saveRes = await authedFetch(`${apiUrl}/v1/auth/me/profile-image`, {
        method: 'PUT',
        body: JSON.stringify({ imageUrl }),
      });
      const saveJson = await saveRes.json();
      if (!saveRes.ok || saveJson.error) {
        throw new Error(saveJson.error?.message ?? 'Profil resmi kaydedilemedi');
      }

      setProfileImageUrl(imageUrl);
    } catch (e) {
      Alert.alert('Hata', e instanceof Error ? e.message : t('error.profileEdit.imageUpload'));
    } finally {
      setUploadingImage(false);
    }
  }

  async function handleSave() {
    if (!displayName.trim() || displayName.trim().length < 3) {
      Alert.alert('Hata', t('error.profileEdit.displayNameMin'));
      return;
    }

    setSaving(true);
    setError(null);
    setSuccess(false);
    try {
      const { apiUrl } = await loadSettings();
      const body: Record<string, string> = {};
      if (displayName.trim()) body.displayName = displayName.trim();
      if (fullName.trim()) body.fullName = fullName.trim();
      if (phone.trim()) body.phone = phone.trim();
      if (dob.trim()) body.dob = dob.trim();
      if (tcKimlikNo.trim()) body.countryCode = tcKimlikNo.trim();
      if (email.trim()) body.email = email.trim();

      const res = await authedFetch(`${apiUrl}/v1/auth/me`, {
        method: 'PUT',
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (!res.ok || json.error) {
        throw new Error(json.error?.message ?? `Hata (${res.status})`);
      }
      const data = json.data as UserProfile;
      setDisplayName(data.displayName ?? '');
      setFullName(data.fullName ?? '');
      setPhone(data.phone ?? '');
      setDob(data.dob ?? '');
      setTcKimlikNo(data.countryCode ?? '');
      setSuccess(true);
      setTimeout(() => setSuccess(false), 2500);
    } catch (e) {
      setError(e instanceof Error ? e.message : t('error.profileEdit.save'));
    } finally {
      setSaving(false);
    }
  }

  function openFieldEditor(field: 'displayName' | 'fullName' | 'phone' | 'email') {
    if (field === 'displayName') setEditValue(displayName);
    if (field === 'fullName') setEditValue(fullName);
    if (field === 'phone') setEditValue(phone);
    if (field === 'email') setEditValue(email);
    setEditField(field);
  }

  function applyFieldEdit() {
    if (!editField) return;
    const next = editValue.trim();
    if (editField === 'displayName') setDisplayName(next);
    if (editField === 'fullName') setFullName(next);
    if (editField === 'phone') setPhone(next);
    if (editField === 'email') setEmail(next);
    setEditField(null);
  }

  function getEditPlaceholder() {
    if (editField === 'fullName') return t('helper.profileEdit.fullNamePlaceholder');
    if (editField === 'phone') return t('helper.profileEdit.phonePlaceholder');
    if (editField === 'email') return t('helper.profileEdit.emailHint');
    return t('helper.profileEdit.displayNamePlaceholder');
  }

  return (
    <View style={styles.container}>
      <StatusBar barStyle="dark-content" backgroundColor={theme.background} />

      {/* Header */}
      <View style={styles.header}>
        <TouchableOpacity onPress={onBack} style={styles.backBtn}>
          <Ionicons name="chevron-back" size={24} color={theme.text} />
        </TouchableOpacity>
        <Text style={styles.headerTitle}>{t('headline.profileEdit.title')}</Text>
        <View style={{ width: 40 }} />
      </View>

      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
          {loading ? (
            <View style={styles.center}>
              <ActivityIndicator size="large" color={theme.primary} />
            </View>
          ) : (
            <>
              {/* Avatar */}
              <View style={styles.avatarSection}>
                <TouchableOpacity
                  style={styles.avatarTouchable}
                  onPress={handlePickImage}
                  disabled={uploadingImage}
                  activeOpacity={0.7}
                >
                  {profileImageUrl && !profileImageLoadFailed ? (
                    <Image
                      source={{ uri: profileImageUrl }}
                      style={styles.avatarImage}
                      onError={() => setProfileImageLoadFailed(true)}
                    />
                  ) : cachedLocalImageUrl ? (
                    <Image source={{ uri: cachedLocalImageUrl }} style={styles.avatarImage} />
                  ) : (
                    <View style={styles.avatar}>
                      <Text style={styles.avatarText}>
                        {displayName ? displayName.charAt(0).toUpperCase() : '?'}
                      </Text>
                    </View>
                  )}
                  <View style={styles.avatarBadge}>
                    {uploadingImage ? (
                      <ActivityIndicator size="small" color="#fff" />
                    ) : (
                      <Ionicons name="camera" size={14} color="#fff" />
                    )}
                  </View>
                </TouchableOpacity>
                <Text style={styles.avatarEmail}>{email}</Text>
              </View>

              <View style={styles.cardsWrap}>
                <View style={styles.infoCard}>
                  <View style={styles.infoHead}>
                    <View style={[styles.infoIconWrap, { backgroundColor: '#3F855C' }]}>
                      <Ionicons name="person" size={18} color="#FFFFFF" />
                    </View>
                    <View style={styles.infoHeadText}>
                      <Text style={styles.infoTitle}>{t('helper.profileEdit.displayNameLabel')}</Text>
                      <Text style={styles.infoSubtitle}>{t('helper.profileEdit.displayNameHint')}</Text>
                    </View>
                    <TouchableOpacity style={styles.editChip} onPress={() => openFieldEditor('displayName')}>
                      <Text style={styles.editChipText}>{t('cta.profileEdit.edit')}</Text>
                    </TouchableOpacity>
                  </View>
                  <View style={styles.infoDivider} />
                  <Text style={styles.infoValue}>{displayName || '-'}</Text>
                </View>

                <View style={styles.infoCard}>
                  <View style={styles.infoHead}>
                    <View style={[styles.infoIconWrap, { backgroundColor: '#DCD2C3' }]}>
                      <Ionicons name="card-outline" size={18} color="#6F604F" />
                    </View>
                    <View style={styles.infoHeadText}>
                      <Text style={styles.infoTitle}>{t('helper.profileEdit.fullNameLabel')}</Text>
                      <Text style={styles.infoSubtitle}>{t('helper.profileEdit.fullNameHint')}</Text>
                    </View>
                    <TouchableOpacity style={styles.editChip} onPress={() => openFieldEditor('fullName')}>
                      <Text style={styles.editChipText}>{t('cta.profileEdit.edit')}</Text>
                    </TouchableOpacity>
                  </View>
                  <View style={styles.infoDivider} />
                  <Text style={styles.infoValue}>{fullName || '-'}</Text>
                </View>

                <View style={styles.infoCard}>
                  <View style={styles.infoHead}>
                    <View style={[styles.infoIconWrap, { backgroundColor: '#8A4FA4' }]}>
                      <Ionicons name="call" size={18} color="#FFFFFF" />
                    </View>
                    <View style={styles.infoHeadText}>
                      <Text style={styles.infoTitle}>{t('helper.profileEdit.phoneLabel')}</Text>
                      <Text style={styles.infoSubtitle}>{t('helper.profileEdit.phoneHint')}</Text>
                    </View>
                    <TouchableOpacity style={styles.editChip} onPress={() => openFieldEditor('phone')}>
                      <Text style={styles.editChipText}>{t('cta.profileEdit.edit')}</Text>
                    </TouchableOpacity>
                  </View>
                  <View style={styles.infoDivider} />
                  <Text style={styles.infoValue}>{phone || t('helper.profileEdit.phonePlaceholder')}</Text>
                </View>

                <View style={styles.infoCard}>
                  <View style={styles.infoHead}>
                    <View style={[styles.infoIconWrap, { backgroundColor: '#9FB6D8' }]}>
                      <Ionicons name="mail" size={18} color="#FFFFFF" />
                    </View>
                    <View style={styles.infoHeadText}>
                      <Text style={styles.infoTitle}>{t('helper.profileEdit.emailLabel')}</Text>
                      <Text style={styles.infoSubtitle}>{t('helper.profileEdit.emailHint')}</Text>
                    </View>
                    <TouchableOpacity style={styles.editChip} onPress={() => openFieldEditor('email')}>
                      <Text style={styles.editChipText}>{t('cta.profileEdit.edit')}</Text>
                    </TouchableOpacity>
                  </View>
                  <View style={styles.infoDivider} />
                  <View style={styles.emailRow}>
                    <Text style={styles.infoValue}>{email}</Text>
                    <View style={styles.verifiedBadge}>
                      <Ionicons name="lock-closed" size={13} color="#3E845B" />
                      <Text style={styles.verifiedBadgeText}>{t('status.profileEdit.verified')}</Text>
                    </View>
                  </View>
                </View>
              </View>

              {error ? (
                <View style={styles.errorBox}>
                  <Ionicons name="alert-circle" size={18} color={theme.error} />
                  <Text style={styles.errorText}>{error}</Text>
                </View>
              ) : null}

              {success ? (
                <View style={styles.successBox}>
                  <Ionicons name="checkmark-circle" size={18} color={theme.primary} />
                  <Text style={styles.successText}>{t('status.profileEdit.saved')}</Text>
                </View>
              ) : null}

              <TouchableOpacity
                style={[styles.saveBtn, saving && styles.saveBtnDisabled]}
                onPress={() => void handleSave()}
                disabled={saving}
                activeOpacity={0.8}
              >
                {saving ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <Text style={styles.saveBtnText}>{t('cta.profileEdit.save')}</Text>
                )}
              </TouchableOpacity>
            </>
          )}
        </ScrollView>

      <Modal
        visible={!!editField}
        transparent
        animationType="fade"
        onRequestClose={() => setEditField(null)}
      >
        <View style={styles.editModalOverlay}>
          <View style={styles.editModalCard}>
            <Text style={styles.editModalTitle}>{t('cta.profileEdit.edit')}</Text>
            <TextInput
              style={styles.editModalInput}
              value={editValue}
              onChangeText={setEditValue}
              placeholder={getEditPlaceholder()}
              placeholderTextColor={theme.textSecondary}
              autoCapitalize={editField === 'phone' || editField === 'email' ? 'none' : 'words'}
              keyboardType={editField === 'phone' ? 'phone-pad' : editField === 'email' ? 'email-address' : 'default'}
              maxLength={editField === 'phone' ? 20 : 120}
              autoFocus
            />
            <View style={styles.editModalActions}>
              <TouchableOpacity style={styles.editModalCancel} onPress={() => setEditField(null)}>
                <Text style={styles.editModalCancelText}>{t('cta.address.cancel')}</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.editModalSave} onPress={applyFieldEdit}>
                <Text style={styles.editModalSaveText}>{t('cta.profileEdit.save')}</Text>
              </TouchableOpacity>
            </View>
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
  content: { padding: 20, paddingBottom: 40 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingTop: 60 },

  avatarSection: { alignItems: 'center', marginBottom: 20 },
  avatarTouchable: { position: 'relative', marginBottom: 12 },
  avatar: {
    width: 112,
    height: 112,
    borderRadius: 36,
    backgroundColor: theme.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarImage: {
    width: 112,
    height: 112,
    borderRadius: 36,
  },
  avatarBadge: {
    position: 'absolute',
    bottom: -4,
    right: -4,
    width: 42,
    height: 42,
    borderRadius: 21,
    backgroundColor: theme.primary,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 3,
    borderColor: theme.background,
  },
  avatarText: { fontSize: 32, fontWeight: '700', color: '#fff' },
  avatarEmail: { color: theme.textSecondary, fontSize: 14 },
  cardsWrap: { gap: 12 },
  infoCard: {
    borderRadius: 18,
    borderWidth: 1,
    borderColor: '#DDD7D0',
    backgroundColor: '#FCFBF9',
    paddingHorizontal: 16,
    paddingVertical: 14,
  },
  infoHead: { flexDirection: 'row', alignItems: 'center' },
  infoIconWrap: {
    width: 40,
    height: 40,
    borderRadius: 12,
    alignItems: 'center',
    justifyContent: 'center',
    marginRight: 12,
  },
  infoHeadText: { flex: 1 },
  infoTitle: { color: '#332C25', fontSize: 18, fontWeight: '700' },
  infoSubtitle: { color: '#71685F', fontSize: 14, marginTop: 2 },
  editChip: {
    backgroundColor: '#EFEBE6',
    borderRadius: 18,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  editChipText: { color: '#4A423A', fontSize: 15, fontWeight: '700' },
  infoDivider: { height: 1, backgroundColor: '#E9E2D9', marginTop: 14, marginBottom: 12 },
  infoValue: { color: '#2F2924', fontSize: 38 / 2, fontWeight: '700' },
  emailRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  verifiedBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#E4F2E7',
    borderRadius: 18,
    paddingHorizontal: 12,
    paddingVertical: 7,
  },
  verifiedBadgeText: { color: '#3E845B', fontSize: 15, fontWeight: '700' },

  errorBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#FDF2F2',
    borderRadius: 12,
    padding: 12,
    marginTop: 16,
  },
  errorText: { color: theme.error, fontSize: 13, flex: 1 },
  successBox: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#F0F7F2',
    borderRadius: 12,
    padding: 12,
    marginTop: 16,
  },
  successText: { color: theme.primary, fontSize: 13, fontWeight: '600' },

  saveBtn: {
    backgroundColor: theme.primary,
    borderRadius: 16,
    paddingVertical: 16,
    alignItems: 'center',
    marginTop: 24,
  },
  saveBtnDisabled: { opacity: 0.6 },
  saveBtnText: { color: '#fff', fontSize: 16, fontWeight: '700' },
  editModalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.3)',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 20,
  },
  editModalCard: {
    width: '100%',
    borderRadius: 16,
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E6DDD3',
    padding: 16,
  },
  editModalTitle: { color: '#332C25', fontSize: 17, fontWeight: '700', marginBottom: 10 },
  editModalInput: {
    borderWidth: 1,
    borderColor: '#DED4C8',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    color: '#322B24',
    fontSize: 16,
  },
  editModalActions: { flexDirection: 'row', justifyContent: 'flex-end', gap: 10, marginTop: 14 },
  editModalCancel: {
    backgroundColor: '#F0ECE6',
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 14,
  },
  editModalCancelText: { color: '#5B5148', fontSize: 14, fontWeight: '600' },
  editModalSave: {
    backgroundColor: theme.primary,
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 14,
  },
  editModalSaveText: { color: '#FFFFFF', fontSize: 14, fontWeight: '700' },
});
