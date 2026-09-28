// @vitest-environment jsdom
//
// N59 step 5 (4b) -- THE PROOF THIS WHOLE CHUNK EXISTS FOR. AC-6 / AC-7 / the
// owner's activity-log defect.
//
// The owner opens the cover-letter preview for an application SAVED EARLIER (not
// generated in this session) and a researched fact is auto-inserted. On HEAD
// that path refuses with code `no-engine-bytes` -- the exact code their log
// showed -- because the rehydrated letter has cover TEXT but no in-session bytes
// and, pre-fix, no resolvable docx_path. A green suite that does not prove THIS
// has not fixed anything: the repo's recurring defect class is a complete correct
// mechanism shipping with the last hop to the user missing behind a green suite.
//
// The trigger that fires auto-insert on preview open is N73's already-landed code
// in DocumentPreviewMount (another seat's file). What N59 changes is (1) the
// entry now carries coverLetterDocxPath (proven for the load hop by
// app/coverDocxPathRehydration.census.test.js) and (2) autoInsertFactsForJob
// resolves it. So this drives autoInsertFactsForJob on the real hook with the
// entry shape rehydration produces, and the real coverDocxStore round-trips
// through the stubbed storage -- proving the CONSUMER succeeds on a saved letter.
//
// RED-ON-HEAD REASON: useCompanyResearch ignores supabase/currentUser and
// autoInsertFactsForJob refuses `no-engine-bytes` on any entry whose
// coverLetterDocxB64 is empty (useCompanyResearch.js:628-630), never consulting a
// docx_path.

import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from "vitest";
import { createElement, useState, act } from "react";
import { createRoot } from "react-dom/client";

import { useCompanyResearch } from "./useCompanyResearch.js";
import { sanitizeStoredFacts } from "@/lib/acceptedFacts/factStore.js";
import { embeddedEngine } from "@/lib/llm/engines/tailor-lite/engine.js";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const JOB_ID = "job-1";
const USER_ID = "user-1";
const JOB = { id: JOB_ID, title: "Staff Engineer", company: "Acme", description: "React, Node, telemetry." };

const REAL_1 = {
  title: "Acme opens a Dublin telemetry lab",
  url: "https://news.example.com/acme/dublin-lab",
  source: "news.example.com",
  summary: "Acme has opened a new telemetry lab in Dublin.",
  suggestion: "I was glad to see Acme opened a Dublin telemetry lab, and it is part of what draws me to this role.",
};

let ENGINE_B64 = "";
let ENGINE_LINES = [];

function base64ToBytes(b64) {
  return new Uint8Array(Buffer.from(b64, "base64"));
}

beforeAll(async () => {
  const cl = await embeddedEngine.tailorCoverLetter({
    jobPosting: "Staff Engineer at Acme. React, Node, telemetry, accessibility.",
    jobTitle: "Staff Engineer",
    companyName: "Acme",
  });
  ENGINE_B64 = cl.docxB64;
  ENGINE_LINES = cl.resultLines;
});

const COVER_PATH = "user-1/generated/c1.docx";
let storageObjects = {};
let uploads = [];
let putBodies = [];
let store = { facts: [], removed: [], revision: null };
let researchArticles = [];
let downloadCalls = 0;
let probe = null;
let container = null;
let root = null;

