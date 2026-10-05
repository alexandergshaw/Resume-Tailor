// N103 Step 3 (4b) -- the ONE shared review chokepoint (AC-11), the only place
// either surface reaches reviewDocuments / decomposeToSpans / reviewVerdict.
//
//   runDocumentReview(request) -> ReviewOutcome   (async)
//   request = { kind, title, resultLines?|text?, posting?, realMaterial? }
//   ReviewOutcome =
//     { status: "empty" }
//   | { status: "reviewed", draftKind, title, flags, unresolvedQualifications,
//       verdictKind, missingChecks, checkedChecks, engineMode, lineCount,
//       inputs: { posting, realMaterial } }
//
// This file drives the REAL chokepoint over REAL spans (no mocks of the reviewer),
// so the findings are a function of the actual text (AC-6), authorityReference is
// chosen by kind (AC-3), the path is offline/no-key (AC-9), empty fails closed
// (AC-10) and the A-1a `inputs` are computed from NON-EMPTY arrays, not key
// presence.
//
// RED on HEAD: `lib/review/runDocumentReview.js` does not exist. Each test asserts
// a real property that also bites a stub (a chokepoint that skips the empty gate,
// that always passes "user-material", that reads inputs off key-presence, or that
// passes a judge) -- proven against the scratchpad reference in the seat report.
//
// Node env: pure async, no React, no IO.

import { describe, it, expect, afterEach, vi } from "vitest";
import { runDocumentReview } from "./runDocumentReview.js";
import { REVIEW_KIND } from "./reviewVerdict.js";
import { CATEGORY } from "./contract.js";

const PLANTED = "Improved performance by 300% across the whole organization.";
const AUTHORITY_CLAIM = "Scaled a 300-person engineering organization as VP of Platform.";

let originalFetch;
afterEach(() => {
  if (originalFetch !== undefined) globalThis.fetch = originalFetch;
  originalFetch = undefined;
  vi.restoreAllMocks();
});

describe("runDocumentReview -- empty gate (AC-10)", () => {
  it("whitespace-only / empty document returns {status:'empty'} and never throws", async () => {
    await expect(runDocumentReview({ kind: "applicationReady", title: "R", text: "   \n\t  " })).resolves.toEqual({ status: "empty" });
    await expect(runDocumentReview({ kind: "applicationReady", title: "R", resultLines: ["", "   "] })).resolves.toEqual({ status: "empty" });
  });

  it("a non-empty document is reviewed, not empty", async () => {
    const out = await runDocumentReview({ kind: "applicationReady", title: "R", resultLines: [PLANTED] });
    expect(out.status).toBe("reviewed");
  });
});

describe("runDocumentReview -- real findings from real spans (AC-6)", () => {
  it("a planted unbaselined metric produces an unverifiable-metric flag whose resolved excerpt IS the planted line", async () => {
    const out = await runDocumentReview({ kind: "applicationReady", title: "R", resultLines: [PLANTED] });
    const metric = out.flags.find((f) => f.category === CATEGORY.UNVERIFIABLE_METRIC);
    expect(metric, "the planted 300% line must be flagged").toBeTruthy();
    expect(metric.excerpt).toBe(PLANTED);
  });

  it("DIFFERENTIAL: changing the planted line changes the quoted excerpt (findings are not canned)", async () => {
    const a = await runDocumentReview({ kind: "applicationReady", title: "R", resultLines: ["Boosted signups by 300%."] });
    const b = await runDocumentReview({ kind: "applicationReady", title: "R", resultLines: ["Boosted signups by 900%."] });
    const exA = a.flags.find((f) => f.category === CATEGORY.UNVERIFIABLE_METRIC)?.excerpt;
    const exB = b.flags.find((f) => f.category === CATEGORY.UNVERIFIABLE_METRIC)?.excerpt;
    expect(exA).toBe("Boosted signups by 300%.");
    expect(exB).toBe("Boosted signups by 900%.");
    expect(exA).not.toBe(exB);
  });

  it("every returned flag is filtered to the reviewed draft's kind (no cross-draft bleed)", async () => {
    const out = await runDocumentReview({ kind: "hypothetical", title: "H", resultLines: [PLANTED] });
    expect(out.flags.length).toBeGreaterThan(0);
    expect(out.flags.every((f) => f.draftKind === "hypothetical")).toBe(true);
  });
});

