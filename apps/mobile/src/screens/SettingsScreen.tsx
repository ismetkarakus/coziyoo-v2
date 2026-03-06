import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  StyleSheet,
  ScrollView,
  ActivityIndicator,
  StatusBar,
} from 'react-native';
import { loadSettings, saveSettings } from '../utils/settings';

type ServerItem = {
  id: string;
  name: string;
  enabled: boolean;
  baseUrl?: string;
  provider?: string;
  model?: string;
};

type AgentSettings = {
  agentName: string;
  voiceLanguage: string;
  ollamaModel: string;
  ttsEngine: string;
  ttsEnabled: boolean;
  sttEnabled: boolean;
  ttsConfig: Record<string, unknown> | null;
};

type Props = {
  onBack: () => void;
};

export default function SettingsScreen({ onBack }: Props) {
  const [apiUrl, setApiUrl] = useState('http://localhost:3000');
  const [profileId, setProfileId] = useState('default');

  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const [agentSettings, setAgentSettings] = useState<AgentSettings | null>(null);
  const [sttServers, setSttServers] = useState<ServerItem[]>([]);
  const [ttsServers, setTtsServers] = useState<ServerItem[]>([]);
  const [llmServers, setLlmServers] = useState<ServerItem[]>([]);
  const [selectedStt, setSelectedStt] = useState('');
  const [selectedTts, setSelectedTts] = useState('');
  const [selectedLlm, setSelectedLlm] = useState('');

  useEffect(() => {
    loadSettings().then((s) => {
      setApiUrl(s.apiUrl);
      setProfileId(s.deviceProfile);
    });
  }, []);

  async function fetchServers(url: string, profile: string) {
    setLoading(true);
    setError(null);
    setAgentSettings(null);
    setSttServers([]);
    setTtsServers([]);
    setLlmServers([]);
    try {
      const res = await fetch(`${url}/v1/livekit/starter/agent-settings/${profile}`);
      const json = await res.json();
      if (!res.ok || json.error) {
        throw new Error(json.error?.message ?? `Server error ${res.status}`);
      }
      const data = json.data;
      const cfg = (data.ttsConfig ?? {}) as Record<string, unknown>;

      setAgentSettings({
        agentName: data.agentName ?? '',
        voiceLanguage: data.voiceLanguage ?? 'en',
        ollamaModel: data.ollamaModel ?? '',
        ttsEngine: data.ttsEngine ?? 'f5-tts',
        ttsEnabled: data.ttsEnabled ?? true,
        sttEnabled: data.sttEnabled ?? true,
        ttsConfig: cfg,
      });

      const sttList = Array.isArray(cfg.sttServers) ? (cfg.sttServers as ServerItem[]) : [];
      const ttsList = Array.isArray(cfg.ttsServers) ? (cfg.ttsServers as ServerItem[]) : [];
      const llmList = Array.isArray(cfg.llmServers) ? (cfg.llmServers as ServerItem[]) : [];
      const defStt = typeof cfg.defaultSttServerId === 'string' ? cfg.defaultSttServerId : sttList[0]?.id ?? '';
      const defTts = typeof cfg.defaultTtsServerId === 'string' ? cfg.defaultTtsServerId : ttsList[0]?.id ?? '';
      const defLlm = typeof cfg.defaultLlmServerId === 'string' ? cfg.defaultLlmServerId : llmList[0]?.id ?? '';

      setSttServers(sttList);
      setTtsServers(ttsList);
      setLlmServers(llmList);
      setSelectedStt(defStt);
      setSelectedTts(defTts);
      setSelectedLlm(defLlm);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load servers');
    } finally {
      setLoading(false);
    }
  }

  async function handleSaveConnection() {
    setSaving(true);
    setSaved(false);
    setError(null);
    const trimUrl = apiUrl.trim().replace(/\/$/, '');
    const trimProfile = profileId.trim() || 'default';
    await saveSettings({ apiUrl: trimUrl, deviceProfile: trimProfile });
    setApiUrl(trimUrl);
    setProfileId(trimProfile);
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
    setSaving(false);
  }

  async function handleSaveServers() {
    if (!agentSettings) return;
    setSaving(true);
    setError(null);
    try {
      const updatedCfg = {
        ...(agentSettings.ttsConfig ?? {}),
        defaultSttServerId: selectedStt,
        defaultTtsServerId: selectedTts,
        defaultLlmServerId: selectedLlm,
      };
      const body = {
        agentName: agentSettings.agentName || 'coziyoo-agent',
        voiceLanguage: agentSettings.voiceLanguage || 'en',
        ollamaModel: agentSettings.ollamaModel || 'llama3.1:8b',
        ttsEngine: agentSettings.ttsEngine || 'f5-tts',
        ttsEnabled: agentSettings.ttsEnabled,
        sttEnabled: agentSettings.sttEnabled,
        greetingEnabled: true,
        ttsConfig: updatedCfg,
      };
      const res = await fetch(`${apiUrl}/v1/livekit/starter/agent-settings/${profileId}`, {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      if (!res.ok || json.error) throw new Error(json.error?.message ?? `Server error ${res.status}`);
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Save failed');
    } finally {
      setSaving(false);
    }
  }

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" backgroundColor="#0a0a0a" />

      <View style={styles.header}>
        <TouchableOpacity onPress={onBack} style={styles.backBtn}>
          <Text style={styles.backText}>← Back</Text>
        </TouchableOpacity>
        <Text style={styles.title}>Settings</Text>
        <View style={{ width: 60 }} />
      </View>

      <ScrollView contentContainerStyle={styles.content}>

        {/* ── Connection ── */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>Connection</Text>
          <Text style={styles.label}>API Base URL</Text>
          <TextInput
            style={styles.input}
            value={apiUrl}
            onChangeText={setApiUrl}
            placeholder="http://localhost:3000"
            placeholderTextColor="#555"
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
          />
          <Text style={styles.label}>Device Profile ID</Text>
          <TextInput
            style={styles.input}
            value={profileId}
            onChangeText={setProfileId}
            placeholder="default"
            placeholderTextColor="#555"
            autoCapitalize="none"
            autoCorrect={false}
          />
          <Text style={styles.hint}>
            Matches a profile in Admin → Voice Agent Settings. Use{' '}
            <Text style={styles.code}>default</Text> for the admin's default profile.
          </Text>
          <TouchableOpacity style={styles.btnSecondary} onPress={handleSaveConnection} disabled={saving}>
            <Text style={styles.btnSecondaryText}>{saved ? 'Saved!' : 'Save Connection'}</Text>
          </TouchableOpacity>
        </View>

        {/* ── Server Selection ── */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>AI Servers</Text>
          <TouchableOpacity
            style={styles.btnPrimary}
            onPress={() => fetchServers(apiUrl.trim().replace(/\/$/, ''), profileId.trim() || 'default')}
            disabled={loading}
          >
            {loading
              ? <ActivityIndicator color="#fff" size="small" />
              : <Text style={styles.btnPrimaryText}>Load Servers from Profile</Text>
            }
          </TouchableOpacity>

          {!!error && <Text style={styles.error}>{error}</Text>}

          {agentSettings && (
            <View style={styles.infoRow}>
              <Text style={styles.infoLabel}>Agent</Text>
              <Text style={styles.infoValue}>{agentSettings.agentName}</Text>
              <Text style={styles.infoLabel}>Language</Text>
              <Text style={styles.infoValue}>{agentSettings.voiceLanguage}</Text>
            </View>
          )}

          {sttServers.length > 0 && (
            <ServerSelector
              label="STT Server"
              servers={sttServers}
              selected={selectedStt}
              onSelect={setSelectedStt}
            />
          )}

          {ttsServers.length > 0 && (
            <ServerSelector
              label="TTS Server"
              servers={ttsServers}
              selected={selectedTts}
              onSelect={setSelectedTts}
            />
          )}

          {llmServers.length > 0 && (
            <ServerSelector
              label="LLM Server"
              servers={llmServers}
              selected={selectedLlm}
              onSelect={setSelectedLlm}
            />
          )}

          {(sttServers.length > 0 || ttsServers.length > 0 || llmServers.length > 0) && (
            <TouchableOpacity
              style={[styles.btnPrimary, saving && styles.btnDisabled]}
              onPress={handleSaveServers}
              disabled={saving}
            >
              {saving
                ? <ActivityIndicator color="#fff" size="small" />
                : <Text style={styles.btnPrimaryText}>{saved ? 'Saved!' : 'Save Server Selection'}</Text>
              }
            </TouchableOpacity>
          )}

          {sttServers.length === 0 && ttsServers.length === 0 && llmServers.length === 0 && !loading && !error && (
            <Text style={styles.emptyHint}>
              Tap "Load Servers" to fetch the STT, TTS, and LLM servers configured in the admin panel for this profile.
            </Text>
          )}
        </View>

      </ScrollView>
    </View>
  );
}

function ServerSelector({ label, servers, selected, onSelect }: {
  label: string;
  servers: ServerItem[];
  selected: string;
  onSelect: (id: string) => void;
}) {
  return (
    <View style={selectorStyles.container}>
      <Text style={selectorStyles.label}>{label}</Text>
      {servers.map((s) => (
        <TouchableOpacity
          key={s.id}
          style={[selectorStyles.row, selected === s.id && selectorStyles.rowSelected]}
          onPress={() => onSelect(s.id)}
        >
          <View style={[selectorStyles.radio, selected === s.id && selectorStyles.radioSelected]} />
          <View style={selectorStyles.info}>
            <Text style={selectorStyles.name}>{s.name}</Text>
            {!!s.baseUrl && (
              <Text style={selectorStyles.url} numberOfLines={1}>{s.baseUrl}</Text>
            )}
            {!!s.model && (
              <Text style={selectorStyles.url}>{s.model}</Text>
            )}
          </View>
          {!s.enabled && <Text style={selectorStyles.disabled}>disabled</Text>}
        </TouchableOpacity>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#0a0a0a' },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingTop: 56,
    paddingHorizontal: 16,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#1a1a1a',
  },
  backBtn: { width: 60 },
  backText: { color: '#6C63FF', fontSize: 15 },
  title: { color: '#fff', fontSize: 17, fontWeight: '600' },
  content: { padding: 20, gap: 24 },
  section: { gap: 12 },
  sectionTitle: {
    color: '#888',
    fontSize: 11,
    textTransform: 'uppercase',
    letterSpacing: 1.5,
    marginBottom: 2,
  },
  label: { color: '#ccc', fontSize: 13, fontWeight: '500' },
  input: {
    backgroundColor: '#1a1a1a',
    borderWidth: 1,
    borderColor: '#2a2a2a',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 12,
    color: '#fff',
    fontSize: 14,
  },
  hint: { color: '#555', fontSize: 12, lineHeight: 18 },
  code: { color: '#6C63FF' },
  error: { color: '#ff6b6b', fontSize: 13 },
  emptyHint: { color: '#444', fontSize: 13, lineHeight: 20, textAlign: 'center', marginTop: 8 },
  infoRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8, marginTop: 4 },
  infoLabel: { color: '#555', fontSize: 12 },
  infoValue: { color: '#aaa', fontSize: 12, fontWeight: '600', marginRight: 12 },
  btnPrimary: {
    backgroundColor: '#6C63FF',
    borderRadius: 10,
    paddingVertical: 13,
    alignItems: 'center',
  },
  btnPrimaryText: { color: '#fff', fontSize: 14, fontWeight: '600' },
  btnSecondary: {
    backgroundColor: '#1a1a1a',
    borderWidth: 1,
    borderColor: '#2a2a2a',
    borderRadius: 10,
    paddingVertical: 13,
    alignItems: 'center',
  },
  btnSecondaryText: { color: '#aaa', fontSize: 14, fontWeight: '500' },
  btnDisabled: { opacity: 0.6 },
});

const selectorStyles = StyleSheet.create({
  container: { gap: 6, marginTop: 4 },
  label: { color: '#aaa', fontSize: 13, fontWeight: '600', marginBottom: 4 },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: '#1a1a1a',
    borderWidth: 1,
    borderColor: '#2a2a2a',
    borderRadius: 10,
    padding: 12,
  },
  rowSelected: {
    borderColor: '#6C63FF',
    backgroundColor: '#0f0a1f',
  },
  radio: {
    width: 18,
    height: 18,
    borderRadius: 9,
    borderWidth: 2,
    borderColor: '#444',
  },
  radioSelected: {
    borderColor: '#6C63FF',
    backgroundColor: '#6C63FF',
  },
  info: { flex: 1 },
  name: { color: '#fff', fontSize: 14, fontWeight: '500' },
  url: { color: '#555', fontSize: 11, marginTop: 2 },
  disabled: { color: '#ff6b6b', fontSize: 11 },
});
