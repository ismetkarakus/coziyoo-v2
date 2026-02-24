import { NextResponse } from 'next/server';

type SttRequest = {
  audioBase64?: string;
  mimeType?: string;
};

type SttResponse = {
  error?: { message?: string };
};

const API_BASE_URL =
  process.env.API_BASE_URL?.trim() ||
  process.env.NEXT_PUBLIC_API_BASE_URL?.trim() ||
  'https://api.example.com';

export const revalidate = 0;

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as SttRequest;
    const audioBase64 = String(body.audioBase64 ?? '').trim();
    const mimeType = String(body.mimeType ?? 'audio/webm').trim() || 'audio/webm';

    if (!audioBase64) {
      return NextResponse.json({ error: { message: 'audioBase64 is required' } }, { status: 400 });
    }

    const upstream = await fetch(`${API_BASE_URL}/v1/livekit/starter/stt/transcribe`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({ audioBase64, mimeType }),
      cache: 'no-store',
    });

    const raw = await upstream.text();
    if (!upstream.ok) {
      let message = 'STT failed';
      try {
        const parsed = raw ? (JSON.parse(raw) as SttResponse) : {};
        message = parsed.error?.message ?? message;
      } catch {
        message = raw || message;
      }
      return NextResponse.json({ error: { message } }, { status: upstream.status });
    }

    return NextResponse.json(raw ? JSON.parse(raw) : {}, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'STT failed';
    return NextResponse.json({ error: { message } }, { status: 500 });
  }
}
