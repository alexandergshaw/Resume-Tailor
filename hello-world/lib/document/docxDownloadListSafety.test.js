// @vitest-environment jsdom
//
// N36 REGRESSION FENCE -- the .docx DOWNLOAD keeps its bullets.
//
// WHY THIS IS THE HIGHEST-CONSEQUENCE FILE IN THE CHUNK: the download is the
// one path that already works. The owner's own observation of N36 is "paste
// loses the bullets, the downloaded .docx keeps them" (ledger V1, discharged
// 2026-09-20). The fix for the paste adds a `list` field to the preview model
// and a "\u2022 " marker to the PLAIN-TEXT flavour -- and the download reads
// its text from the SAME model, through `modelToLines`. If a marker ever leaks
// into that derivation, `buildDocxFromUploadedTemplate` writes it into a
// paragraph that ALREADY carries <w:numPr>, so Word renders its own bullet
// plus a literal one, and every ATS that parses the .docx reads "\u2022" as
// part of the achievement text. That is a worse defect than the one being
// fixed, on the path that was healthy.
//
// jsdom, not node: `buildDocxFromUploadedTemplate` uses DOMParser and
// XMLSerializer, both undefined in this repo's default node environment.
//
// HONEST SCOPE. What this file proves is that the rebuild preserves <w:numPr>
// and injects no marker for the lines it is given. What it CANNOT prove is
// that Microsoft Word renders the result with bullets -- no test here opens a
// real .docx in a real Word. That single check is named in the notes artifact
// as a human step, and it is the same two-minute procedure V1's discharge
// already used once.

import { describe, it, expect } from "vitest";
import JSZip from "jszip";
import { parseDocxToModel, modelToLines } from "./docxPreview.js";
// THE ENTRY POINT IS DELIBERATE. `resolveDocumentBlob` is the function the
// download really goes through (lib/document/previewBlob.js:139 ->
// app/page.js:1447's createDocumentDownloaders), and its edited-document
// branch (docx.js:573-575) is what calls buildDocxFromUploadedTemplate on the
// ENGINE's own .docx -- the standing rule that an edited download rebuilds
// from the engine doc, never from the raw upload. Importing the inner
// function instead would test the same code one layer in, and would also move
// `docx.js#buildDocxFromUploadedTemplate` out of
// lib/sourceScan/exportReachability.sweep.test.js's orphan ledger (measured:
// that import alone turns two of that sweep's rows red), perturbing another
// seat's census for no gain.
import { resolveDocumentBlob } from "./docx.js";

const BULLET = "\u2022"; // a code point, never a pasted glyph

const NS = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';

function listP(text, numId, ilvl = 0) {
  return (
    `<w:p><w:pPr><w:numPr><w:ilvl w:val="${ilvl}"/><w:numId w:val="${numId}"/></w:numPr>` +
    `<w:spacing w:after="80"/></w:pPr><w:r><w:t>${text}</w:t></w:r></w:p>`
  );
}
const plainP = (text) => `<w:p><w:r><w:t>${text}</w:t></w:r></w:p>`;

