// @vitest-environment jsdom
//
// ---------------------------------------------------------------------------
// M-1 (N50 fix round 2) -- what happens once the queue's own timeout
// (lib/interviewPrep/prepActionQueue.js) fires on a hung generate/restore
// request, dialog-mounted. verify.r2.md's own finding: before that round the
// timeout stopped AWAITING the hung request but never told it to stop, so
// `usePrepGeneration`'s in-flight guard never released and a candidate's own
// retry came back `{skipped:true}` -- recorded as a SECOND failure although
// no second request was ever sent -- and a reply that landed after the
// client gave up was simply discarded.
//
// B-1/M-2/M-3 (N50 fix round 3, verify.r3.md) -- round 2's own fix left a
// worse gap: the client's timeout (135s) fired BEFORE the server's own claim
// lease (150s) could clear, so the timeout's own refetch was GUARANTEED, by
// arithmetic, to land on a row the database's own CHECK constraint
// (interview_prep_packs_running_has_no_content) forces to be `running` and
// empty -- and every case below used to answer that refetch with a fully
// populated, `status:"ready"` pack, a reply the real server can never
// produce while a claim is live. That let a real timeout leave the panel
// showing an apparently-erased pack, a whole-pack-generating banner for a
// SECTION action, and no control of any kind to recover with (B-1). This
// round: (1) the default timeout now clears the LEASE, not merely the
// route's own maxDuration (prepActionQueue.js's own header); (2) every GET
// below answers what the real server actually returns while a claim is
// live -- `runningPrepGetBody()` (M2/B-1, shared with AppViewDialog.
// prepQueueLifetime.test.js's own `runningGet()`), never a ready pack;
// (3) the settled handler schedules FOLLOW-UP refetches past where the
// lease could have cleared, not just the one fired the instant the client
// gives up (M-3).
// ---------------------------------------------------------------------------
//
// EVERY CASE MOUNTS THE REAL AppViewDialog, exactly like
// AppViewDialog.prepQueue.reachability.test.js beside this file, except under
// `vi.useFakeTimers()` -- the client timeout is real minutes, so this file
// cannot use that sibling's own real-`setTimeout(0)` `flush()`. `advance(ms)`
// below is the AttachmentPanel.retryFocus.test.js pattern
// (`vi.advanceTimersByTimeAsync`, which flushes the chained promises a mocked
// fetch/json response leaves pending, not merely the bare timer).
//
// PAST_TIMEOUT_MS is NOT the exact production constant: m-b's own
// prepActionQueue.contract.test.js pins that `createPrepActionQueue` stays
// the module's ONLY export, so the derived default is intentionally private.
// 175s clears the current 165s (150s server lease + 15s margin) default with
// room to spare, so this file never has to guess the exact figure.
//
// HYGIENE (plan M5): the queue is module-scope and outlives every test in
// this file, so each case uses its own fresh application id.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createElement, act } from "react";
import { createRoot } from "react-dom/client";
import AppViewDialog from "../AppViewDialog.js";
import { maximalGetResponse } from "@/test/helpers/prepMaximalFixture.js";
import { norm } from "@/test/helpers/prepPanelInstruments.js";
import {
  freshAppId,
  dialogProps,
  jsonResponse,
  deferred,
  click,
  getCalls,
  sectionRegenerateControl,
  wholePackRegenerateControl,
  sectionGroup,
  runningPrepGetBody,
  checkAgainControl,
  forwardControls,
  footAlerts,
  stubFetchWithDifferentRunLive,
} from "@/test/helpers/prepDialogHarness.js";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const PAST_TIMEOUT_MS = 175_000;

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
  vi.useRealTimers();
});

async function advance(ms) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

async function mount(id) {
  await act(async () => root.render(createElement(AppViewDialog, dialogProps(id))));
  await advance(0);
}

/** B-1 (N50 fix round 3): a POST that hangs until the queue's own timeout
 *  aborts it, paired with a GET that answers what the real server can
 *  actually produce while that claim is live -- `runningPrepGetBody()`
 *  (M2/B-1) -- rather than the fully populated pack the OLD version of this
 *  file always answered with, a reply the database's own CHECK constraint
 *  makes impossible while a claim is outstanding (verify.r3.md's own
 *  finding against this exact file). The mount's OWN GET, before any click,
 *  still answers `maximalGetResponse()` -- establishing the "last known
 *  ready pack" cache (AppViewDialog.js's `cacheReadyPack`) M2's fix reads
 *  back once the claim goes live -- and stays that way for every GET issued
 *  before the first POST starts. `posts` counts every POST received, so a
 *  case can tell a retry apart from the original click. */
function stubFetchWithHangingPost() {
  const posts = { count: 0 };
  let pending = false;
  const f = vi.fn((url, init) => {
    if (!init || !init.method || init.method === "GET") {
      return Promise.resolve(jsonResponse(pending ? runningPrepGetBody() : maximalGetResponse()));
    }
    posts.count += 1;
    pending = true;
    return new Promise((resolve, reject) => {
      if (!init.signal) return;
      init.signal.addEventListener("abort", () => {
        const err = new Error("The operation was aborted.");
        err.name = "AbortError";
        reject(err);
      });
    });
  });
  vi.stubGlobal("fetch", f);
  return { posts, fetchMock: f };
}

