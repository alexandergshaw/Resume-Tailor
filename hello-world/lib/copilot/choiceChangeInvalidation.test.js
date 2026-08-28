// node (this repo's default environment).
//
// `lib/copilot/choiceChangeInvalidation.js` exists because `PracticeClient`
// CANNOT be rendered under test — its own comment says so at `PracticeClient.js:371`
// — so a duty sequence inlined into its change callback would be unfalsifiable.
// The duties therefore live here, as pure composers over injected callbacks,
// and this file is what proves they are right. What proves they are WIRED is
// `app/copilot/practice/PracticeClient.interviewTypeWiring.test.js` (AC-A13b);
// neither file is sufficient without the other, and that is the point of both.
//
// Written BEFORE the implementation exists (step 4b): every case fails on the
// missing module until `choiceChangeInvalidation.js` lands.
//
// The three properties that carry the most weight here:
//
//   1. FD-2 — `discardAnswerWork` is INDEPENDENTLY CALLABLE and is the
//      answer-side subset only. Chunk C's code-language control calls exactly
//      that and nothing else, because the question route carries no language
//      and the critique route carries no language, so a language change has no
//      claim on the question bank or the rubric scores.
//   2. `discardPracticeWork` CALLS the two halves rather than inlining them.
//      Inlined, the subset chunk C calls and the subset chunk A calls are two
//      copies that can drift, and drift is invisible until it has already
//      shipped. Asserted twice, from two directions: a differential test that
//      the composed sequence and the composer's sequence are identical, and a
//      direct read of the shipped function's own source.
//   3. A12's ORIGIN SPLIT. Under the origin-blind wording an interview-type
//      change made in ANOTHER BROWSER WINDOW abandoned a practice candidate's
//      in-progress recording and revoked a finished take's replay — mid-take,
//      unrecoverable, for a click they may not have made deliberately.
//
// Ordering is asserted with `toEqual` on the whole recorded sequence, never
// with `indexOf` comparisons: `indexOf` is -1 for a step that never ran, and
// -1 is less than everything, so dropping a step entirely passes an
// `indexOf(a) < indexOf(b)` assertion.

import { describe, it, expect } from "vitest";

import {
  discardDraftedAnswers,
  discardAnswerWork,
  discardQuestionAndScoreWork,
  discardPracticeWork,
  invalidateLiveAnswers,
  interviewTypeChangeAnnouncement,
} from "./choiceChangeInvalidation.js";

