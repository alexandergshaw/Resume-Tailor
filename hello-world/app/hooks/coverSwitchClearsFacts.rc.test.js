// @vitest-environment jsdom
//
// N71 (backlog): ON A COVER VERSION SWITCH, CLEAR THE RECORDED FACTS.
//
// The defect, verified against HEAD (c904500): selectDocumentVersion
// (app/hooks/useDocumentPreview.js) for the cover scope replaces the letter's
// lines, clears coverLetterDocxB64 and the edited flag -- but NEVER touches
// entry.insertedFacts. So after switching to a DIFFERENT saved cover version:
//   (1) the strip (DocumentPreviewMount.js:108-112, gated on
//       insertedFacts.length > 0) lists facts that are not provenance of the
//       version now on screen -- phantom rows; and
//   (2) the body-highlight path (useDocumentPreview.js loadPreviewModel, the
//       opts.factHighlight branch -> lib/document/versionDiff.js#markInsertedFacts)
//       still runs the STALE located records against the switched-to text.
//
// FINDING (corrects the brief's premise, verified in-file): the shipped
// markInsertedFacts is OFFSET-EXACT -- versionDiff.js:168 skips a locator
// unless `text.slice(offset, offset+len) === locator.text`. So a switched-to
// version that contains the fact sentence at a DIFFERENT offset paints
// NOTHING (not a "wrong span") with or without the fix; the danger there is
// the phantom strip, not a mispainted highlight. A version that contains the
// sentence at the SAME in-paragraph offset (a shared opening paragraph -- the
// common real case) is the one the stale locator wrongly paints as an
// accepted fact. Both cases are pinned below, and each test states which
// assertion carries its discriminating teeth.
//
// The fix under test lives in selectDocumentVersion's COVER branch only. The
// resume scope must be untouched (Test 5), and switching back must not
// resurrect a record (Test 4) -- the version row carries no inserted_facts
// column to rehydrate from (lib/supabase/documentVersions.js COLUMNS_BY_SCOPE).
//
// REACHABILITY: every test drives the real production entry point
// api.selectDocumentVersion (what VersionControl's onSelect calls) on the real
// hook, and reads the model back through the real loadPreviewModel (what
// DocumentPreviewDialog.js:352 calls with { factHighlight: scope === "cover" }).
// Only Supabase is stubbed. The strip itself is rendered by
// DocumentPreviewMount.js -- a file another agent owns and is editing this
// session -- so rather than re-render it, these tests pin its SOLE data input
// (tailoringMap[jobId].insertedFacts, DocumentPreviewMount.js:93), from which
// its `.length > 0` visibility gate is a pure derivation. See the report.
//
// The docblock on line 1 is a per-file jsdom override; vitest.config.js stays
// environment: "node".

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createElement, useState, act } from "react";
import { createRoot } from "react-dom/client";

vi.mock("../../lib/supabase/client", () => ({
  createClient: () => ({
    from: () => ({
      select: () => ({
        eq: () => ({ maybeSingle: async () => ({ data: { id: "pos-1" }, error: null }) }),
      }),
    }),
    // No storage.download is exercised: every fixture below forces the
    // plain-text (linesToModel) render path by leaving coverLetterDocxB64/
    // docxB64 empty and no uploaded template, so resolveDocumentBlob returns
    // null and the model comes from the version's own content_lines. That
    // keeps the fact-run count a deterministic function of the located
    // records, with no .docx parsing in the loop.
    storage: { from: () => ({ download: async () => ({ data: null, error: { message: "n/a" } }) }) },
  }),
}));

vi.mock("../../lib/supabase/documentVersions", () => ({
  fetchDocumentVersions: vi.fn(),
  pointApplicationAtVersion: vi.fn(),
}));

vi.mock("../../lib/supabase/persistGeneration", () => ({
  persistGeneratedDocuments: vi.fn(async () => undefined),
}));

import { useDocumentPreview } from "./useDocumentPreview.js";
import { fetchDocumentVersions, pointApplicationAtVersion } from "../../lib/supabase/documentVersions";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const JOB_ID = "job-1";

