// @vitest-environment jsdom
//
// N143 fix round F2 (M2): the pool prewarm's SELF-HEAL. A pool that was missing
// or still being built when a question was answered comes back from the answer
// route as a `pending` Row 1. The copilot and practice producers report every
// Row 1 status they see through `noteRowOneStatus`, and the first `pending` for
// an application with nothing already in flight must fire ONE prewarm so the
// next question shows the example instead of the card saying "still being
// prepared" for the rest of the session.
//
// What is pinned, each against its failure direction:
//   - a `pending` status fires exactly one request (a hook that never heals
//     leaves the card warming forever -- the defect);
//   - a ready / no_match / failed status fires none (healing a failed pool
//     would re-bill it on every question, against AC-4);
//   - repeated `pending` notes fire once, not once per question or per render;
//   - the episode ends when the application reports anything but `pending`, so a
//     pool that goes cold again later can heal again;
//   - a request already in flight (the mount-time warm) is not doubled.
//
// Harness: useApplicationProjectPool.test.js next door. Only the Supabase-facing
// calls and fetch are doubles.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createElement, act } from "react";
import { createRoot } from "react-dom/client";

const h = vi.hoisted(() => ({ listPoolsImpl: vi.fn(), getPoolImpl: vi.fn() }));

vi.mock("../../lib/supabase/client", () => ({
  createClient: () => ({
    auth: { getUser: async () => ({ data: { user: { id: "user-1" } } }) },
  }),
}));
vi.mock("../../lib/supabase/applicationProjectPool", () => ({
  listProjectPools: (...args) => h.listPoolsImpl(...args),
  getProjectPool: (...args) => h.getPoolImpl(...args),
}));

import { useApplicationProjectPool } from "./useApplicationProjectPool.js";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let container;
let root;
let hookApi;

function Probe(props) {
  hookApi = useApplicationProjectPool(props);
  return null;
}

async function mount(props) {
  await act(async () => {
    root.render(createElement(Probe, props));
  });
}

async function flush(times = 6) {
  for (let i = 0; i < times; i += 1) {
    await act(async () => {});
  }
}

async function note(applicationId, status) {
  await act(async () => {
    hookApi.noteRowOneStatus(applicationId, status);
  });
  await flush();
}

const RECENT = new Date(Date.now() - 3600 * 1000).toISOString();
const readyPool = (id) => ({ application_id: id, status: "ready", projects: [{}, {}, {}], updated_at: RECENT });

let fetchMock;

function jsonResponse(body, status = 200) {
  return { ok: status >= 200 && status < 300, status, json: async () => body };
}

function postedBodies() {
  return fetchMock.mock.calls.map(([, init]) => JSON.parse(init.body));
}

beforeEach(() => {
  hookApi = undefined;
  h.listPoolsImpl.mockReset();
  h.listPoolsImpl.mockResolvedValue({ pools: {}, error: null });
  h.getPoolImpl.mockReset();
  // The selected posting's pool is already ready, so the MOUNT path stays quiet
  // and every request counted below is the self-heal's.
  h.getPoolImpl.mockImplementation(async (_supabase, _userId, id) => ({ pool: readyPool(id), error: null }));
  fetchMock = vi.fn(async (url, init) => {
    const { applicationId } = JSON.parse(init.body);
    return jsonResponse({ pool: readyPool(applicationId) });
  });
  vi.stubGlobal("fetch", fetchMock);
  localStorage.clear();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
  localStorage.clear();
});

describe("noteRowOneStatus -- a pending Row 1 re-fires the prewarm", () => {
  it("[positive control] one pending status fires exactly one non-forced request for that application", async () => {
    await mount({ selectedApplicationId: "a1" });
    await flush();
    expect(fetchMock).not.toHaveBeenCalled();

    await note("a1", "pending");
    expect(postedBodies()).toEqual([{ applicationId: "a1", engine: "gemini", force: false }]);
    expect(hookApi.poolsById.a1.status).toBe("ready");
  });

  it("fires NOTHING for a ready, no_match or failed status (a failed pool is never auto re-billed)", async () => {
    await mount({ selectedApplicationId: "a1" });
    await flush();
    await note("a1", "ready");
    await note("a1", "no_match");
    await note("a1", "failed");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("fires once per cold episode, however many questions report pending", async () => {
    await mount({ selectedApplicationId: "a1" });
    await flush();
    await note("a1", "pending");
    await note("a1", "pending");
    await note("a1", "pending");
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("a status other than pending ends the episode, so a pool that goes cold again can heal again", async () => {
    await mount({ selectedApplicationId: "a1" });
    await flush();
    await note("a1", "pending");
    await note("a1", "ready");
    await note("a1", "pending");
    expect(postedBodies().map((b) => b.applicationId)).toEqual(["a1", "a1"]);
  });

  it("episodes are per application", async () => {
    await mount({ selectedApplicationId: "a1" });
    await flush();
    await note("a1", "pending");
    await note("a2", "pending");
    expect(postedBodies().map((b) => b.applicationId)).toEqual(["a1", "a2"]);
  });

  it("does not double a request already in flight, and does not start an episode while one is", async () => {
    let release;
    fetchMock.mockImplementation(
      () =>
        new Promise((resolve) => {
          release = () => resolve(jsonResponse({ pool: readyPool("a1") }));
        }),
    );
    await mount({});
    await flush();
    await act(async () => {
      hookApi.regenerateOne("a1");
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await note("a1", "pending");
    expect(fetchMock).toHaveBeenCalledTimes(1);

    await act(async () => {
      release();
    });
    await flush();
    // The in-flight request settled; nothing marked the episode as spent, so a
    // pending the pool still reports afterwards is allowed its one request.
    fetchMock.mockImplementation(async () => jsonResponse({ pool: readyPool("a1") }));
    await note("a1", "pending");
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("fires nothing for the embedded engine, a missing id or a non-string status", async () => {
    localStorage.setItem("tailorEngine", "embedded");
    await mount({});
    await flush();
    await note("a1", "pending");
    expect(fetchMock).not.toHaveBeenCalled();

    localStorage.clear();
    await note(null, "pending");
    await note("a1", undefined);
    await note("a1", null);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
