// N157 SC-C: the wire test for requestStudyPlanBuild, the only new network call
// surface of the study-plan shell. globalThis.fetch is stubbed, so this decides
// what the browser actually sends and how each answer is mapped; it does not (and
// cannot) decide what the route does with it.
//
// Positive controls are explicit: the happy-path test proves the stub records a
// real request, so "no request was made" in the refusal test is not vacuous.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { STUDY_COPY } from "@/lib/studyPlan/studyPlanCopy.js";
import { requestStudyPlanBuild } from "@/lib/studyPlan/studyPlanBuildClient.js";

const APP_ID = "11111111-1111-1111-1111-111111111111";
const KNOBS = { newReviewRatio: 0.25, weakTopicIds: ["t1"], pace: { daysUntil: 3 }, topicScope: { excludedAreas: ["sql"] } };

let originalFetch;
let fetchMock;

function reply(json, { ok = true, status = 200 } = {}) {
  return { ok, status, json: async () => json };
}

beforeEach(() => {
  originalFetch = globalThis.fetch;
  fetchMock = vi.fn(async () => reply({ status: "ready", partial: false, reason: null }));
  globalThis.fetch = fetchMock;
});

afterEach(() => {
  globalThis.fetch = originalFetch;
});

describe("the request", () => {
  it("POSTs { applicationId, engine, knobs } as JSON to /api/study-plan and returns the 2xx body", async () => {
    const out = await requestStudyPlanBuild({ applicationId: APP_ID, engine: "gemini", knobs: KNOBS });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/study-plan");
    expect(init.method).toBe("POST");
    expect(init.headers["Content-Type"]).toBe("application/json");
    // The stored knobs travel with every build: an omitted knobs is normalized to
    // the defaults by the route and written over the learner's customization.
    expect(JSON.parse(init.body)).toEqual({ applicationId: APP_ID, engine: "gemini", knobs: KNOBS });
    expect(out).toEqual({ status: "ready", partial: false, reason: null });
  });

  it("returns a preserved unavailable body untouched (the caller reads `preserved`)", async () => {
    const body = { status: "unavailable", partial: false, preserved: true, preservedReason: "good-plan", error: "The study plan could not be built." };
    fetchMock.mockResolvedValueOnce(reply(body));
    expect(await requestStudyPlanBuild({ applicationId: APP_ID, engine: "gemini", knobs: KNOBS })).toEqual(body);
  });

  it("omits knobs from the body when the caller has none (a first create), rather than sending null", async () => {
    await requestStudyPlanBuild({ applicationId: APP_ID, engine: "embedded", knobs: null });
    const body = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(body).toEqual({ applicationId: APP_ID, engine: "embedded" });
    expect("knobs" in body).toBe(false);
  });

  it("refuses a blank application id before any request is made (no rate-limit token is spent)", async () => {
    for (const bad of ["", "   ", undefined, null]) {
      await expect(requestStudyPlanBuild({ applicationId: bad, engine: "gemini", knobs: KNOBS })).rejects.toThrow(
        STUDY_COPY.picker.disabledCreateReason,
      );
    }
    await expect(requestStudyPlanBuild()).rejects.toThrow();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("non-ok answers are mapped to the user-facing message", () => {
  it('503 { status: "disabled" } (the kill switch, no `error` key) -> the switched-off copy', async () => {
    fetchMock.mockResolvedValueOnce(reply({ status: "disabled" }, { ok: false, status: 503 }));
    await expect(requestStudyPlanBuild({ applicationId: APP_ID, engine: "gemini" })).rejects.toThrow(STUDY_COPY.failure.switchedOff);
  });

  it("503 with an `error` (not configured) -> the server's text, NOT the switched-off copy", async () => {
    fetchMock.mockResolvedValueOnce(reply({ error: "Study plans need the Gemini API key to be configured." }, { ok: false, status: 503 }));
    const err = await requestStudyPlanBuild({ applicationId: APP_ID, engine: "gemini" }).catch((e) => e);
    expect(err.message).toBe("Study plans need the Gemini API key to be configured.");
    expect(err.message).not.toBe(STUDY_COPY.failure.switchedOff);
  });

  it("429 -> the server's text (it already says to wait)", async () => {
    fetchMock.mockResolvedValueOnce(reply({ error: "Too many study plan requests in a short window. Wait a moment and try again." }, { ok: false, status: 429 }));
    await expect(requestStudyPlanBuild({ applicationId: APP_ID, engine: "gemini" })).rejects.toThrow("Wait a moment");
  });

  it("a non-ok answer with no usable JSON -> a status-bearing fallback", async () => {
    fetchMock.mockResolvedValueOnce({ ok: false, status: 500, json: async () => { throw new Error("not json"); } });
    await expect(requestStudyPlanBuild({ applicationId: APP_ID, engine: "gemini" })).rejects.toThrow("Request failed (500)");
  });
});
