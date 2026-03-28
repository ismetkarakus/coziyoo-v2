import type { AuthSession } from "./auth";

export type ActorRole = "buyer" | "seller";

export function actorRoleHeader(auth: AuthSession, role: ActorRole): Record<string, string> {
  void auth;
  return { "x-actor-role": role };
}
