// @vitest-environment jsdom
//
// N81 AUTO PATH, the SECOND caller of the shared seam -- the regression-class
// witness. `autoInsertFactsForJob` (useCompanyResearch.js:610) and the manual
// `acceptFacts` both route through `planAcceptForEntry` / `planCoverFacts`. The
// N81 fix puts a SINGLE id-level dedupe guard at that seam so a third caller
// cannot reintroduce the defect. For that to be a real class guard, the auto
// path must DEPEND on the shared seam -- not on its own local `insertedIds`
// filter (:694-699), which today masks the seam's blindness.
//
// WHAT THIS FILE PINS: a fact auto-inserted at one default placement, then the
// saved default is CHANGED and auto-insert runs again for the same job, must
// still appear exactly ONCE. This is GREEN on HEAD (the local `insertedIds`
// filter catches it). Its power is demonstrated in the notes artifact against a
// reference tree where the local filter is removed and the seam guard is the
// sole protection: removing the shared guard then reds THIS test AND the manual
// path's -- proving one mutation kills both callers, so the guard is genuinely
// over the class.
//
// WHY THE ANCHOR MUST BE PRESENT (wrong-reason trap, per autoInsertHonorsDefault
// .test.js): if 'current' fell back to the intro line, the second insert would
// coincide with the first and the text dedupe would hide any duplicate. The
// engine letter carries a distinct 'in my current role' line; asserted below.
//
// Harness mirrors app/hooks/autoInsertHonorsDefault.test.js.

import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from "vitest";
import { createElement, useState, act } from "react";
import { createRoot } from "react-dom/client";

import { useCompanyResearch } from "./useCompanyResearch.js";
import { sanitizeStoredFacts } from "@/lib/acceptedFacts/factStore.js";
import { embeddedEngine } from "@/lib/llm/engines/tailor-lite/engine.js";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const JOB_ID = "job-1";
const JOB = { id: JOB_ID, title: "Staff Engineer", company: "Acme", description: "React, Node, telemetry." };

const REAL_1 = {
  id: "art-a",
  title: "Acme opens a Dublin telemetry lab",
  url: "https://news.example.com/acme/dublin-lab",
  source: "news.example.com",
  summary: "Acme has opened a new telemetry lab in Dublin.",
  suggestion: "I was glad to see Acme opened a Dublin telemetry lab, and it reinforces my interest here.",
};

const CURRENT_ANCHOR = /in my current role/i;
function introIndex(lines) {
  const i = lines.findIndex((l, idx) => idx > 0 && String(l).trim().length > 40);
  return i >= 0 ? i : lines.length > 1 ? 1 : 0;
}

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
let setDp = null;
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

function HookProbe({ initialMap, initialDefault }) {
  const [tailoringMap, setTailoringMap] = useState(initialMap);
  const [defaultPlacement, setDefaultPlacement] = useState(initialDefault);
  setDp = setDefaultPlacement;
  const [previewReloadKey, setPreviewReloadKey] = useState(0);
  const research = useCompanyResearch({ tailoringMap, setTailoringMap, setPreviewReloadKey, defaultPlacement });
  probe = { tailoringMap, setTailoringMap, research, previewReloadKey };
  return null;
}

beforeEach(() => {
  store = { facts: [], removed: [], revision: null };
  researchArticles = [];
  probe = null;
  setDp = null;
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
async function mount(initialMap, initialDefault) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root.render(createElement(HookProbe, { initialMap, initialDefault }));
  });
  await flush();
}
async function seedResearch(job, articles) {
  researchArticles = articles;
  store = { facts: [], removed: [], revision: null };
  await act(async () => {
    probe.research.openCompanyResearch(job);
  });
  await flush();
}
async function runAutoInsert() {
  await act(async () => {
    await probe.research.autoInsertFactsForJob(JOB_ID, () => true);
  });
  await drain();
}
async function setDefault(value) {
  await act(async () => {
    setDp(value);
  });
  await flush();
}
function coverLines() {
  return probe.tailoringMap[JOB_ID]?.coverLetterResultLines || [];
}
function count(hay, needle) {
  return String(hay).split(needle).length - 1;
}

// ---------------------------------------------------------------------------
// Fixture precondition -- wrong-reason trap.
// ---------------------------------------------------------------------------

describe("N81 auto path: fixture precondition", () => {
  it("the 'current role' anchor is present on a line distinct from intro, and the letter lacks the fact", () => {
    expect(CURRENT_IDX, "no 'in my current role' line -- 'current' would fall back to intro and mask the defect").toBeGreaterThanOrEqual(0);
    expect(INTRO_IDX).toBeGreaterThanOrEqual(0);
    expect(CURRENT_IDX, "'current' and 'intro' coincide -- cannot discriminate").not.toBe(INTRO_IDX);
    expect(ENGINE_LINES.join("\n")).not.toContain(REAL_1.suggestion);
  });
});

// ---------------------------------------------------------------------------
// The class witness. GREEN on HEAD (local insertedIds filter); RED under the
// shared-guard-removal mutant in the reference tree (see notes artifact).
// ---------------------------------------------------------------------------

describe("N81 auto path: re-running auto-insert after the default placement changes does not duplicate the fact", () => {
  it("intro then current: the auto-inserted fact appears exactly once", async () => {
    await mount({ [JOB_ID]: entryWithEngineLetter() }, "intro");
    await seedResearch(JOB, [REAL_1]);

    // Run 1 at the 'intro' default. Non-vacuity + over-fire guard: the fact IS
    // inserted (a "skip everything" fix would fail here).
    await runAutoInsert();
    expect(count(coverLines().join("\n"), REAL_1.suggestion), "the fact was not auto-inserted on the first run").toBe(1);
    expect(String(coverLines()[INTRO_IDX] ?? ""), "the first auto-insert did not land on the intro line").toContain(REAL_1.suggestion);

    // The candidate changes the saved default to 'current'; the SAME job's
    // auto-insert runs again (a re-open, another effect fire).
    await setDefault("current");
    await runAutoInsert();

    // THE CRITERION: still exactly once. On HEAD the local insertedIds filter
    // keeps it so; the notes artifact shows that with that filter removed, only
    // the shared seam guard keeps this green -- and removing the seam guard reds
    // both this and the manual path.
    expect(
      count(coverLines().join("\n"), REAL_1.suggestion),
      "the auto path duplicated the fact after the default placement changed (N81 class)",
    ).toBe(1);
  });
});

// WHAT THIS FILE CANNOT CATCH. It drives the real hook but stubs the store, and
// it is GREEN on HEAD by construction (the local filter). It is a class witness,
// not a HEAD-red defect test: its teeth are only visible under the reference-tree
// mutation recorded in the notes artifact. It does not prove the auto effect
// fires on its own (autoInsertFactsForJob is invoked directly here); the effect
// wiring is covered by factAutoArrivalGuards.rc.test.js.
