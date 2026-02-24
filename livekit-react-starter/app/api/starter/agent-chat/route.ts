import { NextResponse } from 'next/server';

type AgentChatRequest = {
  roomName?: string;
  text?: string;
};

type AgentChatResponse = {
  error?: { message?: string };
};

const API_BASE_URL =
  process.env.API_BASE_URL?.trim() ||
  process.env.NEXT_PUBLIC_API_BASE_URL?.trim() ||
  'https://api.coziyoo.com';

export const revalidate = 0;

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as AgentChatRequest;
    const roomName = String(body.roomName ?? '').trim();
    const text = String(body.text ?? '').trim();

    if (!roomName || !text) {
      return NextResponse.json(
        { error: { message: 'roomName and text are required' } },
        { status: 400 }
      );
    }

    const upstream = await fetch(`${API_BASE_URL}/v1/livekit/starter/agent/chat`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({ roomName, text }),
      cache: 'no-store',
    });

    const raw = await upstream.text();
    if (!upstream.ok) {
      let message = 'Agent chat failed';
      try {
        const parsed = raw ? (JSON.parse(raw) as AgentChatResponse) : {};
        message = parsed.error?.message ?? message;
      } catch {
        message = raw || message;
      }
      return NextResponse.json({ error: { message } }, { status: upstream.status });
    }

    return NextResponse.json({ ok: true }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Agent chat failed';
    return NextResponse.json({ error: { message } }, { status: 500 });
  }
}
