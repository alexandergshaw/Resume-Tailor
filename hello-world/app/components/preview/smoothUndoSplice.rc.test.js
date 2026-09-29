// @vitest-environment jsdom
//
// N93 (AC-B6) -- POST-APPLY UNDO on the BYTE-SPLICE path, the last hop. The
// companion coverFactSmoothUndo.rc.test.js covers the no-bytes (line-rebuild)
// path; this file covers the realistic majority case where the letter has REAL
// cover-letter docx bytes, so applying a smoothing RE-SPLICES the docx and undo
// must re-splice it BACK. It drives the REAL Smooth -> Apply -> Undo flow by
// clicking the real controls, then reads the ACTUAL stored coverLetterDocxB64
// back out and parses it -- the very bytes lib/document/docx.js#resolveDocumentBlob
// serves to both the preview and the download.
//
// THE WAVE-2 SPLICE LESSON (docs/loop/N92.verify.w2.r1.md; the memory card
// download-rebuild-formatting): a revert that fixes coverLetterResultLines but
// leaves the stored docx bytes carrying the smoothed splice ships a download
// that DISAGREES with the visible letter -- the served .docx still reads the
// smoothed sentence. So the teeth here read the STORED BYTES, not the lines:
// after undo the served docx must not carry the smoothed text.
//
// HOW THE BYTES ARE READ: `buildControlledCoverDocxB64` makes a genuine .docx
// whose body paragraphs are exactly our fixture lines (a valid OOXML container
// from the embedded engine, body replaced wholesale), so
// lib/acceptedFacts/factDocx.js#applyCoverDocxEdits can match each edit's
// whole-paragraph `before` and rewrite it. After each step we `loadDocx` the
// STORED bytes and take `documentLines` -- the plain text the served .docx
// carries.
//
// RED ON HEAD: no Undo control / undoSmoothTransition exists, so the Undo button
// never renders and clickAndSettle throws on the missing control -> red.

import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from "vitest";
import { createElement, useState, act } from "react";
import { createRoot } from "react-dom/client";

import { useCompanyResearch } from "@/app/hooks/useCompanyResearch.js";
import { useDocumentPreview } from "@/app/hooks/useDocumentPreview.js";
import DocumentPreviewMount from "@/app/components/DocumentPreviewMount.js";
import { sanitizeStoredFacts } from "@/lib/acceptedFacts/factStore.js";
import { embeddedEngine } from "@/lib/llm/engines/tailor-lite/engine.js";
import { loadDocx, serializeDocx, documentLines } from "@/lib/llm/engines/tailor-lite/docxModel.js";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const JOB_ID = "job-1";
const JOB = { id: JOB_ID, title: "Staff Engineer", company: "Acme", description: "React, Node, telemetry." };

const FACT_A = "Acme just opened a Dublin telemetry lab.";
const BODY_A = `I led the platform team. ${FACT_A} We shipped quickly.`;
const GREETING = "Dear Hiring Manager,";
const OTHER = "I would relocate for the right team.";
const CLOSING = "Sincerely,";
const SIGNATURE = "Jordan Rivera";
const BODY_LINES = [GREETING, BODY_A, OTHER, CLOSING, SIGNATURE];

const SMOOTHED = {
  status: "ok",
  before: "Leading the platform team,",
  fact: "we saw Acme just open a Dublin telemetry lab,",
  after: "which let us ship quickly.",
};
const SMOOTHED_FRAGMENT = "we saw Acme just open a Dublin telemetry lab";

// Build a REAL .docx whose body paragraphs are exactly `lines`, so the splice
// can match each edit's whole-paragraph `before`. Uses the embedded engine's own
// docx only as a valid OOXML container; its body is replaced wholesale. (Same
// technique as autoInsertForwardNudgeSplice.rc.test.js.)
async function buildControlledCoverDocxB64(lines) {
  const cl = await embeddedEngine.tailorCoverLetter({
    jobPosting: "Staff Engineer at Acme. React, Node, telemetry.",
    jobTitle: "Staff Engineer",
    companyName: "Acme",
  });
  const doc = await loadDocx(Buffer.from(cl.docxB64, "base64"));
  const part = doc.parts.find((p) => p.name === "word/document.xml");
  const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const para = (t) => `<w:p><w:r><w:t xml:space="preserve">${esc(t)}</w:t></w:r></w:p>`;
  const bodyInner = lines.map(para).join("");
  part.xml = part.xml.replace(/<w:body\b[^>]*>[\s\S]*<\/w:body>/, `<w:body>${bodyInner}</w:body>`);
  return serializeDocx(doc);
}

let COVER_B64 = "";
let store;
let putBodies;
let smoothRequests;
let probe;
let container = null;
let root = null;

function json(body) {
  return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
}

