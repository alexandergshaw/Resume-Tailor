// @vitest-environment jsdom
//
// N104 Waves D/E (4b) - the Regenerate row LEAF (UX 5.1-5.4 / plan step 9). A
// props-only leaf: it draws the state `regenerateAvailability` chose and nothing
// else. RED on HEAD: app/components/preview/RegenerateRow.js does not exist.
//
// What this leaf must get right (and the mount test proves the wiring):
//   * one outlined button, truthful framing before the click (K2), aria-describedby
//     pointing at a non-empty caption, NEVER the native `disabled` attribute;
//   * it fires onRegenerate on `ready` and is INERT on every not-ready state (the
//     reason is a caption, the activation a no-op) - an over-firing leaf would spend
//     a paid run from a dimmed button;
//   * no Regenerate button at all on unsupported-scope / unsupported-job / hidden;
//   * on engine-cannot: a "Switch to Gemini" button that calls setEngine("gemini").

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createElement, act } from "react";
import { createRoot } from "react-dom/client";
import RegenerateRow from "./RegenerateRow.js";
import { REGENERATE_STATE } from "@/lib/review/regenerateAvailability";
import { readEngine, setEngine } from "@/app/settings/engine";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

// The K1-K20 row vocabulary sweep (UX N104-UX-5 / 5.3). The row may say "address"
// (K1/K5 do) but never these.
const FORBIDDEN_ROW = [/\b(fill|fix|guarantee|guaranteed|verified|safe)\b/i, /\b100%/, /\bATS\b/, /\bscore\b/i, /optimi[sz]/i];

let container;
let root;

beforeEach(() => {
  try {
    localStorage.clear();
    localStorage.setItem("tailorEngine", "embedded");
  } catch {
    /* jsdom */
  }
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.clearAllMocks();
});

async function render(props) {
  await act(async () => root.render(createElement(RegenerateRow, props)));
}

const base = {
  state: REGENERATE_STATE.READY,
  counts: { resolvable: 3, confirm: 1, unqualified: 2 },
  engineLabel: "Embedded (no AI)",
  handEdited: false,
  onRegenerate: () => {},
};

const buttons = () => [...container.querySelectorAll("button")];
const byText = (re) => buttons().find((b) => re.test((b.textContent || "").trim()));
const regenBtn = () => byText(/regenerate to address weaknesses|regenerating|regenerate again/i);

describe("RegenerateRow - ready: one truthful, enabled, never-`disabled` button", () => {
  it("renders exactly one outlined Regenerate button labelled from K1", async () => {
    await render({ ...base });
    const btn = regenBtn();
    expect(btn).toBeTruthy();
    expect((btn.textContent || "").trim()).toBe("Regenerate to address weaknesses");
    expect(btn.className).toMatch(/MuiButton-outlined/);
  });

  it("is never the native `disabled` control, and its caption is a resolvable aria-describedby target (K2)", async () => {
    await render({ ...base });
    const btn = regenBtn();
    expect(btn.disabled).toBe(false);
    expect(btn.getAttribute("disabled")).toBeNull();
    const id = btn.getAttribute("aria-describedby");
    expect(id, "the button must describe itself with the framing caption").toBeTruthy();
    const caption = container.querySelector(`#${CSS.escape(id)}`);
    expect(caption).toBeTruthy();
    expect((caption.textContent || "").trim().length).toBeGreaterThan(0);
    // The K2 promise is exactly as strong as the gate: set aside and listed, never added.
    expect(caption.textContent).toMatch(/set aside and listed, never added/i);
  });

  it("the button's accessible name is its visible text (no Tooltip stealing it)", async () => {
    await render({ ...base });
    const btn = regenBtn();
    expect(btn.getAttribute("aria-label")).toBeNull();
    expect((btn.textContent || "").trim().length).toBeGreaterThan(0);
  });

  it("one click fires onRegenerate exactly once (positive control)", async () => {
    const onRegenerate = vi.fn();
    await render({ ...base, onRegenerate });
    await act(async () => regenBtn().click());
    expect(onRegenerate).toHaveBeenCalledTimes(1);
  });
});

