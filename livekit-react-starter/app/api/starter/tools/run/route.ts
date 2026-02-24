import { NextResponse } from 'next/server';

type ToolRunRequest = {
  toolId?: string;
  input?: string;
  roomName?: string;
  username?: string;
};

const API_BASE_URL =
  process.env.API_BASE_URL?.trim() ||
  process.env.NEXT_PUBLIC_API_BASE_URL?.trim() ||
  'https://api.example.com';

export const revalidate = 0;

export async function POST(req: Request) {
  try {
    const body = (await req.json()) as ToolRunRequest;
    const toolId = String(body.toolId ?? '').trim();

    if (!toolId) {
      return NextResponse.json({ error: { message: 'toolId is required' } }, { status: 400 });
    }

    const upstream = await fetch(`${API_BASE_URL}/v1/livekit/starter/tools/run`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        toolId,
        input: String(body.input ?? ''),
        roomName: body.roomName,
        username: body.username,
      }),
      cache: 'no-store',
    });

    const raw = await upstream.text();
    const parsed = raw ? JSON.parse(raw) : {};
    return NextResponse.json(parsed, { status: upstream.status });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Tool run failed';
    return NextResponse.json({ error: { message } }, { status: 500 });
  }
}
