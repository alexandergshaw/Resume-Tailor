// @vitest-environment jsdom
//
// N59 step 5 (4b) -- removing an inserted fact must leave a DURABLE version row,
// and must never ship a stale path. Seam K10.
//
// The gap K10 names: once accept/auto-insert carry a real docxPath on the version
// row they write, a remove that writes its OWN version row with a stale or absent
// path is the one RPC-writing sibling that degrades -- a defect invisible to any
// single-function test. So when the removal splice applies, the fact-removed
// document is uploaded and its path carried; when it does not (a letter with no
// engine bytes to splice), the path is EXPLICITLY null -- never the pre-removal
// path (which still carries the removed clause) and never absent.
//
// REACHABILITY: the removal control lives in the preview modal; removeInsertedFact
// is jobId-parameterised and driven here on the real hook. The in-session state a
// remove operates on is produced by a REAL prior acceptFacts (not a hand-built
// spliced docx), so the fact genuinely is in the bytes before it is removed. Only
// Supabase storage is stubbed, with the real coverDocxStore uploading through it.
//
// RED-ON-HEAD REASON: removeInsertedFact's PUT body is
// { lines, insertedFacts } with no docxPath, and no upload of the fact-removed
// bytes (useCompanyResearch.js:546-557); the hook also ignores supabase/currentUser.

import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from "vitest";
import { createElement, useState, act } from "react";
import { createRoot } from "react-dom/client";

