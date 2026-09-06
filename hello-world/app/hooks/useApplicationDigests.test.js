// @vitest-environment jsdom
//
// Wave W4c of the footnotes-migration plan (3-plan-footnotes.md §Wave 4).
// This hook's slice is small on purpose — two in-lane fixes, neither of
// which is a new pipeline stage:
//
//   1c C-6 / 1h R-2.2 (row "10 fails" / S-10): runOne's catch used to write
//   `markdown: "", sources: []` into LOCAL state on a network-level throw
//   (a fetch that never made it to the route at all — a route-recorded
//   failure already arrives as an ordinary 200 with status "failed" and
//   carries markdown/sources/citation_outcome forward; see route.js's own
//   catch). Blanking those fields removed the digest page from
//   AppViewDialog's `pages` gate mid-view and made the cell read "Not
//   researched yet" — byte-identical to never-researched, over research
//   that still exists in the database. The fix merges the failure fields
//   over whatever was already in digestsById for that id, rather than
//   replacing it.
//
//   1h F-7: `runOne` had no in-flight guard at all — the only thing
//   stopping a double-fire was the "Researching…" branch's no-op onClick
//   in TrackingTab, a UI-level guard that a programmatic double call (or a
//   fast double click before re-render) bypasses entirely. The fix is a
//   synchronous per-id guard, keyed by application id so two DIFFERENT
//   rows can still research concurrently — only a second call for the
//   SAME id while the first is unsettled is a no-op.
//
// Plus one guard (not a detector for either fix): citation_outcome and
// researched_at — the two fields the digest route started writing in
// 1db9a84 — must survive this hook untouched on their way to
// digestsById, which is what TrackingTab/AppViewDialog read. This hook
// spreads whole digest objects (never picks named fields), so this is a
// regression guard, not new behaviour.
//
// Pattern: app/hooks/useTechWatch.test.js is this repo's precedent for
// mounting a hook through a tiny Probe component under react-dom's
// createRoot + act, and reading its return value between actions — there
// is no @testing-library in this repo (confirmed: no such dependency in
// package.json, no such folder under node_modules).

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createElement, act } from "react";
import { createRoot } from "react-dom/client";

const h = vi.hoisted(() => ({ listDigestsImpl: vi.fn() }));

// Only the two Supabase-facing calls are mocked. `runWithConcurrency`,
// `selectAutoDigestTargets` and `readEngine` are real — they are pure and
// already unit-tested elsewhere, and using the real
// `selectAutoDigestTargets` is what lets these tests control auto-fan-out
// simply, by choosing `tracked_at` far outside AUTO_DIGEST_MAX_AGE_HOURS
// rather than needing a third mock.
vi.mock("../../lib/supabase/client", () => ({
  createClient: () => ({
    auth: { getUser: async () => ({ data: { user: { id: "user-1" } } }) },
  }),
}));
vi.mock("../../lib/supabase/applicationDigests", () => ({
  listDigests: (...args) => h.listDigestsImpl(...args),
}));

import { useApplicationDigests } from "./useApplicationDigests.js";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let container;
let root;
let hookApi;

function Probe({ applications }) {
  hookApi = useApplicationDigests(applications);
  return null;
}

async function mount(applications) {
  await act(async () => {
    root.render(createElement(Probe, { applications }));
  });
}

async function flush(times = 3) {
  for (let i = 0; i < times; i += 1) {
    await act(async () => {});
  }
}

// Old enough that selectAutoDigestTargets never treats it as an auto
// target regardless of whether a digest already exists for it — keeps the
// auto fan-out out of the way of tests that drive runOne/researchOne by
// hand.
const OLD_TRACKED_AT = "2000-01-01T00:00:00.000Z";

