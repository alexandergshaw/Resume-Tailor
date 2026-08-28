// @vitest-environment jsdom
//
// Live mode's three hops to the interview type, and the two draft races the
// same change opens. Harness copied from the worked example next door,
// `app/copilot/useDraftAnswer.pageSources.test.js`.
//
// Written BEFORE the implementation exists (step 4b): the whole file fails on
// the missing `./useInterviewType.js` module until the store moves.
//
// Why these particular cases, and not the obvious ones:
//
//   * AC-A20 — "the request body carries the selected type" PASSES AGAINST A
//     REF IMPLEMENTATION. A ref mirrored during render is correct one tick
//     later, and any test that awaits anything before asserting gives it that
//     tick for free. The only test that distinguishes the two implementations
//     changes the type and starts a draft IN ONE SYNCHRONOUS TURN and reads
//     the outbound body BEFORE any flush — which is what the first case below
//     does, capturing the mock call INSIDE the same synchronous `act` body.
//     `await act()` would flush effects and silently do the work under test.
//   * AC-A19 — the cache KEY, not the request body. A type that reaches the
//     wire but not `groundingFor` still serves a `general` answer to a
//     `technical` re-ask, labelled "reused".
//   * AC-A16 / AC-A16b — `revertToIdle` (`useDraftAnswer.js:175-179`) writes
//     `status: "idle"` by id with NO per-entry condition, and `grep -c
//     AbortController` over this file returns 0, so a superseded fetch ALWAYS
//     resolves or rejects. Two distinct stale-write races follow, and the
//     per-entry `draftToken` closes both. Neither is reachable through a
//     single-draft test.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createElement, useState, act } from "react";
import { createRoot } from "react-dom/client";

vi.mock("@/lib/copilot/answerClient", () => ({
  draftAnswer: vi.fn(),
  draftAnswerStreaming: vi.fn(),
}));

// A SPY that delegates to the real implementation, not a stub. Asserting the
// grounding key's observable behaviour cannot catch a FORKED PIPELINE: a
// `runDraft` that folds the three fields by hand at its own call site produces
// an identical key today and silently stops matching the moment
// `answerGrounding.js` grows a fourth field — which its own header
// contemplates. `sameGrounding` then returns false forever, and every repeated
// question costs a second billed call with no error and no visible symptom.
// That is the failure the module's header says it exists to make impossible
// ("two independent copies of 'same grounding' is exactly how BUG-J6
// happened"), so the shared machinery is asserted directly.
//
// `cachedAnswerFor`'s own internal call to `groundingFor` goes through the
// module's internal binding rather than this export, so the spy records only
// the caller under test.
vi.mock("@/lib/copilot/answerGrounding", async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, groundingFor: vi.fn(actual.groundingFor) };
});

import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import { useDraftAnswer } from "./useDraftAnswer.js";
import { setInterviewType, __resetInterviewTypeForTests } from "./useInterviewType.js";
import { draftAnswerStreaming } from "@/lib/copilot/answerClient";
import { groundingFor } from "@/lib/copilot/answerGrounding";

// Path helper, deliberately NOT `fileURLToPath(new URL(rel, import.meta.url))`:
// under `@vitest-environment jsdom` the global `URL` is jsdom's whatwg-url
// class, not Node's, and `fileURLToPath` rejects an instance of it with
// "The URL must be of scheme file". Passing `import.meta.url` as a STRING has
// no such realm problem, and `node:path` does the rest.
const HERE = dirname(fileURLToPath(import.meta.url));
const readSource = (rel) => readFileSync(join(HERE, rel), "utf8");

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const QUESTION = "Tell me about a time you sharded a ledger.";

function frame(label) {
  return {
    points: [`Point from ${label}.`],
    cues: [label],
    buzzwords: [],
    resumeAnchor: null,
    idealProject: null,
    pageSources: [],
    type: "behavioral",
  };
}

const FRAME_A = frame("draft A");
const FRAME_B = frame("draft B");

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

function seedQuestion(id, question) {
  return {
    id,
    question,
    at: Date.now(),
    status: "idle",
    points: null,
    cues: [],
    buzzwords: [],
    anchor: null,
    idealProject: null,
    pageSources: [],
    type: null,
    error: "",
  };
}

