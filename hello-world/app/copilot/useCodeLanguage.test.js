// @vitest-environment jsdom
//
// `app/copilot/useCodeLanguage.js` — the SECOND caller of
// `lib/copilot/choiceStore.js`'s factory, and therefore the moment that
// contract is tested for real.
//
// Written BEFORE the implementation exists (step 4b): every case fails on the
// missing `./useCodeLanguage.js` module until wave 2 lands.
//
// THE CASE THIS FILE EXISTS FOR, and it is one chunk A could not write:
// `choiceStore.js`'s own header says every piece of state is per-instance
// "DECLARED INSIDE THE FACTORY FUNCTION BODY (FD-1)", because the obvious
// shape for a single-caller store is a module-level `let currentValue` —
// which a second store silently overwrites the moment it exists. Chunk A had
// exactly one caller, so the defect would have surfaced HERE, "as two
// unrelated controls moving together — invisible to every test a
// single-instance chunk could write". `choiceStore.test.js` constructs two
// synthetic stores to catch it; this file is the first time the two REAL ones
// coexist.
//
// The rest mirrors `useInterviewType.test.js` case for case, because AC-C4
// says so explicitly ("on AC-A6/A7/A10's terms… survives an unreachable
// localStorage on AC-A8's terms") — and because the defect AC-C4's Fails if
// names is a CLONE: `useInterviewType.js:42-52`'s old comment claimed a failed
// write "still applies for the rest of this tab", and it did not.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createElement, act } from "react";
import { createRoot } from "react-dom/client";

import {
  CODE_LANGUAGE_STORAGE_KEY,
  getCodeLanguage,
  setCodeLanguage,
  onCodeLanguageChanged,
  getCodeLanguageStorageBlocked,
  __resetCodeLanguageForTests,
  useCodeLanguage,
  useCodeLanguageChange,
  useCodeLanguageStorageBlocked,
} from "./useCodeLanguage.js";
import {
  INTERVIEW_TYPE_STORAGE_KEY,
  getInterviewType,
  setInterviewType,
  getInterviewTypeStorageBlocked,
  __resetInterviewTypeForTests,
} from "./useInterviewType.js";
import { resetAllChoiceStores } from "@/lib/copilot/choiceStore";
import { AUTO } from "@/lib/copilot/codeLanguages";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const mounted = [];

function mountHook(useIt) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  const seen = { renders: 0, value: undefined };
  function Probe() {
    seen.renders += 1;
    seen.value = useIt();
    return null;
  }
  mounted.push({ root, container });
  act(() => {
    root.render(createElement(Probe));
  });
  return seen;
}

function fireForeignStorage({ key = CODE_LANGUAGE_STORAGE_KEY, newValue = null } = {}) {
  window.dispatchEvent(
    new StorageEvent("storage", { key, newValue, storageArea: window.localStorage }),
  );
}

beforeEach(() => {
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
  // Neither `clearMocks` nor `restoreMocks` is set in this repo, and the cases
  // below install THROWING spies on `Storage.prototype`.
  vi.restoreAllMocks();
  window.localStorage.clear();
  __resetCodeLanguageForTests();
  __resetInterviewTypeForTests();
});

