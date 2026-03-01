import { describe, expect, it } from "vitest";
import { normalizeDisplayName } from "../../src/utils/normalize.js";

describe("normalizeDisplayName", () => {
  it("trims and lowercases", () => {
    expect(normalizeDisplayName("  IsMetKaRaKus  ")).toBe("ismetkarakus");
  });

  it("keeps internal spaces", () => {
    expect(normalizeDisplayName("John Doe")).toBe("john doe");
  });
});
