// @vitest-environment jsdom
//
// N89 PART 1 (4b/TDD) -- REACHABILITY + THE ACTIVITY LOG. AC-1 (auto path,
// driven the way a human drives it) and AC-10 (success half).
//
// The owner's report was an ACTIVITY LOG showing fact-auto-insert failing on
// every fresh Gemini letter. So the proof that matters is not "the hook function
// returns ok" (that is coverFactLineInsert.shapeB.rc.test.js) but "opening the
// preview, the fact arrives on its own AND the log records success." This mounts
// the REAL DocumentPreviewMount (real DocumentPreviewDialog + InsertedFactsStrip)
// with the REAL useCompanyResearch/useDocumentPreview hooks, opens the cover
// preview the way page.js does, lets the REAL background research resolve, and
// asserts on the rendered DOM and the recordDecision seam. NOTHING in a test
// body calls autoInsertFactsForJob directly -- opening the preview is the only
// action, exactly as the landed factAutoInsertMessage.rc.test.js requires.
//
// DISCRIMINATOR WIRING: the Probe passes coverLetterFile into useCompanyResearch
// (the P1-1 param). Whether that same value is threaded from PAGE.JS is a
// separate silent gap pinned by page.coverLetterFileWiring.test.js. The preview
// render itself (useDocumentPreview) is given null here, matching the proven
// reference harness; the rendered-preview last hop is covered by
// coverFactLineInsertRender.rc.test.js. What this file adds is that the auto
// EFFECT fires for a Shape-B letter and the log reads "acted", not "failed".
//
// RED ON HEAD: the hook ignores coverLetterFile and refuses no-engine-bytes, so
// (a) no fact arrives (no remove control) and (b) recordDecision logs
// failed/no-engine-bytes -- the exact misleading entry the owner saw.
//
// jsdom notes: MUI Dialog portals into document.body, so DOM queries go through
// `document`; act() serializes async (ordering, not concurrency).

import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from "vitest";
import { createElement, useState, act } from "react";
import { createRoot } from "react-dom/client";

import { useCompanyResearch } from "../hooks/useCompanyResearch.js";
import { useDocumentPreview } from "../hooks/useDocumentPreview.js";
import DocumentPreviewMount from "./DocumentPreviewMount.js";
import { sanitizeStoredFacts } from "@/lib/acceptedFacts/factStore.js";
import { embeddedEngine } from "@/lib/llm/engines/tailor-lite/engine.js";
import { docxFileFromBase64 } from "@/lib/document/docx.js";

// Spy the activity-log seam. AC-10 lives here: a Shape-B success must record
// "acted" + the real count, not "failed" + no-engine-bytes.
const decisions = [];
vi.mock("@/lib/activityLog/appActivityLog.js", () => ({
  recordDecision: (id, outcome, fields) => { decisions.push({ id, outcome, fields }); },
}));

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const JOB_ID = "job-1";
const JOB = { id: JOB_ID, title: "Staff Engineer", company: "Acme", description: "React, Node, telemetry." };
const VALID_ARTICLE = {
  title: "Acme opens a Dublin telemetry lab",
  url: "https://news.example.com/acme/dublin-lab",
  source: "news.example.com",
  summary: "Acme opened a telemetry lab in Dublin.",
  suggestion: "I was glad to see Acme opened a Dublin telemetry lab, part of what draws me to this role.",
};

let ENGINE_B64 = "";
let ENGINE_LINES = [];
let TEMPLATE_FILE = null;
let store = { facts: [], removed: [], revision: null };
let researchArticles = [];
let probe = null;
let container = null;
let root = null;
let coverFileForHook = null;

beforeAll(async () => {
  const cl = await embeddedEngine.tailorCoverLetter({
    jobPosting: "Staff Engineer at Acme. React, Node, telemetry, accessibility.",
    jobTitle: "Staff Engineer",
    companyName: "Acme",
  });
  ENGINE_B64 = cl.docxB64;
  ENGINE_LINES = cl.resultLines;
});

function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}
function makeSupabase() {
  return { storage: { from: () => ({
    download: async () => ({ data: null, error: { message: "not found" } }),
    upload: async () => ({ error: null }),
  }) } };
}
// Fresh Gemini letter: cover TEXT, no bytes, no path (Shape B when a template
// File is present in the hook).
function geminiEntry(overrides = {}) {
  return {
    status: "done", result: "", resultLines: [], docxB64: "", docxPath: "",
    coverLetterResultLines: [...ENGINE_LINES], coverLetterDocxB64: "", coverLetterDocxPath: "", coverVersionId: "ver-1",
    ...overrides,
  };
}