function makeSupabase() {
  return {
    storage: {
      from: () => ({
        download: async (path) => {
          downloadCalls += 1;
          const b = storageObjects[path];
          return b ? { data: new Blob([b]), error: null } : { data: null, error: { message: "not found" } };
        },
        upload: async (path, bytes, opts) => {
          const arr = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
          uploads.push({ path, bytes: arr, opts });
          storageObjects[path] = arr;
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

function savedAppEntry(over = {}) {
  return {
    status: "done",
    result: "",
    resultLines: [],
    docxB64: "",
    docxPath: "",
    coverLetterResultLines: [...ENGINE_LINES],
    coverLetterDocxB64: "",
    coverLetterDocxPath: COVER_PATH,
    coverVersionId: "c1",
    ...over,
  };
}

beforeEach(() => {
  storageObjects = { [COVER_PATH]: base64ToBytes(ENGINE_B64) };
  uploads = [];
  putBodies = [];
  store = { facts: [], removed: [], revision: 1 };
  researchArticles = [];
  downloadCalls = 0;
  probe = null;
  globalThis.fetch = vi.fn(async (url, init = {}) => {
    const method = (init.method || "GET").toUpperCase();
    const u = String(url);
    if (u.includes("/api/company-research")) return json({ articles: researchArticles, warnings: [] });
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
async function seedResearch(articles, { removed = [] } = {}) {
  researchArticles = articles;
  store = { facts: [], removed, revision: removed.length ? 1 : null };
  await act(async () => { probe.research.openCompanyResearch(JOB); });
  await flush();
}
function coverLines() {
  return probe.tailoringMap[JOB_ID]?.coverLetterResultLines || [];
}

// ---------------------------------------------------------------------------
// THE PROOF
// ---------------------------------------------------------------------------

describe("auto-insert succeeds on a SAVED (reloaded) cover letter (the chunk's reason to exist)", () => {
  it("resolves the stored docx and inserts, instead of refusing no-engine-bytes", async () => {
    await mount({ [JOB_ID]: savedAppEntry() });
    await seedResearch([REAL_1]);

    let result;
    await act(async () => { result = await probe.research.autoInsertFactsForJob(JOB_ID, () => true); });
    await drain();

    // RED on HEAD: this is the exact code the owner's activity log showed.
    expect(result.code, `auto-insert refused a saved letter: ${result.reason || ""}`).not.toBe("no-engine-bytes");
    expect(result.ok, `auto-insert did not succeed on a saved letter: ${result.reason || ""}`).toBe(true);
    expect(result.count).toBeGreaterThanOrEqual(1);
    // The fact actually entered the letter's text.
    expect(coverLines().join("\n")).toContain(REAL_1.suggestion);
    // The stored object really was consulted (the resolve is a real round-trip,
    // not a stubbed boolean).
    expect(downloadCalls).toBeGreaterThan(0);
  });

  it("persists the spliced document and points the new version row at it (durability, K10)", async () => {
    // Without this the auto path would repeat N59's own defect: succeed in-session
    // but leave the next reload with no bytes and no pointer.
    await mount({ [JOB_ID]: savedAppEntry() });
    await seedResearch([REAL_1]);
    await act(async () => { await probe.research.autoInsertFactsForJob(JOB_ID, () => true); });
    await drain();

    const splicedUpload = uploads.find((u) => u.path !== COVER_PATH);
    expect(splicedUpload, "no spliced document was uploaded by auto-insert").toBeTruthy();
    const body = putBodies[putBodies.length - 1];
    expect(body.coverVersion).toBeTruthy();
    expect(typeof body.coverVersion.docxPath).toBe("string");
    expect(body.coverVersion.docxPath.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Backward compatibility: a letter with no bytes AND no resolvable path (every
// row written before the migration, or a failed upload) keeps today's HONEST
// refusal. AC-6 safe direction. GREEN on HEAD -- non-regression guard.
// ---------------------------------------------------------------------------

describe("a pre-migration / path-less letter still refuses honestly (AC-6 safe direction)", () => {
  it("refuses no-engine-bytes when there is neither bytes nor a path", async () => {
    await mount({ [JOB_ID]: savedAppEntry({ coverLetterDocxPath: "" }) });
    await seedResearch([REAL_1]);
    let result;
    await act(async () => { result = await probe.research.autoInsertFactsForJob(JOB_ID, () => true); });
    await drain();

    expect(result.ok).toBe(false);
    expect(result.code).toBe("no-engine-bytes");
    expect(coverLines().join("\n")).not.toContain(REAL_1.suggestion);
    expect(putBodies).toHaveLength(0);
  });

  it("refuses when the path is set but the stored object is gone", async () => {
    delete storageObjects[COVER_PATH];
    await mount({ [JOB_ID]: savedAppEntry() });
    await seedResearch([REAL_1]);
    let result;
    await act(async () => { result = await probe.research.autoInsertFactsForJob(JOB_ID, () => true); });
    await drain();

    expect(result.ok).toBe(false);
    // A resolvable-but-empty source is not a faithful engine doc; the safe
    // outcome is the same honest refusal, never a silent generic-template splice.
    expect(result.code).toBe("no-engine-bytes");
    expect(putBodies).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// Write-safety across the widened async path. The resolve adds an await; the
// write must still not fire for a review surface that closed mid-flight.
// Non-regression guard: its teeth are the existing write-time isOpen re-checks
// (useCompanyResearch.js:726,759), which the widening diff edits around -- so
// this pins they still protect the store write once a resolve await precedes
// them. (The new post-resolve re-check the plan adds only avoids a wasted splice;
// it is not separately observable in the outcome, and no kill is claimed for it.)
// ---------------------------------------------------------------------------

describe("auto-insert does not persist to a review surface that closed mid-flight", () => {
  it("makes no store write when the modal closes after the entry gate", async () => {
    await mount({ [JOB_ID]: savedAppEntry() });
    await seedResearch([REAL_1]);

    let calls = 0;
    const isOpen = () => calls++ === 0; // open at entry, closed for every later check
    let result;
    await act(async () => { result = await probe.research.autoInsertFactsForJob(JOB_ID, isOpen); });
    await drain();

    // RED on HEAD for the RIGHT reason: on HEAD this refuses no-engine-bytes at
    // the entry gate (before ever resolving), so it never reaches the widened
    // path this test is about.
    expect(result.code, "on HEAD this refuses before the resolve, so the close-race path is unreached").not.toBe("no-engine-bytes");
    expect(calls, "isOpen was not re-checked after the entry gate").toBeGreaterThan(1);
    // No fact reached the store or the letter after the surface closed.
    expect(putBodies, "a fact was persisted after the modal closed mid-flight").toHaveLength(0);
    expect(coverLines().join("\n")).not.toContain(REAL_1.suggestion);
  });

  it("CONTROL: with the surface open throughout, the same run DOES persist", async () => {
    await mount({ [JOB_ID]: savedAppEntry() });
    await seedResearch([REAL_1]);
    await act(async () => { await probe.research.autoInsertFactsForJob(JOB_ID, () => true); });
    await drain();
    expect(putBodies.length).toBeGreaterThan(0);
    expect(coverLines().join("\n")).toContain(REAL_1.suggestion);
  });
});
