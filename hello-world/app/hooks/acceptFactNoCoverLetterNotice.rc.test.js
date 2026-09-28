// @vitest-environment jsdom
//
// N81 CLOSING ROUND, BUG 2 (fresh-verifier NOT-SHIP on 5e96be2), REACHABILITY.
//
// THE BUG. `acceptFacts` (useCompanyResearch.js:459-461) sets
//   } else if (!coverChanged) { notice = ALREADY_PRESENT_NOTICE; }
// which fires whenever nothing changed -- INCLUDING when the job has NO tailored
// cover letter yet (coverLetterResultLines empty, so planCoverFacts always
// no-ops). The candidate is then told "That fact is already in your cover
// letter" when there is no cover letter at all. The research dialog is reachable
// for such a job: StatusBar's "Research company" item is gated only on the job
// having a company name (StatusBar.js), never on a tailored cover letter
// existing.
//
// THE SIBLING AUTO PATH gets this right (useCompanyResearch.js:702-703):
//   if (!hasCoverLetter) return { ok: false, reason: "No cover letter to insert
//   into.", severity: "failure", code: "no-cover-letter" };
//
// THE FIX DIRECTION THIS FILE PINS. The manual path must distinguish "no cover
// letter exists" from "genuinely already present", giving the no-cover-letter
// case its own honest message that mirrors the auto path's wording and severity
// -- a failure/absence, not an info "already present". So:
//   * the no-cover-letter accept must NOT show ALREADY_PRESENT_NOTICE and must
//     surface an honest "no cover letter" message (RED on HEAD);
//   * it must be a FAILURE outcome, not a silent ok:true info (RED on HEAD);
//   * the genuine-dedupe case (a cover letter that already carries the fact)
//     must STILL get the "already present" info notice (control, green on HEAD
//     and after the fix, so the fix does not over-fire).
//
// This file drives the really-mounted CompanyResearchDialog over the real
// useCompanyResearch hook and clicks the real "Insert into cover letter"
// control -- never acceptFacts(...) directly for the behavioural leg.
//
// jsdom note: MUI Dialog and Select menu portal to document.body.
// Harness mirrors acceptFactDedupeNotice.rc.test.js.

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

let ENGINE_B64 = "";
let ENGINE_LINES = [];

beforeAll(async () => {
  const cl = await embeddedEngine.tailorCoverLetter({
    jobPosting: "Staff Engineer at Acme. React, Node, telemetry, accessibility.",
    jobTitle: "Staff Engineer",
    companyName: "Acme",
  });
  ENGINE_B64 = cl.docxB64;
  ENGINE_LINES = cl.resultLines;
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

async function mount(initialMap) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root.render(createElement(Probe, { initialMap }));
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
function liveLines() {
  return currentMap[JOB_ID]?.coverLetterResultLines || [];
}
function count(hay, needle) {
  return String(hay).split(needle).length - 1;
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

// ---------------------------------------------------------------------------
// THE BUG -- RED on HEAD. A job with NO cover letter yet.
// ---------------------------------------------------------------------------

describe("N81 no-cover-letter notice: accepting a fact for a job with no cover letter", () => {
  it("no cover letter exists -> the honest 'no cover letter' message is shown, NOT the 'already present' lie (RED on HEAD)", async () => {
    // status absent, no coverLetterResultLines/coverLetterDocxB64 at all -- a
    // job the candidate has not yet tailored a cover letter for.
    await mount({ [JOB_ID]: {} });
    await openResearch();

    const result = await clickAccept();

    // Preconditions for a non-vacuous verdict: the letter genuinely has no lines,
    // so this is the no-cover-letter branch (not a real dedupe).
    expect(liveLines().length, "the fixture unexpectedly has cover-letter lines -- not the no-cover-letter case").toBe(0);

    // THE CRITERION -- the last hop to the user. On HEAD acceptNotice is the
    // "already present" lie. After the fix it is an honest no-cover-letter
    // message mirroring the auto path's "No cover letter to insert into."
    expect(research.companyResearch.acceptNotice || "", "a job with NO cover letter was told the fact is 'already in your cover letter' (N81 Bug 2)").not.toBe(ALREADY_PRESENT);
    expect(document.body.textContent || "", "the 'already present' lie reached the dialog DOM for a job with no cover letter").not.toContain(ALREADY_PRESENT);
    const shown = document.body.textContent || "";
    expect(shown, "no honest 'no cover letter' message was shown to the candidate (mirror the auto path's 'No cover letter to insert into.')").toMatch(/no cover letter/i);
    // The result carries a machine-readable reason too (mirrors the auto path).
    expect(String(result?.reason || shown), "the no-cover-letter outcome carries no honest reason").toMatch(/no cover letter/i);
  });

  it("no cover letter exists -> the accept is a FAILURE outcome, not a silent ok:true info (RED on HEAD)", async () => {
    // Mirrors the auto path's severity: no cover letter is a failure/absence,
    // never the info "nothing new" outcome a genuine dedupe is.
    await mount({ [JOB_ID]: {} });
    await openResearch();
    const result = await clickAccept();
    expect(result?.ok, "accepting a fact with no cover letter resolved ok:true -- it must be a failure/absence, mirroring the auto path (N81 Bug 2)").toBe(false);
  });
});

// ---------------------------------------------------------------------------
// CONTROL -- GREEN on HEAD and after the fix. A genuine dedupe (a cover letter
// that already carries the fact) must still get the "already present" info
// notice. If the fix over-fires and routes genuine dedupes through the
// no-cover-letter path, this leg goes red.
// ---------------------------------------------------------------------------

describe("N81 no-cover-letter notice: a genuine dedupe still says 'already present'", () => {
  it("CONTROL: a cover letter that already carries the fact -> re-accept shows the 'already present' info notice, ok:true", async () => {
    await mount({ [JOB_ID]: entryEngine() }); // engine cover letter present
    await openResearch();

    // Accept #1: the fact lands.
    const r1 = await clickAccept();
    expect(r1?.ok, "the first accept was refused -- control is vacuous").toBe(true);
    expect(count(liveLines().join("\n"), FACT), "the first accept did not insert the fact once").toBe(1);

    // Re-accept the same article, unchanged -- a genuine duplicate the guard
    // absorbs (coverChanged=false) WITH a cover letter present.
    const r2 = await clickAccept();
    expect(r2?.ok, "the genuine-dedupe re-accept was refused").toBe(true);
    expect(count(liveLines().join("\n"), FACT), "the re-accept duplicated the fact instead of deduping").toBe(1);
    expect(research.companyResearch.acceptError || "", "a genuine dedupe surfaced as an ERROR").toBe("");
    expect(research.companyResearch.acceptNotice || "", "a genuine dedupe lost its 'already present' info notice").toBe(ALREADY_PRESENT);
    expect(document.body.textContent || "", "the 'already present' info notice was not rendered for a genuine dedupe").toContain(ALREADY_PRESENT);
  });
});

// WHAT THIS FILE CANNOT CATCH. It stubs /api/accepted-facts, so the route/RPC
// are not exercised. It pins that the no-cover-letter case is an honest failure
// and not the "already present" lie, and that a genuine dedupe keeps the info
// notice; it does not pin the exact wording beyond "no cover letter", nor
// whether the message is announced to assistive tech (the manual-path notice
// Box carries no role=status -- a separate, self-disclosed out-of-scope gap).
