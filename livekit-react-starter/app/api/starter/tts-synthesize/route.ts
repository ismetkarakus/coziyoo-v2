import { NextResponse } from 'next/server';

const API_BASE_URL =
  process.env.API_BASE_URL?.trim() || process.env.NEXT_PUBLIC_API_BASE_URL?.trim() || '';

export async function POST(req: Request) {
  if (!API_BASE_URL) {
    return NextResponse.json(
      { error: { message: 'API_BASE_URL is not configured' } },
      { status: 503 }
    );
  }

  try {
    const body = await req.text();
    const deviceId = req.headers.get('x-device-id') ?? '';
    const endpoint = `${API_BASE_URL.replace(/\/+$/, '')}/v1/livekit/starter/tts/synthesize`;
    const upstream = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(deviceId ? { 'x-device-id': deviceId } : {}),
      },
      body,
      cache: 'no-store',
    });

    const buffer = await upstream.arrayBuffer();
    if (!upstream.ok) {
      const responseText = new TextDecoder().decode(buffer).slice(0, 400);
      return NextResponse.json(
        {
          error: {
            message: `TTS failed with status ${upstream.status}`,
            response: responseText,
          },
        },
        { status: upstream.status }
      );
    }

    const headers = new Headers({
      'cache-control': 'no-store',
      'content-type': upstream.headers.get('content-type') ?? 'audio/wav',
    });
    return new NextResponse(buffer, { status: 200, headers });
  } catch (error) {
    return NextResponse.json(
      { error: { message: error instanceof Error ? error.message : 'TTS proxy failed' } },
      { status: 502 }
    );
  }
}
