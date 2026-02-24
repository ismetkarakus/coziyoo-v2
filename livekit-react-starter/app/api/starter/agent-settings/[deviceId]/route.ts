import { NextResponse } from 'next/server';

const API_BASE_URL =
  process.env.API_BASE_URL?.trim() || process.env.NEXT_PUBLIC_API_BASE_URL?.trim() || '';

function apiEndpoint(deviceId: string) {
  return `${API_BASE_URL.replace(/\/+$/, '')}/v1/livekit/starter/agent-settings/${encodeURIComponent(deviceId)}`;
}

function validateDeviceId(value: string) {
  return /^[a-zA-Z0-9_-]{8,128}$/.test(value);
}

export async function GET(_req: Request, context: { params: Promise<{ deviceId: string }> }) {
  if (!API_BASE_URL) {
    return NextResponse.json(
      { error: { message: 'API_BASE_URL is not configured' } },
      { status: 503 }
    );
  }
  const { deviceId } = await context.params;
  if (!validateDeviceId(deviceId)) {
    return NextResponse.json({ error: { message: 'Invalid deviceId' } }, { status: 400 });
  }

  try {
    const upstream = await fetch(apiEndpoint(deviceId), {
      method: 'GET',
      cache: 'no-store',
    });
    const raw = await upstream.text();
    const headers = new Headers({ 'cache-control': 'no-store' });
    return new NextResponse(raw, { status: upstream.status, headers });
  } catch (error) {
    return NextResponse.json(
      { error: { message: error instanceof Error ? error.message : 'Failed to fetch settings' } },
      { status: 502 }
    );
  }
}

export async function PUT(req: Request, context: { params: Promise<{ deviceId: string }> }) {
  if (!API_BASE_URL) {
    return NextResponse.json(
      { error: { message: 'API_BASE_URL is not configured' } },
      { status: 503 }
    );
  }
  const { deviceId } = await context.params;
  if (!validateDeviceId(deviceId)) {
    return NextResponse.json({ error: { message: 'Invalid deviceId' } }, { status: 400 });
  }

  try {
    const body = await req.text();
    const upstream = await fetch(apiEndpoint(deviceId), {
      method: 'PUT',
      headers: { 'content-type': 'application/json' },
      body,
      cache: 'no-store',
    });
    const raw = await upstream.text();
    const headers = new Headers({ 'cache-control': 'no-store' });
    return new NextResponse(raw, { status: upstream.status, headers });
  } catch (error) {
    return NextResponse.json(
      { error: { message: error instanceof Error ? error.message : 'Failed to save settings' } },
      { status: 502 }
    );
  }
}
