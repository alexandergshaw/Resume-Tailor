// @vitest-environment jsdom
//
// ---------------------------------------------------------------------------
// N50 (N53 folded in) TDD RED hand-off -- THE REACHABILITY TEST for the action
// queue. AC-N50.15 (one action per application at a time; a second click is
// visibly queued, never lost) and AC-N50.16 (an outcome is shown where the
// action was taken, never silently dropped). plan.r2.md section 6 file 4:
// Q-1..Q-5, Q-6, Q-8..Q-12 and the L-3 hygiene control. Q-6b, Q-7 and the
// outcome-lifetime cases L-1/L-2/L-4 are in
// AppViewDialog.prepQueueLifetime.test.js beside this file.
// ---------------------------------------------------------------------------
//
// EVERY CASE MOUNTS THE REAL AppViewDialog (the component TrackingTab.js
// renders), stubs ONLY the network (global fetch), and clicks real controls
// found by accessible name. No case calls a handler, a hook or the queue
// directly. The first mutation is HELD OPEN on a deferred promise, and every
// assertion reads the fetch spy -- the one thing that proves a request was or
// was not issued. A positive control in each case proves the spy records the
// first request, so "zero further requests" can never pass on a dead mount.
//
// LOCATION: this file sits in app/components/tracking/ rather than beside
// AppViewDialog.js because this round's allowed files for the 4b seat are
// that directory's tests. It imports ../AppViewDialog.js, the real module.
//
// RED ON HEAD, and why:
//   * Q-1/Q-2/Q-6/Q-8: HEAD sends every click at once -- a second section is a
//     different usePrepGeneration key, and a restore bypasses that hook -- so
//     "only one outstanding" fails on the second click.
//   * Q-3: no waiting state exists; no role=group either.
//   * Q-5: a section's post-success refetch flips the WHOLE panel into
//     "Generating..." (refreshingIds is keyed by application).
//   * Q-9/Q-10/Q-11: a section refusal lands in the panel-FOOT alert, and a
//     non-"restored" PATCH reply is dropped with no message at all.
// GREEN ON HEAD by design (guards): Q-4 (a server `running` status replaces
// every control), Q-12 (a whole-pack outcome keeps its foot alert), L-3.
//
// HYGIENE (plan M5): the queue is module-scope and outlives every case, so
// each case uses its own fresh application id (test/helpers/
// prepDialogHarness.js freshAppId) and releases every deferred in `finally`.
//
// NOT ASSERTED HERE: a rejected fetch for a restore (network failure). On HEAD
// that rejection is unhandled inside an onClick and would surface as a
// process-level error rather than a clean red; the queue's normalisation of a
// rejected send is pinned at the unit level instead
// (app/hooks/prepActionQueue.contract.test.js, U-5), and the rendering of a
// network-failure outcome at the panel level (PrepPackPanel.queueDisplay
// D-4). A 500 `{error}` reply stands in for it here.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createElement, act } from "react";
import { createRoot } from "react-dom/client";
import AppViewDialog from "../AppViewDialog.js";
import { maximalGetResponse } from "@/test/helpers/prepMaximalFixture.js";
import { norm, controlName } from "@/test/helpers/prepPanelInstruments.js";
import {
  freshAppId,
  dialogProps,
  jsonResponse,
  deferred,
  flush,
  click,
  mutations,
  getCalls,
  LABELS,
  sectionRegenerateControl,
  wholePackRegenerateControl,
  openHistory,
  restoreControl,
  footAlerts,
  groupAlerts,
  sectionGroup,
} from "@/test/helpers/prepDialogHarness.js";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let container;
let root;
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
});

async function mount(id) {
  await act(async () => root.render(createElement(AppViewDialog, dialogProps(id))));
  await flush();
}

/** "POST aboutYou", "POST pack", "PATCH stages v3" -- one line per request. */
function summarize(fetchMock) {
  return mutations(fetchMock).map(({ method, body }) => `${method} ${body.section || "pack"}${body.revision != null ? ` v${body.revision}` : ""}`);
}

