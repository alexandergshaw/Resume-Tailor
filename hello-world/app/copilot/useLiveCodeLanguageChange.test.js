// @vitest-environment jsdom
//
// `app/copilot/useLiveCodeLanguageChange.js` — the live surface's language
// subscriber.
//
// Written BEFORE the implementation exists (step 4b): the whole file fails on
// the missing `./useLiveCodeLanguageChange.js` module until wave 3 lands.
//
// WHY THIS IS A HOOK MODULE AT ALL, and not a block inside `CopilotClient.js`:
// `CopilotClient.interviewTypeWiring.test.js:212-222` is a SOURCE-TEXT test
// asserting that file names neither `discardAnswerWork` nor
// `discardDraftedAnswers` — chunk A wrote those negatives naming them "chunk
// C's seams". Both stay green AND STAY TRUE with the duty in its own module,
// which is the point: a negative assertion kept green by relocating the call
// would be the wrong fix.
//
// WHAT IT MUST CALL, and what it must not compute: `invalidateLiveAnswers` is
// the SAME composer chunk A's live type change uses — CONFIGURED, never
// copied. And `canRedraft` is passed THROUGH, never re-derived here: AC-A15's
// origin condition is a billing constraint, not a UX one (a foreign-window
// change already invalidates the cache, so firing a billed model call because
// of a click in a window the candidate is not looking at buys nothing, and
// with two windows open it fires in each).

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createElement, act } from "react";
import { createRoot } from "react-dom/client";

// A delegating spy, not a stub: the real composer still runs, so the cases
// below can assert the OBSERVABLE EFFECT (the cache was cleared, the
// generation moved) as well as that the shared machinery was used. A stub
// would leave "the composer was called" as the only provable thing, which is
// the presence check this repo has already been burned by.
vi.mock("@/lib/copilot/choiceChangeInvalidation", async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, invalidateLiveAnswers: vi.fn(actual.invalidateLiveAnswers) };
});

import { useLiveCodeLanguageChange } from "./useLiveCodeLanguageChange.js";
import {
  CODE_LANGUAGE_STORAGE_KEY,
  setCodeLanguage,
  __resetCodeLanguageForTests,
} from "./useCodeLanguage.js";
import { setInterviewType, __resetInterviewTypeForTests } from "./useInterviewType.js";
import { invalidateLiveAnswers } from "@/lib/copilot/choiceChangeInvalidation";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const mounted = [];

function mountSubscriber(initial = {}) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  const spies = {
    clearAnswerCache: vi.fn(),
    bumpDraftGeneration: vi.fn(),
    redraftCurrentAnswer: vi.fn(),
  };
  function Probe({ canRedraft, onForeignChange }) {
    useLiveCodeLanguageChange({ canRedraft, onForeignChange, ...spies });
    return null;
  }
  mounted.push({ root, container });
  const render = (props) =>
    act(() => root.render(createElement(Probe, { canRedraft: false, ...initial, ...props })));
  render({});
  return { spies, render };
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
  // `vi.restoreAllMocks()` does not clear a `vi.fn()` made in a `vi.mock`
  // factory. `mockClear`, NOT `mockReset` — this one is a delegating spy and
  // `mockReset` would strip the real implementation it wraps.
  invalidateLiveAnswers.mockClear();
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
  window.localStorage.clear();
  __resetCodeLanguageForTests();
  __resetInterviewTypeForTests();
});

describe("a language change invalidates live answers on BOTH origins (AC-C25, AC-A12's rule)", () => {
  it("clears the cache and bumps the generation on a LOCAL change", () => {
    const { spies } = mountSubscriber();
    act(() => setCodeLanguage("java"));

    expect(invalidateLiveAnswers).toHaveBeenCalledTimes(1);
    expect(spies.clearAnswerCache).toHaveBeenCalledTimes(1);
    expect(spies.bumpDraftGeneration).toHaveBeenCalledTimes(1);
  });

  it("does the same on a FOREIGN change — the live duties destroy no user work", () => {
    // Unlike practice, this one is origin-blind deliberately: a cleared answer
    // cache costs a redraft; an abandoned recording costs a take the candidate
    // cannot re-record. That asymmetry is the whole basis of the origin split,
    // and it is why the split applies to practice and not here.
    const { spies } = mountSubscriber();
    act(() => fireForeignLanguage("go"));

    expect(invalidateLiveAnswers).toHaveBeenCalledTimes(1);
    expect(spies.clearAnswerCache).toHaveBeenCalledTimes(1);
    expect(spies.bumpDraftGeneration).toHaveBeenCalledTimes(1);
  });

  it("uses the SHARED composer, configured — not a second copy of its duty list", () => {
    const { spies } = mountSubscriber();
    act(() => setCodeLanguage("java"));
    const bag = invalidateLiveAnswers.mock.calls[0][0];
    expect(bag.clearAnswerCache).toBe(spies.clearAnswerCache);
    expect(bag.bumpDraftGeneration).toBe(spies.bumpDraftGeneration);
    expect(bag.redraftCurrentAnswer).toBe(spies.redraftCurrentAnswer);
  });
});

