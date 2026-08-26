// @vitest-environment jsdom
//
// AC-V1.8. A commit pair must deliver its text ONCE and its audio timing ONCE.
//
// THE REGRESSION THIS EXISTS TO CATCH, which AC-V1 introduced and no existing
// test could see. ElevenLabs sends one commit as two frames: the untimed
// `committed_transcript` first, then `committed_transcript_with_timestamps`
// carrying `start`/`duration`. AC-V1 correctly stopped the second frame's TEXT
// from being counted twice — by flagging it `textAlreadyDelivered` — but the
// flagged frame is the ONLY one that ever carried the timing, and every
// consumer skips flagged frames wholesale. So the fix silently threw away all
// audio timing on the provider the user actually runs.
//
// What that costs, downstream of here: `appendSpeechSample` drops a sample
// with no usable span, so live words-per-minute and filler readings vanish;
// `isFinalInAnswerWindow` treats a non-numeric `start` as "no evidence it is
// out of range", so every final is accepted into a practice answer including
// speech from before "Start answering" — the window filter goes inert.
// Trading a known double-count for silent, unlogged loss of timing is a bad
// trade, and it was invisible because the flag's three consumers all key on
// the flag rather than on whether the frame carries what they actually need.
//
// The property, stated so the implementation follows from it rather than from
// a case list: **`textAlreadyDelivered` means the TEXT is a re-delivery, and
// nothing more.** A consumer that needs timing reads it from whichever frame
// carries it, flagged or not. Under that rule the untimed frame contributes
// the text, the timed twin contributes the span, and each is counted once.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createElement, useRef, useState, act } from "react";
import { createRoot } from "react-dom/client";

vi.mock("@/lib/copilot/session", () => ({ CopilotSession: vi.fn() }));
vi.mock("@/lib/copilot/detectClient", () => ({ confirmQuestion: vi.fn() }));
vi.mock("@/lib/copilot/answerClient", () => ({ draftAnswer: vi.fn() }));

import { useLiveSession } from "./useLiveSession.js";
import { CopilotSession } from "@/lib/copilot/session";
import { confirmQuestion } from "@/lib/copilot/detectClient";
import { draftAnswer } from "@/lib/copilot/answerClient";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let sessionOptions = null;
let samples = null;

function Probe({ onState }) {
  const [status, setStatus] = useState("idle");
  const [questions, setQuestions] = useState([]);
  const answerCacheRef = useRef(new Map());
  const draftGenRef = useRef(0);
  const live = useLiveSession({
    answerCacheRef,
    draftGenRef,
    recordSpeechSample: (sample) => samples.push(sample),
    resetForSession: () => {},
    status,
    setStatus,
    questions,
    setQuestions,
    source: "tab",
    micDeviceId: null,
    profile: "",
    posting: null,
    autoDraft: false,
    setSetupExpanded: () => {},
    setShowHistory: () => {},
  });
  onState({ start: live.start, finals: live.finals, sessionLogSnapshot: live.sessionLogSnapshot });
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
// them — read off the user's own recorded session, where all five utterances
// arrived exactly this way, 66-114ms apart.
function deliverCommitPair(text, { speaker = "you", start = 3.639, duration = 3.62 } = {}) {
  sessionOptions.onTranscript({ speaker, transcript: text, isFinal: true, speechFinal: true });
  sessionOptions.onTranscript({
    speaker,
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
  CopilotSession.mockImplementation(function (options) {
    sessionOptions = options;
    this.start = vi.fn().mockResolvedValue(undefined);
    this.stop = vi.fn().mockResolvedValue(undefined);
    this.speakerSnapshot = vi.fn(() => ({
      userTag: null,
      confidence: "unknown",
      overridden: false,
      tags: [],
    }));
    this.assignUser = vi.fn();
  });
  draftAnswer.mockResolvedValue({ points: [] });
  confirmQuestion.mockResolvedValue({ isQuestion: false });
});

afterEach(() => {
  while (mounted.length) {
    const { root, container } = mounted.pop();
    act(() => root.unmount());
    container.remove();
  }
  vi.clearAllMocks();
});

describe("a commit pair keeps its audio timing (AC-V1.8)", () => {
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

  it("still records nothing for the interviewer's own speech", async () => {
    // The negative control. Pace and filler readings are the CANDIDATE's, and
    // a fix that starts sampling on span-presence rather than on the flag must
    // not also start sampling the other party.
    const { state } = mountProbe();
    await act(async () => {
      await state.start();
    });

    await act(async () => {
      deliverCommitPair("Tell me about a migration you led.", { speaker: "them" });
    });

    expect(samples).toEqual([]);
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

  it("records two samples for two genuinely different utterances", async () => {
    // The positive control for the count: "exactly one" must come from
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
});
