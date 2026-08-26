// @vitest-environment jsdom
//
// P2/P4. The regression test for "applyAnswerFinal deletes the last sentence
// of every practice answer", written at the level the defect actually lives.
//
// WHY THIS FILE EXISTS AT ALL. The defect was a composition: `applyAnswerFinal`
// re-evaluated a backfilled span against BOTH ends of the answer window, and
// `doneAnswer` froze `answerEnd` to an audio clock that, on ElevenLabs, is
// systematically one whole utterance stale — because the clock only advances
// on frames carrying numeric `start` AND `duration`, and on that provider the
// only frame that ever carries both is the `*_with_timestamps` member of a
// commit pair. Each half is defensible read alone. Together they drop the
// final sentence of every answer, and every pure unit test stayed green.
//
// Nobody wrote this test because two source comments said it could not be
// written: `answerWindow.js` and `usePracticeAnswer.js` both claimed this repo
// runs `environment: "node"` with "no jsdom anywhere, and a rule that cannot
// be mounted cannot be falsified". That was false when it was written. `jsdom`
// is a devDependency, `vitest.config.js` documents the per-file
// `// @vitest-environment jsdom` docblock as the supported opt-in, and
// `app/copilot/useLiveSession.cues.test.js` had been mounting a real hook for
// some time — the same remediation that added the second copy of the claim
// added three more jsdom-opt-in hook tests beside it. Those comments are
// corrected; this file is the test they were the stated reason for skipping.
//
// Everything with a recorder, a camera, a network call or a database is
// mocked. `applyAnswerFinal`, `answerMetricsInputs`, `computeAnswerMetrics`
// and the hook itself are the REAL modules — the wiring between them is the
// entire claim under test.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createElement, act } from "react";
import { createRoot } from "react-dom/client";

// Reproduces the real class's shape closely enough for this hook: one
// instance is reused for a whole session, stop() resolves the recording. No
// blob is returned, so nothing here needs URL.createObjectURL.
vi.mock("@/lib/copilot/answerRecorder", () => ({
  AnswerRecorder: class FakeAnswerRecorder {
    constructor() {
      this.supported = true;
      this.mimeType = "video/webm";
      this.live = false;
    }

    start() {
      this.live = true;
    }

    async stop() {
      this.live = false;
      return null;
    }
  },
}));

// Only the sampler is replaced — it wants a real <video> and a canvas, which
// jsdom does not have. `summarizeVideoStats` stays real for every other
// importer (answerMetrics.js and critiqueLocal.js both read it from here).
vi.mock("@/lib/copilot/videoStats", async (importOriginal) => ({
  ...(await importOriginal()),
  VideoFrameSampler: class FakeVideoFrameSampler {
    start() {}
    stop() {
      return { summary: null, frames: [] };
    }
  },
}));

vi.mock("@/lib/copilot/bodyLandmarks", () => ({
  BodyLanguageSampler: class FakeBodyLanguageSampler {
    start() {}
    stop() {
      return { available: false, reason: "no-samples" };
    }
  },
}));

vi.mock("@/lib/copilot/critiqueClient", () => ({
  critiqueAnswer: vi.fn(async () => ({
    score: 70,
    verdict: "fine",
    strengths: [],
    improvements: [],
    missing: [],
    star: null,
    delivery: [],
    source: "gemini",
  })),
}));

vi.mock("@/lib/supabase/practiceAnswers", () => ({
  savePracticeAnswer: vi.fn(),
  updatePracticeAnswerCritique: vi.fn(),
}));

import { usePracticeAnswer } from "./usePracticeAnswer.js";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let container;
let root;
let api;

function Probe() {
  api = usePracticeAnswer();
  return null;
}

beforeEach(async () => {
  vi.useFakeTimers();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root.render(createElement(Probe));
  });
});

afterEach(async () => {
  await act(async () => {
    root.unmount();
  });
  container.remove();
  vi.useRealTimers();
});

const STREAM = { id: "fake-stream", getTracks: () => [] };

// The two frames ElevenLabs actually delivers for ONE committed utterance,
// in the order the live service sends them (verified against a recorded
// session in R-261): the text arrives first with no timing at all, and its
// timed twin follows flagged `textAlreadyDelivered`.
function untimed(transcript) {
  return { isFinal: true, transcript };
}
function timedTwin(transcript, start, duration) {
  return { isFinal: true, transcript, start, duration, textAlreadyDelivered: true };
}

async function feed(frame) {
  await act(async () => {
    api.recordTranscriptEvent(frame);
  });
}

