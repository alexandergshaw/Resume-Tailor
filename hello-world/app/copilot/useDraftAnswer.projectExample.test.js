// @vitest-environment jsdom
//
// N143 seam 6 (T12) — the M6 / R-G silent-failure guard, with DELAYED promises
// (an immediate mock proves nothing here). Two properties:
//   1. A cache HIT fires a FRESH fetchProjectExampleLive and never leaves
//      projectExampleLive stuck {status:'pending'} — the exact M6 hazard
//      (the cache-hit branch returns at :182, before the done-write, so a
//      Row-2 fire placed only after the done-write never runs on a re-ask).
//   2. A superseded draft's late Row 2 does not repaint a moved-on card
//      (the it.id===id && it.draftToken===token guard), with a positive
//      control that the CORRECT pairing does repaint.
//
// RED on HEAD: useDraftAnswer neither imports nor calls fetchProjectExampleLive
// and never sets projectExampleLive, so the spy records zero calls and the
// entry never reaches a terminal Row-2 state. The module mock defines
// fetchProjectExampleLive so the import resolves; the hook must learn to call
// it.

import { describe, it, expect, beforeEach, vi } from "vitest";
import { createElement, act } from "react";
import { createRoot } from "react-dom/client";

// Deferred-promise registry for Row 2, so the test controls WHEN each call
// settles — the only way to prove non-blocking + the draft-token guard.
const liveCalls = [];
function makeDeferred() {
  let resolve, reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

vi.mock("@/lib/copilot/answerClient", () => ({
  // Resolves immediately with a done-frame — the answer itself is not what
  // this file tests. RULED CHANGE (N143 fix round F2, m3): the done-frame now
  // carries a Row 1 value. Live Row 2 is gated on the ANSWER carrying one (the
  // same signal practice uses), because the server omits Row 1 exactly when the
  // feature does not apply; the earlier fixture had none and so pinned the old
  // behaviour of firing Row 2 regardless. What each case below asserts is
  // unchanged. useDraftAnswer.projectExampleLifecycle.test.js holds the controls
  // for the absent case.
  draftAnswerStreaming: vi.fn(async () => ({
    points: ["A drafted point."],
    type: "general",
    cues: [],
    buzzwords: [],
    resumeAnchor: null,
    pageSources: [],
    projectExample: { status: "no_match" },
  })),
  draftAnswer: vi.fn(async () => ({ points: ["A drafted point."], type: "general" })),
  // The NEW Row-2 client the hook must fire. Each call gets its own deferred.
  fetchProjectExampleLive: vi.fn(() => {
    const d = makeDeferred();
    liveCalls.push(d);
    return d.promise;
  }),
}));

import { useDraftAnswer } from "./useDraftAnswer.js";
import { groundingFor } from "@/lib/copilot/answerGrounding.js";
import { getInterviewType } from "./useInterviewType.js";
import { getCodeLanguage } from "./useCodeLanguage.js";
import * as answerClient from "@/lib/copilot/answerClient.js";
import { normalizeQuestion } from "@/lib/copilot/questions.js";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const APP = { id: "app-1" };
const QUESTION = "Tell me about an incident you handled.";

// A harness that mounts the real hook and exposes runDraft + the live
// questions array (setQuestions applies updaters to it).
function mountHook() {
  const state = { questions: [{ id: "q1", status: "idle" }] };
  const draftGenRef = { current: 0 };
  const answerCacheRef = { current: new Map() };
  let runDraft = null;
  function Host() {
    // useDraftAnswer returns the runDraft callback directly (not wrapped).
    runDraft = useDraftAnswer({
      profile: "",
      posting: APP,
      answerCacheRef,
      draftGenRef,
      buildContext: () => "",
      setQuestions: (updater) => {
        state.questions = updater(state.questions);
      },
      logEvent: () => {},
    });
    return null;
  }
  const container = document.createElement("div");
  const root = createRoot(container);
  return { state, draftGenRef, answerCacheRef, run: () => runDraft, root, mount: () => act(async () => root.render(createElement(Host))) };
}

function entry(state) {
  return state.questions.find((q) => q.id === "q1");
}

beforeEach(() => {
  liveCalls.length = 0;
  answerClient.fetchProjectExampleLive.mockClear();
});

describe("cache HIT fires a fresh Row 2 and never stays stuck pending (T12 / R-G)", () => {
  it("fires fetchProjectExampleLive on a cache hit and settles projectExampleLive", async () => {
    const h = mountHook();
    await h.mount();

    // Seed a cache hit: a cached answer whose grounding matches what the hook
    // will compute for this question (same four fields, read from the same
    // getters), so cachedAnswerFor returns it and runDraft takes the cache-hit
    // branch that returns before the done-write.
    const grounding = groundingFor({
      profile: "",
      interviewType: getInterviewType(),
      applicationId: APP.id,
      codeLanguage: getCodeLanguage(),
    });
    h.answerCacheRef.current.set(normalizeQuestion(QUESTION), {
      points: ["A cached point."],
      type: "general",
      cues: [],
      buzzwords: [],
      anchor: null,
      pageSources: [],
      // RULED CHANGE (m3), as above: the cached answer carried a Row 1 value.
      projectExample: { status: "no_match" },
      ...grounding,
    });

    await act(async () => {
      await h.run()("q1", QUESTION);
    });

    // R-G: the cache-hit path must fire Row 2.
    expect(answerClient.fetchProjectExampleLive).toHaveBeenCalledTimes(1);
    // ...with this question and application id.
    const arg = answerClient.fetchProjectExampleLive.mock.calls[0][0];
    expect(arg.applicationId).toBe(APP.id);
    expect(arg.question).toBe(QUESTION);

    // Before it settles, the card carries a non-final pending Row 2.
    expect(entry(h.state).projectExampleLive).toEqual({ status: "pending" });

    // Settle it; the pending state is replaced, never left stuck.
    await act(async () => {
      liveCalls[0].resolve({ projectExample: { status: "ready", competency: "incident response", domain: "SRE", title: "t", bullets: ["a", "b"], hypothetical: true } });
    });
    expect(entry(h.state).projectExampleLive.status).toBe("ready");
  });
});

describe("a superseded draft's late Row 2 does not repaint (draft-token guard)", () => {
  it("drops a stale Row 2 and accepts the current one (positive control)", async () => {
    const h = mountHook();
    await h.mount();

    // First fresh draft (token A). Its Row-2 deferred is left pending.
    await act(async () => {
      await h.run()("q1", QUESTION);
    });
    expect(answerClient.fetchProjectExampleLive).toHaveBeenCalledTimes(1);
    const stale = liveCalls[0];

    // A second fresh draft for the same card (token B) supersedes the first.
    await act(async () => {
      await h.run()("q1", QUESTION, { force: true });
    });
    expect(answerClient.fetchProjectExampleLive).toHaveBeenCalledTimes(2);
    const current = liveCalls[1];

    // The STALE Row 2 resolves late — it must NOT repaint the card.
    await act(async () => {
      stale.resolve({ projectExample: { status: "ready", competency: "x", domain: "y", title: "STALE", bullets: ["a", "b"], hypothetical: true } });
    });
    expect(entry(h.state).projectExampleLive?.title).not.toBe("STALE");

    // The CURRENT Row 2 resolves — it DOES repaint (positive control: proves
    // the guard is a token check, not a blanket drop).
    await act(async () => {
      current.resolve({ projectExample: { status: "ready", competency: "x", domain: "y", title: "CURRENT", bullets: ["a", "b"], hypothetical: true } });
    });
    expect(entry(h.state).projectExampleLive?.title).toBe("CURRENT");
  });
});
