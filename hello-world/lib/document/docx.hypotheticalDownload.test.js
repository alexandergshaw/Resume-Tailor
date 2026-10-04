// @vitest-environment jsdom
//
// N105 AC-12a - the HYPOTHETICAL download is built from its OWN template path.
//
// Both Ideal outputs go out through the one existing docx path (buildDownloadArgs
// -> createDocumentDownloaders().downloadDocxFiles -> resolveDocumentBlob), never a
// bespoke generator, so each inherits its template's styling. This file drives that
// real path on the hypothetical scope and re-parses the produced bytes. (The
// documentScopes.hypothetical test pins the ARGS buildDownloadArgs returns; this
// pins what the download then PRODUCES, and the name it is saved under.)
//
// THE STYLING MARKER. buildDocxFromUploadedTemplate swaps a paragraph's text and
// keeps its styling, so a template's contribution to the output is its run font,
// never its text. Each template below therefore carries a font of its own, and the
// assertions read the fonts of the produced file: a hypothetical download that
// quietly served (or was built on) the application-ready file shows the other font.
//
// THE DOWNLOAD-TRIGGER SEAM (mirrors docx.spacing.download.test.js): docx.js
// imports triggerBlobDownload from ./download.js and merely re-exports it, so the
// module to mock is ./download.js. The harness control proves exactly one Blob is
// captured per download; without it every assertion could be reading nothing.
//
// AC-12b (the real render: one page, no clipping) is owner-judged and NOT claimed
// here; nothing in this file measures layout.

import { describe, it, expect, vi, beforeEach } from "vitest";
import JSZip from "jszip";

vi.mock("./download.js", () => ({ triggerBlobDownload: vi.fn() }));

import { triggerBlobDownload } from "./download.js";
import { createDocumentDownloaders, HYPOTHETICAL_TOKEN, WORDPROCESSINGML_NS as NS } from "./docx.js";
import { buildDownloadArgs } from "@/lib/tailor/documentScopes.js";
import {
  EXAMPLE_CANDIDATE_LINES,
  EXAMPLE_CHAIN_ITEM,
  EXAMPLE_HYPOTHETICAL_LINES,
  EXAMPLE_RESUME_TEXT,
  EXAMPLE_ROWS,
} from "@/lib/llm/ideal/__fixtures__/examplePair.js";

const DOCX_MIME = "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
const HYPOTHETICAL_FONT = "HypotheticalTemplateFont";
const APPLICATION_READY_FONT = "ApplicationReadyTemplateFont";
const UPLOADED_FONT = "UploadedResumeTemplateFont";
const BEGINS_WITH_TOKEN = new RegExp(`^[^A-Za-z0-9]*${HYPOTHETICAL_TOKEN}`);

const nonBlank = (lines) => lines.filter((line) => line.trim() !== "");
const droppedTexts = new Set(EXAMPLE_ROWS.mustDrop.map((row) => row.text));
const HYPOTHETICAL_LINES = nonBlank(EXAMPLE_HYPOTHETICAL_LINES);
// What the application-ready file holds: the candidate without the failable rows.
const APPLICATION_READY_LINES = nonBlank(EXAMPLE_CANDIDATE_LINES).filter((line) => !droppedTexts.has(line));
const RESUME_LINES = nonBlank(EXAMPLE_RESUME_TEXT.split("\n"));

// A line that is in exactly one of the two files.
const ONLY_HYPOTHETICAL = EXAMPLE_CHAIN_ITEM.hypotheticalBullet;
const ONLY_APPLICATION_READY = EXAMPLE_CHAIN_ITEM.applicationReadyBullet;

const escapeXml = (s) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

function paragraphXml(text, font) {
  const fonts = `<w:rFonts w:ascii="${font}" w:hAnsi="${font}" w:cs="${font}"/>`;
  return `<w:p><w:pPr><w:spacing w:after="120"/></w:pPr><w:r><w:rPr>${fonts}</w:rPr><w:t>${escapeXml(text)}</w:t></w:r></w:p>`;
}

