// @vitest-environment jsdom
//
// N97 (4b) — THE LAST HOP (AC-4 / plan R1) + the null=no-override guard
// (AC-8 / plan R6) + the mismatch guard (plan R7), asserted on BUILT BYTES at
// the REAL production choke points, not on a DB write.
//
// This suite drives the two production entry points the design settled as the
// consumption seam:
//   * resolveDocumentBlob(...)   — docx.js:628, THE single doc-build choke
//     point every preview/download funnels through.
//   * createDocumentDownloaders(...).downloadDocxFiles(...) — docx.js, the
//     shared egress every current-session download (page.js:2081/2591, the
//     modal download at useDocumentPreview:533) funnels through.
// A direct call of buildDocxFromUploadedTemplate would satisfy the criterion
// against an entry point no egress reaches (loop-tdd rule 6); we use the real
// path so a wired-nowhere override reds here.
//
// ===========================================================================
// WHY A FORMATTING MARKER, NOT A CONTENT STRING (design §9.2 / plan §8).
// ===========================================================================
// buildDocxFromUploadedTemplate SWAPS each paragraph's TEXT and PRESERVES its
// run/paragraph STYLING (docx.js setParagraphText + alignLinesToSlots). So the
// generation's text is what survives into the output, and the TEMPLATE's
// contribution is its FORMATTING. The marker that proves "rendered into the
// stored template" must therefore be a styling attribute — here a run font
// (w:rFonts w:ascii) and paragraph justification (w:jc) — never a text string,
// which the generation overwrites. A content-string marker would be a
// zero-power measurement of this feature.
//
// ===========================================================================
// THE DOWNLOAD-TRIGGER SEAM (mirrors docx.spacing.download.test.js).
// ===========================================================================
// downloadDocxFiles calls triggerBlobDownload, which docx.js imports from
// "./download.js". So "./download.js" is the module to mock; mocking docx.js's
// re-export leaves the internal call bound to the real one, capturedBlob() is
// undefined, and every assertion runs against nothing. The "harness" control
// below (exactly one Blob per document) proves the right module is mocked.
//
// RED-on-HEAD, in one line: neither resolveDocumentBlob nor downloadDocxFiles
// accepts a `formattingTemplate`/`coverFormattingTemplate` today (docx.js:628,
// :701), so a set default is IGNORED — the engine doc is served verbatim and
// the stored template's formatting never reaches the output. Every
// "override applied" assertion is red until the seam lands. The no-op controls
// are GREEN on HEAD and post-impl and exist to catch a null-as-override mutant.

import { describe, it, expect, vi, beforeEach } from "vitest";
import JSZip from "jszip";

vi.mock("./download.js", () => ({ triggerBlobDownload: vi.fn() }));

import { triggerBlobDownload } from "./download.js";
import {
  resolveDocumentBlob,
  createDocumentDownloaders,
  WORDPROCESSINGML_NS as NS,
} from "./docx.js";

// ---------------------------------------------------------------------------
// fixtures
// ---------------------------------------------------------------------------

// A minimal .docx body whose single editable paragraph carries a distinctive
// run FONT and (optionally) center justification — the FORMATTING marker.
function bodyXml(text, { font, center = false } = {}) {
  const jc = center ? `<w:jc w:val="center"/>` : "";
  const rpr = font ? `<w:rPr><w:rFonts w:ascii="${font}" w:hAnsi="${font}" w:cs="${font}"/></w:rPr>` : "";
  return `<w:p><w:pPr>${jc}<w:spacing w:after="120"/></w:pPr><w:r>${rpr}<w:t>${text}</w:t></w:r></w:p>`;
}

async function docxZipB64(paragraphs) {
  const zip = new JSZip();
  zip.file(
    "[Content_Types].xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`,
  );
  zip.file(
    "_rels/.rels",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`,
  );
  zip.file(
    "word/document.xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="${NS}"><w:body>${paragraphs.join("")}<w:sectPr><w:pgSz w:w="12240" w:h="15840"/></w:sectPr></w:body></w:document>`,
  );
  return zip.generateAsync({ type: "base64" });
}

// A .docx as a File (isDocxResume only checks the .docx name) — the shape the
// consumption resolver hands in as `formattingTemplate`.
async function docxFile(paragraphs, name = "default-template.docx") {
  const b64 = await docxZipB64(paragraphs);
  const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  return new File([bytes], name, {
    type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  });
}

