// @vitest-environment jsdom
//
// N29's Generate/Regenerate control INSIDE PrepPackPanel.js (design-experience.r1.md
// §1: Option B, the AC's own four deciding facts). Separate file from
// PrepPackPanel.test.js (334 lines today, plenty of headroom under this
// repo's 1000-line cap) so the two chunks' scopes stay legible: that file
// owns AC-N33's read-surface behaviour, this one owns N29's new
// props/control, none of which existed when that file was written.
//
// Four new props this round adds to the component's destructured signature
// -- `generating`, `triggerMessage`, `onGenerateNow`, `hasDescription` --
// and per this repo's own standing risk (the N39/DS-N29.6 shape: a prop
// accepted-but-never-referenced in the render), EVERY ONE of the four gets
// its own render assertion below with a DISTINCTIVE value producing
// DISTINCTIVE, asserted output -- never merely "the component still
// renders something".
//
// RED ON HEAD: PrepPackPanel's exported signature (:297-305) destructures
// none of these four props, and its meta-actions row (:313-317) renders
// only "Download prep log" -- every case below fails because there is
// nothing to find, not because of a fixture defect.
//
// ASSUMPTION, FLAGGED (plan.r1.md's own function table names `prepActionState`
// as "app/components/tracking/PrepPackPanel.js (new, pure)" without stating
// whether it is exported): the direct unit-test describe block below
// assumes it IS exported, mirroring this repo's own convention of exporting
// a pure helper alongside a component's default export specifically so it
// is directly testable (e.g. this same file's sibling `messageFor` in
// AppViewDialog.js). If the implementer keeps it module-private, that one
// describe block fails at import resolution while every render-level
// assertion in the other describe blocks below still exercises the same
// precedence rules through the public component API and remains valid.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createElement, act } from "react";
import { createRoot } from "react-dom/client";
import { prepActionState } from "./PrepPackPanel.js";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const SPECIFIER = "./PrepPackPanel.js";
let modPromise;
function load() {
  if (!modPromise) modPromise = import(SPECIFIER);
  return modPromise;
}

let container;
let root;

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
});

async function render(props) {
  const mod = await load();
  const PrepPackPanel = mod.default;
  await act(async () => {
    root.render(createElement(PrepPackPanel, props));
  });
  return container;
}

const READY_PACK = {
  version: 1,
  sections: {
    aboutYou: { answer: { lines: [{ text: "I led three cross-functional launches." }] } },
    whyRole: { answer: { lines: [{ text: "This role matches my background." }] } },
    askThem: { questions: [{ text: "How is this team's work measured?" }] },
    stages: { stages: [{ name: "Overview", questions: ["Tell me about yourself."], recommendedAnswer: null, support: null }] },
  },
  claims: [],
};

function baseProps(overrides = {}) {
  return {
    applicationId: "app-1",
    pack: null,
    status: null,
    completeSections: [],
    attemptsExhausted: false,
    candidateName: null,
    interviewerNames: [],
    error: null,
    onDownloadLog: vi.fn(),
    generating: false,
    triggerMessage: null,
    onGenerateNow: vi.fn(),
    hasDescription: true,
    ...overrides,
  };
}

function findButton(el, pattern) {
  return [...el.querySelectorAll("button")].find((b) => pattern.test((b.textContent || "").trim()));
}

describe("prepActionState -- DX §4.1's precedence, running/generating first, then no-description, else idle (unit, assumed exported)", () => {
  it("idle: a pack exists, no generation running, description present", () => {
    expect(prepActionState({ status: "ready", pack: READY_PACK, generating: false, hasDescription: true })).toBe("idle");
  });

  it("in-flight wins when status is 'running', regardless of hasDescription", () => {
    expect(prepActionState({ status: "running", pack: null, generating: false, hasDescription: false })).toBe("in-flight");
  });

  it("in-flight wins when a same-tab generation is in flight, regardless of status", () => {
    expect(prepActionState({ status: "failed", pack: null, generating: true, hasDescription: true })).toBe("in-flight");
  });

  it("[the override case] no-description wins over an idle-looking hasPack+failed combination when NOT in flight", () => {
    expect(prepActionState({ status: "failed", pack: READY_PACK, generating: false, hasDescription: false })).toBe("no-description");
  });

  it("[proves precedence is CHECKED IN ORDER, not independently] in-flight beats a simultaneous no-description condition", () => {
    expect(prepActionState({ status: "running", pack: null, generating: false, hasDescription: false })).toBe("in-flight");
  });
});

