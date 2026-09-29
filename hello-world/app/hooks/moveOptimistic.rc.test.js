// @vitest-environment jsdom
//
// N95 [OPTIMISTIC-ONLY, owner ruling 2026-09-29: optimistic-with-rollback for
// MOVE] -- the on-screen fact shifts synchronously on click and reconciles
// with the server; on failure it rolls back to the byte-identical pre-move
// state. Driven through the REAL arrow the way a candidate drives it (the
// sibling moveInsertedFact.rc.test.js is the template); the commit's network
// PUT is GATED so the optimistic window is real and inspectable.
//
// WHY the state (not just the DOM) is asserted: the moved position is what a
// DOWNLOAD rebuilds from, and the rollback's whole point is byte-identity of
// coverLetterResultLines / insertedFacts / the two docx byte-source fields.
// The Probe exposes tailoringMap so these are read directly.
//
// The design's crux (section 0/2): the preview body is served bytes-first and
// VERBATIM, so an optimistic write that left the byte sources in place would
// re-parse the STALE bytes and show the OLD position. The optimistic write
// must therefore null BOTH coverLetterDocxB64 AND coverLetterDocxPath so the
// re-parse rebuilds from moved.lines (docx.js:653 B64, :654 path). R1 (forget
// the path) and R2 (rollback misses the byte fields) are the two silent
// mutants these tests exist to kill.
//
// RED-on-HEAD: `moveInsertedFact` (useCompanyResearch.js:635-697) writes NOTHING
// until the commit resolves -- so the pre-settle assertions (lines already
// moved, byte sources already nulled) all find the unchanged pre-move state.

import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from "vitest";
import { createElement, useState, act } from "react";
import { createRoot } from "react-dom/client";

import { useCompanyResearch } from "./useCompanyResearch.js";
import { useDocumentPreview } from "./useDocumentPreview.js";
import DocumentPreviewMount from "@/app/components/DocumentPreviewMount.js";
import { sanitizeStoredFacts } from "@/lib/acceptedFacts/factStore.js";
import { planMoveFact } from "@/lib/acceptedFacts/factMove.js";
import { embeddedEngine } from "@/lib/llm/engines/tailor-lite/engine.js";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const JOB_ID = "job-1";
const JOB = { id: JOB_ID, title: "Staff Engineer", company: "Acme", description: "React, Node, telemetry." };

// Single fact, movable forward, in a letter that has a docx_path but no
// in-session bytes (a restored chip / version-switch state). The move takes the
// no-bytes path (no splice/upload) so the PUT is the only IO to gate -- and the
// entry STILL carries coverLetterDocxPath, which the optimistic write must null
// (R1). Verbatim-serve reads docxPath (docx.js:654), so a path left in place
// would re-serve the old position.
const FACT_TEXT = "Beta led a Dublin telemetry lab.";
const BODY = `Alpha shipped the platform. ${FACT_TEXT} Gamma scaled the fleet. Delta cut the latency.`;
const DOCX_PATH = "covers/job-1/v1.docx";

function singleFactEntry() {
  const lines = ["Dear Hiring Manager,", BODY, "Sincerely,", "Jordan Rivera"];
  return {
    status: "done",
    result: "",
    resultLines: [],
    docxB64: "",
    docxPath: "",
    coverLetterResultLines: lines,
    coverLetterDocxB64: "",
    coverLetterDocxPath: DOCX_PATH,
    coverLetterPreviewHtml: "<p>stale html</p>",
    coverVersionId: "ver-1",
    insertedFacts: [
      { id: "art-dublin", text: FACT_TEXT, lineIndex: 1, offset: lines[1].indexOf(FACT_TEXT), url: "https://news.example.com/x", title: "T" },
    ],
  };
}

