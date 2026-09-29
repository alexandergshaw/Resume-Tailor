// @vitest-environment jsdom
//
// N95 (perceived-smoothness pass) -- CONFIRM feedback: the smooth PRODUCE (LLM
// round-trip, the longest silent wait in the feature) and the smooth APPLY
// steps show a working indicator, cannot double-fire, and are announced.
// Driven the way a candidate drives it (the sibling coverFactSmoothConfirm.rc
// .test.js is the template): mount the REAL DocumentPreviewMount, CLICK the
// real Smooth / Apply / Discard controls. The handlers are NEVER called
// directly.
//
// The in-flight windows are HONEST: the produce fetch (/api/cover-fact-smooth)
// and the apply PUT (/api/accepted-facts) are each GATED on a promise this test
// controls (a delayed promise, loop-tdd rule 13), so the op is genuinely
// mid-flight while the marker / second-click assertions run.
//
// RED-on-HEAD (verified this round): handleSmooth (DocumentPreviewMount.js
// :370-386) awaits with no pending state and no disable -> spammable, no marker;
// CoverFactSmoothConfirm's Apply/Discard (:28,:31) have no disabled prop ->
// Apply double-fires; nothing announces either step.
//
// jsdom note: MUI's Dialog portals into document.body -> queries go through
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
const BODY = `I led the platform team. ${FACT_TEXT} We shipped quickly.`;
const SMOOTHED = {
  status: "ok",
  before: "Leading the platform team,",
  fact: "we saw Acme just open a Dublin telemetry lab,",
  after: "which let us ship quickly.",
};
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
    coverLetterDocxB64: "",
    coverVersionId: "ver-1",
    insertedFacts: [
      { id: "art-dublin", text: FACT_TEXT, lineIndex: 1, offset: lines[1].indexOf(FACT_TEXT), url: "https://news.example.com/x", title: "T" },
    ],
  };
}

