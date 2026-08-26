// @vitest-environment jsdom
//
// AC-V5.6. The live interim state must hit React's bailout when nothing
// actually changed.
//
// WHY THIS IS ASSERTED AS OBJECT IDENTITY AND NOT AS A RENDER COUNT.
// React bails out of re-rendering a subtree only on `Object.is` equality of
// the new state against the old — and even when it does bail, it reserves
// the right to render the owning component once more before doing so. So a
// render-count assertion is both weaker and less stable than the thing the
// bailout actually keys on. `Object.is(next, prev)` IS the mechanism; that
// is what these cases assert, directly.
//
// What was wrong: both interim writers built a fresh object literal
// unconditionally —
//
//   setInterims((prev) => ({ ...prev, [speaker]: transcript }));
//   setInterims((prev) => ({ ...prev, [speaker]: "" }));
//
// A new object literal is never `Object.is`-equal to anything, so the whole
// copilot tree re-rendered several times a second for a provider interim
// that had not changed a character, and re-rendered again on EVERY final to
// clear an interim that was already "" — which is the common case, since the
// preceding interim for that utterance already cleared it.

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

function Probe({ onState }) {
  const [status, setStatus] = useState("idle");
  const [questions, setQuestions] = useState([]);
  const answerCacheRef = useRef(new Map());
  const draftGenRef = useRef(0);
  const live = useLiveSession({
    answerCacheRef,
    draftGenRef,
    recordSpeechSample: () => {},
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
  onState({ start: live.start, stop: live.stop, interims: live.interims });
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

function interim(speaker, transcript) {
  sessionOptions.onTranscript({ speaker, transcript, isFinal: false, speechFinal: false });
}

beforeEach(() => {
  vi.clearAllMocks();
  sessionOptions = null;
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

async function started() {
  const { state } = mountProbe();
  await act(async () => {
    await state.start();
  });
  return state;
}

describe("interim updates hit React's bailout (AC-V5.6)", () => {
  it("keeps the same interims object when a provider repeats an interim verbatim", async () => {
    // Providers re-send an unchanged interim while a speaker pauses
    // mid-sentence. Every one of those used to allocate a fresh object and
    // re-render the whole copilot tree for zero visible change.
    const state = await started();

    await act(async () => interim("them", "Tell me about a migration"));
    const afterFirst = state.interims;
    expect(afterFirst.them).toBe("Tell me about a migration");

    await act(async () => interim("them", "Tell me about a migration"));
    expect(state.interims).toBe(afterFirst);
  });

  it("still produces a new object when the interim text actually changes", async () => {
    // The positive control. A guard that never lets an update through is not
    // a bailout, it is a broken transcript.
    const state = await started();

    await act(async () => interim("them", "Tell me about a"));
    const afterFirst = state.interims;
    await act(async () => interim("them", "Tell me about a migration"));

    expect(state.interims).not.toBe(afterFirst);
    expect(state.interims.them).toBe("Tell me about a migration");
  });

  it("does not disturb the other speaker's interim when one speaker's changes", async () => {
    // The second positive control: the guard compares ONE speaker's slot, so
    // a write for "you" must still land while "them" is mid-sentence.
    const state = await started();

    await act(async () => interim("them", "So, tell me"));
    await act(async () => interim("you", "Sure, I"));

    expect(state.interims.them).toBe("So, tell me");
    expect(state.interims.you).toBe("Sure, I");
  });

  it("keeps the same interims object when a final clears an interim that is already empty", async () => {
    // The common case, and the one that cost a re-render on EVERY final: the
    // interim for an utterance is normally already "" by the time its final
    // lands, so the clear had nothing to clear and re-rendered anyway.
    const state = await started();

    await act(async () => interim("them", "Tell me about a migration"));
    await act(async () => interim("them", ""));
    const cleared = state.interims;
    expect(cleared.them).toBe("");

    await act(async () => {
      sessionOptions.onTranscript({
        speaker: "them",
        transcript: "Tell me about a migration.",
        isFinal: true,
        speechFinal: true,
        start: 1,
        duration: 2,
      });
    });

    expect(state.interims).toBe(cleared);
  });

  it("still clears a non-empty interim when its final arrives", async () => {
    // The positive control for the clear: the guard must not turn "clear the
    // interim" into "never clear the interim", which would leave the partial
    // text on screen underneath its own finalized line.
    const state = await started();

    await act(async () => interim("them", "Tell me about a migra"));
    await act(async () => {
      sessionOptions.onTranscript({
        speaker: "them",
        transcript: "Tell me about a migration.",
        isFinal: true,
        speechFinal: true,
        start: 1,
        duration: 2,
      });
    });

    expect(state.interims.them).toBe("");
  });

  it("keeps the same interims object when stop() resets an already-idle pair", async () => {
    // The reset sites allocate the empty pair unconditionally too. Stop is
    // the reachable one: the interims are almost always already empty by
    // then, because the last final of the session cleared them.
    const state = await started();
    const before = state.interims;
    expect(before).toEqual({ them: "", you: "" });

    await act(async () => {
      await state.stop();
    });

    expect(state.interims).toBe(before);
  });

  it("still clears a live interim on stop", async () => {
    // The positive control for the reset guard: pressing Stop mid-sentence
    // must not leave the half-transcribed line on screen.
    const state = await started();
    await act(async () => interim("them", "Tell me about a migra"));

    await act(async () => {
      await state.stop();
    });

    expect(state.interims).toEqual({ them: "", you: "" });
  });
});
