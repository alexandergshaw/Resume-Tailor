// N113 part 3 - the review action's decision record, PURE.
//
// reviewDecisionFor({ surface, request, result }) maps what one activation of the
// review control ended in onto the activity log's closed decision vocabulary
// (DECISION_LEDGER "document-review"). The properties worth pinning:
//   * each way a review can end gets its own outcome and kind, so "nothing to
//     review", "already covered above" and "the review could not run" are never
//     the same record as a review that ran;
//   * the record carries counts and canned codes ONLY. This log is downloaded and
//     shared onward: a title, an excerpt or a line of the resume in it is a defect;
//   * every key it emits is one the ledger entry declares, because the recorder
//     drops anything else without a sound and a dropped field would make the
//     record look complete while saying less than the function meant.

import { describe, it, expect } from "vitest";
import { DECISION_LEDGER, DECISION_OUTCOMES } from "../activityLog/activityChannels.js";
import { REVIEW_DECISION_ID, reviewDecisionFor } from "./reviewDecision.js";

const SECRET_LINE = "Led the Zephyrdyne migration for Initech, saving $4.2M.";
const SECRET_TITLE = "Initech - Principal Zephyrdyne Engineer";

const request = { kind: "applicationReady", scope: "resume", title: SECRET_TITLE, resultLines: [SECRET_LINE] };
const reviewed = (over = {}) => ({
  outcome: {
    status: "reviewed",
    draftKind: "applicationReady",
    title: SECRET_TITLE,
    flags: [
      { category: "unverifiable-metric", spanId: "s1", draftKind: "applicationReady", message: "m", excerpt: SECRET_LINE },
      { category: "repetition", spanId: "s2", draftKind: "applicationReady", message: "m", excerpt: SECRET_LINE },
    ],
    unresolvedQualifications: ["Kubernetes"],
    verdictKind: "partial",
    missingChecks: ["consistency"],
    checkedChecks: ["repetition"],
    engineMode: "mechanical-only",
    lineCount: 14,
    inputs: { posting: true, realMaterial: false },
    ...over,
  },
  covered: false,
});

const entry = () => DECISION_LEDGER.find((e) => e && e.id === REVIEW_DECISION_ID);

describe("reviewDecisionFor - one record per way a review can end", () => {
  it("a review that ran is 'acted', carrying counts and the verdict's own kind", () => {
    const d = reviewDecisionFor({ surface: "modal", request, result: reviewed() });
    expect(d.outcome).toBe("acted");
    expect(d.fields).toEqual({
      surface: "modal",
      scope: "resume",
      kind: "partial",
      reason: "reviewed",
      flagCount: 2,
      lineCount: 14,
      engineMode: "mechanical-only",
      coverageComplete: false,
    });
  });

  it("a complete verdict is recorded as complete, with coverageComplete true", () => {
    const d = reviewDecisionFor({ surface: "chat", request, result: reviewed({ verdictKind: "complete", flags: [] }) });
    expect(d.fields.kind).toBe("complete");
    expect(d.fields.coverageComplete).toBe(true);
    expect(d.fields.flagCount).toBe(0);
    expect(d.fields.surface).toBe("chat");
  });

  it("an empty document is 'refused' (nothing was read), never a review that found nothing", () => {
    const d = reviewDecisionFor({ surface: "modal", request, result: { outcome: { status: "empty" }, covered: false } });
    expect(d.outcome).toBe("refused");
    expect(d.fields.kind).toBe("empty");
    expect(d.fields.reason).toBe("no-text");
    expect(d.fields).not.toHaveProperty("flagCount");
    expect(d.fields).not.toHaveProperty("coverageComplete");
  });

  it("a covered tab is 'skipped': the review above already speaks for this text", () => {
    const d = reviewDecisionFor({ surface: "modal", request, result: { outcome: null, covered: true } });
    expect(d.outcome).toBe("skipped");
    expect(d.fields.kind).toBe("covered");
    expect(d.fields.reason).toBe("already-covered");
  });

  it("a review that could not run is 'failed'", () => {
    const d = reviewDecisionFor({ surface: "chat", request, result: { outcome: { status: "failed" }, covered: false } });
    expect(d.outcome).toBe("failed");
    expect(d.fields.kind).toBe("failed");
    expect(d.fields.reason).toBe("review-error");
  });

  it("anything it does not recognise fails to 'failed', never to a ran-and-clean record", () => {
    for (const result of [undefined, null, {}, { outcome: null, covered: false }, { outcome: { status: "mystery" } }, { outcome: "reviewed" }]) {
      const d = reviewDecisionFor({ surface: "modal", request, result });
      expect(d.outcome, JSON.stringify(result)).toBe("failed");
      expect(d.fields.kind).toBe("failed");
    }
  });

  it("an unknown verdict kind is recorded as unknown, not as complete", () => {
    const d = reviewDecisionFor({ surface: "modal", request, result: reviewed({ verdictKind: "excellent" }) });
    expect(d.fields.kind).toBe("unknown");
    expect(d.fields.coverageComplete).toBe(false);
  });

  it("the three scopes are recorded by name; a scope it does not know is 'unknown'", () => {
    const scopeOf = (scope) => reviewDecisionFor({ surface: "modal", request: { ...request, scope }, result: reviewed() }).fields.scope;
    expect(scopeOf("resume")).toBe("resume");
    expect(scopeOf("cover")).toBe("cover");
    expect(scopeOf("hypothetical")).toBe("hypothetical");
    expect(scopeOf(undefined)).toBe("unknown");
    expect(scopeOf("resume; DROP TABLE")).toBe("unknown");
  });
});

