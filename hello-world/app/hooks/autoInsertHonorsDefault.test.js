// @vitest-environment jsdom
//
// N62 Capability A -- AC-A2b / AC-A3: THE CRITERION THE WHOLE CHUNK EXISTS FOR.
// The owner's words were "auto insert facts ... so that all their applications
// use that spot." The truly automatic path is autoInsertFactsForJob
// (useCompanyResearch.js:610), fired once per job by the preview effect. On HEAD
// it builds each fact as `{id, text, url, title}` with NO placement
// (useCompanyResearch.js:690), so every auto-inserted fact resolves to
// DEFAULT_PLACEMENT ("intro") via resolvePlacement -- the saved default is never
// read there. A preference threaded ONLY into the research dialog would leave
// the control looking like it works while changing nothing on the exact path
// the owner named. These tests pin that the auto path honours the stored
// default, and that a second, different application inherits the same one.
//
// WHY THE ANCHOR MUST BE PRESENT (the wrong-reason trap). "current" resolves to
// the "in my current role" line; if that anchor were ABSENT, resolvePlacement
// would fall back to the intro line -- and then a HEAD build (which also uses
// intro) and a correct build (which resolves "current") would land on the SAME
// line, so the test would pass on HEAD for the wrong reason. The embedded engine
// letter used here DOES carry that anchor on a line distinct from the intro
// line; both indices are asserted present and distinct as a fixture
// precondition, so a variant that dropped the anchor fails loudly rather than
// passing hollow.
//
// The harness (real useCompanyResearch, real embedded-engine docx bytes so the
// splice actually applies, stubbed fetch for /api/accepted-facts) mirrors the
// sibling app/hooks/autoInsertFactsForJob.test.js.

import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from "vitest";
import { createElement, useState, act } from "react";
import { createRoot } from "react-dom/client";

import { useCompanyResearch } from "./useCompanyResearch.js";
import { sanitizeStoredFacts } from "@/lib/acceptedFacts/factStore.js";
import { embeddedEngine } from "@/lib/llm/engines/tailor-lite/engine.js";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const JOB_ID = "job-1";
const JOB_ID_2 = "job-2";
const JOB = { id: JOB_ID, title: "Staff Engineer", company: "Acme", description: "React, Node, telemetry." };
const JOB2 = { id: JOB_ID_2, title: "Principal Engineer", company: "Acme", description: "React, Node, telemetry." };

// One eligible, real-sourced article whose suggestion is a full, independently
// locatable sentence.
const REAL_1 = {
  title: "Acme opens a Dublin telemetry lab",
  url: "https://news.example.com/acme/dublin-lab",
  source: "news.example.com",
  summary: "Acme has opened a new telemetry lab in Dublin.",
  suggestion: "I was glad to see Acme opened a Dublin telemetry lab, and it reinforces my interest here.",
};

// The same logic coverLetterWeave.js / factInsertion.js use to pick the intro
// paragraph -- kept here (they do not export it) so the fixture-precondition
// assertion checks against the real rule, not a guess.
function introIndex(lines) {
  const i = lines.findIndex((l, idx) => idx > 0 && String(l).trim().length > 40);
  return i >= 0 ? i : lines.length > 1 ? 1 : 0;
}
const CURRENT_ANCHOR = /in my current role/i;

let ENGINE_B64 = "";
let ENGINE_LINES = [];
let INTRO_IDX = -1;
let CURRENT_IDX = -1;

beforeAll(async () => {
  const cl = await embeddedEngine.tailorCoverLetter({
    jobPosting: "Staff Engineer at Acme. React, Node, telemetry, accessibility.",
    jobTitle: "Staff Engineer",
    companyName: "Acme",
  });
  ENGINE_B64 = cl.docxB64;
  ENGINE_LINES = cl.resultLines;
  INTRO_IDX = introIndex(ENGINE_LINES);
  CURRENT_IDX = ENGINE_LINES.findIndex((l) => CURRENT_ANCHOR.test(String(l)));
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

// HookProbe threads the NEW `defaultPlacement` option into useCompanyResearch,
// exactly as page.js will (plan step 2). On HEAD the option is ignored, which is
// the whole point -- the fact then resolves to "intro".
function HookProbe({ initialMap, defaultPlacement }) {
  const [tailoringMap, setTailoringMap] = useState(initialMap);
  const [previewReloadKey, setPreviewReloadKey] = useState(0);
  const research = useCompanyResearch({ tailoringMap, setTailoringMap, setPreviewReloadKey, defaultPlacement });
  probe = { tailoringMap, setTailoringMap, research, previewReloadKey };
  return null;
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

async function flush(times = 6) {
  for (let i = 0; i < times; i += 1) {
    await act(async () => {
      await Promise.resolve();
    });
  }
}
async function drain(steps = 20) {
  for (let n = 0; n < steps; n += 1) {
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 10));
    });
  }
}
async function mount(initialMap, defaultPlacement) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root.render(createElement(HookProbe, { initialMap, defaultPlacement }));
  });
  await flush();
}