describe("the Generate/Regenerate control -- each of the four new props is exercised, distinctly", () => {
  it("[hasDescription=true, hasPack=false] renders a button labelled 'Prepare me for this interview'", async () => {
    const el = await render(baseProps({ pack: null, status: null, hasDescription: true }));
    expect(findButton(el, /prepare me for this interview/i)).toBeTruthy();
  });

  it("[hasPack=true] the SAME control is labelled 'Regenerate', never 'Prepare me...'", async () => {
    const el = await render(
      baseProps({ pack: READY_PACK, status: "ready", completeSections: ["aboutYou"], hasDescription: true }),
    );
    expect(findButton(el, /^regenerate$/i)).toBeTruthy();
    expect(findButton(el, /prepare me for this interview/i)).toBeUndefined();
  });

  it("[hasPack=true] a disclosure caption warns the regenerate is destructive", async () => {
    const el = await render(
      baseProps({ pack: READY_PACK, status: "ready", completeSections: ["aboutYou"], hasDescription: true }),
    );
    expect(el.textContent.toLowerCase()).toMatch(/replaces the pack above|can't be undone/);
  });

  it("[hasPack=false] the destructive-overwrite caption never renders -- there is nothing to lose", async () => {
    const el = await render(baseProps({ pack: null, status: null, hasDescription: true }));
    expect(el.textContent.toLowerCase()).not.toMatch(/can't be undone/);
  });

  it("[generating=true] no button is rendered AT ALL for this control -- replaced by non-interactive text, never a disabled Button (the a11y rule DX §8 states)", async () => {
    const el = await render(baseProps({ generating: true, pack: null, status: null, hasDescription: true }));
    expect(findButton(el, /prepare me for this interview/i)).toBeUndefined();
    expect(findButton(el, /^regenerate$/i)).toBeUndefined();
    expect(el.textContent.toLowerCase()).toMatch(/generat/);
    // Never a disabled control standing in for the missing button.
    const anyDisabled = [...el.querySelectorAll("button[disabled]")];
    expect(anyDisabled.filter((b) => /prepare|regenerate/i.test(b.textContent || ""))).toHaveLength(0);
  });

  it("[hasDescription=false] no button is rendered, and the copy points at the real Edit affordance", async () => {
    const el = await render(baseProps({ hasDescription: false, pack: null, status: null }));
    expect(findButton(el, /prepare me for this interview/i)).toBeUndefined();
    expect(el.textContent.toLowerCase()).toMatch(/no job description|edit/);
  });

  it("[triggerMessage] a non-null message renders in a role=alert region", async () => {
    const el = await render(baseProps({ triggerMessage: "Something went wrong starting this attempt. Try again." }));
    const alertRegion = el.querySelector('[role="alert"]');
    expect(alertRegion, "no role=alert region found").toBeTruthy();
    expect(alertRegion.textContent).toContain("Something went wrong starting this attempt.");
  });

  it("[triggerMessage=null] no alert region renders", async () => {
    const el = await render(baseProps({ triggerMessage: null }));
    expect(el.querySelector('[role="alert"]')).toBeNull();
  });

  it("[onGenerateNow] clicking the button invokes the callback exactly once, with no arguments the caller did not supply", async () => {
    const onGenerateNow = vi.fn();
    const el = await render(baseProps({ pack: null, status: null, hasDescription: true, onGenerateNow }));
    const button = findButton(el, /prepare me for this interview/i);
    expect(button).toBeTruthy();
    act(() => button.dispatchEvent(new window.MouseEvent("click", { bubbles: true })));
    expect(onGenerateNow).toHaveBeenCalledTimes(1);
  });
});
