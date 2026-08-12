// @vitest-environment jsdom
//
// A per-file jsdom override (vitest.config.js stays `environment: "node"`);
// app/copilot/useCopilotDashboard.wiring.test.js is this repo's worked
// example for testing a hook this way: render it through a tiny probe
// component under `act()` and assert against OBSERVABLE state, rather than
// calling the hook function directly (hooks may only run inside a component).
//
// The two behaviours this file exists to pin are both about what happens
// AROUND a network round trip, not the round trip's happy path alone:
// optimistic local state that appears before the request settles, and local
// state that survives - rather than reverts - when the request fails. Both
// are called out by name in useExperiencePages.js's own comments as
// deliberate, not accidental.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createElement, act } from "react";
import { createRoot } from "react-dom/client";
import { useExperiencePages } from "./useExperiencePages.js";

// D1 regression coverage below (describe "move preserves the full page
// list") exercises the REAL POST /api/experience/move route handler, not a
// hand-rolled stand-in for it - that route is where the actual bug (and its
// fix) lives, and a test that only fakes what the route "probably" returns
// would stay green even if the route's real behaviour regressed. Only the
// Supabase data-access layer underneath the route is mocked, exactly as
// app/api/experience/routes.contract.test.js already does for the route's
// own tests.
vi.mock("@/lib/supabase/server", () => ({ createClient: vi.fn() }));
vi.mock("@/lib/supabase/experiencePages", () => ({
  listPages: vi.fn(),
  createPage: vi.fn(),
  updatePage: vi.fn(),
  applyMoves: vi.fn(),
  deletePage: vi.fn(),
}));

import { createClient } from "@/lib/supabase/server";
import * as experiencePagesStore from "@/lib/supabase/experiencePages";
import { POST as MOVE_ROUTE } from "../api/experience/move/route.js";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

// A small probe that calls the real hook and assigns its return value to an
// outer-scope variable so assertions can read it between actions - the exact
// pattern app/copilot/useCopilotDashboard.wiring.test.js establishes, and
// which eslint.config.mjs turns off `react-hooks/globals` for (`**/*.test.js`)
// specifically to allow.
let hookApi;
function Probe() {
  hookApi = useExperiencePages();
  return null;
}

let container;
let root;

beforeEach(() => {
  hookApi = undefined;
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => {
    root.unmount();
  });
  container.remove();
  delete global.fetch;
});

async function flush(times = 5) {
  for (let i = 0; i < times; i += 1) {
    await act(async () => {});
  }
}

async function renderHook() {
  await act(async () => {
    root.render(createElement(Probe));
  });
  await flush();
}

function jsonResponse(status, body) {
  return {
    status,
    ok: status >= 200 && status < 300,
    json: async () => body,
  };
}

const PAGE_A = {
  id: "a1",
  parent_id: null,
  title: "Page A",
  body: "",
  position: 0,
  archived_at: null,
  created_at: "2026-01-01T00:00:00.000Z",
  updated_at: "2026-01-01T00:00:00.000Z",
};

describe("useExperiencePages -- load on mount", () => {
  it("loads pages on mount from /api/experience", async () => {
    global.fetch = vi.fn().mockResolvedValue(jsonResponse(200, { pages: [PAGE_A] }));

    await renderHook();

    expect(global.fetch).toHaveBeenCalledWith("/api/experience");
    expect(hookApi.pages).toEqual([PAGE_A]);
    expect(hookApi.loading).toBe(false);
  });
});

