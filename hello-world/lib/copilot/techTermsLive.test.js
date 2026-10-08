// N150 Wave A — the client live-wiring (lib/copilot/techTermsLive.js), mirroring
// projectExampleLive.js byte-for-byte in shape. RED on HEAD: the module does not
// exist. Pins the three body-shape mappings, the no-op gates (embedded / no
// application / non-function args — I-8/I-9), the never-an-unhandled-rejection
// guarantee, and the watchdog inequality against the GENERATION budget (a
// watchdog shorter than the server's deadline paints "failed" over a ready row).

import { describe, it, expect, vi, afterEach } from "vitest";
import {
  TECH_TERMS_PENDING_MAX_MS,
  normalizeTechTermsResult,
  startTechTerms,
} from "./techTermsLive.js";
import { TECH_TERMS_GEN_TIMEOUT_MS } from "./techTermsGen.js";

const FAILED = { status: "failed" };

afterEach(() => {
  vi.useRealTimers();
});

describe("normalizeTechTermsResult — the three body shapes (design §4.2)", () => {
  it("maps {techTerms:null} (the embedded engine) to undefined — render nothing", () => {
    expect(normalizeTechTermsResult({ techTerms: null })).toBeUndefined();
  });

  it("keeps a ready, non-empty result", () => {
    const out = normalizeTechTermsResult({ techTerms: { status: "ready", terms: ["idempotency keys", "SLA"] } });
    expect(out.status).toBe("ready");
    expect(out.terms).toEqual(["idempotency keys", "SLA"]);
  });

  it("fails a ready result with an empty / malformed terms list", () => {
    expect(normalizeTechTermsResult({ techTerms: { status: "ready", terms: [] } })).toEqual(FAILED);
    expect(normalizeTechTermsResult({ techTerms: { status: "ready", terms: ["", "  "] } })).toEqual(FAILED);
  });

  it("maps an explicit failure and any other shape to failed", () => {
    expect(normalizeTechTermsResult({ techTerms: { status: "failed" } })).toEqual(FAILED);
    expect(normalizeTechTermsResult({})).toEqual(FAILED);
    expect(normalizeTechTermsResult(undefined)).toEqual(FAILED);
    expect(normalizeTechTermsResult({ techTerms: "nope" })).toEqual(FAILED);
  });
});

describe("startTechTerms — the no-op gates (I-8)", () => {
  const ok = { applicationId: "a1", question: "q", engine: "gemini", fetchTerms: () => new Promise(() => {}), apply: () => {} };

  it("returns false and writes nothing when there is no application", () => {
    const applied = [];
    const started = startTechTerms({ ...ok, applicationId: "", apply: (v, s) => applied.push([v, s]) });
    expect(started).toBe(false);
    expect(applied).toEqual([]);
  });

  it("returns false for the embedded engine (no honest offline equivalent)", () => {
    const applied = [];
    const started = startTechTerms({ ...ok, engine: "embedded", apply: (v, s) => applied.push([v, s]) });
    expect(started).toBe(false);
    expect(applied).toEqual([]);
  });

  it("returns false when fetchTerms or apply is not a function", () => {
    expect(startTechTerms({ ...ok, fetchTerms: null })).toBe(false);
    expect(startTechTerms({ ...ok, apply: null })).toBe(false);
  });
});

describe("startTechTerms — pending then one settle (I-9)", () => {
  it("writes pending first, then the ready value exactly once", async () => {
    const applied = [];
    const started = startTechTerms({
      applicationId: "a1",
      question: "q",
      engine: "gemini",
      fetchTerms: async () => ({ techTerms: { status: "ready", terms: ["SLA"] } }),
      apply: (value, settled) => applied.push({ value, settled }),
    });
    expect(started).toBe(true);
    expect(applied[0]).toEqual({ value: { status: "pending" }, settled: false });
    await Promise.resolve();
    await Promise.resolve();
    expect(applied).toHaveLength(2);
    expect(applied[1].settled).toBe(true);
    expect(applied[1].value.status).toBe("ready");
  });

  it("a rejected fetch lands failed and never becomes an unhandled rejection", async () => {
    const applied = [];
    startTechTerms({
      applicationId: "a1",
      question: "q",
      engine: "gemini",
      fetchTerms: () => Promise.reject(new Error("network")),
      apply: (value, settled) => applied.push({ value, settled }),
    });
    await Promise.resolve();
    await Promise.resolve();
    expect(applied[applied.length - 1]).toEqual({ value: FAILED, settled: true });
  });

  it("an apply() that throws on the pending write does not reject into the draft path", () => {
    expect(() =>
      startTechTerms({
        applicationId: "a1",
        question: "q",
        engine: "gemini",
        fetchTerms: () => new Promise(() => {}),
        apply: () => {
          throw new Error("setState after unmount");
        },
      }),
    ).not.toThrow();
  });
});

describe("the watchdog outlasts the server's generation budget", () => {
  it("TECH_TERMS_PENDING_MAX_MS is strictly greater than TECH_TERMS_GEN_TIMEOUT_MS", () => {
    // Pinned against the SERVER constant, so retuning either side alone reds here
    // instead of silently reintroducing an abort of a request about to answer.
    expect(TECH_TERMS_PENDING_MAX_MS).toBeGreaterThan(TECH_TERMS_GEN_TIMEOUT_MS);
  });

  it("[control] a request that never answers still ends in failed at the watchdog", async () => {
    vi.useFakeTimers();
    const applied = [];
    startTechTerms({
      applicationId: "a1",
      question: "q",
      engine: "gemini",
      fetchTerms: () => new Promise(() => {}),
      apply: (value, settled) => applied.push({ value, settled }),
    });
    await vi.advanceTimersByTimeAsync(TECH_TERMS_PENDING_MAX_MS - 1);
    expect(applied).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(applied).toHaveLength(2);
    expect(applied[1]).toEqual({ value: FAILED, settled: true });
  });
});
