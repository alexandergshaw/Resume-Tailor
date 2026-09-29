// @vitest-environment jsdom
//
// N92 Wave 2 (Control C) -- the forward-preference TOGGLE, REACHED THE WAY A
// HUMAN REACHES IT. AC-C5 (turn-off-able / not one-way) and the brief's "with a
// toggle UI" + reachability rule. This repo has shipped a panel with no opening
// button past 14,000 green tests, so reachability is a first-class assertion, not
// a source scan: the test renders the REAL SettingsMenu (the gear the app chrome
// mounts), opens it with a real click, and drives the forward toggle inside the
// opened popover. A control that exists as a component but is never mounted in
// the menu -- the "panel with no button" defect -- leaves these tests RED.
//
// It pins the halves the criterion names:
//   * REACHABLE : the "Cover letter facts" section contains a forward toggle.
//   * WRITE      : turning it ON PUTs coverFactForward:true to /api/user-prefs.
//   * REVERSIBLE : turning it OFF again PUTs coverFactForward:false (N82: false
//     is not swallowed as "no preference").
//   * SEED       : a fresh mount reads the stored value back via GET and shows
//     the toggle ON, so the choice survives a reload.
//
// RED ON HEAD (93afb75): SettingsMenu's "Cover letter facts" section has only the
// placement Select today; there is no forward toggle, so it is not found in the
// opened popover.
//
// Harness mirrors CoverFactPlacementSetting.rc.test.js. The existing
// AlertMailPause Switch ("Pause all job-alert emails") is also in the popover, so
// the toggle is located by its label matching /forward/i -- never "the only
// switch" (there are two).

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createElement, act } from "react";
import { createRoot } from "react-dom/client";

vi.mock("../../lib/supabase/client", () => ({ createClient: vi.fn() }));

import { createClient } from "../../lib/supabase/client";
import SettingsMenu from "./SettingsMenu.js";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let container;
let root;
let putBodies;
let getPrefs;

function installFetch() {
  global.fetch = vi.fn(async (url, init = {}) => {
    const u = String(url);
    const method = (init.method || "GET").toUpperCase();
    if (u.includes("/api/user-prefs")) {
      if (method === "GET") return { ok: true, json: async () => ({ prefs: getPrefs }) };
      const body = init.body ? JSON.parse(init.body) : {};
      putBodies.push(body);
      return { ok: true, json: async () => ({ ok: true, prefs: { ...getPrefs, ...(body.prefs || {}) } }) };
    }
    if (u.includes("/api/gmail/status")) return { ok: true, json: async () => ({ connected: false }) };
    if (u.includes("/api/drive/status")) return { ok: true, json: async () => ({ connected: false, configured: true }) };
    return { ok: true, json: async () => ({}) };
  });
}

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  putBodies = [];
  getPrefs = {};
  createClient.mockReset();
  createClient.mockReturnValue({
    auth: {
      getUser: vi.fn(() => Promise.resolve({ data: { user: null } })),
      onAuthStateChange: vi.fn(() => ({ data: { subscription: { unsubscribe: vi.fn() } } })),
    },
  });
  installFetch();
});

afterEach(async () => {
  if (root) await act(async () => root.unmount());
  if (container) container.remove();
  delete global.fetch;
  vi.restoreAllMocks();
});

async function settle() {
  for (let i = 0; i < 6; i += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
  }
}

async function openSettings() {
  await act(async () => {
    root.render(createElement(SettingsMenu));
  });
  await settle();
  const gear = container.querySelector('[aria-label="Settings"]');
  expect(gear, "no [aria-label=Settings] gear rendered -- harness broken").toBeTruthy();
  gear.focus();
  await act(async () => {
    gear.dispatchEvent(new MouseEvent("click", { bubbles: true }));
  });
  await settle();
}

