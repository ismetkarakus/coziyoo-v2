import React, { useEffect, useRef, useState } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  StyleSheet,
  Animated,
  Alert,
  PermissionsAndroid,
  Platform,
  ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import {
  AudioSession,
  AndroidAudioTypePresets,
  LiveKitRoom,
  useLocalParticipant,
  useIOSAudioManagement,
  useParticipants,
  useRoomContext,
} from '@livekit/react-native';
import { ConnectionState, RoomEvent } from 'livekit-client';
import type { SessionData } from './HomeScreen';
import { t } from '../copy/brandCopy';

type AgentActionEnvelope = {
  type: 'action';
  version: string;
  requestId: string;
  timestamp: string;
  action: {
    name: 'navigate' | 'add_to_cart' | 'show_order_summary';
    params: Record<string, unknown>;
  };
};

type Props = {
  session: SessionData;
  onEnd: () => void;
  onSwitchToText?: () => void;
};

const BAR_CONFIGS = [
  { maxHeight: 20, duration: 400, delay: 0 },
  { maxHeight: 28, duration: 360, delay: 100 },
  { maxHeight: 14, duration: 440, delay: 200 },
  { maxHeight: 32, duration: 380, delay: 80 },
  { maxHeight: 22, duration: 420, delay: 160 },
  { maxHeight: 18, duration: 460, delay: 240 },
  { maxHeight: 26, duration: 370, delay: 50 },
];

export default function VoiceSessionScreen({ session, onEnd, onSwitchToText }: Props) {
  const intentionalEnd = useRef(false);
  const [audioReady, setAudioReady] = useState(false);
  const [audioError, setAudioError] = useState<string | null>(null);
  const [sessionError, setSessionError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;

    async function setupAudioSession() {
      setAudioReady(false);
      setAudioError(null);

      try {
        if (Platform.OS === 'android') {
          const granted = await PermissionsAndroid.request(
            PermissionsAndroid.PERMISSIONS.RECORD_AUDIO,
          );
          if (granted !== PermissionsAndroid.RESULTS.GRANTED) {
            throw new Error('Mikrofon izni gerekiyor.');
          }
        }

        await AudioSession.configureAudio({
          ios: { defaultOutput: 'speaker' },
          android: { audioTypeOptions: AndroidAudioTypePresets.communication },
        });

        if (Platform.OS === 'ios') {
          await AudioSession.setAppleAudioConfiguration({
            audioCategory: 'playAndRecord',
            audioCategoryOptions: ['allowBluetooth', 'defaultToSpeaker'],
            audioMode: 'voiceChat',
          });
        }

        await AudioSession.startAudioSession();
        if (mounted) setAudioReady(true);
      } catch (err) {
        console.warn('[AudioSession] setup failed:', err);
        if (mounted) {
          setAudioError(
            err instanceof Error ? err.message : t('error.voice.setupTitle'),
          );
          setAudioReady(false);
        }
      }
    }

    void setupAudioSession();
    return () => {
      mounted = false;
      AudioSession.stopAudioSession();
    };
  }, []);

  function handleDisconnected() {
    if (intentionalEnd.current) {
      onEnd();
      return;
    }
    Alert.alert(t('headline.voice.disconnected'), t('helper.voice.disconnected'), [
      { text: t('cta.voice.end'), style: 'destructive', onPress: onEnd },
      { text: t('cta.voice.cancel'), style: 'cancel' },
    ]);
  }

  function handleEnd() {
    intentionalEnd.current = true;
    onEnd();
  }

  function handleConnected() {
    setSessionError(null);
  }

  function handleRoomError(error: Error) {
    console.warn('[LiveKitRoom] connection error:', error);
    setSessionError(t('error.voice.connectionTitle'));
  }

  function handleMediaDeviceFailure() {
    setSessionError(t('error.voice.mediaAccess'));
  }

  if (audioError) {
    return (
      <View style={styles.setupContainer}>
        <Text style={styles.setupTitle}>{t('error.voice.setupTitle')}</Text>
        <Text style={styles.setupMessage}>{audioError}</Text>
        <TouchableOpacity style={styles.setupButton} onPress={onEnd}>
          <Text style={styles.setupButtonText}>{t('cta.voice.back')}</Text>
        </TouchableOpacity>
      </View>
    );
  }

  if (!audioReady) {
    return (
      <View style={styles.setupContainer}>
        <ActivityIndicator size="large" color="#4A7C59" />
        <Text style={styles.setupTitle}>{t('status.voice.preparingTitle')}</Text>
        <Text style={styles.setupMessage}>{t('helper.voice.preparingBody')}</Text>
      </View>
    );
  }

  if (sessionError) {
    return (
      <View style={styles.setupContainer}>
        <Text style={styles.setupTitle}>{t('error.voice.connectionTitle')}</Text>
        <Text style={styles.setupMessage}>{sessionError}</Text>
        <TouchableOpacity style={styles.setupButton} onPress={onEnd}>
          <Text style={styles.setupButtonText}>{t('cta.voice.back')}</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <LiveKitRoom
      serverUrl={session.wsUrl}
      token={session.token}
      connect={audioReady}
      audio={true}
      video={false}
      onConnected={handleConnected}
      onDisconnected={handleDisconnected}
      onError={handleRoomError}
      onMediaDeviceFailure={handleMediaDeviceFailure}
    >
      <SessionView onEnd={handleEnd} onSwitchToText={onSwitchToText} />
    </LiveKitRoom>
  );
}

