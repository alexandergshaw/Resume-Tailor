// @vitest-environment jsdom
//
// N151b (4b) — T4 / R5 / R6 / R7 (+ the T8 runtime refetch-to-null): the switcher
// hook useTemplateLibrary({ currentUser, kind }) -> { templates, selectedId,
// loading, error, refresh, select, remove }. The REAL hook is mounted in a tiny
// host (createRoot + act), exactly as useMaterialsLocker.markTemplate.test.js
// does; the three client helpers are mocked so this isolates the hook's state
// machine.
//
// RED on HEAD: app/hooks/useTemplateLibrary.js does not exist (module-not-found),
// so the whole file reds until Step 3. GREEN after Step 3.
//
// Headline instrument R5 (optimistic REVERT): a select that the server REJECTS
// must not leave the rejected template showing as active. The teeth are made
// independent of the post-action refetch by having that refetch ALSO fail — so a
// build that relies only on refresh() to reconcile (and whose refresh can itself
// fail) is caught: the EXPLICIT revert is the load-bearing protection.
//   R5 mutation: drop the revert-on-failure -> selectedId stays on the rejected id.
//   R6 mutation: skip the refetch after remove -> a deleted active template stays
//                checked (phantom active).
//   R7 mutation: drop the stale-response guard -> an out-of-order refresh wins.
// No-op CONTROL that must survive: a successful select keeps the new id (the
// optimistic path is not globally disabled); removing a NON-active template leaves
// the selection unchanged.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createElement, act } from "react";
import { createRoot } from "react-dom/client";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

vi.mock("../../lib/document/templateLibraryClient", () => ({
  listLibraryTemplates: vi.fn(),
  selectLibraryTemplate: vi.fn(),
  deleteLibraryTemplate: vi.fn(),
  registerTemplateFromBytes: vi.fn(),
}));

import { useTemplateLibrary } from "./useTemplateLibrary.js";
import {
  listLibraryTemplates,
  selectLibraryTemplate,
  deleteLibraryTemplate,
} from "../../lib/document/templateLibraryClient";

const USER = { id: "user-1" };
const A = { id: "tmpl-a", name: "Classic", kind: "resume" };
const B = { id: "tmpl-b", name: "Modern", kind: "resume" };

function deferred() {
  let resolve;
  const promise = new Promise((r) => { resolve = r; });
  return { promise, resolve };
}

let container;
let root;
let api;

