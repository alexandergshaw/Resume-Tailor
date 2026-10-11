// @vitest-environment jsdom
//
// N155 — the Regenerate affordance in the TECH-TERM detail region, driven the way a
// person reaches it: a REAL AnswerAids inside a REAL TechTermDetailScope, a real chip
// clicked open, the real store settled, DOM read back. Only the network client is
// stubbed. Reachability instrument for AC9/AC10/AC14/AC15 in the tech-term family.
//
// THE TECH-TERM REGION CARRIES NO data-* MARKER (AnswerAids.js:480, plan R6), so the
// AC16 exclusion below has nothing to lean on but the control's own [data-regenerate]
// — which is exactly why this family's blast-radius instrument is written explicitly
// here and why the new control MUST carry that marker.
//
// RED on HEAD, on the assertion: TechTermDetail shows a bespoke Retry on error/idle
// and no Regenerate, so "Regenerate present" / "no Retry" fail on their expectations.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createElement, act } from "react";
import { createRoot } from "react-dom/client";

const fetchTechTermDetail = vi.fn();
vi.mock("@/lib/copilot/techTermDetailClient", () => ({ fetchTechTermDetail: (...a) => fetchTechTermDetail(...a) }));

import AnswerAids from "./AnswerAids.js";
import { TechTermDetailScope } from "./useTechTermDetails.js";
import { resetTechTermDetailStore } from "@/lib/copilot/techTermDetailStore.js";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const TERM = "idempotency keys";
const TECH_TERMS = { status: "ready", terms: [TERM] };
const QUESTIONS = [{ id: "q1", question: "How do you make retries safe?", techTerms: TECH_TERMS }];
const REQUEST = { applicationId: "app-1", engine: "gemini" };

let container;
let root;

beforeEach(() => {
  resetTechTermDetailStore();
  fetchTechTermDetail.mockReset();
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.restoreAllMocks();
});

async function mount() {
  await act(async () =>
    root.render(createElement(TechTermDetailScope, { questions: QUESTIONS, request: REQUEST }, createElement(AnswerAids, { techTerms: TECH_TERMS }))),
  );
}

const chip = (name) => [...document.body.querySelectorAll("button")].find((b) => (b.textContent || "").trim() === name);
const regenerateBtn = () => [...document.body.querySelectorAll("button")].find((b) => /^regenerate/i.test((b.getAttribute("aria-label") || b.textContent || "").trim()));
const retryBtn = () => [...document.body.querySelectorAll("button")].find((b) => (b.textContent || "").trim() === "Retry" || /retry/i.test(b.getAttribute("aria-label") || ""));

async function click(el) {
  await act(async () => {
    el.dispatchEvent(new MouseEvent("click", { bubbles: true }));
    await new Promise((resolve) => setTimeout(resolve, 0));
  });
}

describe("AC9 / AC15 — Regenerate renders and the bespoke Retry is gone", () => {
  it("done: a Regenerate control is present in the open term region", async () => {
    fetchTechTermDetail.mockResolvedValue({ detail: "Idempotency keys dedupe retried requests.", empty: false });
    await mount();
    await click(chip(TERM));
    expect(document.body.textContent).toContain("Idempotency keys dedupe retried requests.");
    expect(regenerateBtn(), "Regenerate present on done").toBeTruthy();
  });

  it("error: Regenerate present and NO Retry remains", async () => {
    fetchTechTermDetail.mockRejectedValue(Object.assign(new Error("x"), { code: "http" }));
    await mount();
    await click(chip(TERM));
    expect(regenerateBtn(), "Regenerate present on error").toBeTruthy();
    expect(retryBtn(), "the bespoke Retry is removed (AC15)").toBeFalsy();
  });

  it("[AC10 pairing] disabled renders NO Regenerate, a non-disabled error renders one", async () => {
    fetchTechTermDetail.mockRejectedValue(Object.assign(new Error("x"), { code: "disabled" }));
    await mount();
    await click(chip(TERM));
    expect(regenerateBtn(), "no Regenerate on the kill switch").toBeFalsy();

    await act(async () => root.unmount());
    resetTechTermDetailStore();
    fetchTechTermDetail.mockReset();
    fetchTechTermDetail.mockRejectedValue(Object.assign(new Error("x"), { code: "http" }));
    root = createRoot(container);
    await mount();
    await click(chip(TERM));
    expect(regenerateBtn(), "Regenerate on a non-disabled error").toBeTruthy();
  });
});

describe("AC14 — failed regenerate recovers, and an evicted open term keeps a working control", () => {
  it("(b) an evicted OPEN term (idle, non-disabled) keeps a Regenerate that re-issues", async () => {
    fetchTechTermDetail.mockResolvedValue({ detail: "Idempotency keys dedupe retried requests.", empty: false });
    await mount();
    await click(chip(TERM));
    const callsBefore = fetchTechTermDetail.mock.calls.length;

    await act(async () => { resetTechTermDetailStore(); await new Promise((r) => setTimeout(r, 0)); });
    const regen = regenerateBtn();
    expect(regen, "an evicted open term still offers Regenerate").toBeTruthy();
    await click(regen);
    expect(fetchTechTermDetail.mock.calls.length).toBeGreaterThan(callsBefore);
  });
});

describe("AC16 — the control's text must not leak into the region's detail read", () => {
  it("the open region's detail text, excluding [data-regenerate], is exactly the model detail", async () => {
    // GREEN today (no control); LOAD-BEARING once AC9 lands. The tech-term region has
    // no data-* marker, so the control's own [data-regenerate] is the only thing this
    // exclusion can remove — if the new control omits that marker, the exclusion
    // no-ops and the control's words ("Regenerate", "Add context") leak into this
    // read, reddening the assertions below. That is the detection this instrument owes.
    fetchTechTermDetail.mockResolvedValue({ detail: "Idempotency keys dedupe retried requests.", empty: false });
    await mount();
    await click(chip(TERM));
    const region = document.body.querySelector('[aria-live="polite"]');
    expect(region, "the live detail region is present").toBeTruthy();
    const clone = region.cloneNode(true);
    clone.querySelectorAll("[data-regenerate]").forEach((n) => n.remove());
    const text = clone.textContent;
    expect(text).toContain("Idempotency keys dedupe retried requests.");
    expect(text).not.toContain("Regenerate");
    expect(text).not.toContain("Add context");
  });
});
