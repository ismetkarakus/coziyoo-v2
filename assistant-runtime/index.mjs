import express from 'express';
import * as wavDecoder from 'wav-decoder';
import {
  AudioFrame,
  AudioSource,
  DataPacketKind,
  LocalAudioTrack,
  Room,
  RoomEvent,
  TrackSource,
} from '@livekit/rtc-node';
import { z } from 'zod';

const TARGET_SAMPLE_RATE = 48_000;
const TARGET_CHANNELS = 1;
const FRAME_SAMPLES = 480; // 10ms @ 48kHz

const JoinSchema = z.object({
  roomName: z.string().min(1),
  participantIdentity: z.string().min(1),
  participantName: z.string().min(1).optional(),
  token: z.string().min(8),
  wsUrl: z.string().min(1),
  metadata: z.string().optional(),
  voiceMode: z.string().optional(),
  payload: z.record(z.string(), z.unknown()).optional(),
});

const app = express();
app.use(express.json({ limit: '2mb' }));

const sessions = new Map();

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function toInt16(floatSample) {
  if (floatSample >= 1) return 32767;
  if (floatSample <= -1) return -32768;
  return Math.round(floatSample * 32767);
}

function mixToMono(channelData) {
  if (!Array.isArray(channelData) || channelData.length === 0) return new Float32Array(0);
  if (channelData.length === 1) return channelData[0];

  const length = channelData[0].length;
  const mono = new Float32Array(length);
  for (let i = 0; i < length; i += 1) {
    let sum = 0;
    for (let c = 0; c < channelData.length; c += 1) {
      sum += channelData[c][i] ?? 0;
    }
    mono[i] = sum / channelData.length;
  }
  return mono;
}

function resampleLinear(input, fromRate, toRate) {
  if (fromRate === toRate) return input;
  if (!input.length) return new Float32Array(0);

  const ratio = fromRate / toRate;
  const outLen = Math.max(1, Math.round(input.length / ratio));
  const out = new Float32Array(outLen);
  for (let i = 0; i < outLen; i += 1) {
    const pos = i * ratio;
    const left = Math.floor(pos);
    const right = Math.min(left + 1, input.length - 1);
    const frac = pos - left;
    out[i] = input[left] * (1 - frac) + input[right] * frac;
  }
  return out;
}

function floatToPcm16(floatData) {
  const out = new Int16Array(floatData.length);
  for (let i = 0; i < floatData.length; i += 1) {
    out[i] = toInt16(floatData[i]);
  }
  return out;
}

function tonePcm16({ seconds = 0.35, frequency = 330 } = {}) {
  const sampleCount = Math.floor(seconds * TARGET_SAMPLE_RATE);
  const pcm = new Int16Array(sampleCount);
  for (let i = 0; i < sampleCount; i += 1) {
    const t = i / TARGET_SAMPLE_RATE;
    pcm[i] = Math.round(Math.sin(2 * Math.PI * frequency * t) * 7000);
  }
  return pcm;
}

function extractTextPayload(obj) {
  if (!obj || typeof obj !== 'object') return null;
  if (obj.type === 'agent_message' && typeof obj.text === 'string' && obj.text.trim()) {
    return { text: obj.text.trim(), reason: 'agent_message' };
  }
  if (obj.type === 'system_instruction' && obj.action === 'interrupt') {
    return { interrupt: true };
  }
  return null;
}

async function synthesizeWavBuffer(text, language) {
  const baseUrl = process.env.TTS_BASE_URL || '';
  const synthPath = process.env.TTS_SYNTH_PATH || '/tts';
  if (!baseUrl) {
    throw new Error('TTS_BASE_URL_MISSING');
  }

  const endpoint = new URL(synthPath, baseUrl).toString();
  const headers = { 'content-type': 'application/json' };
  if (process.env.TTS_API_KEY) {
    headers.authorization = `Bearer ${process.env.TTS_API_KEY}`;
  }

  const payload = {
    text,
    language: language || process.env.TTS_LANGUAGE_DEFAULT || 'tr',
    speaker_id: process.env.TTS_SPEAKER_ID || undefined,
    speaker_wav_url: process.env.TTS_SPEAKER_WAV_URL || undefined,
    voice_mode: process.env.TTS_CHATTERBOX_VOICE_MODE || undefined,
    predefined_voice_id: process.env.TTS_CHATTERBOX_PREDEFINED_VOICE_ID || undefined,
    output_format: 'wav',
  };

  const controller = new AbortController();
  const timeoutMs = Number(process.env.TTS_TIMEOUT_MS || 30_000);
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
      signal: controller.signal,
    });

    if (!response.ok) {
      const textBody = await response.text();
      throw new Error(`TTS_HTTP_${response.status}:${textBody.slice(0, 240)}`);
    }

    const contentType = response.headers.get('content-type') || '';
    if (contentType.includes('application/json')) {
      const data = await response.json();
      const b64 =
        data?.audioBase64 || data?.audio_base64 || data?.audio || data?.wavBase64 || data?.wav_base64 || null;
      if (!b64 || typeof b64 !== 'string') {
        throw new Error('TTS_JSON_AUDIO_MISSING');
      }
      return Buffer.from(b64, 'base64');
    }

    const arr = await response.arrayBuffer();
    return Buffer.from(arr);
  } finally {
    clearTimeout(timeout);
  }
}

function decodeWavToPcm16(buffer) {
  const decoded = wavDecoder.decode.sync(buffer);
  const mono = mixToMono(decoded.channelData || []);
  const resampled = resampleLinear(mono, decoded.sampleRate, TARGET_SAMPLE_RATE);
  return floatToPcm16(resampled);
}

