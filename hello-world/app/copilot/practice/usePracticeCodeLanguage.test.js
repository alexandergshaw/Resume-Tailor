// @vitest-environment jsdom
//
// `app/copilot/practice/usePracticeCodeLanguage.js` — the practice surface's
// language store read AND its change subscriber, in one hook module.
//
// Written BEFORE the implementation exists (step 4b): the whole file fails on
// the missing `./usePracticeCodeLanguage.js` module until wave 3 lands.
//
// THE RULING THIS FILE ENFORCES (reconciliation A17). CONF-11 was dissolved by
// matching a NAME instead of reading the function: `discardAnswerWork` was
// labelled "chunk C's entry point", and it reaches `resetAnswerState`, whose
// `revokeReplay()` is `URL.revokeObjectURL` — IRREVERSIBLE — and
// `abandonInProgressAnswer`, which destroys a take still being recorded.
// Wiring a language change to it destroys the candidate's finished recording.
//
// The principle: a language change invalidates **the app's drafted output**,
// which is in the wrong language. It has no claim on **the candidate's own
// work** — their recording, their transcript, their critique. Those are not
// stale; they are a record of something that happened, and the language of a
// sample answer does not make the candidate's own take wrong.
//
// So the seam is `discardDraftedAnswers` and NOTHING ELSE, and the negatives
// below are sited here because this is the module that could reach the others.
//
// AND — added after the round-2 adversarial check — THE PRACTICE REVEAL PATH,
// end to end. `useSampleAnswer.js`'s own suite (A-41) is an existing file this
// author may not modify, and measured, that hop is the one place in chunk C
// where a green gate still reaches a **user-visible wrong answer**: a
// `useSampleAnswer` that uses the language for its CACHE decisions and omits
// it from the two `draftAnswer` calls it actually sends leaves every
// `needsRedraft` / `cachedSampleAnswerFor` assertion green while the practice
// sample answer is drafted in the wrong language forever, and the cache
// faithfully records that it was drafted under the right one.
//
// This file is that hop's home because it is the practice tab's jsdom file
// that already owns the value `useSampleAnswer` is handed — the chain asserted
// below is store → `usePracticeCodeLanguage` → `useSampleAnswer` → the REAL
// `answerClient` → `fetch`, which is the same end-to-end shape that killed the
// no-plumbing reference on the live and room paths. A-41 still owes its own
// copy; this is the floor.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createElement, act } from "react";
import { createRoot } from "react-dom/client";

// Delegating spies on every composer in the module, so the destructive ones
// can be asserted UNCALLED with the narrow one asserted called in the same
// breath — a negative against a stub proves nothing about which one ran.
// Delegating spies on the two pure cache functions, so the reveal path's
// positional contract can be read from the CALLER's side — a literal `"auto"`
// handed to either of them is A-41's gap from the other end, and no assertion
// on the pure module can see it.
vi.mock("@/lib/copilot/sampleAnswerState", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    needsRedraft: vi.fn(actual.needsRedraft),
    cachedSampleAnswerFor: vi.fn(actual.cachedSampleAnswerFor),
  };
});

vi.mock("@/lib/copilot/choiceChangeInvalidation", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    discardDraftedAnswers: vi.fn(actual.discardDraftedAnswers),
    discardAnswerWork: vi.fn(actual.discardAnswerWork),
    discardPracticeWork: vi.fn(actual.discardPracticeWork),
    discardQuestionAndScoreWork: vi.fn(actual.discardQuestionAndScoreWork),
  };
});

import { usePracticeCodeLanguage } from "./usePracticeCodeLanguage.js";
import { useSampleAnswer } from "./useSampleAnswer.js";
import { needsRedraft, cachedSampleAnswerFor } from "@/lib/copilot/sampleAnswerState";
import {
  CODE_LANGUAGE_STORAGE_KEY,
  setCodeLanguage,
  __resetCodeLanguageForTests,
} from "../useCodeLanguage.js";
import { setInterviewType, __resetInterviewTypeForTests } from "../useInterviewType.js";
import {
  discardDraftedAnswers,
  discardAnswerWork,
  discardPracticeWork,
  discardQuestionAndScoreWork,
} from "@/lib/copilot/choiceChangeInvalidation";
import { AUTO } from "@/lib/copilot/codeLanguages";

const HERE = dirname(fileURLToPath(import.meta.url));
const readSource = (rel) => readFileSync(join(HERE, rel), "utf8");

