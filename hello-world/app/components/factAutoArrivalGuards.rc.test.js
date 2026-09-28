// @vitest-environment jsdom
//
// N73 -- THE COORDINATING EFFECT, its DEDUP and its RESPECT FOR THE CANDIDATE.
// Companion to factAutoArrival.rc.test.js (which pins that facts arrive at all).
// This file pins that the effect fires auto-insert AT MOST ONCE PER JOB (a
// re-render, a tab switch, or re-opening the same job must not re-run it -- a
// duplicated insert is a duplicated claim in a document going to an employer),
// that a DIFFERENT job still inserts, that the effect does NOT fire while the
// preview is closed (no unreviewed fact reaches the store with no review
// surface), and that a fact the candidate has removed is not resurrected by
// later effect activity.
//
// INSTRUMENT NOTE -- counting the effect's invocations. To count how many times
// the coordinating effect invokes `autoInsertFactsForJob` WITHOUT replacing the
// mechanism, the harness passes DocumentPreviewMount a research object whose
// `autoInsertFactsForJob` is a thin passthrough: it records the jobId and then
// delegates to the REAL hook function (which really inserts). This is an
// observation wrapper, not a stub -- the real facts still arrive, the real strip
// still renders. It is necessary because `planCoverFacts` already refuses to
// re-insert text that is present (factInsertion.js:131), so a second EFFECT
// firing would be silently idempotent in the letter TEXT -- the only faithful
// witness of a double-fire is the invocation count, not the rendered text.
//
// RED ON HEAD: no coordinating effect exists, so the passthrough is never called
// (`autoInsertCalls` stays empty) and no fact arrives -- every "count is 1" and
// every "a fact arrived" assertion fails.
//
// jsdom notes: MUI Dialog portals to document.body; act() serializes async so
// what is proven is ORDERING, never true concurrency (backlog N74).

import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from "vitest";
import { createElement, useState, act } from "react";
import { createRoot } from "react-dom/client";

import { useCompanyResearch } from "../hooks/useCompanyResearch.js";
import { useDocumentPreview } from "../hooks/useDocumentPreview.js";
import DocumentPreviewMount from "./DocumentPreviewMount.js";
import { sanitizeStoredFacts } from "@/lib/acceptedFacts/factStore.js";
import { embeddedEngine } from "@/lib/llm/engines/tailor-lite/engine.js";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const JOB1 = { id: "job-1", title: "Staff Engineer", company: "Acme", description: "React, Node, telemetry." };
const JOB2 = { id: "job-2", title: "Principal Engineer", company: "Globex", description: "Rust, distributed systems." };

// One article per company, each with a real source url and a distinct suggestion
// (no sentence a substring of another -- the reconstructing-fixture trap).
const ACME_1 = {
  title: "Acme opens a Dublin telemetry lab",
  url: "https://news.example.com/acme/dublin-lab",
  source: "news.example.com",
  summary: "Acme has opened a new telemetry lab in Dublin.",
  suggestion: "I was glad to see Acme opened a Dublin telemetry lab, and it is part of what draws me to this role.",
};
const ACME_2 = {
  title: "Acme wins a sustainability award",
  url: "https://press.example.org/acme/award",
  source: "press.example.org",
  summary: "Acme received a national sustainability award.",
  suggestion: "Acme winning a national sustainability award is a big reason I am excited about this opportunity.",
};
const GLOBEX_1 = {
  title: "Globex ships an open-source scheduler",
  url: "https://dev.example.net/globex/scheduler",
  source: "dev.example.net",
  summary: "Globex released a distributed scheduler as open source.",
  suggestion: "Globex releasing its distributed scheduler as open source is exactly the kind of work I want to be part of.",
};

const ARTICLES_BY_COMPANY = { Acme: [ACME_1], Globex: [GLOBEX_1] };

// A résumé body so the RESUME scope is available and its tab is switchable
// (previewScopeAvailable keys on a non-empty `result`); the tab switch is how
// the "no re-fire on a re-render" case is exercised the way a candidate does it.
const RESUME_BODY = "Alex Shaw. Engineer with a decade building telemetry platforms.";