function entryWithBytes() {
  return {
    status: "done",
    result: "",
    resultLines: [],
    docxB64: "",
    docxPath: "",
    coverLetterResultLines: [...BODY_LINES],
    coverLetterDocxB64: COVER_B64,
    coverLetterDocxPath: "",
    coverVersionId: "ver-1",
    insertedFacts: [{ id: "art-a", text: FACT_A, lineIndex: 1, offset: BODY_A.indexOf(FACT_A), url: "https://news.example.com/acme", title: "Acme opens a Dublin lab" }],
  };
}

function Probe() {
  const [tailoringMap, setTailoringMap] = useState({ [JOB_ID]: entryWithBytes() });
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

beforeAll(async () => {
  COVER_B64 = await buildControlledCoverDocxB64(BODY_LINES);
  // Sanity: the controlled container really round-trips to our fixture lines, so
  // a later documentLines() read is a faithful text of the served docx.
  const check = documentLines(await loadDocx(Buffer.from(COVER_B64, "base64")));
  if (JSON.stringify(check) !== JSON.stringify(BODY_LINES)) {
    throw new Error("controlled cover docx did not round-trip to BODY_LINES");
  }
});

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

function coverLines() {
  return probe.tailoringMap[JOB_ID]?.coverLetterResultLines || [];
}

async function clickAndSettle(getButtons, predicate, i = 0) {
  expect(getButtons().length, "the control is not on screen -- it was never wired").toBeGreaterThan(i);
  await act(async () => {
    getButtons()[i].click();
  });
  for (let n = 0; n < 30; n += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
    if (predicate()) break;
  }
  await flush();
}

// Read the stored cover docx bytes back as their plain text, or null if the
// bytes were dropped (a valid undo outcome -- the download then rebuilds from
// the restored lines).
async function servedDocxText() {
  const b64 = probe.tailoringMap[JOB_ID]?.coverLetterDocxB64;
  if (typeof b64 !== "string" || b64.length === 0) return null;
  const doc = await loadDocx(Buffer.from(b64, "base64"));
  return documentLines(doc).join("\n");
}

describe("byte-splice path: applying a smoothing re-splices the docx (canary that the path is exercised)", () => {
  it("after Apply the STORED docx bytes carry the smoothed sentence", async () => {
    await mount();
    // canary: bytes are present going in.
    expect((probe.tailoringMap[JOB_ID]?.coverLetterDocxB64 || "").length, "no cover bytes at start -- the splice path is not exercised").toBeGreaterThan(0);

    await clickAndSettle(smoothButtons, () => applyButtons().length > 0);
    await clickAndSettle(applyButtons, () => coverLines().join("\n").includes(SMOOTHED_FRAGMENT));

    const served = await servedDocxText();
    expect(served, "the smoothing did not store any docx bytes -- the splice path did not run").toBeTruthy();
    expect(served, "the stored docx does not carry the smoothed sentence after Apply -- the splice never happened, so the undo byte-read would be vacuous").toContain(SMOOTHED_FRAGMENT);
  });
});

describe("byte-splice path: Undo reverts the STORED docx bytes, not only the lines (AC-B6 last hop)", () => {
  it("after Undo the served docx bytes no longer carry the smoothed text and carry the original", async () => {
    await mount();
    const original = coverLines().join("\n");

    await clickAndSettle(smoothButtons, () => applyButtons().length > 0);
    await clickAndSettle(applyButtons, () => coverLines().join("\n").includes(SMOOTHED_FRAGMENT));
    // confirm the splice really carried the smoothed text into the bytes.
    expect(await servedDocxText(), "pre-undo: the stored docx did not carry the smoothed text -- test would be vacuous").toContain(SMOOTHED_FRAGMENT);

    await clickAndSettle(undoButtons, () => coverLines().join("\n") === original);

    // the visible letter is restored...
    expect(coverLines().join("\n"), "Undo did not restore the visible letter").toBe(original);

    // ...and the SERVED docx bytes were reverted too. A lines-only revert that
    // leaves the smoothed splice in the stored bytes fails HERE: the download
    // would still read the smoothed sentence.
    const served = await servedDocxText();
    if (served !== null) {
      expect(served, "the stored/served docx STILL carries the smoothed sentence after Undo -- a lines-only revert left stale docx bytes (the download disagrees with the letter)").not.toContain(SMOOTHED_FRAGMENT);
      expect(served, "the reverted docx bytes lost the original fact sentence").toContain(FACT_A);
    } else {
      // bytes dropped: the download rebuilds from the restored lines instead --
      // also correct. Then the persisted coverVersion must carry the original and
      // force a lines-rebuild.
      const put = putBodies[putBodies.length - 1];
      expect(put.coverVersion?.docxPath, "bytes were dropped but no docxPath:null was persisted to force a lines-rebuild").toBeNull();
      expect(put.coverVersion?.lines.join("\n"), "the persisted restored letter is wrong").toBe(original);
    }
  });
});
