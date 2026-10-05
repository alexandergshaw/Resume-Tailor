// @vitest-environment jsdom
//
// N122 (the undo sibling of N94 part 2) -- the ACTIVITY LOG tells the truth about
// an UNDO whose save is refused. Driven the way a candidate drives it: mount the
// REAL DocumentPreviewMount, CLICK the real Smooth, Apply and Undo controls. The
// ledger is observed through the recordDecision seam (a spy over the real module,
// the coverFactSmoothLedger.rc.test.js idiom) -- never through the handlers'
// internals.
//
// An Undo whose save is REFUSED (the real PUT answers 409) used to log
// fact-smooth "acted" / "undo" regardless -- a success claim on a failure, while
// the letter still carried the smoothed text. It must log the existing "failed"
// outcome with the existing "save-failed" code, and the user must still be told
// the undo did not land.
//
// Vocabulary is the ledger's own; no new outcome or code is minted.
//
// jsdom note: MUI Dialog portals into document.body -> queries go through
// document.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createElement, useState, act } from "react";
import { createRoot } from "react-dom/client";

vi.mock("@/lib/activityLog/appActivityLog.js", async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, recordDecision: vi.fn() };
});

import { recordDecision } from "@/lib/activityLog/appActivityLog.js";
import { useCompanyResearch } from "@/app/hooks/useCompanyResearch.js";
import { useDocumentPreview } from "@/app/hooks/useDocumentPreview.js";
import DocumentPreviewMount from "@/app/components/DocumentPreviewMount.js";
import { sanitizeStoredFacts } from "@/lib/acceptedFacts/factStore.js";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const JOB_ID = "job-1";
const JOB = { id: JOB_ID, title: "Staff Engineer", company: "Acme", description: "React, Node, telemetry." };

const FACT_A = "Acme just opened a Dublin telemetry lab.";
const BODY_A = `I led the platform team. ${FACT_A} We shipped quickly.`;
const SMOOTHED_A = {
  status: "ok",
  before: "Leading the platform team,",
  fact: "we saw Acme just open a Dublin telemetry lab,",
  after: "which let us ship quickly.",
};
const FRAGMENT_A = "we saw Acme just open a Dublin telemetry lab";
const STALE_REASON = "The letter's saved copy is out of date.";

function seededEntry() {
  const lines = ["Dear Hiring Manager,", BODY_A, "Sincerely,", "Jordan Rivera"];
  return {
    status: "done",
    result: "",
    resultLines: [],
    docxB64: "",
    docxPath: "",
    coverLetterResultLines: lines,
    coverLetterDocxB64: "",
    coverVersionId: "ver-1",
    insertedFacts: [
      { id: "art-a", text: FACT_A, lineIndex: 1, offset: lines[1].indexOf(FACT_A), url: "https://news.example.com/art-a", title: "Source for art-a" },
    ],
  };
}

let store;
let putBodies;
let probe;
let container = null;
let root = null;
// When true the next accepted-facts PUT answers 409 (a stale-revision refusal).
let putShouldFail = false;

function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
}

function Probe() {
  const [tailoringMap, setTailoringMap] = useState({ [JOB_ID]: seededEntry() });
  const [previewReloadKey, setPreviewReloadKey] = useState(0);
  const research = useCompanyResearch({ tailoringMap, setTailoringMap, setPreviewReloadKey });
  const preview = useDocumentPreview({
    tailoringMap,
    setTailoringMap,
    updateTailoringJob: () => {},
    resumeFile: null,
    coverLetterFile: null,
    additionalContext: "",
    aggressiveness: 50,
    contextFiles: [],
    downloadDocxFiles: {},
    startBackgroundResearch: research.startBackgroundResearch,
    setPreviewReloadKey,
    onDocumentEdited: () => {},
    currentUser: null,
    onCheckDuplicate: () => {},
  });
  probe = { tailoringMap, setTailoringMap, research, preview };
  return createElement(DocumentPreviewMount, {
    preview,
    tailoringMap,
    research,
    chat: { askAiAbout: () => {} },
    tailorEngine: "gemini",
    previewReloadKey,
    scrapePreviewPosting: null,
    currentUser: null,
    resumeFile: null,
    coverLetterFile: null,
  });
}