describe("M-1 -- after the queue's own timeout, retrying issues a REAL second request", () => {
  it("a hung section regenerate times out, and clicking Regenerate again sends a new POST (not {skipped:true})", async () => {
    vi.useFakeTimers();
    const id = freshAppId("m1retry");
    const { posts } = stubFetchWithHangingPost();
    await mount(id);

    await click(sectionRegenerateControl("aboutYou"));
    await advance(0);
    expect(posts.count, "positive control: the first click posted").toBe(1);

    await advance(PAST_TIMEOUT_MS);
    const control = sectionRegenerateControl("aboutYou");
    expect(control, "the control must return once the queue moves on from the timeout").toBeTruthy();

    await click(control);
    await advance(0);
    expect(posts.count, "the retry must be a REAL second request").toBe(2);
  });

  it("the same holds for the whole-pack control", async () => {
    vi.useFakeTimers();
    const id = freshAppId("m1retrypack");
    const { posts } = stubFetchWithHangingPost();
    await mount(id);

    await click(wholePackRegenerateControl());
    await advance(0);
    expect(posts.count, "positive control: the first click posted").toBe(1);

    await advance(PAST_TIMEOUT_MS);
    const control = wholePackRegenerateControl();
    expect(control, "the whole-pack control must return once the queue moves on").toBeTruthy();

    await click(control);
    await advance(0);
    expect(posts.count, "the retry must be a REAL second request").toBe(2);
  });
});

describe("B-1/M-2 (N50 fix round 3) -- a refetch landing on a still-live claim never blanks the panel", () => {
  it("a section timeout: the cached pack stays on screen, the banner names the section (never the whole pack), the real timeout sentence is shown, and the control returns", async () => {
    vi.useFakeTimers();
    const id = freshAppId("b1section");
    stubFetchWithHangingPost();
    await mount(id);

    await click(sectionRegenerateControl("aboutYou"));
    await advance(0);
    await advance(PAST_TIMEOUT_MS);

    // the cached pack, not an apparent wipe: aboutYou's own (stale) content
    // and an untouched section's content both stay on screen.
    expect(document.body.textContent, "aboutYou's cached content is gone").toContain(
      "I lead frontend platform work",
    );
    expect(document.body.textContent, "an untouched section's cached content is gone").toContain(
      "Your platform team ships weekly",
    );
    expect(document.body.textContent).not.toMatch(/no self-introduction here yet/i);

    // the banner names the section -- never the whole-pack claim (AC-N50.16(c)).
    const bodyText = norm(document.body.textContent);
    expect(bodyText).not.toMatch(/generating your interview prep pack now/i);
    expect(bodyText).toMatch(/regenerating tell me about yourself/i);

    // M-2: the section's own message is the REAL timeout sentence, not a
    // bare "Couldn't regenerate ... Try again." that asserts outright
    // failure beside a banner that says the pack is still generating.
    const group = sectionGroup("aboutYou");
    expect(group, "no aboutYou group").toBeTruthy();
    const alert = group.querySelector('[role="alert"]');
    expect(alert, "no message shown for the timed-out section").toBeTruthy();
    const alertText = norm(alert.textContent);
    expect(alertText, "M-2: must carry the real timeout sentence, not a bare failure").toMatch(/may still finish/i);
    expect(alertText).toMatch(/check back/i);

    // always a way out: the section's OWN retry control is back. An
    // UNTOUCHED section, though, must NOT also show a control -- status is
    // still "running" for a reason only aboutYou's own timeout explains, and
    // nothing is queued behind it any more (N50 fix round 5, verify.r5.md
    // M-1: sectionsEnabled is now per-section, so a timeout on aboutYou never
    // unblocks whyRole -- a click there would immediately POST into a claim
    // that may still be live server-side, a guaranteed refusal).
    expect(sectionRegenerateControl("aboutYou"), "no retry control").toBeTruthy();
    expect(sectionRegenerateControl("whyRole"), "an untouched section must stay blocked while status is still running").toBeFalsy();
  });
});

describe("M-1 -- a timeout schedules its OWN refetch, so a reply that lands late is not simply discarded", () => {
  it("a timed-out generate triggers a GET with no further click needed", async () => {
    vi.useFakeTimers();
    const id = freshAppId("m1refetch");
    const { fetchMock } = stubFetchWithHangingPost();
    await mount(id);
    const getsAtMount = getCalls(fetchMock).length;
    expect(getsAtMount, "positive control: the mount's own GET already ran").toBeGreaterThan(0);

    await click(sectionRegenerateControl("aboutYou"));
    await advance(0);
    expect(getCalls(fetchMock).length, "clicking Regenerate posts -- it does not itself GET").toBe(getsAtMount);

    await advance(PAST_TIMEOUT_MS);
    expect(getCalls(fetchMock).length, "the timeout must trigger its own refetch, not merely record the failure").toBeGreaterThan(
      getsAtMount,
    );
  });
});

