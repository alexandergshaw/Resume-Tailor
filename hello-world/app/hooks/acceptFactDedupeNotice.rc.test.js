// @vitest-environment jsdom
//
// N81 Finding B (fresh-verifier NOT-SHIP on a36d6ae): the MANUAL accept path
// gives the candidate ZERO feedback when the guard silently absorbs a dedupe.
//
// `acceptFacts` (useCompanyResearch.js) resets `acceptNotice` to "" at entry and
// only ever assigns a notice inside the `coverChanged` branches. When a
// re-accept dedupes (coverChanged === false) it resolves `{ ok: true }` with
// `acceptNotice` still "" and `acceptError` still "": the dialog stays open,
// nothing changes, and nothing is said. The auto path got a dedicated "info"
// severity + on-screen message for exactly this "nothing new" outcome under N77;
// the manual path never did, and N62's placement setting makes "change
// placement, re-accept" a designed workflow that routinely lands here.
//
// This file drives the really-mounted CompanyResearchDialog over the real
// useCompanyResearch hook and clicks the real controls -- never acceptFacts(...)
// directly for the behavioural leg. It asserts the LAST HOP: after a deduped
// accept, a user-facing message exists in state AND is rendered into the dialog
// DOM (the dialog renders `acceptNotice` at CompanyResearchDialog.js:302-304).
// The exact wording is the implementer's to choose (mirroring N77's info path);
// this pins that feedback EXISTS and is not dressed as an error.
//
// jsdom note: MUI Dialog and Select menu portal to document.body.
// Harness mirrors acceptFactReacceptPlacement.rc.test.js.

import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from "vitest";
import { createElement, useState, act } from "react";
import { createRoot } from "react-dom/client";

import { useCompanyResearch } from "./useCompanyResearch.js";
import CompanyResearchDialog from "@/app/components/CompanyResearchDialog.js";
import { sanitizeStoredFacts } from "@/lib/acceptedFacts/factStore.js";
import { embeddedEngine } from "@/lib/llm/engines/tailor-lite/engine.js";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const JOB_ID = "job-1";
const JOB = { id: JOB_ID, title: "Staff Engineer", company: "Acme", description: "React, Node, telemetry." };

const FACT = "Acme opened a Dublin telemetry lab this spring, which is exactly the kind of work I want to join.";
const ARTICLE = {
  id: "art-a",
  title: "Acme opens a Dublin telemetry lab",
  url: "https://news.example.com/one",
  source: "Newsroom",
  date: "2026-02-01",
  summary: "A thing happened.",
  suggestion: FACT,
};

const CURRENT_ANCHOR = /in my current role/i;
function introIndex(lines) {
  const i = lines.findIndex((l, idx) => idx > 0 && String(l).trim().length > 40);
  return i >= 0 ? i : lines.length > 1 ? 1 : 0;
}

let ENGINE_B64 = "";
let ENGINE_LINES = [];
let INTRO_IDX = -1;
let CURRENT_IDX = -1;

beforeAll(async () => {
  const cl = await embeddedEngine.tailorCoverLetter({
    jobPosting: "Staff Engineer at Acme. React, Node, telemetry, accessibility.",
    jobTitle: "Staff Engineer",
    companyName: "Acme",
  });
  ENGINE_B64 = cl.docxB64;
  ENGINE_LINES = cl.resultLines;
  INTRO_IDX = introIndex(ENGINE_LINES);
  CURRENT_IDX = ENGINE_LINES.findIndex((l) => CURRENT_ANCHOR.test(String(l)));
});

let store = { facts: [], removed: [], revision: null };
let researchQueue = [];
let research = null;
let currentMap = null;
let acceptPromise = null;
let container = null;
let root = null;
const EMPTY = [];

