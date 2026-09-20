// N36 ACCEPTANCE TESTS -- the PARSE half and the RENDER half of "resume
// bullets vanish on COPY but survive on DOWNLOAD".
//
// THE SETTLED CAUSE (backlog N36, owner measurement + code read, not
// re-litigated here): `parseParagraph` reads <w:pPr> for `w:jc` and
// `w:spacing` ONLY -- it never reads <w:numPr> -- so a Word list paragraph
// arrives in the model indistinguishable from a plain one, and
// `renderModelToHtml` therefore has nothing from which to emit <ul>/<li>.
// The DOWNLOAD survives because lib/document/docx.js replaces TEXT inside an
// existing template paragraph and leaves its <w:pPr> (and the <w:numPr> in it)
// untouched. So the screen, the rich clipboard flavour and the plain clipboard
// flavour all lose the bullet while the .docx keeps it.
//
// This file is `environment: "node"` (the repo default), like
// docxPreview.test.js: nothing here needs a DOM. The clipboard-facing halves
// live in two jsdom files -- htmlToPlainText.listMarkers.test.js (the plain
// flavour) and app/components/preview/CopyDocumentControl.listCopy.test.js
// (the click that a human actually performs).
//
// WHAT IS *NOT* TESTED HERE, deliberately, so a later reader does not read the
// absence as an oversight: the nested-<li> text-fusion defect in
// htmlToPlainText (`"Led migration" + "Cut deploy time 40%"` fuse with no
// separator) is a DIFFERENT defect, execution-verified by the measurement
// round and ruled OUT of this chunk by the design (design.r1.md section 5).
// It is also structurally unreachable from this fix's own output, because
// every <ul>/<ol> rendered here is a top-level sibling and never a child of an
// <li> -- which is exactly what the "flat <li>" row below pins.

import { describe, it, expect } from "vitest";
import JSZip from "jszip";
import { parseDocxToModel, modelToLines, linesToModel, renderModelToHtml } from "./docxPreview.js";
import { getDefaultTemplateBuffer } from "@/lib/llm/engines/tailor-lite/defaultTemplate.js";

// U+2022 as a code point, never a pasted glyph: a bullet pasted into source is
// indistinguishable from a middot in most diffs, and a corpus that silently
// carried the wrong one would make the "no marker in the download text"
// assertions below vacuous.
const BULLET = "\u2022";

// ---------------------------------------------------------------------------
// fixtures
// ---------------------------------------------------------------------------

// A minimal .docx whose body is `bodyXml`, and whose word/numbering.xml part is
// `numberingXml` -- or which OMITS that part entirely when `numberingXml` is
// null, which is the shape docxPreview.test.js's own makeDocx has always built
// and therefore the shape every pre-existing fixture in this repo has.
async function makeDocx(bodyXml, numberingXml = null) {
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
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${bodyXml}</w:body></w:document>`,
  );
  if (numberingXml != null) zip.file("word/numbering.xml", numberingXml);
  return zip.generateAsync({ type: "nodebuffer" });
}

// One list paragraph: <w:numPr> lives inside <w:pPr>, exactly where the real
// template puts it (verified by execution against the bundled resume template:
// all 10 of its list paragraphs carry a direct <w:numPr> in their own <w:pPr>,
// never a style-inherited one).
function listP(text, numId, ilvl = 0) {
  return (
    `<w:p><w:pPr><w:numPr><w:ilvl w:val="${ilvl}"/><w:numId w:val="${numId}"/></w:numPr></w:pPr>` +
    `<w:r><w:t>${text}</w:t></w:r></w:p>`
  );
}

// The same, with the <w:ilvl> omitted entirely -- OOXML's default is level 0.
function listPNoIlvl(text, numId) {
  return `<w:p><w:pPr><w:numPr><w:numId w:val="${numId}"/></w:numPr></w:pPr><w:r><w:t>${text}</w:t></w:r></w:p>`;
}

function plainP(text) {
  return `<w:p><w:r><w:t>${text}</w:t></w:r></w:p>`;
}

// A word/numbering.xml declaring one <w:num> per entry of `defs`, each pointing
// at its own <w:abstractNum> whose level 0..8 all carry that entry's numFmt.
// This is the real two-hop chain Word uses: <w:num w:numId> ->
// <w:abstractNumId> -> <w:abstractNum>/<w:lvl w:ilvl>/<w:numFmt>.
function numbering(defs) {
  const nums = Object.entries(defs)
    .map(([numId]) => `<w:num w:numId="${numId}"><w:abstractNumId w:val="${numId}"/></w:num>`)
    .join("");
  const abstracts = Object.entries(defs)
    .map(([numId, fmt]) => {
      const levels = Array.from({ length: 9 }, (_, i) => `<w:lvl w:ilvl="${i}"><w:numFmt w:val="${fmt}"/><w:lvlText w:val="%1."/></w:lvl>`).join("");
      return `<w:abstractNum w:abstractNumId="${numId}">${levels}</w:abstractNum>`;
    })
    .join("");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:numbering xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">${abstracts}${nums}</w:numbering>`;
}

