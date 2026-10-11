// @vitest-environment jsdom
//
// N155 — the Regenerate affordance in the EXPANSION region, driven the way a person
// reaches it: a REAL AnswerLines inside a REAL ExpansionScope, the real "More detail"
// control clicked open, the real store settled, and the DOM read back. Only the
// network is stubbed. This is the reachability instrument for AC9/AC10/AC14/AC15 in
// the expand family — a direct handler call would NOT satisfy it.
//
// RED on HEAD, on the assertion: ExpansionPanel renders every terminal state today
// but NO Regenerate control, and it still shows the bespoke Retry on the error branch
// and an EMPTY_TEXT dead-end on idle-open. So "a Regenerate control is present" and
// "no Retry remains" fail on their expectations.
//
//   AC9  : Regenerate renders on done / empty / error(non-disabled) / idle-open.
//   AC10 : absent on loading and on disabled; present on error and idle-open.
//   AC14 : a failed regenerate recovers on a second click; an evicted OPEN region
//          (idle, non-disabled) keeps a working Regenerate, not a dead end.
//   AC15 : the bespoke Retry is gone; Regenerate serves as the retry.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createElement, act } from "react";
import { createRoot } from "react-dom/client";

import AnswerLines from "./AnswerLines.js";
import { ExpansionScope } from "./useAnswerExpansions.js";
import { resetExpansionStore } from "@/lib/copilot/expansionStore.js";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const LINES = [{ label: "", cue: "", point: "I ran the postmortem with the payments group the next morning.", pageSource: null, emphasis: null, sourceIndex: 0 }];
const QUESTIONS = [{ id: 1, question: "Tell me about a failure.", points: ["I ran the postmortem with the payments group the next morning."], status: "done" }];
const REQUEST = { applicationId: "app-1", profile: "", interviewType: "behavioral", codeLanguage: "auto", engine: "embedded" };

let container;
let root;
const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
  resetExpansionStore();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

async function mount(fetchImpl) {
  vi.stubGlobal("fetch", vi.fn(fetchImpl));
  await act(async () => {
    root.render(createElement(ExpansionScope, { questions: QUESTIONS, request: REQUEST }, createElement(AnswerLines, { lines: LINES })));
    await flush();
  });
  return window.fetch;
}

const ok = (body) => ({ ok: true, status: 200, json: async () => body });
const DONE_BODY = { subBullets: [{ text: "I reconciled every settlement by hand.", pageSource: null, source: null }], caption: "", empty: false };

const moreDetailBtn = () => [...document.body.querySelectorAll("button")].find((b) => /^more detail/i.test(b.getAttribute("aria-label") || ""));
const regenerateBtn = () => [...document.body.querySelectorAll("button")].find((b) => /^regenerate/i.test((b.getAttribute("aria-label") || b.textContent || "").trim()));
const retryBtn = () => [...document.body.querySelectorAll("button")].find((b) => /retry/i.test(b.textContent || "") || /retry/i.test(b.getAttribute("aria-label") || ""));

async function open() {
  await act(async () => {
    moreDetailBtn().dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await flush();
  });
}

describe("AC9 — Regenerate renders in every terminal / stale-open state", () => {
  it("done: a Regenerate control is present under the open bullet", async () => {
    await mount(async () => ok(DONE_BODY));
    await open();
    expect(regenerateBtn(), "Regenerate present on done").toBeTruthy();
  });

  it("empty: a Regenerate control is present (regenerating an honest empty is allowed now)", async () => {
    await mount(async () => ok({ subBullets: [], caption: "", empty: true }));
    await open();
    expect(regenerateBtn(), "Regenerate present on empty").toBeTruthy();
  });
});

describe("AC10 / AC15 — present on error, absent on disabled; the bespoke Retry is gone", () => {
  it("error(http): Regenerate present and NO Retry remains", async () => {
    await mount(async () => ({ ok: false, status: 500, json: async () => ({}) }));
    await open();
    expect(regenerateBtn(), "Regenerate present on error").toBeTruthy();
    expect(retryBtn(), "the bespoke Retry is removed (AC15)").toBeFalsy();
  });

  it("[AC10 pairing] disabled renders NO Regenerate, while error(http) renders one", async () => {
    await mount(async () => ({ ok: false, status: 503, json: async () => ({ code: "disabled" }) }));
    await open();
    expect(regenerateBtn(), "no Regenerate on the kill-switch state").toBeFalsy();

    // Tear down and re-mount into a non-disabled error: the control must appear.
    await act(async () => root.unmount());
    resetExpansionStore();
    root = createRoot(container);
    await mount(async () => ({ ok: false, status: 500, json: async () => ({}) }));
    await open();
    expect(regenerateBtn(), "Regenerate on a non-disabled error").toBeTruthy();
  });

  it("[AC10] no Regenerate while the region is loading", async () => {
    // Vacuously green on bare HEAD; meaningful once AC9 lands — a build that renders
    // the control during loading (defeating the one-in-flight UI guard) reds here.
    await mount(() => new Promise(() => {})); // never resolves -> stays loading
    await open();
    expect(regenerateBtn()).toBeFalsy();
  });
});

describe("AC14 — a failed regenerate and an evicted open region both keep a working re-issue", () => {
  it("(a) a failed regenerate recovers on a second Regenerate click", async () => {
    let calls = 0;
    await mount(async () => {
      calls += 1;
      if (calls === 1) return ok(DONE_BODY); // the warm settles done
      if (calls === 2) return { ok: false, status: 500, json: async () => ({}) }; // first regenerate fails
      return ok({ subBullets: [{ text: "recovered detail.", pageSource: null, source: null }], caption: "", empty: false });
    });
    await open();
    const regen = regenerateBtn();
    expect(regen, "Regenerate present on done").toBeTruthy();

    await act(async () => { regen.dispatchEvent(new MouseEvent("click", { bubbles: true })); await flush(); });
    // Now in error, with a working Regenerate (never a silent blank or stuck spinner).
    const retry = regenerateBtn();
    expect(retry, "Regenerate still present after a failed regenerate").toBeTruthy();
    await act(async () => { retry.dispatchEvent(new MouseEvent("click", { bubbles: true })); await flush(); });
    expect(document.body.textContent).toContain("recovered detail.");
  });

  it("(b) an evicted OPEN region (idle, non-disabled) keeps a Regenerate that re-issues", async () => {
    const fetchMock = await mount(async () => ok(DONE_BODY));
    await open();
    expect(document.body.textContent).toContain("I reconciled every settlement by hand.");
    const warmCalls = fetchMock.mock.calls.length;

    // Evict the record while the region stays OPEN -> get() reads idle.
    await act(async () => { resetExpansionStore(); await flush(); });
    const regen = regenerateBtn();
    expect(regen, "an evicted open region still offers Regenerate (not an EMPTY_TEXT dead-end)").toBeTruthy();

    await act(async () => { regen.dispatchEvent(new MouseEvent("click", { bubbles: true })); await flush(); });
    expect(fetchMock.mock.calls.length, "the Regenerate re-issued a fetch").toBeGreaterThan(warmCalls);
  });
});
