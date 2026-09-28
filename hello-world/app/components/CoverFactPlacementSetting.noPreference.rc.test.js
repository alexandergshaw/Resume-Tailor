// @vitest-environment jsdom
//
// N82: the cover-fact placement setting shipped WITHOUT its "no preference"
// option, so the choice is one-way. Once a candidate picks a placement there is
// no way back to "let the app decide" -- only to pin "intro" explicitly, which
// is a DIFFERENT statement (it would not follow a future change to the default).
//
// THE FIX SHAPE (from the N82 card + plan.n62A.r1.md §2, not chosen here): add a
// no-preference option as a DISTINCT value that leaves the saved default UNSET,
// so the shared `defaultPlacement || DEFAULT_PLACEMENT` fallback that every
// consumer already uses (CompanyResearchDialog.js:95/122, useCompanyResearch.js:707)
// resolves to DEFAULT_PLACEMENT. The ONLY representation that flows through that
// existing `|| DEFAULT_PLACEMENT` chain untouched is a FALSY value -- the empty
// string "" -- which is exactly what CompanyResearchDialog already defaults its
// prop to ("" == "none saved"). A non-falsy sentinel ("default"/"none") would be
// handed verbatim to weaveSources, which has no such placement, and would drop
// the fact -- so falsy is the CONTRACT, not merely one legal encoding of it.
//
// THE MAIN TRAP THIS FILE IS BUILT TO CATCH (card: "distinct value, not a
// synonym for intro"): a build that implements no-preference as an ALIAS for
// "intro" would satisfy a naive "an extra option renders" assertion and, because
// DEFAULT_PLACEMENT === "intro" today, would even produce the right paragraph
// out of the box -- while silently failing to follow any future default change.
// So this file never rests on "the option renders": it asserts the value the
// control WRITES resolves-to-default AND is not the literal default id, and that
// a no-preference state READS BACK as no-preference rather than as "Opening
// paragraph".
//
// REACHED THE WAY A HUMAN REACHES IT (this repo has shipped a panel with no
// opening button past 14,000 green tests): the test mounts the REAL SettingsMenu
// the app chrome mounts, opens it with a real gear click, and drives the real
// placement Select inside the opened popover -- never the hook or setter directly.
//
// Harness mirrors the shipped CoverFactPlacementSetting.rc.test.js (SettingsMenu
// installs the activity recorder that wraps global.fetch, so fetch is set BEFORE
// mount and the PUT capture reads through the wrapper; the Gmail/Drive status
// fetches on mount are answered). Unlike that file, the fetch mock here MERGES
// each PUT into the GET-backing store, so a fresh remount is a genuine
// PUT -> reload -> GET round trip through the real component + hook.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createElement, act } from "react";
import { createRoot } from "react-dom/client";

vi.mock("../../lib/supabase/client", () => ({ createClient: vi.fn() }));

import { createClient } from "../../lib/supabase/client";
import SettingsMenu from "./SettingsMenu.js";
import { DEFAULT_PLACEMENT, placementOptions } from "@/lib/document/coverLetterWeave.js";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

// The four concrete placement labels the shipped control already carries. The
// no-preference option is, by definition, the one whose label is none of these.
const CONCRETE_LABELS = placementOptions().map((o) => o.label);
const INTRO_LABEL = placementOptions().find((o) => o.id === DEFAULT_PLACEMENT)?.label;
// A concrete placement that is NOT the default, so selecting it is a real change
// on both HEAD (where the control is preselected to the default) and the fix.
const OTHER = placementOptions().find((o) => o.id !== DEFAULT_PLACEMENT);

let container;
let root;
let putBodies;
let store; // stands in for the (correct) route: last-writer-wins on coverFactPlacement