// ---------------------------------------------------------------------------
// HTML readers. This file has no DOM, so every structural claim below is read
// off the string with one of these -- each canaried in "harness controls".
// ---------------------------------------------------------------------------

const countOpen = (html, tag) => (html.match(new RegExp(`<${tag}\\b`, "g")) || []).length;

// Every <li>...</li>, whole. Safe as a regex ONLY because this design never
// nests an <li> inside an <li> -- which the "flat" row below independently
// pins, so this reader cannot quietly become wrong without a red test.
const liElements = (html) => [...html.matchAll(/<li\b[^>]*>([\s\S]*?)<\/li>/g)].map((m) => ({ whole: m[0], inner: m[1] }));

// The indent an <li> carries, in em. An <li> with no margin-left indents by
// nothing, which is 0 -- so a renderer that emits the property only for
// ilvl > 0 satisfies these rows exactly as one that always emits it.
function liIndentEm(whole) {
  const m = whole.match(/margin-left:\s*([0-9.]+)em/);
  return m ? Number.parseFloat(m[1]) : 0;
}

function nonEmptyString(value) {
  expect(typeof value).toBe("string");
  expect(value.length).toBeGreaterThan(0);
  return value;
}

describe("harness controls (if these are red, every row below is red for the wrong reason)", () => {
  it("the HTML readers really do read", () => {
    const sample = '<ul><li style="margin-left:1.5em">A</li><li>B</li></ul><p>C</p>';
    expect(countOpen(sample, "ul")).toBe(1);
    expect(countOpen(sample, "p")).toBe(1);
    expect(countOpen(sample, "ol")).toBe(0);
    const items = liElements(sample);
    expect(items).toHaveLength(2);
    expect(items[0].inner).toBe("A");
    expect(liIndentEm(items[0].whole)).toBe(1.5);
    expect(liIndentEm(items[1].whole)).toBe(0);
  });

  it("the fixtures really do build a .docx the parser can open, and really do carry <w:numPr>", async () => {
    const body = listP("A", "1") + plainP("B");
    expect(body).toContain("<w:numPr>");
    const model = await parseDocxToModel(await makeDocx(body, numbering({ 1: "bullet" })));
    expect(model.paragraphs).toHaveLength(2);
    expect(modelToLines(model)).toEqual(["A", "B"]);
  });
});

// ===========================================================================
// THE PARSE HALF -- <w:numPr> must reach the model
// ===========================================================================

