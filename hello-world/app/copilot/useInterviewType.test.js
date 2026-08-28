// @vitest-environment jsdom
//
// `app/copilot/useInterviewType.js` — the store MOVED out of `practice/` and
// rewritten over `lib/copilot/choiceStore.js`'s factory, now shared by the live
// and practice surfaces.
//
// Written BEFORE the implementation exists (step 4b), so every case here fails
// on the missing module until the move lands. The module it replaces
// (`app/copilot/practice/useInterviewType.js`) has NO test file at all today,
// which is the reason the failure path this file exercises has never been run:
//
//   * AC-A8 / AC-A9 — `useInterviewType.js:46-50` today comments that on a
//     failed `setItem` "the choice still applies for the rest of this tab via
//     the listener notification below". IT DOES NOT. The notification triggers
//     a re-render, `readInterviewType` re-reads the same throwing storage, and
//     returns the default — the picker appears frozen on "General / mixed"
//     with no error anywhere, and every subsequent request body and cache key
//     carries the old type. That is the live defect this file pins closed.
//   * AC-A20 — the value is read by a SYNCHRONOUS `getInterviewType()` call at
//     the capture point, never from a render-mirrored ref. `useSyncExternalStore`'s
//     subscribe callback only SCHEDULES a render and `useEffect` is passive and
//     commits after paint, so a mirrored ref still holds the OLD value inside a
//     synchronous change listener — under every flush mode, `flushSync`
//     included. The read-inside-the-listener case below is what distinguishes
//     the two implementations.
//   * AC-A10 — a `storage` event fires for EVERY key on the origin, so the
//     handler must filter on the exact key. `copilot-audio-source` is written
//     from two separate files in this app.
//   * AC-A7 — the key is byte-identical to the one practice mode already
//     writes. Renaming it silently resets every existing practice user.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createElement, act } from "react";
import { createRoot } from "react-dom/client";

import InterviewTypePicker from "./InterviewTypePicker.js";

import {
  INTERVIEW_TYPE_STORAGE_KEY,
  getInterviewType,
  setInterviewType,
  onInterviewTypeChanged,
  getInterviewTypeStorageBlocked,
  __resetInterviewTypeForTests,
  useInterviewType,
  useInterviewTypeChange,
  useInterviewTypeStorageBlocked,
} from "./useInterviewType.js";

// Path helper, deliberately NOT `fileURLToPath(new URL(rel, import.meta.url))`:
// under `@vitest-environment jsdom` the global `URL` is jsdom's whatwg-url
// class, not Node's, and `fileURLToPath` rejects an instance of it with
// "The URL must be of scheme file". Passing `import.meta.url` as a STRING has
// no such realm problem, and `node:path` does the rest.
const HERE = dirname(fileURLToPath(import.meta.url));
const readSource = (rel) => readFileSync(join(HERE, rel), "utf8");

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const mounted = [];

function mountHook(useIt, props = {}) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  const seen = { renders: 0, value: undefined };
  function Probe(componentProps) {
    seen.renders += 1;
    seen.value = useIt(componentProps);
    return null;
  }
  mounted.push({ root, container });
  act(() => {
    root.render(createElement(Probe, props));
  });
  return { root, container, seen };
}

function fireForeignStorage({ key = INTERVIEW_TYPE_STORAGE_KEY, newValue = null } = {}) {
  window.dispatchEvent(
    new StorageEvent("storage", {
      key,
      newValue,
      storageArea: window.localStorage,
    }),
  );
}

beforeEach(() => {
  window.localStorage.clear();
  __resetInterviewTypeForTests();
});

afterEach(() => {
  while (mounted.length) {
    const m = mounted.pop();
    act(() => m.root.unmount());
    m.container.remove();
  }
  // This repo sets neither `clearMocks` nor `restoreMocks`, and the cases
  // below install THROWING spies on Storage.prototype — a spy left standing
  // makes every later case in this file believe storage is unwritable.
  vi.restoreAllMocks();
  window.localStorage.clear();
  __resetInterviewTypeForTests();
});

