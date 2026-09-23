// @vitest-environment jsdom
//
// ---------------------------------------------------------------------------
// N50 fix round 4 (verify4.md) -- THE INVARIANT this round's ruling adopted,
// in place of the case-by-case fixes three prior rounds each shipped and
// each saw undone by the very next reachable state: the panel must always
// offer AT LEAST ONE control that can move the generation forward, for every
// reachable combination of ITS OWN PROPS. There is no such state reachable
// through this component's own prop surface with zero controls.
//
// N50 fix round 7 (verify.r7.md minor m-1): that scope is deliberate, not an
// oversight -- this file renders `PrepPackPanel` directly (no dialog, no
// queue, no network), so it can only ever prove the invariant over states
// THIS component's own props can encode. Whether AppViewDialog.js's
// surrounding branches always reach the panel at all (pass it SOME props,
// rather than routing around it) is a separate guarantee, checked at the
// dialog level, in AppViewDialog.prepReadError.test.js's own branch sweep,
// not here.
//
// This file renders `PrepPackPanel` directly (no dialog, no queue, no
// network) across a GENERATED cross-product of the states the panel's own
// props can encode, and asserts the invariant on every one. It is the guard
// itself, not a list of cases -- a state this file's own generators produce
// is checked mechanically; nothing here hand-picks which combinations to
// look at.
// ---------------------------------------------------------------------------
//
// AXES (and why they are shaped the way they are, not a naive N^k product):
//   - pack: present / absent.
//   - whole-pack action state: idle, queued, in-flight, timed-out, failed.
//   - section action state: idle, queued, in-flight, timed-out, failed --
//     applied UNIFORMLY to all four sections at once (the rendering logic
//     treats every section symmetrically -- SECTION_LABELS is iterated the
//     same way for all four, nothing in PrepPackPanel.js/PrepSectionActions.js
//     branches on WHICH section it is), plus a SEPARATE, smaller sweep below
//     that varies exactly one section at a time to catch any asymmetry that
//     assumption would hide.
//   - revisions: present / absent.
//   - names: present / absent.
//   When `pack` is absent, no section can coherently carry its own
//   activity/outcome (a section-scoped action requires a pack to already
//   exist -- AppViewDialog.js only ever enqueues a SECTION target once one
//   does), so the section axis and the revisions axis are held at their
//   baseline (idle / absent) there rather than iterated -- a combination
//   PrepPackPanel.js could never actually be handed.
//
// COMBINATION COUNT (reported to the loop's own orchestrator, not merely
// asserted here): 5 (whole-pack) x 5 (section, pack present only) x 2
// (revisions) x 2 (names) = 100, plus 5 x 2 (names) = 10 for pack ABSENT
// (section/revisions held at baseline) = 110 for the main cross-product,
// plus 20 for the per-section-independent supplementary sweep below
// (4 sections x 5 states, everything else at baseline) = 130 for those two
// sweeps together.
// N50 fix round 7 (verify.r7.md minor m-1): later rounds (5 and 6) added
// further sweeps below this header (generating:true, hasDescription as an
// axis, the widened status axis, the disabled-control canaries) -- each
// states ITS OWN case count inline, at its own `it(...)` title, rather than
// this header keeping one running total that goes stale every time a sweep
// is added without this comment being remembered too.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createElement, act } from "react";
import { createRoot } from "react-dom/client";
import PrepPackPanel from "./PrepPackPanel.js";
import { maximalPack, maximalRevisions, maximalTrustedNames } from "@/test/helpers/prepMaximalFixture.js";
import { controlName } from "@/test/helpers/prepPanelInstruments.js";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let container;
let root;
beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

async function render(props) {
  await act(async () => root.render(createElement(PrepPackPanel, props)));
  return container;
}

const SECTIONS = ["aboutYou", "whyRole", "askThem", "stages"];
const AXIS_STATES = ["idle", "queued", "in-flight", "timed-out", "failed"];

const TIMEOUT_RESULT = Object.freeze({
  error: "No reply after a couple of minutes, so this attempt was abandoned here — it may still finish. Check back, or try again.",
  networkError: true,
  timedOut: true,
});

/** One section's `{activity, outcome}` pair for a given axis state -- `null`
 *  entries are simply omitted by the caller, matching the shape
 *  `sectionActivity`/`sectionOutcomes` already carry in production
 *  (AppViewDialog.js only ever sets a key for a target it actually knows
 *  about). */
