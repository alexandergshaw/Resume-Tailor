// @vitest-environment jsdom
//
// N97 (4b) — the CAPTURE primitive the promote handler relies on (design §4.6).
// The promote handler calls buildPreviewBlob(entry, scope, { resumeFile,
// coverLetterFile }) WITHOUT a formattingTemplate, so it captures the
// engine-NATIVE rendering of the CURRENT view (AC-2 / R2), and refuses (writes
// nothing) when that call returns null (AC-3c / R4).
//
// STATUS DISCLOSURE (read before counting coverage): these assertions are
// GREEN ON HEAD. buildPreviewBlob already (a) rebuilds the CURRENT edited text
// onto the engine doc and (b) returns null when no current-doc bytes are
// obtainable. This suite is a NON-REGRESSION guard + a proof that the fail-safe
// SIGNAL the handler depends on actually discriminates (the happy/stripped
// control pair). It does NOT prove the promote handler USES the primitive
// correctly — that the handler omits formattingTemplate (R2) and refuses on
// null (AC-3c) is a CALL-SITE property of a handler whose name/shape is not yet
// settled; it is flagged in tests.r1.md as needing a dedicated handler unit
// once Step 3 lands, and is NOT discharged here.

import { describe, it, expect } from "vitest";
import JSZip from "jszip";
import { buildPreviewBlob } from "./previewBlob.js";
import { WORDPROCESSINGML_NS as NS } from "./docx.js";

async function engineDocxB64(text) {
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
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="${NS}"><w:body><w:p><w:r><w:t>${text}</w:t></w:r></w:p></w:body></w:document>`,
  );
  return zip.generateAsync({ type: "base64" });
}

async function producedText(blob) {
  const zip = await JSZip.loadAsync(await blob.arrayBuffer());
  const xml = await zip.file("word/document.xml").async("string");
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  return Array.from(doc.getElementsByTagNameNS(NS, "t")).map((t) => t.textContent).join(" ");
}

describe("R2 precondition — capture reflects the CURRENT edited view, not the pristine engine text (green on HEAD)", () => {
  it("an edited résumé captures the edited text, not the pristine engine doc's text", async () => {
    const engine = await engineDocxB64("PRISTINE ENGINE TEXT");
    const entry = {
      docxB64: engine,
      edited: { resume: true, cover: false },
      result: "CURRENT EDITED LINE",
      resultLines: ["CURRENT EDITED LINE"],
    };
    const blob = await buildPreviewBlob(entry, "resume", { resumeFile: null, coverLetterFile: null });
    expect(blob, "no blob captured").toBeTruthy();
    const text = await producedText(blob);
    expect(text).toContain("CURRENT EDITED LINE");
    expect(text).not.toContain("PRISTINE ENGINE TEXT");
  });
});

describe("AC-3c precondition — the null fail-safe SIGNAL discriminates (green on HEAD)", () => {
  it("returns null for the email scope (never a docx-backed template)", async () => {
    const blob = await buildPreviewBlob({ emailResultLines: ["hi"] }, "email", { resumeFile: null, coverLetterFile: null });
    expect(blob).toBeNull();
  });

  it("returns null when NO current-doc bytes are obtainable (Gemini after reload: no docxB64/docxPath/File)", async () => {
    const entry = { edited: { resume: false }, result: "some text", resultLines: ["some text"] };
    const blob = await buildPreviewBlob(entry, "resume", { resumeFile: null, coverLetterFile: null });
    expect(blob, "must refuse (null) when bytes are unobtainable").toBeNull();
  });

  it("[control] does NOT return null when bytes ARE obtainable — proves the null above is specific, not vacuous", async () => {
    const engine = await engineDocxB64("ENGINE TEXT");
    const entry = { docxB64: engine, edited: { resume: false }, result: "some text", resultLines: ["some text"] };
    const blob = await buildPreviewBlob(entry, "resume", { resumeFile: null, coverLetterFile: null });
    expect(blob).toBeTruthy();
  });
});