describe("N36 parse: a paragraph's <w:numPr> becomes its `list`", () => {
  it("a bullet-format list paragraph carries {numId, ilvl, ordered:false} -- and a plain paragraph in the SAME document carries null", async () => {
    // THE OVER-FIRE CONTROL is the second paragraph. A build that simply sets
    // `list` on every paragraph (or defaults it to a truthy object) passes the
    // first assertion and fails the second -- and it is the failure mode that
    // matters, because it would wrap a resume's job titles and section
    // headings in <ul> on screen and prefix them with a bullet on the
    // clipboard.
    const model = await parseDocxToModel(
      await makeDocx(listP("Led migration to microservices", "1") + plainP("Staff Engineer, Acme Robotics"), numbering({ 1: "bullet" })),
    );
    expect(model.paragraphs).toHaveLength(2);
    expect(model.paragraphs[0].list).toEqual({ numId: "1", ilvl: 0, ordered: false });
    expect(model.paragraphs[1].list).toBeNull();
  });

  it("ordered vs unordered is RESOLVED through word/numbering.xml, not guessed -- both answers in one document", async () => {
    // Two numIds, two numFmts, one zip. A build that hardwires `ordered` to
    // either constant fails exactly one of these two assertions, so neither
    // can pass by accident.
    const model = await parseDocxToModel(
      await makeDocx(listP("First step", "7") + listP("A bullet", "8"), numbering({ 7: "decimal", 8: "bullet" })),
    );
    expect(model.paragraphs[0].list).toEqual({ numId: "7", ilvl: 0, ordered: true });
    expect(model.paragraphs[1].list).toEqual({ numId: "8", ilvl: 0, ordered: false });
  });

  it("the ordered numFmts are the counting ones; bullet and none are not", async () => {
    // Domain point, not pedantry: a resume's achievement list is virtually
    // always `bullet`, and an ATS reads "1." as ordinal data. Mapping
    // lowerLetter/upperRoman to unordered would silently drop the ordering of
    // a numbered list (a certification sequence, a publication list); mapping
    // `none` to ordered would invent numbers nobody wrote.
    const ordered = ["decimal", "decimalZero", "lowerRoman", "upperRoman", "lowerLetter", "upperLetter"];
    const unordered = ["bullet", "none", "notAKnownFormat"];
    const defs = {};
    const body = [...ordered, ...unordered].map((fmt, i) => {
      defs[String(i + 1)] = fmt;
      return listP(fmt, String(i + 1));
    });
    // Each paragraph is its OWN numId, so adjacency never merges them and
    // paragraph i is format i.
    const model = await parseDocxToModel(await makeDocx(body.join(""), numbering(defs)));
    const got = model.paragraphs.map((p) => [p.runs[0].text, p.list?.ordered]);
    expect(got).toEqual([...ordered.map((f) => [f, true]), ...unordered.map((f) => [f, false])]);
  });

  it("<w:ilvl> is carried as a NUMBER, and an absent <w:ilvl> is level 0 (OOXML's own default)", async () => {
    const model = await parseDocxToModel(
      await makeDocx(listP("Top", "1", 0) + listP("Nested", "1", 2) + listPNoIlvl("Implicit", "1"), numbering({ 1: "bullet" })),
    );
    expect(model.paragraphs.map((p) => p.list.ilvl)).toEqual([0, 2, 0]);
    // A string "2" would render an indent of `"2" * 1.5` = 3 by coercion and
    // look right, then break the first time anything compares levels.
    for (const p of model.paragraphs) expect(typeof p.list.ilvl).toBe("number");
    // numId stays a STRING: it is an identifier, never arithmetic, and "01"
    // and "1" are different lists in a Word document.
    for (const p of model.paragraphs) expect(typeof p.list.numId).toBe("string");
  });

  it('<w:numId w:val="0"/> is OOXML\'s explicit "this paragraph is NOT in a list" override, so `list` is null', async () => {
    // Word writes this when a user selects a list paragraph and turns the
    // bullet OFF while a style still supplies numbering. Treating it as
    // membership would put a bullet back on a line the author deliberately
    // un-bulleted.
    const model = await parseDocxToModel(
      await makeDocx(listP("Opted out", "0") + listP("Still a bullet", "1"), numbering({ 1: "bullet" })),
    );
    expect(model.paragraphs[0].list).toBeNull();
    expect(model.paragraphs[1].list).not.toBeNull(); // the control: the mechanism still fires next door
  });

  it("with NO word/numbering.xml part at all, MEMBERSHIP still survives and `ordered` falls back to false", async () => {
    // The fallback matters more than it looks: numId/ilvl live in
    // <w:numPr> itself, but ordered-vs-unordered lives ONLY in
    // numbering.xml. Losing that file must cost the ordering, never the
    // bullet -- a resume that renders as unordered when it was numbered is
    // cosmetically wrong; one that renders with no list at all is N36 again.
    const noPart = await parseDocxToModel(await makeDocx(listP("Bullet without a numbering part", "1"), null));
    expect(noPart.paragraphs[0].list).toEqual({ numId: "1", ilvl: 0, ordered: false });

    // THE CONTROL that makes the line above a fallback rather than a
    // constant: the SAME body, with a decimal numbering.xml, is ordered.
    const withPart = await parseDocxToModel(await makeDocx(listP("Bullet without a numbering part", "1"), numbering({ 1: "decimal" })));
    expect(withPart.paragraphs[0].list.ordered).toBe(true);
  });

  it("a numId the numbering part never declares still counts as a list, unordered", async () => {
    const model = await parseDocxToModel(await makeDocx(listP("Dangling numId", "42"), numbering({ 1: "decimal" })));
    expect(model.paragraphs[0].list).toEqual({ numId: "42", ilvl: 0, ordered: false });
  });

  it("EVERY paragraph carries a `list` key -- null or an object, never undefined", async () => {
    // The uniform-shape rule (design 1.1): no consumer should ever need an
    // `undefined` check, and `p.list === null` must be a reliable way to ask
    // "is this a list item".
    const model = await parseDocxToModel(await makeDocx(listP("A", "1") + plainP("B") + "<w:p></w:p>", numbering({ 1: "bullet" })));
    expect(model.paragraphs).toHaveLength(3);
    for (const p of model.paragraphs) {
      expect(Object.prototype.hasOwnProperty.call(p, "list")).toBe(true);
      expect(p.list === null || typeof p.list === "object").toBe(true);
    }
  });

  it("linesToModel sets list:null on every paragraph it builds, blank lines included", async () => {
    // The .txt / no-template producer. Same reason as above: one shape from
    // both producers.
    const model = linesToModel(["ALEX SHAW", "", "Led migration"]);
    expect(model.paragraphs).toHaveLength(3);
    for (const p of model.paragraphs) {
      expect(Object.prototype.hasOwnProperty.call(p, "list")).toBe(true);
      expect(p.list).toBeNull(); // toBeNull, not toBeFalsy: `undefined` must fail
    }
  });
});