describe("M-3 (N50 fix round 3) -- a late reply is caught by a LATER follow-up refetch, not just the first one", () => {
  it("the server finishes just after the client gives up: a scheduled follow-up (not the first refetch) picks up the real content, with no further click", async () => {
    vi.useFakeTimers();
    const id = freshAppId("m3late");
    let phase = "initial"; // initial -> pending (claim live) -> done (server finished)
    const posts = { count: 0 };
    const f = vi.fn((url, init) => {
      if (!init || !init.method || init.method === "GET") {
        if (phase === "pending") return Promise.resolve(jsonResponse(runningPrepGetBody()));
        if (phase === "done") return Promise.resolve(jsonResponse(maximalGetResponse({ candidateName: "Late Content" })));
        return Promise.resolve(jsonResponse(maximalGetResponse()));
      }
      posts.count += 1;
      phase = "pending";
      return new Promise((resolve, reject) => {
        if (!init.signal) return;
        init.signal.addEventListener("abort", () => {
          const err = new Error("The operation was aborted.");
          err.name = "AbortError";
          reject(err);
        });
      });
    });
    vi.stubGlobal("fetch", f);
    await mount(id);

    await click(sectionRegenerateControl("aboutYou"));
    await advance(0);
    expect(posts.count, "positive control: the first click posted").toBe(1);

    // the client gives up -- its own FIRST refetch still sees the claim
    // live, since the server has not finished yet.
    await advance(PAST_TIMEOUT_MS);
    expect(document.body.textContent, "positive control: the first refetch saw the still-live claim").not.toContain(
      "Late Content",
    );

    // the server finishes a moment later -- well before the scheduled
    // follow-up (+20s from the first refetch, per AppViewDialog.js's own
    // TIMEOUT_FOLLOW_UP_DELAYS_MS).
    phase = "done";
    await advance(1_000);
    expect(document.body.textContent, "nothing re-checks until the scheduled follow-up").not.toContain("Late Content");

    // the scheduled follow-up refetch (M-3) picks it up -- no further click.
    await advance(25_000);
    expect(document.body.textContent, "a late reply must appear with no further click").toContain("Late Content");
  });
});

describe("M-1 -- a stale, timeout-triggered refetch never overwrites a NEWER one", () => {
  // The queue itself serialises: while the timeout's own refetch is held
  // open, that entry has not yet settled, so a RETRY on the same section has
  // nothing to click on yet (AC-N50.15(c), unchanged by this round -- the
  // queue waits for an in-flight refetch before moving on, same as a normal
  // success). A close-then-reopen is what races a SECOND, independent GET
  // (the mount effect's own fetchPrepForRow, AppViewDialog.js's
  // prepFetchedForRef) against the first -- exactly the V-1 staleness guard
  // that effect already carries, exercised here against this round's OWN new
  // trigger for a GET rather than a second manual open. This case's own GET
  // fixture stays ready-shaped and marker-based (never `runningPrepGetBody()`)
  // on purpose: it is proving ORDERING between two real replies, and an
  // empty running body would leave nothing for a stale reply to clobber
  // with, making the assertion vacuous.
  it("closing and reopening while a timeout's own refetch is still held does not let that stale reply clobber the fresh reopen", async () => {
    vi.useFakeTimers();
    const id = freshAppId("m1stale");
    const staleGet = deferred();
    const freshGet = deferred();
    let getCount = 0;
    const f = vi.fn((url, init) => {
      if (!init || !init.method || init.method === "GET") {
        getCount += 1;
        if (getCount === 1) return Promise.resolve(jsonResponse(maximalGetResponse({ candidateName: "Mount Candidate" })));
        if (getCount === 2) return staleGet.promise.then(() => jsonResponse(maximalGetResponse({ candidateName: "Stale Candidate" })));
        return freshGet.promise.then(() => jsonResponse(maximalGetResponse({ candidateName: "Fresh Candidate" })));
      }
      // the POST hangs until the queue's own timeout aborts it.
      return new Promise((resolve, reject) => {
        if (!init.signal) return;
        init.signal.addEventListener("abort", () => {
          const err = new Error("The operation was aborted.");
          err.name = "AbortError";
          reject(err);
        });
      });
    });
    vi.stubGlobal("fetch", f);
    await mount(id);

    await click(sectionRegenerateControl("aboutYou"));
    await advance(0);
    await advance(PAST_TIMEOUT_MS); // times out -- schedules refetch #2 (staleGet, held open)
    expect(getCount, "the timeout's own refetch must have started").toBe(2);

    // Close, then reopen -- the mount effect's own fresh GET (#3, freshGet, held open).
    await act(async () => root.render(createElement(AppViewDialog, dialogProps(id, { open: false }))));
    await advance(0);
    await act(async () => root.render(createElement(AppViewDialog, dialogProps(id, { open: true }))));
    await advance(0);
    expect(getCount, "the reopen must issue its own fresh GET").toBe(3);

    // The NEWER (reopen) GET lands first; the OLDER, timeout-triggered one lands late.
    freshGet.resolve();
    await advance(0);
    staleGet.resolve();
    await advance(0);

    expect(document.body.textContent, "the late, stale reply must not have clobbered the fresher one").toContain("Fresh Candidate");
    expect(document.body.textContent).not.toContain("Stale Candidate");
  });
});

// ---------------------------------------------------------------------------
// N50 fix round 4 (verify4.md): three rounds each fixed ONE instant after a
// timeout and left the very next ordinary gesture -- close+reopen, a bare
// remount, or the retry control itself -- back at the SAME zero-control dead
// end. This round's own ruling: close it by class, with one invariant
// (`forwardControls().length > 0`), not by chasing the next individual case.
// ---------------------------------------------------------------------------

async function reopen(id) {
  await act(async () => root.render(createElement(AppViewDialog, dialogProps(id, { open: false }))));
  await advance(0);
  await act(async () => root.render(createElement(AppViewDialog, dialogProps(id, { open: true }))));
  await advance(0);
}
async function remountDialog(id) {
  await act(async () => root.unmount());
  root = createRoot(container);
  await act(async () => root.render(createElement(AppViewDialog, dialogProps(id))));
  await advance(0);
}

