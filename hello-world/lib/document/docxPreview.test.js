import { describe, it, expect } from "vitest";
import JSZip from "jszip";
import { parseDocxToModel, modelToLines, linesToModel, renderModelToHtml } from "./docxPreview.js";
import { getDefaultTemplateBuffer } from "@/lib/llm/engines/tailor-lite/defaultTemplate.js";
import { getCoverLetterTemplateBuffer } from "@/lib/llm/engines/tailor-lite/coverLetterTemplate.js";

describe("parseDocxToModel (bundled résumé template)", () => {
  it("captures formatting that matches the document", async () => {
    const model = await parseDocxToModel(await getDefaultTemplateBuffer());
    expect(model.paragraphs.length).toBeGreaterThan(10);

    const runs = model.paragraphs.flatMap((p) => p.runs);
    // The header name is centered.
    expect(model.paragraphs.some((p) => p.align === "center")).toBe(true);
    // Section headings are bold.
    expect(runs.some((r) => r.bold)).toBe(true);
    // The three template sizes (half-pt 26/22/16 => 13/11/8 pt).
    const sizes = new Set(runs.map((r) => r.sizePt).filter(Boolean));
    expect(sizes.has(13)).toBe(true);
    expect(sizes.has(8)).toBe(true);
  });

  it("renderModelToHtml carries the formatting into styled HTML", async () => {
    const html = renderModelToHtml(await parseDocxToModel(await getDefaultTemplateBuffer()));
    expect(html).toMatch(/font-weight:700/); // bold headings/name
    expect(html).toMatch(/font-size:13pt/); // name
    expect(html).toMatch(/font-size:8pt/); // contact line
    expect(html).toMatch(/text-align:center/); // centered header
  });

  it("modelToLines returns the section headings in order", async () => {
    const model = await parseDocxToModel(await getDefaultTemplateBuffer());
    const lines = modelToLines(model);
    for (const heading of ["Summary", "Education", "Professional Experience", "Skills"]) {
      expect(lines).toContain(heading);
    }
  });
});

describe("linesToModel", () => {
  it("renders plain text lines as left-aligned paragraphs", () => {
    const model = linesToModel(["Alex Shaw", "", "Senior Engineer"]);
    expect(model.paragraphs).toHaveLength(3);
    expect(model.paragraphs[0].runs[0].text).toBe("Alex Shaw");
    expect(model.paragraphs[1].runs).toHaveLength(0); // blank line
    expect(modelToLines(model)).toEqual(["Alex Shaw", "Senior Engineer"]);
  });
});

// ===========================================================================
// AC-C17 -- runText's TOKEN_RE must match a <w:br>/<w:tab> WITH ATTRIBUTES
// ===========================================================================
//
// Why this is in the "copy the document text" chunk: it is a second,
// independent screen-vs-document divergence on the exact path the clipboard is
// bound to. Without it the copied string contains "Sincerely,Alex Shaw" -- a
// FUSED SIGN-OFF in every cover letter pasted into an ATS. It also fixes a
// visible rendering bug shipping today.
//
// AN HONESTY NOTE ABOUT THE THREE TESTS ABOVE, so their green is not mistaken
// for coverage of this change: the bundled RESUME template -- the fixture for
// three of this file's four original `it`s -- carries ZERO <w:br> of any kind
// (bare, attributed or page) and ZERO <w:tab> across its 37 paragraphs, and
// the old and new regexes both find zero non-<w:t> tokens in it. Not one of
// those rows could have failed either way. The cover-letter template, which
// carries exactly one attribute-bearing <w:br w:type="textWrapping"/>, was
// parsed by no test in this file before these.

// A minimal .docx whose body is the given paragraph XML -- the same shape
// lib/llm/engines/tailor-lite/docxModel.test.js's makeDocx builds.
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
  zip.file(
    "word/document.xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${bodyXml}</w:body></w:document>`,
  );
  return zip.generateAsync({ type: "nodebuffer" });
}

