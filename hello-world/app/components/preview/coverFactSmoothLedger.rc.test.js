// @vitest-environment jsdom
//
// N94 (N92 Wave 3 follow-ups) -- the ACTIVITY LOG tells the truth about the two
// smoothing outcomes that used to leave a false or missing trace. Driven the way
// a candidate drives it: mount the REAL DocumentPreviewMount, CLICK the real
// Smooth / Apply controls. The ledger is observed through the recordDecision
// seam (a spy over the real module, the confirmPersist.rc.test.js idiom) -- never
// through the handlers' internals.
//
//   (2) Apply whose save is REFUSED (the real PUT answers 409) used to log
//       fact-smooth "acted" regardless -- a success claim on a failure. It must
//       log the existing "failed" outcome with the existing "save-failed" code.
//   (3) Smoothing a SECOND fact (or re-smoothing the same one, or a second smooth
//       that fails) used to drop the still-pending first candidate with NO ledger
//       trace. The dropped candidate must be recorded as the existing
//       "refused" / "declined" decision -- the same record Discard writes.
//
// Vocabulary is the ledger's own (DECISION_OUTCOMES + the codes smoothTransition.js
// and the sibling fact-position entry already use); no new outcome is minted.
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
const FACT_B = "Acme also hired forty engineers.";
const BODY_A = `I led the platform team. ${FACT_A} We shipped quickly.`;
const BODY_B = `I also built the tooling. ${FACT_B} It scaled well.`;
// Reply for fact A's paragraph -- reuses only in-scope tokens, so the added-token
// guard passes. Reply for fact B's paragraph likewise.
const SMOOTHED_A = {
  status: "ok",
  before: "Leading the platform team,",
  fact: "we saw Acme just open a Dublin telemetry lab,",
  after: "which let us ship quickly.",
};
const SMOOTHED_B = {
  status: "ok",
  before: "Building the tooling,",
  fact: "we saw Acme also hire forty engineers,",
  after: "which helped it scale well.",
};
const FRAGMENT_A = "we saw Acme just open a Dublin telemetry lab";

function factRecord(id, text, lineIndex, line) {
  return { id, text, lineIndex, offset: line.indexOf(text), url: `https://news.example.com/${id}`, title: `Source for ${id}` };
}

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
let probe;
let container = null;
let root = null;
let smoothGate = null;
let applyShouldFail = false;
// Which reply the smooth endpoint gives, chosen from the request's fact sentence;
// "fail" makes the next smooth request answer 502 (a failed produce).
let smoothMode = "ok";

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

