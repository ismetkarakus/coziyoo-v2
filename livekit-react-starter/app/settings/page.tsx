'use client';

import { useEffect, useState } from 'react';
import { getOrCreateDeviceId } from '@/lib/device-id';
import {
  STARTER_AGENT_SETTINGS_DEFAULTS,
  type StarterAgentSettings,
  normalizeStarterAgentSettings,
} from '@/lib/starter-settings';

type ApiResponse = { data?: StarterAgentSettings; error?: { message?: string } };

export default function SettingsPage() {
  const [deviceId, setDeviceId] = useState('');
  const [form, setForm] = useState<StarterAgentSettings>(STARTER_AGENT_SETTINGS_DEFAULTS);
  const [status, setStatus] = useState<string>('Loading settings...');

  useEffect(() => {
    setDeviceId(getOrCreateDeviceId());
  }, []);

  useEffect(() => {
    if (!deviceId) {
      return;
    }
    const load = async () => {
      try {
        const response = await fetch(
          `/api/starter/agent-settings/${encodeURIComponent(deviceId)}`,
          {
            method: 'GET',
            cache: 'no-store',
          }
        );
        if (response.ok) {
          const payload = (await response.json()) as ApiResponse;
          setForm(normalizeStarterAgentSettings(payload.data));
          setStatus('Loaded');
          return;
        }
        if (response.status === 404) {
          setForm(STARTER_AGENT_SETTINGS_DEFAULTS);
          setStatus('No saved settings yet.');
          return;
        }
        const payload = (await response.json()) as ApiResponse;
        setStatus(payload.error?.message ?? `Load failed (${response.status})`);
      } catch (error) {
        setStatus(error instanceof Error ? error.message : 'Load failed');
      }
    };

    void load();
  }, [deviceId]);

  const save = async () => {
    setStatus('Saving...');
    try {
      const response = await fetch(`/api/starter/agent-settings/${encodeURIComponent(deviceId)}`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          agentName: form.agentName.trim(),
          voiceLanguage: form.voiceLanguage.trim() || 'tr',
          ttsEngine:
            form.ttsEngine === 'xtts' || form.ttsEngine === 'chatterbox'
              ? form.ttsEngine
              : 'f5-tts',
          ttsEnabled: Boolean(form.ttsEnabled),
          sttEnabled: Boolean(form.sttEnabled),
          systemPrompt: form.systemPrompt?.trim() || '',
          greetingEnabled: Boolean(form.greetingEnabled),
          greetingInstruction: form.greetingInstruction?.trim() || '',
        }),
      });

      const payload = (await response.json()) as ApiResponse;
      if (!response.ok) {
        setStatus(payload.error?.message ?? `Save failed (${response.status})`);
        return;
      }
      setForm(normalizeStarterAgentSettings(payload.data));
      setStatus('Saved');
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Save failed');
    }
  };

  const reset = () => {
    setForm(STARTER_AGENT_SETTINGS_DEFAULTS);
    setStatus('Reset to defaults locally. Press Save to persist.');
  };

  return (
    <main className="mx-auto min-h-svh w-full max-w-3xl bg-gradient-to-b from-slate-100 to-slate-200 p-4 text-slate-900 dark:from-slate-950 dark:to-slate-900 dark:text-slate-100">
      <div className="rounded-xl border bg-white/80 p-5 shadow-sm dark:bg-slate-900/80">
        <div className="mb-4 flex items-center justify-between">
          <h1 className="text-xl font-semibold">Agent Settings</h1>
          <button
            type="button"
            onClick={() => {
              window.location.assign('/');
            }}
            className="text-sm underline"
          >
            Back to Home
          </button>
        </div>

        <p className="mb-4 text-xs text-slate-600 dark:text-slate-400">
          Device ID: <span className="font-mono">{deviceId}</span>
        </p>

        <div className="space-y-3">
          <label className="block">
            <span className="mb-1 block text-sm">Agent Name</span>
            <input
              value={form.agentName}
              onChange={(event) => setForm((prev) => ({ ...prev, agentName: event.target.value }))}
              className="w-full rounded border bg-transparent px-3 py-2 text-sm"
              placeholder="coziyoo-agent"
            />
          </label>

          <label className="block">
            <span className="mb-1 block text-sm">Voice Language</span>
            <input
              value={form.voiceLanguage}
              onChange={(event) =>
                setForm((prev) => ({ ...prev, voiceLanguage: event.target.value }))
              }
              className="w-full rounded border bg-transparent px-3 py-2 text-sm"
              placeholder="tr"
            />
          </label>

          <label className="block">
            <span className="mb-1 block text-sm">TTS Engine</span>
            <select
              value={form.ttsEngine}
              onChange={(event) =>
                setForm((prev) => ({
                  ...prev,
                  ttsEngine:
                    event.target.value === 'xtts' || event.target.value === 'chatterbox'
                      ? event.target.value
                      : 'f5-tts',
                }))
              }
              className="w-full rounded border bg-transparent px-3 py-2 text-sm"
            >
              <option value="f5-tts">F5-TTS</option>
              <option value="xtts">XTTS</option>
              <option value="chatterbox">Chatterbox</option>
            </select>
          </label>

          <label className="block">
            <span className="mb-1 block text-sm">System Prompt (optional)</span>
            <textarea
              value={form.systemPrompt ?? ''}
              onChange={(event) =>
                setForm((prev) => ({ ...prev, systemPrompt: event.target.value }))
              }
              className="min-h-24 w-full rounded border bg-transparent px-3 py-2 text-sm"
              placeholder="Instructions for your agent"
            />
          </label>

          <div className="flex flex-wrap gap-4">
            <label className="inline-flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={Boolean(form.ttsEnabled)}
                onChange={(event) =>
                  setForm((prev) => ({ ...prev, ttsEnabled: event.target.checked }))
                }
              />
              TTS Enabled
            </label>
            <label className="inline-flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={Boolean(form.sttEnabled)}
                onChange={(event) =>
                  setForm((prev) => ({ ...prev, sttEnabled: event.target.checked }))
                }
              />
              STT Enabled
            </label>
            <label className="inline-flex items-center gap-2 text-sm">
              <input
                type="checkbox"
                checked={Boolean(form.greetingEnabled)}
                onChange={(event) =>
                  setForm((prev) => ({ ...prev, greetingEnabled: event.target.checked }))
                }
              />
              Auto Greeting on Connect
            </label>
          </div>

          <label className="block">
            <span className="mb-1 block text-sm">Greeting Instruction (optional)</span>
            <textarea
              value={form.greetingInstruction ?? ''}
              onChange={(event) =>
                setForm((prev) => ({ ...prev, greetingInstruction: event.target.value }))
              }
              className="min-h-20 w-full rounded border bg-transparent px-3 py-2 text-sm"
              placeholder="How agent should greet based on weekday and time of day."
            />
          </label>
        </div>

        <div className="mt-5 flex gap-2">
          <button
            type="button"
            onClick={save}
            className="rounded-md bg-slate-900 px-3 py-2 text-sm text-white dark:bg-slate-100 dark:text-slate-900"
          >
            Save
          </button>
          <button type="button" onClick={reset} className="rounded-md border px-3 py-2 text-sm">
            Reset
          </button>
        </div>

        <p className="mt-3 text-xs text-slate-600 dark:text-slate-400">{status}</p>
      </div>
    </main>
  );
}
