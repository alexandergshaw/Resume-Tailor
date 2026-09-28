// @vitest-environment jsdom
//
// N72 -- THE AUTO-INSERT FUNCTION, end to end: the located records it produces
// must flow to the REAL body highlight the candidate sees and the REAL one-click
// removal control, mounted through the REAL DocumentPreviewMount (which renders
// the REAL DocumentPreviewDialog). This is the overlap case the removal seat
// (S1-S4) explicitly could not reach and flagged for this step: it could drive
// removal only from a MANUAL accept; here the facts arrive by AUTO-INSERT, and
// two facts that default to the intro placement COALESCE onto one line -- so
// removing them one after another exercises the coalesced-offset relocation
// (relocateSurvivors) that the order-dependent stranding bug lived in. We chain
// two removals for exactly that reason.
//
// REACHABILITY BOUNDARY, stated plainly. Auto-insert is not human-driven, so
// there is no click to reach the FUNCTION -- its trigger (the coordinating
// effect) is backlog N73, in another seat's files. What this test proves is the
// reachability of the function's OUTPUT: that the located records it writes are
// consumed correctly by the real highlight and the real removal the candidate
// actually uses. If the function wrote the stale `insertedFactTexts` string
// array instead of located `{id,text,lineIndex,offset,url,title}` records, the
// strip would list nothing and the body would highlight nothing -- and these
// DOM assertions would fail. So this is the test that catches the stale-contract
// trap the whole chunk was re-scoped around.
//
// jsdom note: MUI's Dialog portals into document.body, so DOM queries go through
// `document`. scrollWidth etc. are useless here (measurement memory); we assert
// on rendered HTML/structure only.

import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from "vitest";
import { createElement, useState, act } from "react";
import { createRoot } from "react-dom/client";

import { useCompanyResearch } from "./useCompanyResearch.js";
import { useDocumentPreview } from "./useDocumentPreview.js";
import DocumentPreviewMount from "@/app/components/DocumentPreviewMount.js";
import { sanitizeStoredFacts } from "@/lib/acceptedFacts/factStore.js";
import { embeddedEngine } from "@/lib/llm/engines/tailor-lite/engine.js";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const JOB_ID = "job-1";
const JOB = { id: JOB_ID, title: "Staff Engineer", company: "Acme", description: "React, Node, telemetry." };

// Two researched articles with real, openable sources. Their `suggestion` (the
// text the accept path inserts) is a TEMPLATED first-person opener on the
// embedded engine -- not a claim extracted from the source (see item 6 below).
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
let probe = null;
let container = null;
let root = null;

function json(body) {
  return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
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
    if (u.includes("/api/company-research")) return json({ articles: researchArticles, warnings: [] });
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

async function flush(times = 6) {
  for (let i = 0; i < times; i += 1) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}
async function drain(steps = 25) {
  for (let n = 0; n < steps; n += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
  }
}

async function mount(initialMap) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root.render(createElement(Probe, { initialMap }));
  });
  await flush();
}

// Open the cover preview the way page.js does; openResumePreview also warms the
// job's research (the current trigger point), so researchArticles set beforehand
// are fetched into researchByJob here.
async function openCoverPreview() {
  await act(async () => {
    probe.preview.openResumePreview(JOB, { tab: "cover" });
  });
  await flush();
  await drain(6);
}

// Fire the auto-insert function directly (its own trigger is N73). Then drain --
// the run awaits a real docx (de)serialize and bumps the preview reload key,
// which re-parses the body model with the fact highlight applied.
async function autoInsert() {
  await act(async () => {
    await probe.research.autoInsertFactsForJob(JOB_ID, () => true);
  });
  await drain();
}

function removeButtons() {
  return [...document.querySelectorAll('[aria-label="Remove this fact"]')];
}
function factMarks() {
  return [...document.querySelectorAll('[data-fact="1"]')];
}
function markedText() {
  return factMarks()
    .map((el) => el.textContent || "")
    .join(" ");
}
function coverLines() {
  return probe.tailoringMap[JOB_ID]?.coverLetterResultLines || [];
}
function modalText() {
  return document.body.textContent || "";
}
async function clickRemove(i = 0) {
  await flush();
  await act(async () => {
    removeButtons()[i].click();
  });
  await drain();
}
function assertIsFunction() {
  expect(
    typeof probe.research.autoInsertFactsForJob,
    "autoInsertFactsForJob is not exposed by useCompanyResearch -- the N72 auto-insert function does not exist yet",
  ).toBe("function");
}