// `answerCacheRef`/`draftGenRef` are PROPS of `useDraftAnswer`, not state it
// owns, so the test creates them as plain `{ current }` holders outside React
// entirely and drives them directly. That is not a convenience: this project's
// `react-hooks/refs` rule is at ERROR level and rejects handing a `useRef`
// result (or any closure over one) out of a component during render, which is
// what a probe that exposed real refs would have to do. The hook only ever
// reads `.current` from inside its own `useCallback`, so a plain object is a
// faithful stand-in.
function Probe({ onState, answerCacheRef, draftGenRef }) {
  const [questions, setQuestions] = useState([]);
  const runDraft = useDraftAnswer({
    profile: "Senior engineer, payments.",
    posting: null,
    answerCacheRef,
    draftGenRef,
    buildContext: () => "",
    setQuestions,
    logEvent: () => {},
  });
  onState({ questions, setQuestions, runDraft });
  return null;
}

const mounted = [];

function mountProbe() {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  const state = {};
  const answerCacheRef = { current: new Map() };
  const draftGenRef = { current: 0 };
  mounted.push({ root, container });
  act(() => {
    root.render(
      createElement(Probe, {
        answerCacheRef,
        draftGenRef,
        onState: (s) => Object.assign(state, s),
      }),
    );
  });
  return { root, container, state, answerCacheRef, draftGenRef };
}

const entryOf = (state, id) => state.questions.find((q) => q.id === id);

beforeEach(() => {
  // `vi.restoreAllMocks()` does NOT clear a `vi.fn()` created in a `vi.mock`
  // factory, and this repo sets neither `clearMocks` nor `restoreMocks`.
  // `mockReset` rather than `mockClear` because cases below install rejecting
  // and never-settling implementations, which `mockClear` would leave standing.
  draftAnswerStreaming.mockReset();
  draftAnswerStreaming.mockResolvedValue(FRAME_A);
  // `mockClear`, NOT `mockReset`: this one is a delegating spy created in the
  // mock factory, and `mockReset` would strip the real implementation it wraps.
  groundingFor.mockClear();
  window.localStorage.clear();
  __resetInterviewTypeForTests();
});

afterEach(() => {
  while (mounted.length) {
    const m = mounted.pop();
    act(() => m.root.unmount());
    m.container.remove();
  }
  window.localStorage.clear();
  __resetInterviewTypeForTests();
});

describe("live mode sends the selected interview type (AC-A18/AC-A22)", () => {
  it("carries the default on an untouched session — the positive control", async () => {
    const { state } = mountProbe();
    act(() => state.setQuestions([seedQuestion(1, QUESTION)]));
    await act(async () => {
      await state.runDraft(1, QUESTION);
    });
    expect(draftAnswerStreaming).toHaveBeenCalledTimes(1);
    expect(draftAnswerStreaming.mock.calls[0][0]).toMatchObject({
      question: QUESTION,
      interviewType: "general",
    });
  });

  it("carries a type selected in the SAME SYNCHRONOUS TURN as the draft (AC-A20)", async () => {
    const { state } = mountProbe();
    act(() => state.setQuestions([seedQuestion(1, QUESTION)]));

    let bodyAtCallTime = null;
    let pending = null;
    // One synchronous `act` body. The store notifies synchronously inside it;
    // `useSyncExternalStore`'s subscribe callback only SCHEDULES a render, and
    // `useEffect` is passive and commits after paint — so a ref mirrored
    // during render still holds "general" at this exact point, under every
    // flush mode including flushSync. The body is captured HERE, before act
    // returns and flushes anything.
    act(() => {
      setInterviewType("technical");
      pending = state.runDraft(1, QUESTION);
      bodyAtCallTime = draftAnswerStreaming.mock.calls[0]?.[0];
    });
    await act(async () => {
      await pending;
    });

    expect(bodyAtCallTime).toBeTruthy();
    expect(bodyAtCallTime.interviewType).toBe("technical");
  });
});