describe("useInterviewType — the storage key is not renamed (AC-A7)", () => {
  it("is byte-identical to the key practice mode already writes", () => {
    expect(INTERVIEW_TYPE_STORAGE_KEY).toBe("copilot-practice-interview-type");
  });

  it("persists the selection under that key", () => {
    setInterviewType("technical");
    expect(window.localStorage.getItem("copilot-practice-interview-type")).toBe("technical");
  });

  it("reads a persisted value back on a fresh load", async () => {
    window.localStorage.setItem("copilot-practice-interview-type", "system-design");
    vi.resetModules();
    const fresh = await import("./useInterviewType.js");
    expect(fresh.getInterviewType()).toBe("system-design");
  });

  it("reads back the default for a value outside the vocabulary, and for empty storage", async () => {
    window.localStorage.setItem("copilot-practice-interview-type", "retired-format");
    vi.resetModules();
    const withGarbage = await import("./useInterviewType.js");
    expect(withGarbage.getInterviewType()).toBe("general");

    window.localStorage.clear();
    vi.resetModules();
    const empty = await import("./useInterviewType.js");
    expect(empty.getInterviewType()).toBe("general");
  });
});

describe("useInterviewType — the synchronous read (AC-A20)", () => {
  it("getInterviewType() returns the new value in the same synchronous turn as setInterviewType()", () => {
    // No act(), no await, no paint between these two statements. A ref
    // mirrored during render cannot be current here, and neither can a value
    // re-read from React state.
    expect(getInterviewType()).toBe("general");
    setInterviewType("technical");
    expect(getInterviewType()).toBe("technical");
  });

  it("has already advanced the value by the time the FIRST change listener runs (C6 step 1)", () => {
    const readsInsideListener = [];
    const off = onInterviewTypeChanged(() => readsInsideListener.push(getInterviewType()));

    setInterviewType("behavioral");
    off();

    // Every consumer of this store reads it with `getInterviewType()` from
    // inside a change callback — a store that notified before advancing would
    // hand each of them the value the user just left.
    expect(readsInsideListener).toEqual(["behavioral"]);
  });

  it("hands the listener the next value, the previous value and the origin", () => {
    const seen = [];
    const off = onInterviewTypeChanged((next, prev, meta) => seen.push([next, prev, meta?.origin]));
    setInterviewType("technical");
    off();
    expect(seen).toEqual([["technical", "general", "local"]]);
  });

  it("normalizes an unrecognised value rather than passing it through", () => {
    setInterviewType("definitely-not-a-type");
    expect(getInterviewType()).toBe("general");
  });
});

describe("useInterviewType — AC-A14, re-selecting the same type", () => {
  it("notifies nobody when the value did not change", () => {
    setInterviewType("technical");

    const change = vi.fn();
    const off = onInterviewTypeChanged(change);
    setInterviewType("technical");
    expect(change).not.toHaveBeenCalled();

    // Positive control: today's `useInterviewType.js:51` notifies
    // unconditionally, so an implementation that never notifies at all would
    // satisfy the assertion above on its own.
    setInterviewType("behavioral");
    expect(change).toHaveBeenCalledTimes(1);
    off();
  });
});