function Probe({ initialMap }) {
  const [tailoringMap, setTailoringMap] = useState(initialMap);
  currentMap = tailoringMap;
  research = useCompanyResearch({ tailoringMap, setTailoringMap, setPreviewReloadKey: () => {} });
  const r = research.researchByJob[JOB_ID] || {};
  return createElement(CompanyResearchDialog, {
    open: research.companyResearch.open,
    company: research.companyResearch.company,
    needsCompany: !!r.needsCompany,
    loading: !!r.loading,
    error: r.error || "",
    articles: r.articles || EMPTY,
    warnings: r.warnings || EMPTY,
    busy: !!research.companyResearch.busy,
    acceptError: research.companyResearch.acceptError || "",
    acceptNotice: research.companyResearch.acceptNotice || "",
    coverLetterLines: tailoringMap[JOB_ID]?.coverLetterResultLines || EMPTY,
    onClose: () => research.closeCompanyResearch(),
    onApply: () => {},
    onAccept: (selection) => {
      acceptPromise = research.acceptFacts(selection);
      return acceptPromise;
    },
    onResearch: () => {},
    onAddUrl: () => {},
  });
}

function entryEngine(over = {}) {
  return { status: "done", coverLetterResultLines: [...ENGINE_LINES], coverLetterDocxB64: ENGINE_B64, coverVersionId: "ver-1", ...over };
}
function json(body) {
  return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
}

beforeEach(() => {
  store = { facts: [], removed: [], revision: null };
  researchQueue = [];
  research = null;
  currentMap = null;
  acceptPromise = null;
  globalThis.fetch = vi.fn(async (url, init = {}) => {
    const method = (init.method || "GET").toUpperCase();
    const u = String(url);
    if (u.includes("/api/company-research")) return json({ articles: researchQueue.shift() || [], warnings: [] });
    if (u.includes("/api/accepted-facts")) {
      if (method === "GET") return json({ facts: store.facts, removed: store.removed, revision: store.revision });
      const body = JSON.parse(init.body);
      store = {
        facts: sanitizeStoredFacts(body.facts),
        removed: Array.isArray(body.declinedUrls) ? body.declinedUrls : [],
        revision: (store.revision ?? 0) + 1,
      };
      return json({ facts: store.facts, removed: store.removed, revision: store.revision });
    }
    return json({});
  });
});

afterEach(async () => {
  if (root) await act(async () => root.unmount());
  if (container) container.remove();
  root = null;
  container = null;
  delete globalThis.fetch;
});

async function flush(times = 6) {
  for (let i = 0; i < times; i += 1) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}

async function mount() {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root.render(createElement(Probe, { initialMap: { [JOB_ID]: entryEngine() } }));
  });
  await flush();
}

async function openResearch() {
  researchQueue.push([ARTICLE]);
  await act(async () => {
    research.openCompanyResearch(JOB);
  });
  await flush();
  expect(hookArticles().length, "the research run never reached the hook -- instrument failure").toBe(1);
}
function hookArticles() {
  return research?.researchByJob?.[JOB_ID]?.articles || [];
}
function buttonByText(text) {
  return [...document.querySelectorAll("button")].find((b) => (b.textContent || "").trim() === text);
}
function acceptControl() {
  return buttonByText("Insert into cover letter");
}
async function clickAccept() {
  const button = acceptControl();
  expect(button, "no 'Insert into cover letter' control on screen").toBeTruthy();
  expect(button.disabled, "the accept control is disabled").toBe(false);
  acceptPromise = null;
  await act(async () => {
    button.click();
  });
  expect(acceptPromise, "the control was clicked but no accept started").toBeTruthy();
  await act(async () => {
    await acceptPromise;
  });
  await flush(2);
}
async function clickButton(text) {
  const b = buttonByText(text);
  expect(b, `no '${text}' control on screen`).toBeTruthy();
  expect(b.disabled, `'${text}' is disabled`).toBe(false);
  await act(async () => {
    b.click();
  });
  await flush();
}
// Drive the real MUI Select in the arrange step (opens on mousedown in jsdom).
async function openSelect() {
  const trigger = document.querySelector('[role="combobox"]');
  expect(trigger, "no placement Select rendered in the arrange step").toBeTruthy();
  await act(async () => {
    trigger.dispatchEvent(new window.MouseEvent("mousedown", { bubbles: true, button: 0 }));
  });
  await flush();
  return trigger;
}
async function setPlacement(label) {
  await openSelect();
  const option = [...document.querySelectorAll('[role="option"]')].find((o) => (o.textContent || "").trim() === label);
  expect(option, `no '${label}' option in the placement menu`).toBeTruthy();
  await act(async () => {
    option.click();
  });
  await flush();
}