function sectionAxis(state) {
  switch (state) {
    case "queued":
      return { activity: { state: "queued", kind: "generate", revision: null } };
    case "in-flight":
      return { activity: { state: "in-progress", kind: "generate", revision: null } };
    case "timed-out":
      return { outcome: { kind: "generate", revision: null, result: TIMEOUT_RESULT } };
    case "failed":
      return { outcome: { kind: "generate", revision: null, result: { status: "refused", reason: "error" } } };
    default:
      return {};
  }
}

/** The whole-pack half of `{generating, wholePackQueued, packTimedOut,
 *  status}` for a given axis state. `status` here is this axis's OWN
 *  opinion; `buildProps` below overrides it to `"running"` whenever the
 *  SECTION axis needs it to be, since only one `status` value exists at the
 *  server and a `running` claim (from either source) is what every one of
 *  these states actually means server-side.
 *
 *  "in-flight" is modelled as `status:"running"` with `generating:false` --
 *  a claim THIS SESSION did not start and has no known reason to attribute
 *  (an externally-triggered run, or a first open mid one), which is exactly
 *  the shape `showCheckAgain` (PrepPackPanel.js) exists to give a control
 *  to. `generating:true` -- THIS session's OWN active whole-pack claim -- is
 *  covered separately below ("N50 fix round 5") rather than folded into this
 *  axis, since PrepPackPanel.generate.test.js's own landed
 *  "[generating=true] no button is rendered AT ALL for this control" pins
 *  only that GenerateControl's own button is absent in that state, never
 *  that the panel offers NOTHING -- round 4's invariant sweep read it the
 *  other way, and verify.r5.md's own B-1 is exactly that misreading. */
function wholePackAxis(state) {
  switch (state) {
    case "queued":
      return { generating: false, wholePackQueued: true, packTimedOut: false, status: "running" };
    case "in-flight":
      return { generating: false, wholePackQueued: false, packTimedOut: false, status: "running" };
    case "timed-out":
      return { generating: false, wholePackQueued: false, packTimedOut: true, status: "running" };
    case "failed":
      return { generating: false, wholePackQueued: false, packTimedOut: false, status: "failed" };
    default:
      return { generating: false, wholePackQueued: false, packTimedOut: false, status: "ready" };
  }
}

// A `queued`/`in-flight` section state reflects the QUEUE's own current
// work -- at most one entry is ever truly active, and every queued one
// waits behind it (lib/interviewPrep/prepActionQueue.js's own single-active-
// per-application invariant), so all four sections genuinely active or
// queued AT ONCE is not a state the real product can reach. A
// `timed-out`/`failed` state is a settled OUTCOME, not current queue work --
// nothing stops two different sections each carrying their own stale
// outcome from an EARLIER, independent attempt, so applying those two
// uniformly to all four sections stays realistic. `ACTIVITY_STATES` is
// therefore applied to exactly ONE section (aboutYou) in the main
// cross-product below; the supplementary per-section sweep already covers
// each section's OWN activity independently, including every other one.
const ACTIVITY_STATES = ["queued", "in-flight"];

function buildProps({ hasPack, packState, sectionState, revisionsPresent, namesPresent }) {
  const pack = hasPack ? maximalPack() : null;
  const completeSections = hasPack ? [...SECTIONS] : [];
  const wp = wholePackAxis(packState);
  const sectionActivity = {};
  const sectionOutcomes = {};
  if (hasPack) {
    const targets = ACTIVITY_STATES.includes(sectionState) ? ["aboutYou"] : SECTIONS;
    for (const section of targets) {
      const { activity, outcome } = sectionAxis(sectionState);
      if (activity) sectionActivity[section] = activity;
      if (outcome) sectionOutcomes[section] = outcome;
    }
  }
  const sectionNeedsRunning = hasPack && ["queued", "in-flight", "timed-out"].includes(sectionState);
  const status = sectionNeedsRunning ? "running" : wp.status;
  const { sectionRevisions, liveRevisions } = hasPack && revisionsPresent ? maximalRevisions() : { sectionRevisions: {}, liveRevisions: {} };
  const [candidateName, ...interviewerNames] = namesPresent ? maximalTrustedNames() : [null];
  return {
    pack,
    status,
    completeSections,
    candidateName: namesPresent ? candidateName : null,
    interviewerNames: namesPresent ? interviewerNames : [],
    onDownloadLog: () => {},
    onSaveNames: () => {},
    generating: wp.generating,
    triggerMessage: null,
    onGenerateNow: () => {},
    onCheckAgain: () => {},
    hasDescription: true,
    onRegenerateSection: () => {},
    onRestoreRevision: () => {},
    sectionRevisions,
    liveRevisions,
    sectionActivity,
    sectionOutcomes,
    wholePackQueued: wp.wholePackQueued,
    packTimedOut: wp.packTimedOut,
  };
}

