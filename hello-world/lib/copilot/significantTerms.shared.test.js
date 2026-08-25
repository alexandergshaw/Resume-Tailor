// One tokenizer, three consumers — and one deliberate holdout.
//
// `significantTerms` existed as FOUR private copies: projectStories.js,
// meetingContext.js, insightsLocal.js and resumeAnchor.js. Three were
// byte-identical. The fourth was not, and that difference is the whole reason
// this file exists.
//
// The risk in a consolidation like this is not that it breaks loudly. It is
// that a near-identical copy gets folded into the shared one and takes its
// deliberate differences with it, silently, while every test still passes
// because nothing ever compared them. So this file pins BOTH halves: that the
// three really were merged, and that the fourth was left alone on purpose.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { significantTerms } from "./projectStories.js";

const read = (rel) => readFileSync(path.join(process.cwd(), rel), "utf8");

describe("the shared tokenizer's behaviour", () => {
  // A frozen literal oracle of the implementation all three copies had before
  // consolidation, inlined here rather than imported. If the shared version
  // ever drifts, this disagrees — which is the one thing a test that simply
  // called the shared function could never notice.
  const historical = (text) =>
    new Set(String(text || "").toLowerCase().match(/[a-z0-9]{4,}/g) || []);

  const CASES = [
    "We moved billing off the legacy processor",
    "HPA autoscaling on Kubernetes 1.29",
    "a an the of to",
    "200 400 8080",
    "Mixed CASE and Punctuation! Here.",
    "",
    "   ",
    "hyphenated-words and under_scores",
  ];

  it("matches the implementation all three copies had, case for case", () => {
    for (const text of CASES) {
      expect([...significantTerms(text)].sort(), text).toEqual([...historical(text)].sort());
    }
  });

  it("keeps the properties the callers actually rely on", () => {
    // Stated explicitly so the oracle above is not the only description of
    // this function's contract — a frozen snapshot says what it DOES, not
    // what any of it is for.
    const terms = significantTerms("Legacy PROCESSOR migration 2026 to a new hub");
    // Lowercased, so overlap scoring is case-insensitive.
    expect(terms.has("processor")).toBe(true);
    // Four characters or more only: "to", "a", "new" and "hub" are dropped.
    expect(terms.has("new")).toBe(false);
    expect(terms.has("hub")).toBe(false);
    // Digits count as characters, so a year survives. resumeAnchor's variant
    // deliberately does NOT keep bare numbers — see below.
    expect(terms.has("2026")).toBe(true);
    // A Set, so a repeated word cannot inflate an overlap score.
    expect(terms instanceof Set).toBe(true);
  });

  it("never throws on input that is not a string", () => {
    for (const bad of [null, undefined, 42, {}, []]) {
      expect(() => significantTerms(bad)).not.toThrow();
    }
  });
});

describe("the copies it replaces are actually gone", () => {
  // Source text, deliberately: the property being asserted IS the shape of
  // the source. `grounding.test.js` uses reference identity for the same job,
  // which is only available because those modules export the function — these
  // two do not, and should not start exporting one just to be testable.
  // `lib/meeting/meetingContext.js` used to be on this list and is no longer,
  // for a reason worth writing down: it stopped calling the tokenizer at all.
  // Its `rankMeetingPages` is now `rankPagesByRelevance` from
  // lib/experience/knowledgeBase.js, so knowledgeBase.js is the module that
  // really imports the shared tokenizer and meetingContext.js is one hop
  // behind it. Keeping meetingContext.js here forced it to retain an import it
  // never calls purely to satisfy this file — which is precisely the failure
  // the second assertion below was written to catch, arriving from the
  // opposite direction: an import that proves nothing because nothing uses it.
  // meetingContext.js keeps its own case further down instead.
  const consumers = ["lib/meeting/insightsLocal.js", "lib/experience/knowledgeBase.js"];

  it("leaves no private significantTerms behind in the modules that now import it", () => {
    for (const rel of consumers) {
      expect(read(rel), rel).not.toMatch(/function\s+significantTerms\s*\(/);
    }
  });

  it("has those modules import it from the canonical home", () => {
    // Paired with the assertion above, because "no local copy" is equally
    // true of a module that stopped using the tokenizer altogether.
    for (const rel of consumers) {
      expect(read(rel), rel).toMatch(/import\s*\{[^}]*significantTerms[^}]*\}\s*from\s*["'][^"']*projectStories/);
    }
  });

  it("has meetingContext delegate its ranking rather than keep a private tokenizer", () => {
    // The same guarantee for the module that no longer tokenizes directly:
    // no private copy, and its ranking really does come from the one shared
    // implementation rather than a second one that could drift from it.
    const src = read("lib/meeting/meetingContext.js");
    expect(src).not.toMatch(/function\s+significantTerms\s*\(/);
    expect(src).toMatch(/import\s*\{[^}]*rankPagesByRelevance[^}]*\}\s*from\s*["'][^"']*knowledgeBase/);
    expect(src).toMatch(/rankMeetingPages\s*=\s*rankPagesByRelevance/);
  });
});

describe("resumeAnchor keeps its own on purpose", () => {
  // THE holdout. Its tokenizer is not a stale duplicate of the shared one -
  // it differs in three deliberate ways, and folding it in would silently
  // undo all three while every test that only exercises the SHARED function
  // stayed green.
  it("still has a private tokenizer, and a comment saying why", () => {
    const src = read("lib/copilot/resumeAnchor.js");
    expect(src).toMatch(/function\s+significantTerms\s*\(/);
    // The three-character floor and the two filters are what make it
    // different; if someone deletes the local copy this assertion is what
    // tells them it was not redundant.
    expect(src).toContain("{3,}");
    expect(src).toMatch(/STOPWORDS/);
  });

  it("differs from the shared tokenizer on a bare number", () => {
    // Deliberately a FOUR-digit number. "200" would prove nothing: it is
    // three characters, so the shared tokenizer drops it on the length floor
    // and resumeAnchor's variant drops it on the bare-number filter — same
    // outcome, different reasons, no contrast demonstrated. Only a run of
    // digits long enough to clear the shared floor isolates the filter as the
    // thing that differs.
    expect(significantTerms("Handled 8080 requests").has("8080")).toBe(true);

    // resumeAnchor's variant drops it, and its own suite already pins that
    // behaviourally: see the "C3 regression" case in resumeAnchor.test.js,
    // where a Barista role scored a match on a systems-design question purely
    // because both mentioned "200". That test is what makes the local copy
    // load-bearing rather than stale, so it is deliberately NOT duplicated
    // here — this file pins that the variant still EXISTS, that one pins what
    // it does.
    //
    // `significantTerms` is private to resumeAnchor.js and stays that way:
    // exporting it purely to compare the two would put a second tokenizer on
    // this module's public surface and invite exactly the merge this file
    // exists to prevent.
    expect(read("lib/copilot/resumeAnchor.js")).toContain("^\\d+$");
  });
});