describe("AC-C17: soft line breaks with attributes (the shipped cover letter's sign-off)", () => {
  it("splits <w:br w:type=\"textWrapping\"/> into a newline, like the bare <w:br/> form", async () => {
    // Corpus: a minimal single-paragraph fixture mirroring docxModel.test.js's
    // "splits a paragraph's soft line breaks (<w:br/>) into separate lines",
    // with the ATTRIBUTE-BEARING form the cover-letter template actually
    // ships. Only a TEMPLATE-AUTHORED break can carry attributes: fillDocx's
    // valueToInnerXml can only ever emit the bare '<w:br/>' form, which the
    // current regex already matches -- which is why no filled resume can
    // reach this row.
    const signoff = '<w:p><w:r><w:t>Sincerely,</w:t><w:br w:type="textWrapping"/><w:t>Alex Shaw</w:t></w:r></w:p>';
    const model = await parseDocxToModel(await makeDocx(signoff));
    expect(model.paragraphs).toHaveLength(1);
    expect(model.paragraphs[0].runs[0].text).toBe("Sincerely,\nAlex Shaw");
  });

  it("splits the REAL cover-letter template's sign-off, on all four shipped variants", async () => {
    // Corpus: getCoverLetterTemplateBuffer({variant}) for each of the four
    // variants. Measured: each is 14 paragraphs with exactly ONE
    // attribute-bearing <w:br w:type="textWrapping"/>, zero bare <w:br/>,
    // zero <w:tabs>, and the sign-off is array entry 12 -- the literal string
    // "Sincerely,Alex Shaw" today. "Alex Shaw" is a template literal here,
    // not a placeholder, so the RAW buffer needs no fill pipeline.
    for (const variant of ["teaching", "industry", "staff", "nontechnical"]) {
      const model = await parseDocxToModel(await getCoverLetterTemplateBuffer({ variant }));
      const lines = modelToLines(model, { includeEmpty: true });

      // AC-C17.2 -- THE UNITS. The array is 14 entries BEFORE AND AFTER this
      // fix: the soft break becomes an embedded "\n" INSIDE entry 12, it does
      // not add an entry. An author writing `expect(lines).toHaveLength(15)`
      // gets RED against correct code, so the length assertion is stated as
      // the control it is and the real assertion is on the joined string.
      expect(lines).toHaveLength(14);
      expect(lines[12]).toBe("Sincerely,\nAlex Shaw");
      expect(lines.join("\n")).toContain("Sincerely,\nAlex Shaw");

      // ...AND THE SECOND ASSERTION IS NOT A DUPLICATE OF THE FIRST. This
      // exact array -- modelToLines(model, {includeEmpty:true}) -- is the
      // THIRD ARGUMENT app/hooks/useDocumentPreview.js's loadPreviewModel
      // hands markVersionChanges, i.e. the version-HIGHLIGHT diff's input.
      // That file has ZERO addable lines against its own ceiling, so the
      // behaviour change is pinned here, where it is free.
      //
      // What it shows: the sign-off arrives as ONE array entry carrying an
      // embedded newline, while a stored version's `content.split("\n")`
      // supplies TWO entries for the same two lines -- so the sign-off
      // paragraph is misaligned against history BOTH BEFORE AND AFTER this
      // fix. Recorded, not fixed here.
      expect(lines.join("\n").split("\n")).toHaveLength(15);
      expect(lines[12].split("\n")).toHaveLength(2);
    }
  });

  it("renders the split sign-off as ONE paragraph carrying a newline, not two paragraphs", async () => {
    // The screen consequence: white-space:pre-wrap turns the embedded "\n"
    // into a visible line break inside a single <p>, which is what makes the
    // preview match the document -- and what makes htmlToPlainText's T2 row
    // reproduce it on the clipboard.
    const signoff = '<w:p><w:r><w:t>Sincerely,</w:t><w:br w:type="textWrapping"/><w:t>Alex Shaw</w:t></w:r></w:p>';
    const html = renderModelToHtml(await parseDocxToModel(await makeDocx(signoff)));
    expect(html).toContain("white-space:pre-wrap");
    expect(html).toContain("Sincerely,\nAlex Shaw");
    expect(html.match(/<p\b/g)).toHaveLength(1);
  });

  it("splits <w:tab w:val=\"...\"/> into a TAB, like the bare <w:tab/> form", async () => {
    // THE OTHER HALF OF THE SAME ONE-LINE REGEX EDIT. Every row above and
    // below exercises only the `<w:br>` alternative, so reverting the `<w:tab>`
    // one -- back to a pattern that matches the bare form only -- is invisible
    // to all three copy suites: the token simply stops matching, the tab
    // contributes nothing, and "A\tB" silently becomes "AB".
    //
    // Why a lost tab costs an application: in an uploaded resume a tab is a
    // COLUMN boundary, the one that separates a role from its dates on a
    // right-aligned line. Losing it fuses "Senior Engineer" and "2019-2023"
    // into a single token, which an ATS parser reads as neither a title nor a
    // date -- the same class of harm as the fused sign-off, on the same
    // clipboard path.
    //
    // Only a TEMPLATE-AUTHORED tab can carry attributes -- fillDocx's
    // valueToInnerXml can only ever emit the bare '<w:tab/>' form -- which is
    // why no bundled fixture in this file reaches this row, and why it needs
    // its own hand-built corpus.
    const tabbed = '<w:p><w:r><w:t>A</w:t><w:tab w:val="x"/><w:t>B</w:t></w:r></w:p>';
    const model = await parseDocxToModel(await makeDocx(tabbed));
    expect(model.paragraphs).toHaveLength(1);
    expect(model.paragraphs[0].runs[0].text).toBe("A\tB");

    // POSITIVE CONTROL: the BARE form, which the pre-change pattern already
    // matched, still produces the same tab -- so the row above is about the
    // ATTRIBUTES and not about tabs in general, and a regex that dropped the
    // `<w:tab>` alternative entirely fails both halves rather than one.
    const bare = await parseDocxToModel(await makeDocx("<w:p><w:r><w:t>A</w:t><w:tab/><w:t>B</w:t></w:r></w:p>"));
    expect(bare.paragraphs[0].runs[0].text).toBe("A\tB");
  });

  it("NEGATIVE: a w:pPr tab-stop list never reaches the run text", async () => {
    // The safety argument is NOT the word boundary -- measured, the new
    // pattern DOES match `<w:tab w:val="left" w:pos="720"/>` where the old one
    // did not. The safety argument is the CALL GRAPH: tab stops live inside
    // <w:pPr>, runText is reached only from parseRun, and parseRun is called
    // only on RUN_RE (<w:r>...</w:r>) matches -- so a tab-stop child is never
    // in a string runText sees.
    //
    // Green before and after on purpose: it is the regression guard on that
    // call graph, and it is what would go red if a future change ever widened
    // runText's input to the whole paragraph.
    const withTabStops =
      '<w:p><w:pPr><w:tabs><w:tab w:val="left" w:pos="720"/><w:tab w:val="right" w:pos="9360"/></w:tabs></w:pPr>' +
      "<w:r><w:t>Education</w:t></w:r></w:p>";
    const model = await parseDocxToModel(await makeDocx(withTabStops));
    expect(modelToLines(model, { includeEmpty: true })).toEqual(["Education"]);
    expect(model.paragraphs[0].runs[0].text).not.toContain("\t");
  });

  it("NEGATIVE: <w:brk/> is not a line break", async () => {
    // Word-boundary check on the prefix: `<w:br` followed by `k` is not a
    // boundary, so an unrelated element whose name merely starts with "br"
    // must not become a newline. Green before and after.
    const model = await parseDocxToModel(await makeDocx("<w:p><w:r><w:t>A</w:t><w:brk/><w:t>B</w:t></w:r></w:p>"));
    expect(model.paragraphs[0].runs[0].text).toBe("AB");
  });

  it("a page break leaves the derived line array unchanged, under either ruling", async () => {
    // <w:br w:type="page"/> goes from 0 matches to 1 under the widened
    // pattern, and lib/document/combineDocuments.js's PAGE_BREAK_PARAGRAPH
    // emits exactly that string. modelToLines is unaffected either way,
    // because "\n".replace(/\s+$/g,"") is "" -- so the derived lines, the
    // download text and the stored version rows all see the same array.
    //
    // What is NOT pinned here, deliberately: whether the page-break run
    // should contribute a newline at all. It reaches the CLIPBOARD through
    // renderModelToHtml (a page break would add one blank line the user did
    // not author), no bundled template contains one, and the alternative --
    // special-casing w:type="page" to contribute nothing -- is a reviewer's
    // decision, not a test author's. Manual check MC-7 covers it: upload a
    // .docx containing a page break, preview, copy, and confirm the paste
    // gains no extra blank line.
    const body =
      "<w:p><w:r><w:t>RESUME LAST LINE</w:t></w:r></w:p>" +
      '<w:p><w:r><w:br w:type="page"/></w:r></w:p>' +
      "<w:p><w:r><w:t>COVER FIRST LINE</w:t></w:r></w:p>";
    const model = await parseDocxToModel(await makeDocx(body));
    expect(model.paragraphs).toHaveLength(3);
    expect(modelToLines(model, { includeEmpty: true })).toEqual(["RESUME LAST LINE", "", "COVER FIRST LINE"]);
  });
});
