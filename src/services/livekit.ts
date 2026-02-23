import { AccessToken, type VideoGrant } from "livekit-server-sdk";
import { env } from "../config/env.js";

function configured() {
  return Boolean(env.LIVEKIT_URL && env.LIVEKIT_API_KEY && env.LIVEKIT_API_SECRET);
}

export function isLiveKitConfigured() {
  return configured();
}

type MintTokenInput = {
  identity: string;
  name?: string;
  metadata?: string;
  ttlSeconds?: number;
  grant: VideoGrant;
};

export async function mintLiveKitToken(input: MintTokenInput) {
  if (!configured()) {
    throw new Error("LIVEKIT_NOT_CONFIGURED");
  }

  const token = new AccessToken(env.LIVEKIT_API_KEY as string, env.LIVEKIT_API_SECRET as string, {
    identity: input.identity,
    name: input.name,
    metadata: input.metadata,
    ttl: `${input.ttlSeconds ?? env.LIVEKIT_TOKEN_TTL_SECONDS}s`,
  });
  token.addGrant(input.grant);

  return token.toJwt();
}