describe("reviewDecisionFor - counts and codes only", () => {
  it("no title, excerpt or line of the document reaches the record, in any state", () => {
    const states = [
      reviewed(),
      { outcome: { status: "empty", title: SECRET_TITLE }, covered: false },
      { outcome: { status: "failed", title: SECRET_TITLE, message: SECRET_LINE }, covered: false },
      { outcome: null, covered: true },
    ];
    for (const result of states) {
      const json = JSON.stringify(reviewDecisionFor({ surface: "modal", request, result }));
      expect(json).not.toContain("Zephyrdyne");
      expect(json).not.toContain("Initech");
      expect(json).not.toContain("4.2M");
    }
  });

  it("a hostile surface, engine mode or count cannot smuggle text into the record", () => {
    const d = reviewDecisionFor({
      surface: `modal ${SECRET_LINE}`,
      request,
      result: reviewed({ engineMode: SECRET_LINE, lineCount: SECRET_LINE, flags: "not-an-array" }),
    });
    expect(d.fields.surface).toBe("unknown");
    expect(d.fields.engineMode).toBe("unknown");
    expect(d.fields.lineCount).toBe(0);
    expect(d.fields.flagCount).toBe(0);
    expect(JSON.stringify(d)).not.toContain("Zephyrdyne");
  });

  it("every field value is a string, a boolean or a non-negative whole number", () => {
    const d = reviewDecisionFor({ surface: "chat", request, result: reviewed() });
    for (const [key, value] of Object.entries(d.fields)) {
      const ok =
        typeof value === "boolean" || typeof value === "string" || (Number.isInteger(value) && value >= 0);
      expect(ok, key).toBe(true);
    }
  });
});

describe("reviewDecisionFor - agrees with the DECISION_LEDGER entry it reports under", () => {
  it("the ledger declares the entry, owned by the shared review section, able to report a refusal", () => {
    const e = entry();
    expect(e, "no document-review entry in DECISION_LEDGER").toBeTruthy();
    expect(e.module).toBe("app/components/preview/DocumentReviewSection.js");
    expect(e.outcomes.some((o) => o !== "acted")).toBe(true);
    for (const o of e.outcomes) expect(DECISION_OUTCOMES).toContain(o);
  });

  it("every key it can emit is a declared field, and every outcome it can return is a declared outcome", () => {
    const e = entry();
    expect(e).toBeTruthy();
    const results = [
      reviewed(),
      { outcome: { status: "empty" }, covered: false },
      { outcome: { status: "failed" }, covered: false },
      { outcome: null, covered: true },
    ];
    for (const result of results) {
      const d = reviewDecisionFor({ surface: "modal", request, result });
      for (const key of Object.keys(d.fields)) expect(e.fields, `undeclared field ${key}`).toContain(key);
      expect(e.outcomes).toContain(d.outcome);
    }
  });

  it("the declared fields carry none of the disclosure-bearing names", () => {
    const e = entry();
    expect(e).toBeTruthy();
    for (const forbidden of ["title", "label", "company", "excerpt", "text", "line", "lines", "flags", "message", "keyword", "url"]) {
      expect(e.fields).not.toContain(forbidden);
    }
  });
});