/** A fetch stub: GET answers the maximal body; `onWrite(method, body)` answers
 *  every mutation and may return a held promise. */
function stubFetch(onWrite, getBody = () => maximalGetResponse()) {
  const f = vi.fn((url, init) => {
    if (!init || !init.method || init.method === "GET") return Promise.resolve(jsonResponse(getBody()));
    return onWrite(init.method, JSON.parse(init.body));
  });
  vi.stubGlobal("fetch", f);
  return f;
}
const ok = (body, status = 200) => Promise.resolve(jsonResponse(body, status));
const defaultReply = (method, body) => ok(method === "PATCH" ? { status: "restored" } : { status: "ready", ...(body.section ? { section: body.section } : {}) });

/** Holds the FIRST aboutYou POST open until `held.resolve()`. */
function holdAboutYou(held, reply = { status: "ready", section: "aboutYou" }) {
  let first = true;
  return (method, body) => {
    if (method === "POST" && body.section === "aboutYou" && first) {
      first = false;
      return held.promise.then(() => jsonResponse(reply));
    }
    return defaultReply(method, body);
  };
}

async function clickRestore(section, revision) {
  await openHistory(section);
  const control = restoreControl(section, revision);
  expect(control, `no restore control for ${section} version ${revision}`).toBeTruthy();
  await click(control);
}

describe("AC-N50.15(a)(d) -- at most ONE generate-or-restore request per application is outstanding", () => {
  it("Q-1: while a section regenerate is held open, a second section, the whole pack and a restore issue NOTHING further", async () => {
    const id = freshAppId("q1");
    const held = deferred();
    const f = stubFetch(holdAboutYou(held));
    await mount(id);
    const a = sectionRegenerateControl("aboutYou");
    expect(a, "harness: no aboutYou regenerate control").toBeTruthy();
    await click(a);
    await flush();
    try {
      expect(summarize(f), "positive control: the spy records the first request").toEqual(["POST aboutYou"]);
      const b = sectionRegenerateControl("whyRole");
      expect(b, "whyRole must stay usable while another section works (AC-N50.15(b))").toBeTruthy();
      await click(b);
      const whole = wholePackRegenerateControl();
      expect(whole, "the whole-pack control must not show a SECTION's action as its own").toBeTruthy();
      await click(whole);
      await clickRestore("stages", 3);
      await flush();
      expect(summarize(f)).toEqual(["POST aboutYou"]);
    } finally {
      held.resolve();
      await flush(15);
    }
  });

  it("Q-1(d): a click on the section that is already in progress issues nothing -- and offers nothing to click", async () => {
    const id = freshAppId("q1d");
    const held = deferred();
    const f = stubFetch(holdAboutYou(held));
    await mount(id);
    await click(sectionRegenerateControl("aboutYou"));
    await flush();
    try {
      expect(summarize(f)).toEqual(["POST aboutYou"]);
      expect(sectionRegenerateControl("aboutYou"), "an in-progress section must not keep its control").toBe(null);
      const group = sectionGroup("aboutYou");
      expect(group, "no aboutYou group").toBeTruthy();
      expect(group.querySelectorAll('button, summary, [role="button"]')).toHaveLength(0);
    } finally {
      held.resolve();
      await flush(10);
    }
  });
});

