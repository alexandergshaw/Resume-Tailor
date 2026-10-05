// @vitest-environment jsdom
//
// N94 (AC-B4) -- PROVENANCE SURVIVES A SMOOTHING, driven the way a candidate
// drives it. The N92 Wave 3 verifier confirmed by scratchpad probe that after a
// confirmed smoothing the fact keeps its source link and its one-click Remove,
// but no shipped test asserted it. This mounts the REAL DocumentPreviewMount,
// clicks the real Smooth and Apply controls, then asserts on what the strip
// renders and what Remove does -- the handlers are never called directly.
//
// What would turn this red: a smoothing that dropped the record's `url` (the
// source link is rendered from it), its `id` (Remove looks the record up by it),
// or left its locator pointing at the OLD text (Remove excises by locator, so a
// stale one refuses or cuts the wrong span).
//
// Not vacuous: before any smoothing the same link/Remove are asserted present;
// the smoothed text is asserted to be IN the letter after Apply (so the
// smoothing really happened); and Remove is clicked and shown to excise the
// SMOOTHED text while leaving the rest of the letter. The sibling
// coverFactSmoothUndo.rc.test.js covers provenance only AFTER an undo; the unit
// half is lib/coverFacts/smoothTransition.provenance.test.js.
//
// jsdom note: MUI Dialog portals into document.body -> queries go through
// document.

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

const FACT_TEXT = "Acme just opened a Dublin telemetry lab.";
const FACT_URL = "https://news.example.com/acme/dublin-lab";
const FACT_TITLE = "Acme opens a Dublin telemetry lab";
const BODY = `I led the platform team. ${FACT_TEXT} We shipped quickly.`;
const CLOSING = "Sincerely,";
const SMOOTHED = {
  status: "ok",
  before: "Leading the platform team,",
  fact: "we saw Acme just open a Dublin telemetry lab,",
  after: "which let us ship quickly.",
};
const SMOOTHED_FRAGMENT = "we saw Acme just open a Dublin telemetry lab";

function seededEntry() {
  const lines = ["Dear Hiring Manager,", BODY, CLOSING, "Jordan Rivera"];
  return {
    status: "done",
    result: "",
    resultLines: [],
    docxB64: "",
    docxPath: "",
    coverLetterResultLines: lines,
    coverLetterDocxB64: "",
    coverVersionId: "ver-1",
    insertedFacts: [{ id: "art-dublin", text: FACT_TEXT, lineIndex: 1, offset: lines[1].indexOf(FACT_TEXT), url: FACT_URL, title: FACT_TITLE }],
  };
}

let store;
let putBodies;
let probe;
let container = null;
let root = null;

function json(body) {
  return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
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
  store = { facts: [], removed: [], revision: null };
  putBodies = [];
  probe = null;
  globalThis.fetch = vi.fn(async (url, init = {}) => {
    const method = (init.method || "GET").toUpperCase();
    const u = String(url);
    if (u.includes("/api/cover-fact-smooth")) return json({ smoothed: SMOOTHED });
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
const removeButtons = () => [...document.querySelectorAll('[aria-label="Remove this fact"]')];
const sourceLinks = () => [...document.querySelectorAll('[aria-label="Open the source article"]')];
const coverLines = () => probe.tailoringMap[JOB_ID]?.coverLetterResultLines || [];
const letter = () => coverLines().join("\n");

async function clickAndSettle(getButtons, predicate) {
  expect(getButtons().length, "the control is not on screen -- it was never wired").toBeGreaterThan(0);
  await act(async () => {
    getButtons()[0].click();
  });
  for (let n = 0; n < 25; n += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
    if (predicate()) break;
  }
  await flush();
}

describe("a confirmed smoothing keeps the fact's source link and one-click Remove (AC-B4)", () => {
  it("CONTROL: before any smoothing, the source link and Remove are present (so 'survives' is not vacuous)", async () => {
    await mount();
    expect(sourceLinks().length, "no source link on the unsmoothed fact").toBe(1);
    expect(sourceLinks()[0].getAttribute("href")).toBe(FACT_URL);
    expect(removeButtons().length, "no Remove control on the unsmoothed fact").toBe(1);
  });

  it("after Apply the link still points at the SAME source and Remove is still present and enabled", async () => {
    await mount();
    await clickAndSettle(smoothButtons, () => applyButtons().length > 0);
    await clickAndSettle(applyButtons, () => letter().includes(SMOOTHED_FRAGMENT));

    // the smoothing really landed -- otherwise the assertions below measure nothing.
    expect(letter(), "the smoothing did not apply; the provenance checks below would be vacuous").toContain(SMOOTHED_FRAGMENT);
    expect(letter(), "the original fact sentence is still in the letter -- the smoothing did not replace it").not.toContain(FACT_TEXT);

    expect(sourceLinks().length, "the source link was dropped by the smoothing").toBe(1);
    expect(sourceLinks()[0].getAttribute("href"), "the source link no longer points at the original article").toBe(FACT_URL);
    expect(removeButtons().length, "the Remove control was dropped by the smoothing").toBe(1);
    expect(removeButtons()[0].disabled, "Remove is disabled after the smoothing").toBe(false);
    expect(document.body.textContent, "the fact's title vanished from the strip").toContain(FACT_TITLE);

    // the store's record carries the same provenance (what survives a reload).
    const stored = probe.tailoringMap[JOB_ID].insertedFacts;
    expect(stored.length).toBe(1);
    expect(stored[0].id).toBe("art-dublin");
    expect(stored[0].url).toBe(FACT_URL);
    expect(stored[0].title).toBe(FACT_TITLE);
    expect(stored[0].text, "the record's text was not re-located to the smoothed fact").toBe(SMOOTHED.fact);
  });

  it("clicking Remove after a smoothing excises the SMOOTHED fact and leaves the rest of the letter", async () => {
    await mount();
    await clickAndSettle(smoothButtons, () => applyButtons().length > 0);
    await clickAndSettle(applyButtons, () => letter().includes(SMOOTHED_FRAGMENT));
    expect(letter(), "the smoothing did not apply; the removal check would be vacuous").toContain(SMOOTHED_FRAGMENT);

    await clickAndSettle(removeButtons, () => !letter().includes(SMOOTHED_FRAGMENT));

    expect(letter(), "Remove did not excise the smoothed fact (its span was not re-located)").not.toContain(SMOOTHED_FRAGMENT);
    expect(letter(), "Remove left a fragment of the fact behind").not.toContain("Dublin");
    expect(letter(), "Remove damaged the unrelated parts of the letter").toContain(CLOSING);
    expect(removeButtons().length, "the fact is still listed after being removed").toBe(0);
    expect(probe.tailoringMap[JOB_ID].insertedFacts.length, "the removed fact is still in the record list").toBe(0);
    // and the removal reached the store, so a repaint/download rebuild omits it too.
    expect(putBodies.length, "Remove made no write to the store").toBeGreaterThan(1);
  });
});
