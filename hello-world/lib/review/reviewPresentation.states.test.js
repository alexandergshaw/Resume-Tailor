// N103 Step 4 (implementer additions) -- the presentation states the landed
// reviewPresentation.test.js does not name: failed, covered, findings, stale, the
// hypothetical's own input rules, unknown coverage, and the extra clean conjuncts.
//
// Every row asserts the SAFE direction first (nothing here may read as reassuring
// unless it is the one licensed clean state), then the positive copy, so a build
// that drops a state or inherits a neighbour's wording fails a row.
//
// Node env: pure module.

import { describe, it, expect } from "vitest";
import { reviewPresentationState, REVIEW_STATE } from "./reviewPresentation.js";
import { REVIEW_KIND } from "./reviewVerdict.js";
import { CATEGORY } from "./contract.js";
import { CHECK_LABELS } from "./flagPresentation.js";

const FLOOR = [CATEGORY.MISSING_KEYWORD, CATEGORY.VAGUE_UNSUPPORTED, CATEGORY.REPETITION, CATEGORY.UNVERIFIABLE_METRIC];
const LLM = [CATEGORY.EMPLOYER_PLAUSIBILITY, CATEGORY.CONSISTENCY, CATEGORY.UNSUPPORTED_AUTHORITY];
const ALL = [...FLOOR, ...LLM];
const REASSURING = /no issues flagged|no weaknesses|all clear|looks good|safe to send|\bclean\b/i;
const FLAG = { category: CATEGORY.UNVERIFIABLE_METRIC, spanId: "s1", draftKind: "applicationReady", message: "m", excerpt: "x" };

function reviewed(over = {}) {
  return {
    status: "reviewed",
    draftKind: "applicationReady",
    title: "Resume",
    flags: [],
    unresolvedQualifications: [],
    verdictKind: REVIEW_KIND.PARTIAL,
    missingChecks: [...LLM],
    checkedChecks: [...FLOOR],
    engineMode: "mechanical-only",
    lineCount: 8,
    inputs: { posting: true, realMaterial: true },
    ...over,
  };
}

const complete = (over = {}) =>
  reviewed({ verdictKind: REVIEW_KIND.COMPLETE, engineMode: "full", missingChecks: [], checkedChecks: [...ALL], ...over });

const chrome = (s) => [s.headline, s.footer, s.announce, ...s.notice.checked, ...s.notice.notChecked, ...s.notice.sentences].join("\n");

describe("failed and unusable outcomes fall to the not-clean side", () => {
  it("a failed review is its own warning state with an alert-worthy sentence", () => {
    const s = reviewPresentationState({ outcome: { status: "failed" } });
    expect(s.state).toBe(REVIEW_STATE.FAILED);
    expect(s.tone).toBe("warning");
    expect(s.headline).toMatch(/could not run, so nothing was checked/i);
    expect(chrome(s)).not.toMatch(REASSURING);
  });

  it("no outcome at all, or an unknown status, is failed -- never clean", () => {
    for (const outcome of [undefined, null, {}, { status: "pending" }]) {
      const s = reviewPresentationState({ outcome });
      expect(s.state).toBe(REVIEW_STATE.FAILED);
    }
  });
});

describe("covered", () => {
  it("covered replaces the verdict with the one-line pointer and carries no notice or footer", () => {
    const s = reviewPresentationState({ outcome: null, covered: true });
    expect(s.state).toBe(REVIEW_STATE.COVERED);
    expect(s.headline).toMatch(/already covers this text/i);
    expect(s.notice).toEqual({ checked: [], notChecked: [], sentences: [] });
    expect(chrome(s)).not.toMatch(REASSURING);
  });
});

describe("findings (a complete review with something to check)", () => {
  it("names only non-zero counts and is not clean", () => {
    const s = reviewPresentationState({ outcome: complete({ flags: [FLAG] }) });
    expect(s.state).toBe(REVIEW_STATE.FINDINGS);
    expect(s.headline).toBe("1 to confirm");
    expect(s.announce).toBe("Review finished. 1 to check.");
    expect(chrome(s)).not.toMatch(REASSURING);
  });

  it("unresolved requirements count as things to check", () => {
    const s = reviewPresentationState({ outcome: complete({ unresolvedQualifications: [{ requirementId: "q1", text: "Kubernetes" }] }) });
    expect(s.state).toBe(REVIEW_STATE.FINDINGS);
    expect(s.announce).toBe("Review finished. 1 to check.");
  });
});

