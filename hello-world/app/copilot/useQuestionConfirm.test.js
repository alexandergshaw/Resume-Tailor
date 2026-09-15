// @vitest-environment jsdom
//
// AC-N18.1..N18.12. The React state around lib/copilot/questionConfirm.js's
// resolveConfirmedView — see useQuestionConfirm.js's own doc for why this
// mirrors useQuestionPin.js's structure (which itself has no test file of
// its own; the lifecycle and ref-reading behaviour this hook adds are new,
// so this file exists where the sibling's does not).
//
// Harness copied from app/copilot/useDraftAnswer.codeLanguage.test.js's own
// Probe pattern: `questionsRef` is a PROP the test owns directly (a plain
// `{ current }` holder), not a `useRef` handed out of a component during
// render — this repo's `react-hooks/refs` rule is at ERROR level and forbids
// the latter. In production this ref is mirrored from `questions` by
// useLiveSession.js's own effect; here the test plays that role directly.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createElement, useState, act } from "react";
import { createRoot } from "react-dom/client";
import { useQuestionConfirm } from "./useQuestionConfirm.js";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const q = (id, extra = {}) => ({ id, question: `Q${id}`, status: "done", ...extra });

function Probe({ onState, questionsRef, logEvent }) {
  const [questions, setQuestions] = useState([]);
  const confirm = useQuestionConfirm({ questions, questionsRef, logEvent });
  onState({ questions, setQuestions, confirm });
  return null;
}

const mounted = [];

function mountProbe({ logEvent = vi.fn() } = {}) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  const state = {};
  const questionsRef = { current: [] };
  mounted.push({ root, container });
  act(() => {
    root.render(
      createElement(Probe, {
        questionsRef,
        logEvent,
        onState: (s) => Object.assign(state, s),
      }),
    );
  });
  return { state, questionsRef, logEvent };
}

// Sets `questions` AND mirrors it onto `questionsRef.current` in the same
// act() — the exact pairing useLiveSession.js's own `useEffect(() => {
// questionsRef.current = questions; }, [questions])` produces after a commit.
function setQuestions(state, questionsRef, list) {
  act(() => {
    state.setQuestions(list);
  });
  questionsRef.current = list;
}

afterEach(() => {
  while (mounted.length) {
    const m = mounted.pop();
    act(() => m.root.unmount());
    m.container.remove();
  }
});

describe("useQuestionConfirm — confirmQuestion appends (AC-N18.5)", () => {
  it("makes the confirmed id `current` and logs question.confirmed", () => {
    const { state, questionsRef, logEvent } = mountProbe();
    setQuestions(state, questionsRef, [q(1), q(2)]);

    act(() => state.confirm.confirmQuestion(1));

    expect(state.confirm.confirmedIds).toEqual([1]);
    expect(state.confirm.current.id).toBe(1);
    expect(state.confirm.currentIsSeed).toBe(false);
    expect(logEvent).toHaveBeenCalledWith("question.confirmed", { id: 1 });
  });

  it("a repeat confirm of the same id is a no-op and does not log again", () => {
    const { state, questionsRef, logEvent } = mountProbe();
    setQuestions(state, questionsRef, [q(1), q(2)]);

    act(() => state.confirm.confirmQuestion(1));
    logEvent.mockClear();
    act(() => state.confirm.confirmQuestion(1));

    expect(state.confirm.confirmedIds).toEqual([1]);
    expect(logEvent).not.toHaveBeenCalled();
  });

  it("m12: two confirmQuestion calls for the same id in ONE tick log question.confirmed exactly once", () => {
    // Both calls happen inside the same act() batch, before React commits
    // the first setConfirmedIds — the exact race m12 describes: the render-
    // scope `confirmedIds` state the guard used to read is still the
    // pre-confirm value for BOTH calls, so a state-only guard lets both
    // through. The dedupe must hold even though neither call has been
    // separated by a commit.
    const { state, questionsRef, logEvent } = mountProbe();
    setQuestions(state, questionsRef, [q(1), q(2)]);

    act(() => {
      state.confirm.confirmQuestion(1);
      state.confirm.confirmQuestion(1);
    });

    const confirmCalls = logEvent.mock.calls.filter(
      (c) => c[0] === "question.confirmed" && c[1].id === 1,
    );
    expect(confirmCalls).toHaveLength(1);
    expect(state.confirm.confirmedIds).toEqual([1]);
  });
});

