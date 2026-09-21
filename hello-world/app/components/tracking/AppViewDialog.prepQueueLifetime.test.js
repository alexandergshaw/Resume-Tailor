// @vitest-environment jsdom
//
// ---------------------------------------------------------------------------
// N50 (N53) TDD RED hand-off -- the queue's LIFETIME: it must outlive the
// dialog (a main-tab switch unmounts AppViewDialog; closing the dialog does
// not), and an outcome must live exactly long enough to be SEEN.
// plan.r2.md section 3.1-3.4 and section 6 file 4: Q-6b (R4b), Q-7 (R8),
// L-1, L-2, L-4 (R20, each plain and under <StrictMode>), L-3 (R7).
// Specified exactly as the plan's measured probe
// (<scratchpad>/chunks/N50/r2/evidence/AppViewDialog.r2probe.test.js), with
// the shared maximal GET body in place of the probe's local one.
// ---------------------------------------------------------------------------
//
// WHY THESE ARE THEIR OWN FILE: each case is about what survives an UNMOUNT
// or a CLOSE, so each drives the real dialog through one -- a remount with
// `root.unmount()` + `createRoot()` (what page.js:2739's main-tab switch
// does to TrackingTab and therefore to this dialog), or a re-render with
// `appDialog: {open:false}` (what the dialog's own Close button writes).
//
// RED ON HEAD:
//   * Q-6b: HEAD sends C at once (no queue at all).
//   * Q-7: HEAD's post-action refetch dies with the unmounted instance, so
//     the remounted dialog never shows the post-action body.
//   * L-1/L-2/L-4: HEAD reports a section refusal at the panel foot (L-2/L-4
//     use a whole-pack refusal, so their "shown" half is green on HEAD); what
//     is red is L-2's and L-4's first half -- HEAD's prepMessageById is React
//     state of the instance that clicked, so an outcome that settles while
//     the dialog is closed or unmounted is either dropped or never recorded.
//     Each case's own comment says which half is red.
//
// THE MUTANTS THESE KILL (all executed against the plan's build and re-run by
// the 4b seat against its reference): M-A, a per-instance store, fails Q-6b,
// Q-7 and L-4; M-B, the settled handler never registered, fails Q-7; ML-1,
// `dropSeenOutcomes` a no-op, fails L-1 and L-2; ML-2, every outcome dropped
// on a fresh open, fails L-2 and L-4.
//
// KNOWN EQUIVALENT MUTANT, recorded rather than hidden: ML-3 (the fresh-open
// drop moved into an unguarded [open, id] effect) survives everything here.
// StrictMode double-invokes effects only on FIRST mount, when the panel is
// not yet shown, so no test can distinguish the two placements (plan 5.1).
//
// HYGIENE: a fresh application id per case; every deferred released.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createElement, act, StrictMode } from "react";
import { createRoot } from "react-dom/client";
import AppViewDialog from "../AppViewDialog.js";
import { maximalGetResponse } from "@/test/helpers/prepMaximalFixture.js";
import { norm } from "@/test/helpers/prepPanelInstruments.js";
import {
  freshAppId,
  dialogProps,
  jsonResponse,
  deferred,
  flush,
  click,
  mutations,
  sectionRegenerateControl,
  wholePackRegenerateControl,
} from "@/test/helpers/prepDialogHarness.js";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let container;
let root;
let strict = false;
beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(async () => {
  try {
    await act(async () => root.unmount());
  } catch {
    // already unmounted by the case itself
  }
  container.remove();
  vi.unstubAllGlobals();
  strict = false;
});

async function render(id, open = true) {
  const el = createElement(AppViewDialog, dialogProps(id, { open }));
  await act(async () => root.render(strict ? createElement(StrictMode, null, el) : el));
  await flush();
}
async function remount() {
  await act(async () => root.unmount());
  root = createRoot(container);
}

/** The maximal GET body with a MARKER as the first aboutYou line, so a case
 *  can tell which GET the panel is showing. */
function markedGet(marker) {
  const body = maximalGetResponse();
  body.pack.sections.aboutYou.answer.lines[0].text = `${marker} -- the first aboutYou line.`;
  return body;
}
const sectionsOf = (f) => mutations(f).map((m) => m.body.section || "pack");
const alertText = () => [...document.body.querySelectorAll('[role="alert"]')].map((n) => norm(n.textContent)).join(" | ");
const DISABLED = /isn't available/;

/** aboutYou POSTs are held on `gate`; everything else answers `other`. */
function stub(gate, other = { status: "disabled" }) {
  const f = vi.fn((url, init) => {
    if (!init || !init.method) return Promise.resolve(jsonResponse(markedGet("BASE_MARKER")));
    const body = JSON.parse(init.body);
    if (body.section === "aboutYou") return gate.then(() => jsonResponse({ status: "ready", section: "aboutYou" }));
    return Promise.resolve(jsonResponse(other));
  });
  vi.stubGlobal("fetch", f);
  return f;
}

