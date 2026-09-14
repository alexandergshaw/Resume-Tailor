// @vitest-environment jsdom
//
// AC-Q7: the WIRING half of practice mode's "download a log of this
// session" — the recorder (lib/copilot/sessionLog.js) and the archive
// builder (lib/copilot/sessionLogArchive.js) are already covered by their
// own tests and are reused here unmodified. Mirrors
// app/copilot/useLiveSession.log.test.js's own discipline: a probe mounted
// with react-dom/client's createRoot and React 19's `act`, the network/
// archive module mocked, and assertions made only through the hook's own
// returned surface (sessionLogSnapshot()/downloadLog()/hasLog/onStart) —
// never on an internal, never on a prop having merely been passed.
//
// usePracticeSessionLog OBSERVES reactive values instead of owning the
// capture/question/answer pipelines itself (those three hooks are not among
// this feature's files — see usePracticeSessionLog.js's own header), so
// this harness drives it the same way PracticeClient's real re-renders
// would: by re-rendering the probe with updated props as
// usePracticeCaptureSession/usePracticeQuestions/usePracticeAnswer's own
// state would actually change.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createElement, act } from "react";
import { createRoot } from "react-dom/client";

vi.mock("@/lib/copilot/sessionLogArchive", () => ({
  downloadSessionLogArchive: vi.fn(() => Promise.resolve()),
}));

import { usePracticeSessionLog } from "./usePracticeSessionLog.js";
import { downloadSessionLogArchive } from "@/lib/copilot/sessionLogArchive";
// Real renderer, not mocked — this file only mocks sessionLogArchive above.
// The end-to-end regression test below deliberately feeds this hook's REAL
// recorded snapshot into sessionLog.js's REAL renderSessionLogMarkdown: an
// emit/filter event-name mismatch (this hook emitting one type string,
// sessionLog.js's Markdown builder filtering on another) is invisible to a
// test that only inspects the hook's own snapshot, or one that only feeds
// the renderer a hand-built fixture already using the "right" name.
import { renderSessionLogMarkdown } from "@/lib/copilot/sessionLog";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const BASE_PROPS = {
  start: () => {},
  posting: null,
  interviewType: "general",
  currentQuestionText: "",
  questionError: "",
  finals: [],
  captureError: "",
  captureWarning: "",
  answering: false,
  answerMetrics: null,
  critique: null,
  critiqueStatus: "idle",
  critiqueError: "",
};

function Probe({ hookProps, onState }) {
  const state = usePracticeSessionLog(hookProps);
  onState(state);
  return null;
}

// Drives the hook by re-rendering with an evolving props object, the same
// way PracticeClient's own composed state actually changes over time —
// `update` merges onto whatever is currently mounted rather than resetting
// to BASE_PROPS each time, so a sequence of updates reads like a real
// session unfolding.
function mountProbe() {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  const captured = {};
  let current = { ...BASE_PROPS };

  function renderNow() {
    act(() => {
      root.render(createElement(Probe, { hookProps: current, onState: (s) => Object.assign(captured, s) }));
    });
  }
  renderNow();

  return {
    captured,
    update(patch) {
      current = { ...current, ...patch };
      renderNow();
      return captured;
    },
  };
}

function eventsOfType(snapshot, type) {
  return (snapshot?.events || []).filter((e) => e.type === type);
}

// Isolates the "Questions and drafted answers" section from the rest of the
// rendered document, the same way the existing end-to-end test below already
// does — shared here because several new tests below need it too.
function questionsSectionOf(markdown) {
  return markdown.split("## Questions and drafted answers")[1].split("## Diagnostics")[0];
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  document.body.innerHTML = "";
});

