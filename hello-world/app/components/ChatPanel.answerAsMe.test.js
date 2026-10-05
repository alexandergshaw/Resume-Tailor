// @vitest-environment jsdom
//
// N102 AC-1 / AC-2 / AC-9 (UX) -- the "answer as me" toggle in the Ask-AI chat.
//
// createRoot + act idiom (no @testing-library/react in this repo), same as
// ChatPanel.clear.test.js. The switch state is NOT a prop: ChatPanel reads the
// preference from the store (useAnswerAsMe) and the engine from useEngine, both
// localStorage-backed. So these tests drive the REAL production path -- they
// seed localStorage (the same keys the real controls write) and mount the real
// component, then click the real control. A direct setter call would not prove
// reachability (standing rule 2); clicking the rendered switch and watching the
// store persist does.
//
// RED-ON-HEAD: no such control exists (grep: 0 hits). `answerAsMeSwitch()`
// returns undefined, so every case reds on its first `expect(sw).toBeTruthy()`.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createElement, act } from "react";
import { createRoot } from "react-dom/client";
import ChatPanel from "./ChatPanel.js";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const ENGINE_KEY = "tailorEngine";
const ANSWER_AS_ME_KEY = "chatAnswerAsMe";

let container;
let root;

beforeEach(() => {
  if (typeof window.matchMedia !== "function") {
    window.matchMedia = vi.fn(() => ({
      matches: false,
      media: "",
      onchange: null,
      addListener() {},
      removeListener() {},
      addEventListener() {},
      removeEventListener() {},
      dispatchEvent() {
        return false;
      },
    }));
  }
  // Each test owns the store state. jsdom's localStorage is real and persists
  // across tests in a file, so clear it first.
  try {
    window.localStorage.clear();
  } catch {
    /* ignore */
  }
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => {
    root.unmount();
  });
  container.remove();
  try {
    window.localStorage.clear();
  } catch {
    /* ignore */
  }
  vi.restoreAllMocks();
});

function baseProps(overrides = {}) {
  return {
    chatPanelRef: { current: null },
    chatScrollRef: { current: null },
    chatInputRef: { current: null },
    chatDragActive: false,
    setChatDragActive: vi.fn(),
    addChatAttachments: vi.fn(),
    fabPos: { bottom: 24, right: 24 },
    chatSize: { width: 380, height: 520 },
    startChatResize: vi.fn(),
    chatMessages: [],
    setChatMessages: vi.fn(),
    chatError: "",
    setChatError: vi.fn(),
    chatPinnedContext: null,
    setChatPinnedContext: vi.fn(),
    chatSending: false,
    chatCopiedIndex: null,
    setChatCopiedIndex: vi.fn(),
    resendUserMessage: vi.fn(),
    chatAttachedFiles: [],
    setChatAttachedFiles: vi.fn(),
    chatAttachError: "",
    chatInput: "",
    setChatInput: vi.fn(),
    sendChatMessage: vi.fn(),
    ...overrides,
  };
}

async function render(props = baseProps()) {
  await act(async () => {
    root.render(createElement(ChatPanel, props));
  });
}

// Accessible-name resolution without @testing-library: handle aria-label,
// aria-labelledby (id -> text), a label[for=id], and a wrapping <label>
// (MUI FormControlLabel). Covers both name-wiring options the design allows.
function accessibleName(el) {
  const aria = el.getAttribute("aria-label");
  if (aria && aria.trim()) return aria.trim();
  const labelledby = el.getAttribute("aria-labelledby");
  if (labelledby) {
    return labelledby
      .split(/\s+/)
      .map((id) => document.getElementById(id)?.textContent || "")
      .join(" ")
      .trim();
  }
  const id = el.getAttribute("id");
  if (id) {
    const forLabel = document.querySelector(`label[for="${CSS.escape(id)}"]`);
    if (forLabel) return (forLabel.textContent || "").trim();
  }
  const wrapping = el.closest("label");
  if (wrapping) return (wrapping.textContent || "").trim();
  return "";
}

function answerAsMeSwitch() {
  return [...container.querySelectorAll('[role="switch"]')].find((el) =>
    /answer as me/i.test(accessibleName(el)),
  );
}

