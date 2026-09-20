// @vitest-environment jsdom
//
// N29 -- the manual "prepare me for this interview" trigger. This hook does
// NOT exist yet (design-structure.r1.md §1.2/§3.1, plan.r1.md step 6): it
// posts to the SAME route/body shape `startInterviewPrepResearch` uses
// (POST /api/interview-prep, {applicationId, triggerClass}), but AWAITED
// and response-reading, because its caller (a candidate who just clicked a
// button) has nothing else to do but be told what happened -- the opposite
// contract from `startInterviewPrepResearch`, whose own header says it
// "RETURNS NOTHING" and "SWALLOWS EVERYTHING" by design.
//
// RED ON HEAD: `app/hooks/usePrepGeneration.js` does not exist -- every test
// below fails at import resolution (module not found), not because of a
// fixture defect.
//
// Idiom: a Probe component + createRoot/act, following
// app/hooks/useApplicationDigests.test.js:34-38,69-78 EXACTLY -- "there is
// no @testing-library in this repo", never `renderHook`. The double-fire
// case below is modelled directly on that file's own 1h F-7 case
// (":211-253"), including its delayed-promise "gate" shape, because
// design-structure.r1.md §3.1 explicitly copies that fix's two-primitive
// shape (a synchronous useRef gate, a useState Set only for the label) for
// this hook, and a synchronous, immediately-resolved mock CANNOT prove a
// ref-based guard from a state-based one -- React batches within one
// act(), so a `useState`-only guard can pass a naive "click twice quickly"
// test. Only a DELAYED promise, held open across both calls, exercises the
// race the guard exists to prevent.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createElement, act } from "react";
import { createRoot } from "react-dom/client";

import { usePrepGeneration } from "./usePrepGeneration.js";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let container;
let root;
let hookApi;

function Probe() {
  hookApi = usePrepGeneration();
  return null;
}

async function mount() {
  await act(async () => {
    root.render(createElement(Probe));
  });
}

beforeEach(() => {
  hookApi = undefined;
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

function jsonResponse(body, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

describe("usePrepGeneration.generateNow -- the request shape", () => {
  it("issues exactly one POST to /api/interview-prep with {applicationId, triggerClass: \"B2\"}", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ status: "ready" }));
    vi.stubGlobal("fetch", fetchMock);
    await mount();

    await act(async () => {
      await hookApi.generateNow("app-1");
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/interview-prep");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body)).toEqual({ applicationId: "app-1", triggerClass: "B2" });
  });

  it("resolves to the parsed response body on a normal terminal status", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({ status: "partial" })));
    await mount();
    const result = await act(async () => hookApi.generateNow("app-1"));
    expect(result).toEqual({ status: "partial" });
  });
});

describe("usePrepGeneration.generateNow -- every documented PrepGenerateResult shape round-trips", () => {
  it.each([
    [{ status: "ready" }],
    [{ status: "disabled" }],
    [{ status: "refused", reason: "in-flight" }],
    [{ status: "refused", reason: "error" }],
  ])("passes %o straight through from the mocked fetch response", async (body) => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse(body)));
    await mount();
    const result = await act(async () => hookApi.generateNow("app-1"));
    expect(result).toEqual(body);
  });

  it("[documentation case, not a defensive one] a reason value N41 makes unreachable server-side (\"attempts-spent\") is NOT special-cased -- it passes through unrecognized, exactly like any other reason string", async () => {
    // Step 2 of the plan removes this value from claimPrepPack's own output
    // entirely, so this hook never needs to render copy for it; this test
    // documents that the hook does not (and must not) hardcode a branch for
    // a value it should never see once the server-side fix lands.
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({ status: "refused", reason: "attempts-spent" })));
    await mount();
    const result = await act(async () => hookApi.generateNow("app-1"));
    expect(result).toEqual({ status: "refused", reason: "attempts-spent" });
  });

  it("a fetch rejection maps to {error, networkError: true}, never throws out of generateNow", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network down")));
    await mount();
    const result = await act(async () => hookApi.generateNow("app-1"));
    expect(result).toEqual(expect.objectContaining({ networkError: true }));
    expect(typeof result.error).toBe("string");
  });

  it("a missing applicationId resolves to an error result rather than firing a request", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await mount();
    const result = await act(async () => hookApi.generateNow(""));
    expect(fetchMock).not.toHaveBeenCalled();
    expect(typeof result.error).toBe("string");
  });
});

describe("usePrepGeneration -- the double-fire guard (design-structure.r1.md §3.1, modelled on useApplicationDigests.js's own 1h F-7 fix)", () => {
  it("a second generateNow(sameId) call issued before the first's fetch resolves is skipped, and exactly ONE real request is ever issued", async () => {
    await mount();

    let resolveFetch;
    const gate = new Promise((resolve) => {
      resolveFetch = resolve;
    });
    const fetchMock = vi.fn().mockImplementation(() => gate.then(() => jsonResponse({ status: "ready" })));
    vi.stubGlobal("fetch", fetchMock);

    let firstCall;
    let secondCall;
    await act(async () => {
      // Fired back to back, synchronously, with no await between them --
      // the shape a fast double-click or a programmatic double call
      // produces. Neither promise is awaited HERE: without the guard, the
      // second call is also a real in-flight request pending on the same
      // gate, and awaiting it before the gate opens would hang the test.
      firstCall = hookApi.generateNow("app-1");
      secondCall = hookApi.generateNow("app-1");
    });

    // The guard's whole job: at most one real request in flight for this id.
    expect(fetchMock).toHaveBeenCalledTimes(1);

    let firstResult;
    let secondResult;
    await act(async () => {
      resolveFetch();
      [firstResult, secondResult] = await Promise.all([firstCall, secondCall]);
    });

    expect(firstResult).toEqual({ status: "ready" });
    expect(secondResult).toEqual({ skipped: true });

    // The guard releases once the in-flight call settles -- a later call is
    // not permanently locked out.
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({ status: "ready" })));
    await act(async () => {
      await hookApi.generateNow("app-1");
    });
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it("guards per applicationId, not globally -- two different ids issue concurrently", async () => {
    await mount();
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ status: "ready" }));
    vi.stubGlobal("fetch", fetchMock);

    await act(async () => {
      await Promise.all([hookApi.generateNow("app-1"), hookApi.generateNow("app-2")]);
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("generatingIds reflects the SAME id as in-flight for the duration of the request, and is empty once it settles", async () => {
    await mount();
    let resolveFetch;
    const gate = new Promise((resolve) => {
      resolveFetch = resolve;
    });
    vi.stubGlobal("fetch", vi.fn().mockImplementation(() => gate.then(() => jsonResponse({ status: "ready" }))));

    let call;
    await act(async () => {
      call = hookApi.generateNow("app-1");
    });
    expect(hookApi.generatingIds.has("app-1")).toBe(true);

    await act(async () => {
      resolveFetch();
      await call;
    });
    expect(hookApi.generatingIds.has("app-1")).toBe(false);
  });
});