function liveLines() {
  return currentMap[JOB_ID].coverLetterResultLines || [];
}
function count(hay, needle) {
  return String(hay).split(needle).length - 1;
}

// ---------------------------------------------------------------------------
// Fixture precondition -- distinct intro/current lines, fact absent, so the
// re-accept genuinely dedupes (coverChanged=false) rather than duplicating.
// ---------------------------------------------------------------------------

describe("N81 dedupe notice: fixture precondition", () => {
  it("the engine letter carries the 'current role' anchor on a line distinct from intro, and lacks the fact", () => {
    expect(CURRENT_IDX, "no 'in my current role' line").toBeGreaterThanOrEqual(0);
    expect(INTRO_IDX).toBeGreaterThanOrEqual(0);
    expect(CURRENT_IDX, "'current' and 'intro' coincide").not.toBe(INTRO_IDX);
    expect(ENGINE_LINES.join("\n"), "fixture already contains the fact").not.toContain(FACT);
  });
});

// ---------------------------------------------------------------------------
// The gap -- RED on HEAD.
// ---------------------------------------------------------------------------

describe("N81 dedupe notice: a deduped re-accept tells the candidate something", () => {
  it("change placement then re-accept -> the guard absorbs it (ok:true) and a user-facing notice is shown (RED on HEAD)", async () => {
    await mount();
    await openResearch();

    // Accept #1 at the default 'intro' placement -- the fact lands.
    await clickAccept();
    expect(research.companyResearch.acceptError || "", "the first accept was refused -- test is vacuous").toBe("");
    expect(count(liveLines().join("\n"), FACT), "the first accept did not insert the fact once").toBe(1);

    // Change the placement to 'current' in the arrange step, return, and accept
    // again -- the N62 "change placement, re-accept" workflow, which dedupes.
    await clickButton("Next: arrange (1)");
    await setPlacement("Current role");
    await clickButton("Back");

    const button = acceptControl();
    acceptPromise = null;
    await act(async () => {
      button.click();
    });
    let result;
    await act(async () => {
      result = await acceptPromise;
    });
    await flush(2);

    // The dedupe really happened (this is the silent-absorption case, not a
    // refusal and not a duplicate): ok:true, no error, still exactly one copy.
    expect(result?.ok, "the re-accept was refused -- not the silent-absorption case this pins").toBe(true);
    expect(research.companyResearch.acceptError || "", "a dedupe must not surface as an ERROR (it is an info outcome, per N77)").toBe("");
    expect(count(liveLines().join("\n"), FACT), "the re-accept duplicated the fact instead of deduping").toBe(1);

    // THE CRITERION -- the last hop to the user. On HEAD acceptNotice is "" and
    // nothing renders. After the fix a message exists AND is shown in the dialog.
    const notice = research.companyResearch.acceptNotice || "";
    expect(notice, "a deduped manual accept produced ZERO feedback (N81 Finding B)").not.toBe("");
    expect(document.body.textContent, "the notice was set in state but never rendered to the candidate").toContain(notice);
  });
});

// WHAT THIS FILE CANNOT CATCH. It stubs /api/accepted-facts, so the route/RPC
// are not exercised. It asserts the notice text is RENDERED (visible to sighted
// users) but not that it is ANNOUNCED to assistive tech -- the manual-path
// notice Box carries no role=status (CompanyResearchDialog.js:302-304), unlike
// the auto path; that a11y gap is a separate finding, out of this round's scope.
// It does not pin the exact wording, only that non-empty, non-error feedback
// exists and reaches the DOM.