function Probe({ initialMap }) {
  const [tailoringMap, setTailoringMap] = useState(initialMap);
  const [previewReloadKey, setPreviewReloadKey] = useState(0);
  const research = useCompanyResearch({
    tailoringMap, setTailoringMap, setPreviewReloadKey,
    supabase: makeSupabase(), currentUser: { id: "user-1" },
    coverLetterFile: coverFileForHook, // the P1-1 discriminator under test
  });
  const preview = useDocumentPreview({
    tailoringMap, setTailoringMap,
    updateTailoringJob: () => {}, resumeFile: null, coverLetterFile: null,
    additionalContext: "", aggressiveness: 50, contextFiles: [], downloadDocxFiles: {},
    startBackgroundResearch: research.startBackgroundResearch, setPreviewReloadKey,
    onDocumentEdited: () => {}, currentUser: null, onCheckDuplicate: () => {},
  });
  probe = { tailoringMap, research, preview };
  return createElement(DocumentPreviewMount, {
    preview, tailoringMap, research, chat: { askAiAbout: () => {} },
    tailorEngine: "embedded", previewReloadKey, scrapePreviewPosting: null,
    currentUser: null, resumeFile: null, coverLetterFile: coverFileForHook,
  });
}

beforeEach(() => {
  store = { facts: [], removed: [], revision: null };
  researchArticles = [];
  probe = null;
  decisions.length = 0;
  coverFileForHook = null;
  TEMPLATE_FILE = docxFileFromBase64(ENGINE_B64);
  globalThis.fetch = vi.fn(async (url, init = {}) => {
    const method = (init.method || "GET").toUpperCase();
    const u = String(url);
    if (u.includes("/api/company-research")) return json({ articles: researchArticles, warnings: [] });
    if (u.includes("/api/accepted-facts")) {
      if (method === "GET") return json({ facts: store.facts, removed: store.removed, revision: store.revision });
      const body = JSON.parse(init.body);
      store = { facts: sanitizeStoredFacts(body.facts), removed: body.declinedUrls || [], revision: (store.revision ?? 0) + 1 };
      return json({ facts: store.facts, removed: store.removed, revision: store.revision });
    }
    return json({});
  });
});

afterEach(async () => {
  if (root) await act(async () => root.unmount());
  if (container) container.remove();
  root = null; container = null;
  delete globalThis.fetch;
});

async function tick() { await act(async () => { await new Promise((r) => setTimeout(r, 10)); }); }
async function flushMicro(times = 6) { for (let i = 0; i < times; i += 1) await act(async () => { await Promise.resolve(); }); }
async function waitFor(pred, maxTicks = 80) { for (let i = 0; i < maxTicks; i += 1) { if (pred()) return true; await tick(); } return pred(); }
async function mount(initialMap) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => { root.render(createElement(Probe, { initialMap })); });
  await flushMicro();
}
async function openCoverPreview(job = JOB) {
  await act(async () => { probe.preview.openResumePreview(job, { tab: "cover" }); });
  await flushMicro();
}
function removeButtons() { return [...document.querySelectorAll('[aria-label="Remove this fact"]')]; }
function autoInsertDecisions() { return decisions.filter((d) => d.id === "fact-auto-insert"); }

describe("AC-1 reachability: opening a fresh Gemini letter's preview auto-inserts the fact", () => {
  it("the fact ARRIVES on its own (a removal control appears) -- no direct call", async () => {
    coverFileForHook = TEMPLATE_FILE;
    researchArticles = [VALID_ARTICLE];
    await mount({ [JOB_ID]: geminiEntry() });
    await openCoverPreview();

    // RED on HEAD: auto-insert refuses no-engine-bytes, so no fact, no control.
    const arrived = await waitFor(() => removeButtons().length === 1);
    expect(arrived, "the researched fact never arrived on a fresh Gemini letter (RED on HEAD)").toBe(true);
    expect(document.body.textContent || "").toContain("Added from research");
    // The manual research dialog was never opened -- the arrival is the AUTO path.
    expect(probe.research.companyResearch.open, "the research dialog was opened -- the auto-path claim would be vacuous").toBe(false);
  });
});

describe("AC-10 (success half): the activity log records 'acted', not the misleading failure", () => {
  it("a Shape-B success records fact-auto-insert acted + real count", async () => {
    coverFileForHook = TEMPLATE_FILE;
    researchArticles = [VALID_ARTICLE];
    await mount({ [JOB_ID]: geminiEntry() });
    await openCoverPreview();

    await waitFor(() => autoInsertDecisions().length > 0);
    const rec = autoInsertDecisions().at(-1);
    expect(rec, "no fact-auto-insert decision was recorded").toBeTruthy();
    // RED on HEAD: on HEAD this is "failed" with code "no-engine-bytes".
    expect(rec.outcome, `activity log recorded '${rec.outcome}' (${rec.fields?.code || ""}) instead of acted`).toBe("acted");
    expect(rec.fields?.count).toBeGreaterThanOrEqual(1);
  });

  it("CONTROL: with NO template File (Shape C), the log still records failed/no-engine-bytes (boundary unchanged)", async () => {
    coverFileForHook = null; // Shape C
    researchArticles = [VALID_ARTICLE];
    await mount({ [JOB_ID]: geminiEntry() });
    await openCoverPreview();

    await waitFor(() => autoInsertDecisions().length > 0);
    const rec = autoInsertDecisions().at(-1);
    expect(rec.outcome, "a template-less letter must still read as failed no-engine-bytes").toBe("failed");
    expect(rec.fields?.code).toBe("no-engine-bytes");
    expect(removeButtons().length, "a fact was inserted with no template File present").toBe(0);
  });
});
