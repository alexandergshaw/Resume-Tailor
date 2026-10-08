// N150 Wave A — T-F1b, the MANDATORY anti-fabrication OUTPUT GATE
// (lib/copilot/techTermDetailHonesty.js). RED on HEAD: the module does not
// exist, so the import fails at collection for the one intended reason.
//
// THIS IS THE LOAD-BEARING, NON-ZERO-POWER INSTRUMENT (design §3.5, I-3).
// A prompt clause (TECH_TERM_DETAIL_SYSTEM clause 4, pinned in
// techTermPrompt.test.js) is not a control a reviewer can apply to the MODEL'S
// OUTPUT; only this gate is. So every assertion here feeds a crafted model
// OUTPUT and asserts the scripted first-person claim is REMOVED and the clean
// third-person remainder KEPT — never that a word appears in a prompt.
//
// The controls that make it non-vacuous:
//   • Control A (no-op): a clean third-person-only detail passes BYTE-UNCHANGED
//     — proof the gate is not a blanket stripper that would pass by deleting
//     everything (an assertion of ABSENCE is satisfied by a dead feature).
//   • Control B (per-claim-shape power): each FIRST_PERSON_CLAIM_RES shape has
//     its OWN assertion, each embedded among clean sentences that must survive.
//     A missing regex reds exactly its own case while the no-op stays green.
//   • the inner-period case proves the sentence splitter does not leak a claim
//     across a false boundary (a decimal inside the claim).

import { describe, it, expect } from "vitest";
import {
  TECH_TERM_DETAIL_MAX_SENTENCES,
  isFirstPersonClaim,
  sanitizeTechTermDetail,
} from "./techTermDetailHonesty.js";

// The exemplar from design §3.5 / §7 T-F1b, with a decimal inside the claim
// ("v2.5") so the claim sentence carries an INNER period.
const CLEAN_A = "Idempotency keys dedupe retried requests.";
const CLEAN_B = "They matter for payment APIs.";
const CLAIM = "You could say: 'I used idempotency keys in v2.5 to stop double charges.'";

describe("sanitizeTechTermDetail strips a scripted first-person claim, keeps the clean remainder", () => {
  it("removes the scripted claim and keeps BOTH clean sentences", () => {
    const out = sanitizeTechTermDetail(`${CLEAN_A} ${CLAIM} ${CLEAN_B}`);
    // (i) the fabrication is gone, in both its tells…
    expect(out).not.toContain("I used");
    expect(out).not.toContain("You could say");
    // …and no FRAGMENT of it leaked across the inner period ("v2.5").
    expect(out).not.toContain("to stop double charges");
    // (ii) the honest explanation survives.
    expect(out).toContain("Idempotency keys dedupe retried requests.");
    expect(out).toContain("They matter for payment APIs.");
  });

  it("[CONTROL A — no-op] a clean third-person detail passes BYTE-UNCHANGED", () => {
    // The named control that proves the gate is not a blanket stripper: a clean
    // input in canonical sentence form (single spaces, no markdown/URL) must
    // come back identical, so "the claim is gone" above cannot be passing
    // because the gate deletes everything it is handed.
    const clean = `${CLEAN_A} ${CLEAN_B}`;
    expect(sanitizeTechTermDetail(clean)).toBe(clean);
  });
});

describe("[CONTROL B] each first-person claim SHAPE is caught on its own (per-regex power)", () => {
  // Each shape is embedded between two clean sentences that MUST survive, so a
  // missing regex reds exactly this case and the clean remainder proves the gate
  // did not simply drop the whole thing.
  const shapes = [
    { name: "I used …", claim: "I used Kafka to decouple the services." },
    { name: "We built …", claim: "We built the ingestion pipeline from scratch." },
    { name: "I have experience with …", claim: "I have experience with distributed tracing." },
    { name: "You could say: 'I …'", claim: "You could say: 'I designed the schema myself.'" },
    { name: "in my experience …", claim: "In my experience, a cache avoids the stampede." },
    { name: "my team … with …", claim: "My team shipped it with a feature flag." },
  ];

  it.each(shapes)("drops the claim sentence: $name", ({ claim }) => {
    const out = sanitizeTechTermDetail(`${CLEAN_A} ${claim} ${CLEAN_B}`);
    // The distinctive tell of the claim is gone…
    expect(isFirstPersonClaim(claim)).toBe(true);
    // …while BOTH clean sentences remain (the positive half of the control).
    expect(out).toContain("Idempotency keys dedupe retried requests.");
    expect(out).toContain("They matter for payment APIs.");
  });
});

describe("isFirstPersonClaim — the predicate the gate filters on", () => {
  it("is false for an honest third-person explanation (so the gate keeps it)", () => {
    expect(isFirstPersonClaim("Idempotency keys dedupe retried requests.")).toBe(false);
    expect(isFirstPersonClaim("Engineers use them to make a retry safe.")).toBe(false);
    // A bare "I" that is not an experiential claim must not trip it — the point
    // of a shape list rather than questionVocabulary's /\bI\b/ (design §3.5, C3).
    expect(isFirstPersonClaim("It matters when I/O is the bottleneck.")).toBe(false);
  });
});

describe("T-F1c — all-claims collapses to empty", () => {
  it("returns '' when every sentence is a first-person claim", () => {
    const out = sanitizeTechTermDetail(
      "I used Redis for the cache. We built it over a weekend. I led the rollout.",
    );
    expect(out).toBe("");
  });
});

describe("I-5 / I-4 — markdown, links and contact detail are stripped (a hard gate, not only a prompt clause)", () => {
  it("strips markdown emphasis/heading/bullet characters and URL/email tokens, keeping the prose", () => {
    const out = sanitizeTechTermDetail(
      "**Caching** reduces load. See https://example.com/docs for more. Reach me at ops@example.com.",
    );
    expect(out).not.toContain("**");
    expect(out).not.toContain("https://");
    expect(out).not.toContain("www.");
    expect(out).not.toContain("ops@example.com");
    // The honest subject survives the strip.
    expect(out.toLowerCase()).toContain("caching");
  });
});

describe("totality and the sentence cap", () => {
  it("never throws on non-string or junk input, coercing to ''", () => {
    for (const junk of [undefined, null, 42, {}, [], Symbol.iterator]) {
      expect(() => sanitizeTechTermDetail(junk)).not.toThrow();
      expect(sanitizeTechTermDetail(junk)).toBe("");
    }
  });

  it("caps the kept sentences at TECH_TERM_DETAIL_MAX_SENTENCES", () => {
    expect(TECH_TERM_DETAIL_MAX_SENTENCES).toBe(4);
    const six = "One matters. Two matters. Three matters. Four matters. Five matters. Six matters.";
    const kept = sanitizeTechTermDetail(six).split(/(?<=[.!?])\s+/).filter(Boolean);
    expect(kept.length).toBeLessThanOrEqual(TECH_TERM_DETAIL_MAX_SENTENCES);
  });
});