/** See `test/helpers/prepDialogHarness.js`'s own `forwardControls` -- the
 *  same definition, reimplemented locally so this file (unlike every other
 *  N50 test here) never has to mount a real dialog or stub `fetch` to reach
 *  it, only `document.body`.
 *
 *  N50 fix round 5 (verify.r5.md minors m-1/m-2, kept in lockstep with the
 *  harness's own copy): recognizes "Add a job description" (precisely, so it
 *  is never confused with the names strip's own bare "Add"), and excludes a
 *  `disabled`/`aria-disabled="true"` control -- PRESENCE alone used to be
 *  enough, which is not "a control that can move the generation forward". */
function forwardControls(el) {
  return [...el.querySelectorAll('button, [role="button"]')].filter(
    (node) =>
      /^(regenerate\b|restore\b|prepare me for this interview$|check again$|add a job description$)/i.test(controlName(node)) &&
      !node.disabled &&
      node.getAttribute("aria-disabled") !== "true",
  );
}

describe("INVARIANT canary -- forwardControls discriminates a real generation control from Download/Edit/Add/Save/Cancel", () => {
  it("finds a Regenerate/Restore/Prepare-me/Check-again control and ignores everything else", async () => {
    const el = await render(buildProps({ hasPack: true, packState: "idle", sectionState: "idle", revisionsPresent: true, namesPresent: true }));
    const found = forwardControls(el).map(controlName);
    expect(found.some((n) => /^regenerate whole pack$/i.test(n))).toBe(true);
    expect(found.some((n) => /^regenerate tell me about yourself$/i.test(n))).toBe(true);
    expect(found.some((n) => /^restore tell me about yourself version \d+$/i.test(n))).toBe(true);
    expect(found.some((n) => /download prep log/i.test(n))).toBe(false);
    expect(found.some((n) => /^(edit|add)$/i.test(n))).toBe(false);
  });
});

describe("INVARIANT (N50 fix round 4, verify4.md) -- the full cross-product: every combination offers at least one forward control", () => {
  const cases = [];
  for (const namesPresent of [false, true]) {
    // pack ABSENT: the section and revisions axes are held at baseline --
    // see this file's own header for why.
    for (const packState of AXIS_STATES) {
      cases.push({ hasPack: false, packState, sectionState: "idle", revisionsPresent: false, namesPresent });
    }
    // pack PRESENT: the full grid.
    for (const packState of AXIS_STATES) {
      for (const sectionState of AXIS_STATES) {
        for (const revisionsPresent of [false, true]) {
          cases.push({ hasPack: true, packState, sectionState, revisionsPresent, namesPresent });
        }
      }
    }
  }

  it(`renders ${cases.length} combinations and offers at least one forward control in every one`, async () => {
    const offenders = [];
    for (const c of cases) {
      const el = await render(buildProps(c));
      if (forwardControls(el).length === 0) offenders.push(JSON.stringify(c));
    }
    expect(offenders, `zero-control combinations: ${offenders.join(" | ")}`).toEqual([]);
    expect(cases.length).toBe(110);
  }, 30000);
});

describe("N50 fix round 5 (verify.r5.md B-1) -- generating:true is NO LONGER an exception; it must offer a control too", () => {
  // Round 4 carved this state out on the theory that it is "bounded by the
  // queue's own timeout and resolves on its own" -- verify.r5.md measured
  // that false: the queue's settled handler `await`s a refetch
  // (AppViewDialog.js's `fetchPrep`) with no bound of its own, so a hung GET
  // left this EXACT state -- generating:true -- offering zero controls,
  // unchanged after 15 simulated minutes and a close+reopen. The fix is two
  // parts: `fetchPrep` is now bounded at its source (AppViewDialog.js), and
  // -- belt and suspenders, so this state is never again the single point of
  // failure for the whole invariant -- `showCheckAgain` (PrepPackPanel.js)
  // no longer excludes `generating`. This sweep only reaches the panel, so
  // it proves the SECOND half directly; the bounded fetch is proven
  // dialog-mounted, in AppViewDialog.prepTimeout.test.js.
  it("[generating: true] still offers at least one forward control (Check again)", async () => {
    const el = await render(buildProps({ hasPack: true, packState: "idle", sectionState: "idle", revisionsPresent: true, namesPresent: true }));
    expect(forwardControls(el).length, "precondition: idle has a control").toBeGreaterThan(0);
    const generatingEl = await render({
      ...buildProps({ hasPack: true, packState: "idle", sectionState: "idle", revisionsPresent: true, namesPresent: true }),
      generating: true,
    });
    expect(
      forwardControls(generatingEl).length,
      "generating:true must no longer be a zero-control dead end",
    ).toBeGreaterThan(0);
  });

  it("[generating: true] GenerateControl's OWN button is still absent -- PrepPackPanel.generate.test.js's pin is about THAT button, not the whole panel", async () => {
    const generatingEl = await render({
      ...buildProps({ hasPack: true, packState: "idle", sectionState: "idle", revisionsPresent: true, namesPresent: true }),
      generating: true,
    });
    const named = [...generatingEl.querySelectorAll("button")].map(controlName);
    expect(named.some((n) => /^(prepare me for this interview|regenerate whole pack)$/i.test(n))).toBe(false);
    expect(named.some((n) => /^check again$/i.test(n)), "the escape hatch itself must be present").toBe(true);
  });
});

