import React, { useState } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  StatusBar,
  SafeAreaView,
  Modal,
  Alert,
} from 'react-native';
import { saveAuthSession, type AuthSession } from '../utils/auth';
import { loadSettings } from '../utils/settings';
import { theme } from '../theme/colors';
import { t } from '../copy/brandCopy';

type Props = {
  onLogin: (session: AuthSession) => void;
  onGoToRegister?: () => void;
};

type LoginResponse = {
  data?: {
    user?: { id?: string; email?: string; userType?: string };
    tokens?: { accessToken?: string; refreshToken?: string };
  };
  error?: { code?: string; message?: string };
};

type ExpoLocationModule = {
  requestForegroundPermissionsAsync: () => Promise<{ status: string }>;
  getCurrentPositionAsync: (options: { accuracy?: number }) => Promise<{
    coords: { latitude: number; longitude: number; accuracy?: number | null };
  }>;
  Accuracy?: { Balanced?: number };
};

function loadExpoLocationModule(): ExpoLocationModule | null {
  try {
    return require('expo-location') as ExpoLocationModule;
  } catch {
    return null;
  }
}

export default function LoginScreen({ onLogin, onGoToRegister }: Props) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Forgot password state
  const [forgotModal, setForgotModal] = useState<'none' | 'email' | 'code' | 'newPassword'>('none');
  const [forgotEmail, setForgotEmail] = useState('');
  const [forgotCode, setForgotCode] = useState('');
  const [forgotNewPassword, setForgotNewPassword] = useState('');
  const [forgotNewPasswordConfirm, setForgotNewPasswordConfirm] = useState('');
  const [forgotLoading, setForgotLoading] = useState(false);
  const [forgotError, setForgotError] = useState<string | null>(null);

  // Forgot email info modal
  const [showForgotEmailInfo, setShowForgotEmailInfo] = useState(false);

  function resolveLoginError(body: LoginResponse, status: number): string {
    const code = body?.error?.code;
    if (code === 'INVALID_CREDENTIALS') return t('error.login.invalidCredentials');
    if (code === 'ACCOUNT_LOCKED') return t('error.login.accountLocked');
    if (code === 'TOO_MANY_ATTEMPTS') return t('error.login.tooManyAttempts');
    return body?.error?.message ?? `${t('error.login.generic')} (${status})`;
  }

  async function handleLogin() {
    const trimmedEmail = email.trim().toLowerCase();
    const trimmedPassword = password.trim();
    if (!trimmedEmail) {
      setError(t('error.login.emailRequired'));
      return;
    }
    if (!trimmedPassword) {
      setError(t('error.login.passwordRequired'));
      return;
    }

    setError(null);
    setLoading(true);
    try {
      // Try to get location for login tracking (non-blocking)
      let locationPayload: { latitude: number; longitude: number; accuracyM?: number; source: string } | undefined;
      try {
        const locationModule = loadExpoLocationModule();
        if (locationModule) {
          const { status } = await locationModule.requestForegroundPermissionsAsync();
          if (status === 'granted') {
            const loc = await locationModule.getCurrentPositionAsync({
              accuracy: locationModule.Accuracy?.Balanced,
            });
            locationPayload = {
              latitude: loc.coords.latitude,
              longitude: loc.coords.longitude,
              accuracyM: loc.coords.accuracy ? Math.round(loc.coords.accuracy) : undefined,
              source: 'app',
            };
          }
        }
      } catch {
        // Location is optional, continue without it
      }

      const { apiUrl } = await loadSettings();
      const response = await fetch(`${apiUrl}/v1/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: trimmedEmail,
          password: trimmedPassword,
          ...(locationPayload ? { location: locationPayload } : {}),
        }),
      });
      const json = (await response.json()) as LoginResponse;
      if (!response.ok || json.error) {
        setError(resolveLoginError(json, response.status));
        return;
      }
      const { user, tokens } = json.data ?? {};
      if (!tokens?.accessToken || !tokens?.refreshToken || !user?.id) {
        setError(t('error.login.unexpectedResponse'));
        return;
      }
      const session: AuthSession = {
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
        userId: user.id,
        userType: user.userType ?? 'buyer',
        email: user.email ?? trimmedEmail,
      };
      await saveAuthSession(session);
      onLogin(session);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('error.login.network'));
    } finally {
      setLoading(false);
    }
  }

  function openForgotPassword() {
    setForgotEmail(email.trim());
    setForgotCode('');
    setForgotNewPassword('');
    setForgotNewPasswordConfirm('');
    setForgotError(null);
    setForgotModal('email');
  }

  function closeForgotPassword() {
    setForgotModal('none');
    setForgotError(null);
  }

  async function handleForgotPasswordRequest() {
    const trimmed = forgotEmail.trim().toLowerCase();
    if (!trimmed || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmed)) {
      setForgotError('Geçerli bir e-posta gir');
      return;
    }
    setForgotError(null);
    setForgotLoading(true);
    try {
      const { apiUrl } = await loadSettings();
      const response = await fetch(`${apiUrl}/v1/auth/forgot-password/request`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: trimmed }),
      });
      const json = await response.json();
      if (!response.ok) {
        const code = json?.error?.code;
        if (code === 'PASSWORD_RESET_TOO_FREQUENT') {
          setForgotError(`Lütfen ${json.error.retryAfterSeconds ?? 60} saniye bekleyin`);
        } else {
          setForgotError(json?.error?.message ?? 'Bir hata oluştu');
        }
        return;
      }
      setForgotModal('code');
    } catch (err) {
      setForgotError(err instanceof Error ? err.message : 'Bağlantı hatası');
    } finally {
      setForgotLoading(false);
    }
  }

  async function handleForgotPasswordConfirm() {
    if (!/^\d{6}$/.test(forgotCode)) {
      setForgotError('6 haneli kodu gir');
      return;
    }
    if (forgotNewPassword.length < 8) {
      setForgotError('Şifre en az 8 karakter olmalı');
      return;
    }
    if (forgotNewPassword !== forgotNewPasswordConfirm) {
      setForgotError('Şifreler eşleşmiyor');
      return;
    }
    setForgotError(null);
    setForgotLoading(true);
    try {
      const { apiUrl } = await loadSettings();
      const response = await fetch(`${apiUrl}/v1/auth/forgot-password/confirm`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: forgotEmail.trim().toLowerCase(),
          code: forgotCode,
          newPassword: forgotNewPassword,
        }),
      });
      const json = await response.json();
      if (!response.ok || json.error) {
        const code = json?.error?.code;
        if (code === 'PASSWORD_RESET_CODE_INVALID') setForgotError('Kod geçersiz veya süresi dolmuş');
        else setForgotError(json?.error?.message ?? 'Bir hata oluştu');
        return;
      }
      closeForgotPassword();
      Alert.alert('Başarılı', 'Şifren güncellendi. Yeni şifrenle giriş yapabilirsin.');
    } catch (err) {
      setForgotError(err instanceof Error ? err.message : 'Bağlantı hatası');
    } finally {
      setForgotLoading(false);
    }
  }

  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar barStyle="dark-content" backgroundColor={theme.background} />
      <KeyboardAvoidingView
        style={styles.container}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        <View style={styles.header}>
          <View style={styles.logoCircle}>
          <Text style={styles.logoText}>C</Text>
          </View>
          <Text style={styles.title}>{t('headline.login.title')}</Text>
          <Text style={styles.subtitle}>{t('headline.login.subtitle')}</Text>
        </View>

        <View style={styles.card}>
          <Text style={styles.label}>{t('helper.login.emailLabel')}</Text>
          <TextInput
            style={styles.input}
            value={email}
            onChangeText={(v) => {
              setEmail(v);
              setError(null);
            }}
            placeholder={t('helper.login.emailPlaceholder')}
            placeholderTextColor={theme.textSecondary}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="email-address"
            returnKeyType="next"
            editable={!loading}
          />

          <Text style={styles.label}>{t('helper.login.passwordLabel')}</Text>
          <TextInput
            style={styles.input}
            value={password}
            onChangeText={(v) => {
              setPassword(v);
              setError(null);
            }}
            placeholder={t('helper.login.passwordPlaceholder')}
            placeholderTextColor={theme.textSecondary}
            secureTextEntry
            returnKeyType="go"
            onSubmitEditing={handleLogin}
            editable={!loading}
          />

          {!!error && <Text style={styles.error}>{error}</Text>}

          <View style={styles.forgotRow}>
            <TouchableOpacity onPress={() => setShowForgotEmailInfo(true)} activeOpacity={0.7}>
              <Text style={styles.forgotText}>E-postamı unuttum</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={openForgotPassword} activeOpacity={0.7}>
              <Text style={styles.forgotText}>Şifremi unuttum</Text>
            </TouchableOpacity>
          </View>

          <TouchableOpacity
            style={[styles.button, !!error && styles.buttonError, loading && styles.buttonDisabled]}
            onPress={handleLogin}
            disabled={loading}
          >
            {loading ? (
              <ActivityIndicator color={theme.onPrimary} />
            ) : (
              <Text style={styles.buttonText}>{error ? t('cta.login.tryAgain') : t('cta.login.signIn')}</Text>
            )}
          </TouchableOpacity>

          {onGoToRegister && (
            <TouchableOpacity onPress={onGoToRegister} style={styles.registerLink} activeOpacity={0.7}>
              <Text style={styles.registerLinkText}>Hesabın yok mu? <Text style={styles.registerLinkBold}>Kayıt ol</Text></Text>
            </TouchableOpacity>
          )}
        </View>
      </KeyboardAvoidingView>

      {/* Forgot Email Info Modal */}
      <Modal visible={showForgotEmailInfo} transparent animationType="fade" onRequestClose={() => setShowForgotEmailInfo(false)}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>E-postanı mı unuttun?</Text>
            <Text style={styles.modalDesc}>
              Kayıt olurken kullandığın e-posta adresini hatırlamıyorsan, destek ekibimize ulaşabilirsin.
            </Text>
            <Text style={styles.modalDesc}>
              E-posta: destek@coziyoo.com
            </Text>
            <TouchableOpacity style={styles.modalCloseBtn} onPress={() => setShowForgotEmailInfo(false)}>
              <Text style={styles.modalCloseBtnText}>Tamam</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>

      {/* Forgot Password Modal */}
      <Modal visible={forgotModal !== 'none'} transparent animationType="fade" onRequestClose={closeForgotPassword}>
        <View style={styles.modalOverlay}>
          <View style={styles.modalCard}>
            {forgotModal === 'email' && (
              <>
                <Text style={styles.modalTitle}>Şifreni Sıfırla</Text>
                <Text style={styles.modalDesc}>Kayıtlı e-posta adresini gir, sana doğrulama kodu göndereceğiz.</Text>
                <TextInput
                  style={styles.modalInput}
                  value={forgotEmail}
                  onChangeText={(v) => { setForgotEmail(v); setForgotError(null); }}
                  placeholder="ornek@email.com"
                  placeholderTextColor={theme.textSecondary}
                  autoCapitalize="none"
                  keyboardType="email-address"
                  autoFocus
                />
                {!!forgotError && <Text style={styles.modalError}>{forgotError}</Text>}
                <View style={styles.modalActions}>
                  <TouchableOpacity style={styles.modalCancelBtn} onPress={closeForgotPassword}>
                    <Text style={styles.modalCancelBtnText}>İptal</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.modalPrimaryBtn, forgotLoading && styles.buttonDisabled]}
                    onPress={handleForgotPasswordRequest}
                    disabled={forgotLoading}
                  >
                    {forgotLoading ? (
                      <ActivityIndicator color="#fff" size="small" />
                    ) : (
                      <Text style={styles.modalPrimaryBtnText}>Kod Gönder</Text>
                    )}
                  </TouchableOpacity>
                </View>
              </>
            )}

            {forgotModal === 'code' && (
              <>
                <Text style={styles.modalTitle}>Şifreni Sıfırla</Text>
                <Text style={styles.modalDesc}>
                  {forgotEmail} adresine gönderilen 6 haneli kodu ve yeni şifreni gir.
                </Text>
                <TextInput
                  style={styles.modalInput}
                  value={forgotCode}
                  onChangeText={(v) => { setForgotCode(v.replace(/\D/g, '').slice(0, 6)); setForgotError(null); }}
                  placeholder="6 haneli kod"
                  placeholderTextColor={theme.textSecondary}
                  keyboardType="number-pad"
                  maxLength={6}
                  autoFocus
                />
                <TextInput
                  style={styles.modalInput}
                  value={forgotNewPassword}
                  onChangeText={(v) => { setForgotNewPassword(v); setForgotError(null); }}
                  placeholder="Yeni şifre (en az 8 karakter)"
                  placeholderTextColor={theme.textSecondary}
                  secureTextEntry
                />
                <TextInput
                  style={styles.modalInput}
                  value={forgotNewPasswordConfirm}
                  onChangeText={(v) => { setForgotNewPasswordConfirm(v); setForgotError(null); }}
                  placeholder="Yeni şifre tekrar"
                  placeholderTextColor={theme.textSecondary}
                  secureTextEntry
                />
                {!!forgotError && <Text style={styles.modalError}>{forgotError}</Text>}
                <View style={styles.modalActions}>
                  <TouchableOpacity style={styles.modalCancelBtn} onPress={() => setForgotModal('email')}>
                    <Text style={styles.modalCancelBtnText}>Geri</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={[styles.modalPrimaryBtn, forgotLoading && styles.buttonDisabled]}
                    onPress={handleForgotPasswordConfirm}
                    disabled={forgotLoading}
                  >
                    {forgotLoading ? (
                      <ActivityIndicator color="#fff" size="small" />
                    ) : (
                      <Text style={styles.modalPrimaryBtnText}>Şifreyi Güncelle</Text>
                    )}
                  </TouchableOpacity>
                </View>
              </>
            )}
          </View>
        </View>
      </Modal>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: {
    flex: 1,
    backgroundColor: theme.background,
  },
  container: {
    flex: 1,
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  header: {
    alignItems: 'center',
    marginBottom: 24,
  },
  logoCircle: {
    width: 88,
    height: 88,
    borderRadius: 44,
    backgroundColor: theme.primary,
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 12,
  },
  logoText: {
    color: theme.onPrimary,
    fontSize: 38,
    fontWeight: '700',
  },
  title: {
    color: theme.text,
    fontSize: 34,
    fontWeight: '700',
  },
  subtitle: {
    color: theme.textSecondary,
    fontSize: 13,
    marginTop: 4,
    letterSpacing: 0.4,
  },
  card: {
    backgroundColor: theme.card,
    borderWidth: 1,
    borderColor: theme.border,
    borderRadius: 16,
    padding: 16,
    gap: 10,
  },
  label: {
    color: theme.text,
    fontSize: 13,
    fontWeight: '500',
  },
  input: {
    backgroundColor: theme.surface,
    borderWidth: 1,
    borderColor: theme.border,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    color: theme.text,
    fontSize: 16,
  },
  error: {
    color: theme.error,
    fontSize: 13,
  },
  forgotRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  forgotText: {
    color: theme.primary,
    fontSize: 13,
    fontWeight: '600',
  },
  button: {
    backgroundColor: theme.primary,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: 'center',
    marginTop: 6,
  },
  buttonError: {
    backgroundColor: theme.error,
  },
  buttonDisabled: {
    opacity: 0.6,
  },
  buttonText: {
    color: theme.onPrimary,
    fontSize: 16,
    fontWeight: '600',
  },
  registerLink: {
    alignItems: 'center',
    marginTop: 8,
    paddingVertical: 8,
  },
  registerLinkText: {
    color: theme.textSecondary,
    fontSize: 14,
  },
  registerLinkBold: {
    color: theme.primary,
    fontWeight: '700',
  },

  /* Modal styles */
  modalOverlay: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.35)',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  modalCard: {
    width: '100%',
    backgroundColor: '#fff',
    borderRadius: 16,
    padding: 20,
    borderWidth: 1,
    borderColor: theme.border,
  },
  modalTitle: {
    color: theme.text,
    fontSize: 20,
    fontWeight: '700',
    marginBottom: 8,
  },
  modalDesc: {
    color: theme.textSecondary,
    fontSize: 14,
    lineHeight: 20,
    marginBottom: 12,
  },
  modalInput: {
    backgroundColor: theme.surface,
    borderWidth: 1,
    borderColor: theme.border,
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
    color: theme.text,
    fontSize: 16,
    marginBottom: 10,
  },
  modalError: {
    color: theme.error,
    fontSize: 13,
    marginBottom: 8,
  },
  modalActions: {
    flexDirection: 'row',
    justifyContent: 'flex-end',
    gap: 10,
    marginTop: 4,
  },
  modalCancelBtn: {
    backgroundColor: theme.surface,
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 16,
  },
  modalCancelBtnText: {
    color: theme.textSecondary,
    fontSize: 14,
    fontWeight: '600',
  },
  modalPrimaryBtn: {
    backgroundColor: theme.primary,
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 16,
  },
  modalPrimaryBtnText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '700',
  },
  modalCloseBtn: {
    backgroundColor: theme.primary,
    borderRadius: 10,
    paddingVertical: 12,
    alignItems: 'center',
    marginTop: 4,
  },
  modalCloseBtnText: {
    color: '#fff',
    fontSize: 15,
    fontWeight: '700',
  },
});
