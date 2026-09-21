// @vitest-environment jsdom
//
// ---------------------------------------------------------------------------
// AC-UX.7 -- usePrepGeneration must be able to ASK for one section, and its
// double-fire guard must be keyed per section rather than per application.
// Plan step S10.
// ---------------------------------------------------------------------------
//
// RED ON HEAD, verified by direct read: `app/hooks/usePrepGeneration.js`
// contains ZERO occurrences of `section` (the canary for that search is
// `body?.applicationId`, which occurs 4 times in route.js -- the same
// instrument over the same roots finds real things). `generateNow` takes one
// parameter (`:87`), `inFlightRef` is a bare `Set<applicationId>` (`:72`),
// and `requestPrepGeneration` hardcodes `{applicationId, triggerClass}`
// (`:43`). So there is no way for any caller -- including the one this round
// adds to the panel -- to request a single section.
//
// SEPARATE FILE: `usePrepGeneration.test.js` (N29) owns the whole-pack
// contract and is not edited by this round. Two of its assertions constrain
// what this round may build, and both are restated as controls below so the
// constraint is visible where the new code is written:
//   * `:83` pins the whole-pack POST body with `toEqual({applicationId,
//     triggerClass: "B2"})` -- so a whole-pack request must carry NO `section`
//     key at all, not even `section: null`.
//   * `:207`-ish pins `generatingIds.has("app-1")` for a whole-pack request --
//     so the whole-pack in-flight key stays the BARE applicationId. This is a
//     deliberate departure from plan §6.1's proposed
//     `applicationId + ":" + (section ?? "")`, which would key a whole-pack
//     request as `"app-1:"` and turn that landed assertion, and
//     `AppViewDialog.js:386`'s own `generatingIds.has(dApp?.id)`, red. The
//     bound key is: the bare id for a whole-pack request, `id + ":" + section`
//     for a section one. Recorded here and in this round's notes rather than
//     silently obeyed.
//
// EVERY CONCURRENCY CASE USES A DELAYED PROMISE. A synchronous, immediately
// resolved mock cannot tell a `useRef` guard from a `useState` one -- React
// batches within a single act() -- so a same-tick "call it twice" test passes
// for a build with no guard at all. The gate shape is copied from that same
// sibling file's own double-fire case, which copied it from
// useApplicationDigests.test.js's 1h F-7 fix.

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

function bodies(fetchMock) {
  return fetchMock.mock.calls.map(([, init]) => JSON.parse(init.body));
}

/** A fetch whose every response waits on one gate the test opens. */
function gatedFetch(body = { status: "ready" }) {
  let open;
  const gate = new Promise((resolve) => {
    open = resolve;
  });
  const fetchMock = vi.fn().mockImplementation(() => gate.then(() => jsonResponse(body)));
  vi.stubGlobal("fetch", fetchMock);
  return { fetchMock, open: () => open() };
}

// ---------------------------------------------------------------------------

describe("AC-UX.7 -- generateNow can name one section", () => {
  it("generateNow(id, {section}) POSTs {applicationId, triggerClass, section}", async () => {
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ status: "ready", section: "askThem" }));
    vi.stubGlobal("fetch", fetchMock);
    await mount();

    await act(async () => {
      await hookApi.generateNow("app-1", { section: "askThem" });
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe("/api/interview-prep");
    expect(init.method).toBe("POST");
    expect(JSON.parse(init.body)).toEqual({ applicationId: "app-1", triggerClass: "B2", section: "askThem" });
  });

  it("[regression control] generateNow(id) with no options still sends NO `section` key", async () => {
    // GREEN ON HEAD BY DESIGN -- it is a constraint on the new code, not
    // coverage of it. usePrepGeneration.test.js:83 asserts this body with
    // toEqual, so `section: null` or `section: undefined` serialised into the
    // body turns a landed test red.
    const fetchMock = vi.fn().mockResolvedValue(jsonResponse({ status: "ready" }));
    vi.stubGlobal("fetch", fetchMock);
    await mount();

    await act(async () => {
      await hookApi.generateNow("app-1");
    });

    const body = bodies(fetchMock)[0];
    expect(Object.prototype.hasOwnProperty.call(body, "section")).toBe(false);
    expect(body).toEqual({ applicationId: "app-1", triggerClass: "B2" });
  });

  it("the response is passed through unchanged, including the section fields the route adds", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({ status: "ready", section: "stages", sectionProduced: true })));
    await mount();
    const result = await act(async () => hookApi.generateNow("app-1", { section: "stages" }));
    expect(result).toEqual({ status: "ready", section: "stages", sectionProduced: true });
  });
});

