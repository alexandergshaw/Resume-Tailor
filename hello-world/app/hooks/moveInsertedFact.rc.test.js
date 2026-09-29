// @vitest-environment jsdom
//
// N92 Wave 1 (Control A) -- REACHABILITY. The move is reached the way a
// candidate reaches it: mount the REAL DocumentPreviewMount (which renders the
// REAL DocumentPreviewDialog + InsertedFactsStrip), insert a fact through the
// real accept path, then click the REAL per-fact move control. The handler
// `research.moveInsertedFact` is NEVER called directly -- a direct call cannot
// prove a user can reach the control, and reachability is the single
// most-repeated defect in this repo (loop-tdd rule 5; the sibling
// removeInsertedFact.rc.test.js is the template). Mounting via the MOUNT, not
// the Dialog, is deliberate: if the Mount fails to thread `onMove`, the arrows
// are inert and the fact does not move -- the exact wiring bug a Dialog-only
// harness hides.
//
// What is asserted is the DOWNLOAD-REBUILD SOURCE (coverLetterResultLines) and
// the persisted PUT coverVersion -- not only the on-screen text -- because the
// moved position is what a DOWNLOAD produces (AC-X3/A13). The AC's cited
// previewReloadKey :718 anchor is NOT assumed: this drives the observable
// result (the lines the download rebuilds from), per the brief.
//
// RED-on-HEAD: no move control exists (grep moveInsertedFact|moveForward =
// none, 2026-09-28), so the arrow buttons do not render and every assertion
// that one is present goes red.
//
// jsdom note: MUI's Dialog portals into document.body, so every DOM query goes
// through `document`.

import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from "vitest";
import { createElement, useState, act } from "react";
import { createRoot } from "react-dom/client";

import { useCompanyResearch } from "./useCompanyResearch.js";
import { useDocumentPreview } from "./useDocumentPreview.js";
import DocumentPreviewMount from "@/app/components/DocumentPreviewMount.js";
import { sanitizeStoredFacts } from "@/lib/acceptedFacts/factStore.js";
import { embeddedEngine } from "@/lib/llm/engines/tailor-lite/engine.js";
import { recordDecision } from "@/lib/activityLog/appActivityLog.js";

// Partial mock: only recordDecision becomes a spy so we can assert the move is
// logged as a fact-position decision carrying NO letter text (AC-X1). Every
// other export (recordActivity, attachActivitySection, ...) stays real.
vi.mock("@/lib/activityLog/appActivityLog.js", async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, recordDecision: vi.fn() };
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
  recordDecision.mockClear();
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
const earlierButtons = () => [...document.querySelectorAll('[aria-label="Move this fact one sentence earlier"]')];
const removeButtons = () => [...document.querySelectorAll('[aria-label="Remove this fact"]')];
const sourceLinks = () => [...document.querySelectorAll('[aria-label="Open the source article"]')];

function coverLines() {
  return probe.tailoringMap[JOB_ID]?.coverLetterResultLines || [];
}

