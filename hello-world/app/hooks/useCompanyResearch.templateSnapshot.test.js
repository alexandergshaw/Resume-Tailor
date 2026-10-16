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

import JSZip from "jszip";
import { buildPreviewBlob } from "../../lib/document/previewBlob";
import { rehydratedEntryFromApp } from "../../lib/tracking/applicationPreviewEntry";
vi.mock("../../lib/supabase/client",()=>({createClient:()=>globalThis.__n89TemplateClient}));
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
  const zip = await JSZip.loadAsync(cl.docxB64, { base64: true });
  let xml = await zip.file("word/document.xml").async("string");
  xml = xml.replace(/<w:rFonts\b[^>]*\/>/g, '<w:rFonts w:ascii="N97OriginalFont" w:hAnsi="N97OriginalFont"/>').replace(/(<w:t[^>]*>)[^<]*(<\/w:t>)/, "$1ORIGINAL_PLACEHOLDER$2");
  zip.file("word/document.xml", xml);
  ENGINE_B64 = await zip.generateAsync({ type: "base64" });
  ENGINE_LINES = cl.resultLines;
});

const VERSION_ID = "11111111-1111-4111-8111-111111111111";
const COVER_PATH = `user-1/templates/generated/cover/${VERSION_ID}.docx`;
let storageObjects = {};
let uploads = [];
let putBodies = [];
let researchArticles = [];
let store = { facts: [], removed: [], revision: null };
let probe = null;
let container = null;
let root = null;

// The supabase client the hook resolves/persists cover bytes through. The real
// coverDocxStore runs against this -- so a wrong path, wrong bucket, or a decode
// bug is caught by the round-trip, not assumed away.
function makeSupabase() {
  return {
    auth: { getUser: async () => ({ data: { user: { id: USER_ID } } }) },
    from: () => { const filters = {}; const q = { select: () => q, eq: (k,v) => { filters[k]=v; return q; }, maybeSingle: async () => ({ data: filters.id === VERSION_ID && filters.user_id === USER_ID ? { id: VERSION_ID } : null }) }; return q; },
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
    coverLetterFile: globalThis.__n89GlobalFile || null,
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
    coverLetterDocxPath: "",
    coverTemplateVersionId: VERSION_ID,
    coverVersionId: "c1",
    ...over,
  };
}

