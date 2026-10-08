// @vitest-environment jsdom
//
// N144a T4 — the collapse rides AnswerAids, so it must reach all four answer
// surfaces with ZERO call-site edits, and the always-visible answer + points
// (AnswerLines) must NEVER fall inside a disclosure (docs/loop/N144a.plan.r1.md
// §1.2 / §7.2, ledger L1). Driven through the REAL parents the way a human
// reaches each surface — not by calling AnswerAids directly — because "the
// parent forwards it" is not "anyone supplies it" (the precedent
// AnswerAids.projectExampleSites.test.js).
//
// The two module-internal CopilotDashboard mounts (current + history) are
// reached through the exported default `CopilotDashboard`; the history header
// is found BY ITS QUESTION TEXT, never by `button[aria-expanded="false"]` —
// that generic selector mis-selects a collapsed aid header on a phone (plan
// §5, the dashboard-suite hazard rows).
//
// RED on HEAD: at 375 AnswerAids does not collapse (posting/tech have no header
// button; examples defaults open), so there are not three collapsed aid headers
// on any surface. Intended red: the feature is absent.

import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { createElement, act } from "react";
import { createRoot } from "react-dom/client";

import QuestionFeed from "./QuestionFeed.js";
import SampleAnswer from "./practice/SampleAnswer.js";
import CopilotDashboard from "./dashboard/CopilotDashboard.js";
import { resetAllChoiceStores } from "@/lib/copilot/choiceStore.js";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

// --- viewport emulation ------------------------------------------------------
const PHONE = 375;
const DESKTOP = 1200;
let viewportWidth = PHONE;

function queryMatches(query, width) {
  let matched = false;
  const max = /\(\s*max-width:\s*([\d.]+)px\s*\)/.exec(query);
  const min = /\(\s*min-width:\s*([\d.]+)px\s*\)/.exec(query);
  if (max) {
    matched = true;
    if (width > Number(max[1])) return false;
  }
  if (min) {
    matched = true;
    if (width < Number(min[1])) return false;
  }
  return matched;
}

window.matchMedia = (query) => ({
  matches: queryMatches(query, viewportWidth),
  media: query,
  onchange: null,
  addListener() {},
  removeListener() {},
  addEventListener() {},
  removeEventListener() {},
  dispatchEvent() {
    return false;
  },
});

const POSTING_LABEL = "Words from the posting to work in";
const TECH_LABEL = "Tech buzzwords";
const EX_LABEL = "Example projects (invented)";
const AID_LABELS = [POSTING_LABEL, TECH_LABEL, EX_LABEL];
const EX_TITLE = "Rebuilt the paging rotation";

const anchor = { title: "Senior Engineer", company: "Initech", project: "Payments migration", description: [], matched: true, source: "resume" };
const READY = (title = EX_TITLE) => ({
  status: "ready",
  competency: "incident response",
  domain: "SRE",
  title,
  bullets: ["Cut alert noise from 5 to 1 per shift", "Mean time to ack within target"],
  hypothetical: true,
  engine: "gemini",
});
const TECH_READY = { status: "ready", terms: ["idempotency keys", "circuit breaker"] };

let container;
let root;

beforeEach(() => {
  resetAllChoiceStores();
  try {
    localStorage.clear();
  } catch {
    /* memory-authoritative anyway */
  }
  viewportWidth = PHONE;
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
});

function accessibleName(el) {
  const clone = el.cloneNode(true);
  for (const node of clone.querySelectorAll('[aria-hidden="true"], [hidden]')) node.remove();
  return (clone.textContent || "").trim();
}
const aidHeaders = () => [...container.querySelectorAll("button")].filter((b) => AID_LABELS.includes(accessibleName(b)));
const panelOf = (hdr) => {
  const id = hdr.getAttribute("aria-controls");
  return id ? container.querySelector(`#${CSS.escape(id)}`) : null;
};
async function render(el, width = viewportWidth) {
  viewportWidth = width;
  await act(async () => root.render(el));
  return container;
}

// Every aid header on the surface is collapsed, and the always-visible answer
// point is on screen but NOT inside any aid's disclosure panel.
function assertPointOutsideCollapsedAids(point) {
  const headers = aidHeaders();
  expect(headers.length, "at least the three aid headers are present").toBeGreaterThanOrEqual(AID_LABELS.length);
  for (const hdr of headers) {
    expect(hdr.getAttribute("aria-expanded"), `${accessibleName(hdr)} collapsed`).toBe("false");
  }
  expect(container.textContent).toContain(point);
  for (const hdr of headers) {
    const panel = panelOf(hdr);
    if (panel) expect(panel.textContent || "").not.toContain(point);
  }
}

function assertAllAidsOpen() {
  const headers = aidHeaders();
  expect(headers.length).toBeGreaterThanOrEqual(AID_LABELS.length);
  for (const hdr of headers) expect(hdr.getAttribute("aria-expanded")).toBe("true");
}

