// @vitest-environment jsdom
//
// N92 Wave 2 (Control C) -- FIX-FORWARD after the fresh verifier's Sev-1
// NOT-SHIP on commit 5fa8392 (docs/loop/N92.verify.w2.r1.md, Bug 1). This is
// the END-TO-END last-hop test on the SPLICE path the shipped suite deliberately
// avoided: it drives the REAL autoInsertFactsForJob against an entry that has
// REAL cover-letter docx bytes (strategy === "splice"), then reads the ACTUAL
// stored `coverLetterDocxB64` back out and parses it -- the very bytes
// lib/document/docx.js#resolveDocumentBlob serves VERBATIM to both the preview
// and the download (the entry is never marked `edited`, so the verbatim-serve
// branch stays active, verify.w2.r1.md steps 4-5).
//
// AC-C4 verbatim: "With the toggle ON, a newly generated letter that auto-inserts
// facts positions them one forward-slot from placement, visible in the preview
// highlight AND at that position in the download." AC-C4 names NO carve-out for
// the byte-backed case. The shipped autoInsertForwardNudge.rc.test.js used Shape
// B (no bytes) "with no docx splice to confound it" -- the exact carve-out that
// hid the defect. This file removes it.
//
// HOW THE BYTES ARE READ: the splice is real. `buildControlledCoverDocxB64`
// makes a genuine .docx (a valid container from the embedded engine, its body
// paragraphs replaced with our fixture lines) so that
// lib/acceptedFacts/factDocx.js#applyCoverDocxEdits can find each edit's `before`
// paragraph and rewrite it. After the run we `loadDocx` the STORED bytes and
// take `documentLines` -- the plain text the served .docx actually carries.
//
// RED ON HEAD (5fa8392): applyForwardNudge nudges cover.lines/record but leaves
// cover.edits un-nudged (factInsertion.js:414-435). autoInsertFactsForJob splices
// those stale edits (useCompanyResearch.js:857), stores the resulting bytes as
// the entry's coverLetterDocxB64 (:938), and sets coverLetterResultLines to the
// NUDGED lines (:934). So the stored/served docx shows the fact one slot EARLIER
// than the visible lines. The "served bytes match the visible letter" and
// "ON differs from OFF" assertions fail on HEAD; the OFF control stays green.
//
// SATISFIABILITY: a reference fix (nudge-before-plan, or recompute edits from the
// original lines against the nudged lines) turns these green while keeping every
// existing Wave-2 test green (see tests.r1.md).

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
import { embeddedEngine } from "@/lib/llm/engines/tailor-lite/engine.js";
import { loadDocx, serializeDocx, documentLines } from "@/lib/llm/engines/tailor-lite/docxModel.js";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const JOB_ID = "job-1";
const JOB = { id: JOB_ID, title: "Staff Engineer", company: "Acme", description: "React, Node, telemetry." };

const GREETING = "Dear Hiring Manager,";
const INTRO =
  "I am excited to apply for this role. I bring years of relevant experience. I would love to contribute to your mission.";
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

// Exact oracles, computed by hand (independent of the planner):
// OFF -> fact after sentence 1; ON -> fact one slot later, after sentence 2.
const INTRO_PLACED = "I am excited to apply for this role. Acme opened a Dublin telemetry lab. I bring years of relevant experience. I would love to contribute to your mission.";
const INTRO_NUDGED = "I am excited to apply for this role. I bring years of relevant experience. Acme opened a Dublin telemetry lab. I would love to contribute to your mission.";

// Build a REAL .docx whose body paragraphs are exactly `lines`, so the splice
// can match each edit's whole-paragraph `before`. Uses the embedded engine's own
// docx only as a valid OOXML container; its body is replaced wholesale.
async function buildControlledCoverDocxB64(lines) {
  const cl = await embeddedEngine.tailorCoverLetter({
    jobPosting: "Staff Engineer at Acme. React, Node, telemetry.",
    jobTitle: "Staff Engineer",
    companyName: "Acme",
  });
  const doc = await loadDocx(Buffer.from(cl.docxB64, "base64"));
  const part = doc.parts.find((p) => p.name === "word/document.xml");
  // Local XML escape (the fixture lines are plain ASCII, but escape anyway) --
  // NOT docxModel's exported encodeXml: that export's only consumer is the
  // export-reachability ledger, so importing it here would move the census
  // (loop-tdd rule 6). Drive nothing but shipping-consumed exports.
  const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
  const para = (t) => `<w:p><w:r><w:t xml:space="preserve">${esc(t)}</w:t></w:r></w:p>`;
  const bodyInner = lines.map(para).join("");
  part.xml = part.xml.replace(/<w:body\b[^>]*>[\s\S]*<\/w:body>/, `<w:body>${bodyInner}</w:body>`);
  return serializeDocx(doc);
}

let COVER_B64 = "";
let store = { facts: [], removed: [], revision: null };
let researchArticles = [];
let putCoverVersions = [];
let probe = null;
let container = null;
let root = null;

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

// Shape A: real engine cover bytes present (no in-session template needed) ->
// autoInsert takes the "splice" strategy against the resolved bytes.
function entryShapeA(overrides = {}) {
  return {
    status: "done",
    result: "",
    resultLines: [],
    docxB64: "",
    docxPath: "",
    coverLetterResultLines: [...BODY_LINES],
    coverLetterDocxB64: COVER_B64,
    coverLetterDocxPath: "",
    coverVersionId: "ver-1",
    ...overrides,
  };
}