// Two facts in the SAME paragraph (the N81/N90 coalesced-offset class): moving
// FACT_A relocates FACT_B's offset, so a rollback that restores only lines --
// not both records' {lineIndex, offset} -- corrupts FACT_B silently.
const FACT_A = "Acme opened a Dublin lab.";
const FACT_B = "Acme hired a hundred engineers.";
function twoFactEntry() {
  const para = `Alpha built the platform. ${FACT_A} We then shipped fast. ${FACT_B} Finally we scaled.`;
  const lines = ["Dear Hiring Manager,", para, "Sincerely,", "Jordan Rivera"];
  return {
    status: "done",
    result: "",
    resultLines: [],
    docxB64: "",
    docxPath: "",
    coverLetterResultLines: lines,
    coverLetterDocxB64: "",
    coverLetterDocxPath: DOCX_PATH,
    coverLetterPreviewHtml: "<p>stale html</p>",
    coverVersionId: "ver-1",
    insertedFacts: [
      { id: "fact-a", text: FACT_A, lineIndex: 1, offset: lines[1].indexOf(FACT_A), url: "https://news.example.com/a", title: "A" },
      { id: "fact-b", text: FACT_B, lineIndex: 1, offset: lines[1].indexOf(FACT_B), url: "https://news.example.com/b", title: "B" },
    ],
  };
}

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

const FACT = {
  id: "art-dublin",
  text: "Acme just opened a Dublin telemetry lab.",
  url: "https://news.example.com/acme/dublin-lab",
  title: "Acme opens a Dublin telemetry lab",
  placement: "intro",
};

let store;
let putBodies;
let probe;
let container = null;
let root = null;
let putGate = null;
let putShouldFail = false;

function makeDeferred() {
  let resolve;
  const promise = new Promise((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
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
    tailorEngine: "gemini",
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
  putGate = null;
  putShouldFail = false;
  globalThis.fetch = vi.fn(async (url, init = {}) => {
    const method = (init.method || "GET").toUpperCase();
    const u = String(url);
    if (u.includes("/api/company-research")) return json({ articles: [], warnings: [] });
    if (u.includes("/api/accepted-facts")) {
      if (method === "GET") return json({ facts: store.facts, removed: store.removed, revision: store.revision });
      const body = JSON.parse(init.body);
      putBodies.push(body);
      if (putGate) await putGate.promise;
      if (putShouldFail) return json({ error: "The letter's saved copy is out of date." }, 409);
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
  if (putGate) {
    putGate.resolve();
    putGate = null;
  }
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

async function mount(initialMap) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root.render(createElement(Probe, { initialMap }));
  });
  await flush();
  await act(async () => {
    probe.preview.openResumePreview(JOB, { tab: "cover" });
  });
  await flush();
}

const laterButtons = () => [...document.querySelectorAll('[aria-label="Move this fact one sentence later"]')];
const entry = () => probe.tailoringMap[JOB_ID] || {};
function coverLines() {
  return entry().coverLetterResultLines || [];
}

async function clickForwardSettle(getButtons = laterButtons, timeoutMs = 400) {
  const before = coverLines().join("\n");
  await act(async () => {
    getButtons()[0].click();
  });
  for (let n = 0; n < 40; n += 1) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 10));
    });
    if (coverLines().join("\n") !== before && putBodies.length > 0) break;
  }
  await flush();
}

describe("AC-M5: the on-screen fact position updates synchronously on click (optimistic)", () => {
  it("reflects moved.lines/records and NULLS both docx byte sources before the commit resolves (R1)", async () => {
    const map = { [JOB_ID]: singleFactEntry() };
    const moved = planMoveFact({
      lines: map[JOB_ID].coverLetterResultLines,
      records: map[JOB_ID].insertedFacts,
      id: "art-dublin",
      direction: "forward",
    });
    expect(moved.changed, "the fixture fact cannot move forward -- the test would be vacuous").toBe(true);

    await mount(map);
    expect(coverLines().join("\n")).toContain(FACT_TEXT);

    putGate = makeDeferred(); // hold the commit open so we inspect the optimistic window
    await act(async () => {
      laterButtons()[0].click();
    });
    await flush();

    // BEFORE settle: the store lines/records already reflect the move...
    expect(coverLines(), "the fact position did not update synchronously on click").toEqual(moved.lines);
    expect(entry().insertedFacts, "insertedFacts did not update optimistically").toEqual(moved.records);
    // ...and BOTH byte sources are nulled so the re-parse rebuilds from lines.
    // R1 = a mutant that nulls B64 but forgets the path: this catches it.
    expect(entry().coverLetterDocxB64 || "", "optimistic write did not null coverLetterDocxB64").toBe("");
    expect(entry().coverLetterDocxPath || "", "optimistic write did not null coverLetterDocxPath (R1: stale verbatim serve)").toBe("");

    putGate.resolve();
    putGate = null;
    await flush();
  });
});

