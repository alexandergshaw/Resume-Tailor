// @vitest-environment jsdom
//
// N92 Wave 1 (Control A) -- the OWED A9 sub-case the 4b TDD hand-off flagged
// as un-falsified (N92.tests.r1.md "What I could NOT verify / carried"):
// bytes ARE present, but `applyCoverDocxEdits` REFUSES the splice (a stale
// plan against the engine's own docx). `moveInsertedFact.rc.test.js` already
// covers the NO-BYTES case (hasCoverBytes=false); this file covers the
// DIFFERENT case where bytes exist but the splice itself is refused. Per the
// design (plan W1-S3 silent row A) the move must still proceed on the
// letter's TEXT and drop `coverDocxPath` to `null` so the download rebuilds
// from the moved lines -- never shipping the OLD bytes, which still carry
// the fact's pre-move position.
//
// A `vi.mock` of lib/acceptedFacts/factDocx.js is what makes this case
// reachable under test: the real splice would normally succeed against a
// freshly engine-produced docx, so the refusal has to be forced.

import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from "vitest";
import { createElement, useState, act } from "react";
import { createRoot } from "react-dom/client";

import { useCompanyResearch } from "./useCompanyResearch.js";
import { useDocumentPreview } from "./useDocumentPreview.js";
import DocumentPreviewMount from "@/app/components/DocumentPreviewMount.js";
import { sanitizeStoredFacts } from "@/lib/acceptedFacts/factStore.js";
import { embeddedEngine } from "@/lib/llm/engines/tailor-lite/engine.js";

// The forced refusal: the FIRST splice (the accept path putting the fact
// into the letter) runs for REAL, via the actual implementation, so the move
// under test starts from genuinely present bytes -- otherwise this would
// only re-prove the already-covered NO-BYTES case (moveInsertedFact.rc.test.js).
// Every splice AFTER that (the move itself) is forced to refuse with a
// "stale-plan" reason, the same shape a real docx/lines desync would return
// (factDocx.js:33-34), echoing back the bytes it was given unchanged -- the
// real function's own contract on any non-success path.
vi.mock("@/lib/acceptedFacts/factDocx.js", async (importOriginal) => {
  const actual = await importOriginal();
  let calls = 0;
  return {
    ...actual,
    applyCoverDocxEdits: async (docxB64, lines, edits) => {
      calls += 1;
      if (calls === 1) return actual.applyCoverDocxEdits(docxB64, lines, edits);
      return { docxB64, applied: false, reason: "stale-plan" };
    },
  };
});

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const JOB_ID = "job-1";
const JOB = { id: JOB_ID, title: "Staff Engineer", company: "Acme", description: "React, Node, telemetry." };
const FACT = {
  id: "art-dublin",
  text: "Acme just opened a Dublin telemetry lab.",
  url: "https://news.example.com/acme/dublin-lab",
  title: "Acme opens a Dublin telemetry lab",
  placement: "intro",
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
let putBodies = [];
let probe = null;
let container = null;
let root = null;

function json(body) {
  return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
}

function entryWithEngineLetter(overrides = {}) {
  return {
    status: "done",
    result: "",
    resultLines: [],
    docxB64: "",
    docxPath: "",
    coverLetterResultLines: [...ENGINE_LINES],
    coverLetterDocxB64: ENGINE_B64,
    coverVersionId: "ver-1",
    ...overrides,
  };
}

function Probe({ initialMap }) {
  const [tailoringMap, setTailoringMap] = useState(initialMap);
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
    tailorEngine: "embedded",
    previewReloadKey,
    scrapePreviewPosting: null,
    currentUser: null,
    resumeFile: null,
    coverLetterFile: null,
  });
}

beforeEach(() => {
  store = { facts: [], removed: [], revision: null };
  putBodies = [];
  probe = null;
  globalThis.fetch = vi.fn(async (url, init = {}) => {
    const method = (init.method || "GET").toUpperCase();
    const u = String(url);
    if (u.includes("/api/company-research")) return json({ articles: [], warnings: [] });
    if (u.includes("/api/accepted-facts")) {
      if (method === "GET") return json({ facts: store.facts, removed: store.removed, revision: store.revision });
      const body = JSON.parse(init.body);
      putBodies.push(body);
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

async function openCoverPreview() {
  await act(async () => {
    probe.preview.openResumePreview(JOB, { tab: "cover" });
  });
  await flush();
}

async function insertFactViaAccept() {
  await act(async () => {
    probe.research.openCompanyResearch(JOB);
  });
  await flush();
  await act(async () => {
    await probe.research.acceptFacts({ facts: [FACT], declinedUrls: [] });
  });
  await flush();
}

const laterButtons = () => [...document.querySelectorAll('[aria-label="Move this fact one sentence later"]')];

function coverLines() {
  return probe.tailoringMap[JOB_ID]?.coverLetterResultLines || [];
}

async function clickMove(getButtons, i = 0) {
  await flush();
  expect(getButtons().length, "the move control is not on screen").toBeGreaterThan(i);
  const before = coverLines().join("\n");
  await act(async () => {
    getButtons()[i].click();
  });
  for (let n = 0; n < 25; n += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
    if (coverLines().join("\n") !== before) break;
  }
  await flush();
}

describe("Control A: bytes present but the splice is REFUSED (owed A9 sub-case)", () => {
  it("still moves the fact on the TEXT and drops the bytes so the download rebuilds from lines", async () => {
    await mount({ [JOB_ID]: entryWithEngineLetter() });
    await openCoverPreview();
    await insertFactViaAccept();
    // Non-vacuity: bytes really are present going into the move (the accept
    // path spliced successfully before the mock took effect on THIS click).
    expect(probe.tailoringMap[JOB_ID]?.coverLetterDocxB64?.length || 0).toBeGreaterThan(0);

    const before = coverLines().join("\n");
    const beforeAt = before.indexOf(FACT.text);
    const putsBefore = putBodies.length;
    await clickMove(laterButtons);

    const after = coverLines().join("\n");
    // The move itself proceeded on the text despite the splice refusal.
    expect(after, "the fact left the letter on a move").toContain(FACT.text);
    expect(after.indexOf(FACT.text), "the fact did not move later in the letter").toBeGreaterThan(beforeAt);

    // The refusal never ships stale bytes: coverDocxPath is explicitly null
    // (forcing a lines-rebuild), never the pre-move path.
    expect(putBodies.length).toBeGreaterThan(putsBefore);
    const put = putBodies[putBodies.length - 1];
    expect(put.coverVersion, "a move must persist a coverVersion").toBeTruthy();
    expect(put.coverVersion.docxPath, "a splice refusal must send docxPath:null, never the stale path").toBeNull();
    expect(put.coverVersion.lines.join("\n")).toBe(after);

    // The in-session bytes are dropped too -- never left holding the OLD
    // splice, which still carries the fact at its pre-move position.
    expect(probe.tailoringMap[JOB_ID]?.coverLetterDocxB64 || "", "stale bytes must not survive a splice refusal").toBe("");
  });
});
