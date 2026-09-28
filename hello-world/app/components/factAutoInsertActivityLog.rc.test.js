// @vitest-environment jsdom
//
// N77 -- THE AUTO-INSERT MUST RECORD WHAT IT DID TO THE APP-WIDE ACTIVITY LOG,
// SUCCESS OR REFUSAL, WITH THE REASON.
//
// WHY THIS EXISTS (owner's real session, 2026-09-28). The owner reported the
// feature "not occurring". Their downloaded activity log showed two successful
// /api/company-research calls and NO /api/accepted-facts request at all -- not
// even the GET that autoInsertFactsForJob issues first. So the insert either
// never ran or refused at one of its first four gates (no open surface / no
// cover letter / no engine bytes / already edited), every one of which returns
// BEFORE any network call and is therefore INVISIBLE in a log whose only view
// of this feature is the network. A whole feature is undiagnosable in the log
// designed to explain the session. The fix: the feature records itself, the way
// the duplicate-apply check already does
// (app/hooks/useDuplicateApplyCheck.js:124 -> `recordActivity("act",
// "duplicate-check.<kind>", {...})`, closed-vocabulary fields only), so a
// refusal that is silent on screen is at least legible in the file.
//
// WHAT IS PINNED (all RED on HEAD, where the feature records nothing):
//   1. A SUCCESSFUL auto-insert records an "act" event naming HOW MANY facts it
//      inserted.
//   2. EVERY refusal records an "act" event, and DIFFERENT refusals produce
//      DISTINGUISHABLE events (a diagnoser must tell them apart -- that is the
//      whole point).
//   3. A refusal that returns BEFORE any network call (the engine-bytes gate)
//      is STILL recorded -- these are exactly the cases the owner's log could
//      not distinguish.
//   4. The recorded event carries NO fact text and NO letter body text. The log
//      is downloaded and shared; redactSecretsDeep (appActivityLog.js:136) does
//      NOT strip ordinary prose, so this has real teeth: the feature must pass
//      only counts and a reason, never content.
//
// REACHABILITY: every event is produced by mounting the REAL DocumentPreviewMount
// and opening the preview the way page.js does -- never by calling
// autoInsertFactsForJob or recordActivity from a test body. The log is read back
// from the SAME module singleton production writes to
// (@/lib/activityLog/appActivityLog.js), so nothing here stubs the recorder.
//
// The singleton accumulates across this file's tests, so every assertion is on
// the DELTA since a per-test baseline seq (loop-traps: shared state must be
// scoped per assertion). Only feature code can add "act" events here -- network
// / nav instrumentation is never installed in this harness -- so a new "act"
// event is unambiguously the auto-insert's own.
//
// jsdom notes: MUI Dialog portals to document.body; act() serializes async, so
// what is proven is ORDERING not concurrency (backlog N74).

import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from "vitest";
import { createElement, useState, act } from "react";
import { createRoot } from "react-dom/client";

import { useCompanyResearch } from "../hooks/useCompanyResearch.js";
import { useDocumentPreview } from "../hooks/useDocumentPreview.js";
import DocumentPreviewMount from "./DocumentPreviewMount.js";
import { sanitizeStoredFacts } from "@/lib/acceptedFacts/factStore.js";
import { embeddedEngine } from "@/lib/llm/engines/tailor-lite/engine.js";
import { activityLogSnapshot } from "@/lib/activityLog/appActivityLog.js";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const JOB_ID = "job-1";
const JOB = { id: JOB_ID, title: "Staff Engineer", company: "Acme", description: "React, Node, telemetry." };

const VALID_1 = {
  title: "Acme opens a Dublin telemetry lab",
  url: "https://news.example.com/acme/dublin-lab",
  source: "news.example.com",
  summary: "Acme has opened a new telemetry lab in Dublin.",
  suggestion: "I was glad to see Acme opened a Dublin telemetry lab, and it is part of what draws me to this role.",
};
const VALID_2 = {
  title: "Acme wins a sustainability award",
  url: "https://press.example.org/acme/award",
  source: "press.example.org",
  summary: "Acme received a national sustainability award.",
  suggestion: "Acme winning a national sustainability award is a big reason I am excited about this opportunity.",
};
// Real url + title, empty suggestion (the no-Gemini-key shape).
const KEYLESS = {
  title: "Acme mentioned in a market roundup",
  url: "https://roundup.example.net/acme",
  source: "roundup.example.net",
  summary: "A market roundup mentioned Acme.",
  suggestion: "",
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
let researchArticles = [];
let probe = null;
let container = null;
let root = null;

function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });
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
  researchArticles = [];
  probe = null;
  globalThis.fetch = vi.fn(async (url, init = {}) => {
    const method = (init.method || "GET").toUpperCase();
    const u = String(url);
    if (u.includes("/api/company-research")) {
      return json({ articles: researchArticles, warnings: [] });
    }
    if (u.includes("/api/accepted-facts")) {
      if (method === "GET") return json({ facts: store.facts, removed: store.removed, revision: store.revision });
      const body = JSON.parse(init.body);
      store = {
        facts: sanitizeStoredFacts(body.facts),
        removed: Array.isArray(body.declinedUrls) ? body.declinedUrls : [],
        revision: (store.revision ?? 0) + 1,
      };
      return json({ facts: store.facts, removed: store.removed, revision: store.revision });
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

async function tick() {
  await act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 10));
  });
}
async function flushMicro(times = 6) {
  for (let i = 0; i < times; i += 1) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}