describe("useCodeLanguage — its own key, its own default (AC-C4, AC-C28b)", () => {
  it("is named and stable, in the shape of the interview type's key", () => {
    expect(CODE_LANGUAGE_STORAGE_KEY).toBe("copilot-code-language");
    // And it is NOT the interview type's — one key holding two choices is the
    // failure the second store exists to avoid.
    expect(CODE_LANGUAGE_STORAGE_KEY).not.toBe(INTERVIEW_TYPE_STORAGE_KEY);
  });

  it("defaults to `auto`, never to the empty string (AC-C24b)", () => {
    expect(getCodeLanguage()).toBe(AUTO);
    expect(getCodeLanguage()).not.toBe("");
  });

  it("persists a selection under that key", () => {
    setCodeLanguage("typescript");
    expect(window.localStorage.getItem(CODE_LANGUAGE_STORAGE_KEY)).toBe("typescript");
    expect(getCodeLanguage()).toBe("typescript");
  });

  it("reads a persisted value back on a fresh load", async () => {
    window.localStorage.setItem(CODE_LANGUAGE_STORAGE_KEY, "sql");
    vi.resetModules();
    const fresh = await import("./useCodeLanguage.js");
    expect(fresh.getCodeLanguage()).toBe("sql");
  });

  it("reads back `auto` for a retired value and for empty storage", async () => {
    window.localStorage.setItem(CODE_LANGUAGE_STORAGE_KEY, "cobol");
    vi.resetModules();
    const withJunk = await import("./useCodeLanguage.js");
    expect(withJunk.getCodeLanguage()).toBe(AUTO);

    window.localStorage.clear();
    vi.resetModules();
    const empty = await import("./useCodeLanguage.js");
    expect(empty.getCodeLanguage()).toBe(AUTO);
  });

  it("never stores a `#` — C# is `csharp` in storage (§B.1)", () => {
    setCodeLanguage("csharp");
    expect(window.localStorage.getItem(CODE_LANGUAGE_STORAGE_KEY)).toBe("csharp");
  });

  it("survives a round trip through a non-code-bearing interview type (AC-C3)", () => {
    // The control is ABSENT under a non-code-bearing type (AC-C2), so the
    // question AC-C3 asks is what happens to the user's choice while it is
    // off screen. It holds by construction only because the value lives in
    // THIS store rather than in the unmounted control — which is a property
    // worth pinning, because "lift it into the field's own state" is the
    // natural simplification and it silently discards the choice.
    setCodeLanguage("go");
    setInterviewType("general"); // the control unmounts here
    expect(getCodeLanguage()).toBe("go");
    setInterviewType("technical"); // and comes back
    expect(getCodeLanguage()).toBe("go");
    expect(window.localStorage.getItem(CODE_LANGUAGE_STORAGE_KEY)).toBe("go");
  });
});

describe("useCodeLanguage — cross-window changes (AC-C4 on AC-A10's terms)", () => {
  it("adopts a value written by another window", () => {
    window.localStorage.setItem(CODE_LANGUAGE_STORAGE_KEY, "go");
    act(() => fireForeignStorage({ newValue: "go" }));
    expect(getCodeLanguage()).toBe("go");
  });

  it("ignores a `storage` event for a DIFFERENT key", () => {
    // A `storage` event fires for EVERY key on the origin. The filter is an
    // exact match, deliberately never a prefix check.
    setCodeLanguage("java");
    window.localStorage.setItem("copilot-audio-source", "system");
    act(() => fireForeignStorage({ key: "copilot-audio-source", newValue: "system" }));
    expect(getCodeLanguage()).toBe("java");
  });

  it("re-hydrates on `e.key === null` — another window's localStorage.clear()", () => {
    setCodeLanguage("java");
    window.localStorage.clear();
    act(() => fireForeignStorage({ key: null }));
    // Ignoring a null key would strand this tab on a value storage no longer
    // holds.
    expect(getCodeLanguage()).toBe(AUTO);
  });

  it("reports a foreign change with origin `foreign`, and a local one with `local`", () => {
    const seen = [];
    const unsubscribe = onCodeLanguageChanged((next, prev, meta) => seen.push([next, prev, meta.origin]));
    act(() => setCodeLanguage("python"));
    window.localStorage.setItem(CODE_LANGUAGE_STORAGE_KEY, "go");
    act(() => fireForeignStorage({ newValue: "go" }));
    unsubscribe();

    expect(seen).toEqual([
      ["python", AUTO, "local"],
      ["go", "python", "foreign"],
    ]);
  });

  it("does not notify when the value is unchanged (AC-A14's rule, applied here)", () => {
    setCodeLanguage("java");
    const seen = [];
    const unsubscribe = onCodeLanguageChanged((next) => seen.push(next));
    act(() => setCodeLanguage("java"));
    unsubscribe();
    expect(seen).toEqual([]);
  });
});