class AssistantSession {
  constructor(joinPayload) {
    this.join = joinPayload;
    this.room = null;
    this.audioSource = null;
    this.audioTrack = null;
    this.speakChain = Promise.resolve();
    this.interrupted = false;
  }

  async connectAndPublish() {
    this.room = new Room();
    this.room.on(RoomEvent.DataReceived, (payload, _participant, _kind, topic) => {
      void this.handleData(payload, topic || '');
    });

    await this.room.connect(this.join.wsUrl, this.join.token, { autoSubscribe: true, dynacast: false });

    this.audioSource = new AudioSource(TARGET_SAMPLE_RATE, TARGET_CHANNELS, 1000);
    this.audioTrack = LocalAudioTrack.createAudioTrack('assistant-audio', this.audioSource);

    await this.room.localParticipant.publishTrack(this.audioTrack, {
      source: TrackSource.SOURCE_MICROPHONE,
    });

    // Prime initial playout so clients detect agent audio track quickly.
    await this.playPcm(tonePcm16({ seconds: 0.12, frequency: 280 }));

    await this.publishStatus('assistant_audio_track_published', {
      roomName: this.join.roomName,
      participantIdentity: this.join.participantIdentity,
      voiceMode: this.join.voiceMode || 'assistant_native_audio',
    });
  }

  async publishStatus(status, payload = {}) {
    if (!this.room?.localParticipant) return;
    const msg = {
      type: 'assistant_runtime_status',
      status,
      runtime: 'assistant-runtime',
      ts: new Date().toISOString(),
      ...payload,
    };
    await this.room.localParticipant.publishData(new TextEncoder().encode(JSON.stringify(msg)), {
      reliable: true,
      topic: 'chat',
    });
  }

  async handleData(rawPayload, topic) {
    if (!rawPayload?.length) return;

    let obj;
    try {
      obj = JSON.parse(new TextDecoder().decode(rawPayload));
    } catch {
      return;
    }

    const parsed = extractTextPayload(obj);
    if (!parsed) return;

    if (parsed.interrupt) {
      this.interrupted = true;
      if (this.audioSource) {
        this.audioSource.clearQueue();
      }
      await this.publishStatus('assistant_tts_interrupted', { topic: topic || null });
      return;
    }

    if (!parsed.text) return;

    this.speakChain = this.speakChain
      .then(async () => {
        await this.speak(parsed.text, parsed.reason || 'chat');
      })
      .catch((error) => {
        console.error('[assistant-runtime] speak queue error', error);
      });
  }

  async speak(text, reason) {
    this.interrupted = false;

    let pcm;
    try {
      const wav = await synthesizeWavBuffer(text, process.env.TTS_LANGUAGE_DEFAULT || 'tr');
      pcm = decodeWavToPcm16(wav);
      await this.publishStatus('assistant_tts_started', {
        reason,
        textLength: text.length,
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      console.error('[assistant-runtime] tts synth failed, fallback tone', message);
      pcm = tonePcm16({ seconds: 0.28, frequency: 360 });
      await this.publishStatus('assistant_tts_fallback_tone', { reason, error: message });
    }

    await this.playPcm(pcm);
    await this.publishStatus('assistant_tts_finished', { reason, interrupted: this.interrupted });
  }

  async playPcm(pcm) {
    if (!this.audioSource) {
      throw new Error('AUDIO_SOURCE_NOT_READY');
    }

    for (let offset = 0; offset < pcm.length; offset += FRAME_SAMPLES) {
      if (this.interrupted) return;

      const frameData = new Int16Array(FRAME_SAMPLES);
      const end = Math.min(offset + FRAME_SAMPLES, pcm.length);
      frameData.set(pcm.subarray(offset, end));

      const frame = new AudioFrame(frameData, TARGET_SAMPLE_RATE, TARGET_CHANNELS, FRAME_SAMPLES);
      await this.audioSource.captureFrame(frame);
      await sleep(10);
    }
  }
}

app.get('/health', (_req, res) => {
  res.status(200).json({ ok: true, service: 'assistant-runtime' });
});

app.get('/', (_req, res) => {
  res.status(200).json({ ok: true, service: 'assistant-runtime' });
});

app.post('/livekit/agent-session', async (req, res) => {
  const parsed = JoinSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: 'VALIDATION_ERROR', details: parsed.error.flatten() });
  }

  const join = parsed.data;
  const key = `${join.roomName}:${join.participantIdentity}`;
  if (sessions.has(key)) {
    return res.status(202).json({ ok: true, accepted: true, reused: true });
  }

  const session = new AssistantSession(join);
  sessions.set(key, session);

  try {
    await session.connectAndPublish();
    console.log('[assistant-runtime] connected and published', JSON.stringify({ roomName: join.roomName, participantIdentity: join.participantIdentity }));
    return res.status(202).json({ ok: true, accepted: true, mode: 'livekit_audio_track' });
  } catch (error) {
    sessions.delete(key);
    const message = error instanceof Error ? error.message : String(error);
    console.error('[assistant-runtime] join failed', message);
    return res.status(500).json({ error: 'ASSISTANT_RUNTIME_FAILED', message });
  }
});

const port = Number(process.env.PORT || 3000);
const host = process.env.HOST || '0.0.0.0';
app.listen(port, host, () => {
  console.log(`[assistant-runtime] listening on http://${host}:${port}`);
});
