// @vitest-environment jsdom
//
// N93 (AC-B6) -- POST-APPLY UNDO, REACHABILITY. The undo is reached the way a
// candidate reaches it: mount the REAL DocumentPreviewMount (which renders the
// REAL DocumentPreviewDialog + InsertedFactsStrip + the confirm surface), CLICK
// the real Smooth control, CLICK the real Apply, then CLICK the real Undo. The
// handlers are NEVER called directly -- a direct call cannot prove a user can
// reach the undo, nor that Apply actually STASHES enough to restore, nor that
// Undo is WIRED to the persistence path at all: the "panel with no opening
// button" / "form with no save wiring" class this seat exists to prevent
// (loop-tdd rule 2/5; the sibling coverFactSmoothConfirm.rc.test.js is the
// template).
//
// This file is the NO-BYTES (line-rebuild) path -- the seeded entry has
// coverLetterDocxB64:"" so the apply/undo rebuild deterministically from lines.
// The companion smoothUndoSplice.rc.test.js is the byte-splice path that reads
// the STORED docx bytes back (the Wave-2 splice lesson: a lines-only revert
// that leaves stale docx bytes must red).
//
// What is asserted is BOTH the on-screen letter (preview) AND the persisted PUT
// coverVersion (what the download rebuilds from) -- restoring one without the
// other is the last-hop defect class (AC-B6 "survives repaint + download").
//
// RED ON HEAD: no Undo control, no undo state, and no undoSmoothTransition
// exist, so the Undo button never renders and every assertion that one is
// present/clickable reds. jsdom note: MUI Dialog portals into document.body, so
// DOM queries go through `document`.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createElement, useState, act } from "react";
import { createRoot } from "react-dom/client";

import { useCompanyResearch } from "@/app/hooks/useCompanyResearch.js";
import { useDocumentPreview } from "@/app/hooks/useDocumentPreview.js";
import DocumentPreviewMount from "@/app/components/DocumentPreviewMount.js";
import { sanitizeStoredFacts } from "@/lib/acceptedFacts/factStore.js";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const JOB_ID = "job-1";
const JOB = { id: JOB_ID, title: "Staff Engineer", company: "Acme", description: "React, Node, telemetry." };

const FACT_A = "Acme just opened a Dublin telemetry lab.";
const FACT_B = "The team grew to forty engineers.";
const OTHER_PARAGRAPH = "I would relocate for the right team.";
// Paragraph carrying fact A and its two neighbour sentences.
const BODY_A = `I led the platform team. ${FACT_A} We shipped quickly.`;
// A distinct paragraph carrying fact B, which no undo of A may disturb.
const BODY_B = `I also built the tooling. ${FACT_B} It scaled well.`;

// The engine's smoothed reply for fact A -- reuses only in-scope tokens (Acme /
// Dublin already present; no new numbers), so the added-token guard passes.
const SMOOTHED = {
  status: "ok",
  before: "Leading the platform team,",
  fact: "we saw Acme just open a Dublin telemetry lab,",
  after: "which let us ship quickly.",
};
const SMOOTHED_FRAGMENT = "we saw Acme just open a Dublin telemetry lab";

function factRecord(id, text, lineIndex, line, extra = {}) {
  return { id, text, lineIndex, offset: line.indexOf(text), url: `https://news.example.com/${id}`, title: `Source for ${id}`, ...extra };
}

// Single-fact letter (no docx bytes -> line-rebuild path).
function seededEntry() {
  const lines = ["Dear Hiring Manager,", BODY_A, OTHER_PARAGRAPH, "Sincerely,", "Jordan Rivera"];
  return {
    status: "done",
    result: "",
    resultLines: [],
    docxB64: "",
    docxPath: "",
    coverLetterResultLines: lines,
    coverLetterDocxB64: "",
    coverVersionId: "ver-1",
    insertedFacts: [factRecord("art-a", FACT_A, 1, lines[1])],
  };
}

// Two-fact letter, one fact per body paragraph.
function twoFactEntry() {
  const lines = ["Dear Hiring Manager,", BODY_A, BODY_B, "Sincerely,", "Jordan Rivera"];
  return {
    status: "done",
    result: "",
    resultLines: [],
    docxB64: "",
    docxPath: "",
    coverLetterResultLines: lines,
    coverLetterDocxB64: "",
    coverVersionId: "ver-1",
    insertedFacts: [factRecord("art-a", FACT_A, 1, lines[1]), factRecord("art-b", FACT_B, 2, lines[2])],
  };
}

let store;
let putBodies;
let smoothRequests;
let probe;
let container = null;
let root = null;

function json(body) {
  return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
}