describe("useInterviewType — the cross-window channel (AC-A10)", () => {
  it("adopts a change made in another window, with origin 'foreign'", () => {
    const seen = [];
    const off = onInterviewTypeChanged((next, prev, meta) => seen.push([next, prev, meta?.origin]));

    window.localStorage.setItem(INTERVIEW_TYPE_STORAGE_KEY, "system-design");
    fireForeignStorage({ newValue: "system-design" });
    off();

    expect(getInterviewType()).toBe("system-design");
    expect(seen).toEqual([["system-design", "general", "foreign"]]);
  });

  it("ignores an event for a different key on the same origin", () => {
    const change = vi.fn();
    const off = onInterviewTypeChanged(change);

    // A real key this app writes from two separate files, which is why a
    // `startsWith("copilot-")` filter is wrong rather than merely loose.
    window.localStorage.setItem("copilot-audio-source", "system");
    fireForeignStorage({ key: "copilot-audio-source", newValue: "system" });

    expect(getInterviewType()).toBe("general");
    expect(change).not.toHaveBeenCalled();

    // Positive control in the same case: the handler IS attached, so the
    // absence above is a filter working rather than a listener never wired.
    window.localStorage.setItem(INTERVIEW_TYPE_STORAGE_KEY, "technical");
    fireForeignStorage({ newValue: "technical" });
    expect(getInterviewType()).toBe("technical");
    expect(change).toHaveBeenCalledTimes(1);
    off();
  });

  it("ignores an event from a storage area that is not localStorage", () => {
    // The only negative fixture for the area filter that runs in jsdom — every
    // other case here passes `storageArea: window.localStorage`, so without it
    // the filter has no jsdom coverage at all.
    const change = vi.fn();
    const off = onInterviewTypeChanged(change);

    window.localStorage.setItem(INTERVIEW_TYPE_STORAGE_KEY, "technical");
    window.dispatchEvent(
      new StorageEvent("storage", {
        key: INTERVIEW_TYPE_STORAGE_KEY,
        newValue: "technical",
        storageArea: window.sessionStorage,
      }),
    );
    expect(getInterviewType()).toBe("general");
    expect(change).not.toHaveBeenCalled();

    // Positive control: the same event from the real area IS taken.
    fireForeignStorage({ newValue: "technical" });
    expect(getInterviewType()).toBe("technical");
    off();
  });

  it("accepts e.key === null — a foreign clear() — instead of stranding this tab", () => {
    window.localStorage.setItem(INTERVIEW_TYPE_STORAGE_KEY, "technical");
    fireForeignStorage({ newValue: "technical" });
    expect(getInterviewType()).toBe("technical");

    window.localStorage.clear();
    fireForeignStorage({ key: null, newValue: null });
    expect(getInterviewType()).toBe("general");
  });
});

describe("useInterviewType — a selection made while storage refuses writes (AC-A8)", () => {
  it("applies the choice and does not snap back to the stored value", () => {
    window.localStorage.setItem(INTERVIEW_TYPE_STORAGE_KEY, "general");
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("QuotaExceededError");
    });

    setInterviewType("technical");

    // Today: the failed write notifies, the re-render re-reads the same
    // storage, and the picker sits frozen on "General / mixed" forever.
    expect(getInterviewType()).toBe("technical");
    expect(getInterviewType()).toBe("technical");

    const { seen } = mountHook(useInterviewType);
    expect(seen.value.interviewType).toBe("technical");

    // ...and storage genuinely never took it, so this is not green because
    // the write quietly succeeded.
    expect(window.localStorage.getItem(INTERVIEW_TYPE_STORAGE_KEY)).toBe("general");
  });

  it("still adopts a real foreign write while its own value is unpersisted (AC-A8's scope)", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("QuotaExceededError");
    });
    setInterviewType("technical");
    expect(getInterviewType()).toBe("technical");

    // The other window's write is a real user act, so it wins. What AC-A8
    // guarantees is only that THIS tab's own READ PATH never reverts it.
    Storage.prototype.setItem.mockRestore();
    window.localStorage.setItem(INTERVIEW_TYPE_STORAGE_KEY, "behavioral");
    fireForeignStorage({ newValue: "behavioral" });
    expect(getInterviewType()).toBe("behavioral");
  });

  it("still fires the change on the SECOND selection of a quota session (A5's trace)", () => {
    // Storage holds `general`. The tab picks `technical` (write throws) and
    // caches answers under it. The tab picks `general` again. A baseline that
    // tracks STORAGE sees general === general, swallows the change, and leaves
    // `technical`-grounded entries sitting behind a tab that believes
    // `general`. The baseline must be BELIEF.
    window.localStorage.setItem(INTERVIEW_TYPE_STORAGE_KEY, "general");
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("QuotaExceededError");
    });

    const seen = [];
    const off = onInterviewTypeChanged((next, prev) => seen.push([next, prev]));
    setInterviewType("technical");
    setInterviewType("general");
    off();

    expect(seen).toEqual([
      ["technical", "general"],
      ["general", "technical"],
    ]);
  });
});