async function waitFor(predicate, maxTicks = 80) {
  for (let i = 0; i < maxTicks; i += 1) {
    if (predicate()) return true;
    await tick();
  }
  return predicate();
}

async function mount(initialMap) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root.render(createElement(Probe, { initialMap }));
  });
  await flushMicro();
}

async function openCoverPreview() {
  await act(async () => {
    probe.preview.openResumePreview(JOB, { tab: "cover" });
  });
  await flushMicro();
}

// ---------------------------------------------------------------------------
// LOG READERS. `actEvents()` is every "act" channel event in the live
// singleton. `maxSeq()` is the high-water mark used as a per-test baseline;
// `newActEvents(sinceSeq)` returns the "act" events recorded after it. The
// canonical fields (seq/at/t/channel/type) are excluded from CONTENT reasoning
// so a coincidental `t` or `seq` value can never satisfy a "carries the count"
// assertion.
// ---------------------------------------------------------------------------
function actEvents() {
  const snap = activityLogSnapshot();
  return (snap?.events || []).filter((e) => e && e.channel === "act");
}
function maxSeq() {
  const all = activityLogSnapshot()?.events || [];
  return all.reduce((m, e) => (e && typeof e.seq === "number" && e.seq > m ? e.seq : m), 0);
}
function newActEvents(sinceSeq) {
  return actEvents().filter((e) => typeof e.seq === "number" && e.seq > sinceSeq);
}
const CANONICAL = new Set(["seq", "at", "t", "channel", "type"]);
function payloadValues(event) {
  return Object.entries(event)
    .filter(([k]) => !CANONICAL.has(k))
    .map(([, v]) => v);
}
// The full recorded signature minus the timestamps/seq that vary between two
// otherwise-identical events -- used to test that two refusals are
// DISTINGUISHABLE by cause, not merely by when they happened.
function signature(event) {
  const clone = { ...event };
  delete clone.seq;
  delete clone.at;
  delete clone.t;
  return JSON.stringify(clone);
}
function acceptedFactsRequestCount() {
  return globalThis.fetch.mock.calls.filter(([url]) => String(url).includes("/api/accepted-facts")).length;
}

describe("N77 activity log: a SUCCESSFUL auto-insert records how many facts it added (req 1)", () => {
  it("records exactly one 'act' event whose payload names the inserted count (2)", async () => {
    researchArticles = [VALID_1, VALID_2];
    await mount({ [JOB_ID]: entryWithEngineLetter() });
    const base = maxSeq();
    await openCoverPreview();

    const inserted = await waitFor(
      () => (probe.tailoringMap[JOB_ID]?.insertedFacts || []).length === 2,
    );
    expect(inserted, "the two facts did not auto-insert, so the success-log premise is vacuous").toBe(true);

    const events = await waitForEvents(base);
    expect(events.length, "a successful auto-insert recorded NOTHING in the activity log (RED on HEAD)").toBe(1);
    const [ev] = events;
    expect(ev.type, "the recorded event has no usable type discriminator").not.toBe("unknown");
    // The count is present as a real payload value (not seq/at/t): two facts in,
    // a `2` out. A one-fact run below proves this tracks the real number.
    expect(
      payloadValues(ev),
      "the success event does not carry the number of facts inserted (2)",
    ).toContain(2);
  });

  it("the recorded count TRACKS the real number: a one-fact insert records 1, not 2", async () => {
    researchArticles = [VALID_1];
    await mount({ [JOB_ID]: entryWithEngineLetter() });
    const base = maxSeq();
    await openCoverPreview();

    const inserted = await waitFor(() => (probe.tailoringMap[JOB_ID]?.insertedFacts || []).length === 1);
    expect(inserted, "the single fact did not auto-insert").toBe(true);
    const events = await waitForEvents(base);
    expect(events.length, "a successful auto-insert recorded nothing (RED on HEAD)").toBe(1);
    expect(payloadValues(events[0]), "the success event should carry 1, the real inserted count").toContain(1);
    expect(payloadValues(events[0]), "the success event carried 2 for a one-fact insert -- the count is hardcoded, not measured").not.toContain(2);
  });
});