function Probe({ engine, entry }) {
  const [tailoringMap, setTailoringMap] = useState({ [JOB_ID]: entry });
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
    tailorEngine: engine,
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
  smoothRequests = [];
  probe = null;
  globalThis.fetch = vi.fn(async (url, init = {}) => {
    const method = (init.method || "GET").toUpperCase();
    const u = String(url);
    if (u.includes("/api/cover-fact-smooth")) {
      smoothRequests.push(init.body ? JSON.parse(init.body) : null);
      return json({ smoothed: SMOOTHED });
    }
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

async function mount(engine = "gemini", entry = seededEntry()) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root.render(createElement(Probe, { engine, entry }));
  });
  await flush();
  await act(async () => {
    probe.preview.openResumePreview(JOB, { tab: "cover" });
  });
  await flush();
}

const smoothButtons = () => [...document.querySelectorAll('[aria-label="Smooth the transition into this fact"]')];
const applyButtons = () => [...document.querySelectorAll('[aria-label="Apply the smoothed version"]')];
// N93: the post-apply undo control. Its aria-label IS the reachability contract.
const undoButtons = () => [...document.querySelectorAll('[aria-label="Undo the smoothing"]')];
const removeButtons = () => [...document.querySelectorAll('[aria-label="Remove this fact"]')];
const laterButtons = () => [...document.querySelectorAll('[aria-label="Move this fact one sentence later"]')];
const sourceLinks = () => [...document.querySelectorAll('[aria-label="Open the source article"]')];

function coverLines() {
  return probe.tailoringMap[JOB_ID]?.coverLetterResultLines || [];
}

async function clickAndSettle(getButtons, predicate, i = 0) {
  expect(getButtons().length, "the control is not on screen -- it was never wired").toBeGreaterThan(i);
  await act(async () => {
    getButtons()[i].click();
  });
  for (let n = 0; n < 25; n += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
    if (predicate()) break;
  }
  await flush();
}

// Smooth fact `i`, then Apply it -- the state an undo reverts.
async function smoothAndApply(i = 0) {
  await clickAndSettle(smoothButtons, () => applyButtons().length > 0, i);
  await clickAndSettle(applyButtons, () => coverLines().join("\n").includes(SMOOTHED_FRAGMENT), 0);
}

describe("the Undo control is reachable only AFTER a smoothing is applied (AC-B6 stash)", () => {
  it("no Undo control exists before Apply, and one appears after Apply", async () => {
    await mount("gemini");
    // before smoothing: no undo affordance (nothing has been applied).
    expect(undoButtons().length, "an Undo control is offered before anything was smoothed").toBe(0);

    await clickAndSettle(smoothButtons, () => applyButtons().length > 0);
    // proposed but not yet applied: still nothing to undo.
    expect(undoButtons().length, "an Undo control is offered before the user confirmed the smoothing").toBe(0);

    await clickAndSettle(applyButtons, () => coverLines().join("\n").includes(SMOOTHED_FRAGMENT));
    // now the smoothing is applied: the undo must be reachable.
    expect(coverLines().join("\n"), "the smoothing did not apply -- the undo test would be vacuous").toContain(SMOOTHED_FRAGMENT);
    expect(undoButtons().length, "no Undo control appeared after applying a smoothing -- AC-B6 has no reachable affordance").toBe(1);
  });
});

describe("Undo restores the pre-smoothing letter, visible AND persisted (AC-B6)", () => {
  it("clicking Undo restores the on-screen letter byte-identically", async () => {
    await mount("gemini");
    const original = coverLines().join("\n");
    await smoothAndApply();
    expect(coverLines().join("\n"), "apply did not change the letter").not.toBe(original);

    await clickAndSettle(undoButtons, () => coverLines().join("\n") === original);

    expect(coverLines().join("\n"), "Undo did not restore the letter byte-identically").toBe(original);
    expect(coverLines().join("\n"), "the restored letter still carries the smoothed sentence").not.toContain(SMOOTHED_FRAGMENT);
    expect(coverLines().join("\n"), "the restored letter lost the original fact").toContain(FACT_A);
  });

  it("persists the restored letter as a coverVersion the download rebuilds from (survives repaint)", async () => {
    await mount("gemini");
    const original = coverLines().join("\n");
    await smoothAndApply();
    const putsAfterApply = putBodies.length;

    await clickAndSettle(undoButtons, () => putBodies.length > putsAfterApply);

    // undo wrote a fresh coverVersion carrying the ORIGINAL lines...
    expect(putBodies.length, "Undo made no write to the store -- it would not survive a repaint or reach the download").toBeGreaterThan(putsAfterApply);
    const put = putBodies[putBodies.length - 1];
    expect(put.coverVersion, "Undo must persist a coverVersion or the download keeps the smoothed text").toBeTruthy();
    expect(put.coverVersion.lines.join("\n"), "the persisted (download-rebuild) letter was not restored to the original").toBe(original);
    expect(put.coverVersion.lines.join("\n"), "the persisted letter still carries the smoothed text").not.toContain(SMOOTHED_FRAGMENT);
    // no-bytes path: docxPath is null so the download rebuilds from the restored
    // lines, never stale smoothed bytes.
    expect(put.coverVersion.docxPath, "a no-bytes undo must send docxPath:null to force a lines-rebuild").toBeNull();
  });

  it("dismisses the Undo affordance after it is used, and does not double-revert on a second click (AC-B6 edges)", async () => {
    await mount("gemini");
    await smoothAndApply();
    await clickAndSettle(undoButtons, () => undoButtons().length === 0);

    // the affordance is gone (a second undo cannot double-revert)...
    expect(undoButtons().length, "the Undo control stayed on screen after being used -- a second click could double-revert").toBe(0);
    const putsAfterUndo = putBodies.length;
    // ...and nothing further was written.
    await flush();
    expect(putBodies.length, "a write fired after the single undo").toBe(putsAfterUndo);
  });
});