let store;
let putBodies;
let smoothRequests;
let probe;
let container = null;
let root = null;
let smoothGate = null;
let putGate = null;
let applyShouldFail = false;

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
  smoothGate = null;
  putGate = null;
  applyShouldFail = false;
  globalThis.fetch = vi.fn(async (url, init = {}) => {
    const method = (init.method || "GET").toUpperCase();
    const u = String(url);
    if (u.includes("/api/cover-fact-smooth")) {
      smoothRequests.push(init.body ? JSON.parse(init.body) : null);
      if (smoothGate) await smoothGate.promise;
      return json({ smoothed: SMOOTHED });
    }
    if (u.includes("/api/company-research")) return json({ articles: [], warnings: [] });
    if (u.includes("/api/accepted-facts")) {
      if (method === "GET") return json({ facts: store.facts, removed: store.removed, revision: store.revision });
      const body = JSON.parse(init.body);
      putBodies.push(body);
      if (putGate) await putGate.promise;
      if (applyShouldFail) return json({ error: "The letter's saved copy is out of date." }, 409);
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
  if (smoothGate) {
    smoothGate.resolve();
    smoothGate = null;
  }
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
const afterRegion = () => document.querySelector("[data-smooth-after]");
const politeText = () =>
  [...document.querySelectorAll('[data-copy-status="polite"]')].map((n) => n.textContent || "").join(" | ");
const progressbars = () => [...document.querySelectorAll('[role="progressbar"]')];

function rowBusy(btn) {
  return !!(btn && btn.closest('[aria-busy="true"]'));
}

// Click and let the async op settle to a predicate (or timeout).
async function clickAndSettle(getButtons, predicate, i = 0) {
  expect(getButtons().length, "the control is not on screen -- it was never wired").toBeGreaterThan(i);
  await act(async () => {
    getButtons()[i].click();
  });
  for (let n = 0; n < 30; n += 1) {
    await act(async () => {
      await new Promise((r) => setTimeout(r, 10));
    });
    if (predicate()) break;
  }
  await flush();
}

describe("AC-S1: the smooth PRODUCE step shows a marker and cannot double-fire", () => {
  it("marks the row busy during the LLM round-trip and dispatches no second produce on a second click", async () => {
    await mount("gemini");
    expect(smoothButtons().length).toBe(1);
    expect(rowBusy(smoothButtons()[0]), "the row is busy before any smooth -- the marker is meaningless").toBe(false);

    smoothGate = makeDeferred(); // hold the produce round-trip open
    await act(async () => {
      smoothButtons()[0].click();
    });
    await flush();

    expect(smoothRequests.length, "the produce request never fired -- the button is not wired").toBe(1);
    // in-flight marker present (RED on HEAD: handleSmooth awaits with no pending state)
    expect(rowBusy(smoothButtons()[0]), "no in-flight marker during the smooth produce -- the longest silent wait").toBe(true);
    // any spinner glyph must be aria-hidden (N84: a bare unnamed spinner is not an announcement)
    for (const pb of progressbars()) {
      expect(pb.getAttribute("aria-hidden"), "a smooth spinner is not aria-hidden (N84 draw-not-announce)").toBe("true");
    }

    // a second click mid-flight launches NO second produce (RED on HEAD)
    await act(async () => {
      smoothButtons()[0].click();
    });
    await flush();
    expect(smoothRequests.length, "a second click launched a second LLM produce").toBe(1);

    // clears on resolve (proposed)
    smoothGate.resolve();
    smoothGate = null;
    await clickAndSettle(() => [document.body], () => applyButtons().length > 0);
    expect(rowBusy(smoothButtons()[0]), "the produce marker outlived the resolved round-trip").toBe(false);
    expect(applyButtons().length, "the confirm surface never appeared after a resolved produce").toBe(1);
  });
});

describe("AC-S4 (GUARD): a pending produce does not leak the confirm surface", () => {
  it("shows no before/after surface while the produce is still in flight", async () => {
    await mount("gemini");
    smoothGate = makeDeferred();
    await act(async () => {
      smoothButtons()[0].click();
    });
    await flush();
    // pending-produce must not mount the confirm surface (CoverFactSmoothConfirm
    // returns null unless status==="proposed"). Passes on HEAD; a guard against
    // the pending UI leaking an unconfirmed candidate early.
    expect(applyButtons().length, "the confirm surface leaked during a pending produce").toBe(0);
    expect(afterRegion(), "the smoothed 'after' leaked before the candidate was proposed").toBeNull();
    smoothGate.resolve();
    smoothGate = null;
    await flush();
  });
});

describe("AC-S2: the smooth APPLY step shows a marker and Apply/Discard cannot double-fire", () => {
  it("dispatches exactly one applySmoothedFact and disables both buttons in flight", async () => {
    await mount("gemini");
    await clickAndSettle(smoothButtons, () => applyButtons().length > 0);
    expect(applyButtons().length, "no confirm surface to apply from -- test would be vacuous").toBe(1);

    const putsBefore = putBodies.length;
    putGate = makeDeferred(); // hold the apply persist open
    await act(async () => {
      applyButtons()[0].click();
    });
    await flush();

    // exactly one persist dispatched, and BOTH buttons are guarded (RED on HEAD)
    expect(putBodies.length, "Apply did not dispatch a persist").toBe(putsBefore + 1);
    expect(applyButtons()[0]?.disabled, "Apply is not disabled in flight -- it can double-fire").toBe(true);
    expect(discardButtons()[0]?.disabled, "Discard is not disabled while Apply is in flight").toBe(true);

    await act(async () => {
      applyButtons()[0].click();
    });
    await flush();
    expect(putBodies.length, "a second Apply click launched a second persist").toBe(putsBefore + 1);

    // settles and the surface dismisses
    putGate.resolve();
    putGate = null;
    await clickAndSettle(() => [document.body], () => applyButtons().length === 0);
    expect(applyButtons().length, "the confirm surface stayed open after a settled apply").toBe(0);
    expect(coverLines().join("\n"), "the applied smoothing did not reach the letter").toContain(SMOOTHED_FRAGMENT);
  });

  it("does not leave Apply stuck-disabled when the persist fails (finally-clear, R8)", async () => {
    await mount("gemini");
    await clickAndSettle(smoothButtons, () => applyButtons().length > 0);
    applyShouldFail = true;
    await clickAndSettle(applyButtons, () => applyButtons().length === 0);
    // the surface must not be left open with a permanently-disabled Apply.
    if (applyButtons().length > 0) {
      expect(applyButtons()[0].disabled, "Apply is stuck disabled after a failed persist (spins forever, R8)").toBe(false);
    } else {
      expect(applyButtons().length).toBe(0);
    }
  });
});

describe("AC-S3: the smooth steps are ANNOUNCED via a live region", () => {
  it("lands a produce/apply outcome in a polite region", async () => {
    await mount("gemini");
    expect(politeText(), "a polite region already carries smooth text before any action").not.toMatch(/smooth/i);

    await clickAndSettle(smoothButtons, () => applyButtons().length > 0);
    // produce announced (RED on HEAD: no announcement)
    expect(politeText(), "the smooth produce was never announced").toMatch(/smooth/i);
  });
});

describe("NO-OP control: a settled produce leaves no stuck marker", () => {
  it("clears the busy marker once the produce resolves to a candidate", async () => {
    await mount("gemini");
    await clickAndSettle(smoothButtons, () => applyButtons().length > 0);
    // A build that hardwired the busy marker on would fail here.
    expect(document.querySelector('[aria-busy="true"]'), "a settled produce left a stuck busy marker").toBeNull();
  });
});

function coverLines() {
  return probe.tailoringMap[JOB_ID]?.coverLetterResultLines || [];
}
