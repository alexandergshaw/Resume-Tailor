// @vitest-environment jsdom
//
// N60 S6 (4b/TDD) -- AC-E4: THE CONTROL EXISTS AND IS WIRED. This repo's
// recurring defect is a complete mechanism whose last hop to the user is
// missing (six times in this project, twice in this chunk). A reachability test
// is not a source scan: it MOUNTS THE REAL SHELL (SettingsMenu, exactly as
// ActivityLogButton.test.js does at :153), opens it the way a human does, finds
// the pause control, and CLICKS IT -- and asserts the click persists the pause
// through the real network write. A pause nothing can switch fails here.
//
// It also counts the click path: two actions from the shell (open Settings,
// flip the control), with NO confirmation dialog -- AC-E4's "at most two
// actions" and its non-destructive, one-action-to-toggle shape.
//
// RED on HEAD: no AlertMailPause control is rendered anywhere in the shell, so
// the finder returns null. The "Settings opened" assertion proves the mount and
// popover work, so the missing control is a real absence -- not a broken mount.
//
// NON-VACUITY: before the click no PUT has fired; the control's presence and the
// PUT are the two things a wired control must have and an unwired one lacks.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createElement, act } from "react";
import { createRoot } from "react-dom/client";

vi.mock("@/lib/document/download.js", () => ({ triggerBlobDownload: vi.fn() }));
vi.mock("../../lib/supabase/client", () => ({ createClient: vi.fn() }));

import { createClient } from "../../lib/supabase/client";
import SettingsMenu from "./SettingsMenu.js";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let container;
let root;
let putCalls;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);

  createClient.mockReset();
  createClient.mockReturnValue({
    auth: {
      getUser: vi.fn(() => Promise.resolve({ data: { user: { id: "user-1", email: "me@example.com" } } })),
      onAuthStateChange: vi.fn(() => ({ data: { subscription: { unsubscribe: vi.fn() } } })),
    },
  });

  putCalls = [];
  global.fetch = vi.fn((url, opts = {}) => {
    const u = String(url);
    const method = (opts.method || "GET").toUpperCase();
    if (u.includes("/api/alerts/pause") && method === "PUT") {
      let body = {};
      try {
        body = JSON.parse(opts.body);
      } catch {
        /* ignore */
      }
      putCalls.push({ url: u, method, body });
      return Promise.resolve({ ok: true, status: 200, json: async () => ({ ok: true, alertsPaused: !!body.paused }) });
    }
    // The control's initial-state read (and the S5 status surface).
    if (u.includes("/api/alerts")) {
      return Promise.resolve({ ok: true, status: 200, json: async () => ({ emailConfigured: true, reason: null, alertsPaused: false }) });
    }
    if (u === "/api/gmail/status") return Promise.resolve({ ok: true, status: 200, json: async () => ({ connected: false }) });
    if (u === "/api/drive/status") return Promise.resolve({ ok: true, status: 200, json: async () => ({ connected: false, configured: true }) });
    return Promise.resolve({ ok: true, status: 200, json: async () => ({}) });
  });
});

afterEach(async () => {
  await act(async () => {
    root.unmount();
  });
  container.remove();
  delete global.fetch;
  vi.restoreAllMocks();
});

async function settle() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

async function openSettings() {
  await act(async () => {
    root.render(createElement(SettingsMenu));
  });
  const gear = container.querySelector('[aria-label="Settings"]');
  expect(gear, "no Settings gear rendered -- shell did not mount").toBeTruthy();
  gear.focus();
  await act(async () => {
    gear.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
  await settle();
}

// A reachability finder, deliberately structural: it names no prop and no exact
// label -- it asks whether the shell renders a control whose accessible name
// says it pauses email/job alerts. "pause" appears nowhere else in the popover,
// so it is the discriminator.
function findPauseControl() {
  const nodes = [...document.body.querySelectorAll('input[type="checkbox"], [role="switch"], button')];
  for (const el of nodes) {
    const aria = el.getAttribute("aria-label") || "";
    const label = el.closest("label");
    const labelText = label ? label.textContent || "" : "";
    const name = `${aria} ${labelText} ${el.textContent || ""}`;
    if (/pause/i.test(name) && /(alert|email|job)/i.test(name)) {
      const input = label ? label.querySelector('input[type="checkbox"]') : null;
      return input || el;
    }
  }
  return null;
}

describe("the account-level alert-mail pause is reachable and wired (AC-E4)", () => {
  it("Settings opens and renders the Account area (proves the mount, so a missing pause control is a real absence)", async () => {
    await openSettings();
    expect(document.body.textContent).toContain("Account");
  });

  it("renders a pause control reachable in the settings menu [RED on HEAD]", async () => {
    await openSettings();
    const control = findPauseControl();
    expect(control, "no account-level alert-mail pause control found in the shell").toBeTruthy();
  });

  it("flipping the control persists the pause via PUT /api/alerts/pause, in TWO actions and no dialog [RED on HEAD]", async () => {
    await openSettings();
    const control = findPauseControl();
    expect(control, "no pause control to click").toBeTruthy();

    // Non-vacuity: nothing persisted before the toggle.
    expect(putCalls).toHaveLength(0);
    const dialogsBefore = document.body.querySelectorAll('[role="dialog"]').length;

    await act(async () => {
      control.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    });
    await settle();

    // Action 1 = open Settings, Action 2 = flip the control. The flip itself
    // wrote the pause -- no confirmation step (non-destructive; one action off).
    expect(document.body.querySelectorAll('[role="dialog"]').length).toBe(dialogsBefore);

    const puts = putCalls.filter((c) => c.url.includes("/api/alerts/pause"));
    expect(puts.length, "flipping the control issued no PUT to /api/alerts/pause").toBeGreaterThanOrEqual(1);
    expect(puts[0].body.paused).toBe(true);
  });
});
