// @vitest-environment jsdom
//
// N36 ACCEPTANCE TESTS -- the PLAIN-TEXT flavour carries a list marker, and
// the whole .docx -> preview -> clipboard pipeline joins up.
//
// THE OWNER RULING THIS FILE IMPLEMENTS (2026-09-20, binding): an <li> now
// contributes a marker to the flattened text. The previous behaviour -- a
// bare line, no glyph, no indent, no numbering -- was DELIBERATE and pinned by
// four exact-equality assertions in htmlToPlainText.test.js; the owner
// authorised changing that specification, and those four assertions are
// updated in place (never deleted) in that file, each keeping the property it
// was written to protect.
//
// WHY THE PLAIN FLAVOUR MATTERS MORE THAN THE RICH ONE HERE, in domain terms:
// text/html rides ONLY the copy-event channel (lib/clipboard/plainText.js), so
// the async-clipboard and textarea paths deliver plain text regardless of what
// the rich flavour contains -- and an ATS application form is a plain <textarea>
// in every case. Fixing only the <ul>/<li> render would move N36 one layer
// downstream: Word and Google Docs would get their bullets back while the ATS
// text box -- the surface a candidate's application is actually read from --
// still received three achievement lines indistinguishable from prose.
//
// THE MARKER IS THIS REPO'S OWN CONVENTION, not an invention: "\u2022 "
// (U+2022 then one space) is what lib/feed/normalize.js:21,
// lib/email/newJobsEmail.js:95 and lib/greenhouse/searchJobs.js:35 already
// emit when they turn a list into plain text.
//
// OUT OF SCOPE, stated so its absence is not read as an oversight: the
// nested-<li> text-fusion defect ("Led migration" fusing onto the first
// nested item with no separator) is a different, execution-verified defect,
// ruled out of this chunk by the design. No corpus in this file nests a list
// INSIDE an <li>, and the render half never produces that shape.

import { describe, it, expect } from "vitest";
import { htmlToPlainText } from "./htmlToPlainText.js";
import { parseDocxToModel, renderModelToHtml, linesToModel } from "./docxPreview.js";
import { getDefaultTemplateBuffer } from "@/lib/llm/engines/tailor-lite/defaultTemplate.js";
import JSZip from "jszip";

// Code points, never pasted glyphs: a bullet and a middot are indistinguishable
// in most diffs, and a corpus that silently carried the wrong one would make
// every assertion below assert the wrong character forever.
const BULLET = "\u2022";
const MARKER = `${BULLET} `;

function nonEmptyString(value) {
  expect(typeof value).toBe("string");
  expect(value.length).toBeGreaterThan(0);
  return value;
}

// ---------------------------------------------------------------------------
// a .docx fixture, so the join test below starts where a real resume starts
// ---------------------------------------------------------------------------

const NS = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';
const listP = (text, numId, ilvl = 0) =>
  `<w:p><w:pPr><w:numPr><w:ilvl w:val="${ilvl}"/><w:numId w:val="${numId}"/></w:numPr></w:pPr><w:r><w:t>${text}</w:t></w:r></w:p>`;
const plainP = (text) => `<w:p><w:r><w:t>${text}</w:t></w:r></w:p>`;
const NUMBERING =
  `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:numbering ${NS}>` +
  '<w:abstractNum w:abstractNumId="1"><w:lvl w:ilvl="0"><w:numFmt w:val="bullet"/></w:lvl></w:abstractNum>' +
  '<w:num w:numId="1"><w:abstractNumId w:val="1"/></w:num></w:numbering>';

