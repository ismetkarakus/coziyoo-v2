'use client';

import { useEffect, useState } from 'react';
import { getOrCreateDeviceId } from '@/lib/device-id';
import {
  STARTER_AGENT_SETTINGS_DEFAULTS,
  type StarterAgentSettings,
  type TtsServerConfig,
  normalizeStarterAgentSettings,
} from '@/lib/starter-settings';

type ApiResponse = { data?: StarterAgentSettings; error?: { message?: string } };
type OllamaModelsResponse = {
  data?: { models?: string[]; defaultModel?: string };
  error?: { message?: string };
};

export default function SettingsPage() {
  const [deviceId, setDeviceId] = useState('');
  const [form, setForm] = useState<StarterAgentSettings>(STARTER_AGENT_SETTINGS_DEFAULTS);
  const [status, setStatus] = useState<string>('Loading settings...');
  const [ollamaModels, setOllamaModels] = useState<string[]>([]);
  const [ttsModalOpen, setTtsModalOpen] = useState(false);
  const [ttsModalMode, setTtsModalMode] = useState<'edit' | 'add'>('edit');
  const [ttsConfigBackup, setTtsConfigBackup] = useState<string>('');

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

  useEffect(() => {
    const loadModels = async () => {
      try {
        const response = await fetch('/api/starter/ollama-models', {
          method: 'GET',
          cache: 'no-store',
        });
        const payload = (await response.json()) as OllamaModelsResponse;
        if (!response.ok) {
          return;
        }
        const list = Array.isArray(payload.data?.models)
          ? payload.data?.models.filter((model) => typeof model === 'string' && model.trim().length > 0)
          : [];
        const fallback = payload.data?.defaultModel?.trim();
        const merged = Array.from(new Set([...list, form.ollamaModel, fallback ?? ''].filter(Boolean)));
        setOllamaModels(merged);
      } catch {
        setOllamaModels((current) => (current.length > 0 ? current : [form.ollamaModel || 'llama3.1']));
      }
    };
    void loadModels();
  }, [form.ollamaModel]);

  const save = async () => {
    setStatus('Saving...');
    try {
      const ttsConfig = sanitizeTtsConfig(form.ttsConfig);
      const response = await fetch(`/api/starter/agent-settings/${encodeURIComponent(deviceId)}`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          agentName: form.agentName.trim(),
          voiceLanguage: form.voiceLanguage.trim() || 'tr',
          ollamaModel: form.ollamaModel.trim() || 'llama3.1',
          ttsEngine:
            form.ttsEngine === 'xtts' || form.ttsEngine === 'chatterbox'
              ? form.ttsEngine
              : 'f5-tts',
          ttsEnabled: Boolean(form.ttsEnabled),
          sttEnabled: Boolean(form.sttEnabled),
          ttsConfig,
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

  const openTtsModal = () => {
    setTtsModalMode('edit');
    setTtsConfigBackup(JSON.stringify(form.ttsConfig ?? {}));
    setTtsModalOpen(true);
  };

  const openAddTtsModal = () => {
    setTtsModalMode('add');
    setTtsConfigBackup(JSON.stringify(form.ttsConfig ?? {}));
    setForm((prev) => ({
      ...prev,
      ttsConfig: createNewTtsConfig(prev.ttsEngine),
    }));
    setTtsModalOpen(true);
  };

  const closeTtsModal = () => {
    setTtsModalOpen(false);
  };

  const cancelTtsModal = () => {
    try {
      const restored = JSON.parse(ttsConfigBackup || '{}') as TtsServerConfig;
      setForm((prev) => ({ ...prev, ttsConfig: restored }));
    } catch {
      setForm((prev) => ({ ...prev, ttsConfig: {} }));
    }
    setTtsModalOpen(false);
  };

  const updateTtsConfig = (patch: Partial<TtsServerConfig>) => {
    setForm((prev) => ({
      ...prev,
      ttsConfig: {
        ...(prev.ttsConfig ?? {}),
        ...patch,
      },
    }));
  };

  const updateF5Config = (patch: NonNullable<TtsServerConfig['f5']>) => {
    setForm((prev) => ({
      ...prev,
      ttsConfig: {
        ...(prev.ttsConfig ?? {}),
        f5: {
          ...(prev.ttsConfig?.f5 ?? {}),
          ...patch,
        },
      },
    }));
  };

  const updateXttsConfig = (patch: NonNullable<TtsServerConfig['xtts']>) => {
    setForm((prev) => ({
      ...prev,
      ttsConfig: {
        ...(prev.ttsConfig ?? {}),
        xtts: {
          ...(prev.ttsConfig?.xtts ?? {}),
          ...patch,
        },
      },
    }));
  };

  const updateChatterboxConfig = (patch: NonNullable<TtsServerConfig['chatterbox']>) => {
    setForm((prev) => ({
      ...prev,
      ttsConfig: {
        ...(prev.ttsConfig ?? {}),
        chatterbox: {
          ...(prev.ttsConfig?.chatterbox ?? {}),
          ...patch,
        },
      },
    }));
  };

  const parseOptionalNumber = (value: string) => {
    const trimmed = value.trim();
    if (!trimmed) return undefined;
    const parsed = Number(trimmed);
    return Number.isFinite(parsed) ? parsed : undefined;
  };

  return (
    <main className="mx-auto min-h-svh w-full max-w-3xl bg-gradient-to-b from-slate-100 to-slate-200 p-4 pt-24 text-slate-900 md:pt-28 dark:from-slate-950 dark:to-slate-900 dark:text-slate-100">
      <div className="relative z-10 rounded-xl border bg-white/80 p-5 shadow-sm dark:bg-slate-900/80">
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
            <span className="mb-1 block text-sm">LLM Model</span>
            <select
              value={form.ollamaModel}
              onChange={(event) =>
                setForm((prev) => ({ ...prev, ollamaModel: event.target.value || 'llama3.1' }))
              }
              className="w-full rounded border bg-transparent px-3 py-2 text-sm"
            >
              {(ollamaModels.length > 0 ? ollamaModels : [form.ollamaModel || 'llama3.1']).map(
                (model) => (
                  <option key={model} value={model}>
                    {model}
                  </option>
                )
              )}
            </select>
          </label>

          <div className="block">
            <div className="mb-1 flex items-center justify-between">
              <span className="block text-sm">TTS Engine</span>
              <div className="flex items-center gap-1">
                <button
                  type="button"
                  onClick={openAddTtsModal}
                  className="inline-flex h-7 w-7 items-center justify-center rounded border text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800"
                  title="Add new TTS server"
                  aria-label="Add new TTS server"
                >
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className="h-3.5 w-3.5"
                  >
                    <path d="M12 5v14" />
                    <path d="M5 12h14" />
                  </svg>
                </button>
                <button
                  type="button"
                  onClick={openTtsModal}
                  className="inline-flex h-7 w-7 items-center justify-center rounded border text-slate-700 hover:bg-slate-100 dark:text-slate-200 dark:hover:bg-slate-800"
                  title="Edit TTS server settings"
                  aria-label="Edit TTS server settings"
                >
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    className="h-3.5 w-3.5"
                  >
                    <path d="M12 20h9" />
                    <path d="M16.5 3.5a2.121 2.121 0 1 1 3 3L7 19l-4 1 1-4 12.5-12.5Z" />
                  </svg>
                </button>
              </div>
            </div>
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
          </div>

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

      {ttsModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="w-full max-w-xl rounded-xl border bg-white p-4 shadow-xl dark:bg-slate-900">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-base font-semibold">
                {ttsModalMode === 'add' ? 'Add TTS Server' : 'TTS Server Settings'}
              </h2>
              <button
                type="button"
                onClick={closeTtsModal}
                className="rounded border px-2 py-1 text-xs"
              >
                Close
              </button>
            </div>

            <div className="space-y-3">
              <label className="block">
                <span className="mb-1 block text-sm">Base URL (optional override)</span>
                <input
                  value={form.ttsConfig?.baseUrl ?? ''}
                  onChange={(event) => updateTtsConfig({ baseUrl: event.target.value })}
                  className="w-full rounded border bg-transparent px-3 py-2 text-sm"
                  placeholder="https://voice.drascom.uk"
                />
              </label>

              <label className="block">
                <span className="mb-1 block text-sm">Path (optional override)</span>
                <input
                  value={form.ttsConfig?.path ?? ''}
                  onChange={(event) => updateTtsConfig({ path: event.target.value })}
                  className="w-full rounded border bg-transparent px-3 py-2 text-sm"
                  placeholder="/tts or /api/tts"
                />
              </label>

              {form.ttsEngine === 'f5-tts' && (
                <div className="space-y-3 rounded border p-3">
                  <p className="text-xs font-semibold uppercase">F5 Settings</p>
                  <label className="block">
                    <span className="mb-1 block text-sm">Speaker ID</span>
                    <input
                      value={form.ttsConfig?.f5?.speakerId ?? ''}
                      onChange={(event) => updateF5Config({ speakerId: event.target.value })}
                      className="w-full rounded border bg-transparent px-3 py-2 text-sm"
                      placeholder="default"
                    />
                  </label>
                  <label className="block">
                    <span className="mb-1 block text-sm">Speaker WAV Path (server path)</span>
                    <input
                      value={form.ttsConfig?.f5?.speakerWavPath ?? ''}
                      onChange={(event) => updateF5Config({ speakerWavPath: event.target.value })}
                      className="w-full rounded border bg-transparent px-3 py-2 text-sm"
                      placeholder="/path/to/voice.wav"
                    />
                  </label>
                </div>
              )}

              {form.ttsEngine === 'xtts' && (
                <div className="space-y-3 rounded border p-3">
                  <p className="text-xs font-semibold uppercase">XTTS Settings</p>
                  <label className="block">
                    <span className="mb-1 block text-sm">Speaker WAV URL</span>
                    <input
                      value={form.ttsConfig?.xtts?.speakerWavUrl ?? ''}
                      onChange={(event) => updateXttsConfig({ speakerWavUrl: event.target.value })}
                      className="w-full rounded border bg-transparent px-3 py-2 text-sm"
                      placeholder="https://example.com/voice.wav"
                    />
                  </label>
                </div>
              )}

              {form.ttsEngine === 'chatterbox' && (
                <div className="space-y-3 rounded border p-3">
                  <p className="text-xs font-semibold uppercase">Chatterbox Settings</p>

                  <label className="block">
                    <span className="mb-1 block text-sm">Voice Mode</span>
                    <select
                      value={form.ttsConfig?.chatterbox?.voiceMode ?? 'predefined'}
                      onChange={(event) =>
                        updateChatterboxConfig({
                          voiceMode: event.target.value === 'clone' ? 'clone' : 'predefined',
                        })
                      }
                      className="w-full rounded border bg-transparent px-3 py-2 text-sm"
                    >
                      <option value="predefined">predefined</option>
                      <option value="clone">clone</option>
                    </select>
                  </label>

                  <label className="block">
                    <span className="mb-1 block text-sm">Predefined Voice ID</span>
                    <input
                      value={form.ttsConfig?.chatterbox?.predefinedVoiceId ?? ''}
                      onChange={(event) =>
                        updateChatterboxConfig({ predefinedVoiceId: event.target.value })
                      }
                      className="w-full rounded border bg-transparent px-3 py-2 text-sm"
                      placeholder="Gianna.wav"
                    />
                  </label>

                  <label className="block">
                    <span className="mb-1 block text-sm">Reference Audio Filename</span>
                    <input
                      value={form.ttsConfig?.chatterbox?.referenceAudioFilename ?? ''}
                      onChange={(event) =>
                        updateChatterboxConfig({ referenceAudioFilename: event.target.value })
                      }
                      className="w-full rounded border bg-transparent px-3 py-2 text-sm"
                      placeholder="serdar.mp3"
                    />
                  </label>

                  <div className="grid grid-cols-2 gap-2">
                    <label className="block">
                      <span className="mb-1 block text-sm">Output Format</span>
                      <select
                        value={form.ttsConfig?.chatterbox?.outputFormat ?? 'wav'}
                        onChange={(event) =>
                          updateChatterboxConfig({
                            outputFormat: event.target.value === 'opus' ? 'opus' : 'wav',
                          })
                        }
                        className="w-full rounded border bg-transparent px-3 py-2 text-sm"
                      >
                        <option value="wav">wav</option>
                        <option value="opus">opus</option>
                      </select>
                    </label>
                    <label className="inline-flex items-end gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={Boolean(form.ttsConfig?.chatterbox?.splitText ?? true)}
                        onChange={(event) =>
                          updateChatterboxConfig({ splitText: event.target.checked })
                        }
                      />
                      Split Text
                    </label>
                  </div>

                  <div className="grid grid-cols-2 gap-2">
                    <label className="block">
                      <span className="mb-1 block text-sm">Chunk Size</span>
                      <input
                        value={form.ttsConfig?.chatterbox?.chunkSize ?? ''}
                        onChange={(event) =>
                          updateChatterboxConfig({
                            chunkSize: parseOptionalNumber(event.target.value),
                          })
                        }
                        className="w-full rounded border bg-transparent px-3 py-2 text-sm"
                        placeholder="120"
                      />
                    </label>
                    <label className="block">
                      <span className="mb-1 block text-sm">Temperature</span>
                      <input
                        value={form.ttsConfig?.chatterbox?.temperature ?? ''}
                        onChange={(event) =>
                          updateChatterboxConfig({
                            temperature: parseOptionalNumber(event.target.value),
                          })
                        }
                        className="w-full rounded border bg-transparent px-3 py-2 text-sm"
                        placeholder="0.8"
                      />
                    </label>
                  </div>
                </div>
              )}
            </div>

            <div className="mt-4 flex justify-end gap-2">
              <button type="button" onClick={cancelTtsModal} className="rounded border px-3 py-2 text-sm">
                Cancel
              </button>
              <button
                type="button"
                onClick={closeTtsModal}
                className="rounded bg-slate-900 px-3 py-2 text-sm text-white dark:bg-slate-100 dark:text-slate-900"
              >
                Done
              </button>
            </div>
          </div>
        </div>
      )}
    </main>
  );
}

function sanitizeTtsConfig(input: TtsServerConfig | undefined): TtsServerConfig {
  if (!input) return {};
  const baseUrl = (input.baseUrl ?? '').trim();
  const path = (input.path ?? '').trim();
  const f5SpeakerId = (input.f5?.speakerId ?? '').trim();
  const f5SpeakerWavPath = (input.f5?.speakerWavPath ?? '').trim();
  const xttsSpeakerWavUrl = (input.xtts?.speakerWavUrl ?? '').trim();
  const predefinedVoiceId = (input.chatterbox?.predefinedVoiceId ?? '').trim();
  const referenceAudioFilename = (input.chatterbox?.referenceAudioFilename ?? '').trim();

  return {
    ...(baseUrl ? { baseUrl } : {}),
    ...(path ? { path } : {}),
    f5: {
      ...(f5SpeakerId ? { speakerId: f5SpeakerId } : {}),
      ...(f5SpeakerWavPath ? { speakerWavPath: f5SpeakerWavPath } : {}),
    },
    xtts: {
      ...(xttsSpeakerWavUrl ? { speakerWavUrl: xttsSpeakerWavUrl } : {}),
    },
    chatterbox: {
      ...(input.chatterbox?.voiceMode ? { voiceMode: input.chatterbox.voiceMode } : {}),
      ...(predefinedVoiceId ? { predefinedVoiceId } : {}),
      ...(referenceAudioFilename ? { referenceAudioFilename } : {}),
      ...(input.chatterbox?.outputFormat ? { outputFormat: input.chatterbox.outputFormat } : {}),
      ...(typeof input.chatterbox?.splitText === 'boolean'
        ? { splitText: input.chatterbox.splitText }
        : {}),
      ...(typeof input.chatterbox?.chunkSize === 'number'
        ? { chunkSize: input.chatterbox.chunkSize }
        : {}),
      ...(typeof input.chatterbox?.temperature === 'number'
        ? { temperature: input.chatterbox.temperature }
        : {}),
      ...(typeof input.chatterbox?.exaggeration === 'number'
        ? { exaggeration: input.chatterbox.exaggeration }
        : {}),
      ...(typeof input.chatterbox?.cfgWeight === 'number'
        ? { cfgWeight: input.chatterbox.cfgWeight }
        : {}),
      ...(typeof input.chatterbox?.seed === 'number' ? { seed: input.chatterbox.seed } : {}),
      ...(typeof input.chatterbox?.speedFactor === 'number'
        ? { speedFactor: input.chatterbox.speedFactor }
        : {}),
    },
  };
}

function createNewTtsConfig(engine: StarterAgentSettings['ttsEngine']): TtsServerConfig {
  if (engine === 'xtts') {
    return {
      baseUrl: '',
      path: '',
      xtts: { speakerWavUrl: '' },
    };
  }
  if (engine === 'chatterbox') {
    return {
      baseUrl: '',
      path: '',
      chatterbox: {
        voiceMode: 'predefined',
        predefinedVoiceId: '',
        referenceAudioFilename: '',
        outputFormat: 'wav',
        splitText: true,
        chunkSize: 120,
      },
    };
  }
  return {
    baseUrl: '',
    path: '',
    f5: { speakerId: 'default', speakerWavPath: '' },
  };
}