describe("useQuestionConfirm — confirmNext reads the latest questions list, not a stale closure", () => {
  it("targets an entry that arrived only in questionsRef, never in a re-render's `questions` prop", () => {
    const { state, questionsRef } = mountProbe();
    setQuestions(state, questionsRef, [q(1)]);
    act(() => state.confirm.confirmQuestion(1));

    // Capture confirmNext from THIS render. Then append q(2) directly onto
    // questionsRef.current only — no setQuestions, no re-render — exactly the
    // scenario a stale closure over the `questions` prop cannot see. Were
    // confirmNext built from `questions` (the render-scope value, frozen at
    // [q(1)]) instead of `questionsRef.current`, this would find nothing
    // waiting and return null.
    const staleConfirmNext = state.confirm.confirmNext;
    questionsRef.current = [...questionsRef.current, q(2)];

    let target;
    act(() => {
      target = staleConfirmNext();
    });

    expect(target).toBe(2);
  });

  it("logs question.confirmed with the id it picked", () => {
    const { state, questionsRef, logEvent } = mountProbe();
    setQuestions(state, questionsRef, [q(1), q(2)]);
    act(() => state.confirm.confirmQuestion(1));
    logEvent.mockClear();

    act(() => state.confirm.confirmNext());

    expect(logEvent).toHaveBeenCalledWith("question.confirmed", { id: 2 });
  });

  it("returns null and logs nothing when there is no waiting entry to confirm", () => {
    const { state, questionsRef, logEvent } = mountProbe();
    setQuestions(state, questionsRef, [q(1)]);
    act(() => state.confirm.confirmQuestion(1));
    logEvent.mockClear();

    let target;
    act(() => {
      target = state.confirm.confirmNext();
    });

    expect(target).toBeNull();
    expect(logEvent).not.toHaveBeenCalled();
  });
});

describe("useQuestionConfirm — question.waiting (AC-N18.12)", () => {
  it("logs question.waiting once an entry enters `waiting`", () => {
    const { state, questionsRef, logEvent } = mountProbe();
    setQuestions(state, questionsRef, [q(1)]);
    act(() => state.confirm.confirmQuestion(1));
    logEvent.mockClear();

    // Nothing else confirmed yet — q(2) enters `waiting` the moment it
    // arrives, since something (q1) is already confirmed.
    setQuestions(state, questionsRef, [q(1), q(2)]);

    expect(logEvent).toHaveBeenCalledWith("question.waiting", { id: 2, question: "Q2" });
  });

  it("logs question.waiting for a second entry detected during the seed phase (N18 delta review F2)", () => {
    // Before the F2 fix, the seed view's `waiting` stayed unconditionally
    // empty, so a second (or later) question detected before the very first
    // confirm never logged as waiting either — it had silently become
    // `current` instead (latest-wins), with no confirm ever behind it. The
    // single-entry case still logs nothing: with only one entry, it IS
    // `current` (AC-N18.1's oldest-unconfirmed rule) and nothing is waiting.
    const { state, questionsRef, logEvent } = mountProbe();
    setQuestions(state, questionsRef, [q(1)]);
    expect(logEvent).not.toHaveBeenCalledWith("question.waiting", expect.anything());

    setQuestions(state, questionsRef, [q(1), q(2)]);
    expect(logEvent).toHaveBeenCalledWith("question.waiting", { id: 2, question: "Q2" });
  });

  it("logs question.waiting only once per id even across multiple re-renders", () => {
    const { state, questionsRef, logEvent } = mountProbe();
    setQuestions(state, questionsRef, [q(1)]);
    act(() => state.confirm.confirmQuestion(1));
    setQuestions(state, questionsRef, [q(1), q(2)]);

    const waitingCalls = logEvent.mock.calls.filter((c) => c[0] === "question.waiting");
    expect(waitingCalls).toHaveLength(1);

    // A re-render with the exact same list must not log id 2 again.
    setQuestions(state, questionsRef, [q(1), q(2)]);
    const waitingCallsAfter = logEvent.mock.calls.filter((c) => c[0] === "question.waiting");
    expect(waitingCallsAfter).toHaveLength(1);
  });

  it("excludes a provisional entry from waiting, and so from the log, until it is cleared (AC-N18.3)", () => {
    const { state, questionsRef, logEvent } = mountProbe();
    setQuestions(state, questionsRef, [q(1)]);
    act(() => state.confirm.confirmQuestion(1));
    logEvent.mockClear();

    const provisionalEntry = q(2, { provisional: true });
    setQuestions(state, questionsRef, [q(1), provisionalEntry]);
    expect(logEvent).not.toHaveBeenCalledWith("question.waiting", expect.anything());

    // Retroactive speaker remap: same object, provisional flag cleared, no
    // new question arrives — the next render (any state change) picks it up.
    // setQuestions itself is that trigger: a fresh array reference re-renders
    // the Probe even though `provisionalEntry`'s identity is unchanged.
    provisionalEntry.provisional = false;
    setQuestions(state, questionsRef, [q(1), provisionalEntry]);

    expect(logEvent).toHaveBeenCalledWith("question.waiting", { id: 2, question: "Q2" });
  });
});