describe("useInterviewTypeStorageBlocked — AC-A8b / AC-A8c", () => {
  it("is false on a healthy store and true once a write has failed", () => {
    expect(getInterviewTypeStorageBlocked()).toBe(false);
    setInterviewType("technical");
    // Positive control: a successful write must NOT claim storage is blocked.
    expect(getInterviewTypeStorageBlocked()).toBe(false);

    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("QuotaExceededError");
    });
    setInterviewType("behavioral");
    expect(getInterviewTypeStorageBlocked()).toBe(true);
  });

  it("is a PRIMITIVE snapshot, not a fresh object each call (AC-A8c)", () => {
    // `useSyncExternalStore` compares snapshots with Object.is, so a newly
    // allocated value every call re-renders forever. This is an
    // infinite-render trap, not a performance note.
    const first = getInterviewTypeStorageBlocked();
    const second = getInterviewTypeStorageBlocked();
    expect(typeof first).toBe("boolean");
    expect(Object.is(first, second)).toBe(true);
  });

  it("renders through the hook without re-rendering on every commit", () => {
    const { seen } = mountHook(useInterviewTypeStorageBlocked);
    expect(seen.value).toBe(false);
    const rendersAfterMount = seen.renders;

    act(() => {
      // A value change must not churn the blocked-flag subscriber: the
      // boolean snapshot is unchanged, so React bails out.
      setInterviewType("technical");
    });
    expect(seen.renders).toBe(rendersAfterMount);
    expect(seen.value).toBe(false);
  });

  it("goes TRUE through the hook the moment storage refuses a write", () => {
    // AC-A8b's user-facing half. The hook is the sole source of the picker's
    // "not saved" helper text (plan row N6), so `export function
    // useInterviewTypeStorageBlocked() { return false; }` would leave the one
    // state this criterion exists for — "in words, on the control, at the
    // moment it becomes true" — with no guard anywhere in chunk A.
    //
    // Without this case the hook is only ever observed returning `false`, and
    // the "does not churn" assertion above is a tautology rather than a
    // contrast.
    const { seen } = mountHook(useInterviewTypeStorageBlocked);
    expect(seen.value).toBe(false);
    const rendersBefore = seen.renders;

    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("QuotaExceededError");
    });
    act(() => {
      setInterviewType("technical");
    });

    expect(seen.value).toBe(true);
    // It must reach the control, not merely be true behind a stale snapshot.
    expect(seen.renders).toBeGreaterThan(rendersBefore);
  });
});

describe("useInterviewType / useInterviewTypeChange — the React wrappers", () => {
  it("useInterviewType() exposes the current value and a setter, and re-renders on an external change", () => {
    const { seen } = mountHook(useInterviewType);
    expect(seen.value.interviewType).toBe("general");

    act(() => {
      setInterviewType("technical");
    });
    expect(seen.value.interviewType).toBe("technical");

    act(() => {
      seen.value.setInterviewType("behavioral");
    });
    expect(seen.value.interviewType).toBe("behavioral");
    expect(getInterviewType()).toBe("behavioral");
  });

  it("two independent mounts of useInterviewType() always agree", () => {
    // C1/A11: two `useSyncExternalStore` calls against ONE store hold two
    // derived views of one value and cannot diverge — which is the property
    // that makes prop-drilling unnecessary between the surfaces.
    const a = mountHook(useInterviewType);
    const b = mountHook(useInterviewType);
    act(() => {
      setInterviewType("system-design");
    });
    expect(a.seen.value.interviewType).toBe("system-design");
    expect(b.seen.value.interviewType).toBe("system-design");
  });

  it("useInterviewTypeChange(handler) subscribes while mounted and unsubscribes on unmount", () => {
    const handler = vi.fn();
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    function Probe() {
      useInterviewTypeChange(handler);
      return null;
    }
    act(() => root.render(createElement(Probe)));

    act(() => setInterviewType("technical"));
    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler.mock.calls[0][0]).toBe("technical");
    expect(handler.mock.calls[0][2]).toMatchObject({ origin: "local" });

    act(() => root.unmount());
    container.remove();

    act(() => setInterviewType("behavioral"));
    expect(handler).toHaveBeenCalledTimes(1);
  });
});