const GREETING = "Dear Hiring Manager,";
const FACT = "Acme just opened a Dublin research lab.";
// The fact sentence sits MID-paragraph, after a first sentence, so its offset
// is > 0 -- which is what lets the "different offset" version (FACT at 0)
// genuinely differ from the "same offset" version.
const BODY = `We admire Acme's mission. ${FACT} I would be proud to contribute my skills.`;
const FACT_OFFSET = BODY.indexOf(FACT);

// The record planCoverFacts would have stored when the fact was accepted into
// the CURRENT (newest, c2) cover version: located, not text-keyed.
const LOCATED_FACT = { id: "fact-dublin", text: FACT, lineIndex: 1, offset: FACT_OFFSET };

// Same-offset older version (c1): a distinct earlier revision whose body
// paragraph carries the SAME sentence at the SAME in-paragraph offset (only
// the greeting differs). A stale locator paints it -- the wrong-span case.
const C1_LINES = ["To the Hiring Team,", BODY];
// Different-offset older version (cDiff): the sentence is present but at
// offset 0, so an offset-exact locator misses it entirely.
const CDIFF_LINES = ["Dear Team,", `${FACT} We would be glad to help move it forward.`];

const VERSIONS = {
  resume: [
    { id: "r2", content: "NEWEST RESUME TEXT", content_lines: ["NEWEST RESUME TEXT"], created_at: "2026-08-02T00:00:00.000Z", docx_path: "" },
    { id: "r1", content: "FIRST RESUME TEXT", content_lines: ["FIRST RESUME TEXT"], created_at: "2026-08-01T00:00:00.000Z", docx_path: "" },
  ],
  cover: [
    { id: "c2", content: [GREETING, BODY].join("\n"), content_lines: [GREETING, BODY], created_at: "2026-08-03T00:00:00.000Z" },
    { id: "c1", content: C1_LINES.join("\n"), content_lines: C1_LINES, created_at: "2026-08-02T00:00:00.000Z" },
    { id: "cDiff", content: CDIFF_LINES.join("\n"), content_lines: CDIFF_LINES, created_at: "2026-08-01T00:00:00.000Z" },
  ],
};

function coverFactEntry() {
  return {
    status: "done",
    result: "NEWEST RESUME TEXT",
    resultLines: ["NEWEST RESUME TEXT"],
    docxB64: "",
    docxPath: "",
    // Matches the c2 (current) cover version; no engine docx / no upload, so
    // loadPreviewModel renders from these lines via linesToModel.
    coverLetterResultLines: [GREETING, BODY],
    coverLetterDocxB64: "",
    insertedFacts: [{ ...LOCATED_FACT }],
    edited: { resume: false, cover: false },
  };
}

// ---------------------------------------------------------------------------
// Harness (shape mirrors useDocumentPreview.wiring.test.js)
// ---------------------------------------------------------------------------

let api = null;
let latestMap = null;
let container = null;
let root = null;

function Probe({ initialMap }) {
  const [tailoringMap, setTailoringMap] = useState(initialMap);
  latestMap = tailoringMap;
  api = useDocumentPreview({
    tailoringMap,
    setTailoringMap,
    // Verbatim from app/page.js's updateTailoringJob.
    updateTailoringJob: (jobId, updater) =>
      setTailoringMap((current) => ({
        ...current,
        [jobId]: typeof updater === "function" ? updater(current[jobId] || {}) : { ...(current[jobId] || {}), ...updater },
      })),
    resumeFile: null,
    coverLetterFile: null,
    additionalContext: "",
    aggressiveness: 3,
    contextFiles: [],
    downloadDocxFiles: async () => null,
    startBackgroundResearch: () => {},
    setPreviewReloadKey: () => {},
    onDocumentEdited: () => {},
    currentUser: { id: "user-1" },
  });
  return null;
}

async function openWith(entry) {
  await act(async () => {
    root.render(createElement(Probe, { initialMap: { [JOB_ID]: entry } }));
  });
  await act(async () => {
    api.openResumePreview({ id: JOB_ID, title: "Staff Engineer", company: "Acme" });
  });
  // loadVersionsForJob is fire-and-forget, so the background fetch needs its
  // own flush before the version history is present.
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
  // Guard: selectDocumentVersion returns early for an id not in the loaded
  // history, which would make every switch below a vacuous no-op.
  expect(api.documentVersions.cover.map((v) => v.id)).toEqual(["c2", "c1", "cDiff"]);
  expect(api.documentVersions.resume.map((v) => v.id)).toEqual(["r2", "r1"]);
  expect(api.currentVersionId.cover).toBe("c2");
}