beforeEach(() => {
  storageObjects = { [COVER_PATH]: base64ToBytes(ENGINE_B64) };
  globalThis.__n89TemplateClient = makeSupabase();
  uploads = [];
  putBodies = [];
  researchArticles = [];
  store = { facts: [], removed: [], revision: 1 };
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
  delete globalThis.__n89GlobalFile;
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


it("reloaded Gemini original enables real accept splice and persisted finished bytes", async()=>{
  await mount({[JOB_ID]:savedAppEntry()}); let result;
  await act(async()=>{result=await probe.research.acceptFacts(SELECTION);}); await drain();
  expect(result.ok,result.reason).toBe(true); expect(coverLines().join("\n")).toContain(FACT_TEXT);
  expect(putBodies).toHaveLength(1); expect(uploads.length).toBeGreaterThan(0);
  expect(await docxContainsText(uploads.at(-1).bytes)).toBe(true);
  const written = uploads.at(-1);
  expect(await (await JSZip.loadAsync(written.bytes)).file("customXml/resume-tailor-original.xml").async("string")).toContain(VERSION_ID);
  const xml = await (await JSZip.loadAsync(written.bytes)).file("word/document.xml").async("string");
  expect(xml).toContain("N97OriginalFont"); expect(xml).not.toContain("ORIGINAL_PLACEHOLDER");
  const restored = rehydratedEntryFromApp({ generated_cover_letters: { id: VERSION_ID, content: coverLines().join("\n"), content_lines: coverLines(), docx_path: written.path } });
  const reopened = await buildPreviewBlob(restored, "cover");
  const reopenedXml = await (await JSZip.loadAsync(await reopened.arrayBuffer())).file("word/document.xml").async("string");
  expect(reopenedXml).toContain("N97OriginalFont"); expect(reopenedXml.replace(/<[^>]+>/g, "")).toContain(FACT_TEXT);
});
it("missing snapshot refuses before facts writes, even when a current unrelated upload exists", async()=>{
  storageObjects={}; await mount({[JOB_ID]:savedAppEntry()}); let result;
  await act(async()=>{result=await probe.research.acceptFacts(SELECTION);});
  expect(result.ok).toBe(false); expect(putBodies).toHaveLength(0);expect(uploads).toHaveLength(0);
});

it("reloaded original also enables auto-insert, with no empty-byte guard bypass",async()=>{
  researchArticles=[{title:"Acme lab",url:FACT_URL,source:"Acme",summary:FACT_TEXT,suggestion:FACT_TEXT}];
  await mount({[JOB_ID]:savedAppEntry()});let result;
  await act(async()=>{result=await probe.research.autoInsertFactsForJob(JOB_ID,()=>true);});await drain();
  expect(result.ok,result.reason).toBe(true);expect(coverLines().join("\n")).toContain(FACT_TEXT);expect(putBodies).toHaveLength(1);expect(await docxContainsText(uploads.at(-1).bytes)).toBe(true);
  expect(await (await JSZip.loadAsync(uploads.at(-1).bytes)).file("customXml/resume-tailor-original.xml").async("string")).toContain(VERSION_ID);
});

it("corrupt saved original refuses before facts or generated-byte writes",async()=>{storageObjects[COVER_PATH]=new Uint8Array([1,2,3]);await mount({[JOB_ID]:savedAppEntry()});let result;await act(async()=>{result=await probe.research.acceptFacts(SELECTION);});expect(result.ok).toBe(false);expect(putBodies).toHaveLength(0);expect(uploads).toHaveLength(0);});

it("historical missing/foreign original cannot use an unrelated global File for auto-insert",async()=>{
 globalThis.__n89GlobalFile=new File([base64ToBytes(ENGINE_B64)],"unrelated.docx");storageObjects={};researchArticles=[{title:"Acme lab",url:FACT_URL,source:"Acme",summary:FACT_TEXT,suggestion:FACT_TEXT}];await mount({[JOB_ID]:savedAppEntry()});let result;await act(async()=>{result=await probe.research.autoInsertFactsForJob(JOB_ID,()=>true);});expect(result.ok).toBe(false);expect(putBodies).toHaveLength(0);expect(uploads).toHaveLength(0);
});


it("source-aware edited removal persists resulting lines and the same original reference",async()=>{
 await mount({[JOB_ID]:savedAppEntry()});let accepted;await act(async()=>{accepted=await probe.research.acceptFacts(SELECTION);});await drain();expect(accepted.ok).toBe(true);
 const record=probe.tailoringMap[JOB_ID].insertedFacts[0];expect(record).toBeTruthy();await act(async()=>{probe.setTailoringMap(map=>({...map,[JOB_ID]:{...map[JOB_ID],edited:{cover:true}}}));});let removed;await act(async()=>{removed=await probe.research.removeInsertedFact(JOB_ID,record.id);});await drain();expect(removed.ok,removed.reason).toBe(true);const zip=await JSZip.loadAsync(uploads.at(-1).bytes);expect(await zip.file("customXml/resume-tailor-original.xml").async("string")).toContain(VERSION_ID);const xml=await zip.file("word/document.xml").async("string");expect(xml).toContain("N97OriginalFont");expect(xml.replace(/<[^>]+>/g,"")).not.toContain(FACT_TEXT);expect(putBodies.at(-1).coverVersion.docxPath).toBe(uploads.at(-1).path);
});


it("already-present source-aware accept keeps facts-only RPC without snapshot or output writes",async()=>{
 await mount({[JOB_ID]:savedAppEntry()});let first;await act(async()=>{first=await probe.research.acceptFacts(SELECTION);});await drain();expect(first.ok).toBe(true);const before=probe.tailoringMap[JOB_ID].coverLetterDocxB64;delete storageObjects[COVER_PATH];uploads=[];putBodies=[];let repeated;await act(async()=>{repeated=await probe.research.acceptFacts(SELECTION);});await drain();expect(repeated.ok,repeated.reason).toBe(true);expect(putBodies).toHaveLength(1);expect(putBodies[0].coverVersion).toBeNull();expect(putBodies[0].facts).toHaveLength(1);expect(uploads).toHaveLength(0);expect(probe.tailoringMap[JOB_ID].coverLetterDocxB64).toBe(before);expect(coverLines().join("\n")).toContain(FACT_TEXT);
});
