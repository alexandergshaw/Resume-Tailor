// @vitest-environment jsdom
//
// N73 -- THE COORDINATING EFFECT (the missing last hop). `autoInsertFactsForJob`
// already exists on the research hook and, WHEN CALLED, does the whole job
// (autoInsertFactsForJob.rc.test.js pins the function's output end to end by
// calling it DIRECTLY). This suite pins the thing that is missing on HEAD:
// NOTHING CALLS IT. The owner asked for facts "inserted and highlighted by the
// time the modal opens up" -- so the candidate does nothing but open the preview
// and let the background research resolve, and the facts must ARRIVE on their
// own, highlighted and one-click removable.
//
// WHY THIS IS RENDER-AND-CLICK, NOT A SCAN (loop-tdd rules 2/5, the repo's most
// repeated defect -- a complete mechanism whose last hop to the user is missing,
// hidden by a green suite). Every test here mounts the REAL DocumentPreviewMount
// (which mounts the REAL DocumentPreviewDialog + REAL InsertedFactsStrip) with
// the REAL useCompanyResearch + REAL useDocumentPreview hooks, opens the preview
// the way page.js does, lets the REAL background research fetch resolve, and then
// asserts the facts appear -- WITHOUT ever calling `research.autoInsertFactsForJob`
// or `research.acceptFacts` and WITHOUT clicking any accept control. If the only
// thing that makes facts arrive is a direct call in the test, the test is
// worthless; so the non-vacuity guard in every case is: the research dialog is
// never opened (`companyResearch.open` stays false) and no accept/auto-insert
// function is invoked from the test body. The only candidate action is opening
// the preview (and, in the failure cases, none at all).
//
// RED ON HEAD: DocumentPreviewMount has no coordinating effect, so research
// resolves and `tailoringMap[jobId].insertedFacts` is never populated -- the
// strip never renders, the body is never marked, `coverLetterResultLines` never
// gains the suggestion. Every positive assertion below fails.
//
// jsdom notes (measurement-instruments memory): MUI's Dialog portals into
// document.body, so DOM queries go through `document`; scrollWidth/layout are
// useless here, so "arrived" is asserted on rendered HTML/text and on the
// download-rebuild source (`coverLetterResultLines`), never on geometry. This
// harness serializes async through `act()`, so what it proves about the
// slow-research case is ORDERING (facts appear after open), never a genuine
// mid-flight concurrency race -- backlog N74's standing caveat, restated here.

import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from "vitest";
import { createElement, useState, act } from "react";
import { createRoot } from "react-dom/client";

import { useCompanyResearch } from "../hooks/useCompanyResearch.js";
import { useDocumentPreview } from "../hooks/useDocumentPreview.js";
import DocumentPreviewMount from "./DocumentPreviewMount.js";
import { sanitizeStoredFacts } from "@/lib/acceptedFacts/factStore.js";
import { embeddedEngine } from "@/lib/llm/engines/tailor-lite/engine.js";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const JOB_ID = "job-1";
const JOB = { id: JOB_ID, title: "Staff Engineer", company: "Acme", description: "React, Node, telemetry." };

