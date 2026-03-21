import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import type { SessionData } from './HomeScreen';
import { getVoiceProvider } from '../voice/provider';
import type { VoiceState } from '../voice/types';

type Props = {
  session: SessionData;
  onEnd: () => void;
  onSwitchToText: () => void;
};

const voiceProvider = getVoiceProvider();

export default function VoiceSessionScreen({ session, onEnd, onSwitchToText }: Props) {
  const [voice, setVoice] = useState<VoiceState>(voiceProvider.getState());
  const endHandledRef = useRef(false);

  useEffect(() => {
    const unsubscribe = voiceProvider.subscribe((state) => {
      setVoice(state);
    });
    return unsubscribe;
  }, []);

  useEffect(() => {
    endHandledRef.current = false;
    void voiceProvider.start(session.userIdentity);
  }, [session.userIdentity]);

  useEffect(() => {
    if (voice.endTick > 0 && !endHandledRef.current) {
      endHandledRef.current = true;
      onEnd();
    }
  }, [onEnd, voice.endTick]);

  const statusLabel = useMemo(() => {
    if (voice.status === 'connecting') {
      if (voice.connectStage === 'audio') return 'Ses kuruluyor...';
      if (voice.connectStage === 'joining') return 'Oturuma katiliniyor...';
      return 'Baglanti baslatiliyor...';
    }
    if (voice.status === 'listening') return 'Aktif (dinliyor)';
    if (voice.status === 'speaking') return 'Aktif (konusuyor)';
    return 'Baglanti hatasi';
  }, [voice.connectStage, voice.status]);

  function handleMuteToggle() {
    if (voice.status === 'connecting' || voice.status === 'error') return;
    voiceProvider.setMuted(!voice.isMuted);
  }

  function handleEndCall() {
    endHandledRef.current = true;
    voiceProvider.stop();
    onEnd();
  }

  return (
    <View style={styles.container}>
      <View style={styles.centerWrap}>
        {voice.status === 'connecting' ? (
          <>
            <ActivityIndicator size="large" color="#4A7C59" />
            <Text style={styles.statusText}>{statusLabel}</Text>
          </>
        ) : voice.status === 'error' ? (
          <>
            <Ionicons name="alert-circle-outline" size={48} color="#D45454" />
            <Text style={styles.errorText}>{voice.errorMessage ?? 'Baglanti hatasi'}</Text>
          </>
        ) : (
          <>
            <Ionicons
              name={voice.status === 'speaking' ? 'volume-high' : 'mic'}
              size={52}
              color="#4A7C59"
            />
            <Text style={styles.statusText}>{statusLabel}</Text>
          </>
        )}
      </View>

      <View style={styles.controlsRow}>
        <TouchableOpacity
          style={[styles.controlBtn, styles.textModeBtn]}
          onPress={onSwitchToText}
          activeOpacity={0.9}
        >
          <Ionicons name="chatbubble-ellipses-outline" size={18} color="#6B5D4F" />
          <Text style={styles.textModeText}>Yazi Modu</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.controlBtn, styles.muteBtn, voice.isMuted && styles.muteBtnActive]}
          onPress={handleMuteToggle}
          disabled={voice.status === 'connecting' || voice.status === 'error' || voice.isEnding}
          activeOpacity={0.9}
        >
          <Ionicons name={voice.isMuted ? 'mic-off' : 'mic'} size={18} color="#fff" />
          <Text style={styles.controlText}>{voice.isMuted ? 'Unmute' : 'Mute'}</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.controlBtn, styles.endBtn]}
          onPress={handleEndCall}
          disabled={voice.isEnding}
          activeOpacity={0.9}
        >
          {voice.isEnding ? (
            <ActivityIndicator color="#fff" size="small" />
          ) : (
            <>
              <Ionicons name="call-outline" size={18} color="#fff" />
              <Text style={styles.controlText}>Bitir</Text>
            </>
          )}
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    paddingHorizontal: 18,
    paddingVertical: 20,
    justifyContent: 'space-between',
  },
  centerWrap: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 10,
  },
  statusText: {
    color: '#5F7063',
    fontSize: 15,
    fontWeight: '700',
    textAlign: 'center',
  },
  errorText: {
    color: '#C44747',
    fontSize: 14,
    lineHeight: 20,
    textAlign: 'center',
    paddingHorizontal: 12,
  },
  controlsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    paddingBottom: 8,
  },
  controlBtn: {
    flex: 1,
    minHeight: 48,
    borderRadius: 14,
    alignItems: 'center',
    justifyContent: 'center',
    flexDirection: 'row',
    gap: 8,
  },
  textModeBtn: {
    backgroundColor: '#EFE6DB',
  },
  textModeText: {
    color: '#6B5D4F',
    fontSize: 13,
    fontWeight: '700',
  },
  muteBtn: {
    backgroundColor: '#5B6E5F',
  },
  muteBtnActive: {
    backgroundColor: '#3F4D42',
  },
  endBtn: {
    backgroundColor: '#B64B38',
  },
  controlText: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '700',
  },
});

