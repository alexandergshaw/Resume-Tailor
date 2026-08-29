// @vitest-environment jsdom
//
// `app/copilot/CodeLanguageField.js` — the render gate (AC-C2/AC-C2b) and
// F-C2's deferred unmount (D-5), in the one place either can live without
// inverting something already shipped.
//
// Written BEFORE the implementation exists (step 4b): the whole file fails on
// the missing `./CodeLanguageField.js` module until wave 3 lands.
//
// WHY THIS COMPONENT EXISTS AT ALL, recorded so nobody "simplifies" it away:
//   * not in `SessionSetup.js` / `PracticeSetup.js` — both headers declare "no
//     hooks, no handlers, no derived values here", and both call zero hooks
//     today;
//   * not in `CopilotClient.js` — it is at 933 of a hard, executable 950;
//   * not in `CodeLanguagePicker.js` — a component cannot defer its OWN
//     unmount; the decision has to sit one level above the element being
//     removed.
//
// AND THE DEFERRAL'S OWN TRAP, which revision 3 of the plan left unspecified:
// the gate closes on an INTERVIEW-TYPE change, so the subscription is
// `useInterviewTypeChange`, not `useCodeLanguageChange`. The wrong choice
// produces a deferral that can never fire, and it is silent.
//
// THE ASSERTION IS THE OBSERVABLE PROPERTY, never the mechanism: after a
// foreign-window change that closes the gate, `document.activeElement` is
// never `<body>` — the exact failure `SpeakerChip.js:74` names for the same
// class of defect ("a keyboard-only user … has their focus silently reset").
// SpeakerChip's own remedy — stay mounted, toggle `disabled` — is the one
// thing this cannot copy, because AC-C2 forbids `disabled` as a steady state.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createElement, act } from "react";
import { createRoot } from "react-dom/client";

import CodeLanguageField from "./CodeLanguageField.js";
import {
  INTERVIEW_TYPE_STORAGE_KEY,
  useInterviewType,
  setInterviewType,
  getInterviewTypeStorageBlocked,
  __resetInterviewTypeForTests,
} from "./useInterviewType.js";
import {
  CODE_LANGUAGE_STORAGE_KEY,
  setCodeLanguage,
  __resetCodeLanguageForTests,
} from "./useCodeLanguage.js";
import { STORAGE_SENTENCE } from "./CodeLanguagePicker.js";
import { CONTROL_OPTIONS } from "@/lib/copilot/codeLanguages";

const HERE = dirname(fileURLToPath(import.meta.url));
const readSource = (rel) => readFileSync(join(HERE, rel), "utf8");

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const mounted = [];

// The faithful harness: in the app the field's `interviewType` PROP comes from
// the surface, which reads the same store the field subscribes to — so one
// store change drives both the prop and the change handler, in one turn. A
// test that moved only the prop would never exercise the deferral, and one
// that moved only the store would never close the gate.
function Host({ isEmbedded = false, value = "auto" }) {
  const { interviewType } = useInterviewType();
  return createElement(CodeLanguageField, {
    interviewType,
    isEmbedded,
    value,
    onChange: () => {},
  });
}

function mountHost(props = {}) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  mounted.push({ root, container });
  act(() => {
    root.render(createElement(Host, props));
  });
  return { container, root, rerender: (next) => act(() => root.render(createElement(Host, { ...props, ...next }))) };
}

// Mounts the field directly, for the cases that are about the gate rather than
// about a store change.
function mountField(props) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  mounted.push({ root, container });
  act(() => {
    root.render(createElement(CodeLanguageField, { value: "auto", onChange: () => {}, isEmbedded: false, ...props }));
  });
  return container;
}

const isPresent = (container) => container.textContent.includes("Code language");
const selectOf = (container) => container.querySelector(".MuiSelect-select");

// R-6 findings 3 and 4: the two always-mounted, visually-hidden `role="status"`
// regions. Read by `data-testid`, not by text content — the whole point of
// finding 4's fix is that the region exists (and can be queried) even while
// `isPresent(container)` is false.
const presenceRegionOf = (container) =>
  container.querySelector('[data-testid="code-language-presence-live-region"]');
const storageRegionOf = (container) =>
  container.querySelector('[data-testid="code-language-storage-live-region"]');

