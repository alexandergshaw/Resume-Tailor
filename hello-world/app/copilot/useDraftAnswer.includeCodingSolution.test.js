// @vitest-environment jsdom
//
// N162 Wave C (step 4b) — LIVE mode threads the "include coding solution"
// toggle onto the wire and into the answer-cache key. Written BEFORE Wave C
// lands; every assertion below fails against the current hook, which does not
// read the toggle store at all, so the field never reaches draftAnswerStreaming
// and never joins the grounding the cache is keyed on.
//
// HOW THE LIVE HOOK GETS THE TOGGLE (arch N162.arch.r1.md §6.3): the LIVE hook
// reads the store DIRECTLY — `readIncludeCodingSolution()` at the ONE capture
// point, on the line below getCodeLanguage()/getInterviewType(), exactly as it
// already reads getCodeLanguage() there. It is NOT passed in as an argument
// (that is the PRACTICE hook, §6.4). So this file DRIVES THE REAL STORE with
// setIncludeCodingSolution(...) and asserts the hook forwards the value the
// store currently holds — a build that hardcodes the field false (or true)
// instead of reading the store reds the ON case (or the OFF control).
//
// Harness copied from useDraftAnswer.codeLanguage.test.js next door: the toggle
// travels the exact same store -> capture -> request-body / grounding-key path
// codeLanguage does, so the proof is the same shape — a real mount of runDraft
// (NOT a source read), the END-TO-END "reaches the wire" case uses the real
// client plus a fetch spy, and the cache-key cases hold draftAnswerStreaming's
// call count to distinguish a genuine hit from a second fetch returning the same
// mock.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createElement, useState, act } from "react";
import { createRoot } from "react-dom/client";

vi.mock("@/lib/copilot/answerClient", () => ({
  draftAnswer: vi.fn(),
  draftAnswerStreaming: vi.fn(),
}));

// A SPY delegating to the real implementation, not a stub — same reason the
// codeLanguage suite spies groundingFor: asserting the grounding key's
// observable behaviour alone cannot catch a FORKED fold that produces an
// identical key today and drifts the day the shape changes.
vi.mock("@/lib/copilot/answerGrounding", async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, groundingFor: vi.fn(actual.groundingFor) };
});

import { useDraftAnswer } from "./useDraftAnswer.js";
import { draftAnswerStreaming } from "@/lib/copilot/answerClient";
import { groundingFor } from "@/lib/copilot/answerGrounding";
import {
  setIncludeCodingSolution,
  readIncludeCodingSolution,
} from "@/app/settings/includeCodingSolution.js";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const QUESTION = "Implement a cache that evicts the least recently used entry.";

function frame(label) {
  return {
    points: [`Point from ${label}.`],
    cues: [label],
    buzzwords: [],
    resumeAnchor: null,
    pageSources: [],
    type: "technical",
  };
}
const FRAME_A = frame("draft A");

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
    pageSources: [],
    type: null,
    error: "",
  };
}

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
      createElement(Probe, { answerCacheRef, draftGenRef, onState: (s) => Object.assign(state, s) }),
    );
  });
  return { state, answerCacheRef, draftGenRef };
}

const entryOf = (state, id) => state.questions.find((q) => q.id === id);

beforeEach(() => {
  draftAnswerStreaming.mockReset();
  draftAnswerStreaming.mockResolvedValue(FRAME_A);
  groundingFor.mockClear();
  window.localStorage.clear();
  // Belt and braces: back to the OFF default even if a prior test left the key.
  setIncludeCodingSolution(false);
});

afterEach(() => {
  while (mounted.length) {
    const m = mounted.pop();
    act(() => m.root.unmount());
    m.container.remove();
  }
  window.localStorage.clear();
  setIncludeCodingSolution(false);
});

// A streaming Response good enough for the REAL draftAnswerStreaming: `ok`, and
// a body.getReader() yielding one NDJSON chunk ending in a terminal done frame.
function ndjsonResponse(frames) {
  const chunk = new TextEncoder().encode(`${frames.map((f) => JSON.stringify(f)).join("\n")}\n`);
  let sent = false;
  return {
    ok: true,
    status: 200,
    body: {
      getReader: () => ({
        read: async () => {
          if (sent) return { done: true, value: undefined };
          sent = true;
          return { done: false, value: chunk };
        },
      }),
    },
  };
}

