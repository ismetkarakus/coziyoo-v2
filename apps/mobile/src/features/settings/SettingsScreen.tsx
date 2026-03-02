import React, { useEffect, useState } from 'react';
import { Alert, Button, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { getAgentSettings, updateAgentSettings } from '../../services/api/livekit';
import { useSessionStore } from '../../state/sessionStore';

export function SettingsScreen() {
  const auth = useSessionStore((s) => s.auth);
  const deviceId = useSessionStore((s) => s.selectedDeviceId);
  const setDeviceId = useSessionStore((s) => s.setDeviceId);
  const [sttBaseUrl, setSttBaseUrl] = useState('');
  const [llmBaseUrl, setLlmBaseUrl] = useState('');
  const [llmModel, setLlmModel] = useState('llama3.1:8b');
  const [n8nBaseUrl, setN8nBaseUrl] = useState('');

  useEffect(() => {
    const load = async () => {
      if (!auth?.tokens.accessToken) return;
      try {
        const settings = await getAgentSettings(auth.tokens.accessToken, deviceId);
        setSttBaseUrl(String(settings.sttBaseUrl ?? ''));
        setLlmBaseUrl(String(settings.ollamaBaseUrl ?? ''));
        setLlmModel(String(settings.ollamaModel ?? 'llama3.1:8b'));
        setN8nBaseUrl(String(settings.n8nBaseUrl ?? ''));
      } catch {
        // keep local defaults
      }
    };
    void load();
  }, [auth?.tokens.accessToken, deviceId]);

  const onSave = async () => {
    if (!auth?.tokens.accessToken) {
      Alert.alert('Not authenticated');
      return;
    }
    try {
      await updateAgentSettings(auth.tokens.accessToken, deviceId, {
        agentName: 'Coziyoo Voice Assistant',
        voiceLanguage: 'en-US',
        ollamaModel: llmModel,
        ttsEngine: 'f5-tts',
        ttsEnabled: true,
        sttEnabled: true,
        sttProvider: 'remote-speech-server',
        sttBaseUrl,
        ollamaBaseUrl: llmBaseUrl,
        n8nBaseUrl,
      });
      Alert.alert('Saved', 'Agent settings updated');
    } catch (error) {
      Alert.alert('Save failed', error instanceof Error ? error.message : 'Unknown error');
    }
  };

  return (
    <ScrollView style={styles.root} contentContainerStyle={styles.content}>
      <Text style={styles.title}>Voice Settings</Text>
      <TextInput style={styles.input} value={deviceId} onChangeText={setDeviceId} placeholder="Device ID" />
      <TextInput style={styles.input} value={sttBaseUrl} onChangeText={setSttBaseUrl} placeholder="STT Base URL" />
      <TextInput style={styles.input} value={llmBaseUrl} onChangeText={setLlmBaseUrl} placeholder="Ollama Base URL" />
      <TextInput style={styles.input} value={llmModel} onChangeText={setLlmModel} placeholder="LLM Model" />
      <TextInput style={styles.input} value={n8nBaseUrl} onChangeText={setN8nBaseUrl} placeholder="n8n Base URL" />
      <View style={styles.buttonWrap}>
        <Button title="Save Settings" onPress={onSave} />
      </View>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#fff' },
  content: { padding: 16, gap: 10 },
  title: { fontSize: 24, fontWeight: '700', marginBottom: 10 },
  input: {
    borderWidth: 1,
    borderColor: '#d2d6dc',
    borderRadius: 10,
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: '#fff',
  },
  buttonWrap: { marginTop: 10 },
});
