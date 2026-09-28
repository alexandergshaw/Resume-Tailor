// @vitest-environment jsdom
//
// N81 CLOSING ROUND, BUG 1 (fresh-verifier NOT-SHIP on 5e96be2), REACHABILITY.
// The bug is proven at the pure seam in
// lib/acceptedFacts/factInsertion.substringFalsePositive.test.js. This file
// proves a REAL USER reaches it by driving the really-mounted
// CompanyResearchDialog over the real useCompanyResearch hook, editing the real
// "Cover-letter suggestion" TextField and clicking the real "Insert into cover
// letter" control -- never calling acceptFacts(...) directly for the
// behavioural leg (brief rule 2).
//
// WHY THE SCENARIO IS LAYERED (and why a bare accept->edit->reaccept would NOT
// discriminate the fix). The fix compares the RECORDED fact text against the
// current letter. A plain accept->edit->reaccept leaves the recorded (long)
// text still in the letter, so BOTH the buggy build and the fixed build
// suppress -- that scenario is not a false positive the fix flips, and a red
// asserting insertion there would be UNSATISFIABLE. The fix flips the outcome
// ONLY when the recorded text is absent from the version on screen while the
// edited fragment coincidentally is present. That "recorded absent" state is
// what a cover-version switch produces (selectDocumentVersion swaps
// coverLetterResultLines and clears insertedFacts but never touches
// acceptedFactsByJob). selectDocumentVersion lives in useDocumentPreview.js
// (owned by another agent this round), so its RESULTING STATE is reproduced
// with the harness's own setTailoringMap -- the same technique
// acceptFactVersionSwitch.rc.test.js uses. The behaviour under test (the
// re-accept, with a genuine edit of the suggestion box) is still driven through
// the real controls.
//
// THE REACHABLE SEQUENCE:
//   1. Open research; accept the article at 'intro' (the long fact lands, its
//      id + text are written to the accepted-facts store).
//   2. The candidate switches to a freshly regenerated cover-letter VERSION
//      that does not contain the long fact (state reproduced via setTailoringMap).
//   3. Still in the open dialog, the candidate edits the article's own
//      suggestion box down to a short fragment that already occurs in the
//      regenerated letter's prose, and re-accepts.
//   4. On HEAD the guard compares that short INCOMING text, finds it in the
//      letter, and silently suppresses with "That fact is already in your cover
//      letter" -- the article's content stays missing. After the fix the guard
//      compares the RECORDED (long) text, which is absent, and inserts.
//
// jsdom note: MUI Dialog and Select menu portal to document.body.
// Harness mirrors acceptFactVersionSwitch.rc.test.js.

import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from "vitest";
import { createElement, useState, act } from "react";
import { createRoot } from "react-dom/client";

import { useCompanyResearch } from "./useCompanyResearch.js";
import CompanyResearchDialog from "@/app/components/CompanyResearchDialog.js";
import { sanitizeStoredFacts } from "@/lib/acceptedFacts/factStore.js";
import { embeddedEngine } from "@/lib/llm/engines/tailor-lite/engine.js";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const ALREADY_PRESENT = "That fact is already in your cover letter.";

const JOB_ID = "job-1";
const JOB = { id: JOB_ID, title: "Staff Engineer", company: "Acme", description: "React, Node, telemetry." };

const LONG_FACT = "Acme opened a Dublin telemetry lab this spring, which is exactly the kind of work I want to join.";
const ARTICLE = {
  id: "art-a",
  title: "Acme opens a Dublin telemetry lab",
  url: "https://news.example.com/one",
  source: "Newsroom",
  date: "2026-02-01",
  summary: "A thing happened.",
  suggestion: LONG_FACT,
};

function introIndex(lines) {
  const i = lines.findIndex((l, idx) => idx > 0 && String(l).trim().length > 40);
  return i >= 0 ? i : lines.length > 1 ? 1 : 0;
}

let ENGINE_B64 = "";
let ENGINE_LINES = [];
let INTRO_IDX = -1;
// A short fragment drawn from a NON-intro engine line, so it occurs in the
// regenerated letter's prose (HEAD's incoming-text guard engages) but NOT on
// the 'intro' target line (M1's per-paragraph check would not independently
// skip it).
let SHORT_FRAGMENT = "";