describe("RegenerateRow - not-ready states are inert (the reason is a caption, not a run)", () => {
  for (const state of [
    REGENERATE_STATE.NOTHING_TO_ADDRESS,
    REGENERATE_STATE.NEEDS_MATERIAL,
    REGENERATE_STATE.STALE,
    REGENERATE_STATE.RUNNING,
  ]) {
    it(`${state}: the control is aria-disabled and a click does NOT fire onRegenerate`, async () => {
      const onRegenerate = vi.fn();
      await render({ ...base, state, onRegenerate });
      const btn = regenBtn();
      expect(btn, `${state} still shows the control (dimmed), never the native disabled attr`).toBeTruthy();
      expect(btn.getAttribute("disabled")).toBeNull();
      expect(btn.getAttribute("aria-disabled")).toBe("true");
      await act(async () => btn.click());
      expect(onRegenerate).not.toHaveBeenCalled();
    });
  }

  it("running reads 'Regenerating...' with aria-busy", async () => {
    await render({ ...base, state: REGENERATE_STATE.RUNNING });
    const btn = regenBtn();
    expect((btn.textContent || "").trim()).toBe("Regenerating...");
    expect(btn.getAttribute("aria-busy")).toBe("true");
  });
});

describe("RegenerateRow - scope and hidden: no Regenerate button at all", () => {
  it("unsupported-job shows the K8 sentence and no Regenerate button", async () => {
    await render({ ...base, state: REGENERATE_STATE.UNSUPPORTED_JOB });
    expect(regenBtn()).toBeFalsy();
    expect(container.textContent).toMatch(/available for results built at the Ideal level/i);
  });

  it("unsupported-scope shows the K9 sentence and no Regenerate button", async () => {
    await render({ ...base, state: REGENERATE_STATE.UNSUPPORTED_SCOPE });
    expect(regenBtn()).toBeFalsy();
    expect(container.textContent).toMatch(/available for the resume only/i);
  });

  it("hidden renders nothing (no button, no text)", async () => {
    await render({ ...base, state: REGENERATE_STATE.HIDDEN });
    expect(regenBtn()).toBeFalsy();
    expect((container.textContent || "").trim()).toBe("");
  });
});

describe("RegenerateRow - engine-cannot: the in-modal Switch to Gemini (AC-5)", () => {
  it("names the current engine label, dims Regenerate, and Switch to Gemini sets the engine", async () => {
    await render({ ...base, state: REGENERATE_STATE.ENGINE_CANNOT });
    expect(container.textContent).toMatch(/needs the Gemini AI engine/i);
    expect(container.textContent).toMatch(/Embedded \(no AI\)/); // the ENGINE_OPTIONS label
    expect(regenBtn().getAttribute("aria-disabled")).toBe("true");
    const switchBtn = byText(/switch to gemini/i);
    expect(switchBtn, "an in-modal Switch to Gemini must be offered under a modal dialog").toBeTruthy();
    expect(readEngine()).toBe("embedded");
    await act(async () => switchBtn.click());
    expect(readEngine()).toBe("gemini");
  });

  afterEach(() => {
    try {
      setEngine("embedded");
    } catch {
      /* jsdom */
    }
  });
});

describe("RegenerateRow - the vocabulary sweep (UX N104-UX-5), with a canary", () => {
  it("no rendered chrome in any state matches a forbidden row pattern", async () => {
    for (const state of Object.values(REGENERATE_STATE)) {
      await render({ ...base, state, handEdited: true });
      const text = container.textContent || "";
      for (const re of FORBIDDEN_ROW) expect(re.test(text), `${state} chrome must not match ${re}`).toBe(false);
    }
  });

  it("CANARY: the sweep catches a planted 'guaranteed' / 'ATS'", async () => {
    expect(FORBIDDEN_ROW.some((re) => re.test("guaranteed to fix your ATS score"))).toBe(true);
  });
});