// Throws from `setItem` for the code-language key only, mirroring
// `CodeLanguagePicker.test.js`'s `blockKeys` — a blanket throw would also
// flip the interview-type store's own flag, which finding 3's fix does not
// read at all (that is the point: it fires off this control's OWN store,
// regardless of the sibling's).
function blockLanguageKey() {
  const real = Storage.prototype.setItem;
  vi.spyOn(Storage.prototype, "setItem").mockImplementation(function setItem(key, value) {
    if (key === CODE_LANGUAGE_STORAGE_KEY) throw new Error("QuotaExceededError");
    return real.call(this, key, value);
  });
}

// See `CodeLanguagePicker.test.js` for the measurement behind this: a bubbling
// `mousedown` on the combobox opens MUI's non-native menu in jsdom, and
// `HTMLElement.click()` on an option — not a dispatched click event — is what
// fires the component's `onChange`.
function chooseOption(container, index) {
  const combobox = container.querySelector('[role="combobox"]');
  expect(combobox, "no role=combobox rendered").toBeTruthy();
  act(() => {
    combobox.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true, button: 0 }));
  });
  const options = Array.from(document.querySelectorAll('[role="option"]'));
  expect(options.length).toBeGreaterThan(index);
  act(() => options[index].click());
}

function fireForeignType(newValue) {
  window.localStorage.setItem(INTERVIEW_TYPE_STORAGE_KEY, newValue);
  window.dispatchEvent(
    new StorageEvent("storage", {
      key: INTERVIEW_TYPE_STORAGE_KEY,
      newValue,
      storageArea: window.localStorage,
    }),
  );
}

// R-2: `handleBlur` now schedules its clear via `requestAnimationFrame`
// instead of committing it synchronously (see the fix's own comment in
// CodeLanguageField.js). jsdom's `requestAnimationFrame` is real (driven by
// `window._pretendToBeVisual`, on by default for vitest's jsdom
// environment), so a case that needs to observe the now-async unmount has to
// actually let one frame elapse.
function flushRaf() {
  return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}

// A second host with real focusable siblings either side of the field, for
// the one case that needs to see WHERE focus lands after the deferred
// unmount fires — `mountHost` alone has nothing else in the document for
// focus to land on.
function HostWithSiblings({ isEmbedded = false, value = "auto" }) {
  const { interviewType } = useInterviewType();
  return createElement(
    "div",
    null,
    createElement("button", { id: "before", type: "button" }, "before"),
    createElement(CodeLanguageField, { interviewType, isEmbedded, value, onChange: () => {} }),
    createElement("button", { id: "after", type: "button" }, "after"),
  );
}

function mountHostWithSiblings(props = {}) {
  const container = document.createElement("div");
  document.body.appendChild(container);
  const root = createRoot(container);
  mounted.push({ root, container });
  act(() => {
    root.render(createElement(HostWithSiblings, props));
  });
  return container;
}

beforeEach(() => {
  window.localStorage.clear();
  __resetInterviewTypeForTests();
  __resetCodeLanguageForTests();
});

afterEach(() => {
  while (mounted.length) {
    const m = mounted.pop();
    act(() => m.root.unmount());
    m.container.remove();
  }
  vi.restoreAllMocks();
  window.localStorage.clear();
  __resetInterviewTypeForTests();
  __resetCodeLanguageForTests();
});