describe("B-1 (N50 fix round 4, verify4.md) -- the three ordinary paths back to the zero-control state, each closed", () => {
  it("path 1: close and reopen after a SECTION timeout still offers a control, and the banner still names the section", async () => {
    vi.useFakeTimers();
    const id = freshAppId("b1p1");
    stubFetchWithHangingPost();
    await mount(id);
    await click(sectionRegenerateControl("aboutYou"));
    await advance(0);
    await advance(PAST_TIMEOUT_MS);
    expect(forwardControls().length, "precondition: the timeout's own instant has a control").toBeGreaterThan(0);

    await reopen(id);

    expect(forwardControls().length, "no control survived a close+reopen").toBeGreaterThan(0);
    expect(norm(document.body.textContent)).not.toMatch(/generating your interview prep pack now/i);
  });

  it("path 2: a bare remount (a main-tab switch, never closed) still offers a control", async () => {
    vi.useFakeTimers();
    const id = freshAppId("b1p2");
    stubFetchWithHangingPost();
    await mount(id);
    await click(sectionRegenerateControl("aboutYou"));
    await advance(0);
    await advance(PAST_TIMEOUT_MS);

    await remountDialog(id);

    expect(forwardControls().length, "no control survived a bare remount").toBeGreaterThan(0);
    expect(norm(document.body.textContent)).not.toMatch(/generating your interview prep pack now/i);
  });

  it("path 3: retrying via the whole-pack control after a section timeout, answered refused/in-flight, still offers a control", async () => {
    vi.useFakeTimers();
    const id = freshAppId("b1p3");
    const posts = { count: 0 };
    const f = vi.fn((url, init) => {
      if (!init || !init.method || init.method === "GET") {
        return Promise.resolve(jsonResponse(posts.count > 0 ? runningPrepGetBody() : maximalGetResponse()));
      }
      posts.count += 1;
      if (posts.count === 1) {
        // the original section click hangs until the queue's own timeout
        // aborts it -- same shape as stubFetchWithHangingPost above.
        return new Promise((resolve, reject) => {
          if (!init.signal) return;
          init.signal.addEventListener("abort", () => {
            const err = new Error("The operation was aborted.");
            err.name = "AbortError";
            reject(err);
          });
        });
      }
      // the retry (the whole-pack click) meets the route's own live-claim
      // refusal -- verify4.md's own measured reply for this exact path.
      return Promise.resolve(jsonResponse({ status: "refused", reason: "in-flight" }));
    });
    vi.stubGlobal("fetch", f);
    await mount(id);
    await click(sectionRegenerateControl("aboutYou"));
    await advance(0);
    await advance(PAST_TIMEOUT_MS);
    const whole = wholePackRegenerateControl();
    expect(whole, "the whole-pack control must be offered after a section timeout").toBeTruthy();

    await click(whole);
    await advance(0);

    expect(forwardControls().length, "a refused/in-flight retry must not re-impose the zero-control block").toBeGreaterThan(0);
    // the cache must still be on screen -- the retry's own reply must not
    // read as an apparent wipe either.
    expect(document.body.textContent).toContain("I lead frontend platform work");
  });
});

describe("M-1 (N50 fix round 4, verify4.md) -- a whole-pack timeout, pinned", () => {
  it("shows the cached pack, not an apparently-erased one, and offers the whole-pack retry control", async () => {
    vi.useFakeTimers();
    const id = freshAppId("m1pack");
    stubFetchWithHangingPost();
    await mount(id);
    await click(wholePackRegenerateControl());
    await advance(0);
    await advance(PAST_TIMEOUT_MS);

    expect(document.body.textContent, "the cache must survive a whole-pack timeout").toContain("I lead frontend platform work");
    expect(norm(document.body.textContent)).not.toMatch(/no self-introduction here yet/i);
    expect(wholePackRegenerateControl(), "the whole-pack retry control must be back").toBeTruthy();
  });
});

describe("M-2 (N50 fix round 4, verify4.md) -- a whole-pack timeout never offers a Restore control over a claim that may still be live", () => {
  it("no Restore control renders anywhere while the whole pack is timed out, even with a faithful (revision-carrying) running body", async () => {
    vi.useFakeTimers();
    const id = freshAppId("m2restore");
    stubFetchWithHangingPost();
    await mount(id);
    const restoreLocator = (b) => /^restore\b/i.test(b.textContent || "");
    expect(
      [...document.body.querySelectorAll("button")].filter(restoreLocator),
      "positive control: the idle, ready state really does carry Restore controls",
    ).not.toEqual([]);

    await click(wholePackRegenerateControl());
    await advance(0);
    await advance(PAST_TIMEOUT_MS);

    const restoreButtons = [...document.body.querySelectorAll("button")].filter(restoreLocator);
    expect(restoreButtons, "a Restore control would PATCH into a claim that may still be live").toEqual([]);
    // the escape hatch is still the whole-pack control, never a per-section one.
    expect(wholePackRegenerateControl()).toBeTruthy();
  });
});

describe("M-3 (N50 fix round 4, verify4.md) -- a section's own timeout message never asserts failure beside a banner that says it is still running", () => {
  it("the section's alert names itself as the SUBJECT, never 'Couldn't regenerate', while the banner keeps naming the section", async () => {
    vi.useFakeTimers();
    const id = freshAppId("m3exclusive");
    stubFetchWithHangingPost();
    await mount(id);
    await click(sectionRegenerateControl("aboutYou"));
    await advance(0);
    await advance(PAST_TIMEOUT_MS);

    const group = sectionGroup("aboutYou");
    expect(group, "no aboutYou group").toBeTruthy();
    const alert = group.querySelector('[role="alert"]');
    expect(alert, "no message shown for the timed-out section").toBeTruthy();
    expect(norm(alert.textContent)).not.toMatch(/couldn.?t/i);
    expect(norm(alert.textContent)).toMatch(/^tell me about yourself:/i);
    // the banner is unaffected: it still legitimately says this session's
    // own action on aboutYou is what the server is doing.
    expect(norm(document.body.textContent)).toMatch(/regenerating tell me about yourself/i);
  });
});