describe("N77 activity log: every refusal is recorded, and refusals are DISTINGUISHABLE (req 2 + req 3)", () => {
  it("engine-bytes gate (BEFORE any network call) is recorded even though no /api/accepted-facts request is ever made (req 3)", async () => {
    researchArticles = [VALID_1];
    await mount({ [JOB_ID]: entryWithEngineLetter({ coverLetterDocxB64: "" }) });
    const base = maxSeq();
    await openCoverPreview();

    const events = await waitForEvents(base);
    expect(
      events.length,
      "a pre-network refusal (engine bytes missing) recorded NOTHING -- exactly the case the owner's log could not see (RED on HEAD)",
    ).toBe(1);
    // Proof it really was pre-network: the auto-insert issued no accepted-facts
    // request at all, yet the log still carries the event.
    expect(
      acceptedFactsRequestCount(),
      "this gate was expected to refuse before any accepted-facts request; harness assumption broke",
    ).toBe(0);
    expect(events[0].type, "the pre-network refusal event has no usable type").not.toBe("unknown");
  });

  it("three different refusals record three DISTINGUISHABLE events (a diagnoser must tell them apart)", async () => {
    // (a) engine bytes missing
    researchArticles = [VALID_1];
    await mount({ [JOB_ID]: entryWithEngineLetter({ coverLetterDocxB64: "" }) });
    let base = maxSeq();
    await openCoverPreview();
    const evBytes = (await waitForEvents(base))[0];
    await remount();

    // (b) already-edited cover letter (deliberate; RULING: silent on screen but
    // ALWAYS logged, so a diagnoser can see WHY facts did not arrive for an
    // edited letter -- otherwise indistinguishable from a broken feature).
    researchArticles = [VALID_1];
    await mount({ [JOB_ID]: entryWithEngineLetter({ edited: { resume: false, cover: true } }) });
    base = maxSeq();
    await openCoverPreview();
    const evEdited = (await waitForEvents(base))[0];
    await remount();

    // (c) key-less: articles arrived but none carried a usable sentence
    researchArticles = [KEYLESS];
    await mount({ [JOB_ID]: entryWithEngineLetter() });
    base = maxSeq();
    await openCoverPreview();
    const evKeyless = (await waitForEvents(base))[0];

    // Each refusal was recorded (RED on HEAD: all three are undefined)...
    expect(evBytes, "engine-bytes refusal recorded nothing (RED on HEAD)").toBeTruthy();
    expect(evEdited, "already-edited refusal recorded nothing (RED on HEAD)").toBeTruthy();
    expect(evKeyless, "key-less refusal recorded nothing (RED on HEAD)").toBeTruthy();

    // ...and no two of them look alike once timestamps are removed. If the
    // feature logged one flat "refused" for every cause, the owner's log would
    // be no more diagnostic than the silence it replaced.
    const sigs = [signature(evBytes), signature(evEdited), signature(evKeyless)];
    expect(new Set(sigs).size, "two or more refusals recorded IDENTICAL events -- the reasons are not distinguishable in the log").toBe(3);
  });
});

describe("N77 activity log: the event never carries fact or letter content (req 4)", () => {
  it("a successful insert's event contains neither the inserted suggestion nor the letter body", async () => {
    researchArticles = [VALID_1];
    await mount({ [JOB_ID]: entryWithEngineLetter() });
    const base = maxSeq();
    await openCoverPreview();

    const inserted = await waitFor(() => (probe.tailoringMap[JOB_ID]?.insertedFacts || []).length === 1);
    expect(inserted, "the fact did not insert, so the redaction premise is vacuous").toBe(true);
    const events = await waitForEvents(base);
    // Event-exists FIRST -- otherwise the not.toContain checks below are
    // vacuously true against an absent event (loop-traps: a negative assertion
    // on nothing is a positive assertion about nothing).
    expect(events.length, "no event was recorded, so 'contains no content' proves nothing (RED on HEAD)").toBe(1);

    const serialized = JSON.stringify(events[0]);
    expect(serialized, "the log event smuggled the inserted suggestion text -- the file is downloaded and shared").not.toContain(VALID_1.suggestion);
    // A distinctive slice of the real cover-letter body must not appear either.
    const bodySlice = (ENGINE_LINES.find((l) => l && l.trim().length > 25) || "").trim().slice(0, 25);
    expect(bodySlice.length, "no body text available to test against -- fixture assumption broke").toBeGreaterThan(0);
    expect(serialized, "the log event smuggled cover-letter body text").not.toContain(bodySlice);
  });
});

// Poll the live log the same way waitFor polls the DOM: the record() call lands
// several async hops after the click (research fetch -> effect -> awaits ->
// result). Returns the new "act" events recorded after `sinceSeq`.
async function waitForEvents(sinceSeq, maxTicks = 80) {
  for (let i = 0; i < maxTicks; i += 1) {
    if (newActEvents(sinceSeq).length > 0) break;
    await tick();
  }
  return newActEvents(sinceSeq);
}

async function remount() {
  if (root) await act(async () => root.unmount());
  if (container) container.remove();
  root = null;
  container = null;
}