describe("AC-M5: a failed commit rolls back to the byte-identical pre-move state (R2)", () => {
  it("restores lines, BOTH records' offsets, and every byte-source field after a save failure", async () => {
    const map = { [JOB_ID]: twoFactEntry() };
    const preLines = [...map[JOB_ID].coverLetterResultLines];
    const preFacts = map[JOB_ID].insertedFacts.map((f) => ({ ...f }));
    const prePath = map[JOB_ID].coverLetterDocxPath;
    const preHtml = map[JOB_ID].coverLetterPreviewHtml;

    await mount(map);

    putShouldFail = true;
    putGate = makeDeferred();
    await act(async () => {
      laterButtons()[0].click(); // move FACT_A forward
    });
    await flush();
    // optimism applied (RED on HEAD -- nothing changes until the commit resolves)
    expect(coverLines().join("\n"), "no optimistic update on click -- the rollback test would be vacuous").not.toBe(preLines.join("\n"));

    putGate.resolve();
    putGate = null;
    await flush();

    // EXACT rollback: byte-identical lines, both records' {lineIndex, offset},
    // and every byte-source field. R2 = a rollback that restores lines but
    // leaves the nulled byte fields; the last two assertions kill it.
    expect(coverLines(), "rollback did not restore the exact pre-move lines").toEqual(preLines);
    expect(entry().insertedFacts, "rollback did not restore BOTH records' exact offsets (coalesced class)").toEqual(preFacts);
    expect(entry().coverLetterDocxPath, "rollback left coverLetterDocxPath nulled -- the download would rebuild wrong").toBe(prePath);
    expect(entry().coverLetterPreviewHtml, "rollback did not restore coverLetterPreviewHtml").toBe(preHtml);
  });
});

describe("AC-X1 (GUARD): the server write is byte-identical with optimism added", () => {
  // Reached the way the original move test does: real accept-insert into an
  // engine letter WITH bytes, then a real forward move. The persisted position
  // and the reconciled bytes must match a non-optimistic build. R3 = resolving
  // the splice input from LIVE (nulled) state instead of the captured entry:
  // it flips hasCoverBytes false, so the reconciled coverLetterDocxB64 comes
  // back empty -- the last assertion catches it.
  function engineEntry() {
    return {
      status: "done",
      result: "",
      resultLines: [],
      docxB64: "",
      docxPath: "",
      coverLetterResultLines: [...ENGINE_LINES],
      coverLetterDocxB64: ENGINE_B64,
      coverVersionId: "ver-1",
    };
  }

  async function insertViaAccept() {
    await act(async () => {
      probe.research.openCompanyResearch(JOB);
    });
    await flush();
    await act(async () => {
      await probe.research.acceptFacts({ facts: [FACT], declinedUrls: [] });
    });
    await flush();
  }

  it("persists moved.lines and reconciles real cover bytes (byte-identity + R3)", async () => {
    await mount({ [JOB_ID]: engineEntry() });
    await insertViaAccept();
    expect(coverLines().join("\n"), "fact not inserted -- X1 would be vacuous").toContain(FACT.text);

    const putsBefore = putBodies.length;
    await clickForwardSettle();

    const after = coverLines().join("\n");
    expect(putBodies.length, "the move made no server write").toBeGreaterThan(putsBefore);
    const put = putBodies[putBodies.length - 1];
    expect(put.coverVersion, "a move must persist a coverVersion").toBeTruthy();
    // the persisted position is exactly what the download rebuilds from
    expect(put.coverVersion.lines.join("\n"), "the persisted lines diverged from the on-screen letter").toBe(after);
    // the reconciled bytes are real (non-empty) -- a splice resolved from the
    // captured entry, not the nulled live state (R3).
    expect((entry().coverLetterDocxB64 || "").length, "reconciled cover bytes are empty -- splice input read live (R3)").toBeGreaterThan(0);
  });
});