describe("M-4 (N50 fix round 4, verify4.md) -- the scheduled follow-up refetches are cancelled, not left to fire forever", () => {
  it("no further GETs after the dialog UNMOUNTS", async () => {
    vi.useFakeTimers();
    const id = freshAppId("m4unmount");
    const { fetchMock } = stubFetchWithHangingPost();
    await mount(id);
    await click(sectionRegenerateControl("aboutYou"));
    await advance(0);
    await advance(PAST_TIMEOUT_MS);
    const before = getCalls(fetchMock).length;

    await act(async () => root.unmount());
    await advance(120_000);

    expect(getCalls(fetchMock).length, "no GET should fire after unmount").toBe(before);
    root = createRoot(container); // afterEach's own unmount must have something live to act on
  });

  it("no further GETs after the dialog is CLOSED (without unmounting)", async () => {
    vi.useFakeTimers();
    const id = freshAppId("m4close");
    const { fetchMock } = stubFetchWithHangingPost();
    await mount(id);
    await click(sectionRegenerateControl("aboutYou"));
    await advance(0);
    await advance(PAST_TIMEOUT_MS);

    await act(async () => root.render(createElement(AppViewDialog, dialogProps(id, { open: false }))));
    await advance(0);
    const before = getCalls(fetchMock).length;
    await advance(120_000);

    expect(getCalls(fetchMock).length, "no GET should fire after Close").toBe(before);
  });

  it("closing while a follow-up chain is pending and opening a DIFFERENT application does not leak a stale GET into it", async () => {
    // Stands in for a sign-out that routes through closing this dialog
    // rather than a full page reload (`window.location.assign`, the repo's
    // one real in-app sign-out, already discards every timer on its own --
    // this is the harder case, a routed close, not that one).
    vi.useFakeTimers();
    const id = freshAppId("m4signout");
    const { fetchMock } = stubFetchWithHangingPost();
    await mount(id);
    await click(sectionRegenerateControl("aboutYou"));
    await advance(0);
    await advance(PAST_TIMEOUT_MS);

    await act(async () => root.render(createElement(AppViewDialog, dialogProps(id, { open: false }))));
    await advance(0);
    const otherId = freshAppId("m4other");
    await act(async () => root.render(createElement(AppViewDialog, dialogProps(otherId, { open: true }))));
    await advance(0);
    const afterOtherOpen = getCalls(fetchMock).length;

    await advance(120_000);

    expect(getCalls(fetchMock).length, "the OLD application's follow-up chain must not still be polling").toBe(afterOtherOpen);
  });
});

describe("m-1 (N50 fix round 4, verify4.md) -- the SECOND follow-up (+40s past the first) has power on its own", () => {
  it("a reply landing between the two follow-ups is missed by the first and caught only by the second", async () => {
    vi.useFakeTimers();
    const id = freshAppId("m1fu2");
    let phase = "initial"; // initial -> pending -> done
    const posts = { count: 0 };
    const f = vi.fn((url, init) => {
      if (!init || !init.method || init.method === "GET") {
        if (phase === "pending") return Promise.resolve(jsonResponse(runningPrepGetBody()));
        if (phase === "done") return Promise.resolve(jsonResponse(maximalGetResponse({ candidateName: "Second Follow-up Content" })));
        return Promise.resolve(jsonResponse(maximalGetResponse()));
      }
      posts.count += 1;
      phase = "pending";
      return new Promise((resolve, reject) => {
        if (!init.signal) return;
        init.signal.addEventListener("abort", () => {
          const err = new Error("The operation was aborted.");
          err.name = "AbortError";
          reject(err);
        });
      });
    });
    vi.stubGlobal("fetch", f);
    await mount(id);
    await click(sectionRegenerateControl("aboutYou"));
    await advance(0);

    // the timeout's own first refetch (instant) sees `running`.
    await advance(PAST_TIMEOUT_MS);
    expect(document.body.textContent).not.toContain("Second Follow-up Content");

    // the FIRST follow-up (+20s) also sees `running` -- the server has not
    // finished yet.
    await advance(20_000);
    expect(document.body.textContent, "positive control: the first follow-up alone must not have seen it").not.toContain(
      "Second Follow-up Content",
    );

    // the server finishes between the two follow-ups.
    phase = "done";
    await advance(1_000);
    expect(document.body.textContent, "nothing re-checks until the SECOND follow-up").not.toContain("Second Follow-up Content");

    // the SECOND follow-up (+40s more) picks it up -- deleting it would fail
    // this assertion while leaving the one above green.
    await advance(40_000);
    expect(document.body.textContent, "the second follow-up must have power on its own").toContain("Second Follow-up Content");
  });
});

describe("INVARIANT (N50 fix round 4, verify4.md) -- the manual 'Check again' escape hatch, wired through the real dialog", () => {
  it("a running status with no session-known reason (a first open mid an externally-triggered run) shows 'Check again', and clicking it issues a fresh GET", async () => {
    vi.useFakeTimers();
    const id = freshAppId("checkagain");
    let ready = false;
    const f = vi.fn((url, init) => {
      if (!init || !init.method || init.method === "GET") {
        return Promise.resolve(jsonResponse(ready ? maximalGetResponse({ candidateName: "Now Ready" }) : runningPrepGetBody()));
      }
      return Promise.resolve(jsonResponse({ status: "disabled" }));
    });
    vi.stubGlobal("fetch", f);
    await mount(id);
    const control = checkAgainControl();
    expect(control, "no Check again control for an externally-triggered running state").toBeTruthy();
    const before = getCalls(f).length;

    ready = true;
    await click(control);
    await advance(0);

    expect(getCalls(f).length, "Check again must issue a fresh GET").toBeGreaterThan(before);
    expect(document.body.textContent).toContain("Now Ready");
  });
});

