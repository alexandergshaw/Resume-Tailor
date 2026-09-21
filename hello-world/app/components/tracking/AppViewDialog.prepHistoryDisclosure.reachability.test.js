// @vitest-environment jsdom
//
// ---------------------------------------------------------------------------
// N50 TDD RED hand-off -- H-8 (plan.r2.md R2, PL-N50.19): revision history is
// ONE step removed, and never further (AC-N50.8's reachability half), measured
// in the real dialog with real clicks and the visibility of what a click
// reveals. Plus the dialog-mounted half of AC-N50.5 (the outline starts at the
// dialog title's h2 and steps to the panel's h3s).
// ---------------------------------------------------------------------------
//
// WHY A NEW REACHABILITY TEST (plan T2): the landed
// AppViewDialog.prepRestore.reachability.test.js `openHistory` returns 0 the
// moment any restore control EXISTS in the DOM, and <details> keeps closed
// content mounted -- so that helper can no longer tell "one click away" from
// "unreachable". This file counts the activations it spends AND asserts the
// controls are visible after them, under both first-paint helpers separately.
//
// RED ON HEAD: all restore controls are visible without any click, so the
// zero-visible half fails; there is no disclosure control to activate.
//
// MUTANTS THIS FILE KILLS (4b reference run): a <details> with no <summary>
// (history unreachable); the hide rule written without `:not([open])` (the
// rows stay hidden after the click -- D2, the real-browser defect).

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createElement, act } from "react";
import { createRoot } from "react-dom/client";
import AppViewDialog from "../AppViewDialog.js";
import { maximalGetResponse } from "@/test/helpers/prepMaximalFixture.js";
import {
  norm,
  visibleText,
  collapsedBehindAControl,
  hiddenByAncestry,
  controlName,
  headingElements,
  headingLevel,
} from "@/test/helpers/prepPanelInstruments.js";
import { freshAppId, dialogProps, jsonResponse, flush, click, mutations, allControls, LABELS } from "@/test/helpers/prepDialogHarness.js";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let container;
let root;
beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
});

// aboutYou: three revisions, the newest live -> two restorable. whyRole: one
// revision and it is live -> nothing to restore, so NO disclosure (the
// over-fire control). Built on the shared maximal GET so the join is the real
// response shape.
function getBody() {
  const rev = (revision, restoredFrom = null) => ({ revision, engine: "gemini", restoredFrom, createdAt: `2026-09-0${revision}T00:00:00.000Z` });
  return maximalGetResponse({
    sectionRevisions: { aboutYou: [rev(3), rev(2, 1), rev(1)], whyRole: [rev(1)], askThem: [rev(2), rev(1)], stages: [rev(2), rev(1)] },
    liveRevisions: { aboutYou: 3, whyRole: 1, askThem: 2, stages: 2 },
  });
}

async function mount(id) {
  const f = vi.fn((url, init) => Promise.resolve(jsonResponse(!init || !init.method ? getBody() : { status: "restored" })));
  vi.stubGlobal("fetch", f);
  await act(async () => root.render(createElement(AppViewDialog, dialogProps(id))));
  await flush();
  return f;
}

const dialogContent = () => document.body.querySelector(".MuiDialogContent-root");
const restoreControls = (section) =>
  [...document.body.querySelectorAll("button")].filter((b) => /^restore\b/i.test(controlName(b)) && controlName(b).includes(LABELS[section]));
const disclosureFor = (section) =>
  allControls().filter((n) => controlName(n).includes(LABELS[section]) && /version|history|earlier|previous/i.test(controlName(n)) && !/^restore\b/i.test(controlName(n)));

