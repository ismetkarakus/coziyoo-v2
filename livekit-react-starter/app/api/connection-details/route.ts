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
  'https://api.example.com';

export const revalidate = 0;

export async function POST(req: Request) {
  try {
    if (API_BASE_URL.includes('api.example.com')) {
      return NextResponse.json(
        {
          error: {
            message:
              'API_BASE_URL is not configured. Set API_BASE_URL (or NEXT_PUBLIC_API_BASE_URL) in assistant env.',
          },
        },
        { status: 500 }
      );
    }

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
    let parsed: StarterResponse = {};
    try {
      parsed = raw ? (JSON.parse(raw) as StarterResponse) : {};
    } catch {
      parsed = {
        error: {
          message: raw?.slice(0, 500) || `Unexpected upstream response (${upstream.status})`,
        },
      };
    }

    if (upstream.status !== 201 || !parsed.data) {
      throw new Error(
        parsed.error?.message ??
          `Failed to start LiveKit starter session (status ${upstream.status})`
      );
    }

    const token = String(parsed.data.user?.token ?? '');
    if (!token || token.split('.').length !== 3) {
      throw new Error('Starter session response does not include a valid participant token');
    }

    const details: ConnectionDetails = {
      serverUrl: parsed.data.wsUrl,
      roomName: parsed.data.roomName,
      participantName: username,
      participantToken: token,
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