describe("AC-1: the toggle exists, is reachable, keyboard-operable, one action", () => {
  it("renders a role=switch named 'Answer as me' in the panel", async () => {
    await render();
    const sw = answerAsMeSwitch();
    expect(sw, "no role=switch with an accessible name matching /answer as me/i was found").toBeTruthy();
    expect(accessibleName(sw)).toMatch(/answer as me/i);
  });

  it("the control is a native, focusable checkbox input (so Space/Enter toggle it natively)", async () => {
    // jsdom does not execute a checkbox's Space/Enter DEFAULT ACTION, so
    // keyboard operability is proven by TYPE rather than by simulating a
    // keypress: a native <input type=checkbox> is keyboard-operable by
    // construction, and is not disabled on the AI engine. DISCLOSED jsdom
    // limit (standing rule 15): the Space default action itself is not executed
    // here.
    await render();
    const sw = answerAsMeSwitch();
    expect(sw).toBeTruthy();
    expect(sw.tagName).toBe("INPUT");
    expect(sw.getAttribute("type")).toBe("checkbox");
    expect(sw.disabled).toBe(false);
  });

  it("defaults OFF when the store is empty (safe default)", async () => {
    await render();
    const sw = answerAsMeSwitch();
    expect(sw).toBeTruthy();
    expect(sw.checked).toBe(false);
  });

  it("REACHABILITY: one click flips it ON and persists to the store", async () => {
    // The real user action end-to-end: click the rendered switch, watch the
    // real store persist. No prop, no direct setter -- this is what a direct
    // handler call cannot prove.
    await render();
    const sw = answerAsMeSwitch();
    expect(sw).toBeTruthy();
    expect(sw.checked).toBe(false);

    await act(async () => {
      sw.click();
    });

    const after = answerAsMeSwitch();
    expect(after.checked).toBe(true);
    expect(window.localStorage.getItem(ANSWER_AS_ME_KEY)).toBe("true");
  });

  it("REVERSIBLE: a second click flips it back OFF", async () => {
    window.localStorage.setItem(ANSWER_AS_ME_KEY, "true");
    await render();
    const sw = answerAsMeSwitch();
    expect(sw).toBeTruthy();
    expect(sw.checked).toBe(true);

    await act(async () => {
      sw.click();
    });

    expect(answerAsMeSwitch().checked).toBe(false);
    expect(window.localStorage.getItem(ANSWER_AS_ME_KEY)).toBe("false");
  });
});

describe("AC-2: the ON state is clearly and programmatically indicated", () => {
  it("ON: the switch exposes checked=true and a visible checked treatment", async () => {
    window.localStorage.setItem(ANSWER_AS_ME_KEY, "true");
    await render();
    const sw = answerAsMeSwitch();
    expect(sw).toBeTruthy();
    // Programmatic: the checked property is what AT reads for a role=switch
    // native checkbox.
    expect(sw.checked).toBe(true);
    // Visible: MUI marks the checked switch with the .Mui-checked class.
    expect(container.querySelector(".Mui-checked")).toBeTruthy();
  });

  it("OFF: no checked state and no checked treatment (the indicator is absent)", async () => {
    await render();
    const sw = answerAsMeSwitch();
    expect(sw).toBeTruthy();
    expect(sw.checked).toBe(false);
    expect(container.querySelector(".Mui-checked")).toBeNull();
  });
});

describe("AC-9: embedded engine degrades honestly", () => {
  it("disabled and ON-accent suppressed even when the stored value is true", async () => {
    // The dangerous case: a stale ON value from a prior Gemini session must not
    // read as "drafting as you" while on the offline engine. The
    // embedded-shows-on mutant (checked={answerAsMe} instead of
    // checked={answerAsMe && !isEmbedded}) reds the two assertions below.
    window.localStorage.setItem(ENGINE_KEY, "embedded");
    window.localStorage.setItem(ANSWER_AS_ME_KEY, "true");
    await render();

    const sw = answerAsMeSwitch();
    expect(sw, "the switch must still render (disabled), not vanish, so its state is honest").toBeTruthy();
    expect(sw.disabled).toBe(true);
    expect(sw.checked).toBe(false); // accent suppressed despite stored true
    expect(container.querySelector(".Mui-checked")).toBeNull();
  });

  it("shows a note that the feature applies to the AI engine", async () => {
    window.localStorage.setItem(ENGINE_KEY, "embedded");
    await render();
    // Scoped to the feature: "answer as me" appears nowhere at HEAD, and this
    // note ties it to the AI engine -- distinct from the pre-existing embedded
    // tooltip/chip, which never mention "answer as me".
    const text = container.textContent || "";
    expect(text).toMatch(/answer as me/i);
    expect(text).toMatch(/applies to the AI engine|only (?:works|available)[^.]{0,40}AI|unavailable[^.]{0,40}(?:offline|embedded)/i);
  });

  it("CONTROL: on the AI engine the same stored ON value shows the switch checked", async () => {
    // Proves the embedded suppression above is engine-specific, not a switch
    // that is simply always off.
    window.localStorage.setItem(ENGINE_KEY, "gemini");
    window.localStorage.setItem(ANSWER_AS_ME_KEY, "true");
    await render();
    const sw = answerAsMeSwitch();
    expect(sw).toBeTruthy();
    expect(sw.disabled).toBe(false);
    expect(sw.checked).toBe(true);
  });
});