describe("m-3 (N50 fix round 4, verify4.md) -- a reply landing after BOTH follow-ups have run out is still shown, via the same reopen the copy points at", () => {
  it("a late reply that misses both bounded follow-ups is not lost forever: reopening the dialog shows it", async () => {
    vi.useFakeTimers();
    const id = freshAppId("m3late2");
    let phase = "initial"; // initial -> pending -> done
    const f = vi.fn((url, init) => {
      if (!init || !init.method || init.method === "GET") {
        if (phase === "pending") return Promise.resolve(jsonResponse(runningPrepGetBody()));
        if (phase === "done") return Promise.resolve(jsonResponse(maximalGetResponse({ candidateName: "Post-Bound Content" })));
        return Promise.resolve(jsonResponse(maximalGetResponse()));
      }
      phase = "pending";
      return new Promise((resolve, reject) => {
        if (!init.signal) return;
        init.signal.addEventListener("abort", () => {
          const err = new Error("The operation was aborted.");
          err.name = "AbortError";
          reject(err);
        });
      });
    });
    vi.stubGlobal("fetch", f);
    await mount(id);
    await click(sectionRegenerateControl("aboutYou"));
    await advance(0);

    await advance(PAST_TIMEOUT_MS); // the first refetch
    await advance(20_000); // follow-up 1
    await advance(40_000); // follow-up 2 -- bounded polling now stops
    expect(document.body.textContent).not.toContain("Post-Bound Content");
    expect(forwardControls(), "the retry control (\"Check back, or try again\") must still be there").not.toEqual([]);

    // the server finally replies, well after polling gave up.
    phase = "done";
    await advance(30_000); // no more scheduled follow-ups fire in this window
    expect(document.body.textContent, "positive control: nothing re-polls past the bound").not.toContain("Post-Bound Content");

    // "Check back" -- close and reopen, exactly what the timeout sentence
    // itself tells the candidate to do.
    await reopen(id);

    expect(document.body.textContent, "a late reply must still surface once the candidate does what the copy says").toContain(
      "Post-Bound Content",
    );
  });
});

// ---------------------------------------------------------------------------
// N50 fix round 5 (verify.r5.md) -- B-1 blocker: the invariant's ONE
// documented exception (generating:true) was itself a permanent zero-control
// dead end, caused by the settled handler awaiting an unbounded `fetch`.
// M-1: a stale `timedOut` outcome never retires, so it can re-open controls
// over a claim that is genuinely live. M-2: a finished pack still carries a
// permanently false "it may still finish" message.
// ---------------------------------------------------------------------------

describe("B-1 (N50 fix round 5, verify.r5.md) -- generating:true is no longer a zero-control state", () => {
  it("while the whole-pack POST is genuinely still in flight, 'Check again' is offered -- the invariant's ONE prior exception is closed", async () => {
    vi.useFakeTimers();
    const id = freshAppId("b1r5generating");
    stubFetchWithHangingPost();
    await mount(id);
    await click(wholePackRegenerateControl());
    await advance(0);

    expect(forwardControls().length, "generating:true must offer a control").toBeGreaterThan(0);
    expect(checkAgainControl(), "the escape hatch itself must render").toBeTruthy();
    // the button GenerateControl itself owns must still be absent, matching
    // PrepPackPanel.generate.test.js's own pin.
    expect(wholePackRegenerateControl()).toBeFalsy();
  });
});

describe("B-1 (N50 fix round 5, verify.r5.md) -- the settled handler's own refetch is bounded, not awaited forever", () => {
  it("PH1: the POST settles, the refetch GET never answers -- the queue still moves on once the fetch's own bound elapses", async () => {
    vi.useFakeTimers();
    const id = freshAppId("b1r5fetch");
    const posts = { count: 0 };
    let getCount = 0;
    const f = vi.fn((url, init) => {
      if (!init || !init.method || init.method === "GET") {
        getCount += 1;
        if (getCount === 1) return Promise.resolve(jsonResponse(maximalGetResponse()));
        // the settled handler's own refetch (and every GET after it): a
        // stalled connection that never answers on its own.
        return new Promise((resolve, reject) => {
          if (!init?.signal) return;
          init.signal.addEventListener("abort", () => {
            const err = new Error("The operation was aborted.");
            err.name = "AbortError";
            reject(err);
          });
        });
      }
      posts.count += 1;
      return Promise.resolve(jsonResponse({ status: "ready" }));
    });
    vi.stubGlobal("fetch", f);
    await mount(id);

    await click(wholePackRegenerateControl());
    await advance(0);
    expect(posts.count, "positive control: the POST settled").toBe(1);
    expect(getCount, "positive control: the settled handler issued its own refetch").toBe(2);
    // generating:true is still true here (the refetch has not settled), and
    // the panel still offers a control -- this file's own case above pins
    // that directly; this case is about the QUEUE itself unsticking.
    expect(forwardControls().length).toBeGreaterThan(0);

    // Advance well past the refetch's own bound (far short of the queue's
    // ~165s send timeout, which never applies here -- the POST already
    // settled). Nothing about this GET ever answers on its own -- if the
    // settled handler's `await` were still unbounded, nothing below would
    // ever change: the fetch resolving (via its own timeout's abort) is what
    // lets `drain()` finish and the queue move the entry off `active`.
    await advance(25_000);

    // M-2 (N50 fix round 6, verify.r6.md): the copy alone is not proof the
    // queue moved on -- verify.r6.md's own finding is that this exact
    // assertion, unaccompanied, is satisfied by a build that bounds the fetch
    // but leaves the queue itself stuck (the dead end merely relocated, never
    // closed). The property this case is titled for -- "the queue still
    // moves on" -- is that a real forward control returns, AND that clicking
    // it does real work, not merely that some copy renders.
    expect(
      document.body.textContent,
      "the bounded fetch must eventually settle (its own catch branch), never hang the settled handler forever",
    ).toContain("Could not load your prep pack.");
    expect(
      forwardControls().length,
      "the queue moving on must leave a real control on screen, not just the error sentence",
    ).toBeGreaterThan(0);

    // Proof the queue is REALLY unstuck, not merely reporting as if it were:
    // a fresh click enqueues and SENDS a genuine second request. A queue
    // still wedged on the old `active` entry would refuse this as a
    // duplicate target and `posts.count` would stay at 1.
    const retry = wholePackRegenerateControl();
    expect(retry, "the whole-pack control must be clickable again").toBeTruthy();
    await click(retry);
    await advance(0);
    expect(posts.count, "the retry must be a REAL second request").toBe(2);
  });
});