describe("the render gate (AC-C2, AC-C2b, AC-C28d)", () => {
  it("renders for every code-bearing type on the Gemini engine", () => {
    for (const type of ["technical", "system-design"]) {
      expect(isPresent(mountField({ interviewType: type }))).toBe(true);
    }
  });

  it("is ABSENT — not disabled — for every non-code-bearing type", () => {
    // AC-C2's wording is deliberate. A greyed control invites the user to
    // wonder what it would do, and F-C2's deferral is a bounded exception in
    // TIME, not a `disabled` state.
    for (const type of ["general", "phone-screen", "behavioral", "case-study", "leadership"]) {
      const container = mountField({ interviewType: type });
      expect(isPresent(container)).toBe(false);
      expect(container.querySelector(".MuiInputBase-root")).toBeNull();
      expect(container.querySelector("[disabled]")).toBeNull();
      expect(container.querySelector('[aria-disabled="true"]')).toBeNull();
    }
  });

  it("is absent on the embedded engine, for every interview type (AC-C2b)", () => {
    // On that engine `code` is always null (D21) and `language` lives inside
    // it, so the control governs nothing — and any copy telling the user to
    // set it contradicts D21's own message that code drafting requires the
    // Gemini engine (AC-C2c).
    for (const type of ["technical", "system-design", "general", "behavioral"]) {
      const container = mountField({ interviewType: type, isEmbedded: true });
      expect(isPresent(container)).toBe(false);
      expect(container.querySelector(".MuiInputBase-root")).toBeNull();
    }
  });

  it("renders with no posting selected, and is operable there (AC-C28d)", () => {
    // Live mode's default is no posting. Gating the control on one would hide
    // it from most live users in the exact state where the override is the
    // ONLY way to get a specific language. This component takes no posting
    // prop at all, which is what makes that true by construction.
    const container = mountField({ interviewType: "technical" });
    expect(isPresent(container)).toBe(true);
    expect(selectOf(container)?.getAttribute("aria-disabled")).toBeNull();
  });

  it("FORWARDS its `value` to the picker, rather than rendering a fixed one", () => {
    // `<CodeLanguagePicker value="auto" onChange={() => {}} disabled={false} />`
    // renders, gates, defers focus and sits in the right place — and shows the
    // wrong selection for every user who ever set one. The surrounding
    // source-text assertion in `PracticeSetup.test.js` pins the props on the
    // `<CodeLanguageField>` ELEMENT, which such a field leaves untouched.
    expect(selectOf(mountField({ interviewType: "technical", value: "csharp" }))?.textContent).toBe("C#");
    expect(selectOf(mountField({ interviewType: "technical", value: "sql" }))?.textContent).toBe("SQL");
  });

  it("FORWARDS its `onChange` — every change, not just the first", () => {
    // The field is one level above the element being removed, so it is the
    // natural place for a one-shot latch to end up (the deferral flag lives
    // here too). A latch produces a control that works EXACTLY ONCE: the first
    // selection lands, every one after it is swallowed, and a single-change
    // assertion cannot tell that apart from a working control.
    const onChange = vi.fn();
    const container = mountField({ interviewType: "technical", value: "auto", onChange });
    chooseOption(container, CONTROL_OPTIONS.findIndex((o) => o.value === "go"));
    chooseOption(container, CONTROL_OPTIONS.findIndex((o) => o.value === "sql"));

    expect(onChange).toHaveBeenCalledTimes(2);
    expect(onChange.mock.calls.map(([v]) => v)).toEqual(["go", "sql"]);
  });

  it("reads the registry predicate, never a hand-rolled one (CONF-6)", () => {
    // D4 made code-bearing a property of the registry entry precisely so a new
    // format cannot be added in one place and behave inconsistently in
    // another. A local `type === "technical" || type === "system-design"`
    // reintroduces the second list D4 removed.
    const src = readSource("./CodeLanguageField.js");
    expect(src).toMatch(
      /import\s*\{[^}]*\bisCodeBearingInterviewType\b[^}]*\}\s*from\s*["']@\/lib\/copilot\/interviewTypes(?:\.js)?["']/,
    );
    expect(src).toMatch(/isCodeBearingInterviewType\s*\(/);
    expect(src).not.toMatch(/["']system-design["']/);
  });
});

describe("F-C2 — a foreign change never yanks focus to <body> (D-5, R-273 step 3)", () => {
  it("keeps the focused control mounted until it is left", () => {
    setInterviewType("technical");
    const { container } = mountHost();
    const select = selectOf(container);
    expect(select).toBeTruthy();

    act(() => select.focus());
    expect(document.activeElement).toBe(select);

    // The only channel that yields `origin === "foreign"`: a real `storage`
    // event on the interview-type key, which is what `createChoiceStore`'s own
    // listener consumes.
    act(() => fireForeignType("general"));

    // THE PROPERTY. Not "a deferral flag is set" — the flag is the mechanism
    // and is not asserted.
    expect(document.activeElement).not.toBe(document.body);
    expect(isPresent(container)).toBe(true);
  });

  it("unmounts as soon as the control is left", async () => {
    setInterviewType("technical");
    const { container } = mountHost();
    const select = selectOf(container);
    act(() => select.focus());
    act(() => fireForeignType("general"));
    expect(isPresent(container)).toBe(true);

    // R-2: the clear is no longer synchronous with the blur (see
    // CodeLanguageField.js's fix comment) — it is scheduled on a
    // `requestAnimationFrame` so a real focus transfer into the Select's own
    // portaled menu isn't mistaken for the control being left. A plain
    // `act(() => select.blur())` with no re-entry is exactly the shape the
    // R-2 audit found blind to the portal-focus defect, so this now awaits
    // the frame the real unmount is scheduled on.
    await act(async () => {
      select.blur();
      await flushRaf();
    });

    // Deferred, not dropped — the gate is re-evaluated normally once the
    // deferral clears. A control that stayed forever would be the opposite
    // defect: a live language select under a non-code-bearing type.
    expect(isPresent(container)).toBe(false);
  });

  it("unmounts IMMEDIATELY on a foreign change while unfocused — the positive control", () => {
    // Without this, an implementation that simply never unmounts passes the
    // case above.
    setInterviewType("technical");
    const { container } = mountHost();
    expect(isPresent(container)).toBe(true);
    act(() => fireForeignType("general"));
    expect(isPresent(container)).toBe(false);
  });

  it("unmounts IMMEDIATELY on a LOCAL change, even while focused", () => {
    // The deferral is scoped to a change the user did not make in this window.
    // A local change is this user, in this window, acting on this control —
    // there is nothing to protect them from.
    setInterviewType("technical");
    const { container } = mountHost();
    const select = selectOf(container);
    act(() => select.focus());
    act(() => setInterviewType("general"));
    expect(isPresent(container)).toBe(false);
  });

  it("subscribes to the INTERVIEW-TYPE store, not the language store", () => {
    // The gate closes on an interview-type change. A deferral wired to
    // `useCodeLanguageChange` can never fire, and nothing on screen says so.
    const src = readSource("./CodeLanguageField.js");
    expect(src).toMatch(/useInterviewTypeChange\s*\(/);
    expect(src).not.toMatch(/useCodeLanguageChange\s*\(/);
  });

  it("sets no state from a useEffect body (§0.10, prohibition 5)", () => {
    // `react-hooks/set-state-in-effect` resolves to ERROR at this repo's
    // zero-warnings bar. The deferral flag is set inside the change handler,
    // where `origin` is already an argument.
    const src = readSource("./CodeLanguageField.js");
    expect(src).not.toMatch(/flushSync/);
    expect(src).not.toMatch(/useLayoutEffect/);
  });
});

describe("R-2 BLOCKER — the deferral survives the Select's own focus transfer into its portaled menu", () => {
  // Opening MUI's non-native `Select` moves DOM focus off the
  // `role="combobox"` display div and into the portaled `MenuList`. The
  // resulting native `focusout` bubbles to the wrapping `<Box>` BEFORE the
  // matching `focusin` on the portaled item arrives, so a synchronous
  // `handleBlur` reads that as "focus left the field" and unmounts the
  // subtree — including the menu that was mid-open — before focus can land
  // anywhere sane. Measured (pre-fix) via ArrowDown, Space, Enter and the
  // mouse; all four are exercised here.
  //
  // THE ASSERTION IS THE OBSERVABLE PROPERTY, matching the existing F-C2
  // block above: `document.activeElement` must never become `<body>`, and
  // the control must not disappear mid-interaction — not "a ref was set" or
  // any other stand-in for the mechanism.
  const openers = [
    ["ArrowDown", () => new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true, cancelable: true })],
    ["Space", () => new KeyboardEvent("keydown", { key: " ", bubbles: true, cancelable: true })],
    ["Enter", () => new KeyboardEvent("keydown", { key: "Enter", bubbles: true, cancelable: true })],
    ["mouse", () => new MouseEvent("mousedown", { bubbles: true, cancelable: true, button: 0 })],
  ];

  it.each(openers)("with a deferral pending, opening the menu via %s does not drop focus to <body>", async (_label, makeEvent) => {
    setInterviewType("technical");
    const { container } = mountHost();
    const select = selectOf(container);
    act(() => select.focus());
    expect(document.activeElement).toBe(select);

    // The only channel that yields `origin === "foreign"` — see F-C2 above.
    act(() => fireForeignType("general"));
    expect(isPresent(container)).toBe(true);

    // The user opens the dropdown, exactly as a keyboard or mouse user would,
    // with the deferral still in effect.
    await act(async () => {
      select.dispatchEvent(makeEvent());
      await flushRaf();
    });

    expect(document.activeElement).not.toBe(document.body);
    expect(document.querySelectorAll('[role="option"]').length).toBeGreaterThan(0);
    expect(isPresent(container)).toBe(true);
  });

  it("positive control — no deferral pending: opening the menu behaves normally", async () => {
    // Without this, an implementation that simply never unmounts (e.g. one
    // that dropped the gate entirely) would pass the cases above for the
    // wrong reason.
    setInterviewType("technical");
    const { container } = mountHost();
    const select = selectOf(container);
    act(() => select.focus());

    await act(async () => {
      select.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true, cancelable: true }));
      await flushRaf();
    });

    expect(document.querySelectorAll('[role="option"]').length).toBeGreaterThan(0);
    expect(document.activeElement).not.toBe(document.body);
    expect(isPresent(container)).toBe(true);
  });

  it("a foreign change arriving while the menu is ALREADY open stays correctly deferred", async () => {
    // React's portal event bubbling reaches the Box in this direction too —
    // this is the control case the R-2 audit already found correct, and it
    // must stay correct after the fix.
    setInterviewType("technical");
    const { container } = mountHost();
    const select = selectOf(container);
    act(() => select.focus());

    await act(async () => {
      select.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true, cancelable: true }));
      await flushRaf();
    });
    expect(document.querySelectorAll('[role="option"]').length).toBeGreaterThan(0);

    act(() => fireForeignType("general"));

    expect(document.activeElement).not.toBe(document.body);
    expect(isPresent(container)).toBe(true);
  });

  it("tab-away with a deferral pending still unmounts, and focus lands on the next control", async () => {
    // The deferral's OTHER required behaviour (already covered for a bare
    // `.blur()` above): a real departure — not a focus transfer into this
    // control's own menu — must still result in the unmount, and focus must
    // land somewhere real, never on `<body>`.
    setInterviewType("technical");
    const container = mountHostWithSiblings();
    const select = selectOf(container);
    const after = container.querySelector("#after");
    act(() => select.focus());
    act(() => fireForeignType("general"));
    expect(isPresent(container)).toBe(true);

    await act(async () => {
      after.focus();
      await flushRaf();
    });

    expect(isPresent(container)).toBe(false);
    expect(document.activeElement).toBe(after);
    expect(document.activeElement).not.toBe(document.body);
  });
});