describe("the live answer cache key includes the interview type (AC-A19)", () => {
  it("re-asking the same question under a NEW type is a miss, with no 'reused' label", async () => {
    const { state } = mountProbe();
    act(() => state.setQuestions([seedQuestion(1, QUESTION)]));
    await act(async () => {
      await state.runDraft(1, QUESTION);
    });
    expect(draftAnswerStreaming).toHaveBeenCalledTimes(1);
    expect(entryOf(state, 1).status).toBe("done");

    // Deliberately NOT clearing `answerCacheRef` here. In the app a type
    // change also clears it (AC-A12); this case isolates the KEY, so the
    // `general` entry is left sitting in the cache to be rejected on its own.
    act(() => setInterviewType("technical"));
    act(() => state.setQuestions((prev) => [...prev, seedQuestion(2, QUESTION)]));
    await act(async () => {
      await state.runDraft(2, QUESTION);
    });

    expect(draftAnswerStreaming).toHaveBeenCalledTimes(2);
    expect(entryOf(state, 2).cached).not.toBe(true);
  });

  it("builds the key through groundingFor, the shared machinery — not a hand-fold", async () => {
    const { state } = mountProbe();
    act(() => setInterviewType("technical"));
    act(() => state.setQuestions([seedQuestion(1, QUESTION)]));
    await act(async () => {
      await state.runDraft(1, QUESTION);
    });

    expect(groundingFor).toHaveBeenCalled();
    expect(groundingFor.mock.calls.some(([arg]) => arg?.interviewType === "technical")).toBe(true);
  });

  it("re-asking under the SAME type is still a hit — the positive control", async () => {
    // Without this, an implementation whose cache never hits at all passes the
    // case above, and every repeated question silently costs a second call.
    const { state } = mountProbe();
    act(() => setInterviewType("technical"));
    act(() => state.setQuestions([seedQuestion(1, QUESTION)]));
    await act(async () => {
      await state.runDraft(1, QUESTION);
    });

    act(() => state.setQuestions((prev) => [...prev, seedQuestion(2, QUESTION)]));
    await act(async () => {
      await state.runDraft(2, QUESTION);
    });

    expect(draftAnswerStreaming).toHaveBeenCalledTimes(1);
    expect(entryOf(state, 2).cached).toBe(true);
    expect(entryOf(state, 2).status).toBe("done");
  });
});

describe("a superseded draft writes nothing (AC-A16)", () => {
  it("does not let an older draft overwrite a newer one that already landed", async () => {
    // §0.2's trace: no AbortController exists anywhere in this file, so fetch
    // #1 always resolves. Both drafts are for the SAME entry under the SAME
    // generation, so `draftGenRef.current !== gen` cannot separate them — only
    // a per-entry token can.
    const first = deferred();
    const second = deferred();
    draftAnswerStreaming
      .mockImplementationOnce(() => first.promise)
      .mockImplementationOnce(() => second.promise);

    const { state } = mountProbe();
    act(() => state.setQuestions([seedQuestion(1, QUESTION)]));

    await act(async () => {
      state.runDraft(1, QUESTION, { force: true });
    });
    await act(async () => {
      state.runDraft(1, QUESTION, { force: true });
    });

    await act(async () => {
      second.resolve(FRAME_B);
      await second.promise;
    });
    expect(entryOf(state, 1).status).toBe("done");
    expect(entryOf(state, 1).points).toEqual(FRAME_B.points);

    await act(async () => {
      first.resolve(FRAME_A);
      await first.promise;
    });

    expect(entryOf(state, 1).status).toBe("done");
    expect(entryOf(state, 1).points).toEqual(FRAME_B.points);
  });

  it("does not flip a correct answer back to idle when a superseded draft resolves late", async () => {
    // The exact §0.2 bug. The user changes the interview type (which bumps the
    // generation), a fresh draft lands `done`, and only THEN does the original
    // fetch resolve — finds `draftGenRef.current !== gen`, and `revertToIdle`
    // wipes the correct answer with no per-entry condition to stop it.
    const first = deferred();
    const second = deferred();
    draftAnswerStreaming
      .mockImplementationOnce(() => first.promise)
      .mockImplementationOnce(() => second.promise);

    const { state, answerCacheRef, draftGenRef } = mountProbe();
    act(() => state.setQuestions([seedQuestion(1, QUESTION)]));

    await act(async () => {
      state.runDraft(1, QUESTION, { force: true });
    });

    // What `invalidateLiveAnswers` does on a type change.
    act(() => {
      answerCacheRef.current.clear();
      draftGenRef.current += 1;
    });

    await act(async () => {
      state.runDraft(1, QUESTION, { force: true });
    });
    await act(async () => {
      second.resolve(FRAME_B);
      await second.promise;
    });
    expect(entryOf(state, 1).status).toBe("done");

    await act(async () => {
      first.resolve(FRAME_A);
      await first.promise;
    });

    expect(entryOf(state, 1).status).toBe("done");
    expect(entryOf(state, 1).points).toEqual(FRAME_B.points);
  });

  it("does not flip it to idle on a late REJECTION either", async () => {
    const first = deferred();
    const second = deferred();
    draftAnswerStreaming
      .mockImplementationOnce(() => first.promise)
      .mockImplementationOnce(() => second.promise);

    const { state } = mountProbe();
    act(() => state.setQuestions([seedQuestion(1, QUESTION)]));

    await act(async () => {
      state.runDraft(1, QUESTION, { force: true });
    });
    await act(async () => {
      state.runDraft(1, QUESTION, { force: true });
    });
    await act(async () => {
      second.resolve(FRAME_B);
      await second.promise;
    });

    await act(async () => {
      first.reject(new Error("stream aborted"));
      await first.promise.catch(() => {});
    });

    expect(entryOf(state, 1).status).toBe("done");
    expect(entryOf(state, 1).error).toBe("");
    expect(entryOf(state, 1).points).toEqual(FRAME_B.points);
  });

  it("STILL reverts to idle when the entry has no newer owner — the positive control", async () => {
    // Without this, an implementation that simply deleted `revertToIdle`
    // passes all three cases above, and a draft the user has moved on from
    // sticks on "loading" forever with no way back in.
    const only = deferred();
    draftAnswerStreaming.mockImplementationOnce(() => only.promise);

    const { state, draftGenRef } = mountProbe();
    act(() => state.setQuestions([seedQuestion(1, QUESTION)]));
    await act(async () => {
      state.runDraft(1, QUESTION, { force: true });
    });
    expect(entryOf(state, 1).status).toBe("loading");

    act(() => {
      draftGenRef.current += 1;
    });
    await act(async () => {
      only.resolve(FRAME_A);
      await only.promise;
    });

    expect(entryOf(state, 1).status).toBe("idle");
    expect(entryOf(state, 1).points).toBe(null);
  });
});