// A researched article with a real, openable source url (so it passes the
// auto-select predicate `articleUrlKey`) and a distinctive `suggestion` -- the
// text the accept/auto-insert path inserts. None of these sentences is a
// substring of another (loop-tdd "reconstructing fixture" trap).
const REAL_1 = {
  title: "Acme opens a Dublin telemetry lab",
  url: "https://news.example.com/acme/dublin-lab",
  source: "news.example.com",
  summary: "Acme has opened a new telemetry lab in Dublin.",
  suggestion: "I was glad to see Acme opened a Dublin telemetry lab, and it is part of what draws me to this role.",
};
const REAL_2 = {
  title: "Acme wins a sustainability award",
  url: "https://press.example.org/acme/award",
  source: "press.example.org",
  summary: "Acme received a national sustainability award.",
  suggestion: "Acme winning a national sustainability award is a big reason I am excited about this opportunity.",
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
// "immediate" resolves with `researchArticles`; "deferred" waits on the
// `researchDeferred` promise (so a test can open the modal FIRST, then resolve
// research); "never" hangs forever (a slow/dead external call); "error"/"http503"
// exercise the failure branches.
let researchMode = "immediate";
let researchDeferred = null;
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
  researchMode = "immediate";
  researchDeferred = makeDeferred();
  probe = null;
  globalThis.fetch = vi.fn(async (url, init = {}) => {
    const method = (init.method || "GET").toUpperCase();
    const u = String(url);
    if (u.includes("/api/company-research")) {
      if (researchMode === "never") return new Promise(() => {}); // hangs forever
      if (researchMode === "deferred") await researchDeferred.promise;
      if (researchMode === "error") return json({ error: "Company research failed." }, 500);
      if (researchMode === "http503") return json({ error: "Company research is unavailable." }, 503);
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
// Poll a REAL condition rather than a fixed tick count: the arrival chain
// (research fetch -> setResearchByJob -> effect -> autoInsert -> docx splice via
// JSZip across several macrotasks -> accepted-facts PUT -> setTailoringMap ->
// reload-key bump -> body re-parse) spans an implementation-dependent number of
// ticks. Same pattern as DocumentPreviewMount.test.js's flushUntil.
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

// Open the preview on the cover tab the way page.js does -- this also warms the
// job's research (the current trigger point on HEAD). Opening the preview is the
// ONLY candidate action; no accept/auto-insert is invoked from the test.
async function openCoverPreview() {
  await act(async () => {
    probe.preview.openResumePreview(JOB, { tab: "cover" });
  });
  await flushMicro();
}

// Warm research directly WITHOUT opening the preview -- the "researched at the
// same time generation happens" case the owner asked for, where research can
// resolve before the modal is ever open. This stands in for the generation-start
// warm (a sibling seat's file); it is NOT an insert action.
async function warmResearchClosed() {
  await act(async () => {
    probe.research.startBackgroundResearch({ jobId: JOB_ID, company: "Acme", jobTitle: "Staff Engineer", posting: "React, Node." });
  });
  await flushMicro();
}

function removeButtons() {
  return [...document.querySelectorAll('[aria-label="Remove this fact"]')];
}
function sourceLinks() {
  return [...document.querySelectorAll('[aria-label="Open the source article"]')];
}
function factMarks() {
  return [...document.querySelectorAll('[data-fact="1"]')];
}
function markedText() {
  return factMarks()
    .map((el) => el.textContent || "")
    .join(" ");
}
function coverText() {
  return (probe.tailoringMap[JOB_ID]?.coverLetterResultLines || []).join("\n");
}
function modalText() {
  return document.body.textContent || "";
}
function acceptedFactsPutCount() {
  return globalThis.fetch.mock.calls.filter(
    ([url, init]) => String(url).includes("/api/accepted-facts") && (init?.method || "GET").toUpperCase() === "PUT",
  ).length;
}
// Non-vacuity guard: prove the arrival was NOT the manual accept flow. That flow
// requires the research dialog to be open (openCompanyResearch); it never is.
function assertManualAcceptNeverUsed() {
  expect(
    probe.research.companyResearch.open,
    "the research dialog was opened -- a manual-accept path may have inserted the fact, making the auto-arrival claim vacuous",
  ).toBe(false);
}

describe("N73 coordinating effect: facts arrive with no second action (req 1 + req 2b)", () => {
  it("FLAGSHIP -- research resolving AFTER the modal is open auto-inserts the fact, highlights it in the body, and makes it one-click removable, with NO accept click", async () => {
    researchArticles = [REAL_1];
    researchMode = "deferred"; // research is slower than the modal open
    await mount({ [JOB_ID]: entryWithEngineLetter() });

    // Open the preview. Research is still in flight (deferred), so at this point
    // the modal is open but no fact has arrived -- proving arrival is not part of
    // opening and that the modal did not wait for research.
    await openCoverPreview();
    expect(modalText(), "the preview modal did not open").toContain("Tailored documents");
    expect(coverText(), "a fact arrived before research resolved -- the fixture cannot prove 'appears when ready'").not.toContain(REAL_1.suggestion);
    expect(removeButtons().length, "a removal control existed before research resolved").toBe(0);

    // Now research resolves. Nothing else happens -- no click, no accept.
    await act(async () => {
      researchDeferred.resolve();
    });
    const arrived = await waitFor(() => coverText().includes(REAL_1.suggestion));
    expect(arrived, "the fact never auto-inserted after research resolved -- the coordinating effect is missing (RED on HEAD)").toBe(true);

    // It is in the letter the modal will egress...
    expect(coverText()).toContain(REAL_1.suggestion);
    // ...HIGHLIGHTED in the body the candidate sees (the load-bearing review
    // mechanism; a data-fact mark is distinct from version-diff highlight)...
    await waitFor(() => markedText().includes(REAL_1.suggestion));
    expect(markedText(), "the auto-inserted fact is not highlighted in the preview body").toContain(REAL_1.suggestion);
    // ...and one-click removable, with a real source link as provenance.
    expect(removeButtons().length, "the auto-inserted fact produced no removal control").toBe(1);
    expect(sourceLinks().length, "the auto-inserted fact offers no openable source").toBeGreaterThan(0);
    expect(modalText()).toContain("Added from research");

    // Non-vacuity: exactly one accepted-facts PUT (the auto-insert's own write),
    // and the manual research dialog was never opened.
    expect(acceptedFactsPutCount(), "expected exactly one auto-insert write").toBe(1);
    assertManualAcceptNeverUsed();
  });

  it("auto-inserts ALL of several researched facts (not just the first)", async () => {
    researchArticles = [REAL_1, REAL_2];
    researchMode = "immediate";
    await mount({ [JOB_ID]: entryWithEngineLetter() });
    await openCoverPreview();

    const both = await waitFor(() => coverText().includes(REAL_1.suggestion) && coverText().includes(REAL_2.suggestion));
    expect(both, "not all researched facts auto-inserted (RED on HEAD)").toBe(true);
    await waitFor(() => removeButtons().length === 2);
    expect(removeButtons().length, "each fact must have its own removal control").toBe(2);
    assertManualAcceptNeverUsed();
  });
});

describe("N73 coordinating effect: research resolved BEFORE the modal opens (req 2a + req 5 closed-gate)", () => {
  it("nothing inserts while the preview is CLOSED, then the facts are present right after the modal opens -- no click", async () => {
    researchArticles = [REAL_1];
    researchMode = "immediate";
    await mount({ [JOB_ID]: entryWithEngineLetter() });

    // Warm + resolve research while the modal is CLOSED.
    await warmResearchClosed();
    await waitFor(() => (probe.research.researchByJob[JOB_ID]?.articles || []).length > 0);
    expect(
      (probe.research.researchByJob[JOB_ID]?.articles || []).length,
      "research did not resolve while closed -- the before-open case would be vacuous",
    ).toBeGreaterThan(0);

    // GATE (req 5): with no open review surface, the effect must NOT have
    // inserted anything -- an unreviewed fact must never reach the store from a
    // closed modal. No PUT, no located record, nothing in the letter.
    // (This is the discriminating half; the OPEN step below is its control.)
    expect(acceptedFactsPutCount(), "a fact was written to the store while the preview was CLOSED -- no review surface existed").toBe(0);
    expect(coverText(), "a fact was spliced into the letter while the preview was closed").not.toContain(REAL_1.suggestion);
    expect(probe.tailoringMap[JOB_ID]?.insertedFacts || [], "a located record was written while closed").toHaveLength(0);

    // CONTROL: open the modal. Now -- and only now -- the fact must arrive, with
    // no further action. (On HEAD this fails: nothing inserts even when open.)
    await openCoverPreview();
    const arrived = await waitFor(() => coverText().includes(REAL_1.suggestion));
    expect(arrived, "research was ready before open, yet the fact did not arrive when the modal opened (RED on HEAD)").toBe(true);
    await waitFor(() => removeButtons().length === 1);
    expect(removeButtons().length).toBe(1);
    assertManualAcceptNeverUsed();
  });
});

describe("N73 coordinating effect: the modal never waits on research, and a failure is never shown as a fact (req 6)", () => {
  it("opens on time when research NEVER resolves, and shows no fact and no false 'added' claim", async () => {
    researchArticles = [REAL_1];
    researchMode = "never";
    await mount({ [JOB_ID]: entryWithEngineLetter() });
    await openCoverPreview();
    // Give the effect every chance to (wrongly) fire or block.
    await tick();
    await tick();
    expect(modalText(), "the modal did not open while research hung -- it is blocked on a slow external call").toContain("Tailored documents");
    expect(coverText(), "a fact appeared from an unresolved research call").not.toContain(REAL_1.suggestion);
    expect(factMarks().length, "the body highlighted a fact that never resolved").toBe(0);
    expect(modalText(), "the strip claimed a fact was added when none resolved").not.toContain("Added from research");
    assertManualAcceptNeverUsed();
  });

  it("opens on time when research FAILS (500) and when it returns ZERO facts, with no false fact; CONTROL: a resolved fact DOES arrive", async () => {
    // Failure branch.
    researchArticles = [];
    researchMode = "error";
    await mount({ [JOB_ID]: entryWithEngineLetter() });
    await openCoverPreview();
    await tick();
    expect(modalText(), "the modal did not open when research failed").toContain("Tailored documents");
    expect(removeButtons().length, "a failed research produced a removal control -- a fact was shown").toBe(0);
    expect(modalText()).not.toContain("Added from research");
    if (root) await act(async () => root.unmount());
    root = null;
    if (container) container.remove();
    container = null;

    // Zero-facts branch.
    researchArticles = [];
    researchMode = "immediate";
    await mount({ [JOB_ID]: entryWithEngineLetter() });
    await openCoverPreview();
    await tick();
    expect(modalText(), "the modal did not open when research returned nothing").toContain("Tailored documents");
    expect(removeButtons().length, "zero research facts produced a removal control").toBe(0);
    if (root) await act(async () => root.unmount());
    root = null;
    if (container) container.remove();
    container = null;

    // CONTROL (RED on HEAD): the same flow with a real fact DOES arrive -- so
    // the two absence assertions above are not passing merely because arrival is
    // impossible in this harness.
    researchArticles = [REAL_1];
    researchMode = "immediate";
    await mount({ [JOB_ID]: entryWithEngineLetter() });
    await openCoverPreview();
    const arrived = await waitFor(() => removeButtons().length === 1);
    expect(arrived, "CONTROL failed: a real fact did not arrive, so the no-false-fact assertions are vacuous (RED on HEAD)").toBe(true);
    assertManualAcceptNeverUsed();
  });
});
