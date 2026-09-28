// @vitest-environment jsdom
//
// N89 PART 1 (4b/TDD) -- THE LAST HOP. AC-2 (preview) and AC-3 (download).
//
// This repo's recurring defect class is a correct mechanism whose final hop to
// what the user actually SEES is missing behind a green suite. AC-1/AC-4 prove
// the fact enters `coverLetterResultLines`; these two prove it reaches the
// RENDERED bytes -- the preview blob the candidate sees and the download blob
// they send an employer.
//
// FAITHFULNESS. The fact is driven into the entry by the REAL hook
// (autoInsertFactsForJob, Shape B), then the post-insert entry is rendered
// through the REAL production seams:
//   * preview  -> buildPreviewBlob(entry, "cover", { coverLetterFile })  (the
//                 single seam every preview render + Drive save go through),
//   * download -> createDocumentDownloaders({...}).downloadDocxFiles(...)  (the
//                 real download consumer).
// NEITHER hand-builds the post-insert lines and NEITHER imports
// buildDocxFromUploadedTemplate directly (N36 lesson: driving resolveDocumentBlob
// via its real callers keeps the test on the production path and off the export
// sweep). The download blob is captured by mocking triggerBlobDownload -- the
// one IO leaf -- so no jsdom URL.createObjectURL is needed.
//
// RED ON HEAD: the hook refuses (Shape B), so the post-insert entry is UNCHANGED
// and the rendered document.xml never carries the fact. Each assertion is paired
// with a base-content control (the letter's own text IS rendered) so the
// fact-present assertion can never pass vacuously against an empty/blank render.

import { describe, it, expect, vi, beforeAll, beforeEach, afterEach } from "vitest";
import { createElement, useState, act } from "react";
import { createRoot } from "react-dom/client";
import JSZip from "jszip";

import { useCompanyResearch } from "./useCompanyResearch.js";
import { sanitizeStoredFacts } from "@/lib/acceptedFacts/factStore.js";
import { embeddedEngine } from "@/lib/llm/engines/tailor-lite/engine.js";
import { docxFileFromBase64, createDocumentDownloaders } from "@/lib/document/docx.js";
import { buildPreviewBlob } from "@/lib/document/previewBlob.js";

// Capture what would be handed to the browser download, without touching the DOM.
const downloadCalls = [];
vi.mock("@/lib/document/download.js", () => ({
  triggerBlobDownload: (blob, name) => { downloadCalls.push({ blob, name }); },
}));

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const JOB_ID = "job-1";
const USER_ID = "user-1";
const JOB = { id: JOB_ID, title: "Staff Engineer", company: "Acme", description: "React, Node, telemetry." };

// A base line with a distinctive token ("Wexford") used as the render control:
// if this token is absent from document.xml, the render produced nothing and the
// fact-present assertion would be vacuous.
const LINES = [
  "Dear Hiring Manager,",
  "I am applying for the Staff Engineer role at Acme, based near Wexford, with real enthusiasm.",
  "In my current role at Globex I lead a platform team building telemetry systems.",
  "Thank you very much for considering my application.",
];
const BASE_TOKEN = "Wexford";
const FACT_X = {
  id: "art-x",
  title: "Acme opens a Dublin telemetry lab",
  url: "https://news.example.com/acme/dublin-lab",
  source: "news.example.com",
  summary: "Acme opened a telemetry lab in Dublin.",
  suggestion: "I admire the Dublin telemetry lab that opened this year.",
};

let ENGINE_B64 = "";
let TEMPLATE_FILE = null;
let probe = null;
let container = null;
let root = null;
let researchArticles = [];
let store = { facts: [], removed: [], revision: null };

beforeAll(async () => {
  const cl = await embeddedEngine.tailorCoverLetter({
    jobPosting: "Staff Engineer at Acme. React, Node, telemetry.",
    jobTitle: "Staff Engineer",
    companyName: "Acme",
  });
  ENGINE_B64 = cl.docxB64;
});

function makeSupabase() {
  return { storage: { from: () => ({
    download: async () => ({ data: null, error: { message: "not found" } }),
    upload: async () => ({ error: null }),
  }) } };
}
function json(body) {
  return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
}
function HookProbe({ initialMap, coverLetterFile }) {
  const [tailoringMap, setTailoringMap] = useState(initialMap);
  const [previewReloadKey, setPreviewReloadKey] = useState(0);
  const research = useCompanyResearch({
    tailoringMap, setTailoringMap, setPreviewReloadKey,
    supabase: makeSupabase(), currentUser: { id: USER_ID }, coverLetterFile,
  });
  probe = { tailoringMap, setTailoringMap, research };
  return null;
}
function geminiEntry() {
  return {
    status: "done", result: "", resultLines: [], docxB64: "", docxPath: "",
    coverLetterResultLines: [...LINES], coverLetterDocxB64: "", coverLetterDocxPath: "", coverVersionId: "c1",
  };
}

