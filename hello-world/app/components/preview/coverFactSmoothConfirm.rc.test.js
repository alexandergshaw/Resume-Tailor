// @vitest-environment jsdom
//
// N92 Wave 3 (Control B) -- REACHABILITY + CONFIRM-BEFORE-PERSIST, driven the
// way a candidate drives it (loop-tdd rule 2; the sibling moveInsertedFact.rc
// .test.js is the template). Mount the REAL DocumentPreviewMount (which renders
// the REAL DocumentPreviewDialog + InsertedFactsStrip + the confirm surface),
// then CLICK the real smooth control and the real Apply/Discard buttons. The
// smoothing handlers are NEVER called directly: a direct call cannot prove a user
// can reach the control, and it cannot prove the button is WIRED to produce ->
// show -> confirm at all -- exactly the "form with no save wiring / panel with no
// opening button" class of defect this seat exists to prevent.
//
// The guarantee under test is the owner ruling (D7): NOTHING smoothed reaches the
// letter, the store, or a download until the user clicks Apply on the shown diff
// (AC-B10); the applied text IS the shown text (AC-B12); Discard restores the
// original (AC-B11); on embedded the control is disabled (AC-B9).
//
// RED ON HEAD: no smooth control, no confirm surface, and no
// lib/coverFacts/smoothTransition.js exist, so the button never renders and every
// assertion that one is present/clickable reds. jsdom note: MUI Dialog portals
// into document.body, so DOM queries go through `document`.

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
// The three in-scope sentences, seeded so the smoothed output is deterministic.
const BODY = `I led the platform team. ${FACT_TEXT} We shipped quickly.`;
// The engine's smoothed reply -- reuses only in-scope tokens (proper names Acme/
// Dublin already present; no new numbers), so the added-token guard passes.
const SMOOTHED = {
  status: "ok",
  before: "Leading the platform team,",
  fact: "we saw Acme just open a Dublin telemetry lab,",
  after: "which let us ship quickly.",
};
// The fragment the smoothed fact sentence carries -- what the surface shows and
// what the applied lines must equal (AC-B12).
const SMOOTHED_FRAGMENT = "we saw Acme just open a Dublin telemetry lab";

