// @vitest-environment jsdom
//
// N155 — the shared, presentational, store-agnostic RegenerateControl
// (app/copilot/RegenerateControl.js): a zero-typing Regenerate button plus an
// OPTIONAL single-line context field behind a local, non-persistent "Add context"
// disclosure (AC9 structure/behaviour, AC11 mobile tokens, AC13 no persistence).
//
// RED on HEAD: the module does not exist yet, so the import fails at collection and
// every case reds (the repo's "Type B red" convention — see ProjectBulletDetail.test.js).
// Once the component lands these become ordinary behavioural + source assertions.
//
// Prop contract (plan Step 3): RegenerateControl({ name, disabled, maxChars, onRegenerate }).
// AC10 (absent on loading/disabled from the HOST side) and AC12 (geometry) are proven
// in the host UI suites and the owner pane, not here; this file pins the control's own
// contract, including its belt-and-braces `disabled -> null` hard guard.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createElement, act } from "react";
import { createRoot } from "react-dom/client";
import { readFileSync } from "node:fs";
import path from "node:path";

import RegenerateControl from "./RegenerateControl.js";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const SRC = (() => {
  try {
    return readFileSync(path.join(process.cwd(), "app/copilot/RegenerateControl.js"), "utf8");
  } catch {
    return "";
  }
})();

let container;
let root;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.restoreAllMocks();
});

async function render(props) {
  await act(async () => root.render(createElement(RegenerateControl, { name: "the ledger rebuild", maxChars: 600, onRegenerate: () => {}, ...props })));
}

const byText = (needle) => [...container.querySelectorAll("button")].find((b) => (b.textContent || "").includes(needle));
const regenerateBtn = () => [...container.querySelectorAll("button")].find((b) => /^regenerate/i.test((b.getAttribute("aria-label") || b.textContent || "").trim()));
const addContextBtn = () => byText("Add context") || byText("Hide context");
const field = () => container.querySelector("input, textarea");

describe("AC9 — the Regenerate button works with zero typing", () => {
  it("renders a Regenerate button whose accessible name begins with the visible word", async () => {
    await render({});
    const btn = regenerateBtn();
    expect(btn, "a Regenerate button renders").toBeTruthy();
    expect((btn.getAttribute("aria-label") || "").startsWith("Regenerate")).toBe(true);
  });

  it("calls onRegenerate('') when clicked with no typing", async () => {
    const onRegenerate = vi.fn();
    await render({ onRegenerate });
    await act(async () => regenerateBtn().dispatchEvent(new MouseEvent("click", { bubbles: true })));
    expect(onRegenerate).toHaveBeenCalledTimes(1);
    expect(onRegenerate).toHaveBeenCalledWith("");
  });

  it("marks every top-level node with data-regenerate (the AC16 exclusion marker)", async () => {
    await render({});
    const roots = [...container.children];
    expect(roots.length).toBeGreaterThan(0);
    for (const node of roots) {
      expect(node.hasAttribute("data-regenerate"), `${node.tagName} carries data-regenerate`).toBe(true);
    }
  });
});

describe("AC9 — the context field is behind a local disclosure", () => {
  it("hides the field until Add context is activated", async () => {
    await render({});
    expect(field()).toBeNull();
    const toggle = addContextBtn();
    expect(toggle, "an Add context disclosure renders").toBeTruthy();
    expect(toggle.getAttribute("aria-expanded")).toBe("false");
    // aria-controls is a dangling IDREF unless the field exists — absent while closed.
    expect(toggle.getAttribute("aria-controls")).toBeFalsy();
  });

  it("reveals a labelled field and flips aria-expanded/aria-controls when opened", async () => {
    await render({});
    await act(async () => addContextBtn().dispatchEvent(new MouseEvent("click", { bubbles: true })));
    const toggle = addContextBtn();
    expect(toggle.getAttribute("aria-expanded")).toBe("true");
    const input = field();
    expect(input, "the context field is shown").toBeTruthy();
    const controls = toggle.getAttribute("aria-controls");
    expect(controls).toBeTruthy();
    expect(container.querySelector(`#${CSS.escape(controls)}`)).not.toBeNull();
    // The field has an associated visible label.
    const labelled = input.getAttribute("aria-label") || (input.id && container.querySelector(`label[for="${CSS.escape(input.id)}"]`));
    expect(labelled).toBeTruthy();
  });

  it("passes the typed field text to onRegenerate", async () => {
    const onRegenerate = vi.fn();
    await render({ onRegenerate });
    await act(async () => addContextBtn().dispatchEvent(new MouseEvent("click", { bubbles: true })));
    const input = field();
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set
      || Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value")?.set;
    await act(async () => {
      setter.call(input, "focus on the reconciliation");
      input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => regenerateBtn().dispatchEvent(new MouseEvent("click", { bubbles: true })));
    expect(onRegenerate).toHaveBeenLastCalledWith("focus on the reconciliation");
  });

  it("bounds the field at maxChars (the host passes its MAX_USER_CONTEXT_CHARS)", async () => {
    await render({ maxChars: 600 });
    await act(async () => addContextBtn().dispatchEvent(new MouseEvent("click", { bubbles: true })));
    expect(field().getAttribute("maxlength")).toBe("600");
  });
});

describe("AC10 — the control hard-guards the disabled state (belt-and-braces)", () => {
  it("renders nothing when disabled is true", async () => {
    await render({ disabled: true });
    expect(container.innerHTML).toBe("");
  });
});

describe("AC11 / AC13 — mobile tokens and no persistence (source)", () => {
  it("imports its touch tokens from the theme module, never the copilot shim", () => {
    expect(SRC).toContain('from "@/app/theme/mobileSx"');
    expect(SRC).not.toContain('from "@/app/copilot/mobileSx"');
    expect(SRC).not.toContain('from "./mobileSx"');
  });

  it("applies the shared touch tokens to the buttons and the field", () => {
    expect(SRC).toContain("TOUCH_TARGET_SX");
    expect(SRC).toContain("TOUCH_FIELD_SX");
  });

  it("persists the typed context nowhere", () => {
    expect(SRC).not.toMatch(/localStorage|sessionStorage|indexedDB|document\.cookie/);
  });

  it("[control] the persistence sweep can actually fail", () => {
    expect('localStorage.setItem("x","1")').toMatch(/localStorage/);
  });
});

describe("AC13 — the context does not survive unmount", () => {
  it("re-mounting shows an empty field (it lived only in local state)", async () => {
    await render({});
    await act(async () => addContextBtn().dispatchEvent(new MouseEvent("click", { bubbles: true })));
    const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value")?.set;
    await act(async () => {
      setter.call(field(), "transient note");
      field().dispatchEvent(new Event("input", { bubbles: true }));
    });
    await act(async () => root.unmount());
    root = createRoot(container);
    await render({});
    // A fresh mount starts collapsed with no field; opening shows an empty one.
    expect(field()).toBeNull();
    await act(async () => addContextBtn().dispatchEvent(new MouseEvent("click", { bubbles: true })));
    expect(field().value).toBe("");
  });
});