describe("runDocumentReview -- authorityReference by KIND (AC-3)", () => {
  it("a HYPOTHETICAL review's authority flags are INVARIANT to realMaterial (judged by internal consistency, never against real material)", async () => {
    const req = (realMaterial) => ({ kind: "hypothetical", title: "H", resultLines: [AUTHORITY_CLAIM], realMaterial });
    const withNone = await runDocumentReview(req(null));
    const withRich = await runDocumentReview(req({ spans: [{ id: "r1", text: "Junior Analyst, 2020-2021.", contextKey: "" }] }));
    const authOf = (o) => o.flags.filter((f) => f.category === CATEGORY.UNSUPPORTED_AUTHORITY);
    // The AC-3 mutant (chokepoint always passes "user-material") makes realMaterial
    // matter for the hypothetical, so these two would differ -> reds.
    expect(authOf(withNone)).toEqual(authOf(withRich));
  });

  it("POSITIVE CONTROL: the same claim as an application-ready doc with no real material FAILS CLOSED (an unsupported-authority flag), so the invariance above is not vacuous", async () => {
    const out = await runDocumentReview({ kind: "applicationReady", title: "R", resultLines: [AUTHORITY_CLAIM], realMaterial: null });
    expect(out.flags.some((f) => f.category === CATEGORY.UNSUPPORTED_AUTHORITY)).toBe(true);
  });
});

describe("runDocumentReview -- coverage honesty + A-1a inputs", () => {
  it("a mechanical-only run is always PARTIAL (AC-1 at the chokepoint)", async () => {
    const out = await runDocumentReview({ kind: "applicationReady", title: "R", resultLines: [PLANTED] });
    expect(out.engineMode).toBe("mechanical-only");
    expect(out.verdictKind).toBe(REVIEW_KIND.PARTIAL);
  });

  it("inputs.posting is derived from a NON-EMPTY requirements array, not from key presence (A-1a)", async () => {
    const absent = await runDocumentReview({ kind: "applicationReady", title: "R", resultLines: [PLANTED] });
    const empty = await runDocumentReview({ kind: "applicationReady", title: "R", resultLines: [PLANTED], posting: { requirements: [] } });
    const supplied = await runDocumentReview({ kind: "applicationReady", title: "R", resultLines: [PLANTED], posting: { requirements: [{ id: "q1", text: "Kubernetes" }] } });
    expect(absent.inputs.posting).toBe(false);
    expect(empty.inputs.posting).toBe(false);
    expect(supplied.inputs.posting).toBe(true);
  });

  it("inputs.realMaterial is derived from a NON-EMPTY spans array, not from key presence (A-1a)", async () => {
    const absent = await runDocumentReview({ kind: "applicationReady", title: "R", resultLines: [PLANTED] });
    const empty = await runDocumentReview({ kind: "applicationReady", title: "R", resultLines: [PLANTED], realMaterial: { spans: [] } });
    const supplied = await runDocumentReview({ kind: "applicationReady", title: "R", resultLines: [PLANTED], realMaterial: { spans: [{ id: "r1", text: "Senior Engineer, 2019-2023.", contextKey: "" }] } });
    expect(absent.inputs.realMaterial).toBe(false);
    expect(empty.inputs.realMaterial).toBe(false);
    expect(supplied.inputs.realMaterial).toBe(true);
  });

  it("reports lineCount = the number of content spans minted", async () => {
    const out = await runDocumentReview({ kind: "applicationReady", title: "R", resultLines: ["First concrete line about shipping.", "Second concrete line about scaling."] });
    expect(out.lineCount).toBe(2);
  });
});

describe("runDocumentReview -- offline, no key, deterministic (AC-9)", () => {
  it("touches no network: a default review makes ZERO fetch calls", async () => {
    originalFetch = globalThis.fetch;
    const fetchSpy = vi.fn(() => Promise.resolve({ ok: true, json: async () => ({}) }));
    globalThis.fetch = fetchSpy;
    await runDocumentReview({ kind: "applicationReady", title: "R", resultLines: [PLANTED], posting: { requirements: [{ id: "q1", text: "Kubernetes" }] }, realMaterial: { spans: [{ id: "r1", text: "Did some things.", contextKey: "" }] } });
    expect(fetchSpy).not.toHaveBeenCalled();
    // Positive control: the spy is installed and WOULD have recorded a call.
    fetchSpy("https://example.test");
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it("is deterministic: the same document reviewed twice yields identical flags", async () => {
    const req = { kind: "applicationReady", title: "R", resultLines: [PLANTED, "Responsible for various things."] };
    const a = await runDocumentReview(req);
    const b = await runDocumentReview(req);
    expect(a.flags).toEqual(b.flags);
  });
});
