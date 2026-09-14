import { describe, it, expect } from "vitest";
import { isBlocked } from "./blocked.mjs";

describe("isBlocked", () => {
  it("no-op control: an empty blocked_by is never blocked", () => {
    expect(isBlocked({ blocked_by: [] })).toBe(false);
  });

  it("a non-empty blocked_by blocks, even with one entry — kills an off-by-one mutant (length > 1)", () => {
    expect(isBlocked({ blocked_by: ["N1"] })).toBe(true);
  });

  it("a DANGLING blocker (an id that does not exist anywhere) still blocks — never silently unblocks", () => {
    // Resolving a blocker is always an explicit removal from blocked_by; the id's mere absence
    // from the rest of the item set must never be read as "resolved".
    expect(isBlocked({ blocked_by: ["ZZZ-does-not-exist"] })).toBe(true);
  });

  it("multiple blockers still block", () => {
    expect(isBlocked({ blocked_by: ["N1", "N2"] })).toBe(true);
  });
});
