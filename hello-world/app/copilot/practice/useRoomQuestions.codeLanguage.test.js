// @vitest-environment jsdom
//
// `useRoomQuestions` — practice mode's detection half — and the code language.
// Harness copied from `./useRoomQuestions.interviewType.test.js` next door,
// which is chunk A's version of this same file.
//
// Written BEFORE the implementation exists (step 4b): the file fails on the
// missing `../useCodeLanguage.js` module until wave 2 lands, and then on the
// unsent field until wave 3 does.
//
// This path is DELIBERATELY narrower than live mode's: it is a request field
// only. Verified in chunk A and re-stated here so nobody widens it: this hook
// holds no answer cache and does no grounding comparison at all — no
// `cacheRef`, no `groundingFor` — so there is no key for the language to join
// and nothing here to invalidate on a switch beyond `invalidateDrafts`, which
// the practice subscriber already calls.
//
// The same falsifiability rule as live mode governs the second case: an
// assertion that merely awaits before reading the body passes against a ref
// implementation, because a mirrored ref is correct one tick later.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createElement, act } from "react";
import { createRoot } from "react-dom/client";

vi.mock("@/lib/copilot/detectClient", () => ({ confirmQuestion: vi.fn() }));
vi.mock("@/lib/copilot/answerClient", () => ({ draftAnswer: vi.fn() }));

import { useRoomQuestions } from "./useRoomQuestions.js";
import { setCodeLanguage, __resetCodeLanguageForTests } from "../useCodeLanguage.js";
import { setInterviewType, __resetInterviewTypeForTests } from "../useInterviewType.js";
import { confirmQuestion } from "@/lib/copilot/detectClient";
import { draftAnswer } from "@/lib/copilot/answerClient";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const QUESTION = "How would you dedupe a high-volume log stream?";

const DRAFT_RESPONSE = {
  points: ["Name the constraint first.", "Then the trade-off you took."],
  cues: ["Constraint", "Tradeoff"],
  buzzwords: ["throughput"],
  resumeAnchor: { role: "Staff Engineer" },
  idealProject: { title: "Platform consolidation" },
  pageSources: [],
  type: "technical",
};

