import { NextResponse } from 'next/server';
import { AccessToken, type AccessTokenOptions, type VideoGrant } from 'livekit-server-sdk';
import crypto from 'node:crypto';
import { RoomConfiguration } from '@livekit/protocol';
import {
  STARTER_AGENT_SETTINGS_DEFAULTS,
  type StarterAgentSettings,
  normalizeStarterAgentSettings,
} from '@/lib/starter-settings';

type ConnectionDetails = {
  serverUrl: string;
  roomName: string;
  participantName: string;
  participantToken: string;
};

// NOTE: you are expected to define the following environment variables in `.env.local`:
const API_KEY = process.env.LIVEKIT_API_KEY;
const API_SECRET = process.env.LIVEKIT_API_SECRET;
const LIVEKIT_URL = process.env.LIVEKIT_URL;
const API_BASE_URL =
  process.env.API_BASE_URL?.trim() || process.env.NEXT_PUBLIC_API_BASE_URL?.trim() || '';
const DEVICE_ID_COOKIE = 'coziyoo_device_id';

// don't cache the results
export const revalidate = 0;

export async function POST(req: Request) {
  try {
    if (LIVEKIT_URL === undefined) {
      throw new Error('LIVEKIT_URL is not defined');
    }
    if (API_KEY === undefined) {
      throw new Error('LIVEKIT_API_KEY is not defined');
    }
    if (API_SECRET === undefined) {
      throw new Error('LIVEKIT_API_SECRET is not defined');
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

    const savedSettings = deviceId ? await fetchStarterAgentSettings(deviceId) : null;
    const settings = normalizeStarterAgentSettings(
      savedSettings ?? STARTER_AGENT_SETTINGS_DEFAULTS
    );
    const requestedAgentName = readRequestedAgentName(parsedBody);
    const agentName = requestedAgentName || settings.agentName || undefined;

    // Generate participant token
    const participantName = 'user';
    const participantIdentity = `voice_assistant_user_${crypto.randomUUID().slice(0, 8)}`;
    const roomName = `voice_assistant_room_${crypto.randomUUID().slice(0, 8)}`;
    const participantMetadata = JSON.stringify({
      source: 'livekit-react-starter',
      deviceId: deviceId ?? null,
      voiceLanguage: settings.voiceLanguage,
      ttsEnabled: settings.ttsEnabled,
      sttEnabled: settings.sttEnabled,
      systemPrompt: settings.systemPrompt ?? '',
      greetingEnabled: settings.greetingEnabled,
      greetingInstruction: settings.greetingInstruction ?? '',
    });

    const participantToken = await createParticipantToken(
      { identity: participantIdentity, name: participantName, metadata: participantMetadata },
      roomName,
      agentName
    );

    // Return connection details
    const data: ConnectionDetails = {
      serverUrl: LIVEKIT_URL,
      roomName,
      participantToken: participantToken,
      participantName,
    };
    const headers = new Headers({
      'Cache-Control': 'no-store',
    });
    const response = NextResponse.json(data, { headers });
    if (deviceId) {
      response.cookies.set({
        name: DEVICE_ID_COOKIE,
        value: deviceId,
        path: '/',
        sameSite: 'lax',
        httpOnly: false,
        secure: false,
        maxAge: 60 * 60 * 24 * 365,
      });
    }
    return response;
  } catch (error) {
    if (error instanceof Error) {
      console.error(error);
      return new NextResponse(error.message, { status: 500 });
    }
  }
}

function createParticipantToken(
  userInfo: AccessTokenOptions,
  roomName: string,
  agentName?: string
): Promise<string> {
  const at = new AccessToken(API_KEY, API_SECRET, {
    ...userInfo,
    ttl: '15m',
  });
  const grant: VideoGrant = {
    room: roomName,
    roomJoin: true,
    canPublish: true,
    canPublishData: true,
    canSubscribe: true,
  };
  at.addGrant(grant);

  if (agentName) {
    at.roomConfig = new RoomConfiguration({
      agents: [{ agentName }],
    });
  }

  return at.toJwt();
}

function readRequestedAgentName(body: Record<string, unknown>): string | undefined {
  const roomConfig = body.room_config;
  if (!roomConfig || typeof roomConfig !== 'object') return undefined;
  const agents = (roomConfig as { agents?: unknown }).agents;
  if (!Array.isArray(agents) || agents.length === 0) return undefined;
  const candidate = agents[0];
  if (!candidate || typeof candidate !== 'object') return undefined;
  const name = (candidate as { agent_name?: unknown }).agent_name;
  if (typeof name !== 'string') return undefined;
  const trimmed = name.trim();
  return trimmed || undefined;
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

async function fetchStarterAgentSettings(deviceId: string): Promise<StarterAgentSettings | null> {
  if (!API_BASE_URL) {
    return null;
  }

  try {
    const endpoint = `${API_BASE_URL.replace(/\/+$/, '')}/v1/livekit/starter/agent-settings/${encodeURIComponent(deviceId)}`;
    const response = await fetch(endpoint, {
      method: 'GET',
      cache: 'no-store',
    });
    if (response.status === 404) {
      return null;
    }
    if (!response.ok) {
      return null;
    }
    const raw = (await response.json()) as { data?: unknown };
    return normalizeStarterAgentSettings(raw.data);
  } catch {
    return null;
  }
}