describe("AC-N50.15(c) -- when the outstanding request settles, the next waiting action is sent exactly once, in click order", () => {
  it("Q-2: A held; B (section), C (whole pack), D (restore) clicked; releasing A sends B, then C, then D -- each once", async () => {
    const id = freshAppId("q2");
    const held = deferred();
    const f = stubFetch(holdAboutYou(held));
    await mount(id);
    await click(sectionRegenerateControl("aboutYou"));
    await flush();
    try {
      await click(sectionRegenerateControl("whyRole"));
      await click(wholePackRegenerateControl());
      await clickRestore("stages", 3);
      await flush();
      expect(summarize(f), "nothing but A may be outstanding before A settles").toEqual(["POST aboutYou"]);
    } finally {
      held.resolve();
      await flush(20);
    }
    expect(summarize(f)).toEqual(["POST aboutYou", "POST whyRole", "POST pack", "PATCH stages v3"]);
    const bodies = mutations(f).map((m) => m.body);
    expect(bodies[1]).toEqual({ applicationId: id, triggerClass: "B2", section: "whyRole" });
    expect(bodies[2], "the whole-pack body stays byte-identical: no section key").toEqual({ applicationId: id, triggerClass: "B2" });
    expect(bodies[3]).toEqual({ applicationId: id, section: "stages", revision: 3 });
  });
});

describe("AC-N50.15(b) -- a waiting action is shown inside its own section as non-interactive text", () => {
  it("Q-3: the queued section's group offers no control and names what it is waiting to do", async () => {
    const id = freshAppId("q3");
    const held = deferred();
    stubFetch(holdAboutYou(held));
    await mount(id);
    await click(sectionRegenerateControl("aboutYou"));
    await click(sectionRegenerateControl("whyRole"));
    await flush();
    try {
      const group = sectionGroup("whyRole");
      expect(group, "no whyRole group").toBeTruthy();
      expect(group.querySelectorAll('button, summary, [role="button"]')).toHaveLength(0);
      const status = group.querySelector('[role="status"]');
      expect(status, "no role=status region").toBeTruthy();
      expect(norm(status.textContent)).toContain(LABELS.whyRole);
      expect(norm(status.textContent)).toMatch(/queued/i);
      expect(status.querySelector('[role="progressbar"]'), "a waiting line is not progress").toBe(null);
      expect(document.body.querySelectorAll("button[disabled], [aria-disabled='true']")).toHaveLength(0);
    } finally {
      held.resolve();
      await flush(15);
    }
  });
});

describe("AC-N50.15(f) -- a server `running` status still replaces every generate and restore control (GUARD, green on HEAD)", () => {
  it("Q-4: no section regenerate, no history disclosure and no restore control while the row is running", async () => {
    const id = freshAppId("q4");
    stubFetch(defaultReply, () => maximalGetResponse({ status: "running" }));
    await mount(id);
    expect(document.body.textContent, "positive control: the panel mounted").toContain(LABELS.stages);
    for (const section of Object.keys(LABELS)) expect(sectionRegenerateControl(section), section).toBe(null);
    expect(document.body.querySelectorAll("summary")).toHaveLength(0);
    expect([...document.body.querySelectorAll("button")].filter((b) => /^restore\b/i.test(controlName(b)))).toHaveLength(0);
  });
});

describe("AC-N50.16(c) -- a SECTION's refetch is not the whole pack's", () => {
  it("Q-5: mid-refetch after a section success, the whole-pack control is idle, the other sections keep their controls, and that section alone reads in progress", async () => {
    const id = freshAppId("q5");
    const refetch = deferred();
    let posted = false;
    const f = vi.fn((url, init) => {
      if (!init || !init.method) return posted ? refetch.promise.then(() => jsonResponse(maximalGetResponse())) : Promise.resolve(jsonResponse(maximalGetResponse()));
      return Promise.resolve().then(() => {
        posted = true;
        return jsonResponse({ status: "ready", section: "aboutYou" });
      });
    });
    vi.stubGlobal("fetch", f);
    await mount(id);
    await click(sectionRegenerateControl("aboutYou"));
    await flush();
    try {
      expect(getCalls(f).length, "positive control: the post-success refetch was issued and is being held").toBe(2);
      expect(wholePackRegenerateControl(), "the whole-pack control is showing a section refetch as its own").toBeTruthy();
      expect(norm(document.body.textContent)).not.toMatch(/Generating…/);
      for (const other of ["whyRole", "stages", "askThem"]) expect(sectionRegenerateControl(other), `${other} lost its control`).toBeTruthy();
      const status = sectionGroup("aboutYou")?.querySelector('[role="status"]');
      expect(status, "no aboutYou status region").toBeTruthy();
      expect(norm(status.textContent)).toContain(LABELS.aboutYou);
    } finally {
      refetch.resolve();
      await flush(10);
    }
  });
});

