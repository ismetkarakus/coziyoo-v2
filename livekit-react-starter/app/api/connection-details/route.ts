import { NextResponse } from 'next/server';

const API_BASE_URL =
  process.env.API_BASE_URL?.trim() || process.env.NEXT_PUBLIC_API_BASE_URL?.trim() || '';
const DEVICE_ID_COOKIE = 'coziyoo_device_id';

type StarterSessionResponse = {
  data?: {
    roomName?: string;
    wsUrl?: string;
    user?: {
      token?: string;
    };
  };
};

// don't cache the results
export const revalidate = 0;

export async function POST(req: Request) {
  if (!API_BASE_URL) {
    return NextResponse.json({ error: { message: 'API_BASE_URL is not configured' } }, { status: 503 });
  }

  let body: unknown = {};
  try {
    body = await req.json();
  } catch {
    body = {};
  }

  const parsedBody = body && typeof body === 'object' ? (body as Record<string, unknown>) : {};
  const headerDeviceId = req.headers.get('x-device-id');
  const bodyDeviceId = typeof parsedBody.deviceId === 'string' ? parsedBody.deviceId : undefined;
  const cookieDeviceId = readCookie(req.headers.get('cookie') ?? '', DEVICE_ID_COOKIE);
  const deviceId =
    sanitizeDeviceId(headerDeviceId) ??
    sanitizeDeviceId(bodyDeviceId) ??
    sanitizeDeviceId(cookieDeviceId);

  if (!deviceId) {
    return NextResponse.json(
      { error: { message: 'Valid deviceId is required for starter session.' } },
      { status: 400 }
    );
  }

  const usernameRaw = typeof parsedBody.username === 'string' ? parsedBody.username.trim() : '';
  const username = usernameRaw || 'user';

  try {
    const endpoint = `${API_BASE_URL.replace(/\/+$/, '')}/v1/livekit/starter/session/start`;
    const upstream = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        username,
        deviceId,
      }),
      cache: 'no-store',
    });

    const raw = await upstream.text();
    let parsed: unknown = raw;
    try {
      parsed = raw ? JSON.parse(raw) : null;
    } catch {
      parsed = raw;
    }

    if (!upstream.ok) {
      return NextResponse.json(
        {
          error: {
            message: `starter/session/start failed (${upstream.status})`,
            response: parsed,
          },
        },
        { status: upstream.status }
      );
    }

    const payload = parsed as StarterSessionResponse;
    const roomName = payload.data?.roomName;
    const serverUrl = payload.data?.wsUrl;
    const participantToken = payload.data?.user?.token;

    if (!roomName || !serverUrl || !participantToken) {
      return NextResponse.json(
        {
          error: {
            message: 'starter/session/start returned incomplete connection details',
            response: parsed,
          },
        },
        { status: 502 }
      );
    }

    const response = NextResponse.json(
      {
        serverUrl,
        roomName,
        participantName: username,
        participantToken,
      },
      {
        headers: {
          'Cache-Control': 'no-store',
        },
      }
    );

    response.cookies.set({
      name: DEVICE_ID_COOKIE,
      value: deviceId,
      path: '/',
      sameSite: 'lax',
      httpOnly: false,
      secure: false,
      maxAge: 60 * 60 * 24 * 365,
    });

    return response;
  } catch (error) {
    return NextResponse.json(
      { error: { message: error instanceof Error ? error.message : 'Connection details proxy failed' } },
      { status: 502 }
    );
  }
}

function sanitizeDeviceId(value: string | null | undefined): string | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  if (!/^[a-zA-Z0-9_-]{8,128}$/.test(trimmed)) return undefined;
  return trimmed;
}

function readCookie(cookieHeader: string, key: string): string | undefined {
  const values = cookieHeader.split(';');
  for (const item of values) {
    const [name, ...rest] = item.trim().split('=');
    if (name === key) {
      return decodeURIComponent(rest.join('=') || '');
    }
  }
  return undefined;
}