// Lets the hook's own promise chain settle under fake timers. `doneAnswer`
// awaits a DRAIN_MS (1800ms) timer that never fires on its own here, and a
// raw `setTimeout(resolve, 0)` would not fire either — so every settle step
// has to advance the fake clock.
async function advance(ms) {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

describe("usePracticeAnswer — an ElevenLabs answer keeps its last sentence (P2)", () => {
  it("drives Start, three commit pairs, Done and the drain, and loses none of them", async () => {
    // Speech before the answer: an interviewer finishing the previous
    // question. It advances the audio clock to 10 without being collected,
    // which is what makes `answerStart` a real lower bound rather than 0.
    await feed({ isFinal: true, transcript: "…and that was the last question.", start: 7, duration: 3 });

    await act(async () => {
      api.startAnswer(STREAM);
    });

    // Two complete pairs. Each contributes ONE entry, and each timed twin
    // advances the audio clock to the end of its own utterance.
    await feed(untimed("I led the migration."));
    await feed(timedTwin("I led the migration.", 10, 3));
    await feed(untimed("We cut latency in half."));
    await feed(timedTwin("We cut latency in half.", 13, 3));

    // The third utterance's TEXT lands, and the candidate presses Done
    // before its timed twin has arrived. This is not a contrived ordering:
    // it is the ordinary one. The twin lags the text by the provider's own
    // commit cadence, and pressing Done the moment you stop speaking is what
    // the button is for — which is exactly why `doneAnswer` keeps
    // `collecting` true through the drain.
    await feed(untimed("And I wrote the runbook myself."));

    await act(async () => {
      api.doneAnswer({ question: "Tell me about a migration.", isSaveEnabled: () => false });
    });

    // THE FRAME THE OLD RULE DELETED. The audio clock never saw this
    // utterance — no frame carrying both `start` and `duration` has arrived
    // since 16 — so `answerEnd` was frozen at 16 and this twin's own start
    // is 16. Re-evaluating the upper bound here drops the sentence the
    // candidate had only just finished saying.
    await feed(timedTwin("And I wrote the runbook myself.", 16, 2));

    // Let the drain timer fire and the post-drain continuation run.
    await advance(2000);

    expect(api.answerTranscript).toEqual([
      "I led the migration.",
      "We cut latency in half.",
      "And I wrote the runbook myself.",
    ]);
  });

  it("counts the last sentence's words and its time, not just its text", async () => {
    // The sentence did not merely vanish from the transcript: it vanished
    // from the word count, the filler count, the words-per-minute and the
    // speaker partitioning, because every one of those is derived from the
    // same accepted-finals list. Asserting the transcript alone would pass
    // against a fix that restored the text and dropped the span.
    await act(async () => {
      api.startAnswer(STREAM);
    });
    await feed(untimed("One two three."));
    await feed(timedTwin("One two three.", 0, 3));
    await feed(untimed("Four five six seven."));

    await act(async () => {
      api.doneAnswer({ question: "Q", isSaveEnabled: () => false });
    });
    await feed(timedTwin("Four five six seven.", 3, 5));
    await advance(2000);

    expect(api.answerMetrics.wordCount).toBe(7);
    // The span runs from the first accepted final's start (0) to the LAST
    // one's end (3 + 5), which is only available because the backfill
    // happened. Without it the answer measures 3 seconds instead of 8.
    expect(api.answerMetrics.speechDurationSec).toBe(8);
  });

  it("still refuses speech that began before Start answering", async () => {
    // The bound that IS enforceable, asserted through the hook as well as in
    // answerWindow.commitPair.test.js, because the asymmetry is the whole
    // rule and a fix that simply stopped re-evaluating anything would pass
    // the two cases above. Here the candidate was still finishing the
    // PREVIOUS answer when they pressed Start: the text frame is accepted
    // provisionally (it carries no span to judge), and its twin proves it
    // began at 2, behind the 10 the clock had already reached.
    await feed({ isFinal: true, transcript: "…still on the last one.", start: 7, duration: 3 });
    await act(async () => {
      api.startAnswer(STREAM);
    });

    await feed(untimed("…as I was saying, we shipped it."));
    await feed(timedTwin("…as I was saying, we shipped it.", 2, 3));
    await feed(untimed("Now, about the migration."));
    await feed(timedTwin("Now, about the migration.", 11, 2));

    await act(async () => {
      api.doneAnswer({ question: "Q", isSaveEnabled: () => false });
    });
    await advance(2000);

    expect(api.answerTranscript).toEqual(["Now, about the migration."]);
  });

  it("does not double-count an utterance whose twin arrives before Done", async () => {
    // The behaviour AC-V1 exists for, pinned here so a "keep everything"
    // reading of the fix cannot pass: the flagged twin contributes a span,
    // never a second copy of the text. Two frames in, one sentence out.
    await act(async () => {
      api.startAnswer(STREAM);
    });
    await feed(untimed("Only once."));
    await feed(timedTwin("Only once.", 0, 2));

    await act(async () => {
      api.doneAnswer({ question: "Q", isSaveEnabled: () => false });
    });
    await advance(2000);

    expect(api.answerTranscript).toEqual(["Only once."]);
    expect(api.answerMetrics.wordCount).toBe(2);
  });
});
