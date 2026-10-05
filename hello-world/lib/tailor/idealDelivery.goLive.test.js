// N107 go-live -- the edges of the pure pieces the go-live added to
// lib/tailor/idealDelivery.js. The truth table itself is pinned by
// idealChipDelivery.test.js; this file covers what that one leaves open: what
// counts as an Ideal payload, the preview context the chip handler passes, and
// the server's gate-off refusal.

import { describe, it, expect } from "vitest";
import {
  resolveIdealChipDelivery,
  idealChipPreviewContext,
  idealUnavailableRefusal,
} from "./idealDelivery.js";

const STANDARD = { openPreview: false, autoDownload: true };

describe("resolveIdealChipDelivery -- only an object `ideal` block makes a run Ideal", () => {
  it.each([
    ["no payload at all", undefined],
    ["a null payload", null],
    ["a payload with no ideal key", { result: "r" }],
    ["a null ideal", { result: "r", ideal: null }],
    ["a string ideal", { result: "r", ideal: "yes" }],
    ["an array ideal", { result: "r", ideal: [] }],
  ])("%s is delivered as a standard run (auto-download, no preview)", (_label, payload) => {
    expect(resolveIdealChipDelivery({ payload, previewOpen: false, opts: {} })).toEqual(STANDARD);
  });

  it("an Ideal block with every field empty still never downloads", () => {
    expect(resolveIdealChipDelivery({ payload: { ideal: {} }, previewOpen: false, opts: {} })).toEqual({
      openPreview: true,
      autoDownload: false,
    });
  });

  it("is safe to call with no argument (a standard run that downloads)", () => {
    expect(resolveIdealChipDelivery()).toEqual(STANDARD);
  });
});

describe("idealChipPreviewContext -- the call finishByOpeningPreview receives", () => {
  const job = { id: "job-1", title: "Searched title", company: "Acme", description: "The posting", url: "https://x.test/1" };

  it("describes the resume only: applyCover false and no cover lines", () => {
    expect(idealChipPreviewContext(job, "Generated title")).toEqual({
      jobId: "job-1",
      jobTitle: "Generated title",
      company: "Acme",
      posting: "The posting",
      url: "https://x.test/1",
      applyResume: true,
      applyCover: false,
      coverLetterResultLines: [],
    });
  });

  it("falls back to the job's own title when the run produced none", () => {
    expect(idealChipPreviewContext(job, "").jobTitle).toBe("Searched title");
  });

  it("returns a fresh cover-lines array each call (no shared mutable state)", () => {
    expect(idealChipPreviewContext(job, "").coverLetterResultLines).not.toBe(
      idealChipPreviewContext(job, "").coverLetterResultLines,
    );
  });
});

describe("idealUnavailableRefusal -- the server's gate-off answer", () => {
  it("is a 422 with a refusal body and none of the Ideal output keys", () => {
    const { status, body } = idealUnavailableRefusal();
    expect(status).toBe(422);
    expect(body.refusal).toEqual({ level: "ideal", code: "level-unavailable" });
    for (const key of ["ideal", "result", "resultLines", "docxB64"]) expect(body).not.toHaveProperty(key);
  });

  it("states the state and a remedy, and does not lead with Error / Failed / Sorry / Unable", () => {
    const { error } = idealUnavailableRefusal().body;
    expect(error).toMatch(/not available/i);
    expect(error).toMatch(/pick another/i);
    expect(error).not.toMatch(/^\s*(error|failed|sorry|unable)\b/i);
  });

  it("is a different refusal from the route's engine and empty-resume codes", () => {
    expect(idealUnavailableRefusal().body.refusal.code).not.toMatch(/^(engine-unsupported|empty-resume)$/);
  });
});