describe("N50 fix round 5 (verify.r5.md minor m-1) -- hasDescription:false is no longer a silent second zero-control gap", () => {
  it("[hasDescription:false, pack absent] still offers a forward control", async () => {
    const el = await render({
      ...buildProps({ hasPack: false, packState: "idle", sectionState: "idle", revisionsPresent: false, namesPresent: true }),
      hasDescription: false,
    });
    expect(forwardControls(el).length).toBeGreaterThan(0);
  });

  it("[hasDescription:false, pack present/ready] still offers a forward control, even with every section control blocked", async () => {
    const el = await render({
      ...buildProps({ hasPack: true, packState: "idle", sectionState: "idle", revisionsPresent: true, namesPresent: true }),
      hasDescription: false,
    });
    expect(forwardControls(el).length).toBeGreaterThan(0);
    // precondition this case actually exercises the gap: no section control
    // is offered either, since `hasDescription` blocks those too.
    expect(el.querySelectorAll('[role="group"] button').length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// M-3 (N50 fix round 6, verify.r6.md) -- round 5's own m-1 fix (above) was two
// hand-picked cases, both held at `packState: "idle"`. verify.r6.md's own
// finding: `hasDescription` was still not a real AXIS -- it never crossed the
// `queued` state -- so the next reachable combination (a whole-pack
// regenerate queued behind a live section action, then the job description
// cleared before that queued entry drains -- AC-N50.15(c)'s own queueing,
// paired with an edit from the tracking row's own Edit form or another tab)
// reopened the exact zero-control gap m-1 was meant to close, undefended.
// This crosses EVERY whole-pack axis state with `hasDescription`, at
// `hasPack: true` baseline (the section axis is held at its own baseline per
// this file's header -- the state m-1/M-3 are about is the whole-pack
// region, not a per-section one), which is precisely narrow enough to catch
// the precedence bug without re-running the full 110-case grid a second time.
// ---------------------------------------------------------------------------

describe("N50 fix round 6 (verify.r6.md M-3) -- hasDescription is a real axis, crossed with every whole-pack action state", () => {
  const cases = AXIS_STATES.flatMap((packState) => [false, true].map((hasDescription) => ({ packState, hasDescription })));

  it(`renders ${cases.length} combinations (5 whole-pack states x 2 hasDescription) with at least one forward control in every one`, async () => {
    const offenders = [];
    for (const c of cases) {
      const el = await render({
        ...buildProps({ hasPack: true, packState: c.packState, sectionState: "idle", revisionsPresent: true, namesPresent: true }),
        hasDescription: c.hasDescription,
      });
      if (forwardControls(el).length === 0) offenders.push(JSON.stringify(c));
    }
    expect(offenders, `zero-control combinations: ${offenders.join(" | ")}`).toEqual([]);
    expect(cases.length).toBe(10);
  });

  it("[precedence] wholePackQueued, with status not yet caught up to 'running' and no job description, still offers 'Add a job description' -- verify.r6.md's own reachable case", async () => {
    // The reachable shape verify.r6.md measured is NOT `wholePackAxis
    // ("queued")` above (that helper forces `status:"running"`, which
    // `prepActionState` itself already resolves to "in-flight" before ever
    // reaching the hasDescription check, so it cannot exercise this
    // precedence bug at all -- confirmed by the cross-product case above
    // passing via "Check again" regardless of this fix). The real gap is the
    // render that happens the instant a whole-pack regenerate is queued
    // behind an active section action, BEFORE any refetch has landed a fresh
    // `status`: AppViewDialog.js's own `dPrep.status` still holds whatever
    // the LAST successful GET reported (e.g. "ready"), while `wholePackQueued`
    // already flips true from the client-side queue the instant `enqueue`
    // accepts the click.
    const el = await render({
      ...buildProps({ hasPack: true, packState: "idle", sectionState: "idle", revisionsPresent: true, namesPresent: true }),
      status: "ready",
      wholePackQueued: true,
      hasDescription: false,
    });
    const found = forwardControls(el).map(controlName);
    expect(found.some((n) => /^add a job description$/i.test(n)), "no-description must win the precedence race against queued").toBe(true);
  });
});

describe("N50 fix round 6 (verify.r6.md minor m-4) -- the status axis widened to all 6 real values", () => {
  // AXIS_STATES/wholePackAxis only ever produce `status` "ready", "running"
  // and "failed" (verify.r6.md's own finding); COPY (this file's imported
  // PrepPackPanel.js's own dictionary) names 6: absent, running, ready,
  // partial, failed, unavailable. The 3 missing ones, each measured directly
  // rather than folded into the main cross-product (verify.r6.md itself
  // found no defect behind any of them -- this is coverage, not a fix).
  it("[status: partial] still offers a forward control", async () => {
    const el = await render({
      ...buildProps({ hasPack: true, packState: "idle", sectionState: "idle", revisionsPresent: true, namesPresent: true }),
      status: "partial",
    });
    expect(forwardControls(el).length).toBeGreaterThan(0);
  });

  it("[status: unavailable] still offers a forward control", async () => {
    const el = await render({
      ...buildProps({ hasPack: true, packState: "idle", sectionState: "idle", revisionsPresent: true, namesPresent: true }),
      status: "unavailable",
    });
    expect(forwardControls(el).length).toBeGreaterThan(0);
  });

  it("[status: absent, pack present] still offers a forward control", async () => {
    const el = await render({
      ...buildProps({ hasPack: true, packState: "idle", sectionState: "idle", revisionsPresent: true, namesPresent: true }),
      status: null,
    });
    expect(forwardControls(el).length).toBeGreaterThan(0);
  });
});

describe("N50 fix round 5 (verify.r5.md minor m-2) -- the sweep's own instrument dies to a disabled/aria-disabled control (Z2/Z3/Z4)", () => {
  it("a disabled whole-pack control is no longer counted (Z2)", async () => {
    const el = await render(buildProps({ hasPack: true, packState: "idle", sectionState: "idle", revisionsPresent: true, namesPresent: true }));
    const before = forwardControls(el).length;
    expect(before).toBeGreaterThan(0);
    const whole = [...el.querySelectorAll("button")].find((b) => /^regenerate whole pack$/i.test(controlName(b)));
    expect(whole, "no whole-pack control to disable").toBeTruthy();
    whole.disabled = true;
    expect(forwardControls(el)).not.toContain(whole);
  });

  it("every section control disabled is no longer counted (Z3)", async () => {
    const el = await render(buildProps({ hasPack: true, packState: "idle", sectionState: "idle", revisionsPresent: true, namesPresent: true }));
    const sectionButtons = [...el.querySelectorAll('[role="group"] button')].filter((b) => /^regenerate\b/i.test(controlName(b)));
    expect(sectionButtons.length).toBeGreaterThan(0);
    for (const b of sectionButtons) b.setAttribute("aria-disabled", "true");
    const remaining = forwardControls(el).filter((n) => sectionButtons.includes(n));
    expect(remaining).toEqual([]);
  });
});

describe("INVARIANT, per-section sweep -- each section varied independently (the other three held idle) also offers a control", () => {
  const cases = [];
  for (const section of SECTIONS) {
    for (const state of AXIS_STATES) cases.push({ section, state });
  }

  it(`renders ${cases.length} combinations (4 sections x 5 states) with no asymmetry between sections`, async () => {
    const offenders = [];
    for (const c of cases) {
      const props = buildProps({ hasPack: true, packState: "idle", sectionState: "idle", revisionsPresent: true, namesPresent: true });
      const { activity, outcome } = sectionAxis(c.state);
      props.sectionActivity = activity ? { [c.section]: activity } : {};
      props.sectionOutcomes = outcome ? { [c.section]: outcome } : {};
      if (["queued", "in-flight", "timed-out"].includes(c.state)) props.status = "running";
      const el = await render(props);
      if (forwardControls(el).length === 0) offenders.push(JSON.stringify(c));
    }
    expect(offenders, `zero-control combinations: ${offenders.join(" | ")}`).toEqual([]);
    expect(cases.length).toBe(20);
  }, 15000);
});
