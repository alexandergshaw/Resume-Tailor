// @vitest-environment jsdom
//
// N59 step 5 (4b) -- the accept refusal predicate must WIDEN from "in-session
// bytes present" to "a faithful engine source resolves (in-session bytes OR a
// resolvable docx_path)", and a successful splice must PERSIST (upload the
// spliced bytes, carry the path on the new version row). AC-3, AC-6, seams K8/K10.
//
// This is the accept half of the durability fix: today a letter restored from a
// saved application (text + docx_path, no in-session bytes) is REFUSED for
// fact-accept with `no-engine-bytes` -- the very refusal the owner's activity log
// showed. After the fix the path resolves, the splice runs against the RESOLVED
// engine bytes, and the spliced document is uploaded and pointed at.
//
// REACHABILITY note (disclosed): the click that reaches acceptFacts is already
// pinned end-to-end (real CompanyResearchDialog, real control, real click) by
// acceptNoEngineBytes.test.js for the REFUSAL case; onAccept is the same handler
// for the widened success case. What is NEW and needs proof here is the
// resolve-splice-persist DATA FLOW, driven at the real hook. Only Supabase
// storage is stubbed, and the REAL coverDocxStore (fetchCoverDocxB64 /
// uploadCoverDocx) runs against it, so "resolved the path" and "uploaded the
// splice" are genuine round-trips, not stubbed booleans.
//
// RED-ON-HEAD REASON: useCompanyResearch ignores any supabase/currentUser (its
// signature is {tailoringMap,setTailoringMap,setPreviewReloadKey,defaultPlacement}),
// and acceptFacts gates on `entry.coverLetterDocxB64.length > 0`
// (useCompanyResearch.js:366) -- so a path-only entry refuses no-engine-bytes and
// nothing is uploaded or pointed at.

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
const FACT_TEXT = "Acme opened a Dublin telemetry lab in 2026.";
const FACT_URL = "https://acme.example.com/newsroom/dublin-lab";
const SELECTION = {
  facts: [{ id: "art-1", text: FACT_TEXT, url: FACT_URL, title: "Acme opens Dublin telemetry lab", source: "Acme Newsroom", placement: "current", textOrigin: "template" }],
  declinedUrls: [],
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
let probe = null;
let container = null;
let root = null;

// The supabase client the hook resolves/persists cover bytes through. The real
// coverDocxStore runs against this -- so a wrong path, wrong bucket, or a decode
// bug is caught by the round-trip, not assumed away.
function makeSupabase() {
  return {
    storage: {
      from: (bucket) => ({
        download: async (path) => {
          if (bucket !== "resumes") return { data: null, error: { message: "wrong bucket" } };
          const b = storageObjects[path];
          return b ? { data: new Blob([b]), error: null } : { data: null, error: { message: "not found" } };
        },
        upload: async (path, bytes, opts) => {
          if (bucket !== "resumes") return { error: { message: "wrong bucket" } };
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
  // Exactly what page.js rehydration produces for a saved application: cover
  // text + coverLetterDocxPath, NO in-session bytes.
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
async function drain(steps = 20) {
  for (let n = 0; n < steps; n += 1) await act(async () => { await new Promise((r) => setTimeout(r, 10)); });
}
async function mount(initialMap) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => { root.render(createElement(HookProbe, { initialMap })); });
  await flush();
  // acceptFacts reads companyResearch.jobId; open the research dialog the real
  // way (also seeds the accepted-facts store from the GET) so the job is live.
  await act(async () => { probe.research.openCompanyResearch(JOB); });
  await flush();
}

function coverLines() {
  return probe.tailoringMap[JOB_ID]?.coverLetterResultLines || [];
}
function acceptedFactsWrites() {
  return putBodies;
}
async function docxContainsText(bytes) {
  if (!bytes) return false;
  const { default: JSZip } = await import("jszip");
  const zip = await JSZip.loadAsync(bytes);
  const xml = await zip.file("word/document.xml").async("string");
  return xml.replace(/<[^>]+>/g, "").includes(FACT_TEXT);
}

// ---------------------------------------------------------------------------
// Fixture control
// ---------------------------------------------------------------------------

describe("harness sanity", () => {
  it("the stored object round-trips to the engine bytes the splice needs", async () => {
    expect(ENGINE_LINES.length).toBeGreaterThan(3);
    expect(ENGINE_B64.length).toBeGreaterThan(100000);
    // The stored object decodes to the same bytes -- so resolving the path yields
    // a real, spliceable engine document, not a stub.
    const roundTrip = Buffer.from(storageObjects[COVER_PATH]).toString("base64");
    expect(roundTrip).toBe(ENGINE_B64);
  });
});

// ---------------------------------------------------------------------------
// AC-6 case (ii): a resolvable path is NO LONGER refused (RED on HEAD).
// ---------------------------------------------------------------------------

describe("accepting into a saved (path-only) letter resolves the engine doc and splices (AC-6 case ii)", () => {
  it("proceeds instead of refusing no-engine-bytes, and the fact enters the letter", async () => {
    await mount({ [JOB_ID]: savedAppEntry() });
    let result;
    await act(async () => { result = await probe.research.acceptFacts(SELECTION); });
    await drain();

    // RED on HEAD: the gate reads only in-session bytes, so this refuses.
    expect(result.ok, `accept refused a resolvable saved letter: ${result.reason || ""}`).toBe(true);
    expect(coverLines().join("\n")).toContain(FACT_TEXT);
    expect(acceptedFactsWrites()).toHaveLength(1);
  });

  it("K8: the splice ran against the RESOLVED engine bytes, not the empty in-session field", async () => {
    // If the fix widened the gate but still spliced entry.coverLetterDocxB64 (""),
    // applyCoverDocxEdits would refuse and the accept would fail -- so ok:true
    // above already implies a real splice. This nails it at the bytes: the
    // uploaded document actually carries the fact text.
    await mount({ [JOB_ID]: savedAppEntry() });
    await act(async () => { await probe.research.acceptFacts(SELECTION); });
    await drain();

    // A NEW object was uploaded (the spliced bytes), distinct from the stored
    // source object.
    const splicedUpload = uploads.find((u) => u.path !== COVER_PATH);
    expect(splicedUpload, "no spliced document was uploaded on accept").toBeTruthy();
    expect(await docxContainsText(splicedUpload.bytes), "the uploaded document does not carry the accepted fact").toBe(true);
    // upsert:true, resume-baseline parity (AC-9).
    expect(splicedUpload.opts?.upsert).toBe(true);
  });

  it("K10: the PUT to the store carries a non-empty docxPath for the new version row", async () => {
    // The seam assertion: ANY accept that writes a cover version must carry the
    // uploaded path, or the reload has nothing to resolve and durability is lost
    // one layer down.
    await mount({ [JOB_ID]: savedAppEntry() });
    await act(async () => { await probe.research.acceptFacts(SELECTION); });
    await drain();

    const body = putBodies[putBodies.length - 1];
    expect(body.coverVersion).toBeTruthy();
    expect(typeof body.coverVersion.docxPath).toBe("string");
    expect(body.coverVersion.docxPath.length).toBeGreaterThan(0);
    // Under the user's own RLS prefix, keyed by the accept-path convention (R2).
    expect(body.coverVersion.docxPath.startsWith(`${USER_ID}/generated/`)).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// AC-6 case (i) / backward compat: NO faithful source is STILL refused (safe
// direction). GREEN on HEAD -- a non-regression guard, stated as such.
// ---------------------------------------------------------------------------

describe("a letter with neither bytes nor a resolvable path is still refused (AC-6 case i)", () => {
  it("refuses no-engine-bytes and writes nothing when there is no path", async () => {
    await mount({ [JOB_ID]: savedAppEntry({ coverLetterDocxPath: "" }) });
    let result;
    await act(async () => { result = await probe.research.acceptFacts(SELECTION); });
    await drain();

    expect(result.ok).toBe(false);
    expect(result.reason).toMatch(/cover letter/i);
    expect(acceptedFactsWrites()).toHaveLength(0);
    expect(uploads).toHaveLength(0);
    expect(coverLines().join("\n")).not.toContain(FACT_TEXT);
  });

  it("refuses when the path is set but the stored object is GONE (upload never happened / deleted)", async () => {
    // A nullable docx_path with no backfill, or a failed upload, leaves a path
    // that resolves to nothing. The safe outcome is the honest refusal, never a
    // silent splice onto whatever generic template is on hand.
    delete storageObjects[COVER_PATH];
    await mount({ [JOB_ID]: savedAppEntry() });
    let result;
    await act(async () => { result = await probe.research.acceptFacts(SELECTION); });
    await drain();

    expect(result.ok).toBe(false);
    expect(acceptedFactsWrites()).toHaveLength(0);
    expect(uploads).toHaveLength(0);
  });
});

// ---------------------------------------------------------------------------
// CONTROL: an in-session-bytes letter still accepts (the pre-existing path is not
// broken by the widening). GREEN on HEAD and after.
// ---------------------------------------------------------------------------

describe("CONTROL: an in-session letter still accepts and persists", () => {
  it("accepts, and still uploads a spliced object + carries a docxPath", async () => {
    // Even the in-session path must now persist (so its own reload survives), so
    // this control also pins that the widening did not leave the common case
    // session-only. On HEAD this accepts but uploads nothing / carries no path,
    // so the upload+docxPath assertions are RED here too.
    await mount({ [JOB_ID]: savedAppEntry({ coverLetterDocxB64: ENGINE_B64, coverLetterDocxPath: "" }) });
    let result;
    await act(async () => { result = await probe.research.acceptFacts(SELECTION); });
    await drain();

    expect(result.ok).toBe(true);
    expect(coverLines().join("\n")).toContain(FACT_TEXT);
    const splicedUpload = uploads[uploads.length - 1];
    expect(splicedUpload, "the in-session accept persisted no spliced object").toBeTruthy();
    expect(await docxContainsText(splicedUpload.bytes)).toBe(true);
    const body = putBodies[putBodies.length - 1];
    expect(body.coverVersion.docxPath.length).toBeGreaterThan(0);
  });
});