describe("M-1 (N50 fix round 5, verify.r5.md) -- a stale section timeout does not survive a reopen long after, onto a run this session never started", () => {
  it("reopening well past the outcome's bounded lifetime, with status still reading 'running', offers no Restore control and no section-named banner", async () => {
    vi.useFakeTimers();
    const id = freshAppId("m1r5stale");
    stubFetchWithHangingPost();
    await mount(id);
    await click(sectionRegenerateControl("aboutYou"));
    await advance(0);
    await advance(PAST_TIMEOUT_MS);
    await advance(20_000);
    await advance(40_000);
    expect(sectionRegenerateControl("aboutYou"), "precondition: the retry control is back").toBeTruthy();

    // "an hour later" -- verify.r5.md's own M-1 example -- well past this
    // outcome's bounded lifetime, and status STILL reads running (the fixture
    // never resolves the original POST, so `stubFetchWithHangingPost` keeps
    // answering every GET with `runningPrepGetBody()` forever).
    await advance(60 * 60 * 1000);
    await reopen(id);

    const restoreButtons = [...document.body.querySelectorAll("button")].filter((b) => /^restore\b/i.test(b.textContent || ""));
    expect(restoreButtons, "a stale timeout must not re-open Restore over a run this session never started").toEqual([]);
    expect(norm(document.body.textContent)).not.toMatch(/regenerating tell me about yourself/i);
  });
});

// ---------------------------------------------------------------------------
// M-1 (N50 fix round 6, verify.r6.md) -- verify.r5.md's own fix was measured
// against only a 60-MINUTE reopen; every landed case above still advances a
// full hour before reopening, so nothing measured what happens INSIDE the
// bound. This round cut TIMED_OUT_OUTCOME_MAX_AGE_MS from 10 minutes to 2
// (prepActionQueue.js's own header) -- these two cases measure just inside
// and just past that shorter bound, rather than only far past any bound at
// all.
// ---------------------------------------------------------------------------