// ===========================================================================
// THE PARSE HALF against the REAL bundled template
// ===========================================================================
//
// Measured by execution for this seat (2026-09-20, node + the real JSZip,
// reading RESUME_TEMPLATE_BASE64 off disk): the bundled resume template's zip
// contains word/numbering.xml; its word/document.xml has 37 paragraphs, of
// which exactly 10 carry a direct <w:numPr> in their own <w:pPr>; their numIds
// are "1", "2" and "3", every one at ilvl 0; numbering.xml resolves all three
// abstractNums to numFmt="bullet" at every one of their 9 levels. Their
// document-order indexes are 9, 10, 12, 14, 15, 17, 18, 21, 23, 25 -- which is
// SEVEN maximal adjacent same-numId runs: {9,10} {12} {14,15} {17,18} {21}
// {23} {25}. Those seven are what the render rows below expect.

describe("N36 parse: the REAL bundled resume template", () => {
  it("resolves exactly 10 of its 37 paragraphs as bullet list items, and the other 27 as null", async () => {
    const model = await parseDocxToModel(await getDefaultTemplateBuffer());
    expect(model.paragraphs).toHaveLength(37);
    const items = model.paragraphs.filter((p) => p.list);
    expect(items).toHaveLength(10);
    expect(model.paragraphs.filter((p) => p.list === null)).toHaveLength(27);
    expect([...new Set(items.map((p) => p.list.numId))].sort()).toEqual(["1", "2", "3"]);
    expect([...new Set(items.map((p) => p.list.ilvl))]).toEqual([0]);
    expect([...new Set(items.map((p) => p.list.ordered))]).toEqual([false]);
  });

  it("the ten are the achievement bullets, not the headings -- named so a template edit goes red for the RIGHT reason", async () => {
    // If someone re-authors the template and this row goes red, the question
    // to ask is "did the template's bullets change", not "is the parser
    // broken". Pinned on CONTENT, because a count alone cannot tell a
    // re-authored bullet list from a parser that started matching headings.
    const model = await parseDocxToModel(await getDefaultTemplateBuffer());
    const items = model.paragraphs.filter((p) => p.list).map((p) => p.runs.map((r) => r.text).join(""));
    expect(items).toHaveLength(10);
    for (const heading of ["Summary", "Education", "Professional Experience", "Skills"]) {
      expect(items).not.toContain(heading);
    }
    expect(items.filter((t) => t.startsWith("Led ")).length).toBeGreaterThan(0);
  });
});

// ===========================================================================
// THE RENDER HALF -- adjacency, boundaries, and flat <li>s
// ===========================================================================

