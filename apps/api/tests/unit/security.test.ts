import { describe, expect, it } from "vitest";
import {
  generateRefreshToken,
  hashPassword,
  hashRefreshToken,
  verifyPassword,
} from "../../src/utils/security.js";

describe("security utils", () => {
  it("hashes and verifies passwords", async () => {
    const hash = await hashPassword("User12345!");
    expect(hash).toBeTypeOf("string");
    await expect(verifyPassword(hash, "User12345!")).resolves.toBe(true);
    await expect(verifyPassword(hash, "wrong-pass")).resolves.toBe(false);
  });

  it("generates unique refresh tokens", () => {
    const a = generateRefreshToken();
    const b = generateRefreshToken();
    expect(a).not.toBe(b);
    expect(a.length).toBeGreaterThan(20);
    expect(b.length).toBeGreaterThan(20);
  });

  it("hashes refresh token deterministically", () => {
    const token = "same-token";
    expect(hashRefreshToken(token)).toBe(hashRefreshToken(token));
    expect(hashRefreshToken(token)).not.toBe(hashRefreshToken("other-token"));
  });
});