function Probe({ onState }) {
  const room = useRoomQuestions({
    applicationId: "app-1",
    profile: "Senior engineer, dispatch and logistics.",
    myTag: null,
    collecting: false,
  });
  onState(room);
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

beforeEach(() => {
  // `vi.restoreAllMocks()` does not clear a `vi.fn()` from a `vi.mock` factory,
  // and cases in this directory install rejecting implementations — hence
  // `mockReset`, not `mockClear`.
  draftAnswer.mockReset();
  confirmQuestion.mockReset();
  draftAnswer.mockResolvedValue(DRAFT_RESPONSE);
  confirmQuestion.mockResolvedValue({ isQuestion: true, question: QUESTION, type: "technical" });
  window.localStorage.clear();
  __resetCodeLanguageForTests();
  __resetInterviewTypeForTests();
});

afterEach(() => {
  while (mounted.length) {
    const m = mounted.pop();
    act(() => m.root.unmount());
    m.container.remove();
  }
  vi.unstubAllGlobals();
  window.localStorage.clear();
  __resetCodeLanguageForTests();
  __resetInterviewTypeForTests();
});

describe("END TO END on the PRACTICE tab: the language reaches the WIRE (AC-C24, B-1)", () => {
  // The practice-tab half of the join live mode's own suite makes. Same hole,
  // same shape: every other case here stubs `@/lib/copilot/answerClient`, and
  // `draftAnswer` (`answerClient.js:27-40`) does NOT spread the request bag —
  // it destructures six named fields and rebuilds the body from them, so an
  // added field is dropped by default. A hook that passes `codeLanguage` into
  // a client that never sends it is a control that governs nothing, and no
  // isolated test of either half can see it.
  it("posts the selected language in the request body", async () => {
    const real = await vi.importActual("@/lib/copilot/answerClient");
    draftAnswer.mockImplementation(real.draftAnswer);
    const fetchSpy = vi.fn(async () => ({ ok: true, status: 200, json: async () => DRAFT_RESPONSE }));
    vi.stubGlobal("fetch", fetchSpy);

    const { state } = mountProbe();
    act(() => setCodeLanguage("typescript"));
    await act(async () => {
      state.addManualQuestion(QUESTION);
    });

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe("/api/copilot/answer");
    const body = JSON.parse(init.body);
    expect(body.codeLanguage).toBe("typescript");
    // Positive controls on the same rebuilt body, so the assertion above is
    // about the language rather than about a harness that posted nothing.
    expect(body.question).toBe(QUESTION);
    expect(body.applicationId).toBe("app-1");
  });

  it("posts `auto` rather than omitting the field (AC-C27b)", async () => {
    const real = await vi.importActual("@/lib/copilot/answerClient");
    draftAnswer.mockImplementation(real.draftAnswer);
    const fetchSpy = vi.fn(async () => ({ ok: true, status: 200, json: async () => DRAFT_RESPONSE }));
    vi.stubGlobal("fetch", fetchSpy);

    const { state } = mountProbe();
    await act(async () => {
      state.addManualQuestion(QUESTION);
    });

    const body = JSON.parse(fetchSpy.mock.calls[0][1].body);
    expect(Object.keys(body)).toContain("codeLanguage");
    expect(body.codeLanguage).toBe("auto");
  });
});

describe("a room draft carries the code language (AC-C24, AC-C27b)", () => {
  it("carries `auto` when nothing has been selected — the positive control", async () => {
    const { state } = mountProbe();
    await act(async () => {
      state.addManualQuestion(QUESTION);
    });
    expect(draftAnswer).toHaveBeenCalledTimes(1);
    expect(draftAnswer.mock.calls[0][0]).toMatchObject({
      question: QUESTION,
      applicationId: "app-1",
      codeLanguage: "auto",
    });
  });

  it("carries a language selected in the SAME SYNCHRONOUS TURN as the draft (AC-C26)", async () => {
    const { state } = mountProbe();

    let bodyAtCallTime = null;
    act(() => {
      setCodeLanguage("sql");
      state.addManualQuestion(QUESTION);
      bodyAtCallTime = draftAnswer.mock.calls[0]?.[0];
    });
    await act(async () => {
      await Promise.resolve();
    });

    expect(bodyAtCallTime).toBeTruthy();
    expect(bodyAtCallTime.codeLanguage).toBe("sql");
  });

  it("still carries the interview type beside it — chunk A's field is not displaced", async () => {
    const { state } = mountProbe();
    act(() => setInterviewType("system-design"));
    await act(async () => {
      state.addManualQuestion(QUESTION);
    });
    expect(draftAnswer.mock.calls[0][0]).toMatchObject({
      interviewType: "system-design",
      codeLanguage: "auto",
    });
  });
});

describe("a language change clears the DRAFTS and keeps the QUESTIONS (A17, AC-A21b's rule)", () => {
  it("leaves the entries, their ids, their text and their classification standing", async () => {
    // Room questions are questions OTHER PEOPLE IN THE ROOM ACTUALLY ASKED. A
    // language change does not make them un-asked, and it has no claim on that
    // history. What it invalidates is the drafts built in the old language.
    const { state } = mountProbe();
    await act(async () => {
      state.addManualQuestion(QUESTION);
    });
    const before = state.questions[0];
    expect(before.status).toBe("done");

    act(() => setCodeLanguage("go"));
    await act(async () => {
      state.invalidateDrafts();
    });

    const after = state.questions[0];
    expect(state.questions).toHaveLength(1);
    expect(after.id).toBe(before.id);
    expect(after.question).toBe(QUESTION);
    expect(after.type).toBe(before.type);
    expect(after.status).toBe("idle");
    expect(after.points).toBe(null);
  });

  it("resetForSession() DOES empty the list — the positive control for the case above", async () => {
    // Without this, an `invalidateDrafts` that does nothing at all satisfies
    // "the questions survive".
    const { state } = mountProbe();
    await act(async () => {
      state.addManualQuestion(QUESTION);
    });
    await act(async () => {
      state.resetForSession();
    });
    expect(state.questions).toHaveLength(0);
  });
});