describe("opening the log (AC-Q7.1)", () => {
  it("opens a fresh log with mode: practice the moment Start is pressed, and calls the real start", () => {
    const start = vi.fn();
    const { captured, update } = mountProbe();
    update({ start });

    expect(captured.hasLog).toBe(false);
    act(() => captured.onStart());

    expect(captured.hasLog).toBe(true);
    expect(start).toHaveBeenCalledTimes(1);
    const snap = captured.sessionLogSnapshot();
    expect(snap).toBeTruthy();
    expect(snap.mode).toBe("practice");
    expect(eventsOfType(snap, "session.start")).toHaveLength(1);
  });

  it("throws nothing when asked for a log before any session ran", () => {
    const { captured } = mountProbe();
    expect(() => captured.sessionLogSnapshot()).not.toThrow();
    expect(captured.sessionLogSnapshot()).toBeNull();
  });

  it("does not let a second session's log inherit the first one's events", () => {
    const { captured, update } = mountProbe();
    act(() => captured.onStart());
    update({ finals: [{ id: 1, speaker: "you", text: "first session speech", at: 1 }] });
    expect(eventsOfType(captured.sessionLogSnapshot(), "transcript")).toHaveLength(1);

    act(() => captured.onStart()); // a fresh "Start practice" press
    const snap2 = captured.sessionLogSnapshot();
    expect(eventsOfType(snap2, "transcript")).toHaveLength(0);
    expect(eventsOfType(snap2, "session.start")).toHaveLength(1);
  });

  it("counts a fresh session's transcript frames from zero, not from where the last session left off", () => {
    // The fragile way to get this wrong: track "how many finals have been
    // logged so far" without resetting that counter on a new session, which
    // silently swallows the new session's first N frames once N ==
    // whatever the previous session already logged.
    const { captured, update } = mountProbe();
    act(() => captured.onStart());
    update({
      finals: [
        { id: 1, speaker: "you", text: "a", at: 1 },
        { id: 2, speaker: "you", text: "b", at: 2 },
        { id: 3, speaker: "you", text: "c", at: 3 },
      ],
    });
    expect(eventsOfType(captured.sessionLogSnapshot(), "transcript")).toHaveLength(3);

    act(() => captured.onStart());
    update({ finals: [] }); // usePracticeCaptureSession resets `finals` on start()
    update({ finals: [{ id: 1, speaker: "you", text: "only this one", at: 1 }] });
    const frames = eventsOfType(captured.sessionLogSnapshot(), "transcript");
    expect(frames).toHaveLength(1);
    expect(frames[0].text).toBe("only this one");
  });
});

describe("what gets recorded (AC-Q7.2)", () => {
  it("records each question served, but not the same text served twice in a row", () => {
    const { captured, update } = mountProbe();
    act(() => captured.onStart());
    update({ currentQuestionText: "Tell me about a conflict." });
    update({ currentQuestionText: "Tell me about a conflict." }); // unrelated re-render, same text
    update({ currentQuestionText: "Describe a time you led." });

    // Emitted as "question.added" — the same type name live mode uses (see
    // useQuestionPipeline.js) and the one sessionLog.js's Markdown renderer
    // actually groups into "Questions and drafted answers".
    const served = eventsOfType(captured.sessionLogSnapshot(), "question.added");
    expect(served.map((e) => e.question)).toEqual([
      "Tell me about a conflict.",
      "Describe a time you led.",
    ]);
  });

  it("records each finalized transcript frame, in order, with its own text", () => {
    const { captured, update } = mountProbe();
    act(() => captured.onStart());
    update({ finals: [{ id: 1, speaker: "you", text: "first line", at: 1 }] });
    update({
      finals: [
        { id: 1, speaker: "you", text: "first line", at: 1 },
        { id: 2, speaker: "you", text: "second line", at: 2 },
      ],
    });

    const frames = eventsOfType(captured.sessionLogSnapshot(), "transcript");
    expect(frames.map((f) => f.text)).toEqual(["first line", "second line"]);
    expect(frames.every((f) => f.isFinal === true)).toBe(true);
  });

  it("records when an answer recording starts and stops", () => {
    const { captured, update } = mountProbe();
    act(() => captured.onStart());
    update({ answering: true });
    update({ answering: false });

    const snap = captured.sessionLogSnapshot();
    expect(eventsOfType(snap, "answer.recording.start")).toHaveLength(1);
    expect(eventsOfType(snap, "answer.recording.stop")).toHaveLength(1);
  });

  it("records the delivery metrics derived for an answer", () => {
    const { captured, update } = mountProbe();
    act(() => captured.onStart());
    const metrics = { wpm: 118, fillerRate: 0.03 };
    update({ answerMetrics: metrics });

    const events = eventsOfType(captured.sessionLogSnapshot(), "answer.metrics");
    expect(events).toHaveLength(1);
    expect(events[0].metrics.wpm).toBe(118);
  });

  it("records the critique returned for an answer", () => {
    const { captured, update } = mountProbe();
    act(() => captured.onStart());
    update({ critique: { score: 82, strengths: ["Clear structure"] }, critiqueStatus: "done" });

    const events = eventsOfType(captured.sessionLogSnapshot(), "answer.critique");
    expect(events).toHaveLength(1);
    expect(events[0].critique.score).toBe(82);
  });

  it("records a critique failure as a failure, not as silence", () => {
    const { captured, update } = mountProbe();
    act(() => captured.onStart());
    update({ critiqueStatus: "error", critiqueError: "Could not analyze this answer." });

    const events = eventsOfType(captured.sessionLogSnapshot(), "answer.critique.error");
    expect(events).toHaveLength(1);
    expect(events[0].message).toBe("Could not analyze this answer.");
  });

  it("records a question-fetch error the user was shown", () => {
    const { captured, update } = mountProbe();
    act(() => captured.onStart());
    update({ questionError: "Could not get the next question." });

    const events = eventsOfType(captured.sessionLogSnapshot(), "question.error");
    expect(events).toHaveLength(1);
    expect(events[0].message).toBe("Could not get the next question.");
  });

  it("records a session error and warning the user was shown", () => {
    const { captured, update } = mountProbe();
    act(() => captured.onStart());
    update({ captureError: "Could not start practice." });
    update({ captureWarning: "Your camera stopped sending frames." });

    const snap = captured.sessionLogSnapshot();
    expect(eventsOfType(snap, "session.error")).toHaveLength(1);
    expect(eventsOfType(snap, "session.warning")).toHaveLength(1);
  });
});