describe("the token is stamped BEFORE the cache branch (AC-A16b)", () => {
  it("does not let an in-flight draft overwrite an answer just served from cache", async () => {
    // The stamping-point requirement, which AC-A16's mechanism does not give
    // on its own. A cache hit resolves the card; if it leaves the entry's
    // STALE token in place, the older in-flight draft still matches it and
    // overwrites the answer the user was just served. The cache-hit
    // `setQuestions` write is the one write in `runDraft` that does not follow
    // the loading write, which is why it is easy to miss.
    const pending = deferred();
    draftAnswerStreaming
      .mockImplementationOnce(() => Promise.resolve(FRAME_A)) // primes the cache
      .mockImplementationOnce(() => pending.promise); // the stale in-flight draft

    const { state } = mountProbe();
    act(() => state.setQuestions([seedQuestion(1, QUESTION)]));
    await act(async () => {
      await state.runDraft(1, QUESTION);
    });
    expect(entryOf(state, 1).points).toEqual(FRAME_A.points);

    act(() => state.setQuestions((prev) => [...prev, seedQuestion(2, QUESTION)]));
    await act(async () => {
      state.runDraft(2, QUESTION, { force: true });
    });
    expect(entryOf(state, 2).status).toBe("loading");

    // A cache hit on the same entry, while that forced draft is still in
    // flight — the interviewer circling back, or the auto-draft path firing.
    await act(async () => {
      await state.runDraft(2, QUESTION);
    });
    expect(entryOf(state, 2).cached).toBe(true);
    expect(entryOf(state, 2).points).toEqual(FRAME_A.points);

    await act(async () => {
      pending.resolve(FRAME_B);
      await pending.promise;
    });

    expect(entryOf(state, 2).points).toEqual(FRAME_A.points);
    expect(entryOf(state, 2).cached).toBe(true);
  });

  it("stamps draftToken as a FIELD ON THE ENTRY, and the cache-hit write advances it", async () => {
    // AC-A16 names the forbidden mechanism explicitly: "Fails if: the token is
    // held in a side map read outside the updater (e.g. `seqMap.current.get(id)`),
    // which surrenders exactly the race-freedom the entry field buys."
    //
    // The four race cases above cannot tell the two apart — they drive one
    // entry at a time through `act()`, where a side map and an entry field
    // behave identically. This case is what separates them, and it is two
    // lines: read the field off the entry.
    //
    // The mechanism preference is not cosmetic. A side map keyed by id leaks
    // every removed entry's key forever, and a second `useDraftAnswer`
    // instance shares one module-scope map keyed by an id counter that
    // restarts per hook — FD-1's shape, one module over.
    const pending = deferred();
    draftAnswerStreaming
      .mockImplementationOnce(() => Promise.resolve(FRAME_A))
      .mockImplementationOnce(() => pending.promise);

    const { state } = mountProbe();
    act(() => state.setQuestions([seedQuestion(1, QUESTION)]));
    await act(async () => {
      await state.runDraft(1, QUESTION);
    });

    act(() => state.setQuestions((prev) => [...prev, seedQuestion(2, QUESTION)]));
    await act(async () => {
      state.runDraft(2, QUESTION, { force: true });
    });

    const stampedByDraft = entryOf(state, 2).draftToken;
    expect(stampedByDraft).toBeDefined();
    expect(stampedByDraft).not.toBe(null);

    await act(async () => {
      await state.runDraft(2, QUESTION);
    });

    const stampedByCacheHit = entryOf(state, 2).draftToken;
    expect(stampedByCacheHit).toBeDefined();
    expect(stampedByCacheHit).not.toBe(null);
    // AC-A16b: the cache-hit write must ADVANCE the token, not merely carry
    // one. An entry served from cache under a stale token is still owned by
    // the in-flight draft that will overwrite it.
    expect(stampedByCacheHit).not.toBe(stampedByDraft);

    await act(async () => {
      pending.resolve(FRAME_B);
      await pending.promise;
    });
  });

  it("leaves an entry that was never drafted without a token", async () => {
    // The lifetime rule: entries seeded elsewhere carry no token, and no live
    // token can ever equal that. Seeding one in `useQuestionPipeline.js` is
    // the "helpful" edit that would make a stranded entry indistinguishable
    // from a fresh one.
    const { state } = mountProbe();
    act(() => state.setQuestions([seedQuestion(1, QUESTION)]));
    expect(entryOf(state, 1).draftToken).toBeUndefined();
  });

  it("a forced draft with no cache hit after it STILL lands — the positive control", async () => {
    const pending = deferred();
    draftAnswerStreaming.mockImplementationOnce(() => pending.promise);

    const { state } = mountProbe();
    act(() => state.setQuestions([seedQuestion(1, QUESTION)]));
    await act(async () => {
      state.runDraft(1, QUESTION, { force: true });
    });
    await act(async () => {
      pending.resolve(FRAME_B);
      await pending.promise;
    });

    expect(entryOf(state, 1).status).toBe("done");
    expect(entryOf(state, 1).points).toEqual(FRAME_B.points);
  });
});

