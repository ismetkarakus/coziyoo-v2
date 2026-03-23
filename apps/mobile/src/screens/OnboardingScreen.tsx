import React, { useState, useRef } from 'react';
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
  Animated,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import * as Location from 'expo-location';
import { saveAuthSession, type AuthSession } from '../utils/auth';
import { loadSettings } from '../utils/settings';
import { theme } from '../theme/colors';

type Step = 'welcome' | 'register';

type Props = {
  onComplete: (session: AuthSession) => void;
  onGoToLogin: () => void;
};

type RegisterResponse = {
  data?: {
    user?: { id?: string; email?: string; displayName?: string; userType?: string };
    tokens?: { accessToken?: string; refreshToken?: string };
  };
  error?: { code?: string; message?: string };
};

export default function OnboardingScreen({ onComplete, onGoToLogin }: Props) {
  const [step, setStep] = useState<Step>('welcome');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [passwordConfirm, setPasswordConfirm] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showPassword, setShowPassword] = useState(false);
  const [showPasswordConfirm, setShowPasswordConfirm] = useState(false);

  const fadeAnim = useRef(new Animated.Value(1)).current;

  function animateTransition(next: Step) {
    Animated.timing(fadeAnim, { toValue: 0, duration: 150, useNativeDriver: true }).start(() => {
      setStep(next);
      setError(null);
      Animated.timing(fadeAnim, { toValue: 1, duration: 200, useNativeDriver: true }).start();
    });
  }

  function handleRegisterPress() {
    const trimmedEmail = email.trim().toLowerCase();
    if (!trimmedEmail) { setError('E-posta adresini gir'); return; }
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(trimmedEmail)) { setError('Geçerli bir e-posta gir'); return; }
    if (password.length < 8) { setError('Şifre en az 8 karakter olmalı'); return; }
    if (password !== passwordConfirm) { setError('Şifreler eşleşmiyor'); return; }
    handleRegister();
  }

  async function handleRegister() {
    setError(null);
    setLoading(true);
    try {
      // Try to get location (non-blocking)
      let locationPayload: { latitude: number; longitude: number; accuracyM?: number; source: string } | undefined;
      try {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status === 'granted') {
          const loc = await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced });
          locationPayload = {
            latitude: loc.coords.latitude,
            longitude: loc.coords.longitude,
            accuracyM: loc.coords.accuracy ? Math.round(loc.coords.accuracy) : undefined,
            source: 'app',
          };
        }
      } catch {
        // Location is optional
      }

      const { apiUrl } = await loadSettings();
      const response = await fetch(`${apiUrl}/v1/auth/register`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          email: email.trim().toLowerCase(),
          password,
          ...(locationPayload ? { location: locationPayload } : {}),
        }),
      });
      const json = (await response.json()) as RegisterResponse;

      if (!response.ok || json.error) {
        const code = json.error?.code;
        if (code === 'EMAIL_TAKEN') setError('Bu e-posta zaten kayıtlı');
        else if (code === 'VALIDATION_ERROR') {
          const details = (json.error as Record<string, unknown>)?.details as { fieldErrors?: Record<string, string[]> } | undefined;
          const fields = details?.fieldErrors;
          if (fields?.password?.length) setError('Şifre en az 8 karakter olmalı');
          else if (fields?.email?.length) setError('Geçerli bir e-posta gir');
          else setError('Lütfen bilgileri kontrol et');
        }
        else setError(json.error?.message ?? `Kayıt başarısız (${response.status})`);
        return;
      }

      const { user, tokens } = json.data ?? {};
      if (!tokens?.accessToken || !tokens?.refreshToken || !user?.id) {
        setError('Beklenmeyen sunucu yanıtı');
        return;
      }

      const session: AuthSession = {
        accessToken: tokens.accessToken,
        refreshToken: tokens.refreshToken,
        userId: user.id,
        userType: user.userType ?? 'buyer',
        email: user.email ?? email.trim().toLowerCase(),
      };
      await saveAuthSession(session);
      onComplete(session);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Bağlantı hatası');
    } finally {
      setLoading(false);
    }
  }

  function renderWelcome() {
    return (
      <View style={styles.centerContent}>
        <View style={styles.welcomeIconWrap}>
          <Text style={styles.welcomeIcon}>🍽️</Text>
        </View>
        <Text style={styles.welcomeTitle}>Coziyoo'ya{'\n'}Hoş Geldiniz</Text>
        <Text style={styles.welcomeSubtitle}>Lezzetli ev yemekleri burada</Text>
        <Text style={styles.welcomeDesc}>
          Komşunuzun mutfağından, kapınıza.{'\n'}Sıcacık, ev yapımı lezzetler sizi bekliyor.
        </Text>

        <TouchableOpacity style={styles.primaryBtn} onPress={() => animateTransition('register')} activeOpacity={0.85}>
          <Text style={styles.primaryBtnText}>Başlayalım</Text>
          <Ionicons name="arrow-forward" size={20} color="#fff" />
        </TouchableOpacity>

        <TouchableOpacity style={styles.secondaryBtn} onPress={onGoToLogin} activeOpacity={0.8}>
          <Text style={styles.secondaryBtnText}>Zaten hesabım var</Text>
        </TouchableOpacity>
      </View>
    );
  }

  function renderRegister() {
    return (
      <View style={styles.stepContent}>
        <Text style={styles.stepTitle}>Hesabını oluştur</Text>
        <Text style={styles.stepSubtitle}>E-posta ve şifreni gir</Text>

        <View style={styles.inputGroup}>
          <Text style={styles.inputLabel}>E-posta</Text>
          <View style={styles.inputWrap}>
            <Ionicons name="mail-outline" size={20} color={theme.textSecondary} style={styles.inputIcon} />
            <TextInput
              style={styles.input}
              value={email}
              onChangeText={(v) => { setEmail(v); setError(null); }}
              placeholder="ornek@email.com"
              placeholderTextColor={theme.textSecondary}
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="email-address"
              editable={!loading}
            />
          </View>
        </View>

        <View style={styles.inputGroup}>
          <Text style={styles.inputLabel}>Şifre</Text>
          <View style={styles.inputWrap}>
            <Ionicons name="lock-closed-outline" size={20} color={theme.textSecondary} style={styles.inputIcon} />
            <TextInput
              style={styles.input}
              value={password}
              onChangeText={(v) => { setPassword(v); setError(null); }}
              placeholder="En az 8 karakter"
              placeholderTextColor={theme.textSecondary}
              secureTextEntry={!showPassword}
              editable={!loading}
            />
            <TouchableOpacity onPress={() => setShowPassword(!showPassword)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <Ionicons name={showPassword ? 'eye-off-outline' : 'eye-outline'} size={20} color={theme.textSecondary} />
            </TouchableOpacity>
          </View>
        </View>

        <View style={styles.inputGroup}>
          <Text style={styles.inputLabel}>Şifre Tekrar</Text>
          <View style={styles.inputWrap}>
            <Ionicons name="lock-closed-outline" size={20} color={theme.textSecondary} style={styles.inputIcon} />
            <TextInput
              style={styles.input}
              value={passwordConfirm}
              onChangeText={(v) => { setPasswordConfirm(v); setError(null); }}
              placeholder="Şifreni tekrar gir"
              placeholderTextColor={theme.textSecondary}
              secureTextEntry={!showPasswordConfirm}
              returnKeyType="go"
              onSubmitEditing={handleRegisterPress}
              editable={!loading}
            />
            <TouchableOpacity onPress={() => setShowPasswordConfirm(!showPasswordConfirm)} hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
              <Ionicons name={showPasswordConfirm ? 'eye-off-outline' : 'eye-outline'} size={20} color={theme.textSecondary} />
            </TouchableOpacity>
          </View>
        </View>

        {!!error && <Text style={styles.errorText}>{error}</Text>}

        <TouchableOpacity
          style={[styles.primaryBtn, loading && styles.primaryBtnDisabled]}
          onPress={handleRegisterPress}
          disabled={loading}
          activeOpacity={0.85}
        >
          {loading ? (
            <ActivityIndicator color="#fff" />
          ) : (
            <>
              <Text style={styles.primaryBtnText}>Kayıt Ol</Text>
              <Ionicons name="checkmark" size={20} color="#fff" />
            </>
          )}
        </TouchableOpacity>

        <TouchableOpacity style={styles.secondaryBtn} onPress={onGoToLogin} activeOpacity={0.8}>
          <Text style={styles.secondaryBtnText}>Zaten hesabım var? <Text style={styles.loginLink}>Giriş yap</Text></Text>
        </TouchableOpacity>
      </View>
    );
  }

  const showBack = step === 'register';

  return (
    <SafeAreaView style={styles.safe}>
      <StatusBar barStyle="dark-content" backgroundColor={theme.background} />
      <KeyboardAvoidingView
        style={styles.container}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      >
        {showBack && (
          <View style={styles.header}>
            <TouchableOpacity onPress={() => animateTransition('welcome')} style={styles.backBtn} activeOpacity={0.7} disabled={loading}>
              <Ionicons name="arrow-back" size={24} color={theme.text} />
            </TouchableOpacity>
            <View style={{ flex: 1 }} />
          </View>
        )}

        <Animated.View style={[styles.body, { opacity: fadeAnim }]}>
          {step === 'welcome' && renderWelcome()}
          {step === 'register' && renderRegister()}
        </Animated.View>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: theme.background },
  container: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 4,
  },
  backBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: theme.surface,
  },
  body: { flex: 1, paddingHorizontal: 24 },

  centerContent: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  welcomeIconWrap: {
    width: 100,
    height: 100,
    borderRadius: 50,
    backgroundColor: '#F0D5AE',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 24,
  },
  welcomeIcon: { fontSize: 48 },
  welcomeTitle: {
    fontSize: 32,
    fontWeight: '800',
    color: theme.text,
    textAlign: 'center',
    lineHeight: 40,
  },
  welcomeSubtitle: {
    fontSize: 17,
    fontWeight: '600',
    color: theme.primary,
    marginTop: 8,
  },
  welcomeDesc: {
    fontSize: 14,
    color: theme.textSecondary,
    textAlign: 'center',
    lineHeight: 22,
    marginTop: 12,
    marginBottom: 36,
  },

  stepContent: {
    flex: 1,
    justifyContent: 'center',
    paddingBottom: 40,
  },
  stepTitle: {
    fontSize: 26,
    fontWeight: '800',
    color: theme.text,
    marginBottom: 6,
  },
  stepSubtitle: {
    fontSize: 14,
    color: theme.textSecondary,
    marginBottom: 28,
  },

  inputGroup: { marginBottom: 16 },
  inputLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: theme.text,
    marginBottom: 6,
  },
  inputWrap: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: theme.card,
    borderWidth: 1,
    borderColor: theme.border,
    borderRadius: 14,
    paddingHorizontal: 14,
  },
  inputIcon: { marginRight: 10 },
  input: {
    flex: 1,
    fontSize: 16,
    color: theme.text,
    paddingVertical: 14,
  },

  primaryBtn: {
    backgroundColor: theme.primary,
    borderRadius: 14,
    paddingVertical: 16,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    marginTop: 8,
  },
  primaryBtnDisabled: { opacity: 0.6 },
  primaryBtnText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '700',
  },
  secondaryBtn: {
    marginTop: 16,
    paddingVertical: 12,
  },
  secondaryBtnText: {
    color: theme.textSecondary,
    fontSize: 14,
    fontWeight: '600',
    textAlign: 'center',
  },
  loginLink: {
    color: theme.primary,
    fontWeight: '700',
  },

  errorText: {
    color: theme.error,
    fontSize: 13,
    marginBottom: 4,
  },
});
