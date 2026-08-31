import { describe, it, expect } from "vitest";
import { sha256Hex, driveCopyState } from "./contentHash.js";

describe("sha256Hex", () => {
  it("matches the known SHA-256 test vector for 'abc'", async () => {
    expect(await sha256Hex("abc")).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });

  it("matches the known SHA-256 test vector for the empty string", async () => {
    expect(await sha256Hex("")).toBe(
      "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
    );
  });

  it("is deterministic -- the same input hashes the same way twice", async () => {
    const a = await sha256Hex("the byte-source tuple, stringified");
    const b = await sha256Hex("the byte-source tuple, stringified");
    expect(a).toBe(b);
  });

  it("produces genuinely different digests for different input -- not a constant", async () => {
    const a = await sha256Hex("tuple A");
    const b = await sha256Hex("tuple B");
    // Prove the two inputs really are distinguishable after the transform,
    // not just distinct-looking before it (the canonicalisation-collision
    // trap this project shipped once).
    expect(a).not.toBe(b);
    expect(a).toHaveLength(64);
    expect(b).toHaveLength(64);
  });

  it("returns null, never a placeholder hash, for a null input (a scope with no bytes)", async () => {
    expect(await sha256Hex(null)).toBeNull();
  });

  it("returns null for an undefined input", async () => {
    expect(await sha256Hex(undefined)).toBeNull();
  });

  it("returns null for a non-string input rather than coercing it", async () => {
    expect(await sha256Hex(12345)).toBeNull();
  });

  it("hashes an empty string as real content, distinct from null", async () => {
    // Paired positive control for the null-guard tests above: "" must NOT
    // take the same short-circuit as null/undefined.
    const emptyHash = await sha256Hex("");
    expect(emptyHash).not.toBeNull();
    expect(emptyHash).toHaveLength(64);
  });
});

describe("driveCopyState", () => {
  it("reports 'current' when the recomputed hash equals the stored one", () => {
    expect(driveCopyState("deadbeef", "deadbeef")).toBe("current");
  });

  it("reports 'stale' when the hashes genuinely differ", () => {
    // Positive control: confirm the two fixture hashes used across this
    // suite are not accidentally identical before trusting the "stale"
    // verdict.
    const current = "aaaa1111";
    const stored = "bbbb2222";
    expect(current).not.toBe(stored);
    expect(driveCopyState(current, stored)).toBe("stale");
  });

  it("reports 'unknown' when there is no stored hash to compare against", () => {
    expect(driveCopyState("deadbeef", null)).toBe("unknown");
    expect(driveCopyState("deadbeef", undefined)).toBe("unknown");
  });

  it("reports 'unknown' when the current side has no hash (a null blob, AC-S28)", () => {
    expect(driveCopyState(null, "deadbeef")).toBe("unknown");
  });

  it("reports 'unknown' when neither side has a hash", () => {
    expect(driveCopyState(null, null)).toBe("unknown");
  });

  it("does not treat a non-string hash as a real one", () => {
    expect(driveCopyState(42, "deadbeef")).toBe("unknown");
    expect(driveCopyState("deadbeef", 42)).toBe("unknown");
  });
});
