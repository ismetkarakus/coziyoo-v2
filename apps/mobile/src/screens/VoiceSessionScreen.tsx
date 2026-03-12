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
} from 'react-native';
import { StatusBar } from 'react-native';
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
};

export default function VoiceSessionScreen({ session, onEnd }: Props) {
  const intentionalEnd = useRef(false);
  // Don't connect until audio session is fully configured.
  // LiveKit docs: configureAudio must be called before connecting to a room.
  const [audioReady, setAudioReady] = useState(false);
  const [audioError, setAudioError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;

    async function setupAudioSession() {
      setAudioReady(false);
      setAudioError(null);

      try {
        if (Platform.OS === 'android') {
          const granted = await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.RECORD_AUDIO);
          if (granted !== PermissionsAndroid.RESULTS.GRANTED) {
            throw new Error('Microphone permission is required to start a voice session.');
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
          setAudioError(err instanceof Error ? err.message : 'Failed to configure audio session.');
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
    // Unexpected disconnect — prompt user
    Alert.alert(
      'Disconnected',
      'The session was interrupted. What would you like to do?',
      [
        { text: 'End Session', style: 'destructive', onPress: onEnd },
        { text: 'Dismiss', style: 'cancel' },
      ]
    );
  }

  function handleEnd() {
    intentionalEnd.current = true;
    onEnd();
  }

  if (audioError) {
    return (
      <View style={styles.setupContainer}>
        <Text style={styles.setupTitle}>Audio setup failed</Text>
        <Text style={styles.setupMessage}>{audioError}</Text>
        <TouchableOpacity style={styles.setupButton} onPress={onEnd}>
          <Text style={styles.setupButtonText}>Back</Text>
        </TouchableOpacity>
      </View>
    );
  }

  if (!audioReady) {
    return (
      <View style={styles.setupContainer}>
        <Text style={styles.setupTitle}>Preparing audio…</Text>
        <Text style={styles.setupMessage}>Configuring microphone and speaker for voice chat.</Text>
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
      onDisconnected={handleDisconnected}
    >
      <SessionView onEnd={handleEnd} roomName={session.roomName} />
    </LiveKitRoom>
  );
}

type SessionViewProps = {
  onEnd: () => void;
  roomName: string;
};

function SessionView({ onEnd, roomName }: SessionViewProps) {
  const room = useRoomContext();
  useIOSAudioManagement(room, true);
  const { localParticipant, isMicrophoneEnabled } = useLocalParticipant();
  const participants = useParticipants();

  const agentParticipant = participants.find(
    (p) => p.identity !== localParticipant.identity
  );

  const isAgentSpeaking = agentParticipant?.isSpeaking ?? false;
  const isUserSpeaking = localParticipant.isSpeaking;
  const connectionState = room.state;

  const pulseAnim = useRef(new Animated.Value(1)).current;
  const [actionBanner, setActionBanner] = useState<string | null>(null);
  const processedIds = useRef(new Set<string>());
  const bannerTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Subscribe to agent-action data channel messages
  useEffect(() => {
    function handleData(
      payload: Uint8Array,
      _participant: unknown,
      _kind: unknown,
      topic?: string
    ) {
      if (topic !== 'agent-action') return;
      try {
        const msg = JSON.parse(new TextDecoder().decode(payload)) as AgentActionEnvelope;
        if (msg.type !== 'action' || !msg.requestId) return;
        if (processedIds.current.has(msg.requestId)) return;
        processedIds.current.add(msg.requestId);

        const { name, params } = msg.action;
        let banner: string;
        switch (name) {
          case 'navigate':
            banner = `Go to: ${params.screen as string}`;
            break;
          case 'add_to_cart':
            banner = `Added: ${params.productName as string} ×${params.quantity as number}`;
            break;
          case 'show_order_summary':
            banner = `Order total: $${(params.total as number).toFixed(2)}`;
            break;
          default:
            return;
        }

        if (bannerTimer.current) clearTimeout(bannerTimer.current);
        setActionBanner(banner);
        bannerTimer.current = setTimeout(() => setActionBanner(null), 3500);
      } catch {
        // ignore malformed messages
      }
    }

    room.on(RoomEvent.DataReceived, handleData);
    return () => {
      room.off(RoomEvent.DataReceived, handleData);
      if (bannerTimer.current) clearTimeout(bannerTimer.current);
    };
  }, [room]);

  useEffect(() => {
    if (isAgentSpeaking) {
      const pulse = Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, {
            toValue: 1.25,
            duration: 600,
            useNativeDriver: true,
          }),
          Animated.timing(pulseAnim, {
            toValue: 1,
            duration: 600,
            useNativeDriver: true,
          }),
        ])
      );
      pulse.start();
      return () => pulse.stop();
    } else {
      pulseAnim.setValue(1);
    }
  }, [isAgentSpeaking, pulseAnim]);

  function toggleMic() {
    localParticipant.setMicrophoneEnabled(!isMicrophoneEnabled);
  }

  function handleEnd() {
    Alert.alert('End Session', 'Are you sure you want to end this session?', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'End',
        style: 'destructive',
        onPress: () => {
          room.disconnect();
          onEnd();
        },
      },
    ]);
  }

  function getStatusText() {
    switch (connectionState) {
      case ConnectionState.Connecting:
        return 'Connecting...';
      case ConnectionState.Reconnecting:
        return 'Reconnecting...';
      case ConnectionState.Disconnected:
        return 'Disconnected';
      default:
        if (!agentParticipant) return 'Waiting for agent...';
        if (isAgentSpeaking) return 'Agent is speaking';
        if (isUserSpeaking) return 'Listening...';
        return 'Agent is ready';
    }
  }

  const connected = connectionState === ConnectionState.Connected;

  return (
    <View style={styles.container}>
      <StatusBar barStyle="light-content" />

      {actionBanner && (
        <View style={styles.actionBanner}>
          <Text style={styles.actionBannerText}>{actionBanner}</Text>
        </View>
      )}

      <View style={styles.header}>
        <Text style={styles.roomLabel}>Room</Text>
        <Text style={styles.roomName} numberOfLines={1}>{roomName}</Text>
        <View style={[styles.dot, connected ? styles.dotConnected : styles.dotIdle]} />
      </View>

      <View style={styles.center}>
        {/* Agent avatar with pulse animation when speaking */}
        <Animated.View
          style={[
            styles.agentRing,
            isAgentSpeaking && styles.agentRingSpeaking,
            { transform: [{ scale: pulseAnim }] },
          ]}
        >
          <View
            style={[
              styles.agentCircle,
              isAgentSpeaking && styles.agentCircleSpeaking,
            ]}
          >
            <Text style={styles.agentIcon}>AI</Text>
          </View>
        </Animated.View>

        <Text style={styles.statusText}>{getStatusText()}</Text>

        {isUserSpeaking && (
          <Text style={styles.speakingIndicator}>You are speaking</Text>
        )}
      </View>

      <View style={styles.controls}>
        {/* Mic toggle */}
        <TouchableOpacity
          style={[styles.controlBtn, !isMicrophoneEnabled && styles.controlBtnMuted]}
          onPress={toggleMic}
          activeOpacity={0.8}
        >
          <View style={[styles.iconCircle, !isMicrophoneEnabled && styles.iconCircleMuted]}>
            <Text style={styles.iconText}>{isMicrophoneEnabled ? 'MIC' : 'OFF'}</Text>
          </View>
          <Text style={styles.controlLabel}>
            {isMicrophoneEnabled ? 'Mute' : 'Unmute'}
          </Text>
        </TouchableOpacity>

        {/* End session */}
        <TouchableOpacity
          style={[styles.controlBtn, styles.controlBtnEnd]}
          onPress={handleEnd}
          activeOpacity={0.8}
        >
          <View style={[styles.iconCircle, styles.iconCircleEnd]}>
            <Text style={styles.iconText}>END</Text>
          </View>
          <Text style={styles.controlLabel}>End</Text>
        </TouchableOpacity>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0a0a0a',
  },
  setupContainer: {
    flex: 1,
    backgroundColor: '#0a0a0a',
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
    gap: 10,
  },
  setupTitle: {
    color: '#fff',
    fontSize: 20,
    fontWeight: '700',
  },
  setupMessage: {
    color: '#aab4d6',
    fontSize: 14,
    textAlign: 'center',
    lineHeight: 20,
  },
  setupButton: {
    marginTop: 8,
    backgroundColor: '#6C63FF',
    borderRadius: 10,
    paddingHorizontal: 18,
    paddingVertical: 12,
  },
  setupButtonText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
  },
  header: {
    paddingTop: 64,
    paddingHorizontal: 24,
    alignItems: 'center',
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 8,
  },
  roomLabel: {
    color: '#555',
    fontSize: 12,
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  roomName: {
    color: '#aaa',
    fontSize: 12,
    flexShrink: 1,
    maxWidth: 200,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  dotConnected: {
    backgroundColor: '#4ade80',
  },
  dotIdle: {
    backgroundColor: '#555',
  },
  center: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 24,
  },
  agentRing: {
    width: 160,
    height: 160,
    borderRadius: 80,
    borderWidth: 2,
    borderColor: '#2a2a2a',
    alignItems: 'center',
    justifyContent: 'center',
  },
  agentRingSpeaking: {
    borderColor: '#6C63FF',
    borderWidth: 3,
  },
  agentCircle: {
    width: 132,
    height: 132,
    borderRadius: 66,
    backgroundColor: '#1a1a1a',
    alignItems: 'center',
    justifyContent: 'center',
  },
  agentCircleSpeaking: {
    backgroundColor: '#1e1a3a',
  },
  agentIcon: {
    color: '#6C63FF',
    fontSize: 28,
    fontWeight: '700',
    letterSpacing: 2,
  },
  statusText: {
    color: '#ccc',
    fontSize: 16,
    fontWeight: '500',
  },
  speakingIndicator: {
    color: '#6C63FF',
    fontSize: 13,
    marginTop: -8,
  },
  controls: {
    flexDirection: 'row',
    justifyContent: 'center',
    gap: 24,
    paddingBottom: 56,
    paddingHorizontal: 32,
  },
  controlBtn: {
    width: 88,
    height: 88,
    borderRadius: 44,
    backgroundColor: '#1a1a1a',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 4,
  },
  controlBtnMuted: {
    backgroundColor: '#2a1a1a',
    borderWidth: 1,
    borderColor: '#ff6b6b',
  },
  controlBtnEnd: {
    backgroundColor: '#2a0a0a',
    borderWidth: 1,
    borderColor: '#ff4444',
  },
  iconCircle: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: '#2a2a2a',
    alignItems: 'center',
    justifyContent: 'center',
  },
  iconCircleMuted: {
    backgroundColor: '#3a1a1a',
  },
  iconCircleEnd: {
    backgroundColor: '#3a0a0a',
  },
  iconText: {
    color: '#fff',
    fontSize: 11,
    fontWeight: '700',
    letterSpacing: 1,
  },
  controlLabel: {
    color: '#888',
    fontSize: 11,
  },
  actionBanner: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    backgroundColor: '#6C63FF',
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