beforeAll(async () => {
  const cl = await embeddedEngine.tailorCoverLetter({
    jobPosting: "Staff Engineer at Acme. React, Node, telemetry, accessibility.",
    jobTitle: "Staff Engineer",
    companyName: "Acme",
  });
  ENGINE_B64 = cl.docxB64;
  ENGINE_LINES = cl.resultLines;
  INTRO_IDX = introIndex(ENGINE_LINES);
  // Pick a donor line distinct from the intro line and long enough to hold a
  // multi-word fragment; source a fragment that is NOT a substring of the intro
  // line. Fail loudly (the precondition test below) if none can be found.
  const introLine = String(ENGINE_LINES[INTRO_IDX] || "");
  for (let i = 0; i < ENGINE_LINES.length; i += 1) {
    if (i === INTRO_IDX) continue;
    const words = String(ENGINE_LINES[i] || "").trim().split(/\s+/);
    if (words.length < 4) continue;
    const candidate = words.slice(1, 4).join(" ");
    if (candidate.length >= 8 && !introLine.includes(candidate) && candidate.length < String(ENGINE_LINES[i]).length) {
      SHORT_FRAGMENT = candidate;
      break;
    }
  }
});

let store = { facts: [], removed: [], revision: null };
let researchQueue = [];
let putBodies = [];
let research = null;
let currentMap = null;
let setMap = null;
let acceptPromise = null;
let container = null;
let root = null;
const EMPTY = [];