describe("Undo is scoped and preserves provenance (AC-B6 scope + AC-B4)", () => {
  it("touches only the smoothed paragraph, leaving unrelated paragraphs byte-identical", async () => {
    await mount("gemini");
    const before = coverLines();
    const otherBefore = before[2];
    expect(otherBefore, "the unrelated paragraph fixture is missing").toBe(OTHER_PARAGRAPH);

    await smoothAndApply();
    // the unrelated paragraph was untouched by the smoothing itself...
    expect(coverLines()[2], "the smoothing changed an unrelated paragraph").toBe(OTHER_PARAGRAPH);

    await clickAndSettle(undoButtons, () => coverLines().join("\n") === before.join("\n"));
    // ...and still untouched by the undo.
    expect(coverLines()[2], "the undo disturbed an unrelated paragraph").toBe(OTHER_PARAGRAPH);
    expect(coverLines(), "the undo did not restore the exact original paragraph array").toEqual(before);
  });

  it("after undo the source link and one-click Remove still work (provenance preserved)", async () => {
    await mount("gemini");
    expect(sourceLinks().length, "no source link before smoothing -- provenance test would be vacuous").toBe(1);
    await smoothAndApply();
    await clickAndSettle(undoButtons, () => undoButtons().length === 0);

    // provenance survived the smooth -> undo round-trip.
    expect(sourceLinks().length, "the source link was lost across smooth+undo").toBe(1);
    expect(removeButtons().length, "the Remove control was lost across smooth+undo").toBe(1);

    // and the restored fact is still one-click removable.
    const beforeRemove = coverLines().join("\n");
    await act(async () => {
      removeButtons()[0].click();
    });
    for (let n = 0; n < 25; n += 1) {
      await act(async () => {
        await new Promise((resolve) => setTimeout(resolve, 10));
      });
      if (coverLines().join("\n") !== beforeRemove) break;
    }
    await flush();
    expect(coverLines().join("\n"), "the restored fact could not be removed").not.toContain(FACT_A);
  });
});

describe("Undo of one fact does not disturb another, and is invalidated by a later change (AC-B6 interaction)", () => {
  it("undoing fact A's smoothing leaves fact B untouched throughout", async () => {
    await mount("gemini", twoFactEntry());
    expect(smoothButtons().length, "expected two smoothable facts").toBe(2);
    const bParagraphBefore = coverLines()[2];
    expect(bParagraphBefore, "fact B fixture is missing").toContain(FACT_B);

    // smooth+apply ONLY fact A (index 0)...
    await smoothAndApply(0);
    expect(coverLines()[2], "smoothing fact A disturbed fact B's paragraph").toBe(bParagraphBefore);
    // exactly one undo affordance, for the fact just applied.
    expect(undoButtons().length, "expected exactly one Undo affordance after applying one fact").toBe(1);

    await clickAndSettle(undoButtons, () => !coverLines().join("\n").includes(SMOOTHED_FRAGMENT));
    // fact B still present and untouched; fact A restored.
    expect(coverLines()[2], "undoing fact A disturbed fact B's paragraph").toBe(bParagraphBefore);
    expect(coverLines().join("\n"), "fact B was lost when fact A was undone").toContain(FACT_B);
    expect(coverLines().join("\n"), "fact A was not restored").toContain(FACT_A);
  });

  it("a move after applying invalidates the Undo affordance (the safe direction -- undo cannot clobber the later move)", async () => {
    await mount("gemini");
    await smoothAndApply();
    expect(undoButtons().length, "no Undo affordance after apply -- interaction test would be vacuous").toBe(1);

    // the user moves the (now smoothed) fact; the stash's pre-smoothing snapshot
    // no longer matches the letter, so undo must be withdrawn rather than
    // silently revert the move too.
    const smoothed = coverLines().join("\n");
    await clickAndSettle(laterButtons, () => coverLines().join("\n") !== smoothed || undoButtons().length === 0);

    expect(undoButtons().length, "the Undo affordance survived a later move -- clicking it would clobber the move (unsafe)").toBe(0);
  });
});

describe("engine gating still holds for the smooth control feeding undo (AC-B9)", () => {
  it("on embedded there is no smooth control, so no undo path is reachable", async () => {
    await mount("embedded");
    expect(smoothButtons()[0]?.disabled, "the smooth control is live on embedded").toBe(true);
    expect(undoButtons().length, "an Undo affordance exists on embedded where nothing can be smoothed").toBe(0);
  });
});
