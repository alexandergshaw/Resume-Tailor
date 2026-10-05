// N104 Waves D/E (4b) - the CLIENT submit for a regenerate (plan step 10 /
// design 10). The modal is the first caller: it POSTs an Ideal tailor request that
// also carries the before-run's pinned analysis and review, so the server can score
// the re-review against the same requirement ids. RED on HEAD: lib/tailor/
// regenerateSubmit.js does not exist. OFFLINE: fetch is injected/stubbed; the real
// network is never touched.
//
// The load-bearing test is the JOIN: what this client appends must be exactly what
// the server's readRegenerateFields reads back - a producer/consumer pair tested
// against each other, not against two hand-built fixtures that happen to agree.

import { describe, it, expect, vi } from "vitest";
import { appendRegenerateFields, submitRegenerate } from "./regenerateSubmit.js";
import { readRegenerateFields } from "./regenerateRequest.js";
import { isValidPinnedAnalysis } from "@/lib/llm/ideal/pinnedAnalysis";

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
    },
  ],
  unresolvedQualifications: [{ requirementId: "q2", text: "Active clearance." }],
  lineCount: 12,
};

const okFetch = (body = { ideal: {}, regenerated: true }) =>
  vi.fn(async () => ({ ok: true, status: 200, json: async () => body }));

describe("appendRegenerateFields - the two fields land as JSON the server can read (the JOIN)", () => {
  it("round-trips through readRegenerateFields with the pin whole and the review rebuilt", () => {
    const fd = new FormData();
    appendRegenerateFields(fd, { pinnedAnalysis: PIN, beforeReview: REVIEW });
    const back = readRegenerateFields(fd);
    expect(isValidPinnedAnalysis(back.pinnedAnalysis)).toBe(true);
    expect(back.pinnedAnalysis).toEqual(PIN);
    expect(back.beforeReview.lineCount).toBe(12);
    expect(back.beforeReview.unresolvedQualifications).toEqual([{ requirementId: "q2", text: "Active clearance." }]);
    expect(back.beforeReview.flags).toHaveLength(1);
  });

  it("refuses to attach an invalid pin (cutting a requirement would change the review)", () => {
    const fd = new FormData();
    expect(() => appendRegenerateFields(fd, { pinnedAnalysis: { postingAnalysis: { requirements: [] } }, beforeReview: REVIEW })).toThrow();
    expect(fd.get("pinnedAnalysis")).toBeNull();
    expect(() => appendRegenerateFields(fd, { pinnedAnalysis: null, beforeReview: REVIEW })).toThrow();
  });

  it("refuses an over-cap payload rather than posting it", () => {
    const huge = { ...PIN, postingAnalysis: { requirements: [{ id: "q1", text: "x".repeat(200000) }] } };
    const fd = new FormData();
    expect(() => appendRegenerateFields(fd, { pinnedAnalysis: huge, beforeReview: REVIEW })).toThrow();
    expect(fd.get("pinnedAnalysis")).toBeNull();
  });
});

describe("submitRegenerate - posts the Ideal request carrying the two fields, OFFLINE", () => {
  it("appends both fields onto the base FormData and POSTs /api/tailor via the injected fetch", async () => {
    const realFetch = vi.fn();
    const prior = globalThis.fetch;
    globalThis.fetch = realFetch; // prove the real transport is never touched
    try {
      const fd = new FormData();
      fd.append("tailorMode", "ideal"); // the base Ideal request the modal reuses
      const fetchImpl = okFetch();
      const out = await submitRegenerate({ formData: fd, pinnedAnalysis: PIN, beforeReview: REVIEW, fetchImpl });
      expect(realFetch).not.toHaveBeenCalled();
      expect(fetchImpl).toHaveBeenCalledTimes(1);
      const [url, init] = fetchImpl.mock.calls[0];
      expect(url).toBe("/api/tailor");
      expect(init.method).toBe("POST");
      expect(init.body.get("tailorMode")).toBe("ideal");
      expect(init.body.get("pinnedAnalysis")).toBe(JSON.stringify(PIN));
      expect(readRegenerateFields(init.body).beforeReview.lineCount).toBe(12);
      expect(out).toMatchObject({ regenerated: true });
    } finally {
      globalThis.fetch = prior;
    }
  });

  it("does NOT post when the pin is invalid (throws before any fetch)", async () => {
    const fetchImpl = okFetch();
    await expect(
      submitRegenerate({ formData: new FormData(), pinnedAnalysis: null, beforeReview: REVIEW, fetchImpl }),
    ).rejects.toBeTruthy();
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("surfaces a non-ok response as a rejection, not a silent success", async () => {
    const fetchImpl = vi.fn(async () => ({ ok: false, status: 422, json: async () => ({ error: "refused" }) }));
    const fd = new FormData();
    await expect(submitRegenerate({ formData: fd, pinnedAnalysis: PIN, beforeReview: REVIEW, fetchImpl })).rejects.toBeTruthy();
  });
});