describe("clean is licensed by more than the verdict", () => {
  it("a complete review of zero lines is not clean", () => {
    expect(reviewPresentationState({ outcome: complete({ lineCount: 0 }) }).state).not.toBe(REVIEW_STATE.CLEAN);
    expect(reviewPresentationState({ outcome: complete({ lineCount: undefined }) }).state).not.toBe(REVIEW_STATE.CLEAN);
  });

  it("a complete review with a hidden unresolved requirement is findings, not clean", () => {
    const s = reviewPresentationState({ outcome: complete({ unresolvedQualifications: [{ requirementId: "q1", text: "Kubernetes" }] }) });
    expect(s.state).not.toBe(REVIEW_STATE.CLEAN);
  });

  it("a complete review with inputs missing the `inputs` field entirely is not clean (fail closed)", () => {
    const s = reviewPresentationState({ outcome: complete({ inputs: undefined }) });
    expect(s.state).not.toBe(REVIEW_STATE.CLEAN);
  });
});

describe("stale: the text moved on since the review ran", () => {
  it("is never clean, even when the underlying review would be", () => {
    const s = reviewPresentationState({ outcome: complete(), freshness: "stale" });
    expect(s.state).toBe(REVIEW_STATE.STALE);
    expect(s.headline).toMatch(/ran on an earlier version of the text/i);
    expect(chrome(s)).not.toMatch(REASSURING);
  });

  it("keeps the earlier findings as a to-do list under the stale note, and is not announced", () => {
    const s = reviewPresentationState({ outcome: reviewed({ flags: [FLAG] }), freshness: "stale" });
    expect(s.state).toBe(REVIEW_STATE.STALE);
    expect(s.notice.sentences[0]).toMatch(/edited this document since this review ran/i);
    expect(s.headline).toMatch(/partial review/i);
    expect(s.announce).toBe("");
  });
});

describe("a hypothetical has its own input rules", () => {
  it("never asks for real material: no 'uploaded resume' sentence, and unresolved requirements are not hidden", () => {
    const outcome = reviewed({ draftKind: "hypothetical", inputs: { posting: true, realMaterial: false } });
    const s = reviewPresentationState({ outcome });
    expect(s.notice.sentences.join(" ")).not.toMatch(/uploaded resume/i);
    expect(s.hideUnresolved).toBe(false);
  });

  it("carries no 'read the whole document before you send' closing (nothing is sent from it)", () => {
    const hypo = reviewPresentationState({ outcome: reviewed({ draftKind: "hypothetical" }) });
    const real = reviewPresentationState({ outcome: reviewed() });
    const closing = /read the whole document once before you send/i;
    expect(hypo.notice.sentences.join(" ")).not.toMatch(closing);
    expect(real.notice.sentences.join(" ")).toMatch(closing);
  });
});

describe("withheld real material on a real document", () => {
  it("hides the requirements-cannot-be-met group, whose title asserts a comparison nobody made", () => {
    const s = reviewPresentationState({ outcome: reviewed({ inputs: { posting: true, realMaterial: false } }) });
    expect(s.hideUnresolved).toBe(true);
  });

  it("does not count a hidden requirement as something to check", () => {
    const outcome = reviewed({ inputs: { posting: true, realMaterial: false }, unresolvedQualifications: [{ requirementId: "q1", text: "Kubernetes" }] });
    expect(reviewPresentationState({ outcome }).announce).toBe("Review finished. Partial review: some checks did not run.");
  });
});

describe("what ran is read from the shared registry", () => {
  it("lists Not-fully-checked in the enum's own order, with a withheld posting folded in", () => {
    const s = reviewPresentationState({ outcome: reviewed({ inputs: { posting: false, realMaterial: true } }) });
    // The enum's own order (contract.js CATEGORY), not the order they were added in.
    expect(s.notice.notChecked).toEqual(
      [CATEGORY.MISSING_KEYWORD, CATEGORY.EMPLOYER_PLAUSIBILITY, CATEGORY.CONSISTENCY, CATEGORY.UNSUPPORTED_AUTHORITY].map((c) => CHECK_LABELS[c]),
    );
  });

  it("says which checks ran is UNKNOWN when the outcome lists neither side", () => {
    const s = reviewPresentationState({ outcome: reviewed({ checkedChecks: [], missingChecks: [] }) });
    expect(s.notice.sentences.join(" ")).toMatch(/which checks ran is unknown/i);
    expect(s.notice.checked).toEqual([]);
  });

  it("a verdict of 'none' is treated as partial, not clean", () => {
    const s = reviewPresentationState({ outcome: reviewed({ verdictKind: REVIEW_KIND.NONE }) });
    expect(s.state).toBe(REVIEW_STATE.PARTIAL);
  });
});