function HookProbe({ initialMap, defaultPlacement, forwardPositioning }) {
  const [tailoringMap, setTailoringMap] = useState(initialMap);
  const [previewReloadKey, setPreviewReloadKey] = useState(0);
  const research = useCompanyResearch({
    tailoringMap,
    setTailoringMap,
    setPreviewReloadKey,
    defaultPlacement,
    forwardPositioning,
    // NO coverLetterFile -> canRebuild is false, so the ONLY path that can
    // succeed is the byte splice (Shape A). This forces the splice branch the
    // shipped Shape-B test avoided.
  });
  probe = { tailoringMap, setTailoringMap, research, previewReloadKey };
  return null;
}

beforeAll(async () => {
  COVER_B64 = await buildControlledCoverDocxB64(BODY_LINES);
  // Sanity: the controlled container really round-trips to our fixture lines,
  // so a later documentLines() read is a faithful text of the served docx.
  const check = documentLines(await loadDocx(Buffer.from(COVER_B64, "base64")));
  if (JSON.stringify(check) !== JSON.stringify(BODY_LINES)) {
    throw new Error("controlled cover docx did not round-trip to BODY_LINES");
  }
});

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
async function drain(steps = 25) {
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
    root.render(createElement(HookProbe, { initialMap: { [JOB_ID]: entryShapeA() }, defaultPlacement, forwardPositioning }));
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

// One full set/generate cycle at a given forward preference. Returns the visible
// lines AND the text of the ACTUAL stored/served docx bytes.
async function generateWithForward(forwardPositioning) {
  await mount({ defaultPlacement: "intro", forwardPositioning });
  await seedResearch();
  await runAutoInsert();
  const entry = probe.tailoringMap[JOB_ID] || {};
  const storedB64 = typeof entry.coverLetterDocxB64 === "string" ? entry.coverLetterDocxB64 : "";
  const storedDocxLines = storedB64 ? documentLines(await loadDocx(Buffer.from(storedB64, "base64"))) : [];
  return { visible: entry.coverLetterResultLines || [], storedB64, storedDocxLines };
}

describe("AC-C4 last hop on the SPLICE path: the stored/served docx bytes carry the NUDGED position, matching the visible letter (RED on HEAD)", () => {
  it("with forward ON, the served docx bytes reconstruct to the SAME letter the user sees (preview == download == lines)", async () => {
    const { visible, storedB64, storedDocxLines } = await generateWithForward(true);

    // Canary 1: the splice path really ran (real bytes were stored) -- otherwise
    // this whole assertion would be vacuous.
    expect(storedB64.length, "no cover docx bytes were stored -- the splice path did not run").toBeGreaterThan(0);
    // Canary 2: the fact was actually inserted into the served bytes.
    expect(occurrences(storedDocxLines.join("\n"), SUGGESTION), "the served docx does not contain the fact exactly once").toBe(1);
    // Canary 3: the visible lines are the NUDGED lines (the nudge fired on-screen).
    expect(visible[1], "the visible letter is not the nudged letter -- the nudge did not fire").toBe(INTRO_NUDGED);

    // THE LAST HOP: the served .docx text must equal the visible letter. On HEAD
    // the docx carries the un-nudged position while the lines are nudged.
    expect(
      storedDocxLines,
      "the served/downloaded docx bytes DISAGREE with the visible letter -- the forward nudge never reached the docx (Bug 1)",
    ).toEqual(visible);
    // Exact oracle: the fact sits after sentence TWO in the served bytes.
    expect(
      storedDocxLines[1],
      "the served docx shows the fact at the un-nudged (after-sentence-one) position",
    ).toBe(INTRO_NUDGED);
  });

  it("the served docx bytes with forward ON differ from forward OFF (the toggle actually changes the download) -- RED on HEAD: identical", async () => {
    const on = await generateWithForward(true);
    const off = await generateWithForward(false);
    expect(on.storedDocxLines.length, "ON run stored no docx bytes").toBeGreaterThan(0);
    expect(off.storedDocxLines.length, "OFF run stored no docx bytes").toBeGreaterThan(0);
    expect(
      on.storedDocxLines,
      "forward ON produced the SAME served docx as forward OFF -- the toggle has no downloadable effect (Bug 1)",
    ).not.toEqual(off.storedDocxLines);
  });

  it("CONTROL: with forward OFF the served docx bytes already match the visible letter (splice path is genuinely exercised; instrument discriminates)", async () => {
    // Green on HEAD and in the reference: the OFF path has no nudge, so its
    // served bytes and visible lines agree. This proves (a) the splice really
    // runs and stores bytes in this harness, and (b) the RED tests above fail
    // because of the nudge/edits gap, not because the harness is broken.
    const { visible, storedB64, storedDocxLines } = await generateWithForward(false);
    expect(storedB64.length, "OFF run stored no docx bytes -- splice path not exercised").toBeGreaterThan(0);
    expect(visible[1], "OFF placement oracle mismatch").toBe(INTRO_PLACED);
    expect(storedDocxLines, "even with the nudge OFF the served bytes disagree with the visible letter").toEqual(visible);
  });
});
