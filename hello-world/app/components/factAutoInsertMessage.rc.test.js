// @vitest-environment jsdom
//
// N77 -- A REFUSED AUTO-INSERT MUST TELL THE CANDIDATE SOMETHING, AND THE
// SOMETHING MUST DISTINGUISH CASES WITH DIFFERENT REMEDIES.
//
// THE DEFECT (verified against HEAD, 2026-09-28). The coordinating effect in
// app/components/DocumentPreviewMount.js:128 calls
//   researchRef.current.autoInsertFactsForJob(jobId, () => openRef.current)
// and DISCARDS the returned `{ ok, reason }`. `autoInsertFactsForJob`
// (app/hooks/useCompanyResearch.js:598-737) has ~nine refusal paths, each with
// a distinct `reason`, and on HEAD every one of them produces IDENTICAL
// user-visible behaviour: nothing. The candidate -- and whoever is diagnosing
// afterwards -- cannot tell a working feature with nothing to say from a broken
// one. That indistinguishability is the owner's live report ("i'm not seeing
// this occurring"). The shipped precedent to follow is `removeError` in the
// same file (DocumentPreviewMount.js:145-163): a refused REMOVAL already flows
// its `{ok:false, reason}` into a readable strip alert. Auto-insert does not.
//
// WHY RENDER-AND-CLICK, NOT A SCAN (loop-tdd rules 2/6, the repo's most
// repeated defect -- a mechanism whose last hop to the user is missing, hidden
// by a green suite). Every test mounts the REAL DocumentPreviewMount (real
// DocumentPreviewDialog + real InsertedFactsStrip) with the REAL
// useCompanyResearch + useDocumentPreview hooks, opens the preview the way
// page.js does, lets the REAL background research fetch resolve, and asserts on
// the rendered DOM. NOTHING in a test body ever calls autoInsertFactsForJob,
// acceptFacts, or opens the research dialog -- opening the preview is the only
// candidate action. If a test could pass only because it drove the mechanism
// directly, it would be worthless.
//
// THE INSTRUMENT, AND ITS ONE DISCLOSED LIMIT. The refusal message is asserted
// through an ASSISTIVE LIVE REGION, exactly as this same dialog already conveys
// its Drive and Copy outcomes (DriveResultRegion.js:322-325,
// CopyFeedback.js:110-113): role="alert" for a FAILURE the candidate must act
// on, role="status"/aria-live="polite" for an INFORMATIONAL state that must not
// read as an error. That is the faithful, repo-consistent contract, and it is
// what a screen-reader user actually perceives.
//   * Those two pre-existing regions are `component="span"` and visuallyHidden
//     and, with no Drive/Copy action in these tests, EMPTY. So the instrument
//     keys on NON-SPAN elements carrying NON-EMPTY text: `spanless()` below.
//     A `<span>` is the visuallyHidden-live-region shape here; the strip's own
//     visible error is a `<Box>` (a div). So filtering out spans is the
//     hidden-node guard the brief demands -- a message that lived only in a
//     visuallyHidden span would NOT satisfy these assertions.
//   * DISCLOSED LIMIT: jsdom applies no Emotion CSS and computes no layout, so
//     it cannot prove a non-span element is VISUALLY on screen (not clipped,
//     not zero-size, not offscreen). These tests prove the message is announced
//     with the right semantics and is not in the known visuallyHidden spans;
//     they do NOT prove sighted visibility. A build that clipped a <div> with
//     its own CSS would pass here. Step-6 / a browser pass must confirm the
//     message is visibly rendered. Stated in the report, not hidden.
//
// RED ON HEAD: no auto-insert message region exists at all, so no non-span
// role="alert"/"status" ever gains text -- every positive assertion below
// fails. The absence assertions are each paired with a live control so none is
// vacuous.
//
// jsdom notes (measurement-instruments memory): MUI Dialog portals into
// document.body, so DOM queries go through `document`; act() serializes async so
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

