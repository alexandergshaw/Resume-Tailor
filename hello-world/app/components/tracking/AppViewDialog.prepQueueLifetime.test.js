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
  sectionGroup,
  runningPrepGetBody,
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
// M2 (N50 fix round 1): what the real server actually returns to a GET
// issued WHILE a claim is live -- `status:"running"`, pack blanked to the
// normalized-empty shape (route.js's own GATE 9; claim_prep_pack_slot clears
// the row before any content exists). The remount fakes below used to answer
// every GET with the full, already-generated `markedGet("BASE_MARKER")` body
// regardless of whether a claim was outstanding, a state the server can
// never actually produce -- which is exactly why M2's reopen-during-a-
// section-action defect had no test catching it (verify.r1.md M2).
//
// N50 fix round 5 (line-cap extraction; verify.r5.md M-3): this file used to
// carry its OWN hand-written copy of this shape, blanking `sectionRevisions`/
// `liveRevisions`/`candidateName`/`interviewerNames` -- fields the real
// `claim_prep_pack_slot` RPC never touches -- which is the exact
// unfaithfulness verify4.md's own M-2 first raised against
// `prepDialogHarness.js`'s copy and verify.r5.md's M-3 found still
// undefended here: two answers to "what does the server return during a
// live claim", silently able to disagree. `runningPrepGetBody()` (imported
// above) is now the ONE shared answer both files use.
const runningGet = runningPrepGetBody;

// m-1 (N50 fix round 6, verify.r6.md): the alias above reads as "this file
// uses the shared body", but nothing pinned that it stays true -- verify.r6.md
// found the alias could be replaced with a divergent, hand-written copy (the
// four faithful fields blanked again, exactly the unfaithfulness verify4.md's
// own M-2 first raised) and every case in this file kept passing. A plain
// identity check closes that: it can only stay green while `runningGet` is
// genuinely `runningPrepGetBody` itself, never a look-alike local copy.
describe("canary -- the alias above is genuinely the shared fixture, not a local copy of it", () => {
  it("runningGet is runningPrepGetBody", () => {
    expect(runningGet).toBe(runningPrepGetBody);
  });
});

const sectionsOf = (f) => mutations(f).map((m) => m.body.section || "pack");
const alertText = () => [...document.body.querySelectorAll('[role="alert"]')].map((n) => norm(n.textContent)).join(" | ");
const DISABLED = /isn't available/;

/** aboutYou POSTs are held on `gate`; everything else answers `other`. A GET
 *  issued while an aboutYou POST is outstanding answers `runningGet()`
 *  (M2), never the ready body -- the fix this round makes to this shared
 *  fake, per the brief's own explicit carve-out. */