describe("N36 render: a maximal run of ADJACENT same-numId paragraphs is ONE list", () => {
  it("three adjacent bullets become one <ul> of three <li>s, in document order", async () => {
    const model = await parseDocxToModel(
      await makeDocx(listP("Led migration", "1") + listP("Built CI pipeline", "1") + listP("Mentored 3 engineers", "1"), numbering({ 1: "bullet" })),
    );
    const html = nonEmptyString(renderModelToHtml(model));
    expect(countOpen(html, "ul")).toBe(1);
    expect(countOpen(html, "ol")).toBe(0);
    expect(liElements(html).map((li) => li.inner.replace(/<[^>]*>/g, ""))).toEqual([
      "Led migration",
      "Built CI pipeline",
      "Mentored 3 engineers",
    ]);
    // No <p> for a list paragraph. A <li> wrapping a <p> would emit TWO line
    // terminators in htmlToPlainText (LI and P are both block tags), turning
    // every bullet into a bullet plus a blank line on the clipboard.
    expect(countOpen(html, "p")).toBe(0);
  });

  it("BOUNDARY: two ADJACENT list paragraphs with DIFFERENT numIds are two lists, not one", async () => {
    // The grouping rule is numId-keyed, not "any two list paragraphs". Two
    // jobs' bullet lists that happen to sit next to each other are two lists
    // in Word and must stay two here.
    const two = await parseDocxToModel(
      await makeDocx(listP("Job A bullet", "1") + listP("Job B bullet", "2"), numbering({ 1: "bullet", 2: "bullet" })),
    );
    expect(countOpen(renderModelToHtml(two), "ul")).toBe(2);

    // THE CONTROL: the identical corpus with ONE numId is ONE list -- so the
    // row above measures the numId key and not merely "one wrapper per item".
    const one = await parseDocxToModel(
      await makeDocx(listP("Job A bullet", "1") + listP("Job B bullet", "1"), numbering({ 1: "bullet" })),
    );
    expect(countOpen(renderModelToHtml(one), "ul")).toBe(1);
    expect(liElements(renderModelToHtml(one))).toHaveLength(2);
  });

  it("BOUNDARY: a plain paragraph between two runs of the SAME numId splits them, and order is preserved", async () => {
    // This is the shape a real resume has: bullets, a job title, more bullets,
    // with Word reusing one numId throughout. Merging across the title would
    // reorder the document on screen and on the clipboard.
    const model = await parseDocxToModel(
      await makeDocx(
        listP("First job bullet", "1") + plainP("Staff Engineer, Acme Robotics") + listP("Second job bullet", "1"),
        numbering({ 1: "bullet" }),
      ),
    );
    const html = nonEmptyString(renderModelToHtml(model));
    expect(countOpen(html, "ul")).toBe(2);
    expect(countOpen(html, "p")).toBe(1);
    const firstList = html.indexOf("First job bullet");
    const title = html.indexOf("Staff Engineer, Acme Robotics");
    const secondList = html.indexOf("Second job bullet");
    expect(firstList).toBeGreaterThanOrEqual(0);
    expect(title).toBeGreaterThan(firstList);
    expect(secondList).toBeGreaterThan(title);
  });

  it("an ordered run renders <ol>, an unordered run <ul>, in the same document", async () => {
    const model = await parseDocxToModel(
      await makeDocx(listP("A bullet", "1") + listP("First step", "2") + listP("Second step", "2"), numbering({ 1: "bullet", 2: "decimal" })),
    );
    const html = nonEmptyString(renderModelToHtml(model));
    expect(countOpen(html, "ul")).toBe(1);
    expect(countOpen(html, "ol")).toBe(1);
    expect(liElements(html)).toHaveLength(3);
    expect(html.indexOf("<ul")).toBeLessThan(html.indexOf("<ol"));
  });

  it("ilvl is INDENT on a flat <li> -- never a <ul> nested inside an <li>", async () => {
    // The design's deliberate choice (1.4). The safety half is what this row
    // pins: a <ul> inside an <li> is the exact shape that triggers the
    // already-filed htmlToPlainText fusion defect, so this fix must never
    // produce it.
    const model = await parseDocxToModel(
      await makeDocx(listP("Top level", "1", 0) + listP("One deep", "1", 1) + listP("Two deep", "1", 2), numbering({ 1: "bullet" })),
    );
    const html = nonEmptyString(renderModelToHtml(model));
    expect(countOpen(html, "ul")).toBe(1);
    const items = liElements(html);
    expect(items).toHaveLength(3);
    for (const li of items) {
      expect(li.inner).not.toContain("<ul");
      expect(li.inner).not.toContain("<ol");
      expect(li.inner).not.toContain("<li");
    }
    const indents = items.map((li) => liIndentEm(li.whole));
    expect(indents[1]).toBeGreaterThan(indents[0]);
    expect(indents[2]).toBeGreaterThan(indents[1]);
  });

  it("CONTROL for the indent: same ilvl means same indent, so a per-position staircase does not pass", async () => {
    // Without this, a renderer that indents by ITEM INDEX rather than by ilvl
    // satisfies the increasing-indent row above while rendering a flat
    // three-bullet resume list as a staircase.
    const model = await parseDocxToModel(
      await makeDocx(listP("A", "1", 0) + listP("B", "1", 0) + listP("C", "1", 0), numbering({ 1: "bullet" })),
    );
    const indents = liElements(renderModelToHtml(model)).map((li) => liIndentEm(li.whole));
    expect(indents).toHaveLength(3);
    expect(new Set(indents).size).toBe(1);
  });

  it("run styling, XML-escaping and pre-wrap survive inside an <li>", async () => {
    // Everything a <p> already guarantees must hold for a bullet too:
    //  - bold/size/colour, or a bolded metric in a bullet loses its emphasis;
    //  - escaping, or a bullet containing "R&D" or "C++ <-> Python" corrupts
    //    the preview markup it is injected into;
    //  - white-space:pre-wrap, because htmlToPlainText copies text VERBATIM
    //    (its T1 row) on the grounds that the screen preserves runs of spaces.
    //    An <li> without pre-wrap makes the screen and the clipboard disagree
    //    for any bullet with a double space -- this repo's AC-C1.5 harm.
    const body =
      '<w:p><w:pPr><w:numPr><w:ilvl w:val="0"/><w:numId w:val="1"/></w:numPr></w:pPr>' +
      '<w:r><w:rPr><w:b/><w:sz w:val="22"/></w:rPr><w:t>40%</w:t></w:r>' +
      '<w:r><w:t xml:space="preserve"> faster  R&amp;D &lt;cycle&gt;</w:t></w:r></w:p>';
    const model = await parseDocxToModel(await makeDocx(body, numbering({ 1: "bullet" })));
    const html = nonEmptyString(renderModelToHtml(model));
    const items = liElements(html);
    expect(items).toHaveLength(1);
    expect(items[0].inner).toContain("font-weight:700");
    expect(items[0].inner).toContain("font-size:11pt");
    expect(items[0].inner).toContain("R&amp;D &lt;cycle&gt;");
    expect(items[0].inner).not.toContain("<cycle>");
    expect(items[0].whole).toContain("white-space:pre-wrap");
    // Corpus self-test: the source really does carry a double space, so
    // "verbatim" is a claim this corpus can actually fail.
    expect(modelToLines(model)[0]).toContain("faster  R&D");
  });

  it("the REAL bundled template renders SEVEN <ul>s of TEN <li>s and no <ol>", async () => {
    // The seven come from the measured document order of the ten list
    // paragraphs: {9,10} {12} {14,15} {17,18} {21} {23} {25}. This is the row
    // that would catch a renderer that merged every same-numId paragraph in
    // the document regardless of adjacency -- numId "1" appears at 9,10 AND
    // 14,15, and numId "2" at 17,18 AND 21,23,25-with-gaps, so a
    // non-adjacency-aware grouping produces THREE lists here and reorders the
    // document while doing it.
    const html = nonEmptyString(renderModelToHtml(await parseDocxToModel(await getDefaultTemplateBuffer())));
    expect(countOpen(html, "ul")).toBe(7);
    expect(countOpen(html, "ol")).toBe(0);
    expect(liElements(html)).toHaveLength(10);
    // ...and the 27 non-list paragraphs are still <p>s.
    expect(countOpen(html, "p")).toBe(27);
  });

  it("BACKWARD COMPATIBILITY: a model whose paragraphs have no `list` key at all renders exactly as today", async () => {
    // GREEN ON HEAD BY CONSTRUCTION -- disclosed as a fence, not as coverage.
    // Hand-built models are everywhere in this repo's existing tests
    // (htmlToPlainText.test.js's AC-C1.5 corpus, versionDiff's) and none of
    // them will ever carry `list`. If reading an absent key throws or emits a
    // stray wrapper, those suites break in files this seat does not own.
    const model = {
      paragraphs: [
        { runs: [{ text: "Header   " }], align: "center", spaceBeforePt: 0, spaceAfterPt: 4 },
        { runs: [], align: "left", spaceBeforePt: 0, spaceAfterPt: 4 },
      ],
    };
    const html = nonEmptyString(renderModelToHtml(model));
    expect(countOpen(html, "ul")).toBe(0);
    expect(countOpen(html, "ol")).toBe(0);
    expect(countOpen(html, "li")).toBe(0);
    expect(countOpen(html, "p")).toBe(2);
    expect(html).toBe(
      '<p style="text-align:center;margin:0pt 0 4pt;white-space:pre-wrap;"><span>Header   </span></p>' +
        '<p style="text-align:left;margin:0pt 0 4pt;white-space:pre-wrap;min-height:0.9em;"><br></p>',
    );
  });
});

