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
  KeyboardAvoidingView,
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
  language: string | null;
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
  const [countryCode, setCountryCode] = useState('');
  const [language, setLanguage] = useState('');
  const [email, setEmail] = useState('');
  const [userType, setUserType] = useState('');
  const [profileImageUrl, setProfileImageUrl] = useState<string | null>(null);
  const [cachedLocalImageUrl, setCachedLocalImageUrl] = useState<string | null>(null);
  const [profileImageLoadFailed, setProfileImageLoadFailed] = useState(false);
  const [uploadingImage, setUploadingImage] = useState(false);

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
      setCountryCode(data.countryCode ?? '');
      setLanguage(data.language ?? '');
      setEmail(data.email ?? '');
      setUserType(data.userType ?? '');
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
        throw new Error(urlJson.error?.message ?? 'Upload URL alinamadi');
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
        throw new Error('Resim yuklenemedi');
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
      if (countryCode.trim()) body.countryCode = countryCode.trim();
      if (language.trim()) body.language = language.trim();

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
      setCountryCode(data.countryCode ?? '');
      setLanguage(data.language ?? '');
      setSuccess(true);
      setTimeout(() => setSuccess(false), 2500);
    } catch (e) {
      setError(e instanceof Error ? e.message : t('error.profileEdit.save'));
    } finally {
      setSaving(false);
    }
  }

  const userTypeLabel = userType === 'buyer'
    ? t('status.profileEdit.buyer')
    : userType === 'seller'
      ? t('status.profileEdit.seller')
      : userType === 'both'
        ? t('status.profileEdit.both')
        : userType;

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

      <KeyboardAvoidingView
        style={{ flex: 1 }}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
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
                <View style={styles.badge}>
                  <Text style={styles.badgeText}>{userTypeLabel}</Text>
                </View>
              </View>

              {/* Form */}
                <View style={styles.form}>
                  <View style={styles.field}>
                  <Text style={styles.label}>{t('helper.profileEdit.displayNameLabel')}</Text>
                  <TextInput
                    style={styles.input}
                    value={displayName}
                    onChangeText={setDisplayName}
                    placeholder={t('helper.profileEdit.displayNamePlaceholder')}
                    placeholderTextColor={theme.textSecondary}
                    autoCapitalize="words"
                    maxLength={40}
                  />
                </View>

                <View style={styles.field}>
                  <Text style={styles.label}>{t('helper.profileEdit.fullNameLabel')}</Text>
                  <TextInput
                    style={styles.input}
                    value={fullName}
                    onChangeText={setFullName}
                    placeholder={t('helper.profileEdit.fullNamePlaceholder')}
                    placeholderTextColor={theme.textSecondary}
                    autoCapitalize="words"
                    maxLength={120}
                  />
                </View>

                <View style={styles.field}>
                  <Text style={styles.label}>{t('helper.profileEdit.phoneLabel')}</Text>
                  <TextInput
                    style={styles.input}
                    value={phone}
                    onChangeText={setPhone}
                    placeholder={t('helper.profileEdit.phonePlaceholder')}
                    placeholderTextColor={theme.textSecondary}
                    keyboardType="phone-pad"
                    maxLength={20}
                  />
                </View>

                <View style={styles.field}>
                  <Text style={styles.label}>{t('helper.profileEdit.dobLabel')}</Text>
                  <TextInput
                    style={styles.input}
                    value={dob}
                    onChangeText={setDob}
                    placeholder={t('helper.profileEdit.dobPlaceholder')}
                    placeholderTextColor={theme.textSecondary}
                    keyboardType="numbers-and-punctuation"
                    maxLength={10}
                  />
                  <Text style={styles.hint}>{t('helper.profileEdit.dobHint')}</Text>
                </View>

                <View style={styles.field}>
                  <Text style={styles.label}>{t('helper.profileEdit.countryLabel')}</Text>
                  <TextInput
                    style={styles.input}
                    value={countryCode}
                    onChangeText={setCountryCode}
                    placeholder={t('helper.profileEdit.countryPlaceholder')}
                    placeholderTextColor={theme.textSecondary}
                    autoCapitalize="characters"
                    maxLength={3}
                  />
                </View>

                <View style={styles.field}>
                  <Text style={styles.label}>{t('helper.profileEdit.languageLabel')}</Text>
                  <TextInput
                    style={styles.input}
                    value={language}
                    onChangeText={setLanguage}
                    placeholder={t('helper.profileEdit.languagePlaceholder')}
                    placeholderTextColor={theme.textSecondary}
                    autoCapitalize="none"
                    maxLength={10}
                  />
                </View>

                <View style={styles.fieldDisabled}>
                  <Text style={styles.label}>{t('helper.profileEdit.emailLabel')}</Text>
                  <View style={styles.inputDisabled}>
                    <Text style={styles.inputDisabledText}>{email}</Text>
                    <Ionicons name="lock-closed-outline" size={16} color={theme.textSecondary} />
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
                onPress={handleSave}
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
      </KeyboardAvoidingView>
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

  avatarSection: { alignItems: 'center', marginBottom: 28 },
  avatarTouchable: { position: 'relative', marginBottom: 12 },
  avatar: {
    width: 80,
    height: 80,
    borderRadius: 26,
    backgroundColor: theme.primary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  avatarImage: {
    width: 80,
    height: 80,
    borderRadius: 26,
  },
  avatarBadge: {
    position: 'absolute',
    bottom: -2,
    right: -2,
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: theme.primary,
    alignItems: 'center',
    justifyContent: 'center',
    borderWidth: 2,
    borderColor: theme.background,
  },
  avatarText: { fontSize: 32, fontWeight: '700', color: '#fff' },
  avatarEmail: { color: theme.textSecondary, fontSize: 14, marginBottom: 6 },
  badge: {
    backgroundColor: theme.buttonPassiveBg,
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 4,
  },
  badgeText: { color: theme.buttonPassiveText, fontSize: 12, fontWeight: '600' },

  form: { gap: 16 },
  field: { gap: 6 },
  fieldDisabled: { gap: 6, opacity: 0.6 },
  label: { color: theme.text, fontSize: 13, fontWeight: '600', marginLeft: 4 },
  input: {
    backgroundColor: theme.surface,
    borderWidth: 1,
    borderColor: theme.border,
    borderRadius: 14,
    paddingHorizontal: 16,
    paddingVertical: 14,
    color: theme.text,
    fontSize: 15,
  },
  inputDisabled: {
    backgroundColor: theme.buttonPassiveBg,
    borderWidth: 1,
    borderColor: theme.border,
    borderRadius: 14,
    paddingHorizontal: 16,
    paddingVertical: 14,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  inputDisabledText: { color: theme.textSecondary, fontSize: 15 },
  hint: { color: theme.textSecondary, fontSize: 11, marginLeft: 4, marginTop: 2 },

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
});
