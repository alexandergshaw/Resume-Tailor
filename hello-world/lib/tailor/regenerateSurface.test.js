// N104 Waves D/E - which review describes the text on screen, and the one
// availability state the Regenerate row draws from it. Driven through the REAL
// idealSurfaceFor and regenerateAvailability: this module only gathers their inputs.

import { describe, it, expect } from "vitest";
import { idealSurfaceFor } from "./idealSurface.js";
import { REGENERATE_STATE } from "../review/regenerateAvailability.js";
import { regenerateInputsFor, regenerateSurfaceFor } from "./regenerateSurface.js";

const TEXT = "Line one\nLine two";

const keywordFlag = (reqId, term = "GraphQL") => ({
  category: "missing-keyword",
  spanId: "s1",
  message: `The posting asks for "${term}" ("${term} APIs") but this draft never mentions it.`,
  evidenceRef: { origin: "posting", spanId: reqId },
});

function entry({ flags = [keywordFlag("q1")], unresolved = [], edited = false, result = TEXT } = {}) {
  return {
    result,
    edited: edited ? { resume: true, cover: false } : undefined,
    ideal: {
      applicationReady: { result: TEXT },
      postingAnalysis: { requirements: [{ id: "q1", text: "GraphQL APIs" }] },
      keywordMap: { entries: [{ keyword: "GraphQL" }] },
      review: { status: "reviewed", flags, unresolvedQualifications: unresolved, coverage: { complete: false } },
      counts: { kept: 2, keptAccomplishments: 1, removed: 0, leftOut: 0 },
    },
  };
}

const request = (text = TEXT) => ({ kind: "applicationReady", title: "t", text });
const READY_ARGS = { scope: "resume", engine: "gemini", idealEnabled: true, inFlight: false };
const surfaceOf = (e, extra = {}) =>
  regenerateSurfaceFor({ ...READY_ARGS, idealSurface: idealSurfaceFor(e), request: request(e.result), ...extra });

const outcome = (over = {}) => ({
  status: "reviewed",
  flags: [keywordFlag("q1")],
  unresolvedQualifications: [],
  lineCount: 2,
  inputs: { posting: true, realMaterial: true },
  ...over,
});

describe("regenerateSurfaceFor - an unedited Ideal result is described by the review that shipped with it", () => {
  it("is ready, with the resolvable gap counted and the band as the source", () => {
    const surface = surfaceOf(entry());
    expect(surface.state).toBe(REGENERATE_STATE.READY);
    expect(surface.counts).toEqual({ resolvable: 1, confirm: 0, unqualified: 0 });
    expect(surface.live.source).toBe("ideal-band");
    expect(surface.live.review.lineCount).toBe(2);
    expect(surface.inputs).toEqual({ posting: true, realMaterial: true });
  });

  it("counts a keyword on a requirement the resume cannot meet as unqualified, never resolvable (AC-2)", () => {
    const surface = surfaceOf(entry({ unresolved: [{ requirementId: "q1", text: "GraphQL APIs" }] }));
    expect(surface.counts).toEqual({ resolvable: 0, confirm: 0, unqualified: 1 });
    expect(surface.state).toBe(REGENERATE_STATE.NOTHING_TO_ADDRESS);
  });

  it("no flags at all is nothing-to-address, never ready", () => {
    expect(surfaceOf(entry({ flags: [] })).state).toBe(REGENERATE_STATE.NOTHING_TO_ADDRESS);
  });

  it("a posting with no requirements is needs-material, whatever the flags say", () => {
    const e = entry();
    e.ideal.postingAnalysis = { requirements: [] };
    expect(surfaceOf(e).state).toBe(REGENERATE_STATE.NEEDS_MATERIAL);
  });
});

