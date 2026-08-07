// AC-N2: practice mode's repeat loop, with the clicks taken out of it.
//
// Reported: "the workflow for the practice page needs to be a lot less clicks.
// next question should kick off the 'start answering' and should also queue up
// the sample answer". Today one rep costs Next question -> Start answering ->
// Done, plus a fourth click and a wait if the sample answer is wanted. After
// this it costs Next question -> Done, and the sample answer is already there.
//
// Both decisions live here as plain functions rather than inside PracticeClient
// for the reason that file's own header already gives: this repo runs vitest
// with `environment: "node"` and no jsdom, so a decision embedded in a
// component or an effect cannot be tested at all. The wiring stays in React;
// the rules are here.
//
// The hard part is not "start recording" — it is that the question arrives
// ASYNCHRONOUSLY. `onNextQuestion` fires a fetch; the question lands some time
// later, and only then is there anything to answer. So the press ARMS the
// intent and the arrival consumes it, which means every way the arrival can go
// wrong has to be answered explicitly: the fetch fails, the bank is exhausted,
// the session was never live, the user hit Start answering manually in the
// gap. Each of those must DISARM rather than leave a press pending that fires
// minutes later, at the worst possible moment, in a recorded practice session.

import { describe, it, expect } from "vitest";

import { autoStartDecision, shouldQueueSampleAnswer } from "./practiceFlow.js";

// A question has landed, the capture session is live, nothing is recording:
// the case the whole feature exists for. `armedFrom` is what was on screen at
// the moment the press armed — a NEW question is the only evidence the fetch
// actually delivered one.
const LANDED = {
  armed: true,
  armedFrom: "Why do you want this job?",
  status: "live",
  question: "Tell me about yourself.",
  loading: false,
  answering: false,
  settling: false,
};

describe("autoStartDecision", () => {
  it("starts recording once the question a press was waiting for lands", () => {
    expect(autoStartDecision(LANDED)).toBe("start");
  });

  it("does nothing at all when no press is waiting", () => {
    expect(autoStartDecision({ ...LANDED, armed: false })).toBe("wait");
    // Not armed outranks every other condition — an unarmed state must never
    // produce a start, whatever else is true.
    expect(autoStartDecision({ ...LANDED, armed: false, loading: true })).toBe("wait");
    expect(autoStartDecision({ armed: false, status: "idle", question: "", loading: false })).toBe("wait");
  });

  it("keeps waiting while the question is still in flight", () => {
    expect(autoStartDecision({ ...LANDED, loading: true, question: "" })).toBe("wait");
    // The PREVIOUS question is still on screen while the next one loads —
    // `question` being non-empty is not evidence the new one has arrived, so
    // `loading` has to win. Starting here would record an answer to the
    // question the user just moved off.
    expect(autoStartDecision({ ...LANDED, loading: true })).toBe("wait");
  });

  // Everything below disarms rather than waits. A press that stays pending is
  // the dangerous state: the recorder would fire on some later, unrelated
  // render — during a different question, or after the user walked away.
  it("disarms when the question never arrives", () => {
    // The bank is exhausted: loading finished and the route genuinely returned
    // nothing.
    expect(autoStartDecision({ ...LANDED, question: "", loading: false })).toBe("disarm");
    expect(autoStartDecision({ ...LANDED, question: "   ", loading: false })).toBe("disarm");
  });

  // Found by the regression pass, and the reason `armedFrom` exists at all.
  // `usePracticeQuestions`'s catch sets an error and DELIBERATELY leaves
  // `currentQuestion` in place (its own comment says so), so a failed fetch
  // does not produce an empty question — it produces the PREVIOUS one, with
  // `loading` back to false. Judging arrival by "is there a question" therefore
  // fires the recorder on the question the user just moved off, in a session
  // that may be recording video. The only sound evidence a fetch delivered is
  // that the question CHANGED.
  it("disarms when the fetch fails and the previous question is still on screen", () => {
    expect(autoStartDecision({ ...LANDED, question: LANDED.armedFrom })).toBe("disarm");
    // Normalized the same way the rest of the flow compares questions, so
    // whitespace and case cannot masquerade as a new question.
    expect(autoStartDecision({ ...LANDED, question: `  ${LANDED.armedFrom.toUpperCase()}  ` })).toBe("disarm");
  });

  // The first question of a session has nothing before it, so "unchanged"
  // cannot be the test there — an empty `armedFrom` with a real question is a
  // genuine arrival.
  it("starts on the first question of a session, which has no predecessor", () => {
    expect(autoStartDecision({ ...LANDED, armedFrom: "" })).toBe("start");
    expect(autoStartDecision({ ...LANDED, armedFrom: undefined })).toBe("start");
  });

  it("disarms rather than starting when the capture session is not live", () => {
    // The user can press Next question before ever starting the session. The
    // question should appear and simply wait for them — auto-start must not
    // lie in wait and fire the moment they press Start session, which they
    // would experience as the recorder starting on its own.
    for (const status of ["idle", "starting", "stopped", "error", undefined]) {
      expect(autoStartDecision({ ...LANDED, status })).toBe("disarm");
    }
  });

  it("disarms rather than double-starting when something is already recording", () => {
    // The user hit Start answering manually in the gap while the question was
    // loading. Starting again would abandon the take already in progress.
    expect(autoStartDecision({ ...LANDED, answering: true })).toBe("disarm");
    // Settling is the post-Done drain: still not a moment to start a new take.
    expect(autoStartDecision({ ...LANDED, settling: true })).toBe("disarm");
  });

  it("is a pure function of its arguments", () => {
    const input = { ...LANDED };
    const snapshot = JSON.parse(JSON.stringify(input));
    expect(autoStartDecision(input)).toBe(autoStartDecision(input));
    expect(input).toEqual(snapshot);
  });

  it("never throws on a missing or malformed argument", () => {
    expect(autoStartDecision()).toBe("wait");
    expect(autoStartDecision({})).toBe("wait");
    expect(autoStartDecision({ armed: true })).toBe("disarm");
  });
});