describe("the redraft is gated on the CALLER's canRedraft, never re-derived (CONF-1, AC-A15b)", () => {
  it("does not redraft when the caller says it may not", () => {
    const { spies } = mountSubscriber({ canRedraft: false });
    act(() => setCodeLanguage("java"));
    expect(spies.redraftCurrentAnswer).not.toHaveBeenCalled();
    // Paired positive control: the rest of the duty list DID run, so the
    // absence above is the gate and not a dead subscription.
    expect(spies.clearAnswerCache).toHaveBeenCalledTimes(1);
  });

  it("redrafts when the caller says it may", () => {
    const { spies } = mountSubscriber({ canRedraft: true });
    act(() => setCodeLanguage("java"));
    expect(spies.redraftCurrentAnswer).toHaveBeenCalledTimes(1);
  });

  it("passes the value it was given, verbatim", () => {
    const { spies } = mountSubscriber({ canRedraft: true });
    act(() => setCodeLanguage("java"));
    expect(invalidateLiveAnswers.mock.calls[0][0].canRedraft).toBe(true);
    expect(spies.redraftCurrentAnswer).toHaveBeenCalled();
  });

  it("follows canRedraft when it CHANGES — the registration is not frozen at mount", () => {
    // AC-A15b's exact defect, one criterion over: the gate is render-scope
    // state (`const live = status === "live" || status === "connecting"`), so
    // an empty dependency array freezes it at mount — where it is `false` —
    // and silently disables the redraft forever. It looks like the feature
    // simply not working, and no existing test would notice.
    const { spies, render } = mountSubscriber({ canRedraft: false });
    render({ canRedraft: true });
    act(() => setCodeLanguage("java"));
    expect(spies.redraftCurrentAnswer).toHaveBeenCalledTimes(1);
  });
});

describe("it subscribes to the LANGUAGE store and nothing else", () => {
  it("does not fire on an interview-type change", () => {
    // Chunk A already owns that change on this surface. Firing here too would
    // clear the live cache twice and, with `canRedraft`, spend a second billed
    // call on one user action.
    const { spies } = mountSubscriber({ canRedraft: true });
    act(() => setInterviewType("technical"));
    expect(invalidateLiveAnswers).not.toHaveBeenCalled();
    expect(spies.clearAnswerCache).not.toHaveBeenCalled();

    // The positive control the absence above needs.
    act(() => setCodeLanguage("java"));
    expect(invalidateLiveAnswers).toHaveBeenCalledTimes(1);
  });

  it("does not fire when the language is re-selected unchanged (AC-A14's rule)", () => {
    setCodeLanguage("java");
    const { spies } = mountSubscriber();
    act(() => setCodeLanguage("java"));
    expect(invalidateLiveAnswers).not.toHaveBeenCalled();
    expect(spies.clearAnswerCache).not.toHaveBeenCalled();
  });

  it("keeps the announcement OUT of invalidateLiveAnswers's own bag (R-3 supersedes UX V8/prohibition 21)", () => {
    // R-3 (a11y finding 2, HIGH) added the `onForeignChange` report below —
    // chunk C's original "no announcement at all" design turned out to leave
    // a foreign change with nothing explaining why the answer just redrew,
    // and practice with no report of a wipe at all (see
    // choiceChangeInvalidation.js's codeLanguageChangeAnnouncement). What
    // stays true from the original rule: the report is NOT threaded into the
    // shared `invalidateLiveAnswers` composer, and it is NOT a second
    // `claimStorageAnnouncement` call site — `onForeignChange` is a sibling
    // call, invoked separately, below.
    const { spies } = mountSubscriber();
    act(() => setCodeLanguage("java"));
    expect(Object.keys(invalidateLiveAnswers.mock.calls[0][0])).not.toContain("onAnnouncement");
    expect(spies.clearAnswerCache).toHaveBeenCalledTimes(1);
  });
});

describe("onForeignChange — the HIGH a11y fix (R-3, finding 2)", () => {
  it("is not called on a LOCAL change — the redraft already updates the answer-status region", () => {
    const onForeignChange = vi.fn();
    mountSubscriber({ onForeignChange });
    act(() => setCodeLanguage("java"));
    expect(onForeignChange).not.toHaveBeenCalled();
  });

  it("is called with the announcement sentence on a FOREIGN change", () => {
    const onForeignChange = vi.fn();
    mountSubscriber({ onForeignChange });
    act(() => fireForeignLanguage("java"));
    expect(onForeignChange).toHaveBeenCalledTimes(1);
    expect(onForeignChange).toHaveBeenCalledWith(
      "Code language changed to Java in another window. Your current answer is being redrafted.",
    );
  });

  it("still runs the rest of the duty list when nobody passed it — it is optional", () => {
    const { spies } = mountSubscriber();
    expect(() => act(() => fireForeignLanguage("go"))).not.toThrow();
    expect(spies.clearAnswerCache).toHaveBeenCalledTimes(1);
  });
});
