import { NextResponse } from 'next/server';

type TtsRequest = {
  text?: string;
  language?: string;
};

const TTS_BASE_URL = process.env.TTS_BASE_URL?.trim() || 'https://tts.example.com';
const TTS_PATH = process.env.TTS_SYNTH_PATH?.trim() || '/tts';
const TTS_LANGUAGE_DEFAULT = process.env.TTS_LANGUAGE_DEFAULT?.trim() || 'tr';
const TTS_TIMEOUT_MS = Number(process.env.TTS_TIMEOUT_MS ?? 30000);
const TTS_SPEAKER_WAV_URL = process.env.TTS_SPEAKER_WAV_URL?.trim();

export const revalidate = 0;

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as TtsRequest;
    const text = String(body.text ?? '').trim();
    const language = String(body.language ?? TTS_LANGUAGE_DEFAULT).trim() || TTS_LANGUAGE_DEFAULT;

    if (!text) {
      return NextResponse.json({ error: { message: 'text is required' } }, { status: 400 });
    }

    const formData = new FormData();
    formData.set('text', text);
    formData.set('language', language);

    if (TTS_SPEAKER_WAV_URL) {
      const speakerRes = await fetch(TTS_SPEAKER_WAV_URL, { cache: 'no-store' });
      if (speakerRes.ok) {
        const speakerBuffer = await speakerRes.arrayBuffer();
        formData.set(
          'speaker_wav',
          new Blob([speakerBuffer], { type: 'audio/wav' }),
          'speaker.wav'
        );
      }
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), TTS_TIMEOUT_MS);

    try {
      const endpoint = new URL(TTS_PATH, TTS_BASE_URL).toString();
      const upstream = await fetch(endpoint, {
        method: 'POST',
        body: formData,
        signal: controller.signal,
      });

      const audioBuffer = await upstream.arrayBuffer();
      if (!upstream.ok) {
        return NextResponse.json(
          { error: { message: `TTS failed with status ${upstream.status}` } },
          { status: 502 }
        );
      }

      return new NextResponse(audioBuffer, {
        status: 200,
        headers: {
          'content-type': upstream.headers.get('content-type') ?? 'audio/wav',
          'cache-control': 'no-store',
        },
      });
    } finally {
      clearTimeout(timeout);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'TTS failed';
    return NextResponse.json({ error: { message } }, { status: 500 });
  }
}