describe("useExperiencePages -- optimistic create", () => {
  it("adds the new page to state before the create request resolves", async () => {
    let resolveCreate;
    global.fetch = vi.fn((url, options) => {
      if (!options) {
        // The GET on mount.
        return Promise.resolve(jsonResponse(200, { pages: [] }));
      }
      // The POST for createPage - deliberately left pending so the test can
      // observe state at the moment right after the call, before it settles.
      return new Promise((resolve) => {
        resolveCreate = resolve;
      });
    });

    await renderHook();
    expect(hookApi.pages).toEqual([]);

    let createPromise;
    await act(async () => {
      createPromise = hookApi.createPage({ title: "New page", parentId: null });
    });

    // The create request is still in flight (resolveCreate has been captured
    // but not yet called) - and the optimistic page is already in state.
    expect(resolveCreate).toBeInstanceOf(Function);
    expect(hookApi.pages).toHaveLength(1);
    expect(hookApi.pages[0].title).toBe("New page");
    expect(hookApi.pages[0].id).toMatch(/^temp-/);

    // Settle the pending request so the test leaves no dangling promise.
    await act(async () => {
      resolveCreate(jsonResponse(200, { page: { ...hookApi.pages[0], id: "real-1" } }));
    });
    await createPromise;
  });
});

describe("useExperiencePages -- failed save does not roll back typed text", () => {
  it("keeps the user's typed body text on screen when the save request fails", async () => {
    global.fetch = vi.fn((url, options) => {
      if (!options) {
        return Promise.resolve(jsonResponse(200, { pages: [PAGE_A] }));
      }
      if (options.method === "PATCH") {
        return Promise.resolve(jsonResponse(500, { error: "boom" }));
      }
      throw new Error(`Unexpected fetch call: ${url}`);
    });

    await renderHook();
    expect(hookApi.pages[0].body).toBe("");

    await act(async () => {
      await hookApi.updatePageBody("a1", "text the user just typed");
    });

    const saved = hookApi.pages.find((p) => p.id === "a1");
    // The important assertion: a failed autosave must not silently destroy
    // what the user just wrote by reverting local state.
    expect(saved.body).toBe("text the user just typed");
    expect(hookApi.error).toBeTruthy();
  });
});

describe("useExperiencePages -- move rejected as a cycle", () => {
  it("produces a specific human message about moving a page inside its own sub-page", async () => {
    global.fetch = vi.fn((url, options) => {
      if (!options) {
        return Promise.resolve(jsonResponse(200, { pages: [PAGE_A] }));
      }
      if (url === "/api/experience/move") {
        return Promise.resolve(jsonResponse(409, { reason: "cycle" }));
      }
      throw new Error(`Unexpected fetch call: ${url}`);
    });

    await renderHook();

    let result;
    await act(async () => {
      result = await hookApi.movePage("a1", "a2");
    });

    expect(result.ok).toBe(false);
    expect(result.error).toBe("A page cannot be moved inside one of its own sub-pages.");
    expect(hookApi.error).toBe("A page cannot be moved inside one of its own sub-pages.");
  });
});

describe("useExperiencePages -- a repeated identical error still changes the stored value (D4)", () => {
  it("stores a genuinely different string for a second, identical move failure in a row", async () => {
    global.fetch = vi.fn((url, options) => {
      if (!options) {
        return Promise.resolve(jsonResponse(200, { pages: [PAGE_A] }));
      }
      if (url === "/api/experience/move") {
        return Promise.resolve(jsonResponse(409, { reason: "cycle" }));
      }
      throw new Error(`Unexpected fetch call: ${url}`);
    });

    await renderHook();

    await act(async () => {
      await hookApi.movePage("a1", "a2");
    });
    const errorAfterFirstFailure = hookApi.error;
    expect(errorAfterFirstFailure).toBe("A page cannot be moved inside one of its own sub-pages.");

    await act(async () => {
      await hookApi.movePage("a1", "a2");
    });
    const errorAfterSecondFailure = hookApi.error;

    // Both failures are logically the SAME error - the point of this test.
    // React bails out of a setState whose new value is unchanged, so if the
    // hook stored the identical string both times, a live region reading
    // `error` would never re-commit for the second failure at all: a
    // repeated identical error reads as no response. The stored value must
    // genuinely differ even though both describe the same rejection.
    expect(errorAfterSecondFailure).not.toBe(errorAfterFirstFailure);
  });
});