// ===========================================================================
// SPACING REGRESSION -- the list wrapper must not inherit a browser default
// vertical margin. Owner-reported, diagnosed from the owner's own pasted
// document (Untitled document.docx): the position-header paragraph carries no
// spacing, the FIRST bullet of each run carries <w:spacing w:before="240"/>
// (12pt), the LAST carries w:after="240", and a single-bullet run carries
// both -- the signature of a block-level margin on the LIST WRAPPER, not
// per-item spacing. Cause: renderModelToHtml emitted a bare <ul>/<ol> with no
// inline style, so it inherited the browser default `margin: 1em 0`, which
// Word/Google Docs convert into that before/after spacing on the first and
// last items.
// ===========================================================================

describe("spacing regression: the list wrapper must not inherit a browser default vertical margin", () => {
  it("the <ul>/<ol> wrapper carries an explicit zero vertical margin", async () => {
    const model = await parseDocxToModel(
      await makeDocx(listP("Led migration", "1") + listP("Built CI pipeline", "1"), numbering({ 1: "bullet" })),
    );
    const html = nonEmptyString(renderModelToHtml(model));
    const openTag = (html.match(/<ul\b[^>]*>/) || [])[0];
    expect(openTag).toBeDefined();
    // Explicit `margin:0` -- not absent, and not left to the browser default
    // `margin: 1em 0` that produced the owner's w:before="240"/w:after="240"
    // signature.
    expect(openTag).toMatch(/style="[^"]*\bmargin:\s*0\b/);
  });

  it("the wrapper still sets an explicit horizontal padding, so bullet markers stay indented instead of sitting flush left", async () => {
    const model = await parseDocxToModel(await makeDocx(listP("Led migration", "1"), numbering({ 1: "bullet" })));
    const html = nonEmptyString(renderModelToHtml(model));
    const openTag = (html.match(/<ul\b[^>]*>/) || [])[0];
    const m = openTag.match(/padding-left:\s*([0-9.]+)px/);
    expect(m).not.toBeNull();
    expect(Number.parseFloat(m[1])).toBeGreaterThan(0);
  });

  it("a header paragraph immediately after a list still carries its OWN spacing -- the fix removes the wrapper's inherited default, not the next paragraph's explicit spaceBeforePt", async () => {
    const model = await parseDocxToModel(
      await makeDocx(
        listP("Bullet one", "1") +
          listP("Bullet two", "1") +
          '<w:p><w:pPr><w:spacing w:before="240"/></w:pPr><w:r><w:t>Next Job Title</w:t></w:r></w:p>',
        numbering({ 1: "bullet" }),
      ),
    );
    const html = nonEmptyString(renderModelToHtml(model));
    // ANTI-VACUITY: the corpus really does form one list ahead of the header.
    expect(countOpen(html, "ul")).toBe(1);
    const afterList = html.slice(html.indexOf("</ul>"));
    expect(afterList).toMatch(/<p style="[^"]*margin:12pt 0 0pt[^"]*"[^>]*>[\s\S]*Next Job Title/);
  });
});

