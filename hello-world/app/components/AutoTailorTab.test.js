// @vitest-environment jsdom
//
// LIVE DEFECT under test: `applications.application_url` is a per-user
// override of the shared `positions.url` -- TrackingTab.js already honours
// it (`app.application_url || pos?.url`, TrackingTab.js:241,495), but the
// Auto Tailor table's "View" link and its Apply button's disabled check
// read `pos.url` raw. A user who has recorded their own application URL for
// an auto-tailored posting would still see -- and be sent to, via View --
// the shared catalogue's posting instead of the one they recorded.
//
// Fix under test: both sites now prefer `row.application_url`, falling back
// to `pos.url` (AutoTailorTab.js). The override is exactly as untrusted as
// the shared url it replaces (lib/url/safeExternalHref.js's banner: any
// signed-in account can overwrite any `positions` row, and a user-typed
// override is not more trustworthy just because it is theirs), so the
// "View" link still goes through the same safeExternalHref gate.
//
// SCOPE NOTE, load-bearing: clicking "Apply" does NOT navigate from
// anything in this file -- its onClick is entirely
// `applyAutoTailoredRow(row)`, a prop implemented in app/page.js:1763-1802,
// which reads `row?.positions?.url` raw and is NOT fixed here.
// app/page.js is outside this task's file scope (only AutoApplyQueueTab.js,
// AutoTailorTab.js and their tests are in scope), so even after this fix,
// clicking Apply still opens the shared positions.url, never the override
// -- reported, not worked around. Only the "View" link (rendered here) and
// the Apply button's disabled/enabled state (also decided here, though the
// click handler it gates is the unfixed one) are testable at this
// component's boundary.
//
// NOTE ON DATA AVAILABILITY: the loadAutoTailored query that produces
// `autoTailoredPostings` (app/page.js:1455-1464, outside this fix's file
// scope) does not select `application_url` yet. So the tests below supply
// `application_url` directly on the prop array (exactly the shape that
// query will need to produce) to exercise this component's OWN precedence
// logic in isolation; today, in production, the field is `undefined` and
// every row falls through to `pos.url` exactly as before until that query
// is updated.

import { describe, it, expect, vi, afterEach } from "vitest";
import { createElement, act } from "react";
import { createRoot } from "react-dom/client";
import AutoTailorTab from "./AutoTailorTab.js";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function row(overrides = {}) {
  return {
    id: "a1",
    tracked_at: "2026-01-01T00:00:00.000Z",
    applied_at: null,
    resume_used_id: "r1",
    positions: { company: "Acme", title: "Engineer", url: "https://acme.example/shared" },
    ...overrides,
  };
}

function baseProps(overrides = {}) {
  return {
    currentUser: { id: "u1" },
    savedSearches: [],
    setSavedSearchAutoTailor: vi.fn(),
    deleteSavedSearch: vi.fn(),
    autoTailoredLoading: false,
    autoTailoredError: null,
    autoTailoredPostings: [row()],
    applyAutoTailoredRow: vi.fn(),
    downloadAutoTailoredResume: vi.fn(async () => null),
    setAutoTailoredError: vi.fn(),
    ...overrides,
  };
}

let container;
let root;

afterEach(async () => {
  if (root) {
    await act(async () => {
      root.unmount();
    });
  }
  if (container) container.remove();
  container = null;
  root = null;
  vi.restoreAllMocks();
});

async function render(props) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root.render(createElement(AutoTailorTab, props));
  });
}

function findByText(tag, text) {
  return [...container.querySelectorAll(tag)].find((el) => el.textContent.trim() === text) || null;
}

describe("AutoTailorTab — 'View' link honours application_url", () => {
  it("uses the override when application_url is set, not the shared positions.url", async () => {
    await render(baseProps({
      autoTailoredPostings: [row({ application_url: "https://override.example/mine" })],
    }));

    const view = findByText("a", "View");
    expect(view).not.toBeNull();
    expect(view.getAttribute("href")).toBe("https://override.example/mine");
  });

  it("falls back to positions.url when application_url is absent", async () => {
    await render(baseProps({ autoTailoredPostings: [row()] })); // no application_url key

    const view = findByText("a", "View");
    expect(view).not.toBeNull();
    expect(view.getAttribute("href")).toBe("https://acme.example/shared");
  });

  it("refuses an unsafe override through the same safeExternalHref gate -- no silent fallback to the shared url", async () => {
    await render(baseProps({
      autoTailoredPostings: [row({ application_url: "javascript:alert(1)" })],
    }));

    // The override "wins" the selection and is then refused outright: must
    // not quietly fall back to the (safe) shared positions.url.
    expect(findByText("a", "View")).toBeNull();
    // The cell still degrades to the existing em-dash, never a dead link.
    const cells = [...container.querySelectorAll("td, [role='cell'], div")];
    expect(cells.some((c) => c.textContent.trim() === "—")).toBe(true);
  });
});

describe("AutoTailorTab — Apply button's enabled state honours application_url", () => {
  it("is not disabled by a missing positions.url when application_url alone supplies a destination", async () => {
    await render(baseProps({
      autoTailoredPostings: [
        row({
          positions: { company: "Acme", title: "Engineer", url: null },
          application_url: "https://override.example/mine",
        }),
      ],
    }));

    const applyBtn = findByText("button", "Apply");
    expect(applyBtn).not.toBeNull();
    expect(applyBtn.disabled).toBe(false);
  });

  it("stays disabled when neither application_url nor positions.url supplies a destination", async () => {
    await render(baseProps({
      autoTailoredPostings: [
        row({ positions: { company: "Acme", title: "Engineer", url: null } }),
      ],
    }));

    const applyBtn = findByText("button", "Apply");
    expect(applyBtn).not.toBeNull();
    expect(applyBtn.disabled).toBe(true);
  });
});
