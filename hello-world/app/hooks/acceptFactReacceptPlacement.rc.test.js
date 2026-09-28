// @vitest-environment jsdom
//
// N81 MANUAL PATH, reachability. The manual accept (`acceptFacts`,
// useCompanyResearch.js:352) duplicates a fact when the SAME article is
// re-accepted at a CHANGED placement: the second copy resolves to a different
// paragraph than the first, so `planCoverFacts`' text-keyed M1 dedupe never
// sees it. This file proves a REAL USER reaches that duplicate, driving the
// really-mounted CompanyResearchDialog over the real useCompanyResearch hook --
// never `acceptFacts(...)` directly for the behavioural legs (brief rule 2).
//
// THE REACHABLE SEQUENCE the card names ("already reachable ... via the per-card
// Select override"):
//   1. Open research; accept the article at the default placement ('intro').
//      The fact lands on the intro paragraph.
//   2. Go to the "arrange" step and change that article's placement Select to
//      "Current role" (a real onChange on the real MUI Select) -- exactly what a
//      candidate does when they decide the fact belongs elsewhere.
//   3. Return to "pick" and click "Insert into cover letter" again.
//   4. On HEAD the fact lands a SECOND time, on the current-role line -- a
//      duplicated claim in the letter AND its downloaded bytes.
//
// (The card's other reachable trigger -- reopening research after changing the
// saved DEFAULT placement -- exercises the SAME seam; it depends on the MUI
// Dialog unmounting on close, which jsdom does not do deterministically, so the
// per-card Select override is used here as the deterministic driver. The
// seam-level file pins the property under both callers' argument shapes.)
//
// jsdom note: MUI Dialog and Select menu portal to document.body.
// Model harness: app/hooks/acceptMultiCard.test.js.

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

// One article; its suggestion is a full sentence that appears nowhere in the
// engine letter (never a reconstructing fixture).
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
let putBodies = [];
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
  putBodies = [];
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
  expect(button.disabled).toBe(false);
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
// Drive the real MUI Select in the arrange step: open the listbox, click the
// named option. This is a real placement change, not a setter call. MUI's
// non-native Select opens on mousedown (not click) in jsdom, so dispatch that.
async function openSelect() {
  const trigger = document.querySelector('[role="combobox"]');
  expect(trigger, "no placement Select rendered in the arrange step").toBeTruthy();
  await act(async () => {
    trigger.dispatchEvent(new window.MouseEvent("mousedown", { bubbles: true, button: 0 }));
  });
  await flush();
  return trigger;
}
function optionLabels() {
  return [...document.querySelectorAll('[role="option"]')].map((o) => (o.textContent || "").trim());
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
async function docxText(b64) {
  if (!b64) return "";
  const { default: JSZip } = await import("jszip");
  const zip = await JSZip.loadAsync(Buffer.from(b64, "base64"));
  const xml = await zip.file("word/document.xml").async("string");
  return xml.replace(/<[^>]+>/g, "");
}

// ---------------------------------------------------------------------------
// Fixture precondition -- the wrong-reason trap. If 'current' resolved to the
// SAME line as 'intro' (anchor absent), both accepts would land there and the
// existing text dedupe would hide the defect: the test would pass on HEAD for
// the wrong reason. Assert the anchor is present on a DISTINCT line.
// ---------------------------------------------------------------------------

describe("N81 manual path: fixture precondition", () => {
  it("the engine letter carries the 'current role' anchor on a line distinct from intro, and neither carries the fact", () => {
    expect(ENGINE_LINES.length).toBeGreaterThan(3);
    expect(CURRENT_IDX, "no 'in my current role' line -- 'current' would fall back to intro and mask the defect").toBeGreaterThanOrEqual(0);
    expect(INTRO_IDX).toBeGreaterThanOrEqual(0);
    expect(CURRENT_IDX, "'current' and 'intro' coincide -- cannot discriminate").not.toBe(INTRO_IDX);
    expect(ENGINE_LINES.join("\n"), "fixture already contains the fact").not.toContain(FACT);
  });

  it("CANARY: the arrange step exposes a working placement Select whose options include 'Current role'", async () => {
    await mount();
    await openResearch();
    await clickButton("Next: arrange (1)");
    await openSelect();
    const labels = optionLabels();
    expect(labels, "the placement menu has no 'Current role' option").toContain("Current role");
    expect(labels, "the placement menu has no 'Opening paragraph' option").toContain("Opening paragraph");
  });
});

// ---------------------------------------------------------------------------
// The defect -- RED on HEAD.
// ---------------------------------------------------------------------------

describe("N81 manual path: re-accepting the same article at a changed placement does not duplicate the fact", () => {
  it("intro then current: the fact appears exactly once in the letter lines AND the served docx (RED on HEAD)", async () => {
    await mount();
    await openResearch();

    // Accept #1 -- default placement ('intro').
    await clickAccept();
    expect(research.companyResearch.acceptError || "", "the first accept was refused -- test is vacuous").toBe("");
    expect(count(liveLines().join("\n"), FACT), "the first accept did not insert the fact once").toBe(1);
    expect(String(liveLines()[INTRO_IDX] ?? ""), "the first accept did not land on the intro line").toContain(FACT);
    const writesAfterFirst = putBodies.length;

    // Change the article's placement to 'current' in the arrange step, then
    // return to pick and accept again.
    await clickButton("Next: arrange (1)");
    await setPlacement("Current role");
    await clickButton("Back");
    await clickAccept();
    expect(research.companyResearch.acceptError || "", "the second accept was refused").toBe("");

    // THE CRITERION: still exactly once, in the lines and in the downloaded bytes.
    const text = liveLines().join("\n");
    expect(count(text, FACT), "the fact was DUPLICATED by a re-accept at a changed placement (N81)").toBe(1);
    const served = await docxText(currentMap[JOB_ID].coverLetterDocxB64);
    expect(count(served, FACT), "the downloaded docx carries the fact twice (N81)").toBe(1);

    // Non-vacuity: the second accept really reached the store (the placement
    // change was applied and a second write occurred), so "once" is not the
    // hollow result of a click that never fired.
    expect(putBodies.length, "the second accept never reached the store").toBeGreaterThan(writesAfterFirst);
  });
});

// WHAT THIS FILE CANNOT CATCH. It drives the client and the real docx splice
// but stubs /api/accepted-facts, so the route, RPC and inserted_facts column
// are not exercised. It proves a duplicate does not appear; it cannot prove the
// resulting prose reads well or that the fact MOVED to the new placement (the
// N81 fix is dedupe, not relocation -- out of this chunk's scope). The docx
// text is read after tag-stripping, so a fact split across runs by a future
// serializer change could be miscounted -- the engine writes each paragraph as
// one run today.
