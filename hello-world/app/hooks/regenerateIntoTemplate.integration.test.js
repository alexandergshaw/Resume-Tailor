// @vitest-environment jsdom
//
// N151c (4b) — S6 end-to-end: the hook wrapper regenerateActiveIntoTemplate,
// wired through the REAL persist + version machinery (persistGeneratedDocuments
// -> saveGeneratedResume/_CoverLetter -> the generated_* tables, read back by
// refreshDocumentVersions), over a round-tripping in-memory supabase. Only
// ../../lib/supabase/client is stubbed; the byte pipeline, the persist, and the
// version read are all real.
//
// This is BOTH the DI wire test (the hook binds its OWN deps — nothing is
// injected but the supabase client, per the "every DI seam needs one no-deps
// wire test" rule) AND the integration for T5/T7/T8 (plan §G). It mirrors
// useDocumentPreview.wiring.test.js's Probe harness.
//
// RED on HEAD: the hook does not expose regenerateActiveIntoTemplate, so
// api.regenerateActiveIntoTemplate is undefined and requireRegen() reds with a
// clear reason.
//
// Mutants it must RED (§F S5/S6):
//   * the wrapper omits the userId/positionId guard -> a signed-out / no-position
//     regen appends anyway (the OR-3 silent-no-append; count grows when it must
//     not).
//   * the persist writes the wrong scope -> a resume regen grows
//     generated_cover_letters (or vice versa).
//   * the handler regenerates PRE-edit content (stale tailoringMap closure) ->
//     the persisted content is not the current entry's text.
//   * render drops formattingTemplate -> the stored bytes carry the engine font,
//     not the chosen template's.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { createElement, useState, act } from "react";
import { createRoot } from "react-dom/client";
import JSZip from "jszip";
import { makeStatefulSupabase } from "@/test/helpers/supabaseFake.js";
import { WORDPROCESSINGML_NS as NS } from "../../lib/document/docx.js";

const h = vi.hoisted(() => ({ fake: null }));
vi.mock("../../lib/supabase/client", () => ({ createClient: () => h.fake }));

import { useDocumentPreview } from "./useDocumentPreview.js";

globalThis.IS_REACT_ACT_ENVIRONMENT = true;