async function makeDocx(bodyXml) {
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

describe("harness sanity control", () => {
  it("DOMParser is available, and the marker constant really is U+2022 plus one space", () => {
    expect(typeof DOMParser).toBe("function");
    expect(MARKER).toHaveLength(2);
    expect(MARKER.codePointAt(0)).toBe(0x2022);
    expect(MARKER.codePointAt(1)).toBe(0x0020);
  });
});

// ===========================================================================
// THE MARKER ROWS
// ===========================================================================

describe("N36: an <li> in a <ul> contributes a bullet marker before its text", () => {
  it("each item is marker plus text, one line each, with no terminator of the list's own", () => {
    expect(htmlToPlainText("<ul><li>Led migration</li><li>Built pipeline</li></ul>")).toBe(
      `${MARKER}Led migration\n${MARKER}Built pipeline`,
    );
  });

  it("the marker precedes the item's own text, and adds no indent and no trailing space", () => {
    const out = nonEmptyString(htmlToPlainText("<ul><li>Led migration</li></ul>"));
    expect(out.startsWith(MARKER)).toBe(true);
    expect(out).toBe(`${MARKER}Led migration`);
    // The four things the superseded B4 row protected, all still protected:
    // no tab, no hyphen/asterisk/middot substitute, no leading indent.
    for (const wrong of ["\t", "-", "*", "\u00b7", "  "]) expect(out).not.toContain(wrong);
  });

  it("OVER-FIRE CONTROL: no OTHER block gets a marker", () => {
    // The failure this pins is the one that would ruin an entire resume: a
    // marker attached to every BLOCK_TAG line rather than to <li> alone would
    // bullet the candidate's NAME, their job titles and every section
    // heading. Each construct here is one an in-app producer really emits
    // (renderModelToHtml's <p>, Chrome's <div> for Enter, the toolbar's
    // headings, a pasted table cell).
    const out = nonEmptyString(
      htmlToPlainText("<h2>ALEX SHAW</h2><p>Staff Engineer</p><div>Omaha, NE</div><table><tbody><tr><td>2019</td></tr></tbody></table><ul><li>Led migration</li></ul>"),
    );
    expect(out).toBe(`ALEX SHAW\nStaff Engineer\nOmaha, NE\n2019\n${MARKER}Led migration`);
    expect(out.split("\n").filter((l) => l.startsWith(MARKER))).toHaveLength(1);
  });

  it("a <ul> still contributes NO terminator of its own -- no phantom blank line after a list", () => {
    // The superseded B7 row's property, restated for the marker era.
    expect(htmlToPlainText("<ul><li>A</li><li>B</li><li>C</li></ul><p>After</p>")).toBe(
      `${MARKER}A\n${MARKER}B\n${MARKER}C\nAfter`,
    );
  });

  it("inline markup inside an item is flattened as before, and the marker lands once, outside it", () => {
    expect(htmlToPlainText('<ul><li><span style="font-weight:700">40%</span> faster deploys</li></ul>')).toBe(`${MARKER}40% faster deploys`);
  });
});

describe("N36: an <li> in an <ol> is NUMBERED, and each list counts from 1", () => {
  it("items are numbered in document order", () => {
    expect(htmlToPlainText("<ol><li>Screen</li><li>Onsite</li><li>Offer</li></ol>")).toBe("1. Screen\n2. Onsite\n3. Offer");
  });

  it("COUNTER CONTROL: the number really increments -- a constant \"1.\" fails here", () => {
    const out = nonEmptyString(htmlToPlainText("<ol><li>Screen</li><li>Onsite</li></ol>"));
    expect(out).toContain("2. Onsite");
    expect(out).not.toContain("1. Onsite");
    expect(out).not.toContain(BULLET); // an ordered list never gets the bullet glyph
  });

  it("two sibling lists each restart at 1 -- the counter is per list, never global", () => {
    expect(htmlToPlainText("<ol><li>Screen</li><li>Onsite</li></ol><p>Second role</p><ol><li>Screen</li></ol>")).toBe(
      "1. Screen\n2. Onsite\nSecond role\n1. Screen",
    );
  });

  it("the counter does not leak BETWEEN calls -- two identical calls return identical strings", () => {
    // A module-level counter passes every row above and fails this one. It is
    // also the defect a user would meet first, because the copy control is
    // clicked repeatedly in one session: the second copy of the same resume
    // would come out numbered 3, 4, 5.
    const corpus = "<ol><li>Screen</li><li>Onsite</li></ol>";
    const first = nonEmptyString(htmlToPlainText(corpus));
    const second = htmlToPlainText(corpus);
    expect(second).toBe(first);
    expect(first).toBe("1. Screen\n2. Onsite");
  });

  it("an unordered and an ordered list in one document get their own markers", () => {
    expect(htmlToPlainText("<ul><li>A bullet</li></ul><ol><li>First step</li></ol>")).toBe(`${MARKER}A bullet\n1. First step`);
  });
});

describe("N36: the marker rules at the edges", () => {
  it("DEPTH-INDEPENDENT still: a marked list closes with no extra terminator", () => {
    // The superseded F1 row's property. The F1 flag must still be set by the
    // <li>'s own block terminator and cleared by the marker emission, or a
    // list that ENDS the document gains or loses a trailing newline.
    expect(htmlToPlainText("<ul><li>A</li><li>B</li></ul>")).toBe(`${MARKER}A\n${MARKER}B`);
    expect(htmlToPlainText("<ul><li>A</li></ul><p>Tail</p>")).toBe(`${MARKER}A\nTail`);
  });

  it("an empty document, a bare text node and a lone paragraph are untouched by the marker rule", () => {
    expect(htmlToPlainText("")).toBe("");
    expect(htmlToPlainText("bare text")).toBe("bare text");
    expect(htmlToPlainText("<p>A</p>")).toBe("A");
  });

  it("GREEN ON HEAD BY CONSTRUCTION (a disclosure, not coverage): a parentless <li> stays a bare line", () => {
    // An <li> with no <ul>/<ol> ancestor arrives only by hand-crafted paste --
    // no producer in this app emits one. It has no list context, so there is
    // no counter to read and no marker to choose; today's bare line is the
    // documented fallback. This row asserts the ABSENCE of a feature that does
    // not exist yet, so it passes on HEAD and proves nothing until the rest of
    // the file is green. Recorded as such rather than counted as coverage.
    expect(htmlToPlainText("<li>Orphan</li>")).toBe("Orphan");
  });

  it("the NBSP substitution still runs on a marked line", () => {
    const NBSP = String.fromCharCode(0x00a0);
    const input = `<ul><li>Mutual${NBSP}Omaha</li></ul>`;
    expect(input).toContain(NBSP); // corpus self-test
    const out = nonEmptyString(htmlToPlainText(input));
    expect(out).toBe(`${MARKER}Mutual Omaha`);
    expect(out).not.toContain(NBSP);
  });
});

// ===========================================================================
// THE JOIN -- .docx bytes to the string a user pastes into an ATS
// ===========================================================================
//
// Every row above tests one half. These test the composition, which is where
// this repo has shipped defects before: two correct halves wired together
// wrong. The pipeline here is the production one, hop for hop --
// parseDocxToModel (app/hooks/useDocumentPreview.js:415) -> renderModelToHtml
// (app/components/DocumentPreviewDialog.js:348) -> htmlToPlainText
// (DocumentPreviewDialog.js:430, its ONE production consumer).

describe("N36 JOIN: a Word-bulleted .docx reaches the clipboard with its bullets", () => {
  it("the flattened text of a synthetic resume fragment carries a marker on every native bullet", async () => {
    const model = await parseDocxToModel(
      await makeDocx(
        plainP("EXPERIENCE") +
          plainP("Staff Engineer, Acme Robotics") +
          listP("Led migration to microservices, cutting deploy time 40%", "1") +
          listP("Built CI pipeline adopted by 12 teams", "1") +
          listP("Mentored 3 junior engineers", "1"),
      ),
    );
    const text = nonEmptyString(htmlToPlainText(renderModelToHtml(model)));
    expect(text).toBe(
      [
        "EXPERIENCE",
        "Staff Engineer, Acme Robotics",
        `${MARKER}Led migration to microservices, cutting deploy time 40%`,
        `${MARKER}Built CI pipeline adopted by 12 teams`,
        `${MARKER}Mentored 3 junior engineers`,
      ].join("\n"),
    );
    // The heading and the job title are NOT bulleted -- the discrimination an
    // ATS reader depends on.
    expect(text.split("\n").filter((l) => l.startsWith(MARKER))).toHaveLength(3);
  });

  it("the REAL bundled resume template flattens to exactly ten marked lines", async () => {
    // Measured for this seat by execution: the bundled template has 37
    // paragraphs, 10 of them native bullets (numIds 1/2/3, all ilvl 0, all
    // numFmt="bullet"). So a candidate copying an untouched tailored resume
    // from this template pastes 10 bullet lines and 27 unmarked ones.
    const model = await parseDocxToModel(await getDefaultTemplateBuffer());
    const text = nonEmptyString(htmlToPlainText(renderModelToHtml(model)));
    const marked = text.split("\n").filter((l) => l.startsWith(MARKER));
    expect(marked).toHaveLength(10);
    expect(text.split("\n").filter((l) => l.includes(BULLET) && !l.startsWith(MARKER))).toHaveLength(0);
  });

  it("AC-C1.5 extended to a list: the derived text is the surface's blocks, in order, with markers added and nothing else", async () => {
    // The property this repo already holds for every other paragraph type:
    // what lands on the clipboard is the text on screen. For a list the two
    // cannot be byte-equal (the screen's bullet is drawn by CSS, the
    // clipboard's is a character), so the statement is: strip the markers and
    // the derived text IS the surface, block for block, in order.
    const model = await parseDocxToModel(
      await makeDocx(plainP("Staff Engineer") + listP("Led   migration", "1") + listP("Built pipeline", "1") + plainP("Omaha, NE")),
    );
    const html = renderModelToHtml(model);
    const derived = nonEmptyString(htmlToPlainText(html));
    const stripped = derived.split("\n").map((l) => (l.startsWith(MARKER) ? l.slice(MARKER.length) : l));

    const body = new DOMParser().parseFromString(html, "text/html").body;
    const surface = [...body.querySelectorAll("p, li")].map((el) => el.textContent);
    expect(surface).toHaveLength(4);
    expect(stripped).toEqual(surface);
    // Corpus self-test: a run of interior spaces really is present, so the
    // "nothing else changed" half is failable (a marker implementation that
    // trimmed or collapsed the item's text would be caught here).
    expect(surface[1]).toContain("Led   migration");
    expect(derived).toContain(`${MARKER}Led   migration`);
  });

  it("POSITIVE CONTROL for the join: a document with no native numbering gains no marker at all", () => {
    // The .txt / no-template producer, which is the other half of the app's
    // preview surface. If markers appeared here, every plain resume would
    // acquire bullets it never had -- the mirror image of N36 and just as
    // wrong.
    const text = nonEmptyString(htmlToPlainText(renderModelToHtml(linesToModel(["ALEX SHAW", "", "Led migration", "Built pipeline"]))));
    expect(text).toBe("ALEX SHAW\n\nLed migration\nBuilt pipeline");
    expect(text).not.toContain(BULLET);
  });
});
