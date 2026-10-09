// @vitest-environment jsdom
//
// N151c (4b) — S5: regenerateIntoTemplate.js, the injected-deps module that
// builds a resume/cover letter's CURRENT content into a chosen template's
// formatting (NO model call) and appends it as a new version (plan §D / §E S5).
// The ONE exported symbol is regenerateActiveIntoTemplate(deps) — the render
// helper stays module-local, so nothing is exported solely for a test (that
// would bump the exportReachability TEST_REFERENCED count; loop-tdd rule 6).
//
// RED on HEAD: lib/document/regenerateIntoTemplate.js does not exist — the
// import is module-not-found, so every test reds until S5 lands.
//
// The render is exercised on the REAL byte pipeline (buildPreviewBlob ->
// resolveDocumentBlob -> buildDocxFromUploadedTemplate, all real in jsdom with
// JSZip) THROUGH the exported handler: we decode the docxB64 it hands to the
// injected persistGeneratedDocuments. The marker that the chosen template
// reached the output is a FORMATTING attribute (a run font), never a content
// string, because the override SWAPS text and keeps styling — a content-string
// marker would be a zero-power measurement (see docx.defaultTemplateOverride).
//
// Mutants this suite must RED (§F S5):
//   * render drops formattingTemplate -> the persisted bytes carry the engine
//     font, not the template font (SILENT: a version appends, wrong formatting).
//   * persist content built from scopeText ("" when result==="") -> empty
//     content; saveGeneratedResume skips the insert (SILENT no-append).
//   * persist writes the wrong scope key -> a cover regen appends a resume row.
//   * the handler calls /api/tailor -> a fetch fires (headline: no model call).
//   * the userId/positionId guard is dropped -> persist runs signed-out.

import { describe, it, expect, vi } from "vitest";
import JSZip from "jszip";
import { WORDPROCESSINGML_NS as NS } from "./docx.js";

import { regenerateActiveIntoTemplate } from "./regenerateIntoTemplate.js";

