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
    const rawBody = await req.text();
    const deviceId = req.headers.get('x-device-id') ?? '';
    const endpoint = `${API_BASE_URL.replace(/\/+$/, '')}/v1/livekit/starter/agent/chat`;
    const upstream = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        ...(deviceId ? { 'x-device-id': deviceId } : {}),
      },
      body: rawBody,
      cache: 'no-store',
    });
    const raw = await upstream.text();
    const headers = new Headers({ 'cache-control': 'no-store' });
    return new NextResponse(raw, { status: upstream.status, headers });
  } catch (error) {
    return NextResponse.json(
      { error: { message: error instanceof Error ? error.message : 'Agent chat failed' } },
      { status: 502 }
    );
  }
}
