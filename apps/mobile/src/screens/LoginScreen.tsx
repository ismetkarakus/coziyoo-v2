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
} from 'react-native';
import { saveAuthSession, type AuthSession } from '../utils/auth';
import { loadSettings } from '../utils/settings';
import { theme } from '../theme/colors';
import { t } from '../copy/brandCopy';

type Props = {
  onLogin: (session: AuthSession) => void;
};

type LoginResponse = {
  data?: {
    user?: { id?: string; email?: string; userType?: string };
    tokens?: { accessToken?: string; refreshToken?: string };
  };
  error?: { code?: string; message?: string };
};

export default function LoginScreen({ onLogin }: Props) {
  const [email, setEmail] = useState('test@deneme.com');
  const [password, setPassword] = useState('test');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

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
      const { apiUrl } = await loadSettings();
      const response = await fetch(`${apiUrl}/v1/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email: trimmedEmail, password: trimmedPassword }),
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
        </View>
      </KeyboardAvoidingView>
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
});