// Warm a job's research + seed its accepted-facts state (the removed log) the
// real way, through openCompanyResearch.
async function seedResearch(job, articles) {
  researchArticles = articles;
  store = { facts: [], removed: [], revision: null };
  await act(async () => {
    probe.research.openCompanyResearch(job);
  });
  await flush();
}

function coverLines(jobId = JOB_ID) {
  return probe.tailoringMap[jobId]?.coverLetterResultLines || [];
}
function insertedFacts(jobId = JOB_ID) {
  return probe.tailoringMap[jobId]?.insertedFacts || [];
}

describe("fixture precondition", () => {
  it('the "current" anchor is present, on a line distinct from the intro line', () => {
    expect(CURRENT_IDX, "the embedded letter variant has no 'in my current role' line -- fixture is unsound").toBeGreaterThanOrEqual(0);
    expect(INTRO_IDX).toBeGreaterThanOrEqual(0);
    expect(CURRENT_IDX, "the current-role line and the intro line coincided; a honouring test cannot discriminate").not.toBe(INTRO_IDX);
  });
});

describe("AC-A2b: the auto-insert path honours the saved default placement", () => {
  it('auto-inserts on the "current" line, not the "intro" line, when the default is "current" (RED on HEAD)', async () => {
    await mount({ [JOB_ID]: entryWithEngineLetter() }, "current");
    await seedResearch(JOB, [REAL_1]);

    await act(async () => {
      await probe.research.autoInsertFactsForJob(JOB_ID, () => true);
    });
    await drain();

    const lines = coverLines();
    // Positive control: the fact WAS inserted somewhere (so "not on intro" is
    // not vacuously satisfied by a run that inserted nothing).
    expect(lines.join("\n"), "the eligible fact was not auto-inserted at all").toContain(REAL_1.suggestion);
    // The criterion: it landed on the saved-default line.
    expect(
      String(lines[CURRENT_IDX] ?? ""),
      "the auto-inserted fact did not land on the saved-default (current-role) line -- the default was ignored on the auto path",
    ).toContain(REAL_1.suggestion);
    expect(
      String(lines[INTRO_IDX] ?? ""),
      "the auto-inserted fact landed on the intro line (the hardcoded default), so the saved default was not honoured",
    ).not.toContain(REAL_1.suggestion);
    // And the located record points at the saved-default line, so the highlight
    // and one-click removal act on the right paragraph.
    const rec = insertedFacts().find((r) => r.text === REAL_1.suggestion);
    expect(rec, "the auto-inserted fact was not recorded located").toBeTruthy();
    expect(rec.lineIndex, "the record's lineIndex is not the saved-default line").toBe(CURRENT_IDX);
  });

  it('with no saved default (option absent), the auto path still lands on the intro line (closed lower boundary)', async () => {
    // Byte-compatible with today: absent option => DEFAULT_PLACEMENT. Green on
    // HEAD; kept so a build that made the option mandatory, or that resolved an
    // empty default to a non-intro line, fails here.
    await mount({ [JOB_ID]: entryWithEngineLetter() }, undefined);
    await seedResearch(JOB, [REAL_1]);

    await act(async () => {
      await probe.research.autoInsertFactsForJob(JOB_ID, () => true);
    });
    await drain();

    const lines = coverLines();
    expect(lines.join("\n")).toContain(REAL_1.suggestion);
    expect(String(lines[INTRO_IDX] ?? "")).toContain(REAL_1.suggestion);
  });
});

describe('AC-A3: "all their applications use that spot" -- a second job inherits the one default with no per-app re-entry', () => {
  it("two distinct jobs both auto-insert on the saved-default line from a single default (RED on HEAD)", async () => {
    await mount(
      { [JOB_ID]: entryWithEngineLetter(), [JOB_ID_2]: entryWithEngineLetter() },
      "current",
    );

    // First application.
    await seedResearch(JOB, [REAL_1]);
    await act(async () => {
      await probe.research.autoInsertFactsForJob(JOB_ID, () => true);
    });
    await drain();

    // Second application -- research reopened for it, no per-app placement step.
    await seedResearch(JOB2, [REAL_1]);
    await act(async () => {
      await probe.research.autoInsertFactsForJob(JOB_ID_2, () => true);
    });
    await drain();

    for (const jobId of [JOB_ID, JOB_ID_2]) {
      const lines = coverLines(jobId);
      expect(lines.join("\n"), `${jobId}: fact not inserted`).toContain(REAL_1.suggestion);
      expect(
        String(lines[CURRENT_IDX] ?? ""),
        `${jobId}: the second application did not inherit the one saved default`,
      ).toContain(REAL_1.suggestion);
      expect(String(lines[INTRO_IDX] ?? ""), `${jobId}: fact landed on intro, not the saved default`).not.toContain(REAL_1.suggestion);
    }
  });
});
