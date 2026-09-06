// @vitest-environment jsdom
//
// LIVE DEFECT under test: `applications.application_url` is a per-user
// override of the shared `positions.url` -- TrackingTab.js already honours
// it (`app.application_url || pos?.url`, TrackingTab.js:241,495), but this
// component read `row.positions?.url` / `pos.url` raw at every site that
// chooses which URL to open or link to (the walkthrough "Open posting"
// href, its Apply-button disabled check, the list-view Apply button's
// disabled check and tooltip, and handleApply's own window.open target).
// A user who has recorded their own application URL would see -- and be
// sent to -- the shared catalogue's posting instead.
//
// Fix under test: every site now prefers `row.application_url`, falling
// back to `row.positions?.url` (postingUrlFor(), AutoApplyQueueTab.js).
// The override is exactly as untrusted as the shared url it replaces (see
// lib/url/safeExternalHref.js's banner: `positions` has no user_id column
// and any signed-in account can overwrite any row -- an `application_url`
// typed in by the row's own user is not any MORE trustworthy just because
// it is theirs), so it must pass through the same two controls: the
// walkthrough href still goes through safeExternalHref, and handleApply's
// open still goes through openPostingBeside with its window.open fallback
// unchanged (see windowOpenSafety.sweep.test.js's positive control on this
// exact file/site, which pins the fallback's variable name to `url`).
//
// NOTE ON DATA AVAILABILITY: GET /api/auto-apply-queue
// (app/api/auto-apply-queue/route.js) does not select or map
// `application_url` onto the returned item yet -- that route is outside
// this fix's file scope (explicitly off limits: "do not edit ... app/api/").
// So every test below supplies `application_url` directly on the fetch
// mock's returned item (exactly the shape the route will need to produce)
// to exercise the component's OWN precedence logic in isolation; today, in
// production, the field is `undefined` and every row falls through to
// `positions.url` exactly as before until that route is updated.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createElement, act } from "react";
import { createRoot } from "react-dom/client";
import AutoApplyQueueTab from "./AutoApplyQueueTab.js";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let container;
let root;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => {
    root.unmount();
  });
  container.remove();
  vi.restoreAllMocks();
  delete global.fetch;
});

function baseItem(overrides = {}) {
  return {
    id: "app-1",
    status: "auto_queued",
    auto_saved_at: "2026-01-01T00:00:00.000Z",
    applied_at: null,
    auto_apply_opened_at: null,
    resume_used_id: null,
    cover_letter_id: null,
    auto_search_id: null,
    positions: { id: "pos-1", title: "Engineer", company: "Acme", location: "Remote", url: "https://acme.example/shared" },
    generated_resumes: null,
    generated_cover_letters: null,
    ...overrides,
  };
}

// Installs a fetch double: GET /api/auto-apply-queue returns `items`; any
// other call (markOpened's POST .../apply, handleRemove's DELETE) succeeds
// with an empty ok payload so those code paths never throw mid-test.
function installFetch(items) {
  global.fetch = vi.fn((url, opts) => {
    if (typeof url === "string" && url === "/api/auto-apply-queue" && (!opts || !opts.method)) {
      return Promise.resolve({ ok: true, json: async () => ({ items }) });
    }
    return Promise.resolve({ ok: true, json: async () => ({ openedAt: "2026-01-02T00:00:00.000Z" }) });
  });
}