// ---------------------------------------------------------------------------
// readers
// ---------------------------------------------------------------------------
async function producedXml(blob) {
  const zip = await JSZip.loadAsync(await blob.arrayBuffer());
  return zip.file("word/document.xml").async("string");
}
function parse(xml) {
  return new DOMParser().parseFromString(xml, "application/xml");
}
// The set of run fonts (w:rFonts w:ascii) present in the produced document.
function runFonts(xml) {
  const doc = parse(xml);
  return Array.from(doc.getElementsByTagNameNS(NS, "rFonts"))
    .map((n) => n.getAttribute("w:ascii"))
    .filter(Boolean);
}
function paragraphTexts(xml) {
  const doc = parse(xml);
  return Array.from(doc.getElementsByTagNameNS(NS, "p")).map((p) =>
    Array.from(p.getElementsByTagNameNS(NS, "t"))
      .map((t) => t.textContent)
      .join(""),
  );
}

// ---------------------------------------------------------------------------
// harness — mirror the real download call the way page.js:2081/2591 makes it
// (both scopes populated), capturing each produced blob by NAME.
// ---------------------------------------------------------------------------
function capturedByName() {
  const out = {};
  for (const [blob, name] of triggerBlobDownload.mock.calls) out[name] = blob;
  return out;
}

async function runDownload(extra) {
  const { downloadDocxFiles } = createDocumentDownloaders({
    resumeFile: null,
    coverLetterFile: null,
    tailoringMap: {},
    applicationData: [],
  });
  const err = await downloadDocxFiles({
    jobTitle: "Staff Engineer",
    company: "Acme",
    result: "RESUME BODY LINE",
    resultLines: ["RESUME BODY LINE"],
    coverLetterResultLines: ["COVER BODY LINE"],
    ...extra,
  });
  expect(err, `downloadDocxFiles returned an error: ${err}`).toBeFalsy();
  return capturedByName();
}

const ENGINE_FONT = "EngineNativeFont";
const RESUME_MARK = "ResumeTemplateFont";
const COVER_MARK = "CoverTemplateFont";

beforeEach(() => {
  triggerBlobDownload.mockClear();
});

// ---------------------------------------------------------------------------
// harness control — proves the right module is mocked (not a vacuous pass)
// ---------------------------------------------------------------------------
describe("harness", () => {
  it("captures a Blob per document from the mocked ./download.js", async () => {
    const engineR = await docxZipB64([bodyXml("engine resume", { font: ENGINE_FONT })]);
    const engineC = await docxZipB64([bodyXml("engine cover", { font: ENGINE_FONT })]);
    await runDownload({ docxB64: engineR, coverLetterDocxB64: engineC });
    // Two documents downloaded -> two captured blobs. If ./download.js were not
    // the mocked module this is 0 and every re-parse below reads undefined.
    expect(triggerBlobDownload.mock.calls.length).toBeGreaterThanOrEqual(2);
  });
});