// --- Site 1/2: the two exported presentational parents ----------------------
describe("QuestionFeed (QuestionCard) — site QuestionFeed.js:209", () => {
  const POINT = "I led the response to a production incident.";
  const questions = () => [
    {
      id: "q1",
      question: "Tell me about an incident.",
      status: "done",
      cues: ["the incident"],
      points: [POINT],
      pageSources: [null],
      buzzwords: ["latency", "SLA"],
      anchor,
      projectExample: READY(),
      projectExampleLive: READY("Scaled a read-replica fleet"),
      techTerms: TECH_READY,
    },
  ];

  it("at 375: the three aids collapse and the answer point is not inside any disclosure", async () => {
    await render(createElement(QuestionFeed, { questions: questions(), onDraft: () => {} }), PHONE);
    assertPointOutsideCollapsedAids(POINT);
  });

  it("[control] at 1200: the same mount has every aid open", async () => {
    await render(createElement(QuestionFeed, { questions: questions(), onDraft: () => {} }), DESKTOP);
    assertAllAidsOpen();
    expect(container.textContent).toContain(EX_TITLE);
  });
});

describe("SampleAnswer — site SampleAnswer.js:223", () => {
  const POINT = "I led the response to a production incident.";
  const props = () => ({
    visible: true,
    status: "done",
    points: [POINT],
    cues: ["the incident"],
    buzzwords: ["latency"],
    anchor,
    pageSources: [null],
    grounding: {},
    error: "",
    isEmbedded: false,
    onToggle: () => {},
    onRetry: () => {},
    onRegenerate: () => {},
    projectExample: READY(),
    projectExampleLive: READY("Scaled a read-replica fleet"),
    techTerms: TECH_READY,
  });

  it("at 375: the three aids collapse and the answer point is not inside any disclosure", async () => {
    await render(createElement(SampleAnswer, props()), PHONE);
    assertPointOutsideCollapsedAids(POINT);
  });

  it("[control] at 1200: the same mount has every aid open", async () => {
    await render(createElement(SampleAnswer, props()), DESKTOP);
    assertAllAidsOpen();
    expect(container.textContent).toContain(EX_TITLE);
  });
});

// --- Site 3/4: the two module-internal CopilotDashboard mounts ---------------
function entry(id, question, over = {}) {
  return {
    id,
    question,
    at: Date.now(),
    status: "done",
    points: [`Distinctive point for ${question}`],
    cues: [],
    buzzwords: ["latency"],
    anchor,
    pageSources: [],
    error: "",
    projectExample: READY(),
    projectExampleLive: READY("Scaled a read-replica fleet"),
    techTerms: TECH_READY,
    ...over,
  };
}
async function renderDashboard(props, width) {
  await render(createElement(CopilotDashboard, { pace: { measured: false }, fillers: { measured: false }, ...props }), width);
}
// The history header is the button whose visible text includes the question —
// NEVER `button[aria-expanded="false"]`, which also matches a collapsed aid.
function historyHeader(question) {
  return [...container.querySelectorAll("button")].find((b) => (b.textContent || "").includes(question) && !AID_LABELS.includes(accessibleName(b)));
}

describe("CopilotDashboard CurrentAnswerPanel — site CopilotDashboard.js:452", () => {
  it("at 375: the current answer's aids collapse and the point is not inside any disclosure", async () => {
    const current = entry(2, "Current question");
    await renderDashboard({ questions: [current], current, currentIsSeed: false, history: [] }, PHONE);
    assertPointOutsideCollapsedAids("Distinctive point for Current question");
  });

  it("[control] at 1200: the current answer's aids are all open", async () => {
    const current = entry(2, "Current question");
    await renderDashboard({ questions: [current], current, currentIsSeed: false, history: [] }, DESKTOP);
    assertAllAidsOpen();
  });
});

describe("CopilotDashboard HistoryItem — site CopilotDashboard.js:751", () => {
  it("at 375: an expanded past question's aids collapse and the point is not inside any disclosure", async () => {
    const past = entry(1, "Past question");
    const current = entry(2, "Current question");
    await renderDashboard({ questions: [past, current], current, currentIsSeed: false, history: [past] }, PHONE);

    const hdr = historyHeader("Past question");
    expect(hdr, "the history item header, found by its question text").toBeTruthy();
    await act(async () => hdr.dispatchEvent(new MouseEvent("click", { bubbles: true })));

    expect(container.textContent).toContain("Distinctive point for Past question");
    // Every aid header on the surface (current + the now-expanded history item)
    // is collapsed, and neither answer point sits inside a disclosure panel.
    for (const hdr2 of aidHeaders()) {
      expect(hdr2.getAttribute("aria-expanded")).toBe("false");
      const panel = panelOf(hdr2);
      if (panel) {
        expect(panel.textContent || "").not.toContain("Distinctive point for Past question");
        expect(panel.textContent || "").not.toContain("Distinctive point for Current question");
      }
    }
  });
});
