// @vitest-environment jsdom
//
// N92 Wave 2 (Control C) -- the GENERATION-TIME forward nudge through the REAL
// autoInsertFactsForJob path: AC-C4 (last hop -- set -> generate -> facts one
// slot forward, visible AND in the download-rebuild source), AC-C9 (per-fact),
// AC-C7 (not retroactive), and AC-X1 (the nudge records via `fact-position`,
// counts/enums only, no letter text). Plan rows W2-S3/S4/S5.
//
// HOW THE NUDGE REACHES GENERATION (design 4.3, plan W2-S3): page.js reads
// `forward` from useCoverFactPlacement and passes it to useCompanyResearch as
// the `forwardPositioning` prop; autoInsertFactsForJob threads it into
// planAcceptForEntry as `forwardNudge`. This test drives the REAL hook with that
// prop and calls the REAL autoInsertFactsForJob, then reads the resulting
// tailoringMap and the PUT `coverVersion` off the wire.
//
// SHAPE B (no engine bytes, rebuildable template) is used on purpose: after an
// auto-insert the entry is edited, so buildDownloadArgs rebuilds the download
// from `coverLetterResultLines` (documentScopes.js cover branch), NOT from bytes
// -- so asserting the entry's lines (== the PUT coverVersion.lines) IS the
// download-source assertion for AC-C4, with no docx splice to confound it.
//
// RED ON HEAD (93afb75): useCompanyResearch does not destructure
// `forwardPositioning`, and autoInsertFactsForJob calls
// `planAcceptForEntry(entry, { facts, coverRecord })` with no `forwardNudge` --
// so the prop is inert and the fact lands at its plain placed position. The
// "moved forward" and "records a fact-position nudge" assertions fail on HEAD.
//
// WHAT THIS FILE DOES NOT PROVE (disclosed): (a) that the auto-insert effect
// fires unattended -- autoInsertFactsForJob is invoked directly here, as in
// autoInsertReacceptPlacement.test.js (effect wiring: factAutoArrivalGuards.rc);
// (b) that page.js actually reads `forward` from the hook and passes it as
// `forwardPositioning` -- that one-line god-component wiring (W2-S3 page.js half)
// is not covered by any mountable test short of rendering page.js, and is OWED to
// the verifier. The SettingsMenu toggle round-trip is covered in
// app/components/CoverFactForwardSetting.rc.test.js.

import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from "vitest";
import { createElement, useState, act } from "react";
import { createRoot } from "react-dom/client";

const decisions = vi.hoisted(() => ({ calls: [] }));
vi.mock("../../lib/activityLog/appActivityLog", async (importOriginal) => {
  const actual = await importOriginal();
  return { ...actual, recordDecision: vi.fn((...args) => decisions.calls.push(args)) };
});

import { useCompanyResearch } from "./useCompanyResearch.js";
import { sanitizeStoredFacts } from "@/lib/acceptedFacts/factStore.js";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const JOB_ID = "job-1";
const JOB = { id: JOB_ID, title: "Staff Engineer", company: "Acme", description: "React, Node, telemetry." };

const GREETING = "Dear Hiring Manager,";
const INTRO = "I am excited to apply for this role. I bring years of relevant experience. I would love to contribute to your mission.";
const CURRENT = "In my current role I lead a platform team. I ship features weekly every sprint.";
const CLOSING = "Sincerely,";
const SIGNATURE = "Jane Doe";
const BODY_LINES = [GREETING, INTRO, CURRENT, CLOSING, SIGNATURE];

const SUGGESTION = "Acme opened a Dublin telemetry lab.";
const ARTICLE = {
  id: "art-a",
  title: "Acme opens a Dublin telemetry lab",
  url: "https://news.example.com/acme/dublin-lab",
  source: "news.example.com",
  summary: "Acme has opened a new telemetry lab in Dublin.",
  suggestion: SUGGESTION,
};