describe("posting and interview type as context (AC-Q7.3)", () => {
  it("records the selected posting and interview type once, by id and name only", () => {
    const posting = {
      id: "app-1",
      title: "Backend Engineer",
      company: "Acme",
      description: "the full posting body, several paragraphs long",
    };
    const { captured, update } = mountProbe();
    update({ posting, interviewType: "behavioral" });
    act(() => captured.onStart());

    const snap = captured.sessionLogSnapshot();
    const started = eventsOfType(snap, "session.start");
    expect(started).toHaveLength(1);
    expect(started[0].posting).toEqual({ id: "app-1", name: "Backend Engineer" });
    expect(started[0].interviewType).toBe("behavioral");
    // Never the posting's own description text anywhere in the log.
    expect(JSON.stringify(snap)).not.toContain("the full posting body");
  });

  it("records nothing about a résumé or cover letter — this hook is never handed either", () => {
    // There is no prop through which document text could even reach this
    // hook (see usePracticeSessionLog.js's own signature) — this test pins
    // that as a contract, not just an accident of what happens to be wired
    // today.
    const posting = { id: "app-2", title: "Data Analyst" };
    const { captured, update } = mountProbe();
    update({ posting, interviewType: "general" });
    act(() => captured.onStart());
    const started = eventsOfType(captured.sessionLogSnapshot(), "session.start")[0];
    expect(Object.keys(started.posting).sort()).toEqual(["id", "name"]);
  });
});

describe("downloading it (AC-Q7.4)", () => {
  it("hands the CURRENT snapshot to the archive, on one call", async () => {
    const { captured, update } = mountProbe();
    act(() => captured.onStart());
    update({ finals: [{ id: 1, speaker: "you", text: "hello there", at: 1 }] });

    await act(async () => {
      await captured.downloadLog();
    });

    expect(downloadSessionLogArchive).toHaveBeenCalledTimes(1);
    const passed = downloadSessionLogArchive.mock.calls[0][0];
    expect(passed.mode).toBe("practice");
    expect(eventsOfType(passed, "transcript")).toHaveLength(1);
  });

  it("still downloads after the session has been stopped", async () => {
    // "Stop" tears down usePracticeCaptureSession's own state; nothing in
    // this hook is wired to session status, so the log it already opened
    // simply keeps existing.
    const { captured, update } = mountProbe();
    act(() => captured.onStart());
    update({ finals: [{ id: 1, speaker: "you", text: "hello there", at: 1 }] });
    update({ answering: false }); // no-op transition, standing in for "session stopped"

    await act(async () => {
      await captured.downloadLog();
    });

    expect(downloadSessionLogArchive).toHaveBeenCalledTimes(1);
    expect(eventsOfType(downloadSessionLogArchive.mock.calls[0][0], "transcript")).toHaveLength(1);
  });

  it("does not blow up when asked to download before any session ran", async () => {
    const { captured } = mountProbe();
    await act(async () => {
      await captured.downloadLog();
    });
    // Declining silently (rather than throwing) is the implementer's call,
    // mirroring useLiveSession.log.test.js's own equivalent case — but it
    // must not have handed `downloadSessionLogArchive` a null/undefined
    // snapshot either.
    expect(downloadSessionLogArchive).not.toHaveBeenCalled();
  });
});

