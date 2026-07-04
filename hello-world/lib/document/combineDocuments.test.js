import { describe, it, expect } from "vitest";
import { combinedDocumentXml, combinedHtml } from "./combineDocuments.js";

const resume = {
  paragraphs: [
    { runs: [{ text: "Alex Shaw", bold: true, sizePt: 16 }], align: "center", spaceAfterPt: 4 },
    { runs: [{ text: "Senior Software Engineer", italic: true }], align: "left", spaceAfterPt: 2 },
  ],
};
const cover = {
  paragraphs: [
    { runs: [{ text: "Dear Hiring Committee,", underline: true }], align: "left", spaceAfterPt: 6 },
    { runs: [{ text: "Line one\nLine two after a break", color: "#FF0000" }], align: "left" },
  ],
};

describe("combinedDocumentXml", () => {
  const xml = combinedDocumentXml([resume, cover]);

  it("includes both documents' text", () => {
    expect(xml).toContain("Alex Shaw");
    expect(xml).toContain("Senior Software Engineer");
    expect(xml).toContain("Dear Hiring Committee,");
    expect(xml).toContain("Line one");
    expect(xml).toContain("Line two after a break");
  });

  it("inserts exactly one page break between the two documents", () => {
    const breaks = xml.match(/<w:br w:type="page"\/>/g) || [];
    expect(breaks).toHaveLength(1);
    // The break falls between the résumé and the cover letter.
    expect(xml.indexOf("Senior Software Engineer")).toBeLessThan(xml.indexOf('w:type="page"'));
    expect(xml.indexOf('w:type="page"')).toBeLessThan(xml.indexOf("Dear Hiring Committee,"));
  });

  it("carries run formatting, alignment, and a soft break", () => {
    expect(xml).toContain("<w:b/>"); // bold name
    expect(xml).toContain("<w:i/>"); // italic title
    expect(xml).toContain('<w:u w:val="single"/>'); // underlined salutation
    expect(xml).toContain('<w:sz w:val="32"/>'); // 16pt -> 32 half-points
    expect(xml).toContain('<w:color w:val="FF0000"/>'); // color, '#' stripped
    expect(xml).toContain('<w:jc w:val="center"/>'); // centered name
    expect(xml).toContain("<w:br/>"); // the \n soft line break
  });

  it("is well-formed enough to have matching body tags and a sectPr", () => {
    expect(xml).toContain("<w:body>");
    expect(xml).toContain("</w:body>");
    expect(xml).toContain("<w:sectPr>");
  });
});

describe("combinedHtml", () => {
  it("renders one page-broken section per document with the title", () => {
    const html = combinedHtml([resume, cover], { title: "Initech - Staff Engineer - Application" });
    expect(html).toContain("<title>Initech - Staff Engineer - Application</title>");
    expect((html.match(/class="doc"/g) || []).length).toBe(2);
    expect(html).toContain("page-break-before: always");
    expect(html).toContain("Alex Shaw");
    expect(html).toContain("Dear Hiring Committee,");
  });
});