// --- docx fixtures (a template with a distinctive run font) ----------------
function bodyXml(text, { font } = {}) {
  const rpr = font ? `<w:rPr><w:rFonts w:ascii="${font}" w:hAnsi="${font}" w:cs="${font}"/></w:rPr>` : "";
  return `<w:p><w:pPr><w:spacing w:after="120"/></w:pPr><w:r>${rpr}<w:t>${text}</w:t></w:r></w:p>`;
}
async function docxZipB64(paragraphs) {
  const zip = new JSZip();
  zip.file("[Content_Types].xml", `<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`);
  zip.file("_rels/.rels", `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`);
  zip.file("word/document.xml", `<?xml version="1.0"?><w:document xmlns:w="${NS}"><w:body>${paragraphs.join("")}<w:sectPr><w:pgSz w:w="12240" w:h="15840"/></w:sectPr></w:body></w:document>`);
  return zip.generateAsync({ type: "base64" });
}
async function docxFile(paragraphs, name = "chosen.docx") {
  const b64 = await docxZipB64(paragraphs);
  const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  return new File([bytes], name, { type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" });
}
function runFonts(xml) {
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  return Array.from(doc.getElementsByTagNameNS(NS, "rFonts")).map((n) => n.getAttribute("w:ascii")).filter(Boolean);
}
async function fontsOfStored(bytes) {
  const zip = await JSZip.loadAsync(bytes);
  return runFonts(await zip.file("word/document.xml").async("string"));
}

const ENGINE_FONT = "EngineNativeFont";
const TEMPLATE_FONT = "ChosenTemplateFont";
const JOB_ID = "job-1";

// --- Probe (mirrors useDocumentPreview.wiring.test.js) ---------------------
let api = null;
let latestMap = null;
let container = null;
let root = null;

function Probe({ initialMap, currentUser }) {
  const [tailoringMap, setTailoringMap] = useState(initialMap);
  latestMap = tailoringMap;
  api = useDocumentPreview({
    tailoringMap,
    setTailoringMap,
    updateTailoringJob: (jobId, updater) =>
      setTailoringMap((cur) => ({
        ...cur,
        [jobId]: typeof updater === "function" ? updater(cur[jobId] || {}) : { ...(cur[jobId] || {}), ...updater },
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
    currentUser,
    onCheckDuplicate: null,
  });
  return null;
}

async function mountAndOpen(entry, currentUser = { id: "user-1" }) {
  await act(async () => {
    root.render(createElement(Probe, { initialMap: { [JOB_ID]: entry }, currentUser }));
  });
  await act(async () => {
    api.openResumePreview({ id: JOB_ID, title: "Staff Engineer", company: "Acme" });
  });
  // The version load is fire-and-forget; give it its flushes.
  await act(async () => { await Promise.resolve(); await Promise.resolve(); });
}

function requireRegen() {
  expect(typeof api.regenerateActiveIntoTemplate, "the hook does not expose regenerateActiveIntoTemplate on HEAD").toBe("function");
  return api.regenerateActiveIntoTemplate;
}

async function regen(scope, templateFile) {
  await act(async () => {
    await requireRegen()(scope, templateFile);
  });
  await act(async () => { await Promise.resolve(); });
}

function resumeEntry(overrides = {}) {
  return {
    status: "done",
    result: "CURRENT RESUME",
    resultLines: ["CURRENT RESUME"],
    docxB64: "", // set per test
    coverLetterResultLines: [],
    coverLetterDocxB64: "",
    edited: { resume: false, cover: false },
    ...overrides,
  };
}

const OLD_ROW = {
  id: "r1",
  position_id: "pos-1",
  user_id: "user-1",
  content: "OLD RESUME",
  content_lines: ["OLD RESUME"],
  created_at: "2026-08-01T00:00:00.000Z",
  docx_path: "user-1/generated/r1.docx",
};

function seedFake({ positions = [{ id: "pos-1", external_id: JOB_ID, user_id: "user-1" }], generated_resumes = [{ ...OLD_ROW }], generated_cover_letters = [] } = {}) {
  return makeStatefulSupabase(
    { positions, generated_resumes, generated_cover_letters, applications: [] },
    { user: { id: "user-1" } },
  );
}

beforeEach(() => {
  api = null;
  latestMap = null;
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
});
afterEach(async () => {
  await act(async () => { root.unmount(); });
  container.remove();
  h.fake = null;
});

describe("regenerateActiveIntoTemplate end-to-end — append, current, non-destructive (T4/T5 / PL-2..PL-4)", () => {
  it("appends EXACTLY ONE generated_resumes row; the older row is untouched; the new row becomes current", async () => {
    h.fake = seedFake();
    const engineB64 = await docxZipB64([bodyXml("e", { font: ENGINE_FONT })]);
    await mountAndOpen(resumeEntry({ docxB64: engineB64 }));
    // Guard: the open really loaded the one existing version (else the asserts are vacuous).
    expect(api.documentVersions.resume.map((v) => v.id)).toEqual(["r1"]);

    const template = await docxFile([bodyXml("slot", { font: TEMPLATE_FONT })]);
    await regen("resume", template);

    const rows = h.fake.rows("generated_resumes");
    expect(rows, "history did not grow by exactly one").toHaveLength(2);
    // The older row is intact (non-destructive).
    const old = rows.find((r) => r.id === "r1");
    expect(old.content).toBe("OLD RESUME");
    expect(old.docx_path).toBe("user-1/generated/r1.docx");
    // The new row carries the CURRENT content and a stored docx.
    const fresh = rows.find((r) => r.id !== "r1");
    expect(fresh.content).toBe("CURRENT RESUME");
    expect(fresh.content_lines).toEqual(["CURRENT RESUME"]);
    expect(typeof fresh.docx_path, "the regen row's docx was not stored").toBe("string");
    expect(fresh.docx_path.length).toBeGreaterThan(0);
    // ...and it is current/selected.
    expect(api.currentVersionId.resume).toBe(fresh.id);

    // The stored bytes carry the CHOSEN template's formatting, not the engine's
    // (drop-formattingTemplate mutant reds here).
    const stored = await h.fake.storedBytes(fresh.docx_path);
    expect(stored, "no bytes stored for the regen row").toBeTruthy();
    const fonts = await fontsOfStored(stored);
    expect(fonts).toContain(TEMPLATE_FONT);
    expect(fonts).not.toContain(ENGINE_FONT);
  });

  it("CONTENT BOUNDARY (§C-2): an empty result with populated resultLines STILL appends (no silent no-append)", async () => {
    h.fake = seedFake();
    const engineB64 = await docxZipB64([bodyXml("e", { font: ENGINE_FONT })]);
    await mountAndOpen(resumeEntry({ result: "", resultLines: ["LINE A", "LINE B"], docxB64: engineB64 }));
    const template = await docxFile([bodyXml("slot", { font: TEMPLATE_FONT })]);
    await regen("resume", template);
    const rows = h.fake.rows("generated_resumes");
    expect(rows).toHaveLength(2);
    expect(rows.find((r) => r.id !== "r1").content).toBe("LINE A\nLINE B");
  });

  it("[no-op control] regenerating twice appends twice (each is a new render)", async () => {
    h.fake = seedFake();
    const engineB64 = await docxZipB64([bodyXml("e", { font: ENGINE_FONT })]);
    await mountAndOpen(resumeEntry({ docxB64: engineB64 }));
    const template = await docxFile([bodyXml("slot", { font: TEMPLATE_FONT })]);
    await regen("resume", template);
    await regen("resume", template);
    expect(h.fake.rows("generated_resumes")).toHaveLength(3);
  });

  it("a RESUME regen leaves generated_cover_letters empty (wrong-scope mutant reds)", async () => {
    h.fake = seedFake();
    const engineB64 = await docxZipB64([bodyXml("e", { font: ENGINE_FONT })]);
    await mountAndOpen(resumeEntry({ docxB64: engineB64 }));
    await regen("resume", await docxFile([bodyXml("slot", { font: TEMPLATE_FONT })]));
    expect(h.fake.rows("generated_cover_letters")).toHaveLength(0);
  });

  it("a COVER regen appends to generated_cover_letters and leaves generated_resumes at its prior count", async () => {
    h.fake = seedFake({ generated_cover_letters: [] });
    const engineB64 = await docxZipB64([bodyXml("e", { font: ENGINE_FONT })]);
    await mountAndOpen(resumeEntry({ coverLetterResultLines: ["COVER LINE"], coverLetterDocxB64: engineB64 }));
    await regen("cover", await docxFile([bodyXml("slot", { font: TEMPLATE_FONT })]));
    expect(h.fake.rows("generated_cover_letters")).toHaveLength(1);
    expect(h.fake.rows("generated_resumes")).toHaveLength(1); // the seeded r1 only
  });
});

describe("regenerateActiveIntoTemplate reads the CURRENT entry (not a stale closure) (§F S6)", () => {
  it("persists the text as it stands AFTER a version switch, not the text at mount", async () => {
    h.fake = seedFake();
    const engineB64 = await docxZipB64([bodyXml("e", { font: ENGINE_FONT })]);
    await mountAndOpen(resumeEntry({ docxB64: engineB64 }));
    expect(api.documentVersions.resume.map((v) => v.id)).toEqual(["r1"]);
    // Switch the displayed content to the older version's text.
    await act(async () => { api.selectDocumentVersion("resume", "r1"); });
    await act(async () => {});
    expect(latestMap[JOB_ID].result).toBe("OLD RESUME");
    // Regen now must persist OLD RESUME (the current text), not CURRENT RESUME
    // (the mount-time text a stale closure would carry).
    await regen("resume", await docxFile([bodyXml("slot", { font: TEMPLATE_FONT })]));
    const fresh = h.fake.rows("generated_resumes").filter((r) => r.id !== "r1");
    expect(fresh).toHaveLength(1);
    expect(fresh[0].content).toBe("OLD RESUME");
  });
});

describe("OR-3 handler guard end-to-end — no append when it cannot become a version (T8 / PL-10)", () => {
  it("signed out -> NO row appended", async () => {
    h.fake = seedFake();
    const engineB64 = await docxZipB64([bodyXml("e", { font: ENGINE_FONT })]);
    await mountAndOpen(resumeEntry({ docxB64: engineB64 }), null); // no currentUser
    await regen("resume", await docxFile([bodyXml("slot", { font: TEMPLATE_FONT })]));
    expect(h.fake.rows("generated_resumes"), "a signed-out regen appended a version").toHaveLength(1);
  });

  it("no resolvable positionId -> NO row appended", async () => {
    h.fake = seedFake({ positions: [] }); // external_id 'job-1' resolves to nothing
    const engineB64 = await docxZipB64([bodyXml("e", { font: ENGINE_FONT })]);
    await mountAndOpen(resumeEntry({ docxB64: engineB64 }), { id: "user-1" });
    // The open found no position, so there is nothing to append against.
    await regen("resume", await docxFile([bodyXml("slot", { font: TEMPLATE_FONT })]));
    expect(h.fake.rows("generated_resumes")).toHaveLength(1);
  });
});

describe("non-destructive + reselectable after a regen (T7 / PL-4)", () => {
  it("selecting back to the older version restores its content; selecting twice is idempotent", async () => {
    h.fake = seedFake();
    const engineB64 = await docxZipB64([bodyXml("e", { font: ENGINE_FONT })]);
    await mountAndOpen(resumeEntry({ docxB64: engineB64 }));
    await regen("resume", await docxFile([bodyXml("slot", { font: TEMPLATE_FONT })]));
    const freshId = h.fake.rows("generated_resumes").find((r) => r.id !== "r1").id;
    expect(api.currentVersionId.resume).toBe(freshId);

    await act(async () => { api.selectDocumentVersion("resume", "r1"); });
    await act(async () => {});
    expect(latestMap[JOB_ID].result).toBe("OLD RESUME");
    expect(api.currentVersionId.resume).toBe("r1");

    await act(async () => { api.selectDocumentVersion("resume", "r1"); });
    await act(async () => {});
    expect(latestMap[JOB_ID].result).toBe("OLD RESUME");
    // The regen row is still there — selecting an older one did not delete it.
    expect(h.fake.rows("generated_resumes")).toHaveLength(2);
  });
});
