// @vitest-environment jsdom
//
// The example-project pool's prewarm hook: two triggers over one request path.
//
//   PRIMARY (`applications`, the tracking table's rows) goes through the cost
//   gate selectAutoProjectPoolTargets, which only auto-targets a pool-less row
//   tracked within AUTO_PROJECT_POOL_MAX_AGE_HOURS. The age limit reads each
//   row's `tracked_at`, so the case that matters is an OLD pool-less row: if the
//   hook ever stopped carrying `tracked_at` through, the gate would lose its
//   recency limit without any error and fire a model call per untouched row.
//
//   SECONDARY (`selectedApplicationId`, the copilot's selected posting) goes
//   straight to the route for that one application, which is what covers an old
//   row the age limit skipped.
//
// Pattern: useApplicationDigests.test.js. Only the Supabase-facing calls and
// fetch are doubles; the cost gate, runWithConcurrency and readEngine are real.

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

const HOUR = 3600 * 1000;
const RECENT = new Date(Date.now() - HOUR).toISOString();
const OLD = "2000-01-01T00:00:00.000Z";

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
  h.getPoolImpl.mockResolvedValue({ pool: null, error: null });
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

describe("PRIMARY: the tracking table's age-limited cost gate", () => {
  it("warms a recent pool-less row and leaves an old one alone (tracked_at reaches the gate)", async () => {
    await mount({
      applications: [
        { id: "recent-1", tracked_at: RECENT },
        { id: "old-1", tracked_at: OLD },
      ],
    });
    await flush();
    expect(h.listPoolsImpl).toHaveBeenCalledTimes(1);
    const bodies = postedBodies();
    expect(bodies.map((b) => b.applicationId)).toEqual(["recent-1"]);
    expect(bodies[0].force).toBe(false);
    expect(fetchMock.mock.calls[0][0]).toBe("/api/application-project-pool");
  });

  it("never auto-targets a ready, a failed or a young pending pool", async () => {
    h.listPoolsImpl.mockResolvedValue({
      pools: {
        "ready-1": readyPool("ready-1"),
        "failed-1": { application_id: "failed-1", status: "failed", updated_at: RECENT },
        "pending-1": { application_id: "pending-1", status: "pending", updated_at: new Date().toISOString() },
      },
      error: null,
    });
    await mount({
      applications: [
        { id: "ready-1", tracked_at: RECENT },
        { id: "failed-1", tracked_at: RECENT },
        { id: "pending-1", tracked_at: RECENT },
      ],
    });
    await flush();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("retries a pending pool that has outlived POOL_PENDING_MAX_AGE (a crashed generation)", async () => {
    h.listPoolsImpl.mockResolvedValue({
      pools: { "crashed-1": { application_id: "crashed-1", status: "pending", updated_at: OLD } },
      error: null,
    });
    await mount({ applications: [{ id: "crashed-1", tracked_at: OLD }] });
    await flush();
    expect(postedBodies().map((b) => b.applicationId)).toEqual(["crashed-1"]);
  });

  it("fires once per distinct id set, not once per render that hands back a new array", async () => {
    const rows = () => [{ id: "recent-1", tracked_at: RECENT }];
    await mount({ applications: rows() });
    await flush();
    await mount({ applications: rows() });
    await flush();
    expect(h.listPoolsImpl).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("does nothing for the embedded engine (the route refuses it)", async () => {
    localStorage.setItem("tailorEngine", "embedded");
    await mount({ applications: [{ id: "recent-1", tracked_at: RECENT }] });
    await flush();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("SECONDARY: the selected posting goes straight to the route", () => {
  it("warms an OLD pool-less application the age-limited gate would skip, without a list read", async () => {
    await mount({ selectedApplicationId: "old-1" });
    await flush();
    expect(h.listPoolsImpl).not.toHaveBeenCalled();
    expect(h.getPoolImpl).toHaveBeenCalledTimes(1);
    expect(postedBodies()).toEqual([{ applicationId: "old-1", engine: "gemini", force: false }]);
  });

  it("does not ask for a pool that is already ready", async () => {
    h.getPoolImpl.mockResolvedValue({ pool: readyPool("a1"), error: null });
    await mount({ selectedApplicationId: "a1" });
    await flush();
    expect(fetchMock).not.toHaveBeenCalled();
    expect(hookApi.poolsById.a1.status).toBe("ready");
  });

  // RULED CHANGE (N143 fix round F2, M5): this case used to assert that a FAILED
  // pool is regenerated with force on mount ("choosing a posting is the explicit
  // request"). That pinned a defect: every copilot or practice mount re-billed
  // the same stuck row, against AC-4. A failed pool now stays failed until an
  // explicit retry (regenerateOne), and the positive controls below prove the
  // harness still fires for the states that DO warrant a request.
  it("does NOT regenerate a FAILED pool on a plain mount (no auto re-bill), with positive controls", async () => {
    h.getPoolImpl.mockResolvedValue({
      pool: { application_id: "a1", status: "failed", updated_at: RECENT },
      error: null,
    });
    await mount({ selectedApplicationId: "a1" });
    await flush();
    expect(h.getPoolImpl).toHaveBeenCalledTimes(1);
    expect(fetchMock).not.toHaveBeenCalled();
    expect(hookApi.poolsById.a1.status).toBe("failed");

    // Positive control 1: a MISSING pool, same mount path, IS warmed -- so the
    // absence above is the failed-pool rule, not a deaf hook.
    h.getPoolImpl.mockResolvedValue({ pool: null, error: null });
    await mount({ selectedApplicationId: "a2" });
    await flush();
    expect(postedBodies()).toEqual([{ applicationId: "a2", engine: "gemini", force: false }]);

    // Positive control 2: a YOUNG pending pool is another request generating and
    // is left alone, so nothing further was sent.
    h.getPoolImpl.mockResolvedValue({
      pool: { application_id: "a3", status: "pending", updated_at: new Date().toISOString() },
      error: null,
    });
    await mount({ selectedApplicationId: "a3" });
    await flush();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("an explicit retry (regenerateOne) is still the way a FAILED pool is regenerated, with force", async () => {
    h.getPoolImpl.mockResolvedValue({
      pool: { application_id: "a1", status: "failed", updated_at: RECENT },
      error: null,
    });
    await mount({ selectedApplicationId: "a1" });
    await flush();
    expect(fetchMock).not.toHaveBeenCalled();
    await act(async () => {
      hookApi.regenerateOne("a1");
    });
    await flush();
    expect(postedBodies()).toEqual([{ applicationId: "a1", engine: "gemini", force: true }]);
  });

  it("leaves a young pending pool alone and regenerates a stale one", async () => {
    h.getPoolImpl.mockResolvedValue({
      pool: { application_id: "a1", status: "pending", updated_at: new Date().toISOString() },
      error: null,
    });
    await mount({ selectedApplicationId: "a1" });
    await flush();
    expect(fetchMock).not.toHaveBeenCalled();

    h.getPoolImpl.mockResolvedValue({
      pool: { application_id: "a2", status: "pending", updated_at: OLD },
      error: null,
    });
    await mount({ selectedApplicationId: "a2" });
    await flush();
    expect(postedBodies()).toEqual([{ applicationId: "a2", engine: "gemini", force: false }]);
  });

  it("does not generate over a pool whose READ failed (a failed read is not a miss)", async () => {
    h.getPoolImpl.mockResolvedValue({ pool: null, error: "transient" });
    await mount({ selectedApplicationId: "a1" });
    await flush();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("asks once per selected id, and again when the selection moves", async () => {
    await mount({ selectedApplicationId: "a1" });
    await flush();
    await mount({ selectedApplicationId: "a1" });
    await flush();
    expect(fetchMock).toHaveBeenCalledTimes(1);
    await mount({ selectedApplicationId: "a2" });
    await flush();
    expect(postedBodies().map((b) => b.applicationId)).toEqual(["a1", "a2"]);
  });

  it("does nothing with no selection and nothing for the embedded engine", async () => {
    await mount({ selectedApplicationId: null });
    await flush();
    expect(h.getPoolImpl).not.toHaveBeenCalled();
    localStorage.setItem("tailorEngine", "embedded");
    await mount({ selectedApplicationId: "a1" });
    await flush();
    expect(h.getPoolImpl).not.toHaveBeenCalled();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe("the request path both triggers share", () => {
  it("turns a request that never reached the route into a failed pool, merged over the old one", async () => {
    h.getPoolImpl.mockResolvedValue({ pool: null, error: null });
    fetchMock.mockRejectedValue(new Error("offline"));
    await mount({ selectedApplicationId: "a1" });
    await flush();
    expect(hookApi.poolsById.a1).toMatchObject({ application_id: "a1", status: "failed", error: "offline" });
    expect(hookApi.prewarmingIds.has("a1")).toBe(false);
  });

  it("refuses a second request for the same id while the first is in flight, and not for a different id", async () => {
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
      hookApi.regenerateOne("a1");
    });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(hookApi.prewarmingIds.has("a1")).toBe(true);
    await act(async () => {
      release();
    });
    await flush();
    expect(hookApi.prewarmingIds.has("a1")).toBe(false);
  });

  it("regenerateOne sends force", async () => {
    await mount({});
    await flush();
    await act(async () => {
      hookApi.regenerateOne("a1");
    });
    await flush();
    expect(postedBodies()).toEqual([{ applicationId: "a1", engine: "gemini", force: true }]);
  });

  it("records the outcome through logEvent as identity only (application, status, count)", async () => {
    const logEvent = vi.fn();
    await mount({ selectedApplicationId: "a1", logEvent });
    await flush();
    expect(logEvent).toHaveBeenCalledTimes(1);
    expect(logEvent).toHaveBeenCalledWith("projectPool.prewarm", { applicationId: "a1", status: "ready", count: 3 });
  });

  it("records a failed outcome too", async () => {
    const logEvent = vi.fn();
    fetchMock.mockRejectedValue(new Error("offline"));
    await mount({ selectedApplicationId: "a1", logEvent });
    await flush();
    expect(logEvent).toHaveBeenCalledWith("projectPool.prewarm", { applicationId: "a1", status: "failed", count: 0 });
  });
});