beforeEach(() => {
  recordDecision.mockClear();
  store = { facts: [], removed: [], revision: null };
  putBodies = [];
  probe = null;
  putShouldFail = false;
  globalThis.fetch = vi.fn(async (url, init = {}) => {
    const method = (init.method || "GET").toUpperCase();
    const u = String(url);
    if (u.includes("/api/cover-fact-smooth")) return json({ smoothed: SMOOTHED_A });
    if (u.includes("/api/company-research")) return json({ articles: [], warnings: [] });
    if (u.includes("/api/accepted-facts")) {
      if (method === "GET") return json({ facts: store.facts, removed: store.removed, revision: store.revision });
      const body = JSON.parse(init.body);
      putBodies.push(body);
      if (putShouldFail) return json({ error: STALE_REASON }, 409);
      store = {
        facts: sanitizeStoredFacts(body.facts),
        removed: Array.isArray(body.declinedUrls) ? body.declinedUrls : [],
        revision: (store.revision ?? 0) + 1,
      };
      return json({ facts: store.facts, removed: store.removed, revision: store.revision, versionSaved: !!body.coverVersion });
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

async function flush(times = 8) {
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
    root.render(createElement(Probe));
  });
  await flush();
  await act(async () => {
    probe.preview.openResumePreview(JOB, { tab: "cover" });
  });
  await flush();
}

const smoothButtons = () => [...document.querySelectorAll('[aria-label="Smooth the transition into this fact"]')];
const applyButtons = () => [...document.querySelectorAll('[aria-label="Apply the smoothed version"]')];
const undoButtons = () => [...document.querySelectorAll('[aria-label="Undo the smoothing"]')];
const alerts = () => [...document.querySelectorAll('[role="alert"]')].map((n) => n.textContent || "");
const letter = () => (probe.tailoringMap[JOB_ID]?.coverLetterResultLines || []).join("\n");

async function clickAndSettle(getButtons, predicate) {
  expect(getButtons().length, "the control is not on screen -- it was never wired").toBeGreaterThan(0);
  await act(async () => {
    getButtons()[0].click();
  });
  for (let n = 0; n < 30; n += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
    if (predicate()) break;
  }
  await flush();
}

// Smooth the fact and Apply it (a landed save) -- the state an undo reverts.
async function smoothAndApply() {
  await clickAndSettle(smoothButtons, () => applyButtons().length > 0);
  await clickAndSettle(applyButtons, () => letter().includes(FRAGMENT_A));
  expect(letter(), "the apply did not land -- every test below would be vacuous").toContain(FRAGMENT_A);
  expect(undoButtons().length, "no Undo control after a landed apply -- every test below would be vacuous").toBe(1);
}

const smoothCalls = (outcome, code) =>
  recordDecision.mock.calls.filter(
    (c) => c[0] === "fact-smooth" && (outcome ? c[1] === outcome : true) && (code ? c[2]?.code === code : true),
  );

describe("an Undo whose save is refused is logged as failed, never acted (N122)", () => {
  it("CONTROL: an Undo that lands is logged 'acted' / 'undo' exactly once", async () => {
    await mount();
    const original = letter();
    await smoothAndApply();
    await clickAndSettle(undoButtons, () => letter() === original);

    expect(letter(), "the undo did not land -- the control is vacuous").toBe(original);
    expect(smoothCalls("acted", "undo").length, "a landed undo must log exactly one 'acted' / 'undo'").toBe(1);
    expect(smoothCalls("failed").length).toBe(0);
  });

  it("a 409 on the undo save logs 'failed' / 'save-failed' and NO 'acted' / 'undo'; the letter stays smoothed", async () => {
    await mount();
    await smoothAndApply();
    const smoothedLetter = letter();
    putShouldFail = true;
    const putsBefore = putBodies.length;
    await clickAndSettle(undoButtons, () => undoButtons().length === 0);

    expect(putBodies.length, "the undo save was never attempted -- the failure was not simulated").toBeGreaterThan(putsBefore);
    expect(letter(), "a refused undo save changed the letter").toBe(smoothedLetter);
    expect(smoothCalls("acted", "undo").length, "the activity log claims the smoothing was undone although the save was refused").toBe(0);
    const failed = smoothCalls("failed", "save-failed");
    expect(failed.length, "the refused undo save left no 'failed' / 'save-failed' record").toBe(1);
    // the apply that preceded it is still logged as the one acted record.
    expect(smoothCalls("acted", "smoothed").length, "the earlier landed apply must still be logged").toBe(1);
  });

  it("a 409 on the undo save still tells the user the undo did not land", async () => {
    await mount();
    await smoothAndApply();
    putShouldFail = true;
    await clickAndSettle(undoButtons, () => alerts().some((text) => text.includes(STALE_REASON)));

    expect(
      alerts().some((text) => text.includes(STALE_REASON)),
      "a refused undo save surfaced no error to the user",
    ).toBe(true);
  });

  it("the failure record is text-free: neither the 409 reason nor the letter text reaches the log (N77)", async () => {
    await mount();
    await smoothAndApply();
    putShouldFail = true;
    await clickAndSettle(undoButtons, () => smoothCalls("failed", "save-failed").length > 0);

    const wire = JSON.stringify(smoothCalls().map((c) => c[2] || {}));
    expect(smoothCalls("failed", "save-failed").length, "no failure record -- the leak check below is vacuous").toBe(1);
    expect(wire, "the persist's reason text leaked into the shared log").not.toContain("out of date");
    expect(wire, "the letter text leaked into the shared log").not.toContain("Dublin");
  });
});
