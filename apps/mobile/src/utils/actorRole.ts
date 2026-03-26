import type { AuthSession } from "./auth";

export type ActorRole = "buyer" | "seller";

export function actorRoleHeader(auth: AuthSession, role: ActorRole): Record<string, string> {
  if (auth.userType !== "both") return {};
  return { "x-actor-role": role };
}
