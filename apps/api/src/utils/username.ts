import { randomBytes } from "node:crypto";
import { normalizeUsername } from "./normalize.js";

type DbClient = {
  query: <T = { username_normalized: string }>(
    text: string,
    params?: unknown[],
  ) => Promise<{ rows: T[] }>;
};

const MIN_USERNAME_LENGTH = 3;
const MAX_USERNAME_LENGTH = 30;

function clampBase(base: string): string {
  const normalized = normalizeUsername(base);
  if (normalized.length >= MIN_USERNAME_LENGTH) return normalized.slice(0, MAX_USERNAME_LENGTH);
  return "";
}

function randomSuffix(length = 2): string {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  const bytes = randomBytes(length);
  let out = "";
  for (let i = 0; i < length; i += 1) {
    out += chars[bytes[i] % chars.length];
  }
  return out;
}

function buildWithSuffix(base: string, suffix: string): string {
  const maxBaseLen = Math.max(MIN_USERNAME_LENGTH, MAX_USERNAME_LENGTH - suffix.length);
  return `${base.slice(0, maxBaseLen)}${suffix}`;
}

function buildInitialCandidates(base: string): string[] {
  const out: string[] = [];
  if (base) out.push(base);
  if (base) out.push(buildWithSuffix(base, "_"));
  if (base) out.push(buildWithSuffix(base, ".tr"));
  if (base) out.push(buildWithSuffix(base, ".x"));
  return Array.from(new Set(out.filter((v) => v.length >= MIN_USERNAME_LENGTH)));
}

async function loadTakenSet(db: DbClient, base: string): Promise<Set<string>> {
  if (!base) return new Set();
  const likePattern = `${base}%`;
  const rows = await db.query<{ username_normalized: string }>(
    `SELECT username_normalized
     FROM users
     WHERE username_normalized = $1 OR username_normalized LIKE $2
     LIMIT 500`,
    [base, likePattern],
  );
  return new Set(
    rows.rows
      .map((row) => String(row.username_normalized ?? "").trim().toLowerCase())
      .filter((value) => value.length > 0),
  );
}

function fallbackBaseFromEmail(email: string): string {
  const local = email.split("@")[0] ?? "";
  return clampBase(local) || "kullanici";
}

export function normalizeRequestedUsername(value: string): string {
  const normalized = clampBase(value);
  return normalized.length >= MIN_USERNAME_LENGTH ? normalized : "";
}

export async function ensureUniqueUsername(
  db: DbClient,
  input: {
    email: string;
    displayName?: string | null;
    requestedUsername?: string | null;
  },
): Promise<{ username: string; usernameNormalized: string }> {
  const preferred =
    normalizeRequestedUsername(input.requestedUsername ?? "") ||
    clampBase(input.displayName ?? "") ||
    fallbackBaseFromEmail(input.email);

  const taken = await loadTakenSet(db, preferred);
  const initial = buildInitialCandidates(preferred);
  for (const candidate of initial) {
    if (!taken.has(candidate)) {
      return { username: candidate, usernameNormalized: candidate };
    }
  }

  for (let i = 0; i < 40; i += 1) {
    const candidate = buildWithSuffix(preferred, randomSuffix(2));
    if (!taken.has(candidate)) {
      return { username: candidate, usernameNormalized: candidate };
    }
  }

  for (let i = 1; i < 10_000; i += 1) {
    const candidate = buildWithSuffix(preferred, String(i));
    if (!taken.has(candidate)) {
      return { username: candidate, usernameNormalized: candidate };
    }
  }

  const hardFallback = buildWithSuffix("kullanici", randomSuffix(6));
  return { username: hardFallback, usernameNormalized: hardFallback };
}

export async function checkUsernameAvailability(
  db: DbClient,
  value: string,
): Promise<{ requested: string; normalized: string; available: boolean; suggestions: string[] }> {
  const normalized = normalizeRequestedUsername(value);
  if (!normalized) {
    return { requested: value, normalized, available: false, suggestions: [] };
  }

  const taken = await loadTakenSet(db, normalized);
  const available = !taken.has(normalized);
  const suggestions: string[] = [];

  for (const candidate of buildInitialCandidates(normalized)) {
    if (!taken.has(candidate)) suggestions.push(candidate);
    if (suggestions.length >= 3) break;
  }

  let guard = 0;
  while (suggestions.length < 3 && guard < 25) {
    const candidate = buildWithSuffix(normalized, randomSuffix(2));
    if (!taken.has(candidate) && !suggestions.includes(candidate)) suggestions.push(candidate);
    guard += 1;
  }

  return { requested: value, normalized, available, suggestions: suggestions.slice(0, 3) };
}
