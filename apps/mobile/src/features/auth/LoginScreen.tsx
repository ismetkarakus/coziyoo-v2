import React, { useState } from 'react';
import { Alert, Button, StyleSheet, Text, TextInput, View } from 'react-native';
import { login } from '../../services/api/auth';
import { saveStoredAuth } from '../../services/storage/authStorage';
import { useSessionStore } from '../../state/sessionStore';

export function LoginScreen() {
  const [email, setEmail] = useState('admin@coziyoo.com');
  const [password, setPassword] = useState('Admin12345');
  const [loading, setLoading] = useState(false);
  const setAuth = useSessionStore((s) => s.setAuth);

  const onLogin = async () => {
    setLoading(true);
    try {
      const result = await login(email.trim(), password);
      await saveStoredAuth(result);
      setAuth(result);
    } catch (error) {
      Alert.alert('Login failed', error instanceof Error ? error.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  };

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Coziyoo Voice Assistant</Text>
      <TextInput
        style={styles.input}
        value={email}
        onChangeText={setEmail}
        autoCapitalize="none"
        keyboardType="email-address"
        placeholder="Email"
      />
      <TextInput
        style={styles.input}
        value={password}
        onChangeText={setPassword}
        secureTextEntry
        placeholder="Password"
      />
      <Button title={loading ? 'Signing in...' : 'Sign in'} onPress={onLogin} disabled={loading} />
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    padding: 24,
    justifyContent: 'center',
    gap: 12,
    backgroundColor: '#f7fafc',
  },
  title: {
    fontSize: 24,
    fontWeight: '700',
    marginBottom: 16,
  },
  input: {
    borderWidth: 1,
    borderColor: '#d2d6dc',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: '#fff',
  },
});