function stub(gate, other = { status: "disabled" }) {
  let aboutYouPending = false;
  const f = vi.fn((url, init) => {
    if (!init || !init.method) {
      return Promise.resolve(jsonResponse(aboutYouPending ? runningGet() : markedGet("BASE_MARKER")));
    }
    const body = JSON.parse(init.body);
    if (body.section === "aboutYou") {
      aboutYouPending = true;
      return gate.then(() => {
        aboutYouPending = false;
        return jsonResponse({ status: "ready", section: "aboutYou" });
      });
    }
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

describe("M2 (N50 fix round 1) -- reopening during a SECTION action shows the cached pack, not an apparent whole-pack wipe", () => {
  it("close then reopen while aboutYou is held: the cached content renders, aboutYou reads in progress, and the banner names aboutYou instead of claiming a whole-pack generation", async () => {
    const id = freshAppId("m2cache");
    const a = deferred();
    stub(a.promise);
    await render(id);
    await click(sectionRegenerateControl("aboutYou"));
    await flush();
    try {
      await render(id, false);
      await render(id);
      // the reopen's own GET answered `running`, empty -- exactly what the
      // real server returns while the claim is live (runningGet() above).
      // The panel must still show the cached, pre-action content: the other
      // three sections stay usable, and the banner must not claim the WHOLE
      // pack is generating.
      expect(document.body.textContent, "the reopen must show the cached pack, not an empty one").toContain("BASE_MARKER");
      expect(sectionRegenerateControl("stages"), "an idle section must stay usable off the cached content").toBeTruthy();
      expect(norm(document.body.textContent)).not.toMatch(/generating your interview prep pack now/i);
      const group = sectionGroup("aboutYou");
      expect(group, "no aboutYou group").toBeTruthy();
      expect(norm(group.textContent)).toMatch(/regenerating/i);
    } finally {
      a.resolve();
      await flush(15);
    }
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
    let actionStarted = false;
    let aSettled = false;
    // M2 (N50 fix round 1): a GET issued AFTER the POST but BEFORE it settles
    // must answer what the real server returns during a live claim --
    // `running`, pack blanked -- never the full pre-action ready body, which
    // is a state the server cannot produce while a claim is outstanding.
    const f = vi.fn((url, init) => {
      if (!init || !init.method) {
        if (aSettled) return Promise.resolve(jsonResponse(markedGet("POST_ACTION_MARKER")));
        if (actionStarted) return Promise.resolve(jsonResponse(runningGet()));
        return Promise.resolve(jsonResponse(markedGet("BASE_MARKER")));
      }
      actionStarted = true;
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

describe("m1 (N50 fix round 1) -- an outcome is marked seen only once the PREP PANEL ITSELF is shown", () => {
  it("settling while the dialog shows a DIFFERENT page (JD) does not mark the outcome seen -- it still renders once Prep is shown again", async () => {
    // Kills the mutant that marks seen on `appDialog.open` alone: that build
    // would mark this outcome seen the instant it settles (the dialog stays
    // open the whole time, just on a different page), so `dropSeenOutcomes`
    // at the next fresh open would erase it before the candidate ever saw it
    // in the Prep panel. Q05c in verify.r1.md, SURVIVED with no test.
    const id = freshAppId("m1seen");
    // The whole-pack POST is held open, and the candidate pages away from
    // Prep BEFORE it settles -- so the outcome is CREATED while the panel is
    // not shown at all, which is the case that actually discriminates the
    // Q05c mutant. (Clicking and settling in the same instant, while still
    // on Prep, would be marked seen correctly by BOTH the real code and the
    // mutant, and would prove nothing.)
    const gate = deferred();
    const f = vi.fn((url, init) => {
      if (!init || !init.method) return Promise.resolve(jsonResponse(markedGet("BASE_MARKER")));
      return gate.promise.then(() => jsonResponse({ status: "disabled" }));
    });
    vi.stubGlobal("fetch", f);
    let appDialog = { open: true, rowIndex: 0, kind: "prep" };
    const base = dialogProps(id);
    async function renderDialog() {
      await act(async () =>
        root.render(
          createElement(AppViewDialog, {
            ...base,
            appDialog,
            setAppDialog: (updater) => {
              appDialog = typeof updater === "function" ? updater(appDialog) : updater;
            },
          }),
        ),
      );
      await flush();
    }
    await renderDialog();
    await click(wholePackRegenerateControl());
    await flush();
    const previous = document.body.querySelector('button[aria-label="Previous"]');
    expect(previous, "no Previous control to page away from Prep").toBeTruthy();
    await click(previous);
    await renderDialog();
    expect(appDialog.kind, "harness sanity: the click actually paged away from Prep").toBe("jd");
    try {
      gate.resolve();
      await flush(15);
      expect(alertText(), "positive control: nothing to see on the JD page, the panel is not mounted there").toBe("");
    } finally {
      // nothing else held
    }
    // close, then reopen straight to Prep: a fresh-open drop must not have
    // already erased an outcome the candidate never actually saw.
    appDialog = { open: false, rowIndex: null, kind: "jd" };
    await renderDialog();
    appDialog = { open: true, rowIndex: 0, kind: "prep" };
    await renderDialog();
    expect(alertText()).toMatch(DISABLED);
  });
});
