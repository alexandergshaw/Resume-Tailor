// N105 Step 3a (4b) — PURE truthfulness gate (K2 half-two, AC-4).
// Binds to: N105.plan.r2.md Step 3a + PL-5; N105.design.r2.md §5 + D-6; AC-4.
//
// AC-4's four fixture rows, each built so SUPPORT and MEMBERSHIP provably cannot
// collapse into a single span (a union/whole-doc comparison would pass the
// cross-employer row — this fixture is designed to red it). failable-count and
// keepable-count are both asserted > 0 so the fixture is neither zero-power
// (nothing could fail) nor liveness-free (nothing must be kept).
//
// RED on HEAD: module absent (collection failure); satisfiability proven by the
// scratchpad reference.

import { describe, it, expect } from "vitest";
import { applicationReadyGate } from "./applicationReadyGate.js";

// The user's OWN real material. Two employers, one real metric each, so a
// cross-employer leak is detectable (A's metric must not support a B bullet).
const realMaterial = {
  spans: [
    { id: "r1", text: "Reduced support tickets at Acme Corp", contextKey: "Acme Corp" },
    { id: "r2", text: "Managed a budget of $200k at Beta LLC", contextKey: "Beta LLC" },
  ],
  chronology: {
    employers: [
      { name: "Acme Corp", start: "2020", end: "2024" },
      { name: "Beta LLC", start: "2017", end: "2020" },
    ],
  },
};

// Candidate spans produced by mapping the hypothetical onto the real chronology.
// Row ids name which AC-4 row each exercises.
const candidateSpans = [
  // (iii) MUST-SURVIVE: a truthful reframe of r1 introducing NO new factual
  // token ("reduced" -> "cut ... volume", no new number/scope/authority).
  { id: "c_reframe", text: "Cut support-ticket volume at Acme Corp", section: "EXPERIENCE", contextKey: "Acme Corp" },
  // (iv) MUST-KEEP (liveness): a supported accomplishment about Beta LLC.
  { id: "c_supported", text: "Managed a $200k budget at Beta LLC", section: "EXPERIENCE", contextKey: "Beta LLC" },
  // (i) MUST-DROP (fabrication): a number present in NO real span.
  { id: "c_fabrication", text: "Scaled the platform to 10,000,000 users at Acme Corp", section: "EXPERIENCE", contextKey: "Acme Corp" },
  // (ii) MUST-DROP (membership): Acme's real metric asserted under Beta LLC.
  { id: "c_crossemployer", text: "Reduced support tickets at Beta LLC", section: "EXPERIENCE", contextKey: "Beta LLC" },
];

function run() {
  return applicationReadyGate({ candidateSpans, realMaterial });
}

const idsIn = (bucket) => bucket.map((s) => s.id);

describe("applicationReadyGate — SUPPORT + MEMBERSHIP + LIVENESS (AC-4)", () => {
  it("returns the three buckets kept / flagged / dropped", () => {
    const out = run();
    expect(Array.isArray(out.kept)).toBe(true);
    expect(Array.isArray(out.flagged)).toBe(true);
    expect(Array.isArray(out.dropped)).toBe(true);
  });

  // ROW (iii) MUST-SURVIVE — the step-5 aggressive-but-truthful reframe must be
  // reachable, else the gate is degenerate-closed.
  it("KEEPS a truthful reframe that introduces no new factual token", () => {
    const out = run();
    expect(idsIn(out.kept)).toContain("c_reframe");
  });

  // ROW (iv) MUST-KEEP (liveness) — at least one supported claim survives.
  it("KEEPS a supported accomplishment under its real employer (liveness)", () => {
    const out = run();
    expect(idsIn(out.kept)).toContain("c_supported");
  });

  // ROW (i) MUST-DROP (fabrication) — a new number traces to no real span.
  it("does NOT keep a fabricated claim (dropped or flagged, never kept)", () => {
    const out = run();
    expect(idsIn(out.kept)).not.toContain("c_fabrication");
    expect([...idsIn(out.dropped), ...idsIn(out.flagged)]).toContain("c_fabrication");
  });

  // ROW (ii) MUST-DROP (membership) — the cross-employer leak. A union/whole-doc
  // SUPPORT check would KEEP this (Acme's real span exists somewhere), so this
  // row is the discriminator the design calls for.
  it("does NOT keep employer A's real metric asserted under employer B", () => {
    const out = run();
    expect(idsIn(out.kept)).not.toContain("c_crossemployer");
    expect([...idsIn(out.dropped), ...idsIn(out.flagged)]).toContain("c_crossemployer");
  });

  // The flag carries the ONE exported AC-4 constant (never retyped); exact
  // literal is pinned in the Step 8 constant test. Here: any flagged row carries
  // a non-empty flag string naming the unverified-confirm obligation.
  it("every flagged row carries the unverified-confirm flag string", () => {
    const out = run();
    for (const row of out.flagged) {
      expect(typeof row.flag).toBe("string");
      expect(row.flag).toMatch(/unverified/i);
      expect(row.flag).toMatch(/confirm/i);
    }
  });

  // Zero-power / liveness-power guard, asserted in the test itself (the AC asks
  // the seat to STATE both counts; this makes the statement executable).
  it("the fixture has failable-count > 0 AND keepable-count > 0", () => {
    const out = run();
    const notKept = new Set([...idsIn(out.dropped), ...idsIn(out.flagged)]);
    const failable = ["c_fabrication", "c_crossemployer"].filter((id) => notKept.has(id)).length;
    const keepable = ["c_reframe", "c_supported"].filter((id) => idsIn(out.kept).includes(id)).length;
    expect(failable).toBeGreaterThan(0);
    expect(keepable).toBeGreaterThan(0);
  });
});