describe("useQuestionConfirm — resetConfirmed, the AC-N18.9 lifecycle primitive", () => {
  it("clears confirmedIds back to nothing confirmed (wired at Start and Clear)", () => {
    const { state, questionsRef } = mountProbe();
    setQuestions(state, questionsRef, [q(1), q(2)]);
    act(() => state.confirm.confirmQuestion(1));
    expect(state.confirm.confirmedIds).toEqual([1]);

    act(() => state.confirm.resetConfirmed());

    expect(state.confirm.confirmedIds).toEqual([]);
    expect(state.confirm.currentIsSeed).toBe(true);
  });

  it("a fresh question arriving after reset can be logged as waiting again once re-confirmed", () => {
    // Guards the loggedWaitingIdsRef reset inside resetConfirmed: without it,
    // an id from a PRIOR session that happened to be reused could silently
    // never log a second time.
    const { state, questionsRef, logEvent } = mountProbe();
    setQuestions(state, questionsRef, [q(1), q(2)]);
    act(() => state.confirm.confirmQuestion(1));
    expect(logEvent).toHaveBeenCalledWith("question.waiting", { id: 2, question: "Q2" });

    // N18 delta review F2: batched into ONE act(), matching how
    // useLiveSession.js's start() actually calls these two — setQuestions([])
    // and confirm.resetConfirmed() both run synchronously in start()'s own
    // body, before any await, so React batches them into a single commit.
    // Firing them in separate act() calls (as this test used to) exposes an
    // intermediate render questions can never actually be caught in: reset
    // confirmedIds while `questions` still holds the PRIOR session's full
    // list, which the seed rule now (correctly) treats as "waiting" and logs
    // — a real fact about that state, just not one production ever produces.
    act(() => {
      state.confirm.resetConfirmed();
      state.setQuestions([]);
    });
    questionsRef.current = [];
    logEvent.mockClear();

    setQuestions(state, questionsRef, [q(1), q(2)]);
    act(() => state.confirm.confirmQuestion(1));

    expect(logEvent).toHaveBeenCalledWith("question.waiting", { id: 2, question: "Q2" });
  });

  it("confirmedIds are not reset by anything but an explicit resetConfirmed call — Stop must never call it (AC-N18.9)", () => {
    // The hook itself has no notion of "Stop"; this documents the primitive
    // Stop deliberately must NOT invoke, per useLiveSession.js's own call
    // sites (Start/Clear call resetConfirmed, Stop does not) — reviewed at
    // the wiring, not re-derivable from this hook alone.
    const { state, questionsRef } = mountProbe();
    setQuestions(state, questionsRef, [q(1), q(2)]);
    act(() => state.confirm.confirmQuestion(1));

    // Renders/updates that are NOT a reset must leave confirmedIds alone.
    setQuestions(state, questionsRef, [q(1), q(2), q(3)]);

    expect(state.confirm.confirmedIds).toEqual([1]);
  });
});

describe("useQuestionConfirm — unconfirmQuestion, the M7 undo primitive", () => {
  it("returns the current entry to waiting and makes the previously-confirmed entry current again", () => {
    const { state, questionsRef } = mountProbe();
    setQuestions(state, questionsRef, [q(1), q(2), q(3)]);
    act(() => state.confirm.confirmQuestion(1));
    act(() => state.confirm.confirmQuestion(2));
    expect(state.confirm.current.id).toBe(2);

    act(() => state.confirm.unconfirmQuestion(2));

    expect(state.confirm.confirmedIds).toEqual([1]);
    expect(state.confirm.current.id).toBe(1);
    expect(state.confirm.waiting.map((e) => e.id)).toEqual([2, 3]);
  });

  it("is a no-op for an id that was never confirmed", () => {
    const { state, questionsRef } = mountProbe();
    setQuestions(state, questionsRef, [q(1), q(2)]);
    act(() => state.confirm.confirmQuestion(1));

    act(() => state.confirm.unconfirmQuestion(99));

    expect(state.confirm.confirmedIds).toEqual([1]);
  });

  it("lets the same id be confirmed again afterward without being treated as a stale duplicate", () => {
    // Guards the confirmedIdsRef bookkeeping this shares with m12's fix:
    // unconfirming must actually clear the id out of the ref, or a later
    // re-confirm of that same id would silently fail to log.
    const { state, questionsRef, logEvent } = mountProbe();
    setQuestions(state, questionsRef, [q(1), q(2)]);
    act(() => state.confirm.confirmQuestion(1));
    act(() => state.confirm.unconfirmQuestion(1));
    logEvent.mockClear();

    act(() => state.confirm.confirmQuestion(1));

    expect(logEvent).toHaveBeenCalledWith("question.confirmed", { id: 1 });
    expect(state.confirm.confirmedIds).toEqual([1]);
  });
});