function json(body) {
  return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
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

// Shape B entry: no engine bytes, but a rebuildable template is in session
// (coverLetterFile below is a .docx per isDocxResume), so autoInsert takes the
// lines path -- exactly the download-rebuild path buildDownloadArgs uses.
function entryShapeB(overrides = {}) {
  return {
    status: "done",
    result: "",
    resultLines: [],
    docxB64: "",
    docxPath: "",
    coverLetterResultLines: [...BODY_LINES],
    coverLetterDocxB64: "",
    coverLetterDocxPath: "",
    coverVersionId: "ver-1",
    ...overrides,
  };
}

let store = { facts: [], removed: [], revision: null };
let researchArticles = [];
let putCoverVersions = [];
let probe = null;
let container = null;
let root = null;

function HookProbe({ initialMap, defaultPlacement, forwardPositioning }) {
  const [tailoringMap, setTailoringMap] = useState(initialMap);
  const [previewReloadKey, setPreviewReloadKey] = useState(0);
  const research = useCompanyResearch({
    tailoringMap,
    setTailoringMap,
    setPreviewReloadKey,
    defaultPlacement,
    forwardPositioning,
    coverLetterFile: { name: "template.docx" }, // isDocxResume -> canRebuild (Shape B)
  });
  probe = { tailoringMap, setTailoringMap, research, previewReloadKey };
  return null;
}

beforeAll(() => {});

beforeEach(() => {
  store = { facts: [], removed: [], revision: null };
  researchArticles = [];
  putCoverVersions = [];
  probe = null;
  decisions.calls = [];
  globalThis.fetch = vi.fn(async (url, init = {}) => {
    const method = (init.method || "GET").toUpperCase();
    const u = String(url);
    if (u.includes("/api/company-research")) return json({ articles: researchArticles, warnings: [] });
    if (u.includes("/api/accepted-facts")) {
      if (method === "GET") return json({ facts: store.facts, removed: store.removed, revision: store.revision });
      const body = JSON.parse(init.body);
      if (body.coverVersion) putCoverVersions.push(body.coverVersion);
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
  vi.restoreAllMocks();
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
async function mount({ defaultPlacement, forwardPositioning }) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => {
    root.render(createElement(HookProbe, { initialMap: { [JOB_ID]: entryShapeB() }, defaultPlacement, forwardPositioning }));
  });
  await flush();
}
async function rerender({ defaultPlacement, forwardPositioning }) {
  await act(async () => {
    root.render(createElement(HookProbe, { initialMap: probe.tailoringMap, defaultPlacement, forwardPositioning }));
  });
  await flush();
}
async function seedResearch() {
  researchArticles = [ARTICLE];
  store = { facts: [], removed: [], revision: null };
  await act(async () => {
    probe.research.openCompanyResearch(JOB);
  });
  await flush();
}
async function runAutoInsert() {
  await act(async () => {
    await probe.research.autoInsertFactsForJob(JOB_ID, () => true);
  });
  await drain();
}
function coverLines() {
  return probe.tailoringMap[JOB_ID]?.coverLetterResultLines || [];
}
function insertedFacts() {
  return probe.tailoringMap[JOB_ID]?.insertedFacts || [];
}

// A full set/generate cycle at a given forward preference. Fresh mount each time
// so the two runs are independent.
async function generateWithForward(forwardPositioning) {
  await mount({ defaultPlacement: "intro", forwardPositioning });
  await seedResearch();
  await runAutoInsert();
  return coverLines();
}

describe("AC-C4 last hop: forward preference on -> generated facts are one slot forward, visible AND downloaded (RED on HEAD)", () => {
  it("with forward OFF the fact lands right after the first sentence of the intro (baseline / over-fire control)", async () => {
    const lines = await generateWithForward(false);
    // Placed position: fact immediately after sentence 1.
    expect(lines[1]).toBe(
      "I am excited to apply for this role. Acme opened a Dublin telemetry lab. I bring years of relevant experience. I would love to contribute to your mission.",
    );
  });

  it("with forward ON the fact lands one sentence later (past sentence 2), and the PUT coverVersion matches the visible lines", async () => {
    const lines = await generateWithForward(true);
    // One slot forward: fact now sits after sentence 2.
    expect(lines[1], "the forward preference did not move the generated fact one slot forward").toBe(
      "I am excited to apply for this role. I bring years of relevant experience. Acme opened a Dublin telemetry lab. I would love to contribute to your mission.",
    );
    // The fact is in the letter exactly once and its record locates its own text.
    expect(occurrences(lines.join("\n"), SUGGESTION)).toBe(1);
    for (const r of insertedFacts()) {
      const span = String(lines[r.lineIndex] ?? "").slice(r.offset, r.offset + String(r.text).length);
      expect(span, "an inserted-fact record does not locate its own text after the nudge").toBe(r.text);
    }
    // THE LAST HOP: what persists (PUT coverVersion.lines -> the durable version
    // and the download-rebuild source) equals what is visible on screen.
    const put = putCoverVersions[putCoverVersions.length - 1];
    expect(put, "no coverVersion was PUT for the generated letter").toBeTruthy();
    expect(put.lines, "the persisted/downloaded coverVersion lines differ from the visible letter").toEqual(lines);
  });

  it("ON differs from OFF -- the preference actually changed the generated position (RED on HEAD: identical)", async () => {
    const off = await generateWithForward(false);
    const on = await generateWithForward(true);
    expect(on, "forward ON produced the same letter as forward OFF -- the preference had no effect").not.toEqual(off);
  });
});

describe("AC-X1 the forward nudge records a fact-position decision, counts/enums only, no letter text (RED on HEAD)", () => {
  it("a generation with forward ON records a fact-position outcome carrying a numeric count and NO fact text", async () => {
    await generateWithForward(true);
    const factPos = decisions.calls.filter((c) => c[0] === "fact-position");
    expect(factPos.length, "the forward nudge did not record a fact-position decision").toBeGreaterThan(0);
    const withCount = factPos.find((c) => typeof c[2]?.count === "number" && c[2].count >= 1);
    expect(withCount, "no fact-position decision carried a numeric affected-fact count (>=1) for the nudge").toBeTruthy();
    // N77: never the letter/company/url/article text in any recorded field.
    const serialized = JSON.stringify(factPos);
    expect(serialized, "the fact suggestion text leaked into the decision log").not.toContain(SUGGESTION);
    expect(serialized, "the article title leaked into the decision log").not.toContain(ARTICLE.title);
    expect(serialized, "a source url leaked into the decision log").not.toContain(ARTICLE.url);
  });

  it("CONTROL: a generation with forward OFF records NO fact-position nudge (the recording is specific to the nudge)", async () => {
    // Guards against a build that always logs a fact-position decision from the
    // auto path regardless of the preference. Green on HEAD (no recording at
    // all) and in the reference (recording only when the nudge fires).
    await generateWithForward(false);
    const factPos = decisions.calls.filter((c) => c[0] === "fact-position");
    expect(factPos.length, "a fact-position nudge was recorded even though the forward preference was OFF").toBe(0);
  });
});

describe("AC-C7 not retroactive: toggling the preference never rewrites a letter already generated (GUARD)", () => {
  it("an existing entry's lines and records are byte-identical after forwardPositioning changes with no re-generation", async () => {
    // GUARD: green on HEAD and in the reference (the preference is read only at
    // insert time). Power via a mutant that re-plans existing letters on a
    // preference change. A positive control ensures 'unchanged' is not
    // 'unchanged because nothing was ever inserted'.
    await mount({ defaultPlacement: "intro", forwardPositioning: true });
    await seedResearch();
    await runAutoInsert();
    expect(coverLines().join("\n"), "the fact was not inserted before the toggle").toContain(SUGGESTION);
    const linesBefore = JSON.stringify(coverLines());
    const recordsBefore = JSON.stringify(insertedFacts());

    // Flip the preference in-session; NO second generation is triggered.
    await rerender({ defaultPlacement: "intro", forwardPositioning: false });

    expect(JSON.stringify(coverLines()), "toggling the forward preference rewrote an existing letter's lines").toBe(linesBefore);
    expect(JSON.stringify(insertedFacts()), "toggling the forward preference moved/rewrote existing fact records").toBe(recordsBefore);
  });
});
