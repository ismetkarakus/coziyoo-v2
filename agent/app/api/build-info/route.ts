import { NextResponse } from 'next/server';

const COMMIT_SHA =
  process.env.GIT_COMMIT_SHA?.trim() ||
  process.env.SOURCE_COMMIT?.trim() ||
  process.env.VERCEL_GIT_COMMIT_SHA?.trim() ||
  process.env.RAILWAY_GIT_COMMIT_SHA?.trim() ||
  process.env.NEXT_PUBLIC_GIT_COMMIT_SHA?.trim() ||
  '';

export async function GET() {
  return NextResponse.json(
    {
      data: {
        commitSha: COMMIT_SHA || null,
        shortCommitSha: COMMIT_SHA ? COMMIT_SHA.slice(0, 8) : null,
      },
    },
    {
      headers: {
        'cache-control': 'no-store',
      },
    }
  );
}
