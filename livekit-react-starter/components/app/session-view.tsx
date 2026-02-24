'use client';

import React, { useEffect, useRef, useState } from 'react';
import { RoomEvent } from 'livekit-client';
import { AnimatePresence, motion } from 'motion/react';
import { useRoomContext, useSessionContext } from '@livekit/components-react';
import type { AppConfig } from '@/app-config';
import {
  AgentControlBar,
  type AgentControlBarControls,
} from '@/components/agents-ui/agent-control-bar';
import { ChatTranscript } from '@/components/app/chat-transcript';
import { TileLayout } from '@/components/app/tile-layout';
import { cn } from '@/lib/shadcn/utils';
import { Shimmer } from '../ai-elements/shimmer';

const MotionBottom = motion.create('div');

const MotionMessage = motion.create(Shimmer);

const BOTTOM_VIEW_MOTION_PROPS = {
  variants: {
    visible: {
      opacity: 1,
      translateY: '0%',
    },
    hidden: {
      opacity: 0,
      translateY: '100%',
    },
  },
  initial: 'hidden',
  animate: 'visible',
  exit: 'hidden',
  transition: {
    duration: 0.3,
    delay: 0.5,
    ease: 'easeOut',
  },
} as const;

const SHIMMER_MOTION_PROPS = {
  variants: {
    visible: {
      opacity: 1,
      transition: {
        ease: 'easeIn',
        duration: 0.5,
        delay: 0.8,
      },
    },
    hidden: {
      opacity: 0,
      transition: {
        ease: 'easeIn',
        duration: 0.5,
        delay: 0,
      },
    },
  },
  initial: 'hidden',
  animate: 'visible',
  exit: 'hidden',
} as const;

interface FadeProps {
  top?: boolean;
  bottom?: boolean;
  className?: string;
}

export function Fade({ top = false, bottom = false, className }: FadeProps) {
  return (
    <div
      className={cn(
        'from-background pointer-events-none h-4 bg-linear-to-b to-transparent',
        top && 'bg-linear-to-b',
        bottom && 'bg-linear-to-t',
        className
      )}
    />
  );
}

interface SessionViewProps {
  appConfig: AppConfig;
}

export const SessionView = ({
  appConfig,
  ...props
}: React.ComponentProps<'section'> & SessionViewProps) => {
  const session = useSessionContext();
  const room = useRoomContext();
  const [messages, setMessages] = useState<
    Array<{
      id: string;
      timestamp: number;
      message: string;
      isLocal: boolean;
    }>
  >([]);
  const [chatOpen, setChatOpen] = useState(false);
  const scrollAreaRef = useRef<HTMLDivElement>(null);
  const pendingChatRequestRef = useRef<AbortController | null>(null);

  const controls: AgentControlBarControls = {
    leave: true,
    microphone: true,
    chat: appConfig.supportsChatInput,
    camera: appConfig.supportsVideoInput,
    screenShare: appConfig.supportsScreenShare,
  };

  useEffect(() => {
    const onData = (payload: Uint8Array) => {
      try {
        const decoded = new TextDecoder().decode(payload);
        const parsed = JSON.parse(decoded) as { text?: string; ts?: string };
        const text = parsed.text?.trim();
        if (!text) return;
        setMessages((previous) => [
          ...previous,
          {
            id: crypto.randomUUID(),
            message: text,
            timestamp: parsed.ts ? new Date(parsed.ts).getTime() : Date.now(),
            isLocal: false,
          },
        ]);
        if ('speechSynthesis' in window) {
          const utterance = new SpeechSynthesisUtterance(text);
          window.speechSynthesis.cancel();
          window.speechSynthesis.speak(utterance);
        }
      } catch {
        // ignore non-chat payloads
      }
    };

    room.on(RoomEvent.DataReceived, onData);
    return () => {
      room.off(RoomEvent.DataReceived, onData);
      if ('speechSynthesis' in window) {
        window.speechSynthesis.cancel();
      }
    };
  }, [room]);

  useEffect(() => {
    const lastMessage = messages.at(-1);
    if (!lastMessage?.isLocal || !scrollAreaRef.current) return;
    scrollAreaRef.current.scrollTop = scrollAreaRef.current.scrollHeight;
  }, [messages]);

  const handleSendMessage = async (text: string) => {
    const trimmed = text.trim();
    if (!trimmed) return;

    setMessages((previous) => [
      ...previous,
      {
        id: crypto.randomUUID(),
        message: trimmed,
        timestamp: Date.now(),
        isLocal: true,
      },
    ]);

    if (pendingChatRequestRef.current) {
      pendingChatRequestRef.current.abort();
    }
    const controller = new AbortController();
    pendingChatRequestRef.current = controller;

    try {
      const response = await fetch('/api/starter/agent-chat', {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          roomName: room.name,
          text: trimmed,
        }),
        signal: controller.signal,
      });

      if (!response.ok) {
        const raw = await response.text();
        throw new Error(raw || 'Agent chat failed');
      }
    } catch (error) {
      if (error instanceof Error && error.name === 'AbortError') return;
      throw error;
    } finally {
      if (pendingChatRequestRef.current === controller) {
        pendingChatRequestRef.current = null;
      }
    }
  };

  const handleInterrupt = () => {
    if (!pendingChatRequestRef.current) return;
    pendingChatRequestRef.current.abort();
    pendingChatRequestRef.current = null;
    if ('speechSynthesis' in window) {
      window.speechSynthesis.cancel();
    }
  };

  return (
    <section className="bg-background relative z-10 h-svh w-svw overflow-hidden" {...props}>
      <Fade top className="absolute inset-x-4 top-0 z-10 h-40" />
      {/* transcript */}
      <ChatTranscript
        hidden={!chatOpen}
        messages={messages}
        className="space-y-3 transition-opacity duration-300 ease-out"
      />
      {/* Tile layout */}
      <TileLayout chatOpen={chatOpen} appConfig={appConfig} />
      {/* Bottom */}
      <MotionBottom
        {...BOTTOM_VIEW_MOTION_PROPS}
        className="fixed inset-x-3 bottom-0 z-50 md:inset-x-12"
      >
        {/* Pre-connect message */}
        {appConfig.isPreConnectBufferEnabled && (
          <AnimatePresence>
            {messages.length === 0 && (
              <MotionMessage
                key="pre-connect-message"
                duration={2}
                aria-hidden={messages.length > 0}
                {...SHIMMER_MOTION_PROPS}
                className="pointer-events-none mx-auto block w-full max-w-2xl pb-4 text-center text-sm font-semibold"
              >
                Agent is listening, ask it a question
              </MotionMessage>
            )}
          </AnimatePresence>
        )}
        <div className="bg-background relative mx-auto max-w-2xl pb-3 md:pb-12">
          <Fade bottom className="absolute inset-x-0 top-0 h-4 -translate-y-full" />
          <AgentControlBar
            variant="livekit"
            controls={controls}
            isChatOpen={chatOpen}
            isConnected={session.isConnected}
            onSendMessage={handleSendMessage}
            onInterrupt={handleInterrupt}
            onDisconnect={session.end}
            onIsChatOpenChange={setChatOpen}
          />
        </div>
      </MotionBottom>
    </section>
  );
};