// The forward toggle: a checkbox/switch whose label mentions "forward". The
// AlertMailPause switch ("Pause all job-alert emails") does not match, so this
// never collides with it.
function forwardToggle() {
  const inputs = [...document.body.querySelectorAll('input[type="checkbox"], [role="switch"]')];
  return (
    inputs.find((el) => {
      const label = el.closest("label");
      const name = (el.getAttribute("aria-label") || label?.textContent || "").toLowerCase();
      return /forward/.test(name);
    }) || null
  );
}

describe("harness / reachability control", () => {
  it("the real gear opens a popover with the known Cover-letter-facts section (proves the harness renders the menu)", async () => {
    await openSettings();
    const labels = [...document.body.querySelectorAll("*")]
      .filter((el) => el.children.length === 0)
      .map((el) => (el.textContent || "").trim());
    expect(labels, "the settings popover did not render its known sections -- harness broken").toContain("Cover letter facts");
  });
});

describe("AC-C5 the forward toggle is discoverable in the settings menu (reachability, RED on HEAD)", () => {
  it("renders a forward toggle inside the opened Cover-letter-facts section", async () => {
    await openSettings();
    const text = document.body.textContent || "";
    expect(
      /forward/i.test(text),
      "no forward-positioning label in the settings menu -- the toggle is not discoverable",
    ).toBe(true);
    expect(
      forwardToggle(),
      "no forward toggle rendered inside the opened settings popover (the control may exist but not be mounted in the menu -- the 'panel with no button' defect)",
    ).toBeTruthy();
  });
});

describe("AC-C5 turning the toggle on then off writes true then false (WRITE + REVERSIBLE, RED on HEAD)", () => {
  it("ON PUTs coverFactForward:true and OFF PUTs coverFactForward:false", async () => {
    await openSettings();
    const toggle = forwardToggle();
    expect(toggle, "no forward toggle to drive").toBeTruthy();

    // Turn ON (starts unchecked -- getPrefs empty).
    await act(async () => {
      toggle.click();
    });
    await settle();
    let forwardPuts = putBodies.filter((b) => b?.prefs && "coverFactForward" in b.prefs);
    expect(forwardPuts.length, "turning the toggle on did not PUT coverFactForward").toBeGreaterThan(0);
    expect(forwardPuts[forwardPuts.length - 1].prefs.coverFactForward, "turning it on wrote a non-true value").toBe(true);

    // Turn OFF again -- false must be written, not swallowed (N82).
    const onToggle = forwardToggle();
    await act(async () => {
      onToggle.click();
    });
    await settle();
    forwardPuts = putBodies.filter((b) => b?.prefs && "coverFactForward" in b.prefs);
    expect(
      forwardPuts[forwardPuts.length - 1].prefs.coverFactForward,
      "turning the toggle off did not PUT false -- the toggle is one-way (the N82 defect)",
    ).toBe(false);
  });

  it("CONTROL: the value written is a boolean, never a string/label/ghost", async () => {
    await openSettings();
    const toggle = forwardToggle();
    if (!toggle) return; // RED already reported by the reachability test above
    await act(async () => {
      toggle.click();
    });
    await settle();
    const last = putBodies.filter((b) => b?.prefs && "coverFactForward" in b.prefs).pop();
    if (last) expect(typeof last.prefs.coverFactForward).toBe("boolean");
  });
});

describe("AC-C5 a fresh mount is seeded from GET, so the choice survives a reload (SEED, RED on HEAD)", () => {
  it("shows the toggle ON when the store already holds coverFactForward:true", async () => {
    getPrefs = { coverFactForward: true };
    await openSettings();
    const toggle = forwardToggle();
    expect(toggle, "no forward toggle to seed").toBeTruthy();
    expect(
      toggle.checked,
      "the forward toggle did not seed from the stored value on a fresh mount -- the choice would not survive a reload",
    ).toBe(true);
  });

  it("shows the toggle OFF when nothing is stored (default-safe)", async () => {
    getPrefs = {};
    await openSettings();
    const toggle = forwardToggle();
    if (!toggle) return; // reachability RED reported elsewhere
    expect(toggle.checked, "the forward toggle defaulted to ON with no stored preference (unsafe default)").toBe(false);
  });
});
