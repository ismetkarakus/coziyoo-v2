'use client';

import { type ComponentProps, useEffect, useRef, useState } from 'react';
import { Track } from 'livekit-client';
import {
  AudioLines,
  Loader,
  MessageSquareTextIcon,
  Mic,
  SendHorizontal,
  Square,
} from 'lucide-react';
import { type MotionProps, motion } from 'motion/react';
import { useChat } from '@livekit/components-react';
import { AgentDisconnectButton } from '@/components/agents-ui/agent-disconnect-button';
import { AgentTrackControl } from '@/components/agents-ui/agent-track-control';
import {
  AgentTrackToggle,
  agentTrackToggleVariants,
} from '@/components/agents-ui/agent-track-toggle';
import { Button } from '@/components/ui/button';
import { Toggle } from '@/components/ui/toggle';
import {
  type UseInputControlsProps,
  useInputControls,
  usePublishPermissions,
} from '@/hooks/agents-ui/use-agent-control-bar';
import { useI18n } from '@/lib/i18n';
import { cn } from '@/lib/shadcn/utils';

const LK_TOGGLE_VARIANT_1 = [
  'data-[state=off]:bg-accent data-[state=off]:hover:bg-foreground/10',
  'data-[state=off]:[&_~_button]:bg-accent data-[state=off]:[&_~_button]:hover:bg-foreground/10',
  'data-[state=off]:border-border data-[state=off]:hover:border-foreground/12',
  'data-[state=off]:[&_~_button]:border-border data-[state=off]:[&_~_button]:hover:border-foreground/12',
  'data-[state=off]:text-destructive data-[state=off]:hover:text-destructive data-[state=off]:focus:text-destructive',
  'data-[state=off]:focus-visible:ring-foreground/12 data-[state=off]:focus-visible:border-ring',
  'dark:data-[state=off]:[&_~_button]:bg-accent dark:data-[state=off]:[&_~_button]:hover:bg-foreground/10',
];

const LK_TOGGLE_VARIANT_2 = [
  'data-[state=off]:bg-accent data-[state=off]:hover:bg-foreground/10',
  'data-[state=off]:border-border data-[state=off]:hover:border-foreground/12',
  'data-[state=off]:focus-visible:border-ring data-[state=off]:focus-visible:ring-foreground/12',
  'data-[state=off]:text-foreground data-[state=off]:hover:text-foreground data-[state=off]:focus:text-foreground',
  'data-[state=on]:bg-blue-500/20 data-[state=on]:hover:bg-blue-500/30',
  'data-[state=on]:border-blue-700/10 data-[state=on]:text-blue-700 data-[state=on]:ring-blue-700/30',
  'data-[state=on]:focus-visible:border-blue-700/50',
  'dark:data-[state=on]:bg-blue-500/20 dark:data-[state=on]:text-blue-300',
];

const MOTION_PROPS: MotionProps = {
  variants: {
    hidden: {
      height: 0,
      opacity: 0,
      marginBottom: 0,
    },
    visible: {
      height: 'auto',
      opacity: 1,
      marginBottom: 12,
    },
  },
  initial: 'hidden',
  transition: {
    duration: 0.3,
    ease: 'easeOut',
  },
};

interface AgentChatInputProps {
  chatOpen: boolean;
  onSend?: (message: string) => void;
  onTranscribe?: (payload: { audioBase64: string; mimeType: string }) => Promise<string>;
  onInterrupt?: () => void;
  className?: string;
}

