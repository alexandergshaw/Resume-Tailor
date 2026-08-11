// @vitest-environment jsdom
//
// A per-file jsdom override (vitest.config.js stays `environment: "node"`);
// app/components/JobDescriptionTab.test.js is the precedent for rendering a
// real component here.
//
// This file exists because the acceptance criteria for the manual-question
// box ARE the markup: whether Enter submits, whether the button is reachable
// and named, whether a blank entry can be submitted at all, whether the
// field keeps or loses what was typed when the caller refuses it, and
// whether anything is announced to a screen reader. None of that can be
// extracted into a pure function — normalizeManualQuestion (its own tests)
// already holds the only part that can.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createElement, act } from "react";
import { createRoot } from "react-dom/client";
import ManualQuestion from "./ManualQuestion.js";
import { MAX_MANUAL_QUESTION_CHARS } from "@/lib/copilot/manualQuestion";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let container;
let root;

function baseProps(overrides) {
  return {
    label: "Type a question",
    // Returning true is the "accepted" signal — see the field-clearing cases
    // below for why the caller's return value is load-bearing.
    onSubmit: vi.fn(() => true),
    ...overrides,
  };
}

async function render(props) {
  await act(async () => {
    root.render(createElement(ManualQuestion, props));
  });
}

// Deliberately tolerant of `input` OR `textarea`: this control is
// single-line today (Enter has to submit, which a textarea would swallow),
// but the query should not be what forbids a change of mind.
function input() {
  const el = container.querySelector("input, textarea:not([aria-hidden='true'])");
  expect(el, "the box must render an editable field").toBeTruthy();
  return el;
}

// The submit control specifically, by type — NOT "the button that has text",
// which was circular with the accessible-name assertion below and threw a
// TypeError instead of failing readably when no such button existed.
function submitButton() {
  const el = container.querySelector("button[type='submit']");
  expect(el, "the box must render a submit button").toBeTruthy();
  return el;
}

// The accessible name a screen reader would announce: aria-label if present,
// otherwise the <label> associated by `for`. Same helper JobDescriptionTab's
// own test uses, for the same reason.
function accessibleName(el) {
  const aria = el.getAttribute("aria-label");
  if (aria) return aria;
  if (el.id) {
    const label = container.querySelector(`label[for="${CSS.escape(el.id)}"]`);
    if (label) return label.textContent.trim();
  }
  return (el.textContent || "").trim();
}

async function type(el, value) {
  const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, "value").set;
  await act(async () => {
    setter.call(el, value);
    el.dispatchEvent(new window.Event("input", { bubbles: true }));
  });
}

async function click(el) {
  await act(async () => {
    el.dispatchEvent(new window.MouseEvent("click", { bubbles: true, cancelable: true }));
  });
}

// Pressing Enter inside a text input submits its form natively. jsdom does
// not synthesize that from a keydown, so the test submits the form directly —
// which is exactly the point of the assertion: there must BE a form, and its
// submit handler must be the same path the button uses.
//
// Returns whether the handler called preventDefault. jsdom does not navigate
// on a form submit, so without checking this a component that forgot
// preventDefault passes here and reloads the whole page mid-interview in a
// real browser.
async function submitForm() {
  const form = container.querySelector("form");
  expect(form, "the box must be a <form> so Enter submits it").toBeTruthy();
  const evt = new window.Event("submit", { bubbles: true, cancelable: true });
  await act(async () => {
    form.dispatchEvent(evt);
  });
  return evt.defaultPrevented;
}