describe("AC-N50.15(e) -- an accepted action is never lost when the dialog goes away", () => {
  it("Q-6: A held, B queued, the dialog UNMOUNTS (a main-tab switch), A resolves: B is still sent, exactly once", async () => {
    const id = freshAppId("q6");
    const held = deferred();
    const f = stubFetch(holdAboutYou(held));
    await mount(id);
    await click(sectionRegenerateControl("aboutYou"));
    await click(sectionRegenerateControl("whyRole"));
    await flush();
    try {
      expect(summarize(f), "B must wait while A is outstanding").toEqual(["POST aboutYou"]);
      await act(async () => root.unmount());
    } finally {
      held.resolve();
      await flush(15);
    }
    expect(summarize(f)).toEqual(["POST aboutYou", "POST whyRole"]);
  });
});

describe("R11 -- 'in progress' spans the section's own refetch, and the queue waits for it", () => {
  it("Q-8: after A's POST settles and while its refetch is held, A still reads in progress and B has NOT been sent; once the refetch lands, B goes", async () => {
    const id = freshAppId("q8");
    const held = deferred();
    const refetch = deferred();
    let aSettled = false;
    const f = vi.fn((url, init) => {
      if (!init || !init.method) return aSettled ? refetch.promise.then(() => jsonResponse(maximalGetResponse())) : Promise.resolve(jsonResponse(maximalGetResponse()));
      const body = JSON.parse(init.body);
      if (body.section === "aboutYou") {
        return held.promise.then(() => {
          aSettled = true;
          return jsonResponse({ status: "ready", section: "aboutYou" });
        });
      }
      return ok({ status: "ready", section: body.section });
    });
    vi.stubGlobal("fetch", f);
    await mount(id);
    await click(sectionRegenerateControl("aboutYou"));
    await click(sectionRegenerateControl("whyRole"));
    await flush();
    try {
      expect(summarize(f)).toEqual(["POST aboutYou"]);
      held.resolve();
      await flush(8);
      expect(getCalls(f).length, "positive control: A's refetch was issued").toBe(2);
      expect(summarize(f), "B went out before A's refetch landed").toEqual(["POST aboutYou"]);
      expect(sectionRegenerateControl("aboutYou"), "A looks idle while its fresh content is still loading").toBe(null);
    } finally {
      held.resolve();
      refetch.resolve();
      await flush(15);
    }
    expect(summarize(f)).toEqual(["POST aboutYou", "POST whyRole"]);
    expect(sectionRegenerateControl("aboutYou"), "A must return to idle once its refetch lands").toBeTruthy();
  });
});