// Click a move control the way a candidate does; the bytes path awaits a real
// docx (de)serialize, so advance real time until the lines settle.
async function clickMove(getButtons, i = 0) {
  await flush();
  expect(getButtons().length, "the move control is not on screen -- it was never wired").toBeGreaterThan(i);
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

describe("Control A is reachable by render-and-click (AC-A2/X3)", () => {
  it("renders one back and one forward control per inserted fact", async () => {
    await mount({ [JOB_ID]: entryWithEngineLetter() });
    await openCoverPreview();
    await insertFactViaAccept();
    expect(coverLines().join("\n"), "the fact was never inserted -- the move test would be vacuous").toContain(FACT.text);
    expect(laterButtons().length, "no forward move control rendered -- the strip is not wired for onMove").toBe(1);
    expect(earlierButtons().length, "no backward move control rendered").toBe(1);
  });

  it("clicking forward relocates the fact later in the download-rebuild source and persists a coverVersion", async () => {
    await mount({ [JOB_ID]: entryWithEngineLetter() });
    await openCoverPreview();
    await insertFactViaAccept();

    const before = coverLines().join("\n");
    const beforeAt = before.indexOf(FACT.text);
    const putsBefore = putBodies.length;
    await clickMove(laterButtons);

    const after = coverLines().join("\n");
    // moved toward the END of the letter (correct direction), still present once
    expect(after, "the fact left the letter on a move").toContain(FACT.text);
    expect(after.indexOf(FACT.text), "the fact did not move later in the letter").toBeGreaterThan(beforeAt);
    expect(after).not.toBe(before);
    // the move persisted -- the download rebuilds from these lines
    expect(putBodies.length, "the move made no write to the store").toBeGreaterThan(putsBefore);
    const put = putBodies[putBodies.length - 1];
    expect(put.coverVersion, "a move must persist a coverVersion or the download diverges").toBeTruthy();
    expect(put.coverVersion.lines.join("\n")).toContain(FACT.text);
    expect(put.coverVersion.lines.join("\n")).toBe(after);
  });

  it("forward then backward restores the download-rebuild source byte-identically", async () => {
    await mount({ [JOB_ID]: entryWithEngineLetter() });
    await openCoverPreview();
    await insertFactViaAccept();

    const original = coverLines().join("\n");
    await clickMove(laterButtons);
    expect(coverLines().join("\n"), "forward did nothing -- the round-trip would be vacuous").not.toBe(original);
    await clickMove(earlierButtons);
    expect(coverLines().join("\n"), "forward+backward is not byte-identical").toBe(original);
  });
});

describe("Control A is not gated on cover bytes (AC-A9)", () => {
  it("moves the fact in the no-bytes (version-switch) state and drops bytes so the download rebuilds from lines", async () => {
    await mount({ [JOB_ID]: entryWithEngineLetter() });
    await openCoverPreview();
    await insertFactViaAccept();
    const original = coverLines().join("\n");
    expect(original).toContain(FACT.text);

    // Simulate a version-switch / restored chip: session cover bytes cleared
    // (what selectDocumentVersion writes), lines still present. The accept path
    // REFUSES here; a move must NOT -- its safe outcome is the fact relocating.
    await act(async () => {
      probe.setTailoringMap((m) => ({ ...m, [JOB_ID]: { ...m[JOB_ID], coverLetterDocxB64: "" } }));
    });
    await flush();

    const putsBefore = putBodies.length;
    await clickMove(laterButtons);

    // the move proceeded on the text with no bytes to splice
    expect(coverLines().join("\n"), "the move was blocked in the no-bytes state").not.toBe(original);
    expect(coverLines().join("\n")).toContain(FACT.text);
    expect(probe.research.companyResearch.acceptError || "", "a move raised the accept path's missing-bytes refusal").toBe("");
    // and it persisted with docxPath dropped so the download rebuilds from lines
    // (never stale bytes carrying the old position)
    expect(putBodies.length).toBeGreaterThan(putsBefore);
    const put = putBodies[putBodies.length - 1];
    expect(put.coverVersion, "a move must persist a coverVersion").toBeTruthy();
    expect(put.coverVersion.docxPath, "no-bytes move must send docxPath:null to force a lines-rebuild").toBeNull();
    expect(put.coverVersion.lines.join("\n")).toBe(coverLines().join("\n"));
  });
});

describe("Control A preserves provenance and co-renders every egress control (AC-A12)", () => {
  it("after a move the source link and one-click Remove still work", async () => {
    await mount({ [JOB_ID]: entryWithEngineLetter() });
    await openCoverPreview();
    await insertFactViaAccept();
    expect(sourceLinks().length, "no source link before the move -- provenance test would be vacuous").toBe(1);

    await clickMove(laterButtons);

    // provenance survived the move
    expect(sourceLinks().length, "the source link was lost on a move").toBe(1);
    expect(removeButtons().length, "the Remove control was lost on a move").toBe(1);

    // and the fact is still one-click removable from the moved position
    const before = coverLines().join("\n");
    await act(async () => {
      removeButtons()[0].click();
    });
    for (let n = 0; n < 25; n += 1) {
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 10));
      });
      if (coverLines().join("\n") !== before) break;
    }
    await flush();
    expect(coverLines().join("\n"), "the moved fact could not be removed").not.toContain(FACT.text);
  });
});

describe("Control A boundary controls are honestly disabled, not silently no-op (AC-A6)", () => {
  // A short letter with the fact at the LAST body sentence (line 1 is the last
  // body paragraph; "Sincerely," is the closing). Forward has nowhere to go ->
  // the control must be DISABLED and announced, never a live-looking arrow that
  // clicks to nothing (plan §8 W1-S4 SILENT row). Seeded directly because this
  // asserts the disabled RENDER, not insertion reachability (covered above).
  const BOUNDARY_TEXT = "Acme opened a Dublin lab.";
  function seededEntry() {
    const lines = ["Dear Hiring Manager,", `I lead the team. ${BOUNDARY_TEXT}`, "Sincerely,", "Jordan Rivera"];
    return entryWithEngineLetter({
      coverLetterResultLines: lines,
      coverLetterDocxB64: "",
      insertedFacts: [
        {
          id: "art-x",
          text: BOUNDARY_TEXT,
          lineIndex: 1,
          offset: lines[1].indexOf(BOUNDARY_TEXT),
          url: "https://news.example.com/acme/dublin-lab",
          title: "Acme opens a Dublin telemetry lab",
        },
      ],
    });
  }

  it("disables forward at the last body slot while backward stays live", async () => {
    await mount({ [JOB_ID]: seededEntry() });
    await openCoverPreview();
    // both controls render (else the disabled contract is vacuous)
    expect(laterButtons().length).toBe(1);
    expect(earlierButtons().length).toBe(1);
    // forward is at the boundary -> disabled+announced; backward can still move.
    expect(laterButtons()[0].disabled, "forward is not disabled at the last body slot -- a live-looking no-op").toBe(true);
    expect(earlierButtons()[0].disabled, "backward is wrongly disabled away from its boundary").toBe(false);
  });
});

describe("Control A records the move as a fact-position decision (AC-X1)", () => {
  it("logs a fact-position outcome carrying the direction but NO letter text", async () => {
    await mount({ [JOB_ID]: entryWithEngineLetter() });
    await openCoverPreview();
    await insertFactViaAccept();
    recordDecision.mockClear();

    await clickMove(laterButtons);

    const calls = recordDecision.mock.calls.filter((c) => c[0] === "fact-position");
    expect(calls.length, "the move recorded no fact-position decision").toBeGreaterThan(0);
    const [, outcome, fields] = calls[calls.length - 1];
    expect(["acted", "skipped", "refused", "failed"]).toContain(outcome);
    expect(fields?.direction, "the recorded decision does not carry the move direction").toBeTruthy();
    // N77: no letter/company/url/title text in the record the caller passes.
    const serialized = JSON.stringify(fields || {});
    expect(serialized).not.toContain(FACT.text);
    expect(serialized).not.toContain(FACT.url);
    expect(serialized).not.toContain(FACT.title);
  });
});