// Line comments only. A-25 REQUIRES this module's header to name the
// composers it deliberately does not call ("why `resetAnswerState`,
// `abandonInProgressAnswer`, `clearSessionScores` and `resetQuestions` are all
// excluded"), so a source-text negative run over the raw file would fail a
// correct implementation for having explained itself.
const stripLineComments = (text) =>
  text
    .split("\n")
    .map((line) => line.replace(/\/\/.*$/, ""))
    .join("\n");

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const mounted = [];

function mountHook({ onAnnounce } = {}) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  const invalidateRoomDrafts = vi.fn();
  const state = {};
  function Probe() {
    Object.assign(state, usePracticeCodeLanguage({ invalidateRoomDrafts, onAnnounce }));
    return null;
  }
  mounted.push({ root, container });
  act(() => root.render(createElement(Probe)));
  return { state, invalidateRoomDrafts };
}

function fireForeignLanguage(newValue) {
  window.localStorage.setItem(CODE_LANGUAGE_STORAGE_KEY, newValue);
  window.dispatchEvent(
    new StorageEvent("storage", {
      key: CODE_LANGUAGE_STORAGE_KEY,
      newValue,
      storageArea: window.localStorage,
    }),
  );
}

beforeEach(() => {
  // `mockClear`, not `mockReset`: these are delegating spies and `mockReset`
  // would strip the real implementations they wrap.
  needsRedraft.mockClear();
  cachedSampleAnswerFor.mockClear();
  discardDraftedAnswers.mockClear();
  discardAnswerWork.mockClear();
  discardPracticeWork.mockClear();
  discardQuestionAndScoreWork.mockClear();
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

// ---------------------------------------------------------------------------
// A-41 — the practice REVEAL path, store to wire.

const REVEAL_QUESTION = "Implement a cache that evicts the least recently used entry.";
const REVEAL_PROFILE = "Senior engineer, dispatch and logistics.";
const REVEAL_PAYLOAD = {
  points: ["Name the constraint first.", "Then the trade-off you took."],
  cues: ["Constraint", "Tradeoff"],
  buzzwords: [],
  resumeAnchor: null,
  idealProject: null,
  pageSources: [],
  grounding: null,
};

// The REAL `answerClient` is used here — this file mocks it nowhere — so the
// only thing standing between the hook and the network is `fetch`.
function spyFetch() {
  const fetchSpy = vi.fn(async () => ({ ok: true, status: 200, json: async () => REVEAL_PAYLOAD }));
  vi.stubGlobal("fetch", fetchSpy);
  return fetchSpy;
}

function mountRevealProbe() {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  const invalidateRoomDrafts = vi.fn();
  const state = {};
  function Probe() {
    // The chain, exactly as `PracticeClient` composes it: the practice hook
    // owns the value, `useSampleAnswer` is handed it.
    const { codeLanguage } = usePracticeCodeLanguage({ invalidateRoomDrafts });
    const sample = useSampleAnswer({
      question: REVEAL_QUESTION,
      profile: REVEAL_PROFILE,
      interviewType: "technical",
      applicationId: "app-1",
      codeLanguage,
    });
    Object.assign(state, { codeLanguage, sample });
    return null;
  }
  mounted.push({ root, container });
  act(() => root.render(createElement(Probe)));
  return { state };
}

const postedBody = (fetchSpy, index = 0) => JSON.parse(fetchSpy.mock.calls[index][1].body);

describe("END TO END on the practice REVEAL path: the language reaches the WIRE (A-41)", () => {
  it("posts the selected language when the sample answer is revealed", async () => {
    // The single most consequential assertion in chunk C's gate: without it a
    // `useSampleAnswer` that keeps the language for its cache bookkeeping and
    // drops it from the request passes every other case in the suite, and the
    // practice candidate reads a sample answer in a language they did not ask
    // for — with the cache recording that they did.
    const fetchSpy = spyFetch();
    const { state } = mountRevealProbe();
    act(() => setCodeLanguage("java"));
    await act(async () => {
      state.sample.toggle();
    });

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe("/api/copilot/answer");
    const body = JSON.parse(init.body);
    expect(body.codeLanguage).toBe("java");
    // Positive controls on the same rebuilt body — this is the reveal
    // request and not some other call.
    expect(body.mode).toBe("answer");
    expect(body.question).toBe(REVEAL_QUESTION);
    expect(body.applicationId).toBe("app-1");
  });

  it("posts `auto` rather than omitting the field when nothing is selected (AC-C27b)", async () => {
    const fetchSpy = spyFetch();
    const { state } = mountRevealProbe();
    await act(async () => {
      state.sample.toggle();
    });
    const body = postedBody(fetchSpy);
    expect(Object.keys(body)).toContain("codeLanguage");
    expect(body.codeLanguage).toBe("auto");
  });

  it("posts it on the QUEUE path too — the silent pre-fetch is the same request", async () => {
    // `queue` is the other `draftAnswer` call in that hook, and it is the one
    // whose result the reveal is then served from. A queue drafted under the
    // wrong language poisons the cache the reveal reads.
    const fetchSpy = spyFetch();
    const { state } = mountRevealProbe();
    act(() => setCodeLanguage("go"));
    await act(async () => {
      state.sample.queue(REVEAL_QUESTION, REVEAL_PROFILE, "technical", "app-1", state.codeLanguage);
    });

    expect(fetchSpy).toHaveBeenCalledTimes(1);
    expect(postedBody(fetchSpy).codeLanguage).toBe("go");
  });

  it("hands the CACHE functions the same language it posts, never a literal", () => {
    // A-41's other end: the hook receives the language, posts it correctly,
    // and passes `"auto"` into `needsRedraft` / `cachedSampleAnswerFor`, so
    // every reveal is a false hit against the `auto` entry. Only the caller's
    // side can see it — `sampleAnswerState.js`'s own contract test asserts
    // what the functions DO with the argument, not that anyone passes it.
    spyFetch();
    const { state } = mountRevealProbe();
    act(() => setCodeLanguage("typescript"));
    act(() => {
      state.sample.toggle();
    });

    expect(needsRedraft).toHaveBeenCalled();
    const redraftCall = needsRedraft.mock.calls[needsRedraft.mock.calls.length - 1];
    // `needsRedraft(active, profile, interviewType, applicationId, codeLanguage, force)`
    expect(redraftCall[4]).toBe("typescript");
    // …and `force` is still in the sixth slot, not displaced by it (AC-C27c).
    expect(typeof redraftCall[5]).toBe("boolean");
  });

  it("hands cachedSampleAnswerFor the language as its sixth argument", () => {
    spyFetch();
    const { state } = mountRevealProbe();
    act(() => setCodeLanguage("python"));
    act(() => {
      state.sample.toggle();
    });

    expect(cachedSampleAnswerFor).toHaveBeenCalled();
    const cacheCall = cachedSampleAnswerFor.mock.calls[cachedSampleAnswerFor.mock.calls.length - 1];
    // `cachedSampleAnswerFor(entry, question, profile, interviewType, applicationId, codeLanguage)`
    expect(cacheCall[5]).toBe("python");
  });
});

describe("usePracticeCodeLanguage — the store read", () => {
  it("returns the current value and a setter", () => {
    const { state } = mountHook();
    expect(state.codeLanguage).toBe(AUTO);
    act(() => state.setCodeLanguage("python"));
    expect(state.codeLanguage).toBe("python");
  });
});

describe("a language change discards the app's DRAFTS, on both origins (AC-C25, A17)", () => {
  it("calls the narrow seam on a LOCAL change, with the room invalidator", () => {
    const { invalidateRoomDrafts } = mountHook();
    act(() => setCodeLanguage("java"));

    expect(discardDraftedAnswers).toHaveBeenCalledTimes(1);
    expect(discardDraftedAnswers.mock.calls[0][0]).toMatchObject({
      origin: "local",
      invalidateRoomDrafts,
    });
    // The observable effect, not merely the call: omitting one callback from
    // the bag is the same defect class as wiring the composer to the wrong
    // trigger — the composer is correct, the duty silently never runs, and
    // every pure test of the composer stays green.
    expect(invalidateRoomDrafts).toHaveBeenCalledTimes(1);
  });

  it("calls it on a FOREIGN change too, with the origin forwarded not hardcoded", () => {
    const { invalidateRoomDrafts } = mountHook();
    act(() => fireForeignLanguage("go"));

    expect(discardDraftedAnswers).toHaveBeenCalledTimes(1);
    expect(discardDraftedAnswers.mock.calls[0][0].origin).toBe("foreign");
    expect(invalidateRoomDrafts).toHaveBeenCalledTimes(1);
  });

  it("NEVER reaches a composer that destroys the candidate's own work (A17)", () => {
    const { invalidateRoomDrafts } = mountHook();
    act(() => setCodeLanguage("java"));

    expect(discardAnswerWork).not.toHaveBeenCalled();
    expect(discardPracticeWork).not.toHaveBeenCalled();
    expect(discardQuestionAndScoreWork).not.toHaveBeenCalled();
    // The positive control that makes those three absences mean something.
    expect(invalidateRoomDrafts).toHaveBeenCalledTimes(1);
  });

  it("does not fire on an interview-type change — that one is chunk A's", () => {
    const { invalidateRoomDrafts } = mountHook();
    act(() => setInterviewType("technical"));
    expect(discardDraftedAnswers).not.toHaveBeenCalled();
    expect(invalidateRoomDrafts).not.toHaveBeenCalled();

    act(() => setCodeLanguage("java"));
    expect(discardDraftedAnswers).toHaveBeenCalledTimes(1);
  });

  it("does not fire when the language is re-selected unchanged", () => {
    setCodeLanguage("java");
    const { invalidateRoomDrafts } = mountHook();
    act(() => setCodeLanguage("java"));
    expect(discardDraftedAnswers).not.toHaveBeenCalled();
    expect(invalidateRoomDrafts).not.toHaveBeenCalled();
  });
});

// R-3 remediation — HIGH a11y finding 2. `discardDraftedAnswers` blanks the
// room's drafts and leaves `status: "idle"`, and `answerStatusMessage("idle")`
// is `""` (see choiceChangeInvalidation.js's codeLanguageChangeAnnouncement) —
// so without this, the practice tab's wipe had NO report at all, on either
// origin.
describe("a language change is ANNOUNCED on the practice tab, on both origins (R-3, a11y finding 2)", () => {
  it("announces a LOCAL change, attributed to this tab", () => {
    const onAnnounce = vi.fn();
    mountHook({ onAnnounce });
    act(() => setCodeLanguage("python"));
    expect(onAnnounce).toHaveBeenCalledTimes(1);
    expect(onAnnounce).toHaveBeenCalledWith("Code language set to Python. Drafted answers were cleared.");
  });

  it("announces a FOREIGN change, attributed to the other window", () => {
    const onAnnounce = vi.fn();
    mountHook({ onAnnounce });
    act(() => fireForeignLanguage("go"));
    expect(onAnnounce).toHaveBeenCalledTimes(1);
    expect(onAnnounce).toHaveBeenCalledWith(
      "Code language changed to Go in another window. Drafted answers were cleared.",
    );
  });

  it("is optional — the store-read tests above pass none and still work", () => {
    const { invalidateRoomDrafts } = mountHook();
    expect(() => act(() => setCodeLanguage("java"))).not.toThrow();
    expect(invalidateRoomDrafts).toHaveBeenCalledTimes(1);
  });
});

describe("the destructive seams are unreachable from this module (A17, D-7, prohibitions 22-23)", () => {
  // Source-text, over CODE only — the header is required to name these in
  // prose, and asserting over the raw file would punish an implementation for
  // explaining itself.
  const CODE = stripLineComments(readSource("./usePracticeCodeLanguage.js"));

  it("names none of the destructive duties in executable code", () => {
    // `resetAnswerState` reaches `revokeReplay()` -> `URL.revokeObjectURL`,
    // which is irreversible; `abandonInProgressAnswer` destroys a take still
    // being recorded. A language change has no claim on either.
    for (const forbidden of [
      "resetAnswerState",
      "abandonInProgressAnswer",
      "clearSessionScores",
      "resetQuestions",
      "discardAnswerWork",
      "discardPracticeWork",
    ]) {
      expect(CODE).not.toContain(forbidden);
    }
  });

  it("adds no staleness caption — chunk C emits no code for one to be about (D-7)", () => {
    // Not marked, because chunk C resolves a language and puts a token in a
    // prompt; code-bearing answers arrive in chunk B. A caption saying the
    // answer predates a language change would point at a difference the user
    // cannot see — which is what D-4 refuses for the picker's blurb, one
    // ruling later. The visible mark and its wording are chunk B's.
    expect(CODE).not.toContain("staleChangeNote");
    expect(CODE).not.toContain("staleTypeChangeAt");
  });

  it("calls the composer rather than inlining its duty list", () => {
    expect(CODE).toMatch(
      /import\s*\{[^}]*\bdiscardDraftedAnswers\b[^}]*\}\s*from\s*["']@\/lib\/copilot\/choiceChangeInvalidation(?:\.js)?["']/,
    );
    expect(CODE).toMatch(/\bdiscardDraftedAnswers\s*\(/);
  });
});