describe("N72 end to end: auto-inserted facts are highlighted AND removable in the real modal", () => {
  it("auto-inserts two facts, highlights both in the body, and each is one-click removable (chained)", async () => {
    researchArticles = [REAL_1, REAL_2];
    await mount({ [JOB_ID]: entryWithEngineLetter() });
    await openCoverPreview();
    assertIsFunction();

    await autoInsert();

    // 1) Both facts are in the letter the modal will egress.
    const text = coverLines().join("\n");
    expect(text, "fact 1 was not auto-inserted").toContain(REAL_1.suggestion);
    expect(text, "fact 2 was not auto-inserted").toContain(REAL_2.suggestion);

    // 2) Both are HIGHLIGHTED in the body the candidate sees -- the load-bearing
    // review mechanism. A data-fact mark is distinct from version-diff highlight.
    const marked = markedText();
    expect(marked, "fact 1 is not highlighted in the preview body").toContain(REAL_1.suggestion);
    expect(marked, "fact 2 is not highlighted in the preview body").toContain(REAL_2.suggestion);

    // 3) Both are REMOVABLE -- one control each (the located-record contract).
    expect(removeButtons().length, "the auto-inserted facts produced no removal controls -- located records did not reach the strip").toBe(2);

    // No confirmation gate (removal only ever reduces what can egress).
    window.confirm = () => {
      throw new Error("removal must not open a confirmation dialog");
    };

    // Chain: remove fact #1, then the survivor. The stranding bug only bit when
    // a removed fact had another AFTER it on the same coalesced line.
    await clickRemove(0);
    const afterFirst = coverLines().join("\n");
    expect(afterFirst, "the first removal did not remove its own fact").not.toContain(REAL_1.suggestion);
    expect(afterFirst, "the first removal stranded / removed the OTHER coalesced fact").toContain(REAL_2.suggestion);
    expect(removeButtons().length, "exactly one removal control should remain after removing one of two").toBe(1);

    await clickRemove(0);
    const afterSecond = coverLines().join("\n");
    expect(afterSecond, "the survivor was unremovable after the first removal (stale coalesced offset)").not.toContain(REAL_2.suggestion);
    expect(removeButtons().length, "a removal control remains after removing both facts").toBe(0);

    // The paragraph left behind is readable (no doubled space, no space-before-punctuation seam).
    for (const line of coverLines()) {
      expect(/\s{2,}|\s[.,;:!?]/.test(line), `readability seam left in: ${JSON.stringify(line)}`).toBe(false);
    }
  });
});

describe("N72 embedded engine: a templated opener is never dressed as a reported claim (item 6)", () => {
  it("inserts+highlights the templated opener, labels it 'Added from research', offers a source link, and claims no source reported the sentence", async () => {
    researchArticles = [REAL_1];
    await mount({ [JOB_ID]: entryWithEngineLetter() });
    await openCoverPreview();
    assertIsFunction();

    await autoInsert();

    // The inserted, highlighted text IS the templated first-person opener --
    // not a sentence extracted from the article.
    expect(coverLines().join("\n")).toContain(REAL_1.suggestion);
    expect(markedText(), "the templated opener is not highlighted in the body").toContain(REAL_1.suggestion);

    // The honest framing: the FACT/article came "from research" -- the strip's
    // own heading -- with a real, openable SOURCE LINK as provenance (the
    // per-fact attribution that stands in for a corroboration tier we cannot
    // compute per fact). This link is the non-vacuity control for the negative
    // assertion below: provenance IS offered.
    expect(modalText(), "the review strip's honest 'Added from research' framing is missing").toContain("Added from research");
    expect(
      [...document.querySelectorAll('[aria-label="Open the source article"]')].length,
      "no openable source link -- provenance is not offered, so the negative claim below would be vacuous",
    ).toBeGreaterThan(0);

    // Nothing in the modal dresses the TEMPLATED sentence as something a source
    // reported/stated -- that would be the invented-fact-in-the-candidate's-voice
    // failure (N35). The article link is provenance; a "reported/according to"
    // claim about the sentence would be a lie the embedded engine cannot back.
    expect(
      /\b(reported by|according to|sources say|as reported|the article (says|states|reports)|confirmed by)\b/i.test(modalText()),
      "the modal implies a source reported the templated opener sentence",
    ).toBe(false);
  });
});