// ===========================================================================
// SPACING REGRESSION CLASS GUARD -- every block-level element
// renderModelToHtml can emit must carry an EXPLICIT vertical margin, so a
// FUTURE new element cannot silently repeat this same defect by relying on a
// browser default the way the unstyled <ul>/<ol> did. Renders a model that
// exercises every element shape the renderer produces today: an ordinary
// paragraph, the empty-paragraph <br> placeholder, a list wrapper and a list
// item.
//
// WHAT THIS GUARD CAN CATCH: a block element whose inline style declares no
// `margin` (or no `margin-top`+`margin-bottom` pair) at all -- the exact
// shape of this regression, an unstyled element falling back to the
// browser's UA stylesheet.
// WHAT THIS GUARD CANNOT CATCH: an element that DOES declare a margin but
// declares the WRONG value (e.g. a <ul> shipped with `margin:8px 0` instead
// of `margin:0`). Value correctness for the list wrapper specifically is
// what the two rows above already pin; this guard only answers "explicit, or
// inherited".
// ===========================================================================

// True when `style` sets margin-top AND margin-bottom explicitly, whether via
// the `margin` shorthand or the two longhands together.
function hasExplicitVerticalMargin(style) {
  if (/\bmargin\s*:/.test(style)) return true;
  return /\bmargin-top\s*:/.test(style) && /\bmargin-bottom\s*:/.test(style);
}

