import { NextResponse } from 'next/server';

const API_BASE_URL =
  process.env.API_BASE_URL?.trim() ||
  process.env.NEXT_PUBLIC_API_BASE_URL?.trim() ||
  'https://api.example.com';

export const revalidate = 0;

export async function GET() {
  try {
    const upstream = await fetch(`${API_BASE_URL}/v1/livekit/starter/tools/status`, {
      method: 'GET',
      cache: 'no-store',
    });

    const raw = await upstream.text();
    const parsed = raw ? JSON.parse(raw) : {};
    return NextResponse.json(parsed, { status: upstream.status });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Tool status failed';
    return NextResponse.json({ error: { message } }, { status: 500 });
  }
}