describe("useExperiencePages -- delete cascades locally", () => {
  it("removes a deleted page and its descendants from local state", async () => {
    const PAGES = [
      { id: "a1", parent_id: null, title: "A", position: 0, created_at: "2026-01-01T00:00:00.000Z" },
      { id: "a2", parent_id: "a1", title: "A-child", position: 0, created_at: "2026-01-02T00:00:00.000Z" },
      { id: "a3", parent_id: "a2", title: "A-grandchild", position: 0, created_at: "2026-01-03T00:00:00.000Z" },
      { id: "b1", parent_id: null, title: "B", position: 1, created_at: "2026-01-04T00:00:00.000Z" },
    ];
    global.fetch = vi.fn((url, options) => {
      if (!options) {
        return Promise.resolve(jsonResponse(200, { pages: PAGES }));
      }
      if (options.method === "DELETE") {
        return Promise.resolve(jsonResponse(200, {}));
      }
      throw new Error(`Unexpected fetch call: ${url}`);
    });

    await renderHook();
    expect(hookApi.pages).toHaveLength(4);

    let result;
    await act(async () => {
      result = await hookApi.deletePage("a1");
    });

    expect(result.ok).toBe(true);
    expect(hookApi.pages.map((p) => p.id).sort()).toEqual(["b1"]);
  });
});

function signedInForMove(userId = "user-1") {
  createClient.mockResolvedValue({
    auth: { getUser: async () => ({ data: { user: { id: userId } }, error: null }) },
  });
}

// Bridges the mocked global.fetch straight into the REAL POST
// /api/experience/move route handler - this is what lets the tests below
// exercise the actual production code the D1 defect (and its fix) lives in,
// rather than a hand-written stand-in for "whatever the route probably
// does". Everything else the route touches other than the Supabase layer
// (lib/experience/tree.js's canMove/moveNode) runs for real too.
function fetchThroughRealMoveRoute(getPages) {
  return vi.fn((url, options) => {
    if (!options) {
      return Promise.resolve(jsonResponse(200, { pages: getPages() }));
    }
    if (url === "/api/experience/move") {
      return MOVE_ROUTE(
        new Request(`http://localhost${url}`, {
          method: options.method,
          headers: options.headers,
          body: options.body,
        }),
      );
    }
    throw new Error(`Unexpected fetch call: ${url}`);
  });
}

const MOVE_PAGE_A = {
  id: "a",
  parent_id: null,
  title: "A",
  body: "",
  position: 0,
  archived_at: null,
  created_at: "2026-01-01T00:00:00.000Z",
  updated_at: "2026-01-01T00:00:00.000Z",
};
const MOVE_PAGE_B = {
  id: "b",
  parent_id: null,
  title: "B",
  body: "",
  position: 1,
  archived_at: null,
  created_at: "2026-01-02T00:00:00.000Z",
  updated_at: "2026-01-02T00:00:00.000Z",
};
const MOVE_PAGE_C = {
  id: "c",
  parent_id: null,
  title: "C",
  body: "",
  position: 2,
  archived_at: null,
  created_at: "2026-01-03T00:00:00.000Z",
  updated_at: "2026-01-03T00:00:00.000Z",
};
const MOVE_TREE = [MOVE_PAGE_A, MOVE_PAGE_B, MOVE_PAGE_C];