describe("the comments that assert live mode has no interview type are corrected (AC-A29)", () => {
  // This repo treats a stale comment as a real defect — the tip of `main` is a
  // commit doing exactly that. Two of AC-A29's four sites are this agent's own
  // files; the other two are asserted next door in the room-questions and
  // store suites. The fourth site is the trap: it sits inside `groundingFor`'s
  // own doc, directly above the function whose contract this chunk changes.
  it("useDraftAnswer.js no longer calls the interview type always-absent in live mode", () => {
    // Today, verbatim at :80-83: "groundingFor folds live mode's always-absent
    // interview type into the same 'not applicable' value practice mode's own
    // entries use".
    expect(readSource("./useDraftAnswer.js")).not.toMatch(/always-absent interview type/);
  });

  it("answerGrounding.js no longer says it at EITHER of its two sites", () => {
    const src = readSource("../../lib/copilot/answerGrounding.js");
    // :41-47 — the NOT_APPLICABLE block, which AC-A29 cites as ":41-42".
    expect(src).not.toMatch(/live mode has no interview-type picker/);
    // :56-57 — inside groundingFor's OWN doc, directly above the function this
    // chunk changes the contract of. Missed by an earlier revision of the
    // criteria, and the one site nothing else in this gate reads.
    expect(src).not.toMatch(/practice only;\s*absent in live mode/);
  });
});