describe("end to end: a served question actually reaches the rendered log", () => {
  // Regression test for the defect where practice mode's session log always
  // rendered "_No questions were detected._" regardless of how many
  // questions were served: this hook emitted "question.served" while
  // sessionLog.js's renderer grouped "Questions and drafted answers" by
  // "question.added" only. Drives the REAL recorder (this hook, backed by
  // sessionLog.js's real createSessionLog — never mocked in this file) and
  // the REAL renderer (renderSessionLogMarkdown, imported unmocked above)
  // end to end, so a producer/consumer event-name mismatch like that one
  // cannot hide behind a fixture that already uses the "right" name.
  it("puts a served question's text in 'Questions and drafted answers', not the empty-state line", () => {
    const { captured, update } = mountProbe();
    act(() => captured.onStart());
    update({ currentQuestionText: "Tell me about a conflict." });

    const snapshot = captured.sessionLogSnapshot();
    const markdown = renderSessionLogMarkdown(snapshot, {});

    const questionsSection = markdown
      .split("## Questions and drafted answers")[1]
      .split("## Diagnostics")[0];

    expect(questionsSection).toContain("Tell me about a conflict.");
    expect(markdown).not.toContain("_No questions were detected._");
  });
});

describe("end to end: a practice answer's metrics and critique reach the rendered log (AC-Q2.3)", () => {
  // Regression test for the defect where every practice question rendered
  // "_No answer drafted._" beneath it even when the candidate answered and a
  // critique was recorded: sessionLog.js's renderer only ever named
  // "answer.done" (a live-mode-only event practice never emits), while this
  // hook records the same facts as "answer.metrics"/"answer.critique". Drives
  // the REAL recorder (this hook, backed by sessionLog.js's real
  // createSessionLog) and the REAL renderer (renderSessionLogMarkdown,
  // imported unmocked above) end to end — the join the original defect fell
  // through, because the producer's own tests only ever asserted its own
  // event names and the renderer's own tests only ever fed it fixtures that
  // already used the "right" names.
  it("puts the answer's recorded delivery metrics and critique under its question, not the empty-state line", () => {
    const { captured, update } = mountProbe();
    act(() => captured.onStart());
    update({ currentQuestionText: "Tell me about a conflict." });
    update({ answering: true });
    update({ answering: false });
    update({ answerMetrics: { wpm: 142, fillerCount: 6, seconds: 88 } });
    update({
      critique: { score: 88, strengths: ["Strong STAR structure"] },
      critiqueStatus: "done",
    });

    const markdown = renderSessionLogMarkdown(captured.sessionLogSnapshot(), {});
    const questionsSection = questionsSectionOf(markdown);

    expect(questionsSection).toContain("142");
    expect(questionsSection).toContain("Strong STAR structure");
    expect(questionsSection).not.toContain("_No answer drafted._");

    // AC-Q2.4: the same fact must not ALSO print in Diagnostics — each event
    // still renders in exactly one place.
    const diagnostics = markdown.slice(markdown.indexOf("## Diagnostics"));
    expect(diagnostics).not.toContain("142");
    expect(diagnostics).not.toContain("Strong STAR structure");
  });
});