describe("useExperiencePages -- move preserves the full page list", () => {
  beforeEach(() => {
    signedInForMove();
  });

  it("leaves every pre-existing page present after a successful move, even though applyMoves only reports the rows it touched", async () => {
    experiencePagesStore.listPages.mockResolvedValue({ pages: MOVE_TREE, error: null });
    // The real-world shape (see the D1 repro): moving "b" under "a" only
    // touches b (new parent) and c (its position shifts down to fill b's
    // old slot) - "a" itself is never part of applyMoves' own reply.
    experiencePagesStore.applyMoves.mockResolvedValue({
      pages: [
        { ...MOVE_PAGE_B, parent_id: "a", position: 0 },
        { ...MOVE_PAGE_C, position: 1 },
      ],
      error: null,
    });

    global.fetch = fetchThroughRealMoveRoute(() => MOVE_TREE);
    await renderHook();
    expect(hookApi.pages.map((p) => p.id).sort()).toEqual(["a", "b", "c"]);

    let result;
    await act(async () => {
      result = await hookApi.movePage("b", "a");
    });

    expect(result.ok).toBe(true);
    // The important assertion: "a" must still be present. A route that
    // answers with only applyMoves' partial rows would truncate it out of
    // the hook's state even though the move never touched it.
    expect(hookApi.pages.map((p) => p.id).sort()).toEqual(["a", "b", "c"]);
  });

  it("does not empty the page list for a no-op move", async () => {
    experiencePagesStore.listPages.mockResolvedValue({ pages: MOVE_TREE, error: null });
    // A no-op move (dragging the last root page onto the root drop zone, or
    // onto the parent it is already the last child of) produces zero
    // updates - moveNode returns [] and applyMoves has nothing to touch.
    experiencePagesStore.applyMoves.mockResolvedValue({ pages: [], error: null });

    global.fetch = fetchThroughRealMoveRoute(() => MOVE_TREE);
    await renderHook();
    expect(hookApi.pages).toHaveLength(3);

    let result;
    await act(async () => {
      result = await hookApi.movePage("c", null);
    });

    expect(result.ok).toBe(true);
    // The important assertion: an empty applyMoves result must not become
    // an empty page list. `Array.isArray([])` is true, so trusting that
    // empty result as "the complete state" wipes out every page the user
    // has - the "No project pages yet" scenario the defect report describes.
    expect(hookApi.pages).not.toHaveLength(0);
    expect(hookApi.pages.map((p) => p.id).sort()).toEqual(["a", "b", "c"]);
  });
});

describe("useExperiencePages -- failed delete rolls back functionally", () => {
  it("does not discard a write that succeeded while the delete was in flight", async () => {
    const PAGE_A = {
      id: "a1",
      parent_id: null,
      title: "A",
      body: "",
      position: 0,
      archived_at: null,
      created_at: "2026-01-01T00:00:00.000Z",
      updated_at: "2026-01-01T00:00:00.000Z",
    };
    const PAGE_B = {
      id: "b1",
      parent_id: null,
      title: "Old B",
      body: "",
      position: 1,
      archived_at: null,
      created_at: "2026-01-02T00:00:00.000Z",
      updated_at: "2026-01-02T00:00:00.000Z",
    };

    let resolveDelete;
    global.fetch = vi.fn((url, options) => {
      if (!options) {
        return Promise.resolve(jsonResponse(200, { pages: [PAGE_A, PAGE_B] }));
      }
      if (options.method === "DELETE") {
        return new Promise((resolve) => {
          resolveDelete = resolve;
        });
      }
      if (options.method === "PATCH") {
        const sent = JSON.parse(options.body);
        return Promise.resolve(jsonResponse(200, { page: { ...PAGE_B, ...sent } }));
      }
      throw new Error(`Unexpected fetch call: ${url}`);
    });

    await renderHook();
    expect(hookApi.pages).toHaveLength(2);

    let deletePromise;
    await act(async () => {
      deletePromise = hookApi.deletePage("a1");
    });
    // The delete is in flight - "a1" was already removed optimistically.
    expect(hookApi.pages.map((p) => p.id)).toEqual(["b1"]);

    // A DIFFERENT write succeeds on the SAME page list while that delete is
    // still pending.
    await act(async () => {
      await hookApi.renamePage("b1", "New B");
    });
    expect(hookApi.pages.find((p) => p.id === "b1").title).toBe("New B");

    // Now the delete comes back as a failure.
    await act(async () => {
      resolveDelete(jsonResponse(500, { error: "boom" }));
      await deletePromise;
    });

    // "a1" is restored - the doomed page rolls back...
    expect(hookApi.pages.map((p) => p.id).sort()).toEqual(["a1", "b1"]);
    // ...and "b1"'s concurrent rename must survive the rollback, rather than
    // being silently reverted to whatever it looked like when deletePage was
    // first called.
    expect(hookApi.pages.find((p) => p.id === "b1").title).toBe("New B");
  });
});