describe("AC-UX.7 -- the double-fire guard is keyed per (application, section)", () => {
  it("two DIFFERENT sections of the same application both issue real requests -- neither is skipped", async () => {
    // The defect this catches is silent and total: with today's bare-id guard,
    // asking for a second section while the first is in flight returns
    // {skipped: true} and the candidate's click does nothing at all, with no
    // error and no request.
    const { fetchMock, open } = gatedFetch();
    await mount();

    let first;
    let second;
    await act(async () => {
      first = hookApi.generateNow("app-1", { section: "aboutYou" });
      second = hookApi.generateNow("app-1", { section: "askThem" });
    });

    expect(fetchMock, "the second section's request was swallowed by the in-flight guard").toHaveBeenCalledTimes(2);
    expect(bodies(fetchMock).map((b) => b.section)).toEqual(["aboutYou", "askThem"]);

    let results;
    await act(async () => {
      open();
      results = await Promise.all([first, second]);
    });
    expect(results.every((r) => r && !r.skipped)).toBe(true);
  });

  it("[no-op control] the SAME section twice, back to back, still issues exactly one request and skips the second", async () => {
    // Without this control, "keyed per section" is satisfied by a build with
    // no guard at all -- the over-firing failure, which is how a candidate
    // double-clicking spends two lease attempts and gets a 409.
    const { fetchMock, open } = gatedFetch();
    await mount();

    let first;
    let second;
    await act(async () => {
      first = hookApi.generateNow("app-1", { section: "aboutYou" });
      second = hookApi.generateNow("app-1", { section: "aboutYou" });
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);

    let firstResult;
    let secondResult;
    await act(async () => {
      open();
      [firstResult, secondResult] = await Promise.all([first, second]);
    });
    expect(firstResult).toEqual({ status: "ready" });
    expect(secondResult).toEqual({ skipped: true });
  });

  it("a whole-pack request and a section request are DIFFERENT keys -- neither skips the other", async () => {
    const { fetchMock, open } = gatedFetch();
    await mount();

    let whole;
    let section;
    await act(async () => {
      whole = hookApi.generateNow("app-1");
      section = hookApi.generateNow("app-1", { section: "stages" });
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const sent = bodies(fetchMock);
    expect(Object.prototype.hasOwnProperty.call(sent[0], "section")).toBe(false);
    expect(sent[1].section).toBe("stages");

    await act(async () => {
      open();
      await Promise.all([whole, section]);
    });
  });

  it("the guard RELEASES once a section's request settles -- a later request for the same section is not locked out", async () => {
    const { fetchMock, open } = gatedFetch();
    await mount();

    let call;
    await act(async () => {
      call = hookApi.generateNow("app-1", { section: "whyRole" });
    });
    await act(async () => {
      open();
      await call;
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({ status: "ready" })));
    await act(async () => {
      await hookApi.generateNow("app-1", { section: "whyRole" });
    });
    expect(fetch).toHaveBeenCalledTimes(1);
  });
});

describe("AC-UX.7 -- generatingIds carries the composite key, so one section's spinner is its own", () => {
  it("a section request marks `app-1:whyRole` in flight, and NOT the bare `app-1`", async () => {
    // The bare id is the whole-pack key (usePrepGeneration.test.js pins
    // `generatingIds.has("app-1")` for a whole-pack request, and
    // AppViewDialog.js:386 reads exactly that). Keying a SECTION request on
    // the bare id would light up every control at once, which is the same
    // "which one is actually running" confusion N44's headers exist to remove.
    const { open } = gatedFetch();
    await mount();

    let call;
    await act(async () => {
      call = hookApi.generateNow("app-1", { section: "whyRole" });
    });

    expect(hookApi.generatingIds.has("app-1:whyRole")).toBe(true);
    expect(hookApi.generatingIds.has("app-1")).toBe(false);
    expect(hookApi.generatingIds.has("app-1:askThem")).toBe(false);

    await act(async () => {
      open();
      await call;
    });
    expect(hookApi.generatingIds.has("app-1:whyRole")).toBe(false);
  });

  it("[regression control] a WHOLE-PACK request still marks the bare applicationId", async () => {
    // GREEN ON HEAD BY DESIGN. It is the assertion that stops a composite key
    // from being applied to the whole-pack path too, which would break a
    // landed hook test and the dialog's own in-flight wiring in one move.
    const { open } = gatedFetch();
    await mount();

    let call;
    await act(async () => {
      call = hookApi.generateNow("app-1");
    });
    expect(hookApi.generatingIds.has("app-1")).toBe(true);

    await act(async () => {
      open();
      await call;
    });
    expect(hookApi.generatingIds.has("app-1")).toBe(false);
  });
});