describe("Q-6b (R4b) -- a remounted dialog still sees the old instance's action as outstanding", () => {
  it("click A (held), unmount, remount, click C: no second request while A is outstanding", async () => {
    // Kills M-A (a store per hook instance): its remount starts empty, shows
    // every control idle, and sends C at once -- which the server answers 409
    // in-flight after spending a rate-limit token.
    const id = freshAppId("q6b");
    const a = deferred();
    const f = stub(a.promise, { status: "ready" });
    await render(id);
    await click(sectionRegenerateControl("aboutYou"));
    await flush();
    try {
      expect(sectionsOf(f), "positive control: A was sent").toEqual(["aboutYou"]);
      await remount();
      await render(id);
      const c = sectionRegenerateControl("stages");
      expect(c, "the remounted dialog must still offer an idle section's control").toBeTruthy();
      await click(c);
      await flush();
      expect(sectionsOf(f)).toEqual(["aboutYou"]);
    } finally {
      a.resolve();
      await flush(15);
    }
    expect(sectionsOf(f), "C, accepted while A was outstanding, goes once A settles").toEqual(["aboutYou", "stages"]);
  });
});

describe("Q-7 (R8) -- the refetch after an action reaches whichever dialog instance is mounted when it settles", () => {
  it("remount while A is outstanding, resolve A: the NEW instance renders the post-action body", async () => {
    // The GET stub returns the post-action marker ONLY for a GET issued after
    // A's POST resolved (a flag set inside A's reply), never by GET ordinal:
    // the remount's own mount-effect GET is the second GET, and an ordinal
    // marker would let a build with no settled handler pass (plan M2).
    const id = freshAppId("q7");
    const a = deferred();
    let aSettled = false;
    const f = vi.fn((url, init) => {
      if (!init || !init.method) return Promise.resolve(jsonResponse(markedGet(aSettled ? "POST_ACTION_MARKER" : "BASE_MARKER")));
      return a.promise.then(() => {
        aSettled = true;
        return jsonResponse({ status: "ready", section: "aboutYou" });
      });
    });
    vi.stubGlobal("fetch", f);
    await render(id);
    await click(sectionRegenerateControl("aboutYou"));
    await flush();
    await remount();
    await render(id);
    try {
      expect(document.body.textContent, "positive control: the remount shows the pre-action body").toContain("BASE_MARKER");
      expect(document.body.textContent).not.toContain("POST_ACTION_MARKER");
    } finally {
      a.resolve();
      await flush(15);
    }
    expect(document.body.textContent).toContain("POST_ACTION_MARKER");
  });
});

describe("outcome lifetime (R20) -- an outcome lives until it has been SEEN, then until the next fresh open", () => {
  for (const mode of ["plain", "strict"]) {
    it(`[${mode}] L-1: an outcome shown on screen is gone after close + reopen (positive control: it rendered first)`, async () => {
      // GREEN-ish ON HEAD for the wrong reason: HEAD's message lives in the
      // instance's own state and a close does not unmount it -- so HEAD shows
      // it AGAIN after reopen and this case is RED on HEAD at its last line.
      strict = mode === "strict";
      const id = freshAppId(`L1${mode}`);
      stub(new Promise(() => {}));
      await render(id);
      await click(wholePackRegenerateControl());
      await flush();
      expect(alertText()).toMatch(DISABLED);
      await render(id, false);
      await render(id);
      expect(alertText()).not.toMatch(DISABLED);
    });

    it(`[${mode}] L-2: an outcome that settles while the dialog is CLOSED is shown on reopen, then gone after the next close + reopen`, async () => {
      // RED ON HEAD at its first send assertion: HEAD sends the whole-pack
      // click at once instead of queueing it behind A.
      strict = mode === "strict";
      const id = freshAppId(`L2${mode}`);
      const a = deferred();
      const f = stub(a.promise);
      await render(id);
      await click(sectionRegenerateControl("aboutYou"));
      await click(wholePackRegenerateControl());
      await flush();
      try {
        expect(mutations(f), "the whole-pack click must wait behind A").toHaveLength(1);
        await render(id, false);
      } finally {
        a.resolve();
        await flush(15);
      }
      expect(mutations(f), "the queued click went out while the dialog was closed").toHaveLength(2);
      await render(id);
      expect(alertText(), "an outcome nobody saw must be shown, never silently dropped").toMatch(DISABLED);
      await render(id, false);
      await render(id);
      expect(alertText()).not.toMatch(DISABLED);
    });

    it(`[${mode}] L-4: an outcome that settles while the dialog is UNMOUNTED (a main-tab switch) is shown on the remount`, async () => {
      // RED ON HEAD: the queued click was already sent (no queue), and its
      // outcome died with the unmounted instance's state. Kills M-A and ML-2.
      const id = freshAppId(`L4${mode}`);
      const a = deferred();
      const f = stub(a.promise);
      await render(id);
      await click(sectionRegenerateControl("aboutYou"));
      await click(wholePackRegenerateControl());
      await flush();
      try {
        expect(mutations(f), "the whole-pack click must wait behind A").toHaveLength(1);
        await remount();
      } finally {
        a.resolve();
        await flush(15);
      }
      expect(mutations(f)).toHaveLength(2);
      strict = mode === "strict";
      await render(id);
      expect(alertText()).toMatch(DISABLED);
    });
  }

  it("L-3: a fresh application id renders the GET body and no alert (per-file hygiene control)", async () => {
    const id = freshAppId("L3");
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(jsonResponse(markedGet("BASE_MARKER")))));
    await render(id);
    expect(document.body.textContent).toContain("BASE_MARKER");
    expect(alertText()).toBe("");
  });
});