/* ------------------------------------------------------------------ */

type SessionViewProps = {
  onEnd: () => void;
  onSwitchToText?: () => void;
};

function SessionView({ onEnd, onSwitchToText }: SessionViewProps) {
  const room = useRoomContext();
  useIOSAudioManagement(room, true);
  const { localParticipant, isMicrophoneEnabled } = useLocalParticipant();
  const participants = useParticipants();
  const micPrimed = useRef(false);

  const agentParticipant = participants.find(
    (p) => p.identity !== localParticipant.identity,
  );
  const isAgentSpeaking = agentParticipant?.isSpeaking ?? false;
  const connectionState = room.state;
  const connected = connectionState === ConnectionState.Connected;

  const barAnims = useRef(BAR_CONFIGS.map(() => new Animated.Value(8))).current;
  const ring1Scale = useRef(new Animated.Value(1)).current;
  const ring2Scale = useRef(new Animated.Value(1)).current;

  const [actionBanner, setActionBanner] = useState<string | null>(null);
  const processedIds = useRef(new Set<string>());
  const bannerTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Prime microphone
  useEffect(() => {
    if (connectionState !== ConnectionState.Connected) {
      micPrimed.current = false;
      return;
    }
    if (micPrimed.current) return;
    micPrimed.current = true;
    void localParticipant.setMicrophoneEnabled(true).catch((error) => {
      console.warn('[LiveKitRoom] failed to enable microphone:', error);
      micPrimed.current = false;
    });
  }, [connectionState, localParticipant]);

  // Agent action data channel
  useEffect(() => {
    function handleData(
      payload: Uint8Array,
      _participant: unknown,
      _kind: unknown,
      topic?: string,
    ) {
      if (topic !== 'agent-action') return;
      try {
        const msg = JSON.parse(
          new TextDecoder().decode(payload),
        ) as AgentActionEnvelope;
        if (msg.type !== 'action' || !msg.requestId) return;
        if (processedIds.current.has(msg.requestId)) return;
        processedIds.current.add(msg.requestId);

        const { name, params } = msg.action;
        let banner: string;
        switch (name) {
          case 'navigate':
            banner = `${t('status.voice.navAction')}: ${params.screen as string}`;
            break;
          case 'add_to_cart':
            banner = `${t('status.voice.addedAction')}: ${params.productName as string} x${params.quantity as number}`;
            break;
          case 'show_order_summary':
            banner = `${t('status.voice.orderSummaryAction')}: ${(params.total as number).toFixed(2)} TL`;
            break;
          default:
            return;
        }
        if (bannerTimer.current) clearTimeout(bannerTimer.current);
        setActionBanner(banner);
        bannerTimer.current = setTimeout(() => setActionBanner(null), 3500);
      } catch {
        /* ignore */
      }
    }

    room.on(RoomEvent.DataReceived, handleData);
    return () => {
      room.off(RoomEvent.DataReceived, handleData);
      if (bannerTimer.current) clearTimeout(bannerTimer.current);
    };
  }, [room]);

  // Voice bar animations
  useEffect(() => {
    if (!connected) return;
    const timers: ReturnType<typeof setTimeout>[] = [];
    const loops: Animated.CompositeAnimation[] = [];

    BAR_CONFIGS.forEach((config, i) => {
      const loop = Animated.loop(
        Animated.sequence([
          Animated.timing(barAnims[i], {
            toValue: config.maxHeight,
            duration: config.duration,
            useNativeDriver: false,
          }),
          Animated.timing(barAnims[i], {
            toValue: 8,
            duration: config.duration,
            useNativeDriver: false,
          }),
        ]),
      );
      loops.push(loop);
      timers.push(setTimeout(() => loop.start(), config.delay));
    });

    return () => {
      loops.forEach((l) => l.stop());
      timers.forEach((t) => clearTimeout(t));
    };
  }, [connected, barAnims]);

  // Ring pulse animations
  useEffect(() => {
    const ring1Loop = Animated.loop(
      Animated.sequence([
        Animated.timing(ring1Scale, {
          toValue: 1.15,
          duration: 2000,
          useNativeDriver: true,
        }),
        Animated.timing(ring1Scale, {
          toValue: 1,
          duration: 2000,
          useNativeDriver: true,
        }),
      ]),
    );
    const ring2Loop = Animated.loop(
      Animated.sequence([
        Animated.timing(ring2Scale, {
          toValue: 1.25,
          duration: 2400,
          useNativeDriver: true,
        }),
        Animated.timing(ring2Scale, {
          toValue: 1,
          duration: 2400,
          useNativeDriver: true,
        }),
      ]),
    );

    ring1Loop.start();
    const timer = setTimeout(() => ring2Loop.start(), 500);
    return () => {
      ring1Loop.stop();
      ring2Loop.stop();
      clearTimeout(timer);
    };
  }, [ring1Scale, ring2Scale]);

  function toggleMic() {
    localParticipant.setMicrophoneEnabled(!isMicrophoneEnabled);
  }

  function getStatusText() {
    switch (connectionState) {
      case ConnectionState.Connecting:
        return t('status.voice.connecting');
      case ConnectionState.Reconnecting:
        return t('status.voice.reconnecting');
      case ConnectionState.Disconnected:
        return t('status.voice.disconnected');
      default:
        if (!agentParticipant) return t('status.voice.connecting');
        if (isAgentSpeaking) return t('status.voice.speaking');
        return t('status.voice.listening');
    }
  }

  return (
    <View style={styles.container}>
      {actionBanner && (
        <View style={styles.actionBanner}>
          <Text style={styles.actionBannerText}>{actionBanner}</Text>
        </View>
      )}

      <View style={styles.center}>
        <View style={styles.orbContainer}>
          <Animated.View
            style={[styles.ring, { transform: [{ scale: ring1Scale }] }]}
          />
          <Animated.View
            style={[styles.ring2, { transform: [{ scale: ring2Scale }] }]}
          />
          <View style={styles.orb}>
            <View style={styles.barsRow}>
              {barAnims.map((anim, i) => (
                <Animated.View
                  key={i}
                  style={[styles.voiceBar, { height: anim }]}
                />
              ))}
            </View>
          </View>
        </View>

        <Text style={styles.statusText}>{getStatusText()}</Text>
        <Text style={styles.subtitleText}>{t('helper.voice.subtitle')}</Text>
      </View>

      <View style={styles.bottomButtons}>
        {onSwitchToText ? (
          <TouchableOpacity style={styles.actionBtn} onPress={onSwitchToText}>
            <Ionicons
              name="chatbubble-ellipses-outline"
              size={22}
              color="#6B5D4F"
            />
          </TouchableOpacity>
        ) : (
          <View style={styles.actionBtnPlaceholder} />
        )}
        <TouchableOpacity style={styles.endBtn} onPress={onEnd}>
          <Ionicons
            name="call"
            size={20}
            color="#fff"
            style={styles.endIcon}
          />
        </TouchableOpacity>
        <TouchableOpacity style={styles.actionBtn} onPress={toggleMic}>
          <Ionicons
            name={isMicrophoneEnabled ? 'mic' : 'mic-off'}
            size={22}
            color="#6B5D4F"
          />
        </TouchableOpacity>
      </View>
    </View>
  );
}