describe("regenerateSurfaceFor - an edited text is stale until the user reviews it again", () => {
  const edited = () => entry({ edited: true, result: "Edited line one\nLine two" });

  it("is stale with no review of the edited text", () => {
    expect(surfaceOf(edited()).state).toBe(REGENERATE_STATE.STALE);
  });

  it("is ready from the strip's own review once that review ran on exactly the text on screen", () => {
    const e = edited();
    const surface = surfaceOf(e, { strip: { text: e.result, outcome: outcome() } });
    expect(surface.state).toBe(REGENERATE_STATE.READY);
    expect(surface.live.source).toBe("strip");
  });

  it("stays stale when the strip's review was of different text", () => {
    const e = edited();
    expect(surfaceOf(e, { strip: { text: "something older", outcome: outcome() } }).state).toBe(REGENERATE_STATE.STALE);
  });

  it("ignores a strip result that did not review (empty / failed)", () => {
    const e = edited();
    expect(surfaceOf(e, { strip: { text: e.result, outcome: { status: "failed" } } }).state).toBe(REGENERATE_STATE.STALE);
  });

  it("is needs-material when the strip's review had no real resume to compare against", () => {
    const e = edited();
    const surface = surfaceOf(e, { strip: { text: e.result, outcome: outcome({ inputs: { posting: true, realMaterial: false } }) } });
    expect(surface.state).toBe(REGENERATE_STATE.NEEDS_MATERIAL);
  });
});

describe("regenerateSurfaceFor - scope, job kind and engine", () => {
  it("a level 1-5 resume with a review result is unsupported-job; without one it is hidden", () => {
    const args = { ...READY_ARGS, idealSurface: null, request: request() };
    expect(regenerateSurfaceFor({ ...args, strip: { text: TEXT, outcome: outcome() } }).state).toBe(REGENERATE_STATE.UNSUPPORTED_JOB);
    expect(regenerateSurfaceFor({ ...args }).state).toBe(REGENERATE_STATE.HIDDEN);
  });

  it("the cover tab is unsupported-scope once reviewed, and the band is never its source", () => {
    const e = entry();
    const surface = regenerateSurfaceFor({
      ...READY_ARGS,
      scope: "cover",
      idealSurface: idealSurfaceFor(e),
      request: request(),
      strip: { text: TEXT, outcome: outcome() },
    });
    expect(surface.state).toBe(REGENERATE_STATE.UNSUPPORTED_SCOPE);
    expect(surface.live.source).toBe("strip");
  });

  it("the hypothetical tab is hidden", () => {
    expect(surfaceOf(entry(), { scope: "hypothetical" }).state).toBe(REGENERATE_STATE.HIDDEN);
  });

  it("an engine that cannot regenerate is engine-cannot, and a run in flight is running", () => {
    expect(surfaceOf(entry(), { engine: "embedded" }).state).toBe(REGENERATE_STATE.ENGINE_CANNOT);
    expect(surfaceOf(entry(), { inFlight: true }).state).toBe(REGENERATE_STATE.RUNNING);
  });

  it("the switched-off Ideal level hides the row", () => {
    expect(surfaceOf(entry(), { idealEnabled: false }).state).toBe(REGENERATE_STATE.HIDDEN);
  });

  it("carries the report of an earlier run and whether the text was hand-edited", () => {
    const e = entry();
    e.ideal.regenerateReport = { headline: "Regenerated." };
    expect(surfaceOf(e).report).toEqual({ headline: "Regenerated." });
    expect(surfaceOf(e).handEdited).toBe(false);
    expect(surfaceOf(entry({ edited: true })).handEdited).toBe(true);
  });
});

describe("regenerateInputsFor - what the request carries", () => {
  it("is the on-screen run's posting analysis and the review the surface was built from", () => {
    const e = entry();
    const surface = surfaceOf(e);
    const inputs = regenerateInputsFor({ idealSurface: idealSurfaceFor(e), live: surface.live });
    expect(inputs.pinnedAnalysis.postingAnalysis.requirements).toEqual([{ id: "q1", text: "GraphQL APIs" }]);
    expect(inputs.pinnedAnalysis.keywordMap).toEqual({ entries: [{ keyword: "GraphQL" }] });
    expect(inputs.beforeReview).toBe(surface.live.review);
  });
});
