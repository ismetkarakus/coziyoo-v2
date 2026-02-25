'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import type { AppConfig } from '@/app-config';
import { useVerboseSessionController } from '@/hooks/use-verbose-session-controller';
import { getOrCreateDeviceId } from '@/lib/device-id';
import {
  STARTER_AGENT_SETTINGS_DEFAULTS,
  type StarterAgentSettings,
  normalizeStarterAgentSettings,
} from '@/lib/starter-settings';
import { ThemeToggle } from './theme-toggle';

type SettingsResponse = { data?: StarterAgentSettings };
type BuildInfoResponse = { data?: { commitSha?: string | null; shortCommitSha?: string | null } };

interface AppProps {
  appConfig: AppConfig;
}

export function App({ appConfig }: AppProps) {
  const [deviceId, setDeviceId] = useState('');
  const [chatInput, setChatInput] = useState('');
  const [speechSupported, setSpeechSupported] = useState(false);
  const [speechListening, setSpeechListening] = useState(false);
  const [shortCommitSha, setShortCommitSha] = useState<string | null>(null);
  const [settings, setSettings] = useState<StarterAgentSettings>(STARTER_AGENT_SETTINGS_DEFAULTS);
  const [settingsLoaded, setSettingsLoaded] = useState(false);

  const controller = useVerboseSessionController({ deviceId, settings });

  useEffect(() => {
    setDeviceId(getOrCreateDeviceId());
    const hasSpeechApi =
      typeof window !== 'undefined' &&
      Boolean(
        (window as unknown as { SpeechRecognition?: unknown; webkitSpeechRecognition?: unknown })
          .SpeechRecognition ||
          (window as unknown as { SpeechRecognition?: unknown; webkitSpeechRecognition?: unknown })
            .webkitSpeechRecognition
      );
    setSpeechSupported(hasSpeechApi);
  }, []);

  useEffect(() => {
    if (!deviceId) {
      return;
    }
    const loadSettings = async () => {
      try {
        const response = await fetch(
          `/api/starter/agent-settings/${encodeURIComponent(deviceId)}`,
          {
            method: 'GET',
            cache: 'no-store',
          }
        );
        if (response.ok) {
          const payload = (await response.json()) as SettingsResponse;
          setSettings(normalizeStarterAgentSettings(payload.data));
        } else {
          setSettings(STARTER_AGENT_SETTINGS_DEFAULTS);
        }
      } catch {
        setSettings(STARTER_AGENT_SETTINGS_DEFAULTS);
      } finally {
        setSettingsLoaded(true);
      }
    };
    void loadSettings();
  }, [deviceId]);

  useEffect(() => {
    const loadBuildInfo = async () => {
      try {
        const response = await fetch('/api/build-info', {
          method: 'GET',
          cache: 'no-store',
        });
        if (!response.ok) return;
        const payload = (await response.json()) as BuildInfoResponse;
        const commit = payload.data?.shortCommitSha?.trim();
        if (commit) {
          setShortCommitSha(commit);
        }
      } catch {
        // noop
      }
    };
    void loadBuildInfo();
  }, []);

  const onSend = async (overrideText?: string) => {
    const value = (overrideText ?? chatInput).trim();
    if (!value) return;
    setChatInput('');
    await controller.sendChat(value);
  };

  const onSpeak = () => {
    if (!speechSupported || speechListening) return;
    const Ctor =
      (
        window as unknown as {
          SpeechRecognition?: new () => {
            lang: string;
            interimResults: boolean;
            maxAlternatives: number;
            onresult: ((event: unknown) => void) | null;
            onerror: ((event: unknown) => void) | null;
            onend: (() => void) | null;
            start: () => void;
          };
          webkitSpeechRecognition?: new () => {
            lang: string;
            interimResults: boolean;
            maxAlternatives: number;
            onresult: ((event: unknown) => void) | null;
            onerror: ((event: unknown) => void) | null;
            onend: (() => void) | null;
            start: () => void;
          };
        }
      ).SpeechRecognition ||
      (
        window as unknown as {
          SpeechRecognition?: new () => {
            lang: string;
            interimResults: boolean;
            maxAlternatives: number;
            onresult: ((event: unknown) => void) | null;
            onerror: ((event: unknown) => void) | null;
            onend: (() => void) | null;
            start: () => void;
          };
          webkitSpeechRecognition?: new () => {
            lang: string;
            interimResults: boolean;
            maxAlternatives: number;
            onresult: ((event: unknown) => void) | null;
            onerror: ((event: unknown) => void) | null;
            onend: (() => void) | null;
            start: () => void;
          };
        }
      ).webkitSpeechRecognition;
    if (!Ctor) return;

    const recognition = new Ctor();
    recognition.lang = settings.voiceLanguage || 'tr';
    recognition.interimResults = false;
    recognition.maxAlternatives = 1;
    recognition.onresult = (event) => {
      const resultList = (
        event as {
          results?: ArrayLike<ArrayLike<{ transcript?: string }>>;
        }
      ).results;
      const transcript = resultList?.[0]?.[0]?.transcript?.trim() ?? '';
      if (transcript) {
        void onSend(transcript);
      }
    };
    recognition.onerror = () => {
      setSpeechListening(false);
    };
    recognition.onend = () => {
      setSpeechListening(false);
    };

    setSpeechListening(true);
    recognition.start();
  };

  return (
    <main className="grid min-h-svh grid-cols-1 gap-3 bg-gradient-to-b from-slate-100 to-slate-200 p-3 text-slate-900 md:grid-cols-[380px_1fr_1fr] dark:from-slate-950 dark:to-slate-900 dark:text-slate-100">
      <section className="rounded-xl border bg-white/80 p-4 shadow-sm dark:bg-slate-900/80">
        <div className="mb-4 flex items-center justify-between gap-2">
          <h1 className="text-lg font-semibold">{appConfig.pageTitle}</h1>
          <ThemeToggle />
        </div>
        <p className="mb-2 text-xs text-slate-600 dark:text-slate-400">
          1 user + 1 agent session. New room is created on every connect.
        </p>
        <div className="space-y-2 rounded-lg border p-3 text-sm">
          <div className="flex items-center justify-between">
            <span>Status</span>
            <strong className="uppercase">{controller.connectionState}</strong>
          </div>
          <div className="flex items-center justify-between">
            <span>Room</span>
            <span className="font-mono text-xs">{controller.roomName ?? '-'}</span>
          </div>
          <div className="flex items-center justify-between">
            <span>Device</span>
            <span className="font-mono text-[11px]">{deviceId}</span>
          </div>
          <div className="flex items-center justify-between">
            <span>Agent</span>
            <span className="font-mono text-xs">{settings.agentName || '(default)'}</span>
          </div>
          <div className="flex items-center justify-between">
            <span>Commit</span>
            <span className="font-mono text-xs">{shortCommitSha ?? '-'}</span>
          </div>
        </div>
        <div className="mt-3 grid grid-cols-2 gap-2">
          <button
            type="button"
            className="rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white disabled:opacity-50 dark:bg-slate-100 dark:text-slate-900"
            onClick={controller.connect}
            disabled={controller.connectionState === 'connecting' || !settingsLoaded}
          >
            Connect
          </button>
          <button
            type="button"
            className="rounded-md border px-3 py-2 text-sm font-medium"
            onClick={controller.disconnect}
          >
            Disconnect
          </button>
          <button
            type="button"
            className="rounded-md border px-3 py-2 text-sm"
            onClick={controller.toggleMic}
          >
            {controller.micEnabled ? 'Mute Mic' : 'Unmute Mic'}
          </button>
          <button
            type="button"
            className="rounded-md border px-3 py-2 text-sm"
            onClick={controller.toggleSpeaker}
          >
            {controller.speakerEnabled ? 'Speaker On' : 'Speaker Off'}
          </button>
        </div>
        {controller.error && (
          <p className="mt-3 rounded border border-rose-300 bg-rose-50 p-2 text-xs text-rose-700 dark:border-rose-800 dark:bg-rose-950/40 dark:text-rose-300">
            {controller.error}
          </p>
        )}
        <div className="mt-4">
          <Link href="/settings" className="text-sm underline">
            Open Agent Settings
          </Link>
        </div>
      </section>

      <section className="rounded-xl border bg-white/80 p-4 shadow-sm dark:bg-slate-900/80">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-sm font-semibold uppercase">Chat</h2>
          <span className="text-xs text-slate-500">{controller.messages.length} messages</span>
        </div>
        <div className="mb-3 h-[58vh] overflow-y-auto rounded border bg-white p-3 text-sm dark:bg-slate-950">
          {controller.messages.length === 0 && <p className="text-slate-500">No messages yet.</p>}
          {controller.messages.map((message) => (
            <div key={message.id} className="mb-2 rounded border p-2">
              <div className="mb-1 flex items-center justify-between text-[11px] uppercase">
                <span>{message.from}</span>
                <span>{new Date(message.ts).toLocaleTimeString()}</span>
              </div>
              <p>{message.text}</p>
            </div>
          ))}
        </div>
        <div className="flex gap-2">
          <input
            value={chatInput}
            onChange={(event) => setChatInput(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') {
                event.preventDefault();
                void onSend();
              }
            }}
            placeholder="Type a message..."
            className="flex-1 rounded border bg-transparent px-3 py-2 text-sm"
          />
          <button
            type="button"
            className="rounded-md border px-3 py-2 text-sm"
            onClick={() => void onSend()}
          >
            Send
          </button>
          {speechSupported && (
            <button
              type="button"
              className="rounded-md border px-3 py-2 text-sm"
              onClick={onSpeak}
              disabled={speechListening}
            >
              {speechListening ? 'Listening...' : 'Speak'}
            </button>
          )}
        </div>
      </section>

      <section className="rounded-xl border bg-white/80 p-4 shadow-sm dark:bg-slate-900/80">
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-sm font-semibold uppercase">Verbose Events</h2>
          <button type="button" className="text-xs underline" onClick={controller.clearLogs}>
            Clear
          </button>
        </div>
        <div className="grid h-[72vh] grid-rows-[1fr_1fr] gap-2">
          <div className="overflow-y-auto rounded border bg-white p-2 text-xs dark:bg-slate-950">
            {controller.events.map((item) => (
              <button
                type="button"
                key={item.id}
                className={`mb-1 w-full rounded border p-2 text-left ${
                  controller.selectedEventId === item.id
                    ? 'border-sky-500 bg-sky-50 dark:bg-sky-900/30'
                    : ''
                }`}
                onClick={() => controller.setSelectedEventId(item.id)}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="font-semibold">{item.eventType}</span>
                  <span>{new Date(item.ts).toLocaleTimeString()}</span>
                </div>
                <p className="text-[11px] text-slate-600 dark:text-slate-400">{item.summary}</p>
              </button>
            ))}
          </div>
          <pre className="overflow-auto rounded border bg-slate-900 p-3 text-[11px] text-slate-100">
            {JSON.stringify(controller.selectedEvent?.payload ?? {}, null, 2)}
          </pre>
        </div>
      </section>

      <div ref={controller.audioRootRef} />
    </main>
  );
}