const NUMBERING =
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:numbering ${NS}>` +
  '<w:abstractNum w:abstractNumId="1"><w:lvl w:ilvl="0"><w:numFmt w:val="bullet"/><w:lvlText w:val="*"/></w:lvl></w:abstractNum>' +
  '<w:num w:numId="1"><w:abstractNumId w:val="1"/></w:num></w:numbering>';

// The template a user uploads: a heading, two native-Word bullet paragraphs,
// and a closing line. The shape the bundled resume template really has
// (measured: 10 direct <w:numPr> paragraphs, numFmt="bullet", ilvl 0).
const TEMPLATE_BODY =
  plainP("Staff Engineer, Acme Robotics") +
  listP("Led migration to microservices", "1") +
  listP("Built CI pipeline adopted by 12 teams", "1") +
  plainP("Omaha, NE");

async function makeTemplateFile(bodyXml) {
  const zip = new JSZip();
  zip.file(
    "[Content_Types].xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`,
  );
  zip.file(
    "_rels/.rels",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`,
  );
  zip.file("word/document.xml", `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document ${NS}><w:body>${bodyXml}</w:body></w:document>`);
  zip.file("word/numbering.xml", NUMBERING);
  return zip.generateAsync({ type: "nodebuffer" });
}

async function documentXmlOf(blobOrBuffer) {
  const zip = await JSZip.loadAsync(blobOrBuffer);
  return zip.file("word/document.xml").async("string");
}

// THE DOWNLOAD, driven at its production entry point. `edited: true` plus a
// non-empty `text` is the "the user hand-edited the preview and then clicked
// Download .docx" branch -- the ONE branch that rebuilds rather than serving a
// stored file verbatim, and therefore the only one a change to the derived
// lines could ever corrupt.
async function downloadEdited(templateBuffer, lines) {
  const blob = await resolveDocumentBlob({
    engineDocxB64: templateBuffer.toString("base64"),
    edited: true,
    text: lines.join("\n"),
    lines,
  });
  expect(blob).not.toBeNull();
  return documentXmlOf(blob);
}

const countOf = (haystack, needle) => haystack.split(needle).length - 1;

describe("harness control", () => {
  it("the rebuild runs in this environment at all, and the template really carries <w:numPr>", async () => {
    const template = await makeTemplateFile(TEMPLATE_BODY);
    const before = await documentXmlOf(template);
    expect(countOf(before, "<w:numPr>")).toBe(2);
    const out = await downloadEdited(template, ["A", "B", "C", "D"]);
    expect(out).toContain("<w:t>A</w:t>");
  });
});

describe("N36 fence: a rebuild from a list-bearing template keeps <w:numPr> and adds no literal marker", () => {
  it("the tailored .docx still has both native bullets and not one typed bullet character", async () => {
    const template = await makeTemplateFile(TEMPLATE_BODY);
    const model = await parseDocxToModel(template);

    // ANTI-VACUITY, and the only assertion in this row that is RED on HEAD:
    // the model really is list-bearing, so the fence below is fencing
    // something. Without it this whole row is green today and green forever,
    // including against a build that lost <w:numPr> entirely at parse time.
    expect(model.paragraphs.filter((p) => p.list)).toHaveLength(2);

    // The download's real input: modelToLines' output, edited the way a
    // tailoring pass edits it (same line count, new wording).
    const lines = modelToLines(model);
    expect(lines).toEqual([
      "Staff Engineer, Acme Robotics",
      "Led migration to microservices",
      "Built CI pipeline adopted by 12 teams",
      "Omaha, NE",
    ]);
    const tailored = [
      "Staff Engineer, Acme Robotics",
      "Led migration to microservices, cutting deploy time 40%",
      "Built CI pipeline adopted by 12 teams",
      "Omaha, NE",
    ];

    const out = await downloadEdited(template, tailored);
    expect(countOf(out, "<w:numPr>")).toBe(2); // both bullets still native
    expect(out).toContain("cutting deploy time 40%");
    expect(out).not.toContain(BULLET);
  });

  it("CONTROL: a marker in the lines DOES reach the .docx -- so the row above is a measurement, not a tautology", async () => {
    // If `modelToLines` ever starts prefixing "\u2022 ", this is exactly what
    // the user downloads. Demonstrated here with a deliberately marker-bearing
    // line, so "the output contains no bullet" above is known to be a property
    // of the INPUT and not something the rebuild strips for free.
    const template = await makeTemplateFile(TEMPLATE_BODY);
    const out = await downloadEdited(template, [
      "Staff Engineer, Acme Robotics",
      `${BULLET} Led migration to microservices`,
      `${BULLET} Built CI pipeline adopted by 12 teams`,
      "Omaha, NE",
    ]);
    expect(out).toContain(BULLET);
    expect(countOf(out, BULLET)).toBe(2);
  });

  it("an INSERTED line clones the slot it follows, so a new bullet is a bullet and a new plain line is plain", async () => {
    // alignLinesToSlots clones the nearest surviving paragraph for an insert.
    // A third achievement added by a tailoring pass therefore inherits the
    // bullet paragraph's <w:pPr> -- which is the behaviour that makes the
    // download work today, stated here so a later change to the model shape
    // cannot quietly alter it.
    const template = await makeTemplateFile(TEMPLATE_BODY);
    const out = await downloadEdited(template, [
      "Staff Engineer, Acme Robotics",
      "Led migration to microservices",
      "Built CI pipeline adopted by 12 teams",
      "Mentored 3 junior engineers",
      "Omaha, NE",
    ]);
    expect(out).toContain("Mentored 3 junior engineers");
    expect(countOf(out, "<w:numPr>")).toBe(3);
    expect(out).not.toContain(BULLET);
  });
});