function seededEntry() {
  const lines = ["Dear Hiring Manager,", BODY, "Sincerely,", "Jordan Rivera"];
  return {
    status: "done",
    result: "",
    resultLines: [],
    docxB64: "",
    docxPath: "",
    coverLetterResultLines: lines,
    coverLetterDocxB64: "", // no bytes -> the apply path rebuilds from lines (deterministic)
    coverVersionId: "ver-1",
    insertedFacts: [
      {
        id: "art-dublin",
        text: FACT_TEXT,
        lineIndex: 1,
        offset: lines[1].indexOf(FACT_TEXT),
        url: "https://news.example.com/acme/dublin-lab",
        title: "Acme opens a Dublin telemetry lab",
      },
    ],
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

function Probe({ engine }) {
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

async function mount(engine = "gemini") {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root.render(createElement(Probe, { engine }));
  });
  await flush();
  await act(async () => {
    probe.preview.openResumePreview(JOB, { tab: "cover" });
  });
  await flush();
}

const smoothButtons = () => [...document.querySelectorAll('[aria-label="Smooth the transition into this fact"]')];
const applyButtons = () => [...document.querySelectorAll('[aria-label="Apply the smoothed version"]')];
const discardButtons = () => [...document.querySelectorAll('[aria-label="Discard the smoothed version"]')];
const afterRegion = () => document.querySelector('[data-smooth-after]');

function coverLines() {
  return probe.tailoringMap[JOB_ID]?.coverLetterResultLines || [];
}

// Click a control and let the async produce/apply settle.
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

describe("the smooth control is reachable, and engine-gated (AC-B9/X2)", () => {
  it("renders one smooth control per inserted fact on the AI engine", async () => {
    await mount("gemini");
    expect(coverLines().join("\n")).toContain(FACT_TEXT);
    expect(smoothButtons().length, "no smooth control rendered -- the strip is not wired for onSmooth").toBe(1);
    expect(smoothButtons()[0].disabled, "the smooth control is disabled on the AI engine").toBe(false);
  });

  it("disables the smooth control on the embedded (no-LLM) engine, announced not silent", async () => {
    await mount("embedded");
    expect(smoothButtons().length, "the smooth control must still render (disabled), so the reason is visible").toBe(1);
    expect(smoothButtons()[0].disabled, "the smooth control is live on embedded -- it would fire a call the engine cannot make").toBe(true);
  });
});

describe("confirm-before-persist: nothing is written until the user clicks Apply (AC-B10/B12)", () => {
  it("clicking smooth shows a before/after and writes NOTHING to the store or the letter", async () => {
    await mount("gemini");
    const before = coverLines().join("\n");
    const putsBefore = putBodies.length;

    await clickAndSettle(smoothButtons, () => applyButtons().length > 0 || afterRegion());

    // the engine WAS asked (positive control: the produce half fired)...
    expect(smoothRequests.length, "the smooth request never fired -- the button is not wired to produce").toBe(1);
    // ...the confirm surface is shown...
    expect(applyButtons().length, "no Apply control appeared -- the confirm surface is not reachable").toBe(1);
    expect(discardButtons().length, "no Discard control appeared").toBe(1);
    // ...but NOTHING is persisted and the letter is byte-identical (the whole ruling).
    expect(putBodies.length, "smoothing persisted to the store BEFORE the user confirmed").toBe(putsBefore);
    expect(coverLines().join("\n"), "the letter changed before the user confirmed the diff").toBe(before);
  });

  it("clicking Apply persists EXACTLY the shown 'after' text (AC-B12)", async () => {
    await mount("gemini");
    await clickAndSettle(smoothButtons, () => applyButtons().length > 0);

    // capture the after text the surface actually SHOWS the user.
    const shown = (afterRegion()?.textContent || "").trim();
    expect(shown, "the confirm surface shows no 'after' text to approve").toContain(SMOOTHED_FRAGMENT);

    const putsBefore = putBodies.length;
    await clickAndSettle(applyButtons, () => putBodies.length > putsBefore || coverLines().join("\n").includes(SMOOTHED_FRAGMENT));

    // the store write fired, and the applied lines carry exactly the shown text.
    expect(putBodies.length, "Apply made no write to the store").toBeGreaterThan(putsBefore);
    const put = putBodies[putBodies.length - 1];
    expect(put.coverVersion, "a confirmed smoothing must persist a coverVersion").toBeTruthy();
    const appliedText = put.coverVersion.lines.join("\n");
    expect(appliedText, "the applied letter does not contain the shown smoothed text (show-one-apply-another)").toContain(SMOOTHED_FRAGMENT);
    expect(coverLines().join("\n"), "the on-screen letter did not update to the smoothed text").toContain(SMOOTHED_FRAGMENT);
    // and the confirm surface is dismissed after applying.
    expect(applyButtons().length, "the confirm surface stayed open after Apply").toBe(0);
  });
});

describe("decline discards and restores the original (AC-B11)", () => {
  it("clicking Discard writes nothing and leaves the letter byte-identical", async () => {
    await mount("gemini");
    const before = coverLines().join("\n");
    await clickAndSettle(smoothButtons, () => discardButtons().length > 0);
    const putsBefore = putBodies.length;

    await clickAndSettle(discardButtons, () => discardButtons().length === 0);

    expect(putBodies.length, "a decline wrote to the store").toBe(putsBefore);
    expect(coverLines().join("\n"), "a decline changed the letter").toBe(before);
    expect(applyButtons().length, "the confirm surface stayed open after Discard").toBe(0);
    // the fact and its original text are still there, unsmoothed.
    expect(coverLines().join("\n")).toContain(FACT_TEXT);
  });
});