// Every duty callback, as a regex that matches only a CALL of it — `foo()`,
// `foo?.()`, `foo.call(...)` — and not a mention of the name in a destructuring
// signature or a comment.
const DUTY_CALLS = {
  resetQuestions: /\bresetQuestions\b\s*\??\.?\s*(?:call|apply)?\s*\(/,
  markQuestionsStale: /\bmarkQuestionsStale\b\s*\??\.?\s*(?:call|apply)?\s*\(/,
  clearSessionScores: /\bclearSessionScores\b\s*\??\.?\s*(?:call|apply)?\s*\(/,
  abandonInProgressAnswer: /\babandonInProgressAnswer\b\s*\??\.?\s*(?:call|apply)?\s*\(/,
  resetAnswerState: /\bresetAnswerState\b\s*\??\.?\s*(?:call|apply)?\s*\(/,
  invalidateRoomDrafts: /\binvalidateRoomDrafts\b\s*\??\.?\s*(?:call|apply)?\s*\(/,
};

// Every callback the practice composers can take, each recording its own name
// into one shared ordered log. Passing ALL of them to every call is deliberate:
// a subset composer is only proven to be a subset if the callbacks it must not
// touch were actually available to it.
function makeDuties() {
  const order = [];
  const record = (name) => () => order.push(name);
  return {
    order,
    callbacks: {
      resetQuestions: record("resetQuestions"),
      markQuestionsStale: record("markQuestionsStale"),
      clearSessionScores: record("clearSessionScores"),
      abandonInProgressAnswer: record("abandonInProgressAnswer"),
      resetAnswerState: record("resetAnswerState"),
      invalidateRoomDrafts: record("invalidateRoomDrafts"),
    },
  };
}

const sorted = (list) => [...list].sort();

describe("discardAnswerWork — the answer-side subset chunk C depends on (FD-2)", () => {
  it("abandons the in-progress answer before resetting the state that describes it", () => {
    const { order, callbacks } = makeDuties();
    discardAnswerWork({ origin: "local", ...callbacks });

    // The whole sequence, not a pairwise comparison. A recording still running
    // belongs to the question being left and must be dropped BEFORE the state
    // describing it is cleared — the coupling `PracticeClient`'s own
    // `onNextQuestion` already relies on.
    expect(order).toEqual([
      "abandonInProgressAnswer",
      "resetAnswerState",
      "invalidateRoomDrafts",
    ]);
  });

  it("touches neither the question bank nor the session scores", () => {
    const { order, callbacks } = makeDuties();
    discardAnswerWork({ origin: "local", ...callbacks });

    // The property chunk C is built on. A language change has no claim on
    // questions or on the rubric average, and this is where that is enforced.
    expect(order).not.toContain("resetQuestions");
    expect(order).not.toContain("markQuestionsStale");
    expect(order).not.toContain("clearSessionScores");
    // Positive control: the absences above are a bounded subset, not a
    // composer that does nothing.
    expect(order).toHaveLength(3);
  });

  it("never abandons a recording or resets answer state on a FOREIGN change (A12)", () => {
    const { order, callbacks } = makeDuties();
    discardAnswerWork({ origin: "foreign", ...callbacks });

    // `resetAnswerState` revokes a finished take's replay URL irreversibly and
    // unmounts the block that currently holds focus. Neither may happen
    // because of a click in a window the candidate is not looking at.
    expect(order).toEqual(["invalidateRoomDrafts"]);
  });

  it("still invalidates room drafts on a foreign change — AC-A12 is origin-blind", () => {
    const { order, callbacks } = makeDuties();
    discardAnswerWork({ origin: "foreign", ...callbacks });
    // Clearing a draft body costs a redraft; the entries, their ids, their
    // text and their buttons all survive. That asymmetry against an abandoned
    // recording IS the basis of the origin split.
    expect(order).toContain("invalidateRoomDrafts");
  });
});

describe("discardQuestionAndScoreWork — what a type moves and a language does not", () => {
  it("resets the question bank and clears the score average on a LOCAL change", () => {
    const { order, callbacks } = makeDuties();
    discardQuestionAndScoreWork({ origin: "local", ...callbacks });

    expect(sorted(order)).toEqual(sorted(["resetQuestions", "clearSessionScores"]));
    expect(order).not.toContain("markQuestionsStale");
  });

  it("defers the question reset on a FOREIGN change and marks the bank stale instead", () => {
    const { order, callbacks } = makeDuties();
    discardQuestionAndScoreWork({ origin: "foreign", ...callbacks });

    // The candidate keeps the question they are mid-answer on; the next
    // request already fetches under the new type.
    expect(order).not.toContain("resetQuestions");
    expect(sorted(order)).toEqual(sorted(["markQuestionsStale", "clearSessionScores"]));
  });

  it("clears the score average on BOTH origins (AC-A11b)", () => {
    // The rubric changed either way — `lengthTarget` and `expectations` both
    // move with the interview type — so a surviving mean averages two
    // incommensurable scales into one number the user reads as a single
    // measure. Deleting it destroys no user-authored content and unmounts
    // nothing, so the origin split does not reach it.
    for (const origin of ["local", "foreign"]) {
      const { order, callbacks } = makeDuties();
      discardQuestionAndScoreWork({ origin, ...callbacks });
      expect(order).toContain("clearSessionScores");
    }
  });
});

describe("discardPracticeWork — both halves, as ONE code path (FD-2)", () => {
  it("runs the question-and-score half before the answer half, on a local change", () => {
    const { order, callbacks } = makeDuties();
    discardPracticeWork({ origin: "local", ...callbacks });

    // Exactly these five, each exactly once. `clearSessionScores`'s position
    // among the others is deliberately free, so it is pinned by membership
    // rather than by index.
    expect(sorted(order)).toEqual(
      sorted([
        "resetQuestions",
        "clearSessionScores",
        "abandonInProgressAnswer",
        "resetAnswerState",
        "invalidateRoomDrafts",
      ]),
    );

    // The constrained order, asserted as a whole filtered sequence — a step
    // that never ran is simply missing from this array and fails `toEqual`.
    // `resetQuestions` running FIRST is load-bearing and not cosmetic: the
    // sample-answer queue effect is harmless on a type change only because
    // `resetQuestions()` blanks `currentQuestion` in the same batched tick.
    expect(order.filter((name) => name !== "clearSessionScores")).toEqual([
      "resetQuestions",
      "abandonInProgressAnswer",
      "resetAnswerState",
      "invalidateRoomDrafts",
    ]);
  });

  it("performs the foreign-origin duty list and nothing more", () => {
    const { order, callbacks } = makeDuties();
    discardPracticeWork({ origin: "foreign", ...callbacks });

    expect(sorted(order)).toEqual(
      sorted(["markQuestionsStale", "clearSessionScores", "invalidateRoomDrafts"]),
    );
    expect(order).not.toContain("abandonInProgressAnswer");
    expect(order).not.toContain("resetAnswerState");
    expect(order).not.toContain("resetQuestions");
  });

  it("produces exactly what calling the two halves in order produces — no third copy", () => {
    // The DIFFERENTIAL test. If `discardPracticeWork` inlines the duty lists,
    // this passes on the day it is written and fails the first time either
    // copy is edited — which is the drift the composition exists to prevent.
    for (const origin of ["local", "foreign"]) {
      const composed = makeDuties();
      discardQuestionAndScoreWork({ origin, ...composed.callbacks });
      discardAnswerWork({ origin, ...composed.callbacks });

      const combined = makeDuties();
      discardPracticeWork({ origin, ...combined.callbacks });

      expect(combined.order).toEqual(composed.order);
    }
  });

  it("DELEGATES to its two halves rather than inlining them", () => {
    // Read from the shipped function itself, not from a file on disk.
    //
    // The property, stated so a legitimate refactor is not forbidden: this
    // composer must not CALL any duty callback ITSELF. Combined with the
    // behavioural cases above — which prove all five duties do run — the only
    // way both can be true is that it forwards to the two halves. That holds
    // for `a(args); b(args);` and equally for `for (const half of HALVES)
    // half(args)`, which is the same property with zero duplication.
    //
    // An earlier revision of this assertion required the two composer NAMES to
    // appear literally, and that rejected the loop form — a correct
    // implementation failing a test is how a test gets deleted, so the shape
    // check is gone and the property check replaced it.
    //
    // Matching only a CALL (`foo()`, `foo?.()`) and not a bare mention is what
    // lets a destructured signature — `discardPracticeWork({ origin,
    // resetQuestions, ... })` that re-forwards them — stay legal.
    const source = discardPracticeWork.toString();
    for (const [name, callPattern] of Object.entries(DUTY_CALLS)) {
      expect(source, `discardPracticeWork must not call ${name} itself`).not.toMatch(callPattern);
    }
  });
});

describe("discardDraftedAnswers — the narrowest seam (FD-3 / amendment A17)", () => {
  it("invalidates the model's drafts, on both origins", () => {
    for (const origin of ["local", "foreign"]) {
      const { order, callbacks } = makeDuties();
      discardDraftedAnswers({ origin, ...callbacks });
      expect(order).toContain("invalidateRoomDrafts");
    }
  });

  it("calls NEITHER resetAnswerState NOR abandonInProgressAnswer, even when both are supplied", () => {
    // THE POINT OF THE SEAM. `resetAnswerState` reaches `revokeReplay()`
    // (`usePracticeAnswer.js:243` -> `:230-236`), which is
    // `URL.revokeObjectURL` and IRREVERSIBLE; `abandonInProgressAnswer`
    // destroys a take still being recorded. Neither has any claim on a
    // code-language change: the recording is the candidate SPEAKING, and no
    // language moves a word of it.
    //
    // A positive test that this discards drafts passes against an
    // implementation that ALSO destroys the take — which is why the negative
    // is written first and the whole sequence is pinned by `toEqual`, so the
    // length is its own positive control and an empty no-op cannot pass.
    for (const origin of ["local", "foreign"]) {
      const { order, callbacks } = makeDuties();
      discardDraftedAnswers({ origin, ...callbacks });
      expect(order).toEqual(["invalidateRoomDrafts"]);
    }
  });

  it("is composed INTO discardAnswerWork, not copied beside it", () => {
    // Three nested scopes, each calling the next:
    // `discardPracticeWork` -> `discardQuestionAndScoreWork` +
    // `discardAnswerWork` -> `discardDraftedAnswers`.
    //
    // Same property form as the composer case above, one level down.
    // `discardAnswerWork` is proven behaviourally to invalidate room drafts
    // (see its own describe block), and is forbidden here from doing so
    // itself — so it must be reaching `discardDraftedAnswers`. Without this,
    // `discardDraftedAnswers` can ship as a dead parallel copy that drifts,
    // at the exact level chunk C consumes.
    expect(discardAnswerWork.toString()).not.toMatch(DUTY_CALLS.invalidateRoomDrafts);
  });

  it("is not a no-op — discardAnswerWork still reaches the drafts through it", () => {
    // The positive half of the case above, stated separately so the two
    // cannot be satisfied together by an implementation that simply stopped
    // invalidating drafts.
    const { order, callbacks } = makeDuties();
    discardAnswerWork({ origin: "foreign", ...callbacks });
    expect(order).toEqual(["invalidateRoomDrafts"]);
  });
});

describe("invalidateLiveAnswers — AC-A12 and AC-A17", () => {
  function makeLiveDuties() {
    const order = [];
    const record = (name) => () => order.push(name);
    return {
      order,
      callbacks: {
        clearAnswerCache: record("clearAnswerCache"),
        bumpDraftGeneration: record("bumpDraftGeneration"),
        redraftCurrentAnswer: record("redraftCurrentAnswer"),
      },
    };
  }

  it("clears the cache, bumps the generation, then redrafts — in that order (AC-A17)", () => {
    const { order, callbacks } = makeLiveDuties();
    invalidateLiveAnswers({ canRedraft: true, ...callbacks });

    // The bump must be ordered strictly BEFORE the redraft captures `gen`, or
    // the redraft supersedes itself and reverts its own card to idle.
    expect(order).toEqual([
      "clearAnswerCache",
      "bumpDraftGeneration",
      "redraftCurrentAnswer",
    ]);
  });

  it("clears and bumps on EVERY origin — those two are never gated", () => {
    // This is the practice-tab -> live direction AC-A12 exists for:
    // `CopilotClient` stays mounted in practice mode, so `answerCacheRef` and
    // `draftGenRef` survive the mode switch and would otherwise serve a
    // stale-format cached answer.
    const { order, callbacks } = makeLiveDuties();
    invalidateLiveAnswers({ canRedraft: false, ...callbacks });

    expect(order).toEqual(["clearAnswerCache", "bumpDraftGeneration"]);
  });

  it("fires no billed model call when canRedraft is false (AC-A15)", () => {
    const { order, callbacks } = makeLiveDuties();
    invalidateLiveAnswers({ canRedraft: false, ...callbacks });
    expect(order).not.toContain("redraftCurrentAnswer");

    // Positive control, without which an `invalidateLiveAnswers` that never
    // redrafts at all satisfies the assertion above.
    const live = makeLiveDuties();
    invalidateLiveAnswers({ canRedraft: true, ...live.callbacks });
    expect(live.order).toContain("redraftCurrentAnswer");
  });
});

describe("interviewTypeChangeAnnouncement — every row of the copy table", () => {
  const base = {
    surface: "practice",
    origin: "local",
    label: "Technical / coding",
    hadRecording: false,
    hadReview: false,
    storageBlocked: false,
  };

  it("practice, local, nothing in flight", () => {
    expect(interviewTypeChangeAnnouncement({ ...base })).toBe(
      "Interview type set to Technical / coding. Practice questions cleared.",
    );
  });

  it("practice, local, a recording was in flight", () => {
    expect(interviewTypeChangeAnnouncement({ ...base, hadRecording: true })).toBe(
      "Interview type set to Technical / coding. Practice questions cleared and your recording was discarded.",
    );
  });

  it("practice, local, a finished take's review was on screen", () => {
    expect(interviewTypeChangeAnnouncement({ ...base, hadReview: true })).toBe(
      "Interview type set to Technical / coding. Practice questions cleared and your last answer's review was closed.",
    );
  });

  it("prefers the recording line when both are true — losing a take is the larger loss", () => {
    expect(
      interviewTypeChangeAnnouncement({ ...base, hadRecording: true, hadReview: true }),
    ).toBe(
      "Interview type set to Technical / coding. Practice questions cleared and your recording was discarded.",
    );
  });

  it("practice, foreign — names what the change already destroyed on screen", () => {
    // `clearSessionScores` and `invalidateRoomDrafts` are BOTH origin-blind
    // (choiceChangeInvalidation.js:66-68, :86-89), so on a foreign change the
    // session average and every room card's drafted answer are gone by the
    // time this is spoken — and nothing else reports it, because
    // `answerStatusMessage("idle")` is `""`. A sentence that said only "it
    // applies from your next question" described the one duty with NO visible
    // effect and contradicted the two with one.
    expect(interviewTypeChangeAnnouncement({ ...base, origin: "foreign" })).toBe(
      "Interview type changed to Technical / coding in another window. Your score average and drafted answers were cleared. The question on screen stays until you ask for the next one.",
    );
  });

  it("live, foreign", () => {
    expect(
      interviewTypeChangeAnnouncement({ ...base, surface: "live", origin: "foreign" }),
    ).toBe(
      "Interview type changed to Technical / coding in another window. The answer on screen was drafted before the change.",
    );
  });

  it("live, local — says nothing, because the answer-status region already reports it", () => {
    expect(
      interviewTypeChangeAnnouncement({ ...base, surface: "live", origin: "local" }),
    ).toBe("");
  });

  it("the storage clause is APPENDED to the row, never substituted for it", () => {
    // Manual-regression MATERIAL: the clause used to return early, so a
    // blocked tab announced a foreign change as "Interview type set to X.
    // Not saved…" — the wrong window, a write that never happened, and the
    // report of what the change destroyed dropped on the ONE change where
    // that report is the only one there is.
    //
    // The separator is a PERIOD, not the em dash the copy table drew. This is
    // the only one of these strings that exists SOLELY to be read aloud, and
    // `—` is silent at default screen-reader punctuation settings
    // (SessionSetup.js:148-150), which turned this row into "Not saved this
    // browser is blocking stored settings."
    expect(
      interviewTypeChangeAnnouncement({ ...base, hadRecording: true, storageBlocked: true }),
    ).toBe(
      "Interview type set to Technical / coding. Practice questions cleared and your recording was discarded. Not saved. This browser is blocking stored settings.",
    );
    expect(
      interviewTypeChangeAnnouncement({ ...base, origin: "foreign", storageBlocked: true }),
    ).toBe(
      "Interview type changed to Technical / coding in another window. Your score average and drafted answers were cleared. The question on screen stays until you ask for the next one. This browser is blocking stored settings.",
    );
  });

  it("says \"Not saved\" only on a LOCAL change — a foreign one was written by the other window", () => {
    // A `storage` event only fires for a write that SUCCEEDED, so a foreign
    // change is proof that something was saved. Claiming otherwise tells the
    // user their colleague's window lost a write it did not lose. The browser
    // fact still gets said, because it is still true of THIS tab.
    for (const surface of ["live", "practice"]) {
      const foreign = interviewTypeChangeAnnouncement({ ...base, surface, origin: "foreign", storageBlocked: true });
      expect(foreign).toContain("This browser is blocking stored settings.");
      expect(foreign).not.toContain("Not saved");

      const local = interviewTypeChangeAnnouncement({ ...base, surface, origin: "local", storageBlocked: true });
      expect(local).toContain("Not saved. This browser is blocking stored settings.");
    }
  });

  it("gives the clause a subject on the live/local row, which is otherwise empty", () => {
    // The one row with nothing to append to. Without the fallback lead this
    // would be a bare " Not saved. …" — and this is the exact sentence the
    // pre-composition code produced, so the live surface is unchanged.
    expect(
      interviewTypeChangeAnnouncement({ ...base, surface: "live", origin: "local", storageBlocked: true }),
    ).toBe("Interview type set to Technical / coding. Not saved. This browser is blocking stored settings.");
  });

  it("every storage-blocked row carries the phrase the latch owner matches on", () => {
    // `claimStorageAnnouncement` recognises the clause by this substring. A
    // row that composed it differently would slip past the latch and be
    // spoken on every change for the rest of the tab's life.
    for (const surface of ["live", "practice"]) {
      for (const origin of ["local", "foreign"]) {
        for (const hadRecording of [false, true]) {
          expect(
            interviewTypeChangeAnnouncement({ ...base, surface, origin, hadRecording, storageBlocked: true }),
          ).toContain("blocking stored settings");
        }
      }
    }
  });

  it("names the type it was handed, rather than any single hardcoded label", () => {
    // Without this every string above is satisfiable by a constant.
    expect(interviewTypeChangeAnnouncement({ ...base, label: "System design" })).toBe(
      "Interview type set to System design. Practice questions cleared.",
    );
  });
});
