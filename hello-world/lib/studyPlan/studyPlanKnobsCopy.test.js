// N157 SC-D wave D-a (step 4b TDD) -- the ADDITIVE knobs copy group.
//
// Binds to docs/loop/N157.SC-D.design.r1.md section 3.10 (the new `knobs`
// group in lib/studyPlan/studyPlanCopy.js, additive). These are design-pinned
// strings: changing one is a ruling, because the D-b controls render them
// verbatim and summarizeKnobs composes the closed-panel caption from them.
//
// RED ON HEAD, and WHY: studyPlanCopy.js already exists (SC-C landed it), so
// this import resolves -- but the knobs group it needs is NOT there yet, so
// every `has(...)` below returns false and each `it` reds on a POSITIVE
// assertion (never a vacuous `not.toContain`). Honest additive red.
//
// SCOPE NOTE (read by the implementer): D-a's copy edit is ADDITIVE ONLY. Do
// NOT modify STUDY_COPY.notice.gemini. The design's PD-SD-3 (append a focus/
// skip sentence to that notice) is an UNSETTLED pinned-string ruling, and the
// landed studyPlanCopy.test.js pins notice.gemini VERBATIM -- touching it here
// would red that landed suite, which this seat has no ruling to authorize.
// The orchestrator settles PD-SD-3 separately; until then the gemini notice
// stays byte-identical.
//
// WHAT THIS SUITE DOES NOT PIN, on purpose: the days helper/error copy
// ("Between 1 and 90 ...", "... 1 to 90.") embeds the retunable MAX_PLAN_DAYS
// cap, so pinning its wording would couple a test to a magic literal the owner
// may retune. Those strings are left to render-time; the cap itself is pinned
// (to the CONSTANT) in studyPlanKnobs.test.js. The em-dash / emoji class guard
// over ALL exported copy already lives in the landed studyPlanCopy.test.js and
// automatically sweeps these new strings, so it is not duplicated here.

import { describe, it, expect, beforeAll } from "vitest";

let strings = [];

function collectStrings(value, out, seen) {
  if (typeof value === "string") {
    out.push(value);
    return;
  }
  if (value === null || typeof value !== "object") return;
  if (seen.has(value)) return;
  seen.add(value);
  for (const v of Object.values(value)) collectStrings(v, out, seen);
}

beforeAll(async () => {
  const mod = await import("@/lib/studyPlan/studyPlanCopy.js");
  const out = [];
  collectStrings(mod, out, new WeakSet());
  strings = out;
});

const has = (s) => strings.includes(s);

// Stable, non-numeric design-pinned strings the knobs group must add. Each is
// a RAW string. A reworded or missing one reds.
const PINNED = [
  // disclosure labels (create step / open outline)
  "Customize your plan",
  "Plan settings",
  // mix control legend + the three preset labels
  "Mix of new and review cards",
  "Mostly new",
  "Even mix",
  "Mostly review",
  // areas control legend + the two per-area toggles
  "Areas",
  "Focus",
  "Skip",
  // days control legend (no cap number, so safe to pin)
  "Days until your interview",
  // summary "areas" clause when nothing is excluded/focused
  "All areas",
  // the last-included guard reason (never an aria-label; visible copy)
  "At least one area stays included.",
  // the post-plan remediation suggestion button
  "Focus on these",
  // the staged-change dirty note
  "Settings changed. Rebuild the plan to apply them.",
  // per-engine honesty captions
  "The embedded engine ignores focus areas and the number of days. It does use the mix and skipped areas.",
  "Gemini is asked to follow these; the result can vary.",
];

describe("studyPlanCopy: the additive knobs group (changing one is a ruling)", () => {
  it.each(PINNED)("exports the pinned string: %s", (expected) => {
    expect(has(expected)).toBe(true);
  });
});

describe("the knobs group actually shipped (guards an empty addition)", () => {
  it("adds the disclosure + the two toggle labels at minimum", () => {
    // If the group were absent or empty every has() above would red; this
    // makes the 'nothing was added' failure mode explicit rather than implied.
    expect(has("Customize your plan")).toBe(true);
    expect(has("Focus")).toBe(true);
    expect(has("Skip")).toBe(true);
  });
});