let ENGINE_B64 = "";
let ENGINE_LINES = [];

beforeAll(async () => {
  const cl = await embeddedEngine.tailorCoverLetter({
    jobPosting: "Engineer role. React, Node, telemetry, accessibility.",
    jobTitle: "Engineer",
    companyName: "Acme",
  });
  ENGINE_B64 = cl.docxB64;
  ENGINE_LINES = cl.resultLines;
});

let store = {};
let overrideArticles = null; // when set, /api/company-research returns this for every job
let researchMode = "immediate"; // "deferred" waits on researchDeferred before returning
let researchDeferred = null;
let autoInsertCalls = [];
let probe = null;
let container = null;
let root = null;

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

function storeFor(jobRef) {
  if (!store[jobRef]) store[jobRef] = { facts: [], removed: [], revision: null };
  return store[jobRef];
}

function entryWithEngineLetter(overrides = {}) {
  return {
    status: "done",
    result: RESUME_BODY,
    resultLines: [RESUME_BODY],
    resumePreviewHtml: `<p>${RESUME_BODY}</p>`,
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
  // Observation wrapper (see header): records the jobId then delegates to the
  // real hook function so the real insert still happens.
  const wrappedResearch = {
    ...research,
    autoInsertFactsForJob: (jobId, isOpen) => {
      autoInsertCalls.push(jobId);
      return research.autoInsertFactsForJob(jobId, isOpen);
    },
  };
  probe = { tailoringMap, setTailoringMap, research: wrappedResearch, preview };
  return createElement(DocumentPreviewMount, {
    preview,
    tailoringMap,
    research: wrappedResearch,
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
  store = {};
  overrideArticles = null;
  researchMode = "immediate";
  researchDeferred = makeDeferred();
  autoInsertCalls = [];
  probe = null;
  globalThis.fetch = vi.fn(async (url, init = {}) => {
    const method = (init.method || "GET").toUpperCase();
    const u = String(url);
    if (u.includes("/api/company-research")) {
      if (researchMode === "deferred") await researchDeferred.promise;
      const body = JSON.parse(init.body || "{}");
      const articles = overrideArticles || ARTICLES_BY_COMPANY[body.company] || [];
      return json({ articles, warnings: [] });
    }
    if (u.includes("/api/accepted-facts")) {
      const jobRef = method === "GET" ? new URL(u, "http://x").searchParams.get("jobRef") : JSON.parse(init.body).jobRef;
      const s = storeFor(jobRef);
      if (method === "GET") return json({ facts: s.facts, removed: s.removed, revision: s.revision });
      const body = JSON.parse(init.body);
      store[jobRef] = {
        facts: sanitizeStoredFacts(body.facts),
        removed: Array.isArray(body.declinedUrls) ? body.declinedUrls : [],
        revision: (s.revision ?? 0) + 1,
      };
      return json({ facts: store[jobRef].facts, removed: store[jobRef].removed, revision: store[jobRef].revision, versionSaved: !!body.coverVersion });
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

async function openCover(job) {
  await act(async () => {
    probe.preview.openResumePreview(job, { tab: "cover" });
  });
  await flushMicro();
}

function callsFor(jobId) {
  return autoInsertCalls.filter((id) => id === jobId).length;
}
function coverText(jobId) {
  return (probe.tailoringMap[jobId]?.coverLetterResultLines || []).join("\n");
}
function occurrences(hay, needle) {
  let n = 0;
  let i = hay.indexOf(needle);
  while (i >= 0) {
    n += 1;
    i = hay.indexOf(needle, i + needle.length);
  }
  return n;
}
function removeButtons() {
  return [...document.querySelectorAll('[aria-label="Remove this fact"]')];
}
function tabByLabel(label) {
  return [...document.querySelectorAll('[role="tab"]')].find((t) => (t.textContent || "").trim().startsWith(label));
}
async function switchTab(label) {
  const tab = tabByLabel(label);
  if (!tab) throw new Error(`tab not rendered: ${label}`);
  await act(async () => {
    tab.click();
  });
  await flushMicro();
}
async function clickRemove(i = 0) {
  await flushMicro();
  const before = removeButtons().length;
  await act(async () => {
    removeButtons()[i].click();
  });
  await waitFor(() => removeButtons().length !== before);
  await flushMicro();
}

describe("instrument sanity (canaries)", () => {
  it("occurrences counts non-overlapping matches", () => {
    expect(occurrences("a b a b a", "a")).toBe(3);
    expect(occurrences("abcabc", "abc")).toBe(2);
    expect(occurrences("nothing here", "xyz")).toBe(0);
  });
});

describe("N73 fires at most once per job; a different job still inserts (req 3)", () => {
  it("one invocation for job-1 across a tab switch and a job switch-and-back; job-2 inserts on its own", async () => {
    overrideArticles = null; // per-company
    await mount({ "job-1": entryWithEngineLetter(), "job-2": entryWithEngineLetter() });

    // Open job-1: exactly one auto-insert invocation, fact present once.
    await openCover(JOB1);
    const arrived1 = await waitFor(() => coverText("job-1").includes(ACME_1.suggestion));
    expect(arrived1, "job-1 fact never auto-inserted (RED on HEAD)").toBe(true);
    expect(callsFor("job-1"), "job-1 auto-insert did not fire exactly once on open").toBe(1);
    expect(occurrences(coverText("job-1"), ACME_1.suggestion), "job-1 fact inserted more than once").toBe(1);

    // A tab switch re-renders the mount but must not re-fire the effect.
    await switchTab("Resume");
    expect(tabByLabel("Resume").getAttribute("aria-selected"), "résumé tab did not select -- tab-switch non-vacuity fails").toBe("true");
    await tick();
    expect(callsFor("job-1"), "a tab switch re-fired the auto-insert effect").toBe(1);
    await switchTab("Cover letter");

    // Switch to job-2: it must insert its OWN fact (per-job dedup is not global).
    await openCover(JOB2);
    const arrived2 = await waitFor(() => coverText("job-2").includes(GLOBEX_1.suggestion));
    expect(arrived2, "a DIFFERENT job did not auto-insert -- the dedup is global, not per-job (RED on HEAD)").toBe(true);
    expect(callsFor("job-2"), "job-2 auto-insert did not fire exactly once").toBe(1);
    expect(callsFor("job-1"), "opening job-2 re-fired job-1's auto-insert").toBe(1);

    // Re-open job-1 (jobId dep goes job-1 -> job-2 -> job-1, so the effect
    // genuinely re-evaluates): it must NOT re-insert. This is the assertion the
    // per-job dedup exists for; removing that guard reds it.
    await openCover(JOB1);
    await tick();
    await tick();
    expect(probe.preview.resumePreview.jobId, "re-open non-vacuity: job-1 is not the active job again").toBe("job-1");
    expect(callsFor("job-1"), "re-opening job-1 re-fired the auto-insert effect -- not deduped per job").toBe(1);
    expect(occurrences(coverText("job-1"), ACME_1.suggestion), "re-opening job-1 duplicated the fact in the letter").toBe(1);
  });
});

describe("N73 does not fire with no review surface (req 5)", () => {
  // The `!previewOpen` guard has INDEPENDENT teeth only in a closed-AFTER-open
  // state: closeResumePreview keeps the jobId ({...prev, open:false}), so the
  // effect could otherwise fire for a job whose modal the candidate has closed.
  // We open with research still PENDING (so nothing inserts and the job is not
  // yet marked done), CLOSE the modal, THEN resolve research -- the exact moment
  // the effect must refuse. Counting INVOCATIONS (not inserts) is what makes this
  // test the effect's OWN gate, not the function's internal isOpen re-check: the
  // brief's "so the guard is not the only thing standing between an unreviewed
  // fact and the store."
  it("research resolving while the preview is CLOSED (after having been open) does not invoke auto-insert; CONTROL: re-opening does", async () => {
    overrideArticles = [ACME_1];
    researchMode = "deferred";
    await mount({ "job-1": entryWithEngineLetter() });

    // Open the modal while research is still in flight: nothing inserts yet.
    await openCover(JOB1);
    expect(callsFor("job-1"), "auto-insert fired before research resolved").toBe(0);

    // Candidate closes the modal. jobId stays set (closeResumePreview keeps it),
    // research is STILL pending.
    await act(async () => {
      probe.preview.closeResumePreview();
    });
    await flushMicro();
    expect(probe.preview.resumePreview.open, "the preview did not actually close -- the closed-gate case would be vacuous").toBe(false);

    // Now research resolves -- with NO open review surface. The effect must not
    // invoke auto-insert. (Non-vacuity: research genuinely resolved.)
    await act(async () => {
      researchDeferred.resolve();
    });
    await waitFor(() => (probe.research.researchByJob["job-1"]?.articles || []).length > 0);
    expect(
      (probe.research.researchByJob["job-1"]?.articles || []).length,
      "research did not resolve -- the closed-gate case would be vacuous",
    ).toBeGreaterThan(0);
    await tick();
    await tick();
    expect(callsFor("job-1"), "auto-insert fired while the preview was CLOSED -- a fact could reach the store with no review surface").toBe(0);
    expect(coverText("job-1"), "a fact was spliced while closed").not.toContain(ACME_1.suggestion);

    // CONTROL (RED on HEAD): re-opening the preview -- and only then -- fires it.
    await openCover(JOB1);
    const arrived = await waitFor(() => callsFor("job-1") === 1);
    expect(arrived, "re-opening the preview did not fire the auto-insert (RED on HEAD) -- so the closed-gate assertion above is not merely vacuous").toBe(true);
    await waitFor(() => coverText("job-1").includes(ACME_1.suggestion));
    expect(coverText("job-1")).toContain(ACME_1.suggestion);
  });
});

describe("N73 does not fight the candidate: a removed fact is not resurrected (req 4)", () => {
  // GUARD (teeth disclosed). Same-session: after the candidate removes a fact,
  // no later effect activity brings it back. In this architecture a resurrection
  // requires BOTH the per-job dedup AND the function's own removed-log skip to
  // fail, so no single faithful mutation reds this -- it is kept as an invariant
  // guard and its teeth are discussed in the notes artifact. Its non-vacuity is
  // real: the removal must actually take (asserted), and a still-present sibling
  // fact proves the strip/letter are live, not empty.
  it("removing one auto-inserted fact keeps it gone across tab switches and a re-open; the sibling fact stays", async () => {
    overrideArticles = [ACME_1, ACME_2];
    await mount({ "job-1": entryWithEngineLetter(), "job-2": entryWithEngineLetter() });

    await openCover(JOB1);
    const both = await waitFor(() => coverText("job-1").includes(ACME_1.suggestion) && coverText("job-1").includes(ACME_2.suggestion));
    expect(both, "both facts did not auto-insert (RED on HEAD)").toBe(true);
    await waitFor(() => removeButtons().length === 2);

    window.confirm = () => {
      throw new Error("removal must not open a confirmation dialog");
    };

    // Remove ACME_1 (front of the coalesced line). Prove it actually left.
    await clickRemove(0);
    expect(coverText("job-1"), "the removal did not take").not.toContain(ACME_1.suggestion);
    expect(coverText("job-1"), "removing one fact took the other with it").toContain(ACME_2.suggestion);
    expect(removeButtons().length, "the removed fact's row is still on screen").toBe(1);

    // Now poke the effect as hard as the UI allows: switch tabs, and re-open the
    // job via job-2 and back. The removed fact must not reappear.
    await switchTab("Cover letter"); // (already cover) harmless re-render
    await openCover(JOB2);
    await openCover(JOB1);
    await tick();
    await tick();
    expect(coverText("job-1"), "the removed fact CAME BACK after later effect activity -- 'delete a sentence and it comes back'").not.toContain(ACME_1.suggestion);
    expect(coverText("job-1"), "the surviving fact was lost").toContain(ACME_2.suggestion);
  });
});