describe("R-6 finding 4 — the control's own appearance/disappearance is announced", () => {
  it("says nothing at mount, whether the control starts absent or present", () => {
    // A user who loads the page with the control already showing (or already
    // absent) did not just watch a transition happen. Announcing the starting
    // state would be exactly the "region mounts with its text already in it"
    // shape `CopilotClient.extraction.test.js:136-142` says is never
    // announced, so both starting states must read empty.
    setInterviewType("behavioral");
    const absent = mountHost();
    expect(presenceRegionOf(absent.container)).toBeTruthy();
    expect(presenceRegionOf(absent.container).textContent).toBe("");

    setInterviewType("technical");
    const present = mountHost();
    expect(isPresent(present.container)).toBe(true);
    expect(presenceRegionOf(present.container).textContent).toBe("");
  });

  it("announces appearance when a local interview-type change opens the gate", () => {
    setInterviewType("behavioral");
    const { container } = mountHost();
    expect(isPresent(container)).toBe(false);
    expect(presenceRegionOf(container).textContent).toBe("");

    act(() => setInterviewType("technical"));

    expect(isPresent(container)).toBe(true);
    expect(presenceRegionOf(container).textContent).toBe("A code language option is now available.");
  });

  it("announces disappearance when a local interview-type change closes the gate", () => {
    setInterviewType("technical");
    const { container } = mountHost();
    expect(isPresent(container)).toBe(true);

    act(() => setInterviewType("behavioral"));

    expect(isPresent(container)).toBe(false);
    // THE POINT OF FINDING 4's FIX: the control just unmounted, and the
    // region reporting that is not itself gated on `present` — if it were,
    // this assertion would find no node to read at all.
    expect(presenceRegionOf(container)).toBeTruthy();
    expect(presenceRegionOf(container).textContent).toBe("The code language option is no longer shown.");
  });

  it("announces disappearance on the deferred-unmount path too (foreign change, then leaving the control)", async () => {
    setInterviewType("technical");
    const { container } = mountHost();
    const select = selectOf(container);
    act(() => select.focus());
    act(() => fireForeignType("general"));
    // Deferred: still present, nothing announced yet — the control has not
    // actually left the screen.
    expect(isPresent(container)).toBe(true);
    expect(presenceRegionOf(container).textContent).toBe("");

    await act(async () => {
      select.blur();
      await flushRaf();
    });

    expect(isPresent(container)).toBe(false);
    expect(presenceRegionOf(container).textContent).toBe("The code language option is no longer shown.");
  });

  it("does not re-announce on every render while the presence value is unchanged", () => {
    // A latch that fired on every render rather than on a genuine transition
    // would still pass the two cases above; this is what tells them apart.
    setInterviewType("technical");
    const { container, rerender } = mountHost();
    expect(presenceRegionOf(container).textContent).toBe("");

    act(() => setInterviewType("system-design")); // still code-bearing — no transition
    expect(presenceRegionOf(container).textContent).toBe("");

    rerender({ value: "python" }); // an unrelated re-render
    expect(presenceRegionOf(container).textContent).toBe("");
  });
});