function Probe({ initialMap }) {
  const [tailoringMap, setTailoringMap] = useState(initialMap);
  currentMap = tailoringMap;
  setMap = setTailoringMap;
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
  putBodies = [];
  research = null;
  currentMap = null;
  setMap = null;
  acceptPromise = null;
  globalThis.fetch = vi.fn(async (url, init = {}) => {
    const method = (init.method || "GET").toUpperCase();
    const u = String(url);
    if (u.includes("/api/company-research")) return json({ articles: researchQueue.shift() || [], warnings: [] });
    if (u.includes("/api/accepted-facts")) {
      if (method === "GET") return json({ facts: store.facts, removed: store.removed, revision: store.revision });
      const body = JSON.parse(init.body);
      putBodies.push(body);
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
  let result;
  await act(async () => {
    button.click();
  });
  await act(async () => {
    result = await acceptPromise;
  });
  await flush(2);
  return result;
}
// Edit the article's real "Cover-letter suggestion" TextField through a native
// input event, the same way a candidate typing into it would.
async function editSuggestion(newText) {
  const textarea = [...document.querySelectorAll("textarea")].find((t) => (t.value || "").includes(LONG_FACT));
  expect(textarea, "no editable suggestion textarea found for the accepted article").toBeTruthy();
  const setter = Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value").set;
  await act(async () => {
    setter.call(textarea, newText);
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
  });
  await flush();
}
function liveLines() {
  return currentMap[JOB_ID].coverLetterResultLines || [];
}
function count(hay, needle) {
  return String(hay).split(needle).length - 1;
}
// Reproduce ONLY the state selectDocumentVersion leaves behind: a different
// version's lines + bytes, insertedFacts cleared. `acceptedFactsByJob` is hook
// state this never touches -- exactly the seam of the bug.
async function switchToVersionWithout(lines, b64) {
  await act(async () => {
    setMap((cur) => ({
      ...cur,
      [JOB_ID]: { ...cur[JOB_ID], coverLetterResultLines: [...lines], coverLetterDocxB64: b64, coverVersionId: "ver-2", insertedFacts: [] },
    }));
  });
  await flush();
}

// ---------------------------------------------------------------------------
// Fixture precondition.
// ---------------------------------------------------------------------------

describe("N81 substring FP (reachability): fixture precondition", () => {
  it("a short fragment was found in a non-intro engine line, absent from the intro line and from the long fact", () => {
    expect(ENGINE_LINES.length, "engine produced too few lines").toBeGreaterThan(3);
    expect(INTRO_IDX).toBeGreaterThanOrEqual(0);
    expect(ENGINE_LINES.join("\n"), "engine letter already contains the long fact").not.toContain(LONG_FACT);
    expect(SHORT_FRAGMENT, "no usable short fragment could be sourced from a non-intro engine line").toBeTruthy();
    expect(ENGINE_LINES.join("\n"), "the short fragment is not in the regenerated letter -- HEAD's guard would not engage").toContain(SHORT_FRAGMENT);
    expect(String(ENGINE_LINES[INTRO_IDX]), "the short fragment is on the intro target line -- M1 would mask the guard").not.toContain(SHORT_FRAGMENT);
    expect(LONG_FACT, "the short fragment is a substring of the long fact -- would not discriminate").not.toContain(SHORT_FRAGMENT);
  });
});

// ---------------------------------------------------------------------------
// THE BUG -- RED on HEAD.
// ---------------------------------------------------------------------------

describe("N81 substring FP (reachability): edit the suggestion to a coincidental fragment then re-accept into a version missing the recorded fact", () => {
  it("accept -> switch to a version without the fact -> edit suggestion to a colliding fragment -> re-accept inserts it, not 'already present' (RED on HEAD)", async () => {
    await mount();
    await openResearch();

    // Accept #1 at the default 'intro' placement -- the long fact lands, its id
    // + text are stored.
    const r1 = await clickAccept();
    expect(r1?.ok, "the first accept was refused -- test is vacuous").toBe(true);
    expect(count(liveLines().join("\n"), LONG_FACT), "the first accept did not insert the fact once").toBe(1);
    const storedAfterFirst = research.acceptedFactsByJob?.[JOB_ID]?.facts || [];
    expect(storedAfterFirst.some((f) => (f?.text || "").includes(LONG_FACT.slice(0, 20))), "the store never recorded the long fact's text").toBe(true);

    // Switch to a freshly regenerated version (the pristine engine letter, which
    // lacks the long fact). insertedFacts cleared; the store keeps the fact's id
    // and text -- the exact state selectDocumentVersion leaves.
    await switchToVersionWithout(ENGINE_LINES, ENGINE_B64);
    expect(count(liveLines().join("\n"), LONG_FACT), "version 2 still contains the long fact -- switch did not take").toBe(0);

    // The candidate edits the still-open article's suggestion box down to a
    // short fragment that already occurs in this regenerated letter's prose.
    await editSuggestion(SHORT_FRAGMENT);

    const before = liveLines().join("\n");
    const writesBefore = putBodies.length;

    // Re-accept through the real control.
    const r2 = await clickAccept();
    expect(r2?.ok, "the re-accept was refused -- not the silent-absorption case this pins").toBe(true);
    expect(research.companyResearch.acceptError || "", "the re-accept surfaced an error").toBe("");

    // THE CRITERION -- the last hop to the user. On HEAD the guard compares the
    // short INCOMING fragment, finds it in the letter, suppresses, and shows the
    // "already present" lie while the article's content stays missing. After the
    // fix the guard compares the RECORDED (long) text, which is absent, so the
    // letter changes and the "already present" notice is NOT shown.
    expect(
      liveLines().join("\n"),
      "the re-accept left the letter unchanged -- the guard compared the edited incoming fragment and suppressed (N81 Bug 1)",
    ).not.toBe(before);
    expect(research.companyResearch.acceptNotice || "", "the candidate was told the fact is 'already present' though it was never inserted into this version").not.toBe(ALREADY_PRESENT);
    expect(document.body.textContent || "", "the 'already present' lie reached the dialog DOM").not.toContain(ALREADY_PRESENT);
    // Non-vacuity: the re-accept really ran (a store write occurred).
    expect(putBodies.length, "the re-accept never reached the store").toBeGreaterThan(writesBefore);
  });
});

// WHAT THIS FILE CANNOT CATCH. It reproduces selectDocumentVersion's resulting
// STATE via setTailoringMap rather than driving that function (owned by another
// agent this round); the version-switch mechanism itself is covered by
// coverSwitchClearsFacts.rc.test.js. It stubs /api/accepted-facts, so the
// route/RPC/inserted_facts column are not exercised. It pins that the letter
// changes and the "already present" lie is not shown; it does not pin the exact
// prose of the inserted fragment.