async function docxBytes(lines, font) {
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
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="${NS}"><w:body>${lines.map((l) => paragraphXml(l, font)).join("")}<w:sectPr><w:pgSz w:w="12240" w:h="15840"/></w:sectPr></w:body></w:document>`,
  );
  return zip.generateAsync({ type: "uint8array" });
}

async function docxB64(lines, font) {
  return Buffer.from(await docxBytes(lines, font)).toString("base64");
}

async function docxFile(lines, font, name = "resume.docx") {
  return new File([await docxBytes(lines, font)], name, { type: DOCX_MIME });
}

async function producedXml(blob) {
  const zip = await JSZip.loadAsync(await blob.arrayBuffer());
  return zip.file("word/document.xml").async("string");
}

function fontsOf(xml) {
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  return new Set(Array.from(doc.getElementsByTagNameNS(NS, "rFonts")).map((n) => n.getAttribute("w:ascii")));
}

function textsOf(xml) {
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  return Array.from(doc.getElementsByTagNameNS(NS, "p")).map((p) =>
    Array.from(p.getElementsByTagNameNS(NS, "t"))
      .map((t) => t.textContent)
      .join(""),
  );
}

// The latest download: { blob, name }.
function captured() {
  const calls = triggerBlobDownload.mock.calls;
  const [blob, name] = calls[calls.length - 1] ?? [];
  return { blob, name };
}

const TITLE = "Payments Platform Engineer";
const COMPANY = "Northwind Commerce";

// The scope's download through the real egress. `entry` carries both outputs'
// slots the way a tailoring entry does.
async function download(scope, entry, { resumeFile = null, serveFinished = true, text, lines, fileNameOverride } = {}) {
  const { downloadDocxFiles } = createDocumentDownloaders({
    resumeFile,
    coverLetterFile: null,
    tailoringMap: {},
    applicationData: [],
  });
  const shownLines = lines ?? (scope === "hypothetical" ? HYPOTHETICAL_LINES : APPLICATION_READY_LINES);
  const args = buildDownloadArgs({
    scope,
    entry,
    text: text ?? shownLines.join("\n"),
    lines: shownLines,
    serveFinished,
    title: TITLE,
    company: COMPANY,
    spacing: null,
    formattingTemplate: null,
    fileNameOverride,
  });
  const error = await downloadDocxFiles(args);
  return { error, ...captured() };
}

let entry;
beforeEach(async () => {
  triggerBlobDownload.mockClear();
  entry = {
    docxB64: await docxB64(APPLICATION_READY_LINES, APPLICATION_READY_FONT),
    hypotheticalDocxB64: await docxB64(HYPOTHETICAL_LINES, HYPOTHETICAL_FONT),
    // A rename the user gave the application-ready file; it is not the hypothetical's.
    resumeFileName: "My Application Resume",
  };
});

describe("harness", () => {
  it("captures exactly one Blob per download from the mocked ./download.js", async () => {
    const { error, blob } = await download("hypothetical", entry);
    expect(error).toBeFalsy();
    expect(triggerBlobDownload).toHaveBeenCalledTimes(1);
    expect(blob).toBeInstanceOf(Blob);
  });

  it("the two templates are distinguishable: each carries its own font and its own line", async () => {
    const own = await download("hypothetical", entry);
    const hypotheticalXml = await producedXml(own.blob);
    expect([...fontsOf(hypotheticalXml)]).toEqual([HYPOTHETICAL_FONT]);
    expect(textsOf(hypotheticalXml)).toContain(ONLY_HYPOTHETICAL);
    expect(textsOf(hypotheticalXml)).not.toContain(ONLY_APPLICATION_READY);

    triggerBlobDownload.mockClear();
    const resume = await download("resume", entry);
    const resumeXml = await producedXml(resume.blob);
    expect([...fontsOf(resumeXml)]).toEqual([APPLICATION_READY_FONT]);
    expect(textsOf(resumeXml)).toContain(ONLY_APPLICATION_READY);
    expect(textsOf(resumeXml)).not.toContain(ONLY_HYPOTHETICAL);
  });
});

describe("AC-12a - the hypothetical's bytes come from its own slot", () => {
  it("unedited: serves the hypothetical's own finished file, never the application-ready's", async () => {
    const { error, blob } = await download("hypothetical", entry);
    expect(error).toBeFalsy();
    const xml = await producedXml(blob);
    expect(fontsOf(xml).has(HYPOTHETICAL_FONT)).toBe(true);
    expect(fontsOf(xml).has(APPLICATION_READY_FONT)).toBe(false);
    expect(textsOf(xml)).toContain(ONLY_HYPOTHETICAL);
    expect(textsOf(xml)).not.toContain(ONLY_APPLICATION_READY);
  });

  it("edited: the edited text is rebuilt onto the HYPOTHETICAL's template, not the application-ready's", async () => {
    const edited = [...HYPOTHETICAL_LINES, "Added by hand to the hypothetical"];
    const { error, blob } = await download("hypothetical", entry, { serveFinished: false, lines: edited });
    expect(error).toBeFalsy();
    const xml = await producedXml(blob);
    expect(textsOf(xml)).toContain("Added by hand to the hypothetical");
    expect(fontsOf(xml).has(HYPOTHETICAL_FONT)).toBe(true);
    expect(fontsOf(xml).has(APPLICATION_READY_FONT)).toBe(false);
  });

  it("with no hypothetical bytes (the Gemini shape) it is built on the user's uploaded template, never the application-ready's bytes", async () => {
    const bytesless = { docxB64: entry.docxB64, resumeFileName: entry.resumeFileName };
    const resumeFile = await docxFile(RESUME_LINES, UPLOADED_FONT);
    const { error, blob } = await download("hypothetical", bytesless, { resumeFile });
    expect(error).toBeFalsy();
    const xml = await producedXml(blob);
    expect(textsOf(xml)).toContain(ONLY_HYPOTHETICAL);
    expect(fontsOf(xml).has(UPLOADED_FONT)).toBe(true);
    expect(fontsOf(xml).has(APPLICATION_READY_FONT)).toBe(false);
    expect(fontsOf(xml).has(HYPOTHETICAL_FONT)).toBe(false);
  });

  it("with no hypothetical bytes and no template it produces NOTHING: the application-ready file is not substituted", async () => {
    const bytesless = { docxB64: entry.docxB64, resumeFileName: entry.resumeFileName };
    const { error } = await download("hypothetical", bytesless, { resumeFile: null });
    expect(typeof error).toBe("string");
    expect(triggerBlobDownload).not.toHaveBeenCalled();
  });
});

describe("AC-12a - the hypothetical's file name carries the marker through the real egress", () => {
  it("the default name begins with the HYPOTHETICAL token and is a .docx", async () => {
    const { name } = await download("hypothetical", entry);
    expect(name).toMatch(BEGINS_WITH_TOKEN);
    expect(name).toMatch(/\.docx$/);
    expect(name).toContain(TITLE);
  });

  it("a name the user typed still begins with the token", async () => {
    const { name } = await download("hypothetical", entry, { fileNameOverride: "Jordan Rivera Resume" });
    expect(name).toMatch(BEGINS_WITH_TOKEN);
    expect(name).toContain("Jordan Rivera Resume");
  });

  it("the application-ready file's rename never reaches the hypothetical's name", async () => {
    const { name } = await download("hypothetical", entry);
    expect(name).not.toContain("My Application Resume");
  });

  it("CONTROL: the application-ready (resume scope) keeps its own rename and carries no marker", async () => {
    const { name } = await download("resume", entry);
    expect(name).toBe("My Application Resume.docx");
    expect(name).not.toMatch(new RegExp(HYPOTHETICAL_TOKEN));
  });
});