describe("undefined === undefined collapse guard, driven through the real hook (AC-Q2.3 guard)", () => {
  // The naive way to fix the defect above is to make practice emit a SINGLE
  // id-less event the renderer correlates by `e.id === q.id` with no
  // presence check: since practice questions also carry no id,
  // `undefined === undefined` is true and the one answer collapses onto
  // EVERY question in the log. This drives the REAL hook (which mints and
  // freezes a real per-question id — see usePracticeSessionLog.js) into the
  // REAL renderer and proves a later, unanswered question never inherits an
  // earlier one's answer.
  it("does not let one question's answer bleed into a later, unanswered question", () => {
    const { captured, update } = mountProbe();
    act(() => captured.onStart());

    update({ currentQuestionText: "Tell me about a conflict." });
    update({ answering: true });
    update({ answering: false });
    update({ answerMetrics: { wpm: 142, fillerCount: 6, seconds: 88 } });
    update({
      critique: { score: 88, strengths: ["Strong STAR structure"] },
      critiqueStatus: "done",
    });

    // Q2 served, left completely unanswered.
    update({ currentQuestionText: "Describe a time you led." });

    const questionsSection = questionsSectionOf(
      renderSessionLogMarkdown(captured.sessionLogSnapshot(), {}),
    );
    const q2Block = questionsSection.slice(questionsSection.indexOf("Describe a time you led."));

    expect(q2Block).toContain("_No answer drafted._");
    expect(q2Block).not.toContain("142");
    expect(q2Block).not.toContain("Strong STAR structure");
  });
});

describe("collision: identical question text must not cross-contaminate (AC-Q2.3)", () => {
  // Two DIFFERENT questions in the same session can carry IDENTICAL text —
  // nothing dedupes a manually-typed question against an earlier one, and
  // this hook's own "not the same text served twice in a row" guard only
  // blocks CONSECUTIVE repeats. Correlating by text instead of a minted id
  // would make the second occurrence silently inherit the first's answer.
  it("gives two questions with the same text two different ids, each showing only its own answer", () => {
    const { captured, update } = mountProbe();
    act(() => captured.onStart());

    update({ currentQuestionText: "Tell me about yourself." });
    update({ answering: true });
    update({ answering: false });
    update({ answerMetrics: { wpm: 100 } });

    update({ currentQuestionText: "Describe your strengths." }); // distinct, intervening question
    update({ currentQuestionText: "Tell me about yourself." }); // same text again, not consecutive

    const questionsSection = questionsSectionOf(
      renderSessionLogMarkdown(captured.sessionLogSnapshot(), {}),
    );
    const occurrences = questionsSection.split("Tell me about yourself.");
    expect(occurrences).toHaveLength(3); // exactly two headings with this text

    expect(occurrences[1]).toContain("100"); // the FIRST occurrence's own metrics
    expect(occurrences[2]).toContain("_No answer drafted._"); // the SECOND, unanswered
    expect(occurrences[2]).not.toContain("100");
  });
});

describe("collision: the same question answered twice shows the latest attempt (AC-Q2.3, 'Try again')", () => {
  // "Try again" re-answers the SAME question without currentQuestionText
  // changing, so no new question.added fires and both attempts' events are
  // tagged with the same id. "Try again" exists specifically so the
  // candidate's SECOND attempt is the one judged — a naive `.find` (first
  // match) would show the first, discarded attempt forever.
  it("replaces the first attempt's metrics and critique with the second, not both", () => {
    const { captured, update } = mountProbe();
    act(() => captured.onStart());

    update({ currentQuestionText: "Tell me about a conflict." });

    update({ answering: true });
    update({ answering: false });
    update({ answerMetrics: { wpm: 111 } });
    update({ critique: { strengths: ["Attempt one weak"] }, critiqueStatus: "done" });

    // "Try again": currentQuestionText is unchanged, so the same id is
    // re-captured for this second recording.
    update({ answering: true });
    update({ answering: false });
    update({ answerMetrics: { wpm: 222 } });
    update({ critique: { strengths: ["Attempt two strong"] }, critiqueStatus: "done" });

    const questionsSection = questionsSectionOf(
      renderSessionLogMarkdown(captured.sessionLogSnapshot(), {}),
    );

    expect(questionsSection).toContain("222");
    expect(questionsSection).toContain("Attempt two strong");
    expect(questionsSection).not.toContain("111");
    expect(questionsSection).not.toContain("Attempt one weak");
  });
});