/* ------------------------------------------------------------------ */

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#F5F1EB',
  },
  setupContainer: {
    flex: 1,
    backgroundColor: '#F5F1EB',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
    gap: 12,
  },
  setupTitle: {
    color: '#3D3229',
    fontSize: 18,
    fontWeight: '700',
  },
  setupMessage: {
    color: '#A89B8C',
    fontSize: 14,
    textAlign: 'center',
    lineHeight: 20,
  },
  setupButton: {
    marginTop: 8,
    backgroundColor: '#4A7C59',
    borderRadius: 12,
    paddingHorizontal: 24,
    paddingVertical: 12,
  },
  setupButtonText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 16,
  },
  orbContainer: {
    width: 180,
    height: 180,
    alignItems: 'center',
    justifyContent: 'center',
  },
  ring: {
    position: 'absolute',
    width: 170,
    height: 170,
    borderRadius: 85,
    borderWidth: 2,
    borderColor: 'rgba(74,124,89,0.18)',
  },
  ring2: {
    position: 'absolute',
    width: 160,
    height: 160,
    borderRadius: 80,
    borderWidth: 2,
    borderColor: 'rgba(74,124,89,0.12)',
  },
  orb: {
    width: 150,
    height: 150,
    borderRadius: 75,
    backgroundColor: '#4A7C59',
    alignItems: 'center',
    justifyContent: 'center',
    shadowColor: '#4A7C59',
    shadowOffset: { width: 0, height: 8 },
    shadowOpacity: 0.4,
    shadowRadius: 24,
    elevation: 12,
  },
  barsRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    height: 40,
  },
  voiceBar: {
    width: 4,
    borderRadius: 2,
    backgroundColor: 'rgba(255,255,255,0.8)',
  },
  statusText: {
    color: '#3D3229',
    fontSize: 17,
    fontWeight: '600',
  },
  subtitleText: {
    color: '#A89B8C',
    fontSize: 13,
    marginTop: -8,
  },
  bottomButtons: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 20,
    paddingBottom: 40,
    paddingHorizontal: 32,
  },
  actionBtn: {
    width: 50,
    height: 50,
    borderRadius: 25,
    backgroundColor: 'rgba(0,0,0,0.05)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  actionBtnPlaceholder: {
    width: 50,
    height: 50,
  },
  endBtn: {
    width: 58,
    height: 58,
    borderRadius: 29,
    backgroundColor: '#D45454',
    alignItems: 'center',
    justifyContent: 'center',
  },
  endIcon: {
    transform: [{ rotate: '135deg' }],
  },
  actionBanner: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    backgroundColor: '#4A7C59',
    paddingVertical: 10,
    paddingHorizontal: 16,
    zIndex: 10,
    alignItems: 'center',
  },
  actionBannerText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
  },
});