async function select(scope, versionId) {
  await act(async () => {
    api.selectDocumentVersion(scope, versionId);
  });
  await act(async () => {
    await Promise.resolve();
  });
}

const factsOf = () => (latestMap[JOB_ID].insertedFacts || []);

function countFactRuns(model) {
  let n = 0;
  for (const p of model?.paragraphs || []) for (const r of p.runs || []) if (r.insertedFact) n += 1;
  return n;
}
function modelText(model) {
  return (model?.paragraphs || []).map((p) => (p.runs || []).map((r) => r.text).join("")).join("\n");
}
const coverModel = () => api.loadPreviewModel("cover", { factHighlight: true });

beforeEach(() => {
  fetchDocumentVersions.mockReset();
  fetchDocumentVersions.mockImplementation(async (_client, scope) => VERSIONS[scope] || []);
  pointApplicationAtVersion.mockReset();
  pointApplicationAtVersion.mockResolvedValue(true);
  api = null;
  latestMap = null;
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});

afterEach(async () => {
  await act(async () => {
    root.unmount();
  });
  container.remove();
});

// ---------------------------------------------------------------------------
// Sanity: the fixtures actually exercise the two offset regimes. If these
// drift, every discrimination claim below is void -- so they are asserted,
// not assumed (a canary against the same-source trap: the offsets come from
// indexOf on the real strings the harness feeds the hook).
// ---------------------------------------------------------------------------

describe("fixtures exercise the intended offset regimes", () => {
  it("same-offset version holds FACT at the original in-paragraph offset; different-offset version does not", () => {
    expect(FACT_OFFSET).toBeGreaterThan(0);
    // c1's body paragraph carries FACT at exactly FACT_OFFSET (a stale locator
    // would paint it).
    expect(C1_LINES[1].slice(FACT_OFFSET, FACT_OFFSET + FACT.length)).toBe(FACT);
    // cDiff DOES contain the sentence, but NOT at FACT_OFFSET (offset-exact
    // miss) -- proving the "different offset" highlight assertion is about a
    // real, present sentence, not an absent one.
    expect(CDIFF_LINES[1]).toContain(FACT);
    expect(CDIFF_LINES[1].slice(FACT_OFFSET, FACT_OFFSET + FACT.length)).not.toBe(FACT);
  });
});

// ---------------------------------------------------------------------------
// Test 1 -- the strip's data source clears (RED on HEAD)
// ---------------------------------------------------------------------------

