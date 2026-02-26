import { NextResponse } from 'next/server';

function normalizeBaseUrl(raw: string) {
  const value = raw.trim();
  if (!value) return '';
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return '';
    }
    return parsed.toString().replace(/\/+$/, '');
  } catch {
    return '';
  }
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const baseUrl = normalizeBaseUrl(url.searchParams.get('baseUrl') ?? '');
  if (!baseUrl) {
    return NextResponse.json({ error: { message: 'Invalid baseUrl' } }, { status: 400 });
  }

  const endpoint = `${baseUrl}/api/ui/initial-data`;
  try {
    const upstream = await fetch(endpoint, {
      method: 'GET',
      cache: 'no-store',
    });
    const raw = await upstream.text();
    if (!upstream.ok) {
      return NextResponse.json(
        { error: { message: `Chatterbox request failed (${upstream.status})`, detail: raw } },
        { status: 502 }
      );
    }

    let payload: unknown = null;
    try {
      payload = raw ? JSON.parse(raw) : null;
    } catch {
      return NextResponse.json(
        { error: { message: 'Invalid JSON from chatterbox server' } },
        { status: 502 }
      );
    }

    const predefined = (payload as { predefined_voices?: unknown })?.predefined_voices;
    const voices = Array.isArray(predefined)
      ? predefined
          .map((item) => {
            if (typeof item === 'string') return item.trim();
            if (item && typeof item === 'object') {
              const filename = (item as { filename?: unknown }).filename;
              return typeof filename === 'string' ? filename.trim() : '';
            }
            return '';
          })
          .filter((name) => name.length > 0)
      : [];

    const uniqueVoices = Array.from(new Set(voices)).sort((a, b) => a.localeCompare(b));
    return NextResponse.json({ data: { voices: uniqueVoices } }, { status: 200 });
  } catch (error) {
    return NextResponse.json(
      {
        error: {
          message:
            error instanceof Error ? error.message : 'Failed to fetch chatterbox voices',
        },
      },
      { status: 502 }
    );
  }
}