describe("shouldQueueSampleAnswer", () => {
  const QUEUEABLE = {
    question: "Tell me about a time you disagreed with your manager.",
    loading: false,
    visible: false,
    hasCached: false,
    queuedFor: "",
  };

  it("queues a draft for a question that has just landed", () => {
    expect(shouldQueueSampleAnswer(QUEUEABLE)).toBe(true);
  });

  it("never queues while the question is still loading, or when there is none", () => {
    expect(shouldQueueSampleAnswer({ ...QUEUEABLE, loading: true })).toBe(false);
    expect(shouldQueueSampleAnswer({ ...QUEUEABLE, question: "" })).toBe(false);
    expect(shouldQueueSampleAnswer({ ...QUEUEABLE, question: "   " })).toBe(false);
  });

  // The whole point is that the draft is READY, not that it is SHOWN. Practice
  // mode hides the sample answer behind a reveal on purpose — seeing a model
  // answer before attempting one is what makes practice worthless — so queuing
  // writes the cache and nothing else. This case guards the boundary from the
  // other side: when the panel is already open, the reveal path owns the
  // request and queuing must keep out of it.
  it("stays out of the way when the answer is already on screen", () => {
    expect(shouldQueueSampleAnswer({ ...QUEUEABLE, visible: true })).toBe(false);
  });

  it("does not pay for a draft that is already cached", () => {
    expect(shouldQueueSampleAnswer({ ...QUEUEABLE, hasCached: true })).toBe(false);
  });

  // Without this the queue re-fires on every render for the same question,
  // and each one is a paid model call.
  it("queues each question at most once", () => {
    expect(shouldQueueSampleAnswer({ ...QUEUEABLE, queuedFor: QUEUEABLE.question })).toBe(false);
    // Matched the same way the cache is keyed, so trivial differences in case
    // and whitespace are the same question — otherwise a re-render that
    // re-normalized the text would pay twice.
    expect(shouldQueueSampleAnswer({ ...QUEUEABLE, queuedFor: "  tell me about a TIME you disagreed with your manager.  " })).toBe(false);
    // A genuinely different question still queues.
    expect(shouldQueueSampleAnswer({ ...QUEUEABLE, queuedFor: "Why do you want this job?" })).toBe(true);
  });

  it("is pure and never throws on a missing or malformed argument", () => {
    expect(shouldQueueSampleAnswer()).toBe(false);
    expect(shouldQueueSampleAnswer({})).toBe(false);
    const input = { ...QUEUEABLE };
    const snapshot = JSON.parse(JSON.stringify(input));
    expect(shouldQueueSampleAnswer(input)).toBe(shouldQueueSampleAnswer(input));
    expect(input).toEqual(snapshot);
  });
});

describe("the two decisions are independent", () => {
  // Queuing a draft must not depend on the session being live or on a press
  // being armed: a question reached any other way (Retry, a posting change,
  // the first question of a session) still wants its answer ready. Equally,
  // auto-start must not wait on the draft — the recorder starting must never
  // be gated on a network call to a model.
  it("queues for a question that will not auto-start", () => {
    const notLive = { armed: true, status: "idle", question: "Why this role?", loading: false, answering: false, settling: false };
    expect(autoStartDecision(notLive)).toBe("disarm");
    expect(
      shouldQueueSampleAnswer({ question: notLive.question, loading: false, visible: false, hasCached: false, queuedFor: "" }),
    ).toBe(true);
  });
});