describe("AC-N50.16(a)(b) -- outcomes are reported inside the section where the action was taken", () => {
  const RESTORE_REPLIES = [
    ["409 conflict", { status: "conflict" }, 409],
    ["409 refused (in-flight)", { status: "refused", reason: "in-flight" }, 409],
    ["500 error", { error: "Something went wrong." }, 500],
  ];
  for (const [label, reply, status] of RESTORE_REPLIES) {
    it(`Q-10: a restore answered ${label} renders a message in the stages group naming the section and version -- never silence, never the foot`, async () => {
      const id = freshAppId("q10");
      const f = stubFetch((method, body) => (method === "PATCH" ? ok(reply, status) : defaultReply(method, body)));
      await mount(id);
      const getsBefore = getCalls(f).length;
      await clickRestore("stages", 3);
      await flush(10);
      expect(summarize(f), "positive control: the PATCH went out").toEqual(["PATCH stages v3"]);
      const alerts = groupAlerts("stages");
      expect(alerts, "no stages group").toBeTruthy();
      expect(alerts, "a restore that did nothing must say so").toHaveLength(1);
      expect(norm(alerts[0].textContent)).toContain(LABELS.stages);
      expect(norm(alerts[0].textContent)).toMatch(/\b3\b/);
      expect(footAlerts().map((n) => norm(n.textContent))).toEqual([]);
      expect(getCalls(f).length, "only a restored reply refetches").toBe(getsBefore);
    });
  }

  it("Q-11: a section regenerate answered {status:'refused', reason:'error'} renders in THAT group, not at the foot", async () => {
    const id = freshAppId("q11");
    stubFetch((method, body) => (body.section === "askThem" ? ok({ status: "refused", reason: "error" }) : defaultReply(method, body)));
    await mount(id);
    await click(sectionRegenerateControl("askThem"));
    await flush(10);
    const alerts = groupAlerts("askThem");
    expect(alerts, "no askThem group").toBeTruthy();
    expect(alerts).toHaveLength(1);
    expect(norm(alerts[0].textContent)).toContain(LABELS.askThem);
    expect(footAlerts().map((n) => norm(n.textContent))).toEqual([]);
  });

  it("Q-12 (GUARD, green on HEAD): a whole-pack {status:'disabled'} still reaches the foot role=alert", async () => {
    const id = freshAppId("q12");
    stubFetch((method, body) => (body.section ? defaultReply(method, body) : ok({ status: "disabled" })));
    await mount(id);
    await click(wholePackRegenerateControl());
    await flush(10);
    expect(footAlerts().map((n) => norm(n.textContent)).join(" | ")).toMatch(/isn't available/);
  });
});

describe("R12 -- a stale section outcome does not outlive the action that supersedes it", () => {
  it("Q-9(a): a refused section, regenerated again successfully, no longer shows its old message", async () => {
    const id = freshAppId("q9a");
    let refuse = true;
    stubFetch((method, body) => (body.section === "aboutYou" && refuse ? ok({ status: "refused", reason: "error" }) : defaultReply(method, body)));
    await mount(id);
    await click(sectionRegenerateControl("aboutYou"));
    await flush(10);
    expect(groupAlerts("aboutYou"), "no aboutYou group").toBeTruthy();
    expect(groupAlerts("aboutYou"), "precondition: the refusal is shown in the section").toHaveLength(1);
    refuse = false;
    await click(sectionRegenerateControl("aboutYou"));
    await flush(10);
    expect(groupAlerts("aboutYou")).toHaveLength(0);
  });

  it("Q-9(b): a whole-pack regeneration clears every section's stale message", async () => {
    const id = freshAppId("q9b");
    stubFetch((method, body) => (body.section === "whyRole" ? ok({ status: "refused", reason: "error" }) : defaultReply(method, body)));
    await mount(id);
    await click(sectionRegenerateControl("whyRole"));
    await flush(10);
    expect(groupAlerts("whyRole"), "no whyRole group").toBeTruthy();
    expect(groupAlerts("whyRole"), "precondition: the refusal is shown in the section").toHaveLength(1);
    await click(wholePackRegenerateControl());
    await flush(10);
    expect(groupAlerts("whyRole")).toHaveLength(0);
  });
});

describe("L-3 -- per-file hygiene control for the module-scope queue", () => {
  it("a fresh application id renders the GET body and NO alert anywhere", async () => {
    const id = freshAppId("L3q");
    stubFetch(defaultReply, () => maximalGetResponse({ pack: { ...maximalGetResponse().pack } }));
    await mount(id);
    expect(document.body.textContent).toContain(maximalGetResponse().pack.sections.aboutYou.answer.lines[0].text);
    expect([...document.body.querySelectorAll('[role="alert"]')].map((n) => norm(n.textContent))).toEqual([]);
  });
});
