// @vitest-environment jsdom
//
// AC-V1.8, practice-mode half. The live-mode half is
// app/copilot/useLiveSession.commitSpan.test.js; this is the same property
// for the OTHER consumer of the same flag, because the two hooks each carry
// their own copy of the "skip a flagged frame" logic and a fix applied to
// one of them silently leaves the other broken.
//
// The property, restated: `textAlreadyDelivered` means the TEXT is a
// re-delivery, and nothing more. ElevenLabs delivers one committed utterance
// as an untimed frame followed by a timed twin, and the twin — the only
// frame that ever carries `start`/`duration` — is the flagged one. A pace
// sampler that skips flagged frames therefore skips 100% of the audio timing
// on that provider: `appendSpeechSample` drops a sample with no usable span,
// so the practice dashboard's words-per-minute and filler readings come back
// measuring nothing, with no error and no log line.
//
// Harness borrowed from practiceSessionLogRestart.test.js (jsdom opt-in,
// createRoot + React 19 `act`, PracticeSession mocked at the module
// boundary), reduced to the one hook and the one callback under test.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createElement, useState, act } from "react";
import { createRoot } from "react-dom/client";

vi.mock("@/lib/copilot/practiceSession", () => ({ PracticeSession: vi.fn() }));

import { usePracticeCaptureSession } from "./usePracticeCaptureSession.js";
import { PracticeSession } from "@/lib/copilot/practiceSession";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

function noop() {}

let sessionOptions = null;
let samples = null;
let transcriptEvents = null;

function Probe({ onState }) {
  const [status, setStatus] = useState("idle");
  const capture = usePracticeCaptureSession({
    status,
    setStatus,
    micDeviceId: null,
    invalidateAndClearLoading: noop,
    abandonInProgressAnswer: noop,
    resetAnswerState: noop,
    invalidateInFlight: noop,
    clearForNewSession: noop,
    resetForSession: noop,
    resetDashboardForSession: noop,
    requestQuestion: noop,
    recordTranscriptEvent: (event) => transcriptEvents.push(event),
    recordSpeechSample: (sample) => samples.push(sample),
    markMicMuted: noop,
    onUtterance: noop,
  });
  onState({ start: capture.start, finals: capture.finals, status });
  return null;
}

const mounted = [];

function mountProbe() {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  const state = {};
  mounted.push({ root, container });
  act(() => {
    root.render(createElement(Probe, { onState: (s) => Object.assign(state, s) }));
  });
  return { state };
}

// One ElevenLabs commit, as two frames, in the order the live service sends
// them: the untimed `committed_transcript` first, then the timed
// `committed_transcript_with_timestamps` flagged as a text re-delivery.
function deliverCommitPair(text, { start = 3.639, duration = 3.62 } = {}) {
  sessionOptions.onTranscript({ transcript: text, isFinal: true, speechFinal: true });
  sessionOptions.onTranscript({
    transcript: text,
    isFinal: true,
    speechFinal: true,
    start,
    duration,
    textAlreadyDelivered: true,
  });
}

beforeEach(() => {
  vi.clearAllMocks();
  sessionOptions = null;
  samples = [];
  transcriptEvents = [];
  PracticeSession.mockImplementation(function (options) {
    sessionOptions = options;
    this.start = vi.fn().mockResolvedValue(undefined);
    this.stop = vi.fn().mockResolvedValue(undefined);
    this.setCameraOff = vi.fn();
    this.setMicMuted = vi.fn();
  });
});

afterEach(() => {
  while (mounted.length) {
    const { root, container } = mounted.pop();
    act(() => root.unmount());
    container.remove();
  }
  vi.clearAllMocks();
});

describe("practice mode keeps a commit pair's audio timing (AC-V1.8)", () => {
  it("records exactly one pace sample, and it carries the real span", async () => {
    const { state } = mountProbe();
    await act(async () => {
      await state.start();
    });

    await act(async () => {
      deliverCommitPair("I led the payments migration.");
    });

    // Once — the double-count AC-V1 exists to kill stays killed...
    expect(samples).toHaveLength(1);
    // ...and the sample is usable, which is the half that was lost. A sample
    // with an undefined span is dropped by appendSpeechSample, so "one call"
    // alone is satisfied by a measurement that measures nothing.
    expect(samples[0].text).toBe("I led the payments migration.");
    expect(samples[0].start).toBe(3.639);
    expect(samples[0].duration).toBe(3.62);
  });

  it("does not append the text twice to the transcript", async () => {
    // The original AC-V1 property, re-asserted here so a fix for the span
    // cannot restore the duplication by simply ignoring the flag.
    const { state } = mountProbe();
    await act(async () => {
      await state.start();
    });

    await act(async () => {
      deliverCommitPair("I led the payments migration.");
    });

    const lines = (state.finals || []).filter((row) =>
      String(row?.text || "").includes("payments migration"),
    );
    expect(lines).toHaveLength(1);
  });

  it("records nothing at all for a final the provider never timed", async () => {
    // The negative control for the span gate itself. A provider frame with
    // no usable timing must produce no sample — the same outcome
    // appendSpeechSample already reaches by dropping it, asserted here so
    // this call site is correct on its own terms rather than only because a
    // collaborator cleans up after it, and so "gate on the span" cannot be
    // mistaken for "record everything".
    const { state } = mountProbe();
    await act(async () => {
      await state.start();
    });

    await act(async () => {
      sessionOptions.onTranscript({ transcript: "Untimed and alone.", isFinal: true, speechFinal: true });
    });

    expect(samples).toEqual([]);
    // The text still landed — refusing the SAMPLE must not also refuse the
    // transcript line.
    expect((state.finals || []).some((row) => row.text === "Untimed and alone.")).toBe(true);
  });

  it("records two samples for two genuinely different utterances", async () => {
    // The positive control for the count: "exactly one" above must come from
    // recognising the pair, not from a rule that only ever records one.
    const { state } = mountProbe();
    await act(async () => {
      await state.start();
    });

    await act(async () => {
      deliverCommitPair("First answer.", { start: 1, duration: 2 });
    });
    await act(async () => {
      deliverCommitPair("Second answer.", { start: 10, duration: 3 });
    });

    expect(samples).toHaveLength(2);
    expect(samples.map((s) => s.start)).toEqual([1, 10]);
  });

  it("still forwards BOTH frames of the pair to recordTranscriptEvent", async () => {
    // usePracticeAnswer owns the running audio clock and the answer-window
    // decision, and it needs to see the timed twin to advance that clock at
    // all. Forwarding is deliberately unconditional here — the dedup
    // judgement belongs to acceptedAnswerFinal (lib/copilot/answerWindow.js),
    // not to this hook — so a fix that "cleans up" by filtering flagged
    // frames out at this boundary would take the audio clock down with it.
    const { state } = mountProbe();
    await act(async () => {
      await state.start();
    });

    await act(async () => {
      deliverCommitPair("I led the payments migration.");
    });

    expect(transcriptEvents).toHaveLength(2);
    expect(transcriptEvents[1].start).toBe(3.639);
    expect(transcriptEvents[1].textAlreadyDelivered).toBe(true);
  });
});