describe("useCodeLanguage — an unreachable localStorage (AC-C4, AC-A8's terms)", () => {
  it("keeps the selection applying for the rest of the tab after a failed write", () => {
    // The defect AC-C4's Fails if names, cloned from `useInterviewType.js`'s
    // own predecessor: the notification re-renders, the read path re-reads the
    // same throwing storage, and the control snaps back to the default with no
    // error anywhere.
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("QuotaExceededError");
    });
    act(() => setCodeLanguage("go"));
    expect(getCodeLanguage()).toBe("go");
  });

  it("raises a PRIMITIVE boolean flag, sticky for the life of the tab (AC-A8c)", () => {
    expect(getCodeLanguageStorageBlocked()).toBe(false);
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("QuotaExceededError");
    });
    act(() => setCodeLanguage("go"));
    expect(getCodeLanguageStorageBlocked()).toBe(true);
    expect(typeof getCodeLanguageStorageBlocked()).toBe("boolean");

    // It reports the ENVIRONMENT, not the outcome of one write: a later
    // successful write must not un-tell the user their choices are not saved.
    vi.restoreAllMocks();
    act(() => setCodeLanguage("java"));
    expect(getCodeLanguageStorageBlocked()).toBe(true);
  });

  it("does not re-render forever — the snapshot is `Object.is`-stable", () => {
    // AC-A8c is an infinite-render trap, not a performance note:
    // `useSyncExternalStore` bails out only when the snapshot is
    // `Object.is`-equal to the last one, so a fresh allocation on every call
    // is never equal to itself.
    const seen = mountHook(useCodeLanguageStorageBlocked);
    const before = seen.renders;
    act(() => setCodeLanguage("go"));
    expect(seen.value).toBe(false);
    expect(seen.renders - before).toBeLessThanOrEqual(2);
  });
});

describe("the two stores are INDEPENDENT — FD-1, the assertion chunk A could not write", () => {
  it("a language write does not move the interview type", () => {
    setInterviewType("technical");
    setCodeLanguage("go");
    expect(getInterviewType()).toBe("technical");
    expect(getCodeLanguage()).toBe("go");
  });

  it("an interview-type write does not move the language", () => {
    setCodeLanguage("go");
    setInterviewType("system-design");
    expect(getCodeLanguage()).toBe("go");
    expect(getInterviewType()).toBe("system-design");
  });

  it("blocking ONE store's key does not raise the other's flag", () => {
    const real = Storage.prototype.setItem;
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(function setItem(key, value) {
      if (key === CODE_LANGUAGE_STORAGE_KEY) throw new Error("QuotaExceededError");
      return real.call(this, key, value);
    });
    act(() => setCodeLanguage("go"));
    act(() => setInterviewType("technical"));

    expect(getCodeLanguageStorageBlocked()).toBe(true);
    // The flag is PER-INSTANCE. Shared, option Z's whole precedence collapses
    // and both pickers say the same sentence at once.
    expect(getInterviewTypeStorageBlocked()).toBe(false);
  });

  it("a change listener on one store never fires for the other", () => {
    const seen = [];
    const unsubscribe = onCodeLanguageChanged((next) => seen.push(next));
    act(() => setInterviewType("technical"));
    expect(seen).toEqual([]);
    // Positive control: the listener is alive.
    act(() => setCodeLanguage("go"));
    unsubscribe();
    expect(seen).toEqual(["go"]);
  });

  it("resetAllChoiceStores() resets BOTH — a per-store reset under-resets from here on", () => {
    setCodeLanguage("go");
    setInterviewType("technical");
    resetAllChoiceStores();
    expect(getCodeLanguage()).toBe(AUTO);
    expect(getInterviewType()).toBe("general");
  });
});

describe("useCodeLanguage — the React surface", () => {
  it("exposes the value and a stable setter", () => {
    const seen = mountHook(useCodeLanguage);
    expect(seen.value.codeLanguage).toBe(AUTO);
    const firstSetter = seen.value.setCodeLanguage;
    act(() => seen.value.setCodeLanguage("python"));
    expect(seen.value.codeLanguage).toBe("python");
    expect(seen.value.setCodeLanguage).toBe(firstSetter);
  });

  it("useCodeLanguageChange registers a subscription that actually fires", () => {
    const handler = vi.fn();
    mountHook(() => useCodeLanguageChange(handler));
    act(() => setCodeLanguage("java"));
    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler.mock.calls[0][0]).toBe("java");
    expect(handler.mock.calls[0][2]).toMatchObject({ origin: "local" });
  });

  it("useCodeLanguageStorageBlocked follows the flag", () => {
    const seen = mountHook(useCodeLanguageStorageBlocked);
    expect(seen.value).toBe(false);
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("QuotaExceededError");
    });
    act(() => setCodeLanguage("go"));
    expect(seen.value).toBe(true);
  });
});