// --- fixtures (mirror docx.defaultTemplateOverride.test.js) ----------------
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
async function docxFile(paragraphs, name = "chosen-template.docx") {
  const b64 = await docxZipB64(paragraphs);
  const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  return new File([bytes], name, { type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" });
}
async function fontsAndTexts(b64) {
  const zip = await JSZip.loadAsync(Uint8Array.from(atob(b64), (c) => c.charCodeAt(0)));
  const xml = await zip.file("word/document.xml").async("string");
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  const fonts = Array.from(doc.getElementsByTagNameNS(NS, "rFonts")).map((n) => n.getAttribute("w:ascii")).filter(Boolean);
  const texts = Array.from(doc.getElementsByTagNameNS(NS, "p")).map((p) =>
    Array.from(p.getElementsByTagNameNS(NS, "t")).map((t) => t.textContent).join(""),
  );
  return { fonts, texts: texts.join(" ") };
}

const ENGINE_FONT = "EngineNativeFont";
const TEMPLATE_FONT = "ChosenTemplateFont";

function baseDeps(overrides = {}) {
  return {
    scope: "resume",
    entry: { result: "CURRENT RESUME", resultLines: ["CURRENT RESUME"], docxB64: "" },
    templateFile: null,
    jobId: "job-1",
    positionId: "pos-1",
    userId: "user-1",
    supabase: {},
    updateTailoringJob: vi.fn(),
    setPreviewReloadKey: vi.fn(),
    persistGeneratedDocuments: vi.fn(async () => ({ resumeId: "r-new", coverLetterId: null })),
    refreshDocumentVersions: vi.fn(async () => {}),
    versionsRequestId: 7,
    sourceResumePath: "user-1/resume",
    ...overrides,
  };
}

async function engineB64() {
  return docxZipB64([bodyXml("engine", { font: ENGINE_FONT })]);
}

// --- the chosen template reaches the persisted bytes (T1 / PL-1) -----------
describe("regenerateActiveIntoTemplate builds the CURRENT content into the chosen template", () => {
  it("resume: the persisted docxB64 carries the TEMPLATE font and ALL content lines, not the engine font", async () => {
    const template = await docxFile([bodyXml("slot", { font: TEMPLATE_FONT })]);
    const deps = baseDeps({ templateFile: template, entry: { result: "RESUME LINE ONE\nRESUME LINE TWO", resultLines: ["RESUME LINE ONE", "RESUME LINE TWO"], docxB64: await engineB64() } });
    const out = await regenerateActiveIntoTemplate(deps);
    expect(out).toEqual({ ok: true });
    const { fonts, texts } = await fontsAndTexts(deps.persistGeneratedDocuments.mock.calls[0][1].resume.docxB64);
    expect(fonts, "the chosen template's formatting did not reach the output").toContain(TEMPLATE_FONT);
    expect(fonts, "the engine font survived — formattingTemplate was dropped").not.toContain(ENGINE_FONT);
    expect(texts).toContain("RESUME LINE ONE");
    expect(texts).toContain("RESUME LINE TWO");
  });

  it("cover: the persisted docxB64 carries the TEMPLATE font and the cover content", async () => {
    const template = await docxFile([bodyXml("slot", { font: TEMPLATE_FONT })]);
    const deps = baseDeps({ scope: "cover", entry: { coverLetterResultLines: ["COVER LINE A"], coverLetterDocxB64: await engineB64() }, templateFile: template });
    await regenerateActiveIntoTemplate(deps);
    const { fonts, texts } = await fontsAndTexts(deps.persistGeneratedDocuments.mock.calls[0][1].coverLetter.docxB64);
    expect(fonts).toContain(TEMPLATE_FONT);
    expect(texts).toContain("COVER LINE A");
  });

  it("an entry with no content and no engine doc -> { error }, and persist is NOT called (nothing to render)", async () => {
    const template = await docxFile([bodyXml("slot", { font: TEMPLATE_FONT })]);
    const deps = baseDeps({ entry: { result: "", resultLines: [] }, templateFile: template });
    const out = await regenerateActiveIntoTemplate(deps);
    expect(out.error).toBeTruthy();
    expect(deps.persistGeneratedDocuments).not.toHaveBeenCalled();
  });
});

// --- persist/refresh wiring (T4/T5 / PL-2..PL-3) ---------------------------
describe("regenerateActiveIntoTemplate — persist/refresh wiring", () => {
  it("appends via persistGeneratedDocuments with the RESUME scope payload and refreshes that scope", async () => {
    const template = await docxFile([bodyXml("slot", { font: TEMPLATE_FONT })]);
    const deps = baseDeps({ templateFile: template, entry: { result: "CURRENT RESUME", resultLines: ["CURRENT RESUME"], docxB64: await engineB64() } });
    await regenerateActiveIntoTemplate(deps);
    expect(deps.persistGeneratedDocuments).toHaveBeenCalledTimes(1);
    const [, payload] = deps.persistGeneratedDocuments.mock.calls[0];
    expect(payload).toMatchObject({ userId: "user-1", positionId: "pos-1" });
    expect(payload.resume, "no resume payload — wrong scope key").toBeTruthy();
    expect(payload.coverLetter, "a cover row was written on a resume regen (wrong scope key)").toBeFalsy();
    expect(payload.resume.content).toBe("CURRENT RESUME");
    expect(payload.resume.contentLines).toEqual(["CURRENT RESUME"]);
    expect(payload.resume.docxB64).toBeTruthy();

    expect(deps.refreshDocumentVersions).toHaveBeenCalledTimes(1);
    const refreshArgs = deps.refreshDocumentVersions.mock.calls[0];
    expect(refreshArgs[0]).toBe("job-1");
    expect(refreshArgs[1]).toEqual(["resume"]);
    expect(refreshArgs[3]).toBe("pos-1");
    expect(deps.updateTailoringJob).toHaveBeenCalled();
    expect(deps.setPreviewReloadKey).toHaveBeenCalled();
  });

  it("a COVER regen writes the coverLetter payload, never a resume row (wrong-scope mutant reds)", async () => {
    const template = await docxFile([bodyXml("slot", { font: TEMPLATE_FONT })]);
    const deps = baseDeps({ scope: "cover", entry: { coverLetterResultLines: ["COVER X"], coverLetterDocxB64: await engineB64() }, templateFile: template });
    await regenerateActiveIntoTemplate(deps);
    const [, payload] = deps.persistGeneratedDocuments.mock.calls[0];
    expect(payload.coverLetter, "no cover payload on a cover regen").toBeTruthy();
    expect(payload.resume).toBeFalsy();
    expect(payload.coverLetter.content).toBe("COVER X");
    expect(deps.refreshDocumentVersions.mock.calls[0][1]).toEqual(["cover"]);
  });

  it("CONTENT FORMULA (§C-2): an empty result with populated resultLines yields NON-EMPTY content", async () => {
    // scopeText returns "" here; using it would hand persist an empty content
    // and saveGeneratedResume would SKIP the insert (silent no-append). The
    // formula must be result || lines.join("\\n").
    const template = await docxFile([bodyXml("slot", { font: TEMPLATE_FONT })]);
    const deps = baseDeps({ entry: { result: "", resultLines: ["LINE A", "LINE B"], docxB64: await engineB64() }, templateFile: template });
    await regenerateActiveIntoTemplate(deps);
    const [, payload] = deps.persistGeneratedDocuments.mock.calls[0];
    expect(payload.resume.content, "empty content would make saveGeneratedResume skip the insert").toBe("LINE A\nLINE B");
    expect(payload.resume.contentLines).toEqual(["LINE A", "LINE B"]);
  });

  it("HEADLINE: builds the blob locally and makes NO /api/tailor fetch (no model call)", async () => {
    const fetchSpy = vi.fn(async () => { throw new Error("no network expected in a regen"); });
    const prevFetch = globalThis.fetch;
    globalThis.fetch = fetchSpy;
    try {
      const template = await docxFile([bodyXml("slot", { font: TEMPLATE_FONT })]);
      const deps = baseDeps({ templateFile: template, entry: { result: "R", resultLines: ["R"], docxB64: await engineB64() } });
      await regenerateActiveIntoTemplate(deps);
      const tailorCalls = fetchSpy.mock.calls.filter((c) => String(c[0]).includes("tailor"));
      expect(tailorCalls, "a regen must never call /api/tailor").toHaveLength(0);
    } finally {
      globalThis.fetch = prevFetch;
    }
  });
});

// --- T8-UNIT: the OR-3 handler guard (load-bearing, non-silent) -------------
describe("regenerateActiveIntoTemplate — OR-3 guard (T8-UNIT / PL-10)", () => {
  it("signed out (no userId) -> { error }, and persist is NEVER called (no silent no-append)", async () => {
    const template = await docxFile([bodyXml("slot", { font: TEMPLATE_FONT })]);
    const deps = baseDeps({ userId: null, templateFile: template });
    const out = await regenerateActiveIntoTemplate(deps);
    expect(out.error, "a signed-out regen must refuse with a reason").toBeTruthy();
    expect(out.ok).not.toBe(true);
    expect(deps.persistGeneratedDocuments, "persist ran signed-out — the guard is missing").not.toHaveBeenCalled();
    expect(deps.refreshDocumentVersions).not.toHaveBeenCalled();
  });

  it("no positionId -> { error }, and persist is NEVER called", async () => {
    const template = await docxFile([bodyXml("slot", { font: TEMPLATE_FONT })]);
    const deps = baseDeps({ positionId: null, templateFile: template });
    const out = await regenerateActiveIntoTemplate(deps);
    expect(out.error).toBeTruthy();
    expect(deps.persistGeneratedDocuments).not.toHaveBeenCalled();
  });

  it("[no-op control] a signed-in regen with a resolved position DOES persist", async () => {
    const template = await docxFile([bodyXml("slot", { font: TEMPLATE_FONT })]);
    const deps = baseDeps({ templateFile: template, entry: { result: "R", resultLines: ["R"], docxB64: await engineB64() } });
    const out = await regenerateActiveIntoTemplate(deps);
    expect(out).toEqual({ ok: true });
    expect(deps.persistGeneratedDocuments).toHaveBeenCalledTimes(1);
  });
});