function AgentChatInput({
  chatOpen,
  onSend = async () => {},
  onTranscribe,
  onInterrupt,
  className,
}: AgentChatInputProps) {
  const { t } = useI18n();
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const [isSending, setIsSending] = useState(false);
  const [isRecording, setIsRecording] = useState(false);
  const [isAutoListening, setIsAutoListening] = useState(false);
  const [message, setMessage] = useState<string>('');
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const mediaChunksRef = useRef<Blob[]>([]);
  const mediaStreamRef = useRef<MediaStream | null>(null);
  const autoEnabledRef = useRef(false);
  const vadTimerRef = useRef<number | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const isDisabled = isSending || message.trim().length === 0;

  const handleSend = async () => {
    if (isDisabled) {
      return;
    }

    try {
      setIsSending(true);
      await onSend(message.trim());
      setMessage('');
    } catch (error) {
      console.error(error);
    } finally {
      setIsSending(false);
    }
  };

  const handleKeyDown = async (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleButtonClick = async () => {
    if (isDisabled) return;
    await handleSend();
  };

  const blobToBase64 = async (blob: Blob) => {
    const bytes = new Uint8Array(await blob.arrayBuffer());
    let binary = '';
    const chunkSize = 0x8000;
    for (let index = 0; index < bytes.length; index += chunkSize) {
      binary += String.fromCharCode(...bytes.subarray(index, index + chunkSize));
    }
    return btoa(binary);
  };

  const cleanupRecording = () => {
    if (vadTimerRef.current) {
      window.clearInterval(vadTimerRef.current);
      vadTimerRef.current = null;
    }
    if (audioContextRef.current) {
      audioContextRef.current.close().catch(() => undefined);
      audioContextRef.current = null;
    }
    analyserRef.current = null;
    mediaRecorderRef.current = null;
    mediaChunksRef.current = [];
    if (mediaStreamRef.current) {
      mediaStreamRef.current.getTracks().forEach((track) => track.stop());
      mediaStreamRef.current = null;
    }
    setIsRecording(false);
  };

  const stopRecording = () => {
    const recorder = mediaRecorderRef.current;
    if (!recorder || recorder.state === 'inactive') return;
    recorder.stop();
  };

  const startRecording = async () => {
    if (!onTranscribe || isSending || isRecording || !chatOpen) return;
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    mediaStreamRef.current = stream;

    const preferredMimeTypes = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'];
    const mimeType =
      preferredMimeTypes.find((candidate) => MediaRecorder.isTypeSupported(candidate)) ??
      'audio/webm';
    const recorder = new MediaRecorder(stream, { mimeType });
    mediaRecorderRef.current = recorder;
    mediaChunksRef.current = [];

    recorder.ondataavailable = (event: BlobEvent) => {
      if (event.data.size > 0) {
        mediaChunksRef.current.push(event.data);
      }
    };

    recorder.onstop = async () => {
      try {
        const blob = new Blob(mediaChunksRef.current, { type: mimeType });
        if (blob.size === 0) return;
        setIsSending(true);
        onInterrupt?.();
        const audioBase64 = await blobToBase64(blob);
        const text = await onTranscribe({ audioBase64, mimeType });
        const transcribed = text.trim();
        if (!transcribed) return;
        setMessage(transcribed);
        await onSend(transcribed);
        setMessage('');
      } catch (error) {
        console.error(error);
      } finally {
        setIsSending(false);
        cleanupRecording();
      }
    };

    recorder.start();
    setIsRecording(true);
  };

  const stopAutoListening = () => {
    autoEnabledRef.current = false;
    setIsAutoListening(false);
    stopRecording();
    cleanupRecording();
  };

  const startAutoListeningCycle = async () => {
    if (!autoEnabledRef.current || !onTranscribe || isSending || isRecording) return;

    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    mediaStreamRef.current = stream;

    const preferredMimeTypes = ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4'];
    const mimeType =
      preferredMimeTypes.find((candidate) => MediaRecorder.isTypeSupported(candidate)) ??
      'audio/webm';
    const recorder = new MediaRecorder(stream, { mimeType });
    mediaRecorderRef.current = recorder;
    mediaChunksRef.current = [];

    const context = new AudioContext();
    audioContextRef.current = context;
    const source = context.createMediaStreamSource(stream);
    const analyser = context.createAnalyser();
    analyser.fftSize = 2048;
    source.connect(analyser);
    analyserRef.current = analyser;

    let hasSpeech = false;
    let lastVoiceTs = Date.now();
    const startTs = Date.now();
    const SILENCE_MS = 1100;
    const MAX_MS = 12000;
    const THRESHOLD = 0.018;

    recorder.ondataavailable = (event: BlobEvent) => {
      if (event.data.size > 0) {
        mediaChunksRef.current.push(event.data);
      }
    };

    const data = new Uint8Array(analyser.frequencyBinCount);
    recorder.start(250);
    setIsRecording(true);

    vadTimerRef.current = window.setInterval(() => {
      analyser.getByteTimeDomainData(data);
      let sum = 0;
      for (let i = 0; i < data.length; i += 1) {
        const v = (data[i] - 128) / 128;
        sum += v * v;
      }
      const rms = Math.sqrt(sum / data.length);
      const now = Date.now();

      if (rms > THRESHOLD) {
        hasSpeech = true;
        lastVoiceTs = now;
        onInterrupt?.();
      }

      if (hasSpeech && now - lastVoiceTs >= SILENCE_MS) {
        stopRecording();
        return;
      }

      if (now - startTs >= MAX_MS) {
        stopRecording();
      }
    }, 120);

    recorder.onstop = async () => {
      try {
        if (!autoEnabledRef.current) {
          cleanupRecording();
          return;
        }
        const blob = new Blob(mediaChunksRef.current, { type: mimeType });
        if (blob.size > 0 && hasSpeech) {
          setIsSending(true);
          onInterrupt?.();
          const audioBase64 = await blobToBase64(blob);
          const text = await onTranscribe({ audioBase64, mimeType });
          const transcribed = text.trim();
          if (transcribed) {
            setMessage(transcribed);
            await onSend(transcribed);
            setMessage('');
          }
        }
      } catch (error) {
        console.error(error);
      } finally {
        setIsSending(false);
        cleanupRecording();
        if (autoEnabledRef.current) {
          startAutoListeningCycle().catch((error) => {
            console.error(error);
            stopAutoListening();
          });
        }
      }
    };
  };

  const toggleAutoListening = () => {
    if (isAutoListening) {
      stopAutoListening();
      return;
    }
    autoEnabledRef.current = true;
    setIsAutoListening(true);
    startAutoListeningCycle().catch((error) => {
      console.error(error);
      stopAutoListening();
    });
  };

  useEffect(() => {
    if (chatOpen) return;
    // when not disabled refocus on input
    inputRef.current?.focus();
  }, [chatOpen]);

  useEffect(() => {
    if (chatOpen) return;
    if (isAutoListening) {
      stopAutoListening();
    }
  }, [chatOpen, isAutoListening]);

  useEffect(() => {
    return () => {
      stopAutoListening();
    };
  }, []);

  return (
    <div className={cn('mb-3 flex grow items-end gap-2 rounded-md pl-1 text-sm', className)}>
      <Button
        size="icon"
        type="button"
        disabled={!chatOpen || isSending}
        variant="secondary"
        title={isRecording ? t('stopRecording') : t('recordAndTranscribe')}
        onClick={isRecording ? stopRecording : startRecording}
        className="self-end disabled:cursor-not-allowed"
      >
        {isRecording ? <Square /> : <Mic />}
      </Button>
      <Button
        size="icon"
        type="button"
        disabled={!chatOpen || isSending}
        variant={isAutoListening ? 'default' : 'secondary'}
        title={isAutoListening ? t('stopAutoListen') : t('startAutoListen')}
        onClick={toggleAutoListening}
        className="self-end disabled:cursor-not-allowed"
      >
        <AudioLines />
      </Button>
      <textarea
        autoFocus
        ref={inputRef}
        value={message}
        disabled={!chatOpen || isSending}
        placeholder={t('typeSomething')}
        onKeyDown={handleKeyDown}
        onChange={(e) => setMessage(e.target.value)}
        className="field-sizing-content max-h-16 min-h-8 flex-1 resize-none py-2 [scrollbar-width:thin] focus:outline-none disabled:cursor-not-allowed disabled:opacity-50"
      />
      <Button
        size="icon"
        type="button"
        disabled={isDisabled}
        variant={isDisabled ? 'secondary' : 'default'}
        title={isSending ? t('sending') : t('send')}
        onClick={handleButtonClick}
        className="self-end disabled:cursor-not-allowed"
      >
        {isSending ? <Loader className="animate-spin" /> : <SendHorizontal />}
      </Button>
    </div>
  );
}

/** Configuration for which controls to display in the AgentControlBar. */
export interface AgentControlBarControls {
  /**
   * Whether to show the leave/disconnect button.
   *
   * @defaultValue true
   */
  leave?: boolean;
  /**
   * Whether to show the camera toggle control.
   *
   * @defaultValue true (if camera publish permission is granted)
   */
  camera?: boolean;
  /**
   * Whether to show the microphone toggle control.
   *
   * @defaultValue true (if microphone publish permission is granted)
   */
  microphone?: boolean;
  /**
   * Whether to show the screen share toggle control.
   *
   * @defaultValue true (if screen share publish permission is granted)
   */
  screenShare?: boolean;
  /**
   * Whether to show the chat toggle control.
   *
   * @defaultValue true (if data publish permission is granted)
   */
  chat?: boolean;
}

export interface AgentControlBarProps extends UseInputControlsProps {
  /**
   * The visual style of the control bar.
   *
   * @default 'default'
   */
  variant?: 'default' | 'outline' | 'livekit';
  /**
   * This takes an object with the following keys: `leave`, `microphone`, `screenShare`, `camera`,
   * `chat`. Each key maps to a boolean value that determines whether the control is displayed.
   *
   * @default
   * {
   *   leave: true,
   *   microphone: true,
   *   screenShare: true,
   *   camera: true,
   *   chat: true,
   * }
   */
  controls?: AgentControlBarControls;
  /**
   * Whether to save user choices.
   *
   * @default true
   */
  saveUserChoices?: boolean;
  /**
   * Whether the agent is connected to a session.
   *
   * @default false
   */
  isConnected?: boolean;
  /**
   * Whether the chat input interface is open.
   *
   * @default false
   */
  isChatOpen?: boolean;
  /** The callback for when the user disconnects. */
  onDisconnect?: () => void;
  /** Optional custom text sender (for backend chat APIs). */
  onSendMessage?: (message: string) => Promise<void> | void;
  /** Optional callback invoked when user starts speaking again (barge-in). */
  onInterrupt?: () => void;
  /** The callback for when the chat is opened or closed. */
  onIsChatOpenChange?: (open: boolean) => void;
  /** The callback for when a device error occurs. */
  onDeviceError?: (error: { source: Track.Source; error: Error }) => void;
}

/**
 * A control bar specifically designed for voice assistant interfaces. Provides controls for
 * microphone, camera, screen share, chat, and disconnect. Includes an expandable chat input for
 * text-based interaction with the agent.
 *
 * @example
 *
 * ```tsx
 * <AgentControlBar
 *   variant="livekit"
 *   isConnected={true}
 *   onDisconnect={() => handleDisconnect()}
 *   controls={{
 *     microphone: true,
 *     camera: true,
 *     screenShare: false,
 *     chat: true,
 *     leave: true,
 *   }}
 * />;
 * ```
 *
 * @extends ComponentProps<'div'>
 */
export function AgentControlBar({
  variant = 'default',
  controls,
  isChatOpen = false,
  isConnected = false,
  saveUserChoices = true,
  onSendMessage,
  onInterrupt,
  onDisconnect,
  onDeviceError,
  onIsChatOpenChange,
  className,
  ...props
}: AgentControlBarProps & ComponentProps<'div'>) {
  const { t } = useI18n();
  const { send } = useChat();
  const publishPermissions = usePublishPermissions();
  const [isChatOpenUncontrolled, setIsChatOpenUncontrolled] = useState(isChatOpen);
  const {
    microphoneTrack,
    cameraToggle,
    microphoneToggle,
    screenShareToggle,
    handleAudioDeviceChange,
    handleVideoDeviceChange,
    handleMicrophoneDeviceSelectError,
    handleCameraDeviceSelectError,
  } = useInputControls({ onDeviceError, saveUserChoices });

  const handleSendMessage = async (message: string) => {
    if (onSendMessage) {
      await onSendMessage(message);
      return;
    }
    await send(message);
  };

  const handleTranscribe = async (payload: { audioBase64: string; mimeType: string }) => {
    const response = await fetch('/api/starter/stt-transcribe', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify(payload),
    });
    const raw = await response.text();
    const parsed = raw
      ? (JSON.parse(raw) as { data?: { text?: string }; error?: { message?: string } })
      : {};
    if (!response.ok) {
      throw new Error(parsed.error?.message ?? 'STT request failed');
    }
    return parsed.data?.text ?? '';
  };

  const visibleControls = {
    leave: controls?.leave ?? true,
    microphone: controls?.microphone ?? publishPermissions.microphone,
    screenShare: controls?.screenShare ?? publishPermissions.screenShare,
    camera: controls?.camera ?? publishPermissions.camera,
    chat: controls?.chat ?? publishPermissions.data,
  };

  const isEmpty = Object.values(visibleControls).every((value) => !value);

  if (isEmpty) {
    console.warn('AgentControlBar: `visibleControls` contains only false values.');
    return null;
  }

  return (
    <div
      aria-label="Voice assistant controls"
      className={cn(
        'bg-background border-input/50 dark:border-muted flex flex-col border p-3 drop-shadow-md/3',
        variant === 'livekit' ? 'rounded-[31px]' : 'rounded-lg',
        className
      )}
      {...props}
    >
      <motion.div
        {...MOTION_PROPS}
        inert={!(isChatOpen || isChatOpenUncontrolled)}
        animate={isChatOpen || isChatOpenUncontrolled ? 'visible' : 'hidden'}
        className="border-input/50 flex w-full items-start overflow-hidden border-b"
      >
        <AgentChatInput
          chatOpen={isChatOpen || isChatOpenUncontrolled}
          onSend={handleSendMessage}
          onTranscribe={handleTranscribe}
          onInterrupt={onInterrupt}
          className={cn(variant === 'livekit' && '[&_button]:rounded-full')}
        />
      </motion.div>

      <div className="flex gap-1">
        <div className="flex grow gap-1">
          {/* Toggle Microphone */}
          {visibleControls.microphone && (
            <AgentTrackControl
              variant={variant === 'outline' ? 'outline' : 'default'}
              kind="audioinput"
              aria-label="Toggle microphone"
              source={Track.Source.Microphone}
              pressed={microphoneToggle.enabled}
              disabled={microphoneToggle.pending}
              audioTrack={microphoneTrack}
              onPressedChange={microphoneToggle.toggle}
              onActiveDeviceChange={handleAudioDeviceChange}
              onMediaDeviceError={handleMicrophoneDeviceSelectError}
              className={cn(
                variant === 'livekit' && [
                  LK_TOGGLE_VARIANT_1,
                  'rounded-full [&_button:first-child]:rounded-l-full [&_button:last-child]:rounded-r-full',
                ]
              )}
            />
          )}

          {/* Toggle Camera */}
          {visibleControls.camera && (
            <AgentTrackControl
              variant={variant === 'outline' ? 'outline' : 'default'}
              kind="videoinput"
              aria-label="Toggle camera"
              source={Track.Source.Camera}
              pressed={cameraToggle.enabled}
              pending={cameraToggle.pending}
              disabled={cameraToggle.pending}
              onPressedChange={cameraToggle.toggle}
              onMediaDeviceError={handleCameraDeviceSelectError}
              onActiveDeviceChange={handleVideoDeviceChange}
              className={cn(
                variant === 'livekit' && [
                  LK_TOGGLE_VARIANT_1,
                  'rounded-full [&_button:first-child]:rounded-l-full [&_button:last-child]:rounded-r-full',
                ]
              )}
            />
          )}

          {/* Toggle Screen Share */}
          {visibleControls.screenShare && (
            <AgentTrackToggle
              variant={variant === 'outline' ? 'outline' : 'default'}
              aria-label="Toggle screen share"
              source={Track.Source.ScreenShare}
              pressed={screenShareToggle.enabled}
              disabled={screenShareToggle.pending}
              onPressedChange={screenShareToggle.toggle}
              className={cn(variant === 'livekit' && [LK_TOGGLE_VARIANT_2, 'rounded-full'])}
            />
          )}

          {/* Toggle Transcript */}
          {visibleControls.chat && (
            <Toggle
              variant={variant === 'outline' ? 'outline' : 'default'}
              pressed={isChatOpen || isChatOpenUncontrolled}
              aria-label="Toggle transcript"
              onPressedChange={(state) => {
                if (!onIsChatOpenChange) setIsChatOpenUncontrolled(state);
                else onIsChatOpenChange(state);
              }}
              className={agentTrackToggleVariants({
                variant: variant === 'outline' ? 'outline' : 'default',
                className: cn(variant === 'livekit' && [LK_TOGGLE_VARIANT_2, 'rounded-full']),
              })}
            >
              <MessageSquareTextIcon />
            </Toggle>
          )}
        </div>

        {/* Disconnect */}
        {visibleControls.leave && (
          <AgentDisconnectButton
            onClick={onDisconnect}
            disabled={!isConnected}
            className={cn(
              variant === 'livekit' &&
                'bg-destructive/10 dark:bg-destructive/10 text-destructive hover:bg-destructive/20 dark:hover:bg-destructive/20 focus:bg-destructive/20 focus-visible:ring-destructive/20 dark:focus-visible:ring-destructive/4 rounded-full font-mono text-xs font-bold tracking-wider'
            )}
          >
            <span className="hidden md:inline">{t('endCall')}</span>
            <span className="inline md:hidden">{t('end')}</span>
          </AgentDisconnectButton>
        )}
      </div>
    </div>
  );
}