const JOB_ID = "job-1";
const JOB2_ID = "job-2";
const JOB = { id: JOB_ID, title: "Staff Engineer", company: "Acme", description: "React, Node, telemetry." };
const JOB2 = { id: JOB2_ID, title: "Principal Engineer", company: "Globex", description: "Rust, systems." };

// A researched article with a real, openable source url (passes the
// auto-select predicate `articleUrlKey`) and a distinctive `suggestion` -- the
// sentence the auto-insert path splices in. No sentence is a substring of
// another (loop-tdd "reconstructing fixture" trap).
const VALID_ARTICLE = {
  title: "Acme opens a Dublin telemetry lab",
  url: "https://news.example.com/acme/dublin-lab",
  source: "news.example.com",
  summary: "Acme has opened a new telemetry lab in Dublin.",
  suggestion: "I was glad to see Acme opened a Dublin telemetry lab, and it is part of what draws me to this role.",
};
// THE KEY-LESS SHAPE (DEFECT 2, the case the owner is most likely hitting): a
// real url + real title, but an EMPTY suggestion -- exactly what the research
// route returns on the pasted-URL / no-Gemini-key path
// (app/api/company-research/route.js:261,279-286). The eligibility filter drops
// it (useCompanyResearch.js:647: `if (!String(a.suggestion||"").trim()) return
// false`), so the feature does nothing. This must read as "articles arrived but
// none carried a usable sentence" (remedy: configure a key, or write one by
// hand), NOT as silence and NOT as the generic engine-bytes failure.
const KEYLESS_ARTICLE = {
  title: "Globex profiled in a regional business weekly",
  url: "https://press.example.org/globex/profile",
  source: "press.example.org",
  summary: "A regional weekly profiled Globex's recent growth.",
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

// A tailoring entry carrying a real engine cover letter (lines + bytes). The
// happy-path fixture; refusal fixtures override one field to trip one gate.
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

async function openCoverPreview(job = JOB) {
  await act(async () => {
    probe.preview.openResumePreview(job, { tab: "cover" });
  });
  await flushMicro();
}

// ---------------------------------------------------------------------------
// THE INSTRUMENT. `spanless(role)` returns the trimmed text of every element
// with that ARIA role that is NOT a <span> and carries non-empty text. The
// dialog's pre-existing visuallyHidden live regions (DriveResultRegion,
// CopyFeedback) are all `component="span"` and empty here, so they never match;
// the strip's own visible error is a <Box>/<div>, so a real message does. This
// is both the "a message is shown" detector and the hidden-node guard.
// ---------------------------------------------------------------------------
function spanless(role) {
  const sel = role === "status" ? '[role="status"],[aria-live="polite"]' : `[role="${role}"]`;
  return [...document.querySelectorAll(sel)]
    .filter((el) => el.tagName !== "SPAN")
    .map((el) => (el.textContent || "").trim())
    .filter(Boolean);
}
function failureMessages() {
  return spanless("alert");
}
function informationalMessages() {
  return spanless("status");
}
function modalText() {
  return document.body.textContent || "";
}
function removeButtons() {
  return [...document.querySelectorAll('[aria-label="Remove this fact"]')];
}
function acceptedFactsPutCount() {
  return globalThis.fetch.mock.calls.filter(
    ([url, init]) => String(url).includes("/api/accepted-facts") && (init?.method || "GET").toUpperCase() === "PUT",
  ).length;
}
// Non-vacuity guard shared with the arrival suite: prove any message we assert
// is not a by-product of the manual accept flow (which needs the research
// dialog open -- it never is here).
function assertManualAcceptNeverUsed() {
  expect(
    probe.research.companyResearch.open,
    "the research dialog was opened -- a manual path may be responsible, making the auto-insert claim vacuous",
  ).toBe(false);
}

describe("N77 legibility: a refused auto-insert conveys a FAILURE the candidate can read (req 1)", () => {
  it("engine copy of the letter missing -> a readable failure message appears (role=alert), NOT silence", async () => {
    // Cover letter TEXT exists but its engine bytes are gone (a restored chip /
    // cover-version switch) -> autoInsertFactsForJob returns NO_ENGINE_BYTES,
    // one of the first four gates, BEFORE any network call. This is exactly the
    // shape the owner's activity log points at (research succeeded, no
    // accepted-facts request ever issued).
    researchArticles = [VALID_ARTICLE];
    await mount({ [JOB_ID]: entryWithEngineLetter({ coverLetterDocxB64: "" }) });
    await openCoverPreview();

    // No baseline "alerts empty" guard: with IMMEDIATE research the refusal can
    // complete inside openCoverPreview's own flush, so the message may already
    // be present here. The instrument stays unambiguous anyway -- `spanless`
    // excludes the dialog's pre-existing visuallyHidden <span> live regions
    // (DriveResultRegion/CopyFeedback), and no drive/copy action runs, so the
    // only non-span role=alert that can carry text is this feature's own.
    const shown = await waitFor(() => failureMessages().length > 0);
    expect(
      shown,
      "engine bytes were missing, yet NOTHING readable was shown -- the refusal is silent (RED on HEAD)",
    ).toBe(true);
    // No fact was inserted (the refusal is real, not a mislabelled success).
    expect(removeButtons().length, "a removal control appeared for a refused insert").toBe(0);
    expect(modalText(), "a refused insert falsely claimed a fact was added").not.toContain("Added from research");
    assertManualAcceptNeverUsed();
  });

  it("CONTROL: a SUCCESSFUL auto-insert shows NO failure message and NO informational message (req 4 non-vacuity)", async () => {
    // Same flow, engine bytes present -> the fact arrives. If a failure/info
    // message appeared here too, the assertions above would pass against a
    // build that shows a message unconditionally.
    researchArticles = [VALID_ARTICLE];
    await mount({ [JOB_ID]: entryWithEngineLetter() });
    await openCoverPreview();

    const arrived = await waitFor(() => removeButtons().length === 1);
    expect(arrived, "CONTROL failed: the fact did not arrive on the happy path (RED on HEAD)").toBe(true);
    expect(modalText()).toContain("Added from research");
    expect(failureMessages(), "a failure message was shown on a SUCCESSFUL insert").toEqual([]);
    expect(informationalMessages(), "an informational refusal message was shown on a SUCCESSFUL insert").toEqual([]);
    assertManualAcceptNeverUsed();
  });
});

describe("N77 legibility: the KEY-LESS shape reads as 'no usable sentence', informational not failure (req 5)", () => {
  it("articles arrived with EMPTY suggestions -> a readable INFORMATIONAL message (role=status), never a role=alert failure", async () => {
    researchArticles = [KEYLESS_ARTICLE];
    await mount({ [JOB2_ID]: entryWithEngineLetter() });
    await openCoverPreview(JOB2);

    const shown = await waitFor(() => informationalMessages().length > 0);
    expect(
      shown,
      "an article with a url+title but no suggestion produced NO readable message -- silent ineligibility, the owner's most likely case (RED on HEAD)",
    ).toBe(true);
    // MUST NOT be dressed as a failure: no non-span role=alert gains text. This
    // is the informational-vs-failure distinction (req 2), keyed on the ARIA
    // role a screen reader actually announces.
    expect(
      failureMessages(),
      "the key-less case raised an ALARM (role=alert) -- a normal 'nothing usable to add' state must not read as an error",
    ).toEqual([]);
    expect(removeButtons().length, "the key-less case inserted a fact anyway").toBe(0);
    assertManualAcceptNeverUsed();
  });

  it("the key-less message is DISTINGUISHABLE from the engine-bytes FAILURE message (different remedies -> different text, req 1)", async () => {
    // Capture the engine-bytes failure text...
    researchArticles = [VALID_ARTICLE];
    await mount({ [JOB_ID]: entryWithEngineLetter({ coverLetterDocxB64: "" }) });
    await openCoverPreview();
    await waitFor(() => failureMessages().length > 0);
    const failureText = failureMessages().join(" | ");
    expect(failureText.length, "no engine-bytes failure text to compare (RED on HEAD)").toBeGreaterThan(0);
    if (root) await act(async () => root.unmount());
    root = null;
    if (container) container.remove();
    container = null;

    // ...and the key-less informational text, and require they differ. The
    // engine-bytes remedy is "regenerate the letter"; the key-less remedy is
    // "configure a key / write one yourself" -- a single shared sentence would
    // mislead a candidate about what to do.
    researchArticles = [KEYLESS_ARTICLE];
    await mount({ [JOB2_ID]: entryWithEngineLetter() });
    await openCoverPreview(JOB2);
    await waitFor(() => informationalMessages().length > 0);
    const infoText = informationalMessages().join(" | ");
    expect(infoText.length, "no key-less informational text to compare (RED on HEAD)").toBeGreaterThan(0);

    expect(
      infoText,
      "the key-less 'no usable sentence' state shows the SAME text as the engine-bytes failure -- the two remedies are collapsed into one undifferentiated message",
    ).not.toBe(failureText);
    assertManualAcceptNeverUsed();
  });
});

describe("N77 legibility: the ORDINARY 'nothing new' case is not alarmed, and stale messages do not linger (req 2 + req 3)", () => {
  it("all researched facts were already removed earlier -> no FAILURE alarm; CONTROL: engine-bytes DOES alarm", async () => {
    // The candidate previously removed this fact; a later run finds nothing new
    // to add. This is normal and must not read as an error.
    store = { facts: [], removed: [VALID_ARTICLE.url], revision: 3 };
    researchArticles = [VALID_ARTICLE];
    await mount({ [JOB_ID]: entryWithEngineLetter() });
    await openCoverPreview();
    // Let the effect run to completion (it will GET accepted-facts, see the
    // removed url, and refuse with "no eligible facts").
    await tick();
    await tick();
    expect(
      failureMessages(),
      "a normal 'nothing new to add' outcome raised a role=alert failure -- the ordinary case is dressed as a problem",
    ).toEqual([]);
    expect(removeButtons().length, "an already-removed fact was re-inserted").toBe(0);
    if (root) await act(async () => root.unmount());
    root = null;
    if (container) container.remove();
    container = null;

    // CONTROL (RED on HEAD): the engine-bytes case in the SAME harness DOES
    // raise a failure alert -- so the absence above is not merely because no
    // alert can ever appear.
    researchArticles = [VALID_ARTICLE];
    await mount({ [JOB_ID]: entryWithEngineLetter({ coverLetterDocxB64: "" }) });
    await openCoverPreview();
    const alarmed = await waitFor(() => failureMessages().length > 0);
    expect(alarmed, "CONTROL failed: the engine-bytes case raised no alarm, so the no-alarm assertion is vacuous (RED on HEAD)").toBe(true);
    assertManualAcceptNeverUsed();
  });

  it("a refusal message does NOT linger after a LATER job auto-inserts successfully (req 3)", async () => {
    // job-1 refuses (engine bytes missing) -> a failure message is shown.
    // job-2 (valid) then auto-inserts -> the earlier failure message must be
    // gone; a stale error left on screen after facts arrive is worse than none.
    researchArticles = [VALID_ARTICLE];
    await mount({
      [JOB_ID]: entryWithEngineLetter({ coverLetterDocxB64: "" }),
      [JOB2_ID]: entryWithEngineLetter(),
    });

    await openCoverPreview(JOB);
    const shown = await waitFor(() => failureMessages().length > 0);
    expect(shown, "job-1 never showed its refusal message, so 'does not linger' is vacuous (RED on HEAD)").toBe(true);
    const staleText = failureMessages().join(" | ");

    // Switch to job-2 and let its fact arrive. No click, no accept.
    await openCoverPreview(JOB2);
    const arrived = await waitFor(() => removeButtons().length === 1);
    expect(arrived, "job-2's fact did not arrive, so the later-success premise is vacuous (RED on HEAD)").toBe(true);

    expect(
      failureMessages().join(" | "),
      "job-1's refusal message lingered after job-2 inserted successfully -- a stale error is on screen alongside arrived facts",
    ).not.toContain(staleText);
    assertManualAcceptNeverUsed();
  });
});
