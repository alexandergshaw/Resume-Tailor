// @vitest-environment jsdom
//
// N155 — the Regenerate affordance in the PROJECT-BULLET detail region, driven the
// way a person reaches it: a REAL ProjectBulletDetailScope wrapping a REAL AnswerAids
// at a desktop viewport (the example group is open), the real "More detail" control
// clicked open, the real store settled. Reachability instrument for AC9/AC10/AC14/AC15
// in the project-bullet family. Harness mirrors
// AnswerAids.projectBulletDetail.warmOnMount.test.js.
//
// RED on HEAD, on the assertion: ProjectBulletDetail shows a bespoke Retry on
// error/idle and no Regenerate, so "Regenerate present" / "no Retry" fail.

import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { createElement, act } from "react";
import { createRoot } from "react-dom/client";

const fetchProjectBulletDetail = vi.fn();
vi.mock("@/lib/copilot/projectBulletDetailClient", () => ({ fetchProjectBulletDetail: (...a) => fetchProjectBulletDetail(...a) }));

import AnswerAids from "./AnswerAids.js";
import { ProjectBulletDetailScope } from "./useProjectBulletDetails.js";
import { resetProjectBulletDetailStore } from "@/lib/copilot/projectBulletDetailStore";
import { resetAllChoiceStores } from "@/lib/copilot/choiceStore.js";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

// Desktop viewport so the example group's CollapsibleAid is open and the controls mount.
let viewportWidth = 1200;
function queryMatches(query, width) {
  let matched = false;
  const max = /\(\s*max-width:\s*([\d.]+)px\s*\)/.exec(query);
  const min = /\(\s*min-width:\s*([\d.]+)px\s*\)/.exec(query);
  if (max) { matched = true; if (width > Number(max[1])) return false; }
  if (min) { matched = true; if (width < Number(min[1])) return false; }
  return matched;
}
window.matchMedia = (query) => ({
  matches: queryMatches(query, viewportWidth),
  media: query, onchange: null,
  addListener() {}, removeListener() {}, addEventListener() {}, removeEventListener() {}, dispatchEvent() { return false; },
});

const ROW = {
  status: "ready",
  competency: "incident response",
  domain: "SRE",
  title: "Rebuilt the paging rotation",
  bullets: ["Cut alert noise from 5 to 1 per shift"],
  hypothetical: true,
  engine: "gemini",
};
const BULLET = ROW.bullets[0];
const QUESTIONS = [{ id: "q1", question: "Tell me about an incident.", projectExample: ROW }];
const REQUEST = { applicationId: "app-1", engine: "gemini" };

let container;
let root;
const sleep = () => new Promise((resolve) => setTimeout(resolve, 0));

beforeEach(() => {
  resetProjectBulletDetailStore();
  resetAllChoiceStores();
  try { localStorage.clear(); } catch { /* memory-authoritative */ }
  fetchProjectBulletDetail.mockReset();
  viewportWidth = 1200;
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
    root.render(createElement(ProjectBulletDetailScope, { questions: QUESTIONS, request: REQUEST }, createElement(AnswerAids, { projectExample: ROW }))),
  );
  await act(async () => { await sleep(); });
}

const moreDetailBtn = () => [...document.body.querySelectorAll("button")].find((b) => (b.textContent || "").includes("More detail"));
const regenerateBtn = () => [...document.body.querySelectorAll("button")].find((b) => /^regenerate/i.test((b.getAttribute("aria-label") || b.textContent || "").trim()));
const retryBtn = () => [...document.body.querySelectorAll("button")].find((b) => (b.textContent || "").trim() === "Retry" || /retry/i.test(b.getAttribute("aria-label") || ""));

async function open() {
  await act(async () => { moreDetailBtn().dispatchEvent(new MouseEvent("click", { bubbles: true })); await sleep(); });
}

describe("AC9 / AC15 — Regenerate renders and the bespoke Retry is gone", () => {
  it("done: a Regenerate control is present under the open bullet", async () => {
    fetchProjectBulletDetail.mockResolvedValue({ detail: "A project like this might tune thresholds.", empty: false });
    await mount();
    await open();
    expect(document.body.textContent).toContain("A project like this might tune thresholds.");
    expect(regenerateBtn(), "Regenerate present on done").toBeTruthy();
  });

  it("error: Regenerate present and NO Retry remains", async () => {
    fetchProjectBulletDetail.mockRejectedValue(Object.assign(new Error("x"), { code: "http" }));
    await mount();
    await open();
    expect(regenerateBtn(), "Regenerate present on error").toBeTruthy();
    expect(retryBtn(), "the bespoke Retry is removed (AC15)").toBeFalsy();
  });

  it("[AC10 pairing] disabled renders NO Regenerate, a non-disabled error renders one", async () => {
    fetchProjectBulletDetail.mockRejectedValue(Object.assign(new Error("x"), { code: "disabled" }));
    await mount();
    await open();
    expect(regenerateBtn(), "no Regenerate on the kill switch").toBeFalsy();

    await act(async () => root.unmount());
    resetProjectBulletDetailStore();
    resetAllChoiceStores();
    fetchProjectBulletDetail.mockReset();
    fetchProjectBulletDetail.mockRejectedValue(Object.assign(new Error("x"), { code: "http" }));
    root = createRoot(container);
    await mount();
    await open();
    expect(regenerateBtn(), "Regenerate on a non-disabled error").toBeTruthy();
  });
});

describe("AC14 — an evicted open bullet keeps a working re-issue", () => {
  it("(b) an evicted OPEN bullet (idle, non-disabled) keeps a Regenerate that re-issues", async () => {
    fetchProjectBulletDetail.mockResolvedValue({ detail: "A project like this might tune thresholds.", empty: false });
    await mount();
    await open();
    const callsBefore = fetchProjectBulletDetail.mock.calls.length;

    await act(async () => { resetProjectBulletDetailStore(); await sleep(); });
    const regen = regenerateBtn();
    expect(regen, "an evicted open bullet still offers Regenerate (not a dead end)").toBeTruthy();
    await act(async () => { regen.dispatchEvent(new MouseEvent("click", { bubbles: true })); await sleep(); });
    expect(fetchProjectBulletDetail.mock.calls.length).toBeGreaterThan(callsBefore);
  });
});