// ---------------------------------------------------------------------------
// AC-4 — the LAST HOP at resolveDocumentBlob: a set default takes PRECEDENCE
// over the engine's own finished doc and its formatting reaches the output.
// ---------------------------------------------------------------------------
describe("AC-4 — resolveDocumentBlob applies the default template as a formatting override", () => {
  it("POSITIVE CANARY: the font reader really sees a known run font (not blind)", async () => {
    const engineB64 = await docxZipB64([bodyXml("x", { font: ENGINE_FONT })]);
    const blob = await resolveDocumentBlob({ engineDocxB64: engineB64, edited: false });
    // Unedited + engineDocxB64 -> served verbatim on HEAD, so the engine font
    // is present. Proves a later "== RESUME_MARK" cannot pass by reading nothing.
    expect(runFonts(await producedXml(blob))).toContain(ENGINE_FONT);
  });

  it("a set default OVERRIDES the verbatim-serve: output carries the TEMPLATE font, not the engine font (RED on HEAD)", async () => {
    const engineB64 = await docxZipB64([bodyXml("engine text", { font: ENGINE_FONT })]);
    const template = await docxFile([bodyXml("placeholder", { font: RESUME_MARK, center: true })]);
    const blob = await resolveDocumentBlob({
      engineDocxB64: engineB64,
      edited: false,
      text: "RESUME BODY LINE",
      lines: ["RESUME BODY LINE"],
      formattingTemplate: template, // NEW param, ignored on HEAD
    });
    const xml = await producedXml(blob);
    // The stored template's formatting won.
    expect(runFonts(xml), "template font did not reach the output").toContain(RESUME_MARK);
    expect(runFonts(xml)).not.toContain(ENGINE_FONT);
    // ...and the GENERATION's text is what the reader sees (formatting-only).
    expect(paragraphTexts(xml).join(" ")).toContain("RESUME BODY LINE");
  });

  it("the override wins even for an EDITED document (precedence over the edited-rebuild branch) (RED on HEAD)", async () => {
    const engineB64 = await docxZipB64([bodyXml("engine text", { font: ENGINE_FONT })]);
    const template = await docxFile([bodyXml("placeholder", { font: RESUME_MARK })]);
    const blob = await resolveDocumentBlob({
      engineDocxB64: engineB64,
      edited: true,
      text: "EDITED RESUME LINE",
      lines: ["EDITED RESUME LINE"],
      formattingTemplate: template,
    });
    const xml = await producedXml(blob);
    expect(runFonts(xml)).toContain(RESUME_MARK);
    expect(paragraphTexts(xml).join(" ")).toContain("EDITED RESUME LINE");
  });

  it("NO-OP CONTROL (AC-8/R6): with NO formattingTemplate the engine doc is served verbatim — template font never invented (survives HEAD and impl)", async () => {
    const engineB64 = await docxZipB64([bodyXml("engine text", { font: ENGINE_FONT })]);
    const blob = await resolveDocumentBlob({ engineDocxB64: engineB64, edited: false });
    const xml = await producedXml(blob);
    expect(runFonts(xml)).toContain(ENGINE_FONT);
    expect(runFonts(xml)).not.toContain(RESUME_MARK);
  });
});

// ---------------------------------------------------------------------------
// AC-4 / C1 — downloadDocxFiles routes the RÉSUMÉ template to the résumé doc
// and the COVER template to the cover doc (two distinct params).
// This is the canonical post-generation-download shape (page.js:2081/2591).
// ---------------------------------------------------------------------------
describe("AC-4 / C1 — the real download egress applies each kind's template to its own document", () => {
  it("résumé blob carries the résumé template's font AND cover blob carries the COVER template's font (RED on HEAD)", async () => {
    const engineR = await docxZipB64([bodyXml("engine resume", { font: ENGINE_FONT })]);
    const engineC = await docxZipB64([bodyXml("engine cover", { font: ENGINE_FONT })]);
    const resumeTemplate = await docxFile([bodyXml("r placeholder", { font: RESUME_MARK })], "default-resume.docx");
    const coverTemplate = await docxFile([bodyXml("c placeholder", { font: COVER_MARK })], "default-cover.docx");

    const blobs = await runDownload({
      docxB64: engineR,
      coverLetterDocxB64: engineC,
      formattingTemplate: resumeTemplate, // résumé kind
      coverFormattingTemplate: coverTemplate, // cover kind
    });

    const resumeXml = await producedXml(blobs["Staff Engineer - Acme Resume.docx"] || Object.values(blobs)[0]);
    // The names are resolveDocumentFileName's; assert by the produced set, not by
    // a guessed exact key: pick the résumé (first) and cover (second) capture.
    const names = triggerBlobDownload.mock.calls.map((c) => c[1]);
    const resumeName = names.find((n) => /resume/i.test(n));
    const coverName = names.find((n) => /cl|cover/i.test(n));
    expect(resumeName, "no résumé download captured").toBeTruthy();
    expect(coverName, "no cover download captured").toBeTruthy();

    const rFontsResume = runFonts(await producedXml(capturedByName()[resumeName]));
    const rFontsCover = runFonts(await producedXml(capturedByName()[coverName]));

    // Each document gets its OWN kind's template. The missed-surface / wrong-
    // routing mutant (apply the résumé template to both) reds on the cover line.
    expect(rFontsResume, "résumé did not adopt the résumé template").toContain(RESUME_MARK);
    expect(rFontsCover, "cover did not adopt the COVER template").toContain(COVER_MARK);
    // No cross-contamination.
    expect(rFontsCover).not.toContain(RESUME_MARK);
    expect(rFontsResume).not.toContain(COVER_MARK);
  });

  it("NO-OP CONTROL (AC-8/R6): a download with NEITHER template param serves both engine docs verbatim (survives HEAD and impl)", async () => {
    const engineR = await docxZipB64([bodyXml("engine resume", { font: ENGINE_FONT })]);
    const engineC = await docxZipB64([bodyXml("engine cover", { font: ENGINE_FONT })]);
    const blobs = await runDownload({ docxB64: engineR, coverLetterDocxB64: engineC });
    const names = triggerBlobDownload.mock.calls.map((c) => c[1]);
    for (const name of names) {
      const fonts = runFonts(await producedXml(capturedByName()[name]));
      expect(fonts).toContain(ENGINE_FONT);
      expect(fonts).not.toContain(RESUME_MARK);
      expect(fonts).not.toContain(COVER_MARK);
    }
    expect(blobs).toBeTruthy();
  });
});

