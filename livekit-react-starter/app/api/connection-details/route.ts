import { NextResponse } from 'next/server';

type StarterResponse = {
  data?: {
    roomName: string;
    wsUrl: string;
    user: {
      participantIdentity: string;
      token: string;
    };
  };
  error?: {
    message?: string;
  };
};

type ConnectionDetails = {
  serverUrl: string;
  roomName: string;
  participantName: string;
  participantToken: string;
};

const API_BASE_URL =
  process.env.API_BASE_URL?.trim() ||
  process.env.NEXT_PUBLIC_API_BASE_URL?.trim() ||
  'https://api.coziyoo.com';

export const revalidate = 0;

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const username = String(body?.username ?? 'guest').trim() || 'guest';
    const roomName = String(body?.roomName ?? '').trim();

    const upstream = await fetch(`${API_BASE_URL}/v1/livekit/starter/session/start`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        username,
        ...(roomName ? { roomName } : {}),
      }),
      cache: 'no-store',
    });

    const raw = await upstream.text();
    const parsed = raw ? (JSON.parse(raw) as StarterResponse) : {};
    if (upstream.status !== 201 || !parsed.data) {
      throw new Error(parsed.error?.message ?? 'Failed to start LiveKit starter session');
    }

    const details: ConnectionDetails = {
      serverUrl: parsed.data.wsUrl,
      roomName: parsed.data.roomName,
      participantName: username,
      participantToken: parsed.data.user.token,
    };

    return NextResponse.json(details, {
      headers: {
        'Cache-Control': 'no-store',
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to get connection details';
    return NextResponse.json({ error: { message } }, { status: 500 });
  }
}