function Harness({ currentUser, kind = "resume" }) {
  api = useTemplateLibrary({ currentUser, kind });
  return null;
}
async function mount(currentUser = USER, kind = "resume") {
  await act(async () => {
    root.render(createElement(Harness, { currentUser, kind }));
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  listLibraryTemplates.mockResolvedValue({ ok: true, templates: [A, B], selectedId: "tmpl-a" });
  selectLibraryTemplate.mockResolvedValue({ ok: true });
  deleteLibraryTemplate.mockResolvedValue({ ok: true });
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  api = null;
});
afterEach(async () => {
  await act(async () => { root.unmount(); });
  container.remove();
});

describe("mount refresh (T4)", () => {
  it("populates templates AND selectedId from the list call", async () => {
    await mount();
    expect(listLibraryTemplates).toHaveBeenCalledWith("resume");
    expect(api.templates).toHaveLength(2);
    expect(api.selectedId).toBe("tmpl-a");
  });

  it("signed out: clears to empty and never calls the list", async () => {
    await mount(null);
    expect(listLibraryTemplates).not.toHaveBeenCalled();
    expect(api.templates).toEqual([]);
    expect(api.selectedId).toBeNull();
  });
});

describe("select is optimistic and calls PUT (T4)", () => {
  it("[control] a SUCCESSFUL select sets selectedId optimistically and calls selectLibraryTemplate", async () => {
    await mount();
    listLibraryTemplates.mockResolvedValue({ ok: true, templates: [A, B], selectedId: "tmpl-b" });
    await act(async () => { await api.select("tmpl-b"); });
    expect(selectLibraryTemplate).toHaveBeenCalledTimes(1);
    expect(selectLibraryTemplate.mock.calls[0][0]).toMatchObject({ kind: "resume", templateId: "tmpl-b" });
    expect(api.selectedId).toBe("tmpl-b");
  });
});

// ---------------------------------------------------------------------------
// R5 — the headline optimistic-revert instrument.
// ---------------------------------------------------------------------------
describe("select REVERTS on failure (T4 / R5)", () => {
  it("shows the pick optimistically, then reverts off it when the server rejects — even if the reconcile refetch also fails", async () => {
    await mount(); // selectedId = tmpl-a
    const putGate = deferred();
    selectLibraryTemplate.mockReturnValue(putGate.promise);
    // The reconcile refetch after the failure ALSO fails: only an EXPLICIT revert
    // can rescue the UI here, so this isolates the revert from refresh().
    listLibraryTemplates.mockResolvedValue({ ok: false, error: "offline" });

    let selectPromise;
    await act(async () => { selectPromise = api.select("tmpl-b"); });
    // Optimistic: the pick shows immediately, before the PUT resolves.
    expect(api.selectedId, "select was not optimistic").toBe("tmpl-b");

    await act(async () => {
      putGate.resolve({ ok: false, error: "That template is not in your library." });
      await selectPromise;
    });
    // Reverted: the rejected id must NOT remain the active one.
    expect(api.selectedId, "a rejected select left the rejected template showing active").toBe("tmpl-a");
    expect(api.error, "no error surfaced for the rejected select").toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// R6 / T8-runtime — remove refetches, and reconciles to null when the pointer
// was cleared (ON DELETE SET NULL, re-read, never assumed).
// ---------------------------------------------------------------------------
describe("remove refetches and never assumes the pointer (T4 / R6 / T8-runtime)", () => {
  it("deleting the ACTIVE template calls DELETE then refetches to selectedId=null", async () => {
    await mount(); // selectedId = tmpl-a (active)
    // The refetch models the DB having nulled the pointer (ON DELETE SET NULL,
    // pinned at the SQL level by N151a's migration-shape test — NOT claimed here);
    // the hook must re-read it, not keep the stale checked id.
    listLibraryTemplates.mockResolvedValue({ ok: true, templates: [B], selectedId: null });
    await act(async () => { await api.remove("tmpl-a"); });
    expect(deleteLibraryTemplate).toHaveBeenCalledWith("tmpl-a");
    expect(api.selectedId, "a deleted active template stayed checked (phantom active)").toBeNull();
    expect(api.templates).toHaveLength(1);
  });

  it("[control] deleting a NON-active template refetches but leaves the selection unchanged", async () => {
    await mount(); // selectedId = tmpl-a
    listLibraryTemplates.mockResolvedValue({ ok: true, templates: [A], selectedId: "tmpl-a" });
    await act(async () => { await api.remove("tmpl-b"); });
    expect(deleteLibraryTemplate).toHaveBeenCalledWith("tmpl-b");
    expect(api.selectedId).toBe("tmpl-a");
  });
});

// ---------------------------------------------------------------------------
// R7 — a stale refresh must not overwrite a newer one.
// ---------------------------------------------------------------------------
describe("stale-response guard (T4 / R7)", () => {
  it("when an earlier refresh resolves AFTER a later one, the later (newer) result wins", async () => {
    await mount(); // consumes the mount list call (resolved)
    const first = deferred();
    const second = deferred();
    listLibraryTemplates.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);

    let p1, p2;
    await act(async () => { p1 = api.refresh(); });
    await act(async () => { p2 = api.refresh(); });
    // The SECOND (newer) request resolves first, then the stale FIRST resolves.
    await act(async () => {
      second.resolve({ ok: true, templates: [B], selectedId: "tmpl-b" });
      first.resolve({ ok: true, templates: [A], selectedId: "tmpl-a" });
      await Promise.all([p1, p2]);
    });
    expect(api.selectedId, "a stale refresh overwrote the newer result").toBe("tmpl-b");
  });
});