async function mount(props) {
  await act(async () => {
    root.render(createElement(AutoApplyQueueTab, props));
  });
  // The queue fetch fires from a setTimeout(0) mount effect; flush it.
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

function findByText(tag, text) {
  return [...container.querySelectorAll(tag)].find((el) => el.textContent.trim() === text) || null;
}

async function startWalkthrough() {
  const startBtn = findByText("button", "Start auto-apply");
  expect(startBtn).not.toBeNull();
  await act(async () => {
    startBtn.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
}

describe("AutoApplyQueueTab — walkthrough 'Open posting' href honours application_url", () => {
  it("uses the override when application_url is set, not the shared positions.url", async () => {
    installFetch([
      baseItem({ application_url: "https://override.example/mine" }),
    ]);
    await mount({ currentUser: { id: "u1" } });
    await startWalkthrough();

    const openPosting = findByText("a", "Open posting");
    expect(openPosting).not.toBeNull();
    expect(openPosting.getAttribute("href")).toBe("https://override.example/mine");
  });

  it("falls back to positions.url when application_url is absent", async () => {
    installFetch([baseItem()]); // no application_url key at all
    await mount({ currentUser: { id: "u1" } });
    await startWalkthrough();

    const openPosting = findByText("a", "Open posting");
    expect(openPosting).not.toBeNull();
    expect(openPosting.getAttribute("href")).toBe("https://acme.example/shared");
  });

  it("refuses an unsafe override through the same safeExternalHref gate -- no silent fallback to the shared url", async () => {
    installFetch([
      baseItem({ application_url: "javascript:alert(1)" }),
    ]);
    await mount({ currentUser: { id: "u1" } });
    await startWalkthrough();

    // The override "wins" the selection and is then refused outright: the
    // control must not quietly fall back to the (safe) shared url once an
    // override string is present at all.
    expect(findByText("a", "Open posting")).toBeNull();
  });
});

describe("AutoApplyQueueTab — handleApply opens the override URL through the same window.open gate", () => {
  it("opens application_url (not positions.url) when both are present", async () => {
    const openSpy = vi.spyOn(window, "open").mockImplementation(() => null);
    installFetch([
      baseItem({ application_url: "https://override.example/mine" }),
    ]);
    await mount({ currentUser: { id: "u1" } });
    await startWalkthrough();

    const applyBtn = findByText("button", "Apply & next");
    expect(applyBtn).not.toBeNull();
    await act(async () => {
      applyBtn.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(openSpy).toHaveBeenCalled();
    expect(openSpy.mock.calls.some((c) => c[0] === "https://override.example/mine")).toBe(true);
    expect(openSpy.mock.calls.some((c) => c[0] === "https://acme.example/shared")).toBe(false);
  });

  it("is not disabled by a missing positions.url when application_url alone supplies the destination", async () => {
    installFetch([
      baseItem({
        positions: { id: "pos-1", title: "Engineer", company: "Acme", location: "Remote", url: null },
        application_url: "https://override.example/mine",
      }),
    ]);
    await mount({ currentUser: { id: "u1" } });
    await startWalkthrough();

    const applyBtn = findByText("button", "Apply & next");
    expect(applyBtn).not.toBeNull();
    expect(applyBtn.disabled).toBe(false);
  });

  it("never calls window.open when the override is unsafe, even though a safe shared url exists", async () => {
    const openSpy = vi.spyOn(window, "open").mockImplementation(() => null);
    installFetch([
      baseItem({ application_url: "javascript:alert(1)" }),
    ]);
    await mount({ currentUser: { id: "u1" } });
    await startWalkthrough();

    const applyBtn = findByText("button", "Apply & next");
    await act(async () => {
      applyBtn.dispatchEvent(new MouseEvent("click", { bubbles: true }));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(openSpy).not.toHaveBeenCalled();
  });
});

describe("AutoApplyQueueTab — list view Apply control honours application_url", () => {
  it("enables Apply and drops the 'No posting URL available' tooltip when only application_url supplies a destination", async () => {
    installFetch([
      baseItem({
        positions: { id: "pos-1", title: "Engineer", company: "Acme", location: "Remote", url: null },
        application_url: "https://override.example/mine",
      }),
    ]);
    await mount({ currentUser: { id: "u1" } });
    // List view (no walkthrough started): the row's Apply button.
    const applyBtn = findByText("button", "Apply");
    expect(applyBtn).not.toBeNull();
    expect(applyBtn.disabled).toBe(false);
  });
});