import { useCompanyResearch } from "./useCompanyResearch.js";
import { sanitizeStoredFacts } from "@/lib/acceptedFacts/factStore.js";
import { embeddedEngine } from "@/lib/llm/engines/tailor-lite/engine.js";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const JOB_ID = "job-1";
const JOB = { id: JOB_ID, title: "Staff Engineer", company: "Acme", description: "React, Node, telemetry." };
const USER_ID = "user-1";
const FACT_ID = "art-1";
const FACT_TEXT = "Acme opened a Dublin telemetry lab in 2026.";
const FACT_URL = "https://acme.example.com/newsroom/dublin-lab";
const SELECTION = {
  facts: [{ id: FACT_ID, text: FACT_TEXT, url: FACT_URL, title: "Acme opens Dublin telemetry lab", source: "Acme Newsroom", placement: "current", textOrigin: "template" }],
  declinedUrls: [],
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

let uploads = [];
let putBodies = [];
let store = { facts: [], removed: [], revision: null };
let probe = null;
let container = null;
let root = null;

function makeSupabase() {
  return {
    storage: {
      from: () => ({
        download: async (path) => ({ data: null, error: { message: `no ${path}` } }),
        upload: async (path, bytes, opts) => {
          const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
          uploads.push({ path, bytes: arr, opts });
          return { error: null };
        },
      }),
    },
  };
}

function json(body) {
  return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
}

function HookProbe({ initialMap }) {
  const [tailoringMap, setTailoringMap] = useState(initialMap);
  const [previewReloadKey, setPreviewReloadKey] = useState(0);
  const research = useCompanyResearch({
    tailoringMap,
    setTailoringMap,
    setPreviewReloadKey,
    supabase: makeSupabase(),
    currentUser: { id: USER_ID },
  });
  probe = { tailoringMap, setTailoringMap, research, previewReloadKey };
  return null;
}

function inSessionEntry() {
  return {
    status: "done",
    result: "",
    resultLines: [],
    docxB64: "",
    docxPath: "",
    coverLetterResultLines: [...ENGINE_LINES],
    coverLetterDocxB64: ENGINE_B64,
    coverVersionId: "c1",
    insertedFacts: [],
    edited: { resume: false, cover: false },
  };
}

beforeEach(() => {
  uploads = [];
  putBodies = [];
  store = { facts: [], removed: [], revision: 1 };
  probe = null;
  globalThis.fetch = vi.fn(async (url, init = {}) => {
    const method = (init.method || "GET").toUpperCase();
    const u = String(url);
    if (u.includes("/api/company-research")) return json({ articles: [], warnings: [] });
    if (u.includes("/api/accepted-facts")) {
      if (method === "GET") return json({ facts: store.facts, removed: store.removed, revision: store.revision });
      const body = JSON.parse(init.body);
      putBodies.push(body);
      store = { facts: sanitizeStoredFacts(body.facts), removed: Array.isArray(body.declinedUrls) ? body.declinedUrls : [], revision: (store.revision ?? 0) + 1 };
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

async function flush(times = 8) {
  for (let i = 0; i < times; i += 1) await act(async () => { await Promise.resolve(); });
}
async function drain(steps = 24) {
  for (let n = 0; n < steps; n += 1) await act(async () => { await new Promise((r) => setTimeout(r, 10)); });
}
async function mount(initialMap) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => { root.render(createElement(HookProbe, { initialMap })); });
  await flush();
}
function coverLines() {
  return probe.tailoringMap[JOB_ID]?.coverLetterResultLines || [];
}
function insertedFacts() {
  return probe.tailoringMap[JOB_ID]?.insertedFacts || [];
}
async function docxContainsText(bytes) {
  if (!bytes) return false;
  const { default: JSZip } = await import("jszip");
  const zip = await JSZip.loadAsync(bytes);
  const xml = await zip.file("word/document.xml").async("string");
  return xml.replace(/<[^>]+>/g, "").includes(FACT_TEXT);
}

// Accept the fact first, so the remove operates on a REAL spliced document with a
// genuinely located record -- then clear the accept's bookkeeping so the remove's
// own PUT is the last one in putBodies.
async function acceptThenSettle() {
  // acceptFacts reads companyResearch.jobId; open the dialog the real way first.
  await act(async () => { probe.research.openCompanyResearch(JOB); });
  await flush();
  await act(async () => { await probe.research.acceptFacts(SELECTION); });
  await drain();
  expect(coverLines().join("\n"), "precondition: the fact was accepted into the letter").toContain(FACT_TEXT);
  expect(insertedFacts().some((r) => r.id === FACT_ID), "precondition: the fact was recorded as located").toBe(true);
  uploads = [];
  putBodies = [];
}

// ---------------------------------------------------------------------------
// In-session remove: the fact-removed document is uploaded and pointed at.
// ---------------------------------------------------------------------------

describe("removing a fact writes a DURABLE, fact-free version row (K10)", () => {
  it("uploads the fact-removed document and carries its docxPath in the PUT", async () => {
    await mount({ [JOB_ID]: inSessionEntry() });
    await acceptThenSettle();

    let result;
    await act(async () => { result = await probe.research.removeInsertedFact(JOB_ID, FACT_ID); });
    await drain();

    expect(result.ok, `remove failed: ${result.reason || ""}`).toBe(true);
    // The fact left the letter's text (existing behaviour, non-regression).
    expect(coverLines().join("\n")).not.toContain(FACT_TEXT);

    // RED on HEAD: no upload, and the PUT body has no docxPath.
    const upload = uploads[uploads.length - 1];
    expect(upload, "the fact-removed document was not uploaded").toBeTruthy();
    expect(await docxContainsText(upload.bytes), "the uploaded document still carries the removed fact").toBe(false);

    const body = putBodies[putBodies.length - 1];
    expect(body.coverVersion).toBeTruthy();
    expect(typeof body.coverVersion.docxPath).toBe("string");
    expect(body.coverVersion.docxPath.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// A letter with no engine bytes to splice: removal is still allowed (safe
// outcome = the fact leaving), but the PUT must carry an EXPLICIT null path --
// never the pre-removal path (which still holds the removed clause) and never
// absent (which K10 would read as "sibling passed a real path, this one didn't").
// ---------------------------------------------------------------------------

describe("removing from a letter with no engine bytes carries an explicit null docxPath (K10 safe direction)", () => {
  it("proceeds text-only and passes docxPath: null, uploading nothing", async () => {
    const entry = {
      status: "done",
      result: "",
      resultLines: [],
      coverLetterResultLines: ["Dear Team,", `We admire Acme. ${FACT_TEXT} I would contribute.`],
      coverLetterDocxB64: "",
      coverLetterDocxPath: "",
      insertedFacts: [{ id: FACT_ID, text: FACT_TEXT, lineIndex: 1, offset: "We admire Acme. ".length, url: FACT_URL, title: "t" }],
      edited: { resume: false, cover: false },
    };
    await mount({ [JOB_ID]: entry });

    let result;
    await act(async () => { result = await probe.research.removeInsertedFact(JOB_ID, FACT_ID); });
    await drain();

    expect(result.ok, `remove failed: ${result.reason || ""}`).toBe(true);
    expect(coverLines().join("\n")).not.toContain(FACT_TEXT);
    // Nothing to splice, nothing to upload.
    expect(uploads).toHaveLength(0);
    // RED on HEAD: the PUT body has no docxPath key at all (undefined), not null.
    const body = putBodies[putBodies.length - 1];
    expect(body.coverVersion).toBeTruthy();
    expect(body.coverVersion.docxPath).toBeNull();
  });
});