describe("the false storage comment is corrected (AC-A9)", () => {
  it("no longer claims a failed write still applies via the listener notification", () => {
    // `useInterviewType.js:46-50` today says the choice "still applies for the
    // rest of this tab via the listener notification below". It does not: the
    // notification re-renders, `readInterviewType` re-reads the same throwing
    // storage, and the default comes back. The behaviour is fixed by the cases
    // above; this stops the sentence that described it wrongly from surviving
    // the move into the new file.
    const src = readSource("./useInterviewType.js");
    expect(src).not.toMatch(/the choice still applies for the\s+rest of this tab/);
    expect(src).not.toMatch(/still applies for the rest of this tab/);
  });
});

describe("__resetInterviewTypeForTests — AC-A29b", () => {
  it("localStorage.clear() alone no longer resets the store, which is why the seam exists", () => {
    setInterviewType("technical");
    window.localStorage.clear();
    expect(getInterviewType()).toBe("technical");

    __resetInterviewTypeForTests();
    expect(getInterviewType()).toBe("general");
  });
});

describe("InterviewTypePicker says so, on the control (AC-A8b)", () => {
  // AC-A8b's user-facing half: "in words, on the control, at the moment it
  // becomes true". The hook is guarded above; this is what proves the picker
  // actually READS it. Both files are W2-move's (plan rows N6 and N7), so
  // nothing here couples across waves.
  //
  // Rendered rather than read as source: the property is what the user sees,
  // and this repo already renders MUI under jsdom (the roles suites click a
  // switch by accessible name). Asserting on the rendered helper text also
  // survives the picker being restructured, which a source-text assertion
  // would not.
  //
  // The exact sentence is contract 10's; the assertions pin its MEANING —
  // that the blurb survives and the text says the choice is not being saved —
  // rather than its punctuation, so a wording fix is not a test failure.
  function mountPicker() {
    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    mounted.push({ root, container });
    act(() => {
      root.render(
        createElement(InterviewTypePicker, {
          value: getInterviewType(),
          onChange: () => {},
          disabled: false,
        }),
      );
    });
    return container;
  }

  const helperTextOf = (container) => container.querySelector("p")?.textContent || "";

  it("says nothing about storage while storage is healthy", () => {
    // The positive control. Without it, a picker that ALWAYS shows the
    // sentence — or one whose helper text is the sentence and nothing else —
    // passes the case below.
    const container = mountPicker();
    const text = helperTextOf(container);
    expect(text).toContain("A mix of behavioral, technical, and role-fit questions");
    expect(text).not.toMatch(/not saved/i);
  });

  it("tells the user the choice will not survive a reload, once a write has failed", () => {
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("QuotaExceededError");
    });
    act(() => {
      setInterviewType("technical");
    });

    const container = mountPicker();
    const text = helperTextOf(container);
    // The blurb is still there — the sentence is APPENDED to the existing
    // helper text, not a replacement for it.
    expect(text).toContain("Coding and problem-solving questions");
    expect(text).toMatch(/not saved/i);
    expect(text).toMatch(/blocking stored settings/i);
  });

  it("keeps the control's accessible name (AC-A24)", () => {
    const container = mountPicker();
    expect(container.textContent).toContain("Interview type");
  });
});
