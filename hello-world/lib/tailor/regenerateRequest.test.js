// N104 - the regenerate's two request fields, read from untrusted form data.
// The contract that matters: a field that is ABSENT is not a regenerate, a field
// that is PRESENT but unusable comes back as null (so the branch refuses it rather
// than running a first-time generation), and what is usable is rebuilt field by
// field, never passed through.

import { describe, it, expect } from "vitest";
import { readRegenerateFields } from "./regenerateRequest.js";
import { isValidPinnedAnalysis } from "@/lib/llm/ideal/pinnedAnalysis";

const form = (fields) => ({ get: (name) => (Object.prototype.hasOwnProperty.call(fields, name) ? fields[name] : null) });

const PIN = {
  postingAnalysis: { requirements: [{ id: "q1", text: "Kubernetes experience", kind: "requirement" }] },
  keywordMap: { entries: [{ keyword: "Kubernetes", section: "competencies", priority: 1, requirementIndex: 0 }] },
};
const REVIEW = {
  status: "reviewed",
  flags: [
    {
      draftKind: "applicationReady",
      spanId: "s1",
      category: "missing-keyword",
      message: 'The posting asks for "Kubernetes" ("Kubernetes experience") but this draft never mentions it.',
      evidenceRef: { origin: "posting", spanId: "q1" },
      excerpt: "a line of the resume that must not be sent back",
    },
  ],
  unresolvedQualifications: [{ requirementId: "q2", text: "Active clearance." }],
  lineCount: 12,
  inputs: { posting: true, realMaterial: true },
};

describe("readRegenerateFields - absent is not a regenerate", () => {
  it("returns no keys when neither field is on the request", () => {
    expect(readRegenerateFields(form({}))).toEqual({});
  });
});

describe("readRegenerateFields - a usable request round-trips", () => {
  const out = readRegenerateFields(form({ pinnedAnalysis: JSON.stringify(PIN), beforeReview: JSON.stringify(REVIEW) }));

  it("keeps the pin whole and valid", () => {
    expect(out.pinnedAnalysis).toEqual(PIN);
    expect(isValidPinnedAnalysis(out.pinnedAnalysis)).toBe(true);
  });

  it("rebuilds the review from the fields the comparison reads, dropping the rest", () => {
    expect(out.beforeReview.status).toBe("reviewed");
    expect(out.beforeReview.lineCount).toBe(12);
    expect(out.beforeReview.unresolvedQualifications).toEqual([{ requirementId: "q2", text: "Active clearance." }]);
    expect(out.beforeReview.flags).toHaveLength(1);
    expect(out.beforeReview.flags[0]).not.toHaveProperty("excerpt");
    expect(out.beforeReview.flags[0].evidenceRef).toEqual({ origin: "posting", spanId: "q1" });
    expect(out.beforeReview).not.toHaveProperty("inputs");
  });
});

describe("readRegenerateFields - present but unusable is null, never absent", () => {
  it("not JSON, not an object, or over the size cap", () => {
    for (const bad of ["not json", "[1,2]", "42", "null", JSON.stringify({ x: "y".repeat(160000) })]) {
      const out = readRegenerateFields(form({ pinnedAnalysis: bad, beforeReview: bad }));
      expect(out.pinnedAnalysis).toBeNull();
      expect(out.beforeReview).toBeNull();
    }
  });

  it("a field that arrives as a file is not parsed as JSON", () => {
    const file = { toString: () => "[object File]" };
    const out = readRegenerateFields(form({ pinnedAnalysis: file, beforeReview: file }));
    expect(out.pinnedAnalysis).toBeNull();
    expect(out.beforeReview).toBeNull();
  });

  it("a pin with no requirements, a malformed requirement, or too many is null (all-or-nothing)", () => {
    const pin = (requirements) => JSON.stringify({ postingAnalysis: { requirements }, keywordMap: { entries: [] } });
    expect(readRegenerateFields(form({ pinnedAnalysis: pin(undefined) })).pinnedAnalysis).toBeNull();
    expect(readRegenerateFields(form({ pinnedAnalysis: pin([{ id: "q1" }]) })).pinnedAnalysis).toBeNull();
    expect(readRegenerateFields(form({ pinnedAnalysis: pin([{ id: "q1", text: "x".repeat(2001) }]) })).pinnedAnalysis).toBeNull();
    const many = Array.from({ length: 201 }, (_, i) => ({ id: `q${i}`, text: "t" }));
    expect(readRegenerateFields(form({ pinnedAnalysis: pin(many) })).pinnedAnalysis).toBeNull();
  });

  it("an empty requirement list parses to a pin the pipeline's guard then rejects", () => {
    const out = readRegenerateFields(form({ pinnedAnalysis: JSON.stringify({ postingAnalysis: { requirements: [] } }) }));
    expect(isValidPinnedAnalysis(out.pinnedAnalysis)).toBe(false);
  });
});

describe("readRegenerateFields - lists are bounded and rebuilt", () => {
  it("cuts an over-long flag list and drops malformed flags and entries", () => {
    const flags = Array.from({ length: 400 }, (_, i) => ({ category: "repetition", spanId: `s${i}`, message: "m" }));
    const review = {
      flags: [...flags, { category: 7, message: "bad" }, "text", { category: "x", message: "y".repeat(601) }],
      unresolvedQualifications: [{ requirementId: "q1", text: "ok" }, { text: "no id" }, { requirementId: "q2" }],
    };
    const out = readRegenerateFields(form({ beforeReview: JSON.stringify(review) }));
    expect(out.beforeReview.flags).toHaveLength(300);
    expect(out.beforeReview.unresolvedQualifications).toEqual([{ requirementId: "q1", text: "ok" }]);
    expect(out.beforeReview).not.toHaveProperty("lineCount");
  });

  it("never lets a prototype key or an unknown field through", () => {
    const hostile = {
      flags: [{ category: "repetition", message: "m", __proto__: { polluted: true }, extra: "x" }],
      unresolvedQualifications: [],
      extra: { a: 1 },
    };
    const out = readRegenerateFields(form({ beforeReview: JSON.stringify(hostile) }));
    expect(out.beforeReview).not.toHaveProperty("extra");
    expect(out.beforeReview.flags[0]).not.toHaveProperty("extra");
    expect({}.polluted).toBeUndefined();
  });
});