function Probe() {
  const [tailoringMap, setTailoringMap] = useState({ [JOB_ID]: twoFactEntry() });
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
  smoothGate = null;
  applyShouldFail = false;
  smoothMode = "ok";
  globalThis.fetch = vi.fn(async (url, init = {}) => {
    const method = (init.method || "GET").toUpperCase();
    const u = String(url);
    if (u.includes("/api/cover-fact-smooth")) {
      const body = init.body ? JSON.parse(init.body) : {};
      if (smoothGate) await smoothGate.promise;
      if (smoothMode === "fail") return json({ error: "boom" }, 502);
      return json({ smoothed: String(body.factText || "").includes("forty engineers") ? SMOOTHED_B : SMOOTHED_A });
    }
    if (u.includes("/api/company-research")) return json({ articles: [], warnings: [] });
    if (u.includes("/api/accepted-facts")) {
      if (method === "GET") return json({ facts: store.facts, removed: store.removed, revision: store.revision });
      const body = JSON.parse(init.body);
      putBodies.push(body);
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
const discardButtons = () => [...document.querySelectorAll('[aria-label="Discard the smoothed version"]')];
const coverLines = () => probe.tailoringMap[JOB_ID]?.coverLetterResultLines || [];
const letter = () => coverLines().join("\n");

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

const smoothCalls = (outcome, code) =>
  recordDecision.mock.calls.filter(
    (c) => c[0] === "fact-smooth" && (outcome ? c[1] === outcome : true) && (code ? c[2]?.code === code : true),
  );
const declinedCount = () => smoothCalls("refused", "declined").length;

describe("(2) an Apply whose save is refused is logged as failed, never acted", () => {
  it("CONTROL: an Apply that lands is logged 'acted' exactly once", async () => {
    await mount();
    await clickAndSettle(() => [smoothButtons()[0]], () => applyButtons().length > 0);
    await clickAndSettle(applyButtons, () => letter().includes(FRAGMENT_A));

    expect(letter(), "the apply did not land -- the control is vacuous").toContain(FRAGMENT_A);
    expect(smoothCalls("acted", "smoothed").length, "a landed apply must log exactly one 'acted'").toBe(1);
    expect(smoothCalls("failed", "save-failed").length).toBe(0);
  });

  it("a 409 on the save logs 'failed' / 'save-failed' and NO 'acted'; the letter is unchanged", async () => {
    await mount();
    const before = letter();
    await clickAndSettle(() => [smoothButtons()[0]], () => applyButtons().length > 0);
    applyShouldFail = true;
    const putsBefore = putBodies.length;
    await clickAndSettle(applyButtons, () => applyButtons().length === 0);

    expect(putBodies.length, "the save was never attempted -- the failure was not simulated").toBeGreaterThan(putsBefore);
    expect(letter(), "a refused save changed the letter").toBe(before);
    expect(smoothCalls("acted").length, "the activity log claims the smoothing was applied although the save was refused").toBe(0);
    expect(smoothCalls("failed", "save-failed").length, "the refused save left no 'failed' / 'save-failed' record").toBe(1);
  });
});

describe("(3) a pending candidate that is superseded is recorded as declined", () => {
  it("CONTROL: with only fact A pending nothing is recorded as declined yet", async () => {
    await mount();
    await clickAndSettle(() => [smoothButtons()[0]], () => applyButtons().length > 0);
    expect(applyButtons().length, "no pending candidate -- the supersede tests below would be vacuous").toBe(1);
    expect(declinedCount(), "a pending (not yet dropped) candidate was already recorded as declined").toBe(0);
  });

  it("smoothing a SECOND fact while the first is pending records the first as 'refused' / 'declined'", async () => {
    await mount();
    await clickAndSettle(() => [smoothButtons()[0]], () => applyButtons().length > 0);
    expect(declinedCount()).toBe(0);

    await clickAndSettle(() => [smoothButtons()[1]], () => declinedCount() > 0);

    expect(declinedCount(), "the pending candidate for fact A was dropped with no decline recorded").toBe(1);
    // the surface now shows ONE candidate (fact B's) -- A's was really replaced, not stacked.
    expect(applyButtons().length, "expected only the second candidate's confirm surface").toBe(1);
    // nothing was applied or persisted by the supersede.
    expect(smoothCalls("acted").length).toBe(0);
    expect(putBodies.length, "superseding a candidate wrote to the store").toBe(0);
  });

  it("re-smoothing the SAME fact while its candidate is pending records the replaced one as declined", async () => {
    await mount();
    await clickAndSettle(() => [smoothButtons()[0]], () => applyButtons().length > 0);
    await clickAndSettle(() => [smoothButtons()[0]], () => declinedCount() > 0);

    expect(declinedCount(), "the replaced candidate for the same fact left no decline").toBe(1);
    expect(applyButtons().length).toBe(1);
  });

  it("a second smooth that FAILS also drops the pending first candidate -- and records it", async () => {
    await mount();
    await clickAndSettle(() => [smoothButtons()[0]], () => applyButtons().length > 0);
    smoothMode = "fail";
    await clickAndSettle(() => [smoothButtons()[1]], () => applyButtons().length === 0);

    expect(applyButtons().length, "the failed second smooth did not drop the first candidate -- test premise changed").toBe(0);
    expect(declinedCount(), "the dropped first candidate left no decline in the log").toBe(1);
    expect(smoothCalls("failed", "provider_error").length, "the failed second produce itself must still be logged").toBe(1);
  });

  it("a candidate APPLIED while a second smooth is still in flight is NOT recorded as declined", async () => {
    await mount();
    await clickAndSettle(() => [smoothButtons()[0]], () => applyButtons().length > 0);

    // hold fact B's produce open, then apply fact A's candidate underneath it.
    smoothGate = makeDeferred();
    await act(async () => {
      smoothButtons()[1].click();
    });
    await flush();
    expect(applyButtons().length, "fact A's confirm surface vanished before the second produce resolved").toBe(1);
    await clickAndSettle(applyButtons, () => letter().includes(FRAGMENT_A));
    expect(letter(), "fact A's apply did not land -- the race was not set up").toContain(FRAGMENT_A);

    smoothGate.resolve();
    smoothGate = null;
    await clickAndSettle(() => [document.body], () => applyButtons().length > 0);

    expect(smoothCalls("acted", "smoothed").length, "fact A's apply must be logged acted").toBe(1);
    expect(declinedCount(), "an APPLIED candidate was also logged as declined (a contradictory ledger)").toBe(0);
  });

  it("Discard still records exactly one decline (the supersede record is the same one, not a second)", async () => {
    await mount();
    await clickAndSettle(() => [smoothButtons()[0]], () => applyButtons().length > 0);
    await clickAndSettle(discardButtons, () => applyButtons().length === 0);

    expect(declinedCount(), "Discard must record one decline, no more and no fewer").toBe(1);
  });
});