describe("R-6 finding 3 — a language-store write failure is announced, regardless of the sibling", () => {
  beforeEach(() => {
    setInterviewType("technical");
  });

  it("says nothing until a write actually fails", () => {
    const { container } = mountHost();
    expect(storageRegionOf(container)).toBeTruthy();
    expect(storageRegionOf(container).textContent).toBe("");
  });

  it("announces the exact sentence the picker itself renders, the moment the language store's own write fails", () => {
    const { container } = mountHost();
    expect(storageRegionOf(container).textContent).toBe("");

    blockLanguageKey();
    act(() => setCodeLanguage("java"));

    expect(storageRegionOf(container).textContent).toBe(STORAGE_SENTENCE);
  });

  it("fires even though the interview-type store is healthy and its own sibling never speaks", () => {
    // The positive control for finding 3a: this is the ALREADY-working case
    // (`CodeLanguagePicker.js` shows the sentence itself here), so the live
    // region firing here is not yet proof of anything by itself — it earns
    // its keep in the next case.
    const { container } = mountHost();
    blockLanguageKey();
    act(() => setCodeLanguage("go"));
    expect(storageRegionOf(container).textContent).toBe(STORAGE_SENTENCE);
  });

  it("fires even when the INTERVIEW-TYPE store is ALSO blocked — the exact state where the visible sentence is invisible on this control (finding 3a)", () => {
    // `CodeLanguagePicker.js:77-78`'s precedence means the visible helper
    // text moves to the interview-type picker's description when both stores
    // are blocked, leaving nothing on THIS control for a screen-reader user
    // who never visits the other one. The announcement does not consult
    // `typeBlocked` at all, so it is unaffected by that precedence rule.
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("QuotaExceededError");
    });

    // Genuinely flip the TYPE store's own flag too — a positive control.
    // Without an attempted write, "blocked" never becomes true on its own;
    // asserting it here is what tells this case apart from one that merely
    // forgot to exercise the sibling's store at all.
    act(() => setInterviewType("system-design")); // still code-bearing
    expect(getInterviewTypeStorageBlocked()).toBe(true);

    const { container } = mountHost();
    act(() => setCodeLanguage("sql"));

    expect(storageRegionOf(container).textContent).toBe(STORAGE_SENTENCE);
  });

  it("does not re-announce on a later, unrelated re-render once the flag is already latched", () => {
    const { container, rerender } = mountHost();
    blockLanguageKey();
    act(() => setCodeLanguage("java"));
    expect(storageRegionOf(container).textContent).toBe(STORAGE_SENTENCE);

    rerender({ value: "java" }); // unrelated re-render; the flag has not changed
    expect(storageRegionOf(container).textContent).toBe(STORAGE_SENTENCE);
  });

  it("does not re-announce on a fresh mount that starts already blocked", () => {
    // The sticky flag survives across this component's own mount/unmount
    // (it lives in the store's module-level closure, not in component
    // state). A fresh instance that starts out already blocked did not just
    // witness a write fail, so it must not repeat the sentence on mount —
    // matching the "no announcement of the starting value" rule finding 4's
    // own tests pin above.
    blockLanguageKey();
    act(() => setCodeLanguage("java"));

    const { container } = mountHost();
    expect(storageRegionOf(container).textContent).toBe("");
  });
});
