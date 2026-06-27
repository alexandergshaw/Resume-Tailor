import { describe, it, expect } from "vitest";
import JSZip from "jszip";
import {
  FIXED_ENTRY_DATE,
  loadDocx,
  scanPlaceholders,
  fillDocx,
  documentLines,
  findPlaceholders,
} from "./docxModel.js";

// Build a minimal .docx whose body is the given paragraph XML.
async function makeDocx(bodyXml) {
  const zip = new JSZip();
  const date = FIXED_ENTRY_DATE;
  zip.file(
    "[Content_Types].xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/></Types>`,
    { date },
  );
  zip.file(
    "_rels/.rels",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/></Relationships>`,
    { date },
  );
  zip.file(
    "word/document.xml",
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body>${bodyXml}</w:body></w:document>`,
    { date },
  );
  return zip.generateAsync({ type: "nodebuffer" });
}

const para = (runs) => `<w:p>${runs}</w:p>`;
const run = (text, rPr = "") => `<w:r>${rPr}<w:t>${text}</w:t></w:r>`;
const SKILLS = para(run("{{SKILLS_LINE}}"));

describe("scanPlaceholders", () => {
  it("finds a placeholder split across three runs and a 5x-repeated placeholder", async () => {
    // {{ | NAME | }} across three runs, then five identical skills lines.
    const splitName = para(
      run("{{", "<w:rPr><w:b/></w:rPr>") + run("NAME") + run("}}"),
    );
    const doc = await loadDocx(await makeDocx(splitName + SKILLS.repeat(5)));
    const slots = scanPlaceholders(doc);

    expect(slots.map((s) => s.key)).toContain("NAME::0");
    expect(
      slots.filter((s) => s.name === "SKILLS_LINE").map((s) => s.occurrence),
    ).toEqual([0, 1, 2, 3, 4]);
  });

  it("normalizes messy placeholder names", async () => {
    const doc = await loadDocx(
      await makeDocx(para(run("{{Role-Specific Expertise }}"))),
    );
    expect(scanPlaceholders(doc)[0].name).toBe("ROLE_SPECIFIC_EXPERTISE");
  });
});

describe("fillDocx", () => {
  it("fills across runs, gives the 5 repeated slots distinct values, preserves run-0 formatting, and re-scans clean", async () => {
    const splitName = para(
      run("{{", "<w:rPr><w:b/></w:rPr>") + run("NAME") + run("}}"),
    );
    const doc = await loadDocx(await makeDocx(splitName + SKILLS.repeat(5)));

    fillDocx(doc, {
      "NAME::0": "Ada Lovelace",
      "SKILLS_LINE::0": "Alpha",
      "SKILLS_LINE::1": "Beta",
      "SKILLS_LINE::2": "Gamma",
      "SKILLS_LINE::3": "Delta",
      "SKILLS_LINE::4": "Epsilon",
    });

    // Every filled placeholder is gone.
    expect(scanPlaceholders(doc)).toHaveLength(0);

    // The five repeated slots received five different values.
    const lines = documentLines(doc);
    const skillValues = ["Alpha", "Beta", "Gamma", "Delta", "Epsilon"];
    expect(lines.filter((l) => skillValues.includes(l)).sort()).toEqual(
      [...skillValues].sort(),
    );

    // Run-0 (the bold run that held "{{") keeps its formatting and the value.
    expect(doc.parts[0].xml).toContain(
      '<w:rPr><w:b/></w:rPr><w:t xml:space="preserve">Ada Lovelace</w:t>',
    );
  });

  it("leaves a placeholder visible when its value is empty (unfilled)", async () => {
    const doc = await loadDocx(await makeDocx(para(run("{{FULL_NAME}}"))));
    fillDocx(doc, { "FULL_NAME::0": "" });
    expect(scanPlaceholders(doc).map((s) => s.key)).toContain("FULL_NAME::0");
  });

  it("handles two placeholders sharing one run", async () => {
    const doc = await loadDocx(await makeDocx(para(run("{{A}} and {{B}}"))));
    fillDocx(doc, { "A::0": "X", "B::0": "Y" });
    expect(documentLines(doc)).toEqual(["X and Y"]);
  });
});

describe("documentLines", () => {
  it("splits a paragraph's soft line breaks (<w:br/>) into separate lines", async () => {
    const signoff = `<w:p><w:r><w:t>Sincerely,</w:t><w:br w:type="textWrapping"/><w:t>Alex Shaw</w:t></w:r></w:p>`;
    const doc = await loadDocx(await makeDocx(signoff));
    expect(documentLines(doc)).toEqual(["Sincerely,", "Alex Shaw"]);
  });

  it("keeps a break-free paragraph as a single line", async () => {
    const doc = await loadDocx(await makeDocx(para(run("One paragraph, one line."))));
    expect(documentLines(doc)).toEqual(["One paragraph, one line."]);
  });
});

describe("findPlaceholders", () => {
  it("matches a cautious single-brace Title Case token", () => {
    const spans = findPlaceholders("Concentration: {Area of Emphasis}");
    expect(spans).toHaveLength(1);
    expect(spans[0].singleBrace).toBe(true);
  });

  it("ignores non-Title-Case single braces and does not double-count {{ }}", () => {
    expect(findPlaceholders("value {0} and {x}")).toHaveLength(0);
    const dbl = findPlaceholders("{{NAME}}");
    expect(dbl).toHaveLength(1);
    expect(dbl[0].singleBrace).toBe(false);
  });
});