beforeEach(() => {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(() => {
  act(() => root.unmount());
  container.remove();
  vi.clearAllMocks();
});

describe("ManualQuestion", () => {
  it("labels the field and the submit control", async () => {
    await render(baseProps({ buttonLabel: "Add" }));
    expect(accessibleName(input())).toBe("Type a question");
    // Asserted against the string actually passed in, not just
    // "length > 0" — the button is now found by `type="submit"`, so a
    // length check would have been satisfied by any stray text, and when
    // the finder selected FOR non-empty text it was true by construction.
    expect(accessibleName(submitButton())).toBe("Add");
  });

  it("is a form, so Enter submits without reaching for the button", async () => {
    const props = baseProps();
    await render(props);
    await type(input(), "Why do you want this role?");
    const prevented = await submitForm();
    expect(props.onSubmit).toHaveBeenCalledTimes(1);
    // Without this the page navigates on Enter in a real browser — jsdom
    // never would, so nothing else here could catch it.
    expect(prevented).toBe(true);
  });

  it("submits the NORMALIZED question, not the raw field value", async () => {
    // The two hooks that receive this both normalize again defensively, but
    // the string handed over is what ends up on the card and in the model
    // request, so it has to be clean at this boundary too.
    const props = baseProps();
    await render(props);
    await type(input(), "  What is\n  your greatest   weakness? ");
    await click(submitButton());
    expect(props.onSubmit).toHaveBeenCalledWith("What is your greatest weakness?");
  });

  it("cannot be submitted while the field is blank or whitespace-only", async () => {
    const props = baseProps();
    await render(props);
    expect(submitButton().disabled).toBe(true);

    await type(input(), "    ");
    expect(submitButton().disabled).toBe(true);
    // Enter must be refused too — a disabled button does not stop a form
    // submit, and this is the path a keyboard user actually takes.
    await submitForm();
    expect(props.onSubmit).not.toHaveBeenCalled();

    await type(input(), "Why this company?");
    expect(submitButton().disabled).toBe(false);
  });

  it("cannot be submitted with punctuation alone", async () => {
    const props = baseProps();
    await render(props);
    await type(input(), "???");
    expect(submitButton().disabled).toBe(true);
    await submitForm();
    expect(props.onSubmit).not.toHaveBeenCalled();
  });

  it("clears the field after the caller accepts, ready for the next one", async () => {
    const props = baseProps();
    await render(props);
    await type(input(), "Tell me about yourself.");
    await click(submitButton());
    expect(input().value).toBe("");
  });

  it("returns focus to the field after a successful submit", async () => {
    // Mid-interview this box is used repeatedly. Losing focus after each add
    // means tabbing back to it every time — the same WCAG 2.4.3 failure
    // CopilotDashboard's reveal button already had to fix.
    //
    // The button is focused FIRST, deliberately. jsdom does not move focus on
    // a synthetic MouseEvent, so an earlier version of this test — which
    // focused the input, clicked, and asserted focus was still there — passed
    // even with the component's focus() call deleted, and modelled the
    // opposite of what a browser does (where pressing the button focuses it).
    // Starting from the button is the real post-click state, so the
    // assertion now only holds if the component actively moves focus back.
    const props = baseProps();
    await render(props);
    await type(input(), "What is your greatest strength?");
    await act(async () => {
      submitButton().focus();
    });
    expect(document.activeElement).toBe(submitButton());
    await click(submitButton());
    expect(document.activeElement).toBe(input());
  });

  it("keeps what was typed when the caller refuses it", async () => {
    // A refusal means the question did NOT land anywhere. Clearing the field
    // regardless would destroy the user's text and leave no trace of it on
    // screen either.
    const props = baseProps({ onSubmit: vi.fn(() => false) });
    await render(props);
    await type(input(), "Describe a failure.");
    await click(submitButton());
    expect(input().value).toBe("Describe a failure.");
  });

  it("announces the question that was added, and announces nothing before that", async () => {
    const props = baseProps();
    await render(props);
    const region = container.querySelector("[role='status']");
    expect(region, "a status region must be mounted from the first render").toBeTruthy();
    // Mounted EMPTY on purpose: a live region that mounts already carrying
    // its final text is not announced (lib/copilot/answerStatus.js documents
    // this for the whole app) — only a later text change is.
    expect(region.textContent.trim()).toBe("");

    await type(input(), "Why are you leaving your current job?");
    await click(submitButton());
    expect(region.textContent).toContain("Why are you leaving your current job?");
  });

  it("says nothing was added when the caller refuses", async () => {
    const props = baseProps({ onSubmit: vi.fn(() => false) });
    await render(props);
    await type(input(), "Describe a failure.");
    await click(submitButton());
    expect(container.querySelector("[role='status']").textContent.trim()).toBe("");
  });

  it("words the confirmation from `confirmLabel`, so each mode states what it actually did", async () => {
    // Practice mode does two things with one submit (sets the drill question
    // AND adds it to the feed); live mode does one. A single hard-coded
    // sentence would be false in one of them.
    const props = baseProps({ confirmLabel: "Set as your practice question" });
    await render(props);
    await type(input(), "Walk me through your resume.");
    await click(submitButton());
    expect(container.querySelector("[role='status']").textContent).toContain(
      "Set as your practice question",
    );
  });

  it("describes the field with its helper text", async () => {
    // The helper text is where each mode says what submitting actually DOES
    // (live: joins the detected questions; practice: also replaces the drill
    // question). A sighted user reads it under the field; a screen-reader
    // user only ever hears it if it is wired to the input as its
    // description. Pinned as the resolved a11y property rather than as
    // markup, because the row has to be free to restructure — the button
    // stretches to the full height of a FormControl that carries its own
    // helper text, so the text may need to live outside that control.
    await render(baseProps({ helperText: "It joins the detected questions." }));
    const describedBy = input().getAttribute("aria-describedby");
    expect(describedBy, "the field must have an accessible description").toBeTruthy();
    const described = describedBy
      .split(/\s+/)
      .map((id) => container.querySelector(`#${CSS.escape(id)}`))
      .filter(Boolean)
      .map((el) => el.textContent)
      .join(" ");
    expect(described).toContain("It joins the detected questions.");
  });

  it("renders no description element when there is no helper text", async () => {
    // Live mode drops the helper text mid-session to buy back vertical space.
    // A dangling aria-describedby pointing at an empty or absent node is
    // worse than none.
    await render(baseProps());
    const describedBy = input().getAttribute("aria-describedby");
    if (describedBy) {
      const targets = describedBy
        .split(/\s+/)
        .map((id) => container.querySelector(`#${CSS.escape(id)}`))
        .filter(Boolean);
      expect(targets).toHaveLength(0);
    }
  });

  it("caps what can be typed at the shared limit", async () => {
    await render(baseProps());
    expect(Number(input().getAttribute("maxlength"))).toBe(MAX_MANUAL_QUESTION_CHARS);
  });

  it("disables the whole control when told to", async () => {
    await render(baseProps({ disabled: true }));
    await type(input(), "Tell me about yourself.");
    expect(input().disabled).toBe(true);
    expect(submitButton().disabled).toBe(true);
  });
});