beforeEach(() => {
  hookApi = undefined;
  h.listDigestsImpl.mockReset();
  h.listDigestsImpl.mockResolvedValue({ digests: {}, error: null });
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

describe("useApplicationDigests — round trip (guard)", () => {
  it("passes citation_outcome and researched_at through to digestsById untouched, from the initial load", async () => {
    const stored = {
      application_id: "app-1",
      status: "ready",
      markdown: "## What the company does\nNimbus builds cold-chain software.",
      sources: [{ url: "https://www.reuters.com/business/nimbus-series-c", title: "Reuters" }],
      citation_outcome: {
        version: 1,
        counts: { annotations: 1, placed: 1, markersRendered: 1 },
        len: 60,
        hash: "deadbeef",
      },
      researched_at: "2026-08-01T12:00:00.000Z",
      updated_at: "2026-08-01T12:00:05.000Z",
    };
    h.listDigestsImpl.mockResolvedValue({ digests: { "app-1": stored }, error: null });

    await mount([{ id: "app-1", tracked_at: OLD_TRACKED_AT }]);
    await flush();

    expect(hookApi.digestsById["app-1"]).toEqual(stored);
  });

  it("passes citation_outcome and researched_at through to digestsById untouched, from a successful researchOne", async () => {
    h.listDigestsImpl.mockResolvedValue({ digests: {}, error: null });
    await mount([{ id: "app-1", tracked_at: OLD_TRACKED_AT }]);
    await flush();

    const fresh = {
      application_id: "app-1",
      status: "ready",
      markdown: "## What the company does\nNimbus builds cold-chain software.",
      sources: [{ url: "https://www.reuters.com/business/nimbus-series-c", title: "Reuters" }],
      citation_outcome: { version: 1, counts: { annotations: 1, placed: 1 } },
      researched_at: "2026-09-05T09:00:00.000Z",
      updated_at: "2026-09-05T09:00:01.000Z",
    };
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(jsonResponse({ digest: fresh })));

    await act(async () => {
      await hookApi.researchOne("app-1");
    });

    expect(hookApi.digestsById["app-1"]).toEqual(fresh);
  });
});

describe("useApplicationDigests — runOne's catch merges rather than blanks (1c C-6)", () => {
  it("carries forward markdown/sources/citation_outcome/researched_at when a request throws, rather than blanking them", async () => {
    const stored = {
      application_id: "app-1",
      status: "ready",
      markdown: "## What the company does\nNimbus builds cold-chain software.",
      sources: [{ url: "https://www.reuters.com/business/nimbus-series-c", title: "Reuters" }],
      citation_outcome: { version: 1, counts: { annotations: 1, placed: 1 } },
      researched_at: "2026-08-01T12:00:00.000Z",
      updated_at: "2026-08-01T12:00:05.000Z",
    };
    h.listDigestsImpl.mockResolvedValue({ digests: { "app-1": stored }, error: null });
    await mount([{ id: "app-1", tracked_at: OLD_TRACKED_AT }]);
    await flush();
    expect(hookApi.digestsById["app-1"].markdown).toBe(stored.markdown);

    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("network down")));
    await act(async () => {
      await hookApi.researchOne("app-1");
    });

    const after = hookApi.digestsById["app-1"];
    // What the fix is FOR: an actionable failure state, not a wipe.
    expect(after.status).toBe("failed");
    expect(after.error).toBe("network down");
    // The four assertions a blanking implementation cannot pass:
    expect(after.markdown).toBe(stored.markdown);
    expect(after.sources).toEqual(stored.sources);
    expect(after.citation_outcome).toEqual(stored.citation_outcome);
    expect(after.researched_at).toBe(stored.researched_at);
  });

  it("still reports a plain 'never researched' shape when there was nothing to carry forward", async () => {
    // No prior digest at all for this id. The merge must not manufacture
    // markdown/sources/citation_outcome out of nothing.
    h.listDigestsImpl.mockResolvedValue({ digests: {}, error: null });
    await mount([{ id: "app-2", tracked_at: OLD_TRACKED_AT }]);
    await flush();

    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("offline")));
    await act(async () => {
      await hookApi.researchOne("app-2");
    });

    const after = hookApi.digestsById["app-2"];
    expect(after.status).toBe("failed");
    expect(after.error).toBe("offline");
    expect(after.markdown).toBeFalsy();
    expect(Array.isArray(after.sources) ? after.sources.length : 0).toBe(0);
  });
});

describe("useApplicationDigests — in-flight guard on runOne (1h F-7)", () => {
  it("does not fire a second request for the same id while the first is still unsettled", async () => {
    h.listDigestsImpl.mockResolvedValue({ digests: {}, error: null });
    await mount([{ id: "app-1", tracked_at: OLD_TRACKED_AT }]);
    await flush();

    let resolveFetch;
    const gate = new Promise((resolve) => {
      resolveFetch = resolve;
    });
    const fetchMock = vi.fn().mockImplementation(
      () => gate.then(() => jsonResponse({ digest: { application_id: "app-1", status: "ready", markdown: "x", sources: [] } })),
    );
    vi.stubGlobal("fetch", fetchMock);

    let firstCall;
    let secondCall;
    await act(async () => {
      // Fired back to back, synchronously, with no await between them — the
      // shape a fast double-click or a programmatic double call produces.
      // Neither promise is awaited HERE: without the guard, the second call
      // is also a real in-flight request pending on the same gate, and
      // awaiting it before the gate opens would hang the test instead of
      // failing it cleanly.
      firstCall = hookApi.researchOne("app-1");
      secondCall = hookApi.researchOne("app-1");
    });

    // The guard's whole job: at most one real request in flight for this id.
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      resolveFetch();
      await Promise.all([firstCall, secondCall]);
    });

    // The guard releases once the in-flight call settles — a later call is
    // not permanently locked out.
    await act(async () => {
      await hookApi.researchOne("app-1");
    });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("guards per application id, not globally — two different ids run concurrently", async () => {
    h.listDigestsImpl.mockResolvedValue({ digests: {}, error: null });
    await mount([
      { id: "app-1", tracked_at: OLD_TRACKED_AT },
      { id: "app-2", tracked_at: OLD_TRACKED_AT },
    ]);
    await flush();

    const fetchMock = vi.fn().mockResolvedValue(
      jsonResponse({ digest: { status: "ready", markdown: "x", sources: [] } }),
    );
    vi.stubGlobal("fetch", fetchMock);

    await act(async () => {
      await Promise.all([hookApi.researchOne("app-1"), hookApi.researchOne("app-2")]);
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("clears researchingIds for the id even when the guarded duplicate call was skipped", async () => {
    h.listDigestsImpl.mockResolvedValue({ digests: {}, error: null });
    await mount([{ id: "app-1", tracked_at: OLD_TRACKED_AT }]);
    await flush();

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(
      jsonResponse({ digest: { application_id: "app-1", status: "ready", markdown: "x", sources: [] } }),
    ));

    await act(async () => {
      const first = hookApi.researchOne("app-1");
      const second = hookApi.researchOne("app-1"); // guarded no-op
      await Promise.all([first, second]);
    });

    expect(hookApi.researchingIds.has("app-1")).toBe(false);
  });
});