describe("H-8 -- a section's restore controls: hidden on first paint, ONE real activation away, and then really usable", () => {
  it("[first paint, visibleText alone] no restore control or restore row is in the text a reader sees", async () => {
    await mount(freshAppId("h8a"));
    const scope = dialogContent();
    expect(scope, "harness: the dialog content did not mount").toBeTruthy();
    expect(restoreControls("aboutYou"), "positive control: the controls are MOUNTED (hidden, not removed)").toHaveLength(2);
    const seen = norm(visibleText(scope));
    expect(seen).not.toMatch(/(earlier|restored) version \d+/i);
    expect(seen).not.toMatch(/\bRestore\b/);
  });

  it("[first paint, collapsedBehindAControl alone] every restore control sits behind a collapsed control", async () => {
    await mount(freshAppId("h8b"));
    const scope = dialogContent();
    const all = Object.keys(LABELS).flatMap(restoreControls);
    expect(all.length).toBeGreaterThan(0);
    expect(all.filter((c) => !collapsedBehindAControl(c, scope)).map(controlName)).toEqual([]);
  });

  it("exactly ONE real click on the control named for the section's history reveals ALL of that section's restore controls", async () => {
    await mount(freshAppId("h8c"));
    const scope = dialogContent();
    const disclosures = disclosureFor("aboutYou");
    expect(disclosures.map(controlName), "exactly one history control per section").toHaveLength(1);
    await click(disclosures[0]);
    await flush(2);
    const controls = restoreControls("aboutYou");
    expect(controls).toHaveLength(2);
    for (const c of controls) {
      expect(collapsedBehindAControl(c, scope), `${controlName(c)} still collapsed after one activation`).toBe(false);
      // hiddenByAncestry, not visibleText(c): a hide rule written without
      // `:not([open])` hides the rows' WRAPPER even once the disclosure is
      // open, and visibleText(c) never looks up (D2, the real-browser defect).
      expect(hiddenByAncestry(c, scope), `${controlName(c)} still hidden after one activation`).toBe(false);
    }
    expect(norm(visibleText(scope)), "the revealed rows are in the text a reader now sees").toMatch(/(earlier|restored) version \d+/i);
    // ...and ONLY that section's: another section's history stays closed.
    expect(restoreControls("stages").every((c) => collapsedBehindAControl(c, scope))).toBe(true);
  });

  it("then ONE real click on a revealed restore control issues exactly one PATCH {applicationId, section, revision}", async () => {
    const id = freshAppId("h8d");
    const f = await mount(id);
    const disclosure = disclosureFor("aboutYou")[0];
    expect(disclosure, "no history control for Tell me about yourself").toBeTruthy();
    await click(disclosure);
    await flush(2);
    const target = restoreControls("aboutYou").find((c) => /version 1$/.test(controlName(c)));
    expect(target, "no restore control for revision 1").toBeTruthy();
    await click(target);
    await flush(8);
    expect(mutations(f).map((m) => [m.method, m.body])).toEqual([["PATCH", { applicationId: id, section: "aboutYou", revision: 1 }]]);
  });

  it("[over-fire control] a section whose only revision is live renders NO history disclosure and no restore control", async () => {
    await mount(freshAppId("h8e"));
    expect(disclosureFor("aboutYou"), "positive control: a section WITH history has its disclosure").toHaveLength(1);
    expect(disclosureFor("whyRole").map(controlName)).toEqual([]);
    expect(restoreControls("whyRole")).toEqual([]);
  });
});

describe("AC-N50.5, dialog-mounted half -- the outline starts at the dialog title and steps down one level", () => {
  it("the dialog title is the ONLY h2, and the first heading inside the panel is an h3 (h2 -> h3, no skip)", async () => {
    // RED ON HEAD only through the panel's own outline (see
    // PrepPackPanel.hierarchy.test.js H-3); this half is a GUARD on HEAD.
    await mount(freshAppId("h8f"));
    const dialog = document.body.querySelector('[role="dialog"]');
    expect(dialog, "harness: no dialog").toBeTruthy();
    const all = headingElements(dialog);
    const h2s = all.filter((h) => headingLevel(h) === 2);
    expect(h2s).toHaveLength(1);
    expect(h2s[0].closest(".MuiDialogTitle-root") || h2s[0].classList.contains("MuiDialogTitle-root")).toBeTruthy();
    const inPanel = headingElements(dialogContent());
    expect(inPanel.length).toBeGreaterThan(0);
    expect(headingLevel(inPanel[0])).toBe(3);
    expect(all.indexOf(h2s[0])).toBe(0);
  });
});
