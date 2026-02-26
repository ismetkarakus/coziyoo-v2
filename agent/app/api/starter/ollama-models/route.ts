import { NextResponse } from 'next/server';

const API_BASE_URL =
  process.env.API_BASE_URL?.trim() || process.env.NEXT_PUBLIC_API_BASE_URL?.trim() || '';

export async function GET() {
  if (!API_BASE_URL) {
    return NextResponse.json(
      { error: { message: 'API_BASE_URL is not configured' } },
      { status: 503 }
    );
  }

  try {
    const endpoint = `${API_BASE_URL.replace(/\/+$/, '')}/v1/livekit/starter/ollama/models`;
    const upstream = await fetch(endpoint, {
      method: 'GET',
      cache: 'no-store',
    });
    const raw = await upstream.text();
    const headers = new Headers({ 'cache-control': 'no-store' });
    return new NextResponse(raw, { status: upstream.status, headers });
  } catch (error) {
    return NextResponse.json(
      { error: { message: error instanceof Error ? error.message : 'Failed to fetch Ollama models' } },
      { status: 502 }
    );
  }
}