// The exact extraction the guard runs against renderer output: every
// (p|ul|ol|li) open tag's style attribute, filtered down to the ones missing
// an explicit vertical margin. Factored out so the synthetic-corpus proof
// below and the real-corpus row after it exercise the SAME mechanism.
const scanForMissingMargin = (html) =>
  [...html.matchAll(/<(p|ul|ol|li)\b([^>]*)>/g)]
    .map((m) => ({ tag: m[1], style: (m[2].match(/style="([^"]*)"/) || [])[1] || "" }))
    .filter(({ style }) => !hasExplicitVerticalMargin(style));

describe("spacing regression class guard: no block element may inherit a browser-default margin", () => {
  it("harness control: the margin checker distinguishes explicit from inherited, and rejects a lone longhand", () => {
    // Synthetic style strings, not the renderer's own output -- proves the
    // checker function itself discriminates before it is ever pointed at real
    // markup. The last two rows are the "omits its margin" shape: a bare
    // style with no margin property at all, and one with only HALF the pair
    // set (a plausible near-miss a future author could actually write).
    expect(hasExplicitVerticalMargin("margin:0;padding-left:40px")).toBe(true);
    expect(hasExplicitVerticalMargin("margin-top:0;margin-bottom:4pt;color:red")).toBe(true);
    expect(hasExplicitVerticalMargin("padding-left:40px;white-space:pre-wrap")).toBe(false);
    expect(hasExplicitVerticalMargin("margin-top:0;white-space:pre-wrap")).toBe(false);
  });

  it("PROOF THE GUARD BITES on a NEW element, never on the <ul>/<li> this chunk just fixed: a hand-built corpus with an extra unstyled <p> the guard has never seen", () => {
    // Deliberately NOT run through renderModelToHtml or docxPreview.js --
    // this is a hand-built HTML string standing in for "a future author adds
    // another block-rendering branch and forgets the margin", exercised
    // through the identical scan the real-corpus row below uses. This is how
    // this seat proves the guard discriminates without editing the shared
    // source file to inject a mutant (forbidden: sabotaging source, even
    // temporarily, is a separate seat's job under its own hash-and-restore
    // protocol).
    const missingMargin =
      '<p style="margin:0">Styled paragraph</p>' +
      '<ul style="margin:0;padding-left:40px"><li style="margin:0">Styled item</li></ul>' +
      "<p>A brand-new block a future author adds, forgetting the margin</p>";
    expect(scanForMissingMargin(missingMargin)).toEqual([{ tag: "p", style: "" }]);

    // THE CONTROL: the same new block, styled correctly, passes -- so the row
    // above is measuring the missing margin and not merely "a second <p> in
    // the document".
    const allStyled =
      '<p style="margin:0">Styled paragraph</p>' +
      '<ul style="margin:0;padding-left:40px"><li style="margin:0">Styled item</li></ul>' +
      '<p style="margin:4pt 0 0">A brand-new block, done right</p>';
    expect(scanForMissingMargin(allStyled)).toEqual([]);
  });

  it("every block-level element the renderer emits (paragraph, empty-paragraph placeholder, list wrapper, list item) declares its own vertical margin", async () => {
    const model = await parseDocxToModel(
      await makeDocx(
        plainP("A heading") +
          "<w:p></w:p>" + // the empty-paragraph <br> placeholder
          listP("A bullet", "1") +
          listP("Another bullet", "1"),
        numbering({ 1: "bullet" }),
      ),
    );
    const html = nonEmptyString(renderModelToHtml(model));

    // ANTI-VACUITY: the corpus really does exercise all four shapes.
    expect(countOpen(html, "p")).toBe(2);
    expect(countOpen(html, "ul")).toBe(1);
    expect(liElements(html)).toHaveLength(2);

    const openTags = [...html.matchAll(/<(p|ul|ol|li)\b[^>]*>/g)];
    expect(openTags.length).toBe(5); // 2 <p> + 1 <ul> + 2 <li>

    expect(scanForMissingMargin(html)).toEqual([]);
  });
});

// ===========================================================================
// THE DOWNLOAD FENCE -- modelToLines must never learn about lists
// ===========================================================================
//
// This is the highest-consequence regression in the chunk, because the
// download is the one path that WORKS today. lib/document/docx.js rebuilds a
// .docx by replacing the TEXT of the uploaded template's paragraphs; the text
// it is given is modelToLines' output. So the moment modelToLines starts
// prefixing "\u2022 " to a list line, the downloaded .docx gets a LITERAL
// bullet character inside a paragraph that already carries <w:numPr> -- Word
// then renders its own bullet AND the typed one, and every ATS that parses the
// .docx reads the glyph as part of the achievement text.
//
// Each row below pairs the fence with an ANTI-VACUITY assertion that the
// corpus really is list-bearing. The fence itself is green on HEAD (nothing
// reads p.list yet); the anti-vacuity assertion is what makes these rows red
// today, and what stops them going quietly vacuous if `list` is ever dropped.

describe("N36 fence: the .docx download text is untouched by the list fix", () => {
  it("modelToLines returns the bullet text with NO marker and NO indent", async () => {
    const model = await parseDocxToModel(
      await makeDocx(listP("Led migration", "1") + listP("Built CI pipeline", "1") + plainP("Staff Engineer"), numbering({ 1: "bullet" })),
    );
    // ANTI-VACUITY: the corpus really is list-bearing (RED on HEAD).
    expect(model.paragraphs.filter((p) => p.list)).toHaveLength(2);

    const lines = modelToLines(model);
    expect(lines).toEqual(["Led migration", "Built CI pipeline", "Staff Engineer"]);
    for (const line of lines) {
      expect(line).not.toContain(BULLET);
      expect(line).not.toMatch(/^\s/);
      expect(line).not.toMatch(/^\d+[.)]\s/);
      expect(line).not.toContain("\t");
    }
  });

  it("modelToLines is byte-identical for a list-bearing model and the same model with every list stripped", async () => {
    const model = await parseDocxToModel(
      await makeDocx(listP("First step", "1") + listP("Second step", "1") + plainP("Notes"), numbering({ 1: "decimal" })),
    );
    // ANTI-VACUITY: the models really do differ in the `list` field, and the
    // list really is the ORDERED kind -- the one a naive implementation is
    // most tempted to number into the text (RED on HEAD).
    expect(model.paragraphs[0].list?.ordered).toBe(true);

    const stripped = { paragraphs: model.paragraphs.map((p) => ({ ...p, list: null })) };
    expect(modelToLines(model, { includeEmpty: true })).toEqual(modelToLines(stripped, { includeEmpty: true }));
    expect(modelToLines(model)).toEqual(["First step", "Second step", "Notes"]);
  });

  it("the REAL bundled template's derived lines carry no marker on any of its ten bullets", async () => {
    const model = await parseDocxToModel(await getDefaultTemplateBuffer());
    // ANTI-VACUITY (RED on HEAD): ten real list paragraphs are in this corpus.
    const bulletTexts = model.paragraphs.filter((p) => p.list).map((p) => p.runs.map((r) => r.text).join("").replace(/\s+$/g, ""));
    expect(bulletTexts).toHaveLength(10);

    const lines = modelToLines(model, { includeEmpty: true });
    expect(lines).toHaveLength(37);
    for (const text of bulletTexts) {
      // The derived line is the raw text, character for character.
      expect(lines).toContain(text);
    }
    expect(lines.join("\n")).not.toContain(BULLET);
    expect(lines.some((l) => /^\s/.test(l))).toBe(false);
  });
});
