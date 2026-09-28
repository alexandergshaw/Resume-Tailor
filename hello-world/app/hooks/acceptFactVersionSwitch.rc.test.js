// @vitest-environment jsdom
//
// N81 REGRESSION (fresh-verifier NOT-SHIP on a36d6ae, Finding A), REACHABILITY.
// The regression is proven at the pure seam in
// lib/acceptedFacts/factInsertion.versionSwitchReaccept.test.js. This file
// proves a REAL USER reaches it by driving the really-mounted
// CompanyResearchDialog over the real useCompanyResearch hook and clicking the
// real "Insert into cover letter" control -- never calling acceptFacts(...)
// directly for the behavioural leg (brief rule 2).
//
// THE REACHABLE SEQUENCE:
//   1. Open research; accept the article (fact lands on the intro paragraph, its
//      id is written to the job-level accepted-facts store).
//   2. The candidate switches to a freshly regenerated cover-letter VERSION that
//      does not contain the fact. `selectDocumentVersion`
//      (app/hooks/useDocumentPreview.js) swaps `coverLetterResultLines` and
//      clears `entry.insertedFacts` but NEVER touches `acceptedFactsByJob`, so
//      the fact's id stays in the store. That version-switch MECHANISM lives in
//      useDocumentPreview.js (owned by another agent this round, out of bounds
//      here), so its RESULTING STATE is reproduced with the harness's own
//      setTailoringMap -- the same way autoInsertReacceptPlacement.test.js uses
//      setDefault() for a precondition. The behaviour under test (the accept)
//      is still driven through the real button.
//   3. The candidate re-accepts the article because the fact is visibly missing
//      from the version on screen.
//   4. On HEAD the id guard silently refuses (the id is still in the store), so
//      the fact never lands and is now permanently unreachable for this letter.
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

function introIndex(lines) {
  const i = lines.findIndex((l, idx) => idx > 0 && String(l).trim().length > 40);
  return i >= 0 ? i : lines.length > 1 ? 1 : 0;
}

let ENGINE_B64 = "";
let ENGINE_LINES = [];
let INTRO_IDX = -1;

beforeAll(async () => {
  const cl = await embeddedEngine.tailorCoverLetter({
    jobPosting: "Staff Engineer at Acme. React, Node, telemetry, accessibility.",
    jobTitle: "Staff Engineer",
    companyName: "Acme",
  });
  ENGINE_B64 = cl.docxB64;
  ENGINE_LINES = cl.resultLines;
  INTRO_IDX = introIndex(ENGINE_LINES);
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
  await act(async () => {
    button.click();
  });
  expect(acceptPromise, "the control was clicked but no accept started").toBeTruthy();
  await act(async () => {
    await acceptPromise;
  });
  await flush(2);
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
// Fixture precondition -- the engine letter never carries the fact, so any
// occurrence is an insertion (never a reconstructing fixture).
// ---------------------------------------------------------------------------

describe("N81 version switch: fixture precondition", () => {
  it("the engine letter has an intro line and does not carry the fact", () => {
    expect(ENGINE_LINES.length).toBeGreaterThan(3);
    expect(INTRO_IDX).toBeGreaterThanOrEqual(0);
    expect(ENGINE_LINES.join("\n"), "fixture already contains the fact").not.toContain(FACT);
  });
});

// ---------------------------------------------------------------------------
// The regression -- RED on HEAD.
// ---------------------------------------------------------------------------

describe("N81 version switch: re-accepting a fact that is missing from the current version inserts it", () => {
  it("accept -> switch to a version without the fact -> re-accept lands it once (RED on HEAD)", async () => {
    await mount();
    await openResearch();

    // Accept #1 against version 1 -- the fact lands and its id is stored.
    await clickAccept();
    expect(research.companyResearch.acceptError || "", "the first accept was refused -- test is vacuous").toBe("");
    expect(count(liveLines().join("\n"), FACT), "the first accept did not insert the fact once").toBe(1);
    const storedAfterFirst = research.acceptedFactsByJob?.[JOB_ID]?.facts || [];
    expect(storedAfterFirst.length, "the accepted-facts store never recorded the fact").toBeGreaterThan(0);

    // The candidate switches to a freshly-regenerated version (reuse the
    // pristine engine letter as version 2). insertedFacts cleared; the store
    // keeps the fact's id -- the exact state selectDocumentVersion leaves.
    await switchToVersionWithout(ENGINE_LINES, ENGINE_B64);

    // Preconditions for a non-vacuous RED: the fact is genuinely gone from the
    // version on screen, AND its id is genuinely still in the store the guard
    // reads (so HEAD suppresses for the reason under test, not for an empty
    // record).
    expect(count(liveLines().join("\n"), FACT), "version 2 still contains the fact -- switch did not take").toBe(0);
    const storedAfterSwitch = research.acceptedFactsByJob?.[JOB_ID]?.facts || [];
    expect(storedAfterSwitch.length, "the store lost the fact on the version switch -- guard input is empty").toBeGreaterThan(0);
    const writesBefore = putBodies.length;

    // The candidate re-accepts because the fact is visibly missing.
    await clickAccept();
    expect(research.companyResearch.acceptError || "", "the re-accept was refused").toBe("");

    // THE CRITERION. On HEAD the guard sees the id already in the store and
    // suppresses, so the fact never lands (0). After the fix it lands once.
    expect(
      count(liveLines().join("\n"), FACT),
      "the fact stayed missing from a version that never contained it -- the id guard over-fired (N81 regression, Finding A)",
    ).toBe(1);
    // Non-vacuity: the re-accept really ran (a store write occurred).
    expect(putBodies.length, "the re-accept never reached the store").toBeGreaterThan(writesBefore);
  });
});

// WHAT THIS FILE CANNOT CATCH. It reproduces selectDocumentVersion's resulting
// STATE via setTailoringMap rather than driving that function (its file is owned
// by another agent this round); the version-switch mechanism itself is covered
// by coverSwitchClearsFacts.rc.test.js. It stubs /api/accepted-facts, so the
// route/RPC/inserted_facts column are not exercised. It proves the fact returns;
// it cannot prove the resulting prose reads well.