describe("M-1 (N50 fix round 6, verify.r6.md) -- the retirement bound is measured INSIDE the window, not only far past it", () => {
  it("+1 minute past the timeout: still inside the bound, but the running claim now on screen belongs to a run this session never started", async () => {
    vi.useFakeTimers();
    const id = freshAppId("m1r7plus1");
    // N50 fix round 7 (verify.r7.md M-2): `stubFetchWithHangingPost` (used
    // everywhere else in this file) ties its own `pending` flag to THIS
    // session's own POST, so it can only ever model that SAME claim's own
    // lease outliving the client's timeout. This case's own point is a
    // DIFFERENT run -- one this session did not start -- so it uses
    // `stubFetchWithDifferentRunLive` instead (test/helpers/
    // prepDialogHarness.js's own header explains the distinction).
    const { posts, setExternalRunLive } = stubFetchWithDifferentRunLive();
    await mount(id);
    await click(sectionRegenerateControl("aboutYou"));
    await advance(0);
    expect(posts.count, "positive control: the click posted").toBe(1);
    // The different run is already live BEFORE this session's own client
    // timeout fires -- not merely from that moment on -- so the settled
    // handler's OWN automatic refetch (fired the instant the client gives
    // up, still inside this same `advance`) also answers `running` for that
    // reason, rather than resolving to a fresh "ready" reply that would
    // retire this section's own timedOut outcome as provably over before the
    // scenario below ever gets to run.
    setExternalRunLive(true);
    await advance(PAST_TIMEOUT_MS);
    expect(sectionRegenerateControl("aboutYou"), "precondition: the retry control is back").toBeTruthy();

    // Comfortably inside the new, shorter bound
    // (prepActionQueue.js's own TIMED_OUT_OUTCOME_MAX_AGE_MS).
    await advance(60 * 1000);
    await reopen(id);

    expect(
      sectionRegenerateControl("aboutYou"),
      "within the bound, this section's own retry control must still be offered -- a guaranteed 409 against the run above",
    ).toBeTruthy();
    expect(norm(document.body.textContent)).toMatch(/regenerating tell me about yourself/i);
    expect(
      sectionRegenerateControl("whyRole"),
      "an untouched section must still stay blocked while status is running",
    ).toBeFalsy();

    // M-2's own accepted cost (verify.r7.md), exercised rather than merely
    // asserted absent: the offered control sends a REAL second POST into the
    // claim above, a guaranteed 409 that has already spent a rate-limit
    // token -- this is the residual the 2-minute bound accepts, not a defect
    // this round closes.
    await click(sectionRegenerateControl("aboutYou"));
    await advance(0);
    expect(posts.count, "the offered control issues a genuine second request").toBe(2);
  });

  it("+5 minutes past the timeout: past the bound, so no Restore control and no section-named banner survive a reopen onto a run this session never started", async () => {
    vi.useFakeTimers();
    const id = freshAppId("m1r6plus5");
    stubFetchWithHangingPost();
    await mount(id);
    await click(sectionRegenerateControl("aboutYou"));
    await advance(0);
    await advance(PAST_TIMEOUT_MS);
    expect(sectionRegenerateControl("aboutYou"), "precondition: the retry control is back").toBeTruthy();

    await advance(5 * 60 * 1000);
    await reopen(id);

    const restoreButtons = [...document.body.querySelectorAll("button")].filter((b) => /^restore\b/i.test(b.textContent || ""));
    expect(restoreButtons, "a stale timeout must not re-open Restore over a run this session never started").toEqual([]);
    expect(norm(document.body.textContent)).not.toMatch(/regenerating tell me about yourself/i);
    expect(
      sectionRegenerateControl("aboutYou"),
      "the section's own retry control must not survive the bound either -- it is no longer known to be THIS claim",
    ).toBeFalsy();
    // with every section blocked (status is genuinely running, for a claim
    // this session cannot attribute), the only forward control left is the
    // whole-pack escape hatch -- a GET, never a click that POSTs into it.
    expect(forwardControls().length, "the escape hatch ('Check again') must still be offered").toBeGreaterThan(0);
    expect(checkAgainControl(), "the one remaining control must be Check again, not a stray POST-issuing one").toBeTruthy();
  });
});

describe("M-2 (N50 fix round 5, verify.r5.md) -- once the finished pack arrives, the 'it may still finish' message clears", () => {
  it("PS1: a section timeout, then the server finishes -- the fresh content shows with no stale timeout alert left behind", async () => {
    vi.useFakeTimers();
    const id = freshAppId("m2r5section");
    let phase = "initial"; // initial -> pending -> done
    const f = vi.fn((url, init) => {
      if (!init || !init.method || init.method === "GET") {
        if (phase === "pending") return Promise.resolve(jsonResponse(runningPrepGetBody()));
        if (phase === "done") return Promise.resolve(jsonResponse(maximalGetResponse({ candidateName: "Finished Later" })));
        return Promise.resolve(jsonResponse(maximalGetResponse()));
      }
      phase = "pending";
      return new Promise((resolve, reject) => {
        if (!init.signal) return;
        init.signal.addEventListener("abort", () => {
          const err = new Error("The operation was aborted.");
          err.name = "AbortError";
          reject(err);
        });
      });
    });
    vi.stubGlobal("fetch", f);
    await mount(id);
    await click(sectionRegenerateControl("aboutYou"));
    await advance(0);
    await advance(PAST_TIMEOUT_MS);
    const alertBefore = sectionGroup("aboutYou").querySelector('[role="alert"]');
    expect(norm(alertBefore.textContent), "precondition: the timeout sentence is on screen").toMatch(/may still finish/i);

    phase = "done";
    await reopen(id);

    expect(document.body.textContent, "the fresh content must be shown").toContain("Finished Later");
    const groupAfter = sectionGroup("aboutYou");
    expect(groupAfter.querySelector('[role="alert"]'), "the timeout message must clear once the pack has arrived").toBeNull();
    expect(norm(document.body.textContent)).not.toMatch(/may still finish/i);
  });

  it("PS3: the whole-pack flavour -- a pack timeout, then the server finishes, clears the panel-foot alert too", async () => {
    vi.useFakeTimers();
    const id = freshAppId("m2r5pack");
    let phase = "initial";
    const f = vi.fn((url, init) => {
      if (!init || !init.method || init.method === "GET") {
        if (phase === "pending") return Promise.resolve(jsonResponse(runningPrepGetBody()));
        if (phase === "done") return Promise.resolve(jsonResponse(maximalGetResponse({ candidateName: "Pack Finished Later" })));
        return Promise.resolve(jsonResponse(maximalGetResponse()));
      }
      phase = "pending";
      return new Promise((resolve, reject) => {
        if (!init.signal) return;
        init.signal.addEventListener("abort", () => {
          const err = new Error("The operation was aborted.");
          err.name = "AbortError";
          reject(err);
        });
      });
    });
    vi.stubGlobal("fetch", f);
    await mount(id);
    await click(wholePackRegenerateControl());
    await advance(0);
    await advance(PAST_TIMEOUT_MS);
    expect(
      footAlerts().some((n) => /may still finish/i.test(norm(n.textContent))),
      "precondition: the panel-foot alert is on screen",
    ).toBe(true);

    phase = "done";
    await reopen(id);

    expect(document.body.textContent, "the fresh content must be shown").toContain("Pack Finished Later");
    expect(
      footAlerts().some((n) => /may still finish/i.test(norm(n.textContent))),
      "the panel-foot alert must clear once the pack has arrived",
    ).toBe(false);
  });
});