// ---------------------------------------------------------------------------
// R7 — the primitive must NOT silently drop content when the template's
// paragraph count differs from the generation's line count.
// alignLinesToSlots guarantees "every non-empty line appears once as fill or
// insert" (alignLines.js), so the correct build preserves all lines. If a
// build instead truncated to the template's slot count, THAT is a design
// escalation, not an implementer fix — this test would fail and say so.
// ---------------------------------------------------------------------------
describe("R7 — content survives a template/generation length mismatch", () => {
  it("a 2-paragraph template + 5 generated lines produces all 5 lines' text (RED on HEAD via the param)", async () => {
    const template = await docxFile([
      bodyXml("slot one", { font: RESUME_MARK }),
      bodyXml("slot two", { font: RESUME_MARK }),
    ]);
    const lines = ["LINE ALPHA", "LINE BRAVO", "LINE CHARLIE", "LINE DELTA", "LINE ECHO"];
    const blob = await resolveDocumentBlob({
      edited: false,
      text: lines.join("\n"),
      lines,
      formattingTemplate: template,
    });
    expect(blob, "no blob produced — the override param is unwired (RED on HEAD)").toBeTruthy();
    const joined = paragraphTexts(await producedXml(blob)).join(" ␟ ");
    for (const line of lines) {
      expect(joined, `generation line silently dropped: ${line}`).toContain(line);
    }
    // And the template's formatting is still on the surviving/cloned paragraphs.
    expect(runFonts(await producedXml(blob))).toContain(RESUME_MARK);
  });
});

// ---------------------------------------------------------------------------
// R6 guard — a null / non-docx formattingTemplate must be treated as
// NO override (never as "apply an empty template"). Guards the whole app's
// existing output. A mutant that fires the override branch on a null/empty
// value throws or produces a blank doc; this stays byte-faithful to today.
// ---------------------------------------------------------------------------
describe("R6 guard — null / non-docx template is inert", () => {
  it("formattingTemplate:null behaves exactly like today's serve-verbatim (survives HEAD and impl)", async () => {
    const engineB64 = await docxZipB64([bodyXml("engine text", { font: ENGINE_FONT })]);
    const blob = await resolveDocumentBlob({
      engineDocxB64: engineB64,
      edited: false,
      formattingTemplate: null,
    });
    expect(runFonts(await producedXml(blob))).toContain(ENGINE_FONT);
  });

  it("a non-.docx formattingTemplate is ignored, not applied (guards the isDocx guard) (survives HEAD and impl)", async () => {
    const engineB64 = await docxZipB64([bodyXml("engine text", { font: ENGINE_FONT })]);
    const notADocx = new File(["not a zip"], "notes.txt", { type: "text/plain" });
    const blob = await resolveDocumentBlob({
      engineDocxB64: engineB64,
      edited: false,
      text: "RESUME BODY LINE",
      lines: ["RESUME BODY LINE"],
      formattingTemplate: notADocx,
    });
    // Must not throw and must fall back to the engine doc, never to an empty doc.
    expect(blob, "a non-docx template must not break the build").toBeTruthy();
    expect(runFonts(await producedXml(blob))).toContain(ENGINE_FONT);
  });
});