beforeEach(() => {
  probe = null;
  researchArticles = [];
  store = { facts: [], removed: [], revision: null };
  downloadCalls.length = 0;
  TEMPLATE_FILE = docxFileFromBase64(ENGINE_B64);
  globalThis.fetch = vi.fn(async (url, init = {}) => {
    const method = (init.method || "GET").toUpperCase();
    const u = String(url);
    if (u.includes("/api/company-research")) return json({ articles: researchArticles, warnings: [] });
    if (u.includes("/api/accepted-facts")) {
      if (method === "GET") return json({ facts: store.facts, removed: store.removed, revision: store.revision });
      const body = JSON.parse(init.body);
      store = { facts: sanitizeStoredFacts(body.facts), removed: body.declinedUrls || [], revision: (store.revision ?? 0) + 1 };
      return json({ facts: store.facts, removed: store.removed, revision: store.revision });
    }
    return json({});
  });
});

afterEach(async () => {
  if (root) await act(async () => root.unmount());
  if (container) container.remove();
  root = null; container = null;
  delete globalThis.fetch;
});

async function flush(times = 8) { for (let i = 0; i < times; i += 1) await act(async () => { await Promise.resolve(); }); }
async function drain(steps = 24) { for (let n = 0; n < steps; n += 1) await act(async () => { await new Promise((r) => setTimeout(r, 10)); }); }
async function mount(initialMap, coverLetterFile) {
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => { root.render(createElement(HookProbe, { initialMap, coverLetterFile })); });
  await flush();
}

// Drive the REAL hook Shape-B insert and return the post-insert entry.
async function insertThenEntry() {
  await mount({ [JOB_ID]: geminiEntry() }, TEMPLATE_FILE);
  researchArticles = [FACT_X];
  await act(async () => { probe.research.openCompanyResearch(JOB); });
  await flush();
  await act(async () => { await probe.research.autoInsertFactsForJob(JOB_ID, () => true); });
  await drain();
  return probe.tailoringMap[JOB_ID];
}

async function documentXmlOf(blob) {
  const zip = await JSZip.loadAsync(await blob.arrayBuffer());
  return zip.file("word/document.xml").async("string");
}

describe("AC-2: the inserted fact reaches the RENDERED preview document.xml", () => {
  it("buildPreviewBlob for the post-insert Gemini entry produces a docx carrying the fact", async () => {
    const entry = await insertThenEntry();
    const blob = await buildPreviewBlob(entry, "cover", { coverLetterFile: TEMPLATE_FILE });
    expect(blob, "preview produced no blob").toBeTruthy();
    const xml = await documentXmlOf(blob);

    // Control: the letter's own text really rendered (no vacuous pass).
    expect(xml, "the preview rendered no base content").toContain(BASE_TOKEN);
    // RED on HEAD: the insert refused, so the fact never entered the lines.
    expect(xml, "the inserted fact is missing from the rendered preview document.xml").toContain(FACT_X.suggestion);
  });
});

describe("AC-3: the inserted fact reaches the DOWNLOADED cover letter document.xml", () => {
  it("downloadDocxFiles for the post-insert Gemini entry produces a non-null docx carrying the fact", async () => {
    const entry = await insertThenEntry();
    const downloaders = createDocumentDownloaders({
      resumeFile: null,
      coverLetterFile: TEMPLATE_FILE,
      tailoringMap: { [JOB_ID]: entry },
      applicationData: {},
    });
    const err = await downloaders.downloadDocxFiles({
      jobTitle: JOB.title,
      company: JOB.company,
      result: "",
      resultLines: [],
      coverLetterResultLines: entry.coverLetterResultLines,
      coverLetterDocxB64: entry.coverLetterDocxB64 || "",
    });

    // Not the "Upload your cover letter template" error string: a real blob went out.
    expect(err, `download returned an error instead of a blob: ${err || ""}`).toBeNull();
    const cover = downloadCalls.find((d) => /CL\.docx$/i.test(d.name));
    expect(cover, "no cover-letter blob was handed to the download trigger").toBeTruthy();
    const xml = await documentXmlOf(cover.blob);

    // Control + RED-on-HEAD, same shape as AC-2.
    expect(xml, "the download rendered no base content").toContain(BASE_TOKEN);
    expect(xml, "the inserted fact is missing from the downloaded document.xml").toContain(FACT_X.suggestion);
  });
});