function installFetch() {
  global.fetch = vi.fn(async (url, init = {}) => {
    const u = String(url);
    const method = (init.method || "GET").toUpperCase();
    if (u.includes("/api/user-prefs")) {
      if (method === "GET") return { ok: true, json: async () => ({ prefs: { ...store } }) };
      const body = init.body ? JSON.parse(init.body) : {};
      putBodies.push(body);
      // Emulate a CORRECT route: merge the incoming prefs verbatim (the route's
      // own id-membership/"" acceptance is proven separately in the route test).
      if (body?.prefs && typeof body.prefs === "object") store = { ...store, ...body.prefs };
      return { ok: true, json: async () => ({ ok: true, prefs: { ...store } }) };
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
  store = {};
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

// The placement control is the only MUI Select (role=combobox) in the popover.
function placementCombobox() {
  return [...document.body.querySelectorAll('[role="combobox"]')][0] || null;
}

async function openOptions() {
  const combobox = placementCombobox();
  expect(combobox, "no placement Select in the opened settings popover").toBeTruthy();
  await act(async () => {
    combobox.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true, button: 0 }));
  });
  await settle();
  return combobox;
}

function optionEls() {
  return [...document.querySelectorAll('[role="option"]')];
}

// The no-preference option is the one whose visible label is not any of the four
// concrete placement labels. (Matched by structure, not by a hardcoded wording,
// so the implementer's exact phrasing -- "Let the app decide", "No preference",
// "Default", ... -- is free.)
function noPreferenceOption() {
  return optionEls().find((o) => !CONCRETE_LABELS.includes((o.textContent || "").trim())) || null;
}
function optionByLabel(label) {
  return optionEls().find((o) => (o.textContent || "").trim() === label) || null;
}
function lastPlacementPut() {
  return putBodies.filter((b) => b?.prefs && "coverFactPlacement" in b.prefs).pop() || null;
}

describe("N82 harness / positive control", () => {
  it("the real gear opens a popover whose placement control today carries the four concrete placements (proves the harness reaches the real control)", async () => {
    // Vacuity control: if this fails, every RED below is un-interpretable (a
    // broken harness, not a missing option). GREEN on HEAD.
    await openSettings();
    await openOptions();
    const labels = optionEls().map((o) => (o.textContent || "").trim());
    for (const concrete of CONCRETE_LABELS) {
      expect(labels, `the placement control is missing the known "${concrete}" option -- harness broken`).toContain(concrete);
    }
    expect(INTRO_LABEL, "PLACEMENTS lost its default-id label -- fixture unsound").toBeTruthy();
  });
});

describe("N82 reachability: a distinct no-preference option is offered in the real control", () => {
  it("the opened placement menu offers an option that is none of the four concrete placements (RED on HEAD: only four exist)", async () => {
    // REACHABILITY ONLY -- asserts the option is discoverable, NOT that it works
    // (that is the WRITE and reload tests below; per the brief, "the option
    // renders" is never on its own treated as coverage).
    await openSettings();
    await openOptions();
    expect(
      noPreferenceOption(),
      `no no-preference option in the placement menu; options were: ${optionEls()
        .map((o) => JSON.stringify((o.textContent || "").trim()))
        .join(", ")}`,
    ).toBeTruthy();
  });
});

describe("N82 WRITE: choosing no-preference writes a value that resolves to the default and is NOT the pinned default id (alias-killer)", () => {
  it('after pinning a concrete placement, switching to no-preference PUTs a value that (a) falls back to DEFAULT_PLACEMENT via `|| DEFAULT_PLACEMENT` and (b) is not the literal "intro" id (RED on HEAD)', async () => {
    // The real "way back" gesture: the user must first have a concrete pick
    // (otherwise the control already sits on no-preference and re-selecting it
    // fires no change). So pin a concrete option, THEN choose no-preference and
    // capture that second write.
    expect(OTHER, "PLACEMENTS has no non-default placement -- fixture unsound").toBeTruthy();
    await openSettings();
    await openOptions();
    const concrete = optionByLabel(OTHER.label);
    expect(concrete, `no "${OTHER.label}" option to pin first`).toBeTruthy();
    await act(async () => {
      concrete.click();
    });
    await settle();

    await openOptions();
    const option = noPreferenceOption();
    expect(option, "no no-preference option to choose (RED already reported by the reachability test)").toBeTruthy();
    await act(async () => {
      option.click();
    });
    await settle();

    const put = lastPlacementPut();
    expect(put, "choosing no-preference did not PUT a coverFactPlacement to /api/user-prefs").toBeTruthy();
    const written = put.prefs.coverFactPlacement;
    // (a) The consumer contract: the written value flows through the SAME
    // `defaultPlacement || DEFAULT_PLACEMENT` fallback every reader uses and
    // yields the default. An alias-for-intro build also passes this leg.
    expect(
      written || DEFAULT_PLACEMENT,
      "the no-preference value does not resolve to DEFAULT_PLACEMENT through the shared `|| DEFAULT_PLACEMENT` fallback",
    ).toBe(DEFAULT_PLACEMENT);
    // (b) ...but it must NOT be the literal default id. THIS is the alias-killer:
    // a build that stores "intro" for no-preference passes (a) and fails here,
    // and would silently stop following any future change to DEFAULT_PLACEMENT.
    expect(
      written,
      'no-preference wrote the literal default id ("intro") -- it is a synonym for pinning intro, not "let the app decide", and would not follow a future default change',
    ).not.toBe(DEFAULT_PLACEMENT);
  });

  it('CONTRAST: picking a concrete placement writes that placement id verbatim (proves the alias-killer above is discriminating, not just rejecting every write) [GREEN on HEAD]', async () => {
    // If this and the no-preference test both hold, the control genuinely emits
    // two DIFFERENT kinds of value: a concrete id for a concrete pick, and a
    // resolve-to-default falsy value for no-preference -- exactly what an alias
    // build (which emits "intro" for both) cannot do. Uses a NON-default concrete
    // option so the selection is a real change even on HEAD, where the control is
    // preselected to the default (re-selecting the default fires no onChange).
    expect(OTHER, "PLACEMENTS has no non-default placement -- fixture unsound").toBeTruthy();
    await openSettings();
    await openOptions();
    const option = optionByLabel(OTHER.label);
    expect(option, `no "${OTHER.label}" option to pin`).toBeTruthy();
    await act(async () => {
      option.click();
    });
    await settle();
    const put = lastPlacementPut();
    expect(put, "pinning a concrete placement did not PUT anything").toBeTruthy();
    expect(
      put.prefs.coverFactPlacement,
      "pinning a concrete placement did not write that placement's id",
    ).toBe(OTHER.id);
  });
});

describe("N82 reload: a no-preference state reads back as no-preference, a pinned intro reads back as intro (distinctness survives a reload)", () => {
  it("a fresh mount over an empty store shows the no-preference option, NOT the opening paragraph (RED on HEAD: control defaults to intro)", async () => {
    // Fresh candidate / just cleared: nothing stored. HEAD seeds the control to
    // DEFAULT_PLACEMENT and shows "Opening paragraph", so it cannot express "no
    // preference" at all -> RED.
    store = {};
    await openSettings();
    const combobox = placementCombobox();
    expect(combobox, "no placement control to read").toBeTruthy();
    const shown = (combobox.textContent || "").trim();
    expect(
      shown,
      "with nothing saved the control shows a concrete placement instead of no-preference -- a fresh user cannot tell 'no preference' from 'pinned'",
    ).not.toBe(INTRO_LABEL);
    expect(CONCRETE_LABELS, `with nothing saved the control shows a concrete placement (${JSON.stringify(shown)})`).not.toContain(shown);
    // ...and it must actually SHOW a no-preference label, not render blank (a
    // blank display would satisfy "not a concrete label" vacuously).
    expect(shown.length, "the control renders blank rather than a labelled no-preference option").toBeGreaterThan(0);
  });

  it('a fresh mount over a stored no-preference value ("") shows no-preference, not the opening paragraph (RED on HEAD)', async () => {
    // The persisted no-preference state (the empty-string default the route
    // keeps) must read back AS no-preference. HEAD ignores "" and stays on the
    // intro default -> RED. An alias build that stored "intro" would show
    // "Opening paragraph" here -> this leg kills it on the READ side too.
    store = { coverFactPlacement: "" };
    await openSettings();
    const combobox = placementCombobox();
    const shown = (combobox.textContent || "").trim();
    expect(shown, "a stored no-preference value read back as the opening paragraph").not.toBe(INTRO_LABEL);
    expect(CONCRETE_LABELS).not.toContain(shown);
    expect(shown.length, "the control renders blank rather than a labelled no-preference option").toBeGreaterThan(0);
  });

  it('CONTRAST: a fresh mount over a stored "intro" shows the opening paragraph (a pinned choice is distinct from no-preference on reload)', async () => {
    // GREEN on HEAD (HEAD already seeds a stored valid id). Kept as the closed
    // upper boundary: pinning intro and choosing no-preference must NOT look the
    // same after a reload. An alias build collapses these two -> this stays green
    // but the no-preference legs above go red, so the pair pins the distinction.
    store = { coverFactPlacement: DEFAULT_PLACEMENT };
    await openSettings();
    const combobox = placementCombobox();
    expect(
      (combobox.textContent || "").trim(),
      "a pinned intro did not read back as the opening paragraph",
    ).toBe(INTRO_LABEL);
  });

  it("round trip: choosing no-preference, then remounting fresh, reads back as no-preference (RED on HEAD)", async () => {
    // The full user story: pick no-preference in the real control (writes to the
    // store), then a reload (fresh mount reads the store back). It must show
    // no-preference, not the opening paragraph.
    store = { coverFactPlacement: DEFAULT_PLACEMENT }; // start pinned, to prove the "way back"
    await openSettings();
    await openOptions();
    const option = noPreferenceOption();
    expect(option, "no no-preference option to choose (RED already reported by reachability)").toBeTruthy();
    await act(async () => {
      option.click();
    });
    await settle();

    // Reload: tear down and mount a brand-new SettingsMenu over the same store.
    await act(async () => root.unmount());
    container.remove();
    container = document.createElement("div");
    document.body.appendChild(container);
    root = createRoot(container);

    await openSettings();
    const combobox = placementCombobox();
    const shown = (combobox.textContent || "").trim();
    expect(
      shown,
      "after choosing no-preference and reloading, the control fell back to a concrete placement -- the way back to 'let the app decide' did not persist",
    ).not.toBe(INTRO_LABEL);
    expect(CONCRETE_LABELS).not.toContain(shown);
    expect(shown.length, "the control renders blank rather than a labelled no-preference option").toBeGreaterThan(0);
  });
});