describe("a cover version switch clears the recorded facts (strip source)", () => {
  it("no facts remain after a cover switch; facts were present before (non-vacuity)", async () => {
    await openWith(coverFactEntry());

    // NON-VACUITY: before the switch the strip's gate (insertedFacts.length>0,
    // DocumentPreviewMount.js:109) is satisfied -- so "empty after" is not a
    // property the entry had all along.
    expect(factsOf().length).toBeGreaterThan(0);

    await select("cover", "c1");

    // On HEAD the record survives the switch (phantom rows). The fix clears it.
    expect(factsOf().length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Test 2 -- body highlight, SAME-offset version (the wrong-span case, RED on HEAD)
// ---------------------------------------------------------------------------

describe("a cover switch stops the body from being painted as an accepted fact", () => {
  it("a same-offset older version is not marked after the switch", async () => {
    await openWith(coverFactEntry());

    // POSITIVE CONTROL + non-vacuity: before the switch the clause IS painted,
    // on a really-rendered 2-paragraph model.
    const before = await coverModel();
    expect(before.paragraphs.length).toBe(2);
    expect(modelText(before)).toContain(FACT);
    expect(countFactRuns(before)).toBeGreaterThan(0);

    await select("cover", "c1");

    const after = await coverModel();
    // NON-VACUITY the brief calls out explicitly: the model still renders
    // c1's text (2 paragraphs, the sentence present) -- so a fact-run count of
    // 0 cannot be "nothing rendered".
    expect(after.paragraphs.length).toBe(2);
    expect(modelText(after)).toContain(FACT);
    // DISCRIMINATING: on HEAD the stale locator paints c1's shared sentence
    // (countFactRuns > 0). The fix empties insertedFacts, so loadPreviewModel's
    // `entry.insertedFacts?.length` gate is 0 and markInsertedFacts never runs.
    expect(countFactRuns(after)).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Test 3 -- DIFFERENT-offset version (brief item 2 wording; teeth in the strip)
// ---------------------------------------------------------------------------

describe("a cover switch to a different-offset version marks nothing and clears the strip", () => {
  it("the sentence is present at a new offset but is neither painted nor stripped", async () => {
    await openWith(coverFactEntry());

    expect(countFactRuns(await coverModel())).toBeGreaterThan(0); // pre: painted

    await select("cover", "cDiff");

    const after = await coverModel();
    expect(after.paragraphs.length).toBe(2);
    expect(modelText(after)).toContain(FACT);
    // DOCUMENTATION assertion, NOT discriminating on its own: markInsertedFacts
    // is offset-exact (versionDiff.js:168), so a fact at a different offset is
    // unpainted with OR without the fix. The teeth for this case are the strip
    // clear on the next line. This corrects the brief's "wrong span at a
    // different offset" premise -- the located highlighter cannot mispaint.
    expect(countFactRuns(after)).toBe(0);
    // DISCRIMINATING: on HEAD the phantom row survives (strip shows a fact the
    // switched-to version never had reviewed). The fix clears it.
    expect(factsOf().length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Test 4 -- switching back must not resurrect the record (RED on HEAD)
// ---------------------------------------------------------------------------

describe("switching back does not resurrect a stale record", () => {
  it("returning to the version the facts were inserted into leaves them cleared", async () => {
    await openWith(coverFactEntry());

    await select("cover", "c1");
    expect(factsOf().length).toBe(0); // cleared by the switch away

    await select("cover", "c2"); // back to the version the facts were inserted into

    // Still empty: this pins the IN-SCOPE decision that there is NO per-version
    // rehydration -- the cover version row carries no inserted_facts column
    // (lib/supabase/documentVersions.js COLUMNS_BY_SCOPE.cover), so provenance
    // cannot come back, and the fix must not invent it. On HEAD the record was
    // never cleared, so the first assertion above already fails there.
    expect(factsOf().length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// Test 5 -- resume scope is UNAFFECTED (green on HEAD; a scoping guard)
// ---------------------------------------------------------------------------

describe("a resume version switch does not clear the cover letter's facts", () => {
  it("cover facts survive a resume switch and still paint", async () => {
    // DISCLOSURE: this test is GREEN on HEAD (HEAD clears nothing). Its job is
    // to fail the OVER-BROAD fix ("clear on ANY switch"): the mutant that adds
    // the clear to the resume branch turns it red. Kept as the control that
    // pins the fix's scope, per the brief's item 5.
    await openWith(coverFactEntry());
    expect(factsOf().length).toBeGreaterThan(0);

    await select("resume", "r1");

    expect(factsOf().length).toBeGreaterThan(0); // untouched by a resume switch
    expect(countFactRuns(await coverModel())).toBeGreaterThan(0); // still painted
  });
});

// ---------------------------------------------------------------------------
// Test 6 -- the clear leaves a clean base for a later accept (not wedged)
// ---------------------------------------------------------------------------

describe("the clear does not wedge the feature", () => {
  it("leaves an empty (not sentinel) fact set on the switched-to version's text", async () => {
    // The accept/insert path itself lives in app/hooks/useCompanyResearch.js
    // (another agent's area, out of this file's scope). What this seat CAN
    // pin: the clear writes an EMPTY fact collection of the same shape a fresh
    // generation starts from, on the switched-to version's own text, with the
    // cover marked pristine -- a clean base a later accept can build on rather
    // than a sticky flag that suppresses it.
    await openWith(coverFactEntry());
    await select("cover", "c1");

    const entry = latestMap[JOB_ID];
    expect(entry.insertedFacts || []).toEqual([]); // empty, tolerant of [] or undefined; RED on HEAD (stale record survives)
    expect(entry.coverLetterResultLines).toEqual(C1_LINES); // the switched-to text a fresh accept would read
    expect(entry.edited.cover).toBe(false); // a stored version is not a hand-edit
  });
});
