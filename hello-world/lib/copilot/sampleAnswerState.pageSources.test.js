// The knowledge-base citations must survive the cache, or an answer silently
// loses them the second time it is asked for.
//
// WHY THIS IS ITS OWN FILE AND ITS OWN CASE: a drafted answer now reports
// which of the candidate's own project pages each point came from. That field
// travels the same path `cues`, `buzzwords`, `anchor` and `idealProject`
// already travel — and every one of those had to be added to this slot
// explicitly. A field that reaches the render layer but not the cache
// produces an answer that shows its sources when freshly drafted and loses
// them on a cache hit, for the same question, with nothing on screen
// explaining why. useDraftAnswer.js's own comments already name that exact
// failure for `cues`; this is the case that stops it happening a second time.
//
// Written from the acceptance criteria before the field existed.

import { describe, it, expect } from "vitest";
import { emptySampleAnswer, cachedSampleAnswerFor } from "./sampleAnswerState.js";

const PROFILE = "Senior engineer, payments.";
const TYPE = "behavioral";
const APP = "app-1";
const QUESTION = "Tell me about a time you sharded a ledger.";

const P1 = { id: "p1", title: "Payments migration" };

function entry(extra = {}) {
  return {
    points: ["I led the ledger work.", "It cut p99 by 40 percent."],
    cues: ["The ledger", "The result"],
    buzzwords: [],
    anchor: null,
    idealProject: null,
    grounding: null,
    profile: PROFILE,
    interviewType: TYPE,
    applicationId: APP,
    ...extra,
  };
}

describe("sample answer state — page sources", () => {
  it("starts with no page sources rather than undefined", () => {
    // `undefined` would reach answerLines as a third argument and pair
    // against a length it cannot have, which is a different bug from "no
    // citations" and much harder to see.
    expect(emptySampleAnswer().pageSources).toEqual([]);
  });

  it("carries the page sources back out of the cache, in order", () => {
    const hit = cachedSampleAnswerFor(entry({ pageSources: [P1, null] }), QUESTION, PROFILE, TYPE, APP);
    expect(hit.pageSources).toEqual([P1, null]);
    // Positive control: the fields that already round-tripped still do, so a
    // change that broke the cache read entirely could not pass this file.
    expect(hit.points).toEqual(["I led the ledger work.", "It cut p99 by 40 percent."]);
    expect(hit.cues).toEqual(["The ledger", "The result"]);
  });

  it("resolves an entry cached before the field existed to no citations, never undefined", () => {
    // The real case: a draft queued earlier in the same open session by
    // useSampleAnswer's own pre-fetch, written before this field shipped.
    const hit = cachedSampleAnswerFor(entry(), QUESTION, PROFILE, TYPE, APP);
    expect(hit.pageSources).toEqual([]);
  });

  it("does not trust a malformed page-sources value off the cache", () => {
    for (const bad of [null, "p1", 7, {}]) {
      const hit = cachedSampleAnswerFor(entry({ pageSources: bad }), QUESTION, PROFILE, TYPE, APP);
      expect(hit.pageSources).toEqual([]);
    }
  });

  it("still refuses the whole entry when the grounding no longer matches", () => {
    // Page sources must never be the thing that makes a stale entry look
    // usable — the grounding check outranks every field it carries.
    expect(cachedSampleAnswerFor(entry({ pageSources: [P1, null] }), QUESTION, "a different profile", TYPE, APP)).toBe(
      null,
    );
  });
});
