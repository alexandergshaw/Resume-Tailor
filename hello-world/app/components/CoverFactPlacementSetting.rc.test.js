// @vitest-environment jsdom
//
// N62 Capability A -- AC-A3: a discoverable settings control that sets the
// per-user default, REACHED THE WAY A HUMAN REACHES IT. This repo has shipped a
// panel with no opening button past 14,000 green tests, so reachability is a
// first-class assertion here, not a source scan: the test renders the REAL
// SettingsMenu (the gear the app chrome mounts), opens it with a real click, and
// finds/drives the placement control inside the opened popover. A control that
// exists as a component but is never rendered in the menu -- the "panel with no
// button" defect -- leaves these tests RED.
//
// It pins the two halves the criterion names:
//   * WRITE: changing the control PUTs the chosen id to /api/user-prefs.
//   * SEED : a fresh mount reads the stored value back via GET and shows it,
//     so the choice survives a reload.
//
// RED ON HEAD: SettingsMenu.js has no cover-fact-placement section today, so the
// control is not found in the opened popover.
//
// Harness mirrors app/components/ActivityLogButton.test.js's "Settings > ..."
// block: SettingsMenu installs the activity recorder (which wraps global.fetch),
// so fetch is set BEFORE mount and the PUT capture reads through the wrapper;
// GmailButton/DriveButton fetch their status on mount and are answered.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createElement, act } from "react";
import { createRoot } from "react-dom/client";

vi.mock("../../lib/supabase/client", () => ({ createClient: vi.fn() }));

import { createClient } from "../../lib/supabase/client";
import SettingsMenu from "./SettingsMenu.js";
import { PLACEMENTS, placementOptions } from "@/lib/document/coverLetterWeave.js";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const CURRENT_LABEL = placementOptions().find((o) => o.id === "current")?.label;

let container;
let root;
let putBodies;
let getPrefs; // what GET /api/user-prefs returns as prefs

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

// The placement control is the only MUI Select (role=combobox) inside the
// settings popover; the Appearance control is a ToggleButtonGroup, not a Select.
function placementCombobox() {
  return [...document.body.querySelectorAll('[role="combobox"]')][0] || null;
}

describe("AC-A3 harness / reachability controls", () => {
  it("the real gear opens a popover with the known Appearance section (proves the harness renders the menu)", async () => {
    await openSettings();
    const labels = [...document.body.querySelectorAll("*")]
      .filter((el) => el.children.length === 0)
      .map((el) => (el.textContent || "").trim());
    expect(labels, "the settings popover did not render its known sections -- harness broken").toContain("Appearance");
  });
});

describe("AC-A3 the control is discoverable in the settings menu (reachability)", () => {
  it('renders a "Cover letter facts" section with a placement control inside the opened menu (RED on HEAD)', async () => {
    await openSettings();
    const labels = [...document.body.querySelectorAll("*")]
      .filter((el) => el.children.length === 0)
      .map((el) => (el.textContent || "").trim());
    expect(
      labels.some((t) => /cover letter fact/i.test(t)),
      "no cover-letter-facts section in the settings menu -- the placement control is not discoverable",
    ).toBe(true);
    expect(
      placementCombobox(),
      "no placement Select rendered inside the opened settings popover (the control component may exist but not be mounted in the menu -- the 'panel with no button' defect)",
    ).toBeTruthy();
  });
});

describe("AC-A3 changing the control writes the default via user-prefs PUT (WRITE)", () => {
  it('picking "Current role" PUTs coverFactPlacement:"current" to /api/user-prefs (RED on HEAD)', async () => {
    expect(CURRENT_LABEL, "PLACEMENTS lost its 'current' label -- fixture unsound").toBeTruthy();
    await openSettings();
    const combobox = placementCombobox();
    expect(combobox, "no placement control to change").toBeTruthy();

    await act(async () => {
      combobox.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true, button: 0 }));
    });
    await settle();
    const option = [...document.querySelectorAll('[role="option"]')].find((o) =>
      new RegExp(CURRENT_LABEL, "i").test(o.textContent || ""),
    );
    expect(
      option,
      `no "${CURRENT_LABEL}" option in the placement menu; options were: ${[...document.querySelectorAll('[role="option"]')]
        .map((o) => JSON.stringify((o.textContent || "").trim()))
        .join(", ")}`,
    ).toBeTruthy();
    await act(async () => {
      option.click();
    });
    await settle();

    const prefsPuts = putBodies.filter((b) => b?.prefs && "coverFactPlacement" in b.prefs);
    expect(prefsPuts.length, "changing the control did not PUT a coverFactPlacement to /api/user-prefs").toBeGreaterThan(0);
    // The body carries the SELECTED id, not just any PUT.
    expect(prefsPuts[prefsPuts.length - 1].prefs.coverFactPlacement).toBe("current");
  });

  it("CONTROL: the value the control writes is a real placement id, never a label or a ghost", async () => {
    // Guards against a build that PUTs the visible label ("Current role") or a
    // stale id. Only meaningful once the WRITE test above is green; kept so a
    // regression that writes the wrong token is loud.
    await openSettings();
    const combobox = placementCombobox();
    if (!combobox) return; // RED already reported by the reachability test above
    await act(async () => {
      combobox.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true, button: 0 }));
    });
    await settle();
    const option = [...document.querySelectorAll('[role="option"]')].find((o) =>
      new RegExp(CURRENT_LABEL, "i").test(o.textContent || ""),
    );
    if (!option) return;
    await act(async () => {
      option.click();
    });
    await settle();
    const last = putBodies.filter((b) => b?.prefs && "coverFactPlacement" in b.prefs).pop();
    if (last) {
      expect(PLACEMENTS.map((p) => p.id)).toContain(last.prefs.coverFactPlacement);
    }
  });
});

describe("AC-A3 a fresh mount is seeded from GET, so the choice survives a reload (SEED)", () => {
  it('shows the stored value ("why") on a fresh mount, read from /api/user-prefs GET (RED on HEAD)', async () => {
    getPrefs = { coverFactPlacement: "why" };
    const whyLabel = placementOptions().find((o) => o.id === "why")?.label;
    expect(whyLabel).toBeTruthy();
    await openSettings();
    const combobox = placementCombobox();
    expect(combobox, "no placement control to seed").toBeTruthy();
    expect(
      (combobox.textContent || "").trim(),
      "the placement control did not seed from the stored value on a fresh mount -- the choice would not survive a reload",
    ).toMatch(new RegExp(whyLabel, "i"));
  });
});