describe("live mode forwards the toggle to the draft request (AC-N162-5)", () => {
  it("posts includeCodingSolution:true when the store is ON", async () => {
    // RED on HEAD: the hook never reads the toggle store, so the request bag
    // carries no such key (undefined). Kills the hardcode-false mutant: the
    // store says ON, so a hook that hardwires false reds here.
    setIncludeCodingSolution(true);
    const { state } = mountProbe();
    act(() => state.setQuestions([seedQuestion(1, QUESTION)]));
    await act(async () => {
      await state.runDraft(1, QUESTION);
    });

    expect(draftAnswerStreaming).toHaveBeenCalledTimes(1);
    expect(draftAnswerStreaming.mock.calls[0][0].includeCodingSolution).toBe(true);
    // The positive control: the known-good neighbour field arrives on the same
    // bag through the same capture, so a true here is about the TOGGLE and not
    // a broken harness.
    expect(draftAnswerStreaming.mock.calls[0][0].codeLanguage).toBe("auto");
  });

  it("posts includeCodingSolution:false on an untouched (default-OFF) session — the over-fire control", async () => {
    // Kills the hardcode-true mutant: the store is OFF, so a hook that
    // hardwires true (or reads a stale value) reds here. On HEAD this is RED
    // too (the field is absent, not false) — both directions land RED now and
    // GREEN against the reference, which is the point.
    const { state } = mountProbe();
    act(() => state.setQuestions([seedQuestion(1, QUESTION)]));
    await act(async () => {
      await state.runDraft(1, QUESTION);
    });
    expect(draftAnswerStreaming.mock.calls[0][0].includeCodingSolution).toBe(false);
  });

  it("builds the grounding key through groundingFor carrying the toggle (shared machinery, not a hand-fold)", async () => {
    // Pins that the toggle rides the SAME groundingFor the cache key is built
    // from, so a flip is a miss through the one shared comparison rather than a
    // second hand-folded key that silently stops matching. RED on HEAD:
    // groundingFor is never called with includeCodingSolution true.
    setIncludeCodingSolution(true);
    const { state } = mountProbe();
    act(() => state.setQuestions([seedQuestion(1, QUESTION)]));
    await act(async () => {
      await state.runDraft(1, QUESTION);
    });
    expect(groundingFor).toHaveBeenCalled();
    expect(groundingFor.mock.calls.some(([arg]) => arg?.includeCodingSolution === true)).toBe(true);
  });
});

describe("END TO END: the toggle reaches the WIRE (AC-N162-5)", () => {
  // Joins the two halves the unit cases each stub out: the hook, the REAL
  // client's field-by-field body rebuild (answerClient.js does not spread the
  // bag), and fetch. A build where the hook captures the toggle but the client
  // drops it would pass every stubbed case and this one alone would red.
  async function useRealClient() {
    const real = await vi.importActual("@/lib/copilot/answerClient");
    draftAnswerStreaming.mockImplementation(real.draftAnswerStreaming);
    const fetchSpy = vi.fn(async () =>
      ndjsonResponse([{ t: "done", points: ["Name the constraint first."], cues: ["Constraint"], type: "technical" }]),
    );
    vi.stubGlobal("fetch", fetchSpy);
    return fetchSpy;
  }

  it("serializes includeCodingSolution:true into the POST body when ON", async () => {
    setIncludeCodingSolution(true);
    const fetchSpy = await useRealClient();
    const { state } = mountProbe();
    act(() => state.setQuestions([seedQuestion(1, QUESTION)]));
    await act(async () => {
      await state.runDraft(1, QUESTION);
    });

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe("/api/copilot/answer");
    const body = JSON.parse(init.body);
    expect(body.includeCodingSolution).toBe(true);
    // Harness canary: the request did reach the wire intact.
    expect(body.question).toBe(QUESTION);
    expect(body.stream).toBe(true);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });
});

describe("the live answer cache key includes the toggle (FD-3, AC-N162-21)", () => {
  it("re-asking the same question after FLIPPING the toggle is a miss", async () => {
    // A cached answer was drafted under ON. Serving it after the user turns the
    // toggle OFF is exactly the stale-serve the grounding key exists to
    // prevent. RED on HEAD: the hook ignores the toggle, so both groundings are
    // identical, the second ask HITS and the refetch never happens (count stays
    // 1). Deliberately not clearing answerCacheRef — this isolates the KEY by
    // leaving the ON entry to be rejected on its own.
    setIncludeCodingSolution(true);
    const { state } = mountProbe();
    act(() => state.setQuestions([seedQuestion(1, QUESTION)]));
    await act(async () => {
      await state.runDraft(1, QUESTION);
    });
    expect(draftAnswerStreaming).toHaveBeenCalledTimes(1);
    expect(entryOf(state, 1).status).toBe("done");

    act(() => setIncludeCodingSolution(false));
    expect(readIncludeCodingSolution()).toBe(false);
    act(() => state.setQuestions((prev) => [...prev, seedQuestion(2, QUESTION)]));
    await act(async () => {
      await state.runDraft(2, QUESTION);
    });

    expect(draftAnswerStreaming).toHaveBeenCalledTimes(2);
    expect(entryOf(state, 2).cached).not.toBe(true);
  });

  it("re-asking under the SAME toggle is still a hit — the under-fire control", async () => {
    // Without this, a build whose cache never hits at all passes the miss case
    // above and every repeated question silently costs a second call.
    setIncludeCodingSolution(true);
    const { state } = mountProbe();
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
  });
});
