// N69 (SPACING) — parse + per-paragraph render of LINE spacing, and the
// list-item / source-fidelity guards, against the REAL docxPreview.js.
//
// SCOPE (owner ruling 2026-09-27/28): whole-document line + paragraph spacing.
// The overflow indicator (capability a) is DEFERRED and out of scope.
//
// Env: default "node". docxPreview.js is a regex/string model (no DOMParser),
// so every assertion here is on a returned STRING or a parsed model field —
// jsdom does no layout, and NONE of these need it (N74). We assert the value
// the code SETS, never a measured height.
//
// Instruments and why each lands RED on HEAD:
//   CB-L-1  parseParagraph reads <w:spacing w:before/after> today but NOT
//           <w:line/w:lineRule> (docxPreview.js:160-161) -> model.lineSpacing
//           is undefined. RED for the present-case; the absent-case is the
//           anti-"hardcode 1.5" companion (green today, stated).
//   CB-L-2  renderParagraphHtml (docxPreview.js:249) emits margin + text-align
//           + white-space, NO line-height. The single line-height in the app
//           is hardcoded on the dialog's pageSx (DocumentPreviewDialog.js:73),
//           not per-paragraph. RED.
//   CB-P-2  (invariant half) renderListItemHtml (:265) hardcodes margin:0 and
//           the override never runs here -> with NO override a list item keeps
//           margin:0. Green today; the guard that a future line/para feature
//           does not silently override the source default. The APPLY half of
//           CB-P-2 (override reaches <li>) is driven through the real control
//           in DocumentPreviewDialog.spacing.test.js.
//   CB-R-1  source paragraph spacing round-trips unchanged when the user sets
//           nothing. Green today; stated so a spacing feature cannot silently
//           overwrite source values.

import { describe, it, expect } from "vitest";
import JSZip from "jszip";
import { parseDocxToModel, renderModelToHtml } from "./docxPreview.js";

// A minimal .docx whose body is the given paragraph XML — the makeDocx shape
// docxPreview.test.js:71 and docxModel.test.js already use.
async function makeDocxBuffer(bodyXml) {
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
  return zip.generateAsync({ type: "uint8array" });
}

const P_WITH_LINE = (line, rule) =>
  `<w:p><w:pPr><w:spacing w:line="${line}" w:lineRule="${rule}"/></w:pPr><w:r><w:t>Body text</w:t></w:r></w:p>`;
const P_NO_LINE = `<w:p><w:pPr><w:spacing w:after="120"/></w:pPr><w:r><w:t>Body text</w:t></w:r></w:p>`;

describe("CB-L-1 — parseDocxToModel reads w:line/w:lineRule into the model", () => {
  it("PRESENT: w:line=360 w:lineRule=auto parses to a 1.5x line spacing (RED on HEAD: field is undefined)", async () => {
    const model = await parseDocxToModel(await makeDocxBuffer(P_WITH_LINE(360, "auto")));
    const p = model.paragraphs[0];
    // auto line spacing is a MULTIPLIER: w:line / 240 (240 = single). 360/240 = 1.5.
    expect(p.lineSpacing).toBe(1.5);
    // The rule must be captured too — a value of 360 means 1.5x under "auto"
    // but 18pt under "exact"/"atLeast"; dropping the rule loses that.
    expect(p.lineRule).toBe("auto");
  });

  it("ABSENT: a paragraph with no w:line gets the documented default, NOT a hardcoded 1.5 (anti-vacuity companion)", async () => {
    const model = await parseDocxToModel(await makeDocxBuffer(P_NO_LINE));
    const p = model.paragraphs[0];
    // The default is "unset" — the renderer supplies the current 1.3 (CB-R-1).
    // The load-bearing part is that it is NOT 1.5: a parser that hardcodes the
    // present-case value would pass the test above and fail here.
    expect(p.lineSpacing == null).toBe(true);
  });

  it("PRESENT vs ABSENT genuinely differ (the discriminator)", async () => {
    const present = (await parseDocxToModel(await makeDocxBuffer(P_WITH_LINE(480, "auto")))).paragraphs[0];
    const absent = (await parseDocxToModel(await makeDocxBuffer(P_NO_LINE))).paragraphs[0];
    // 480/240 = 2.0 (double). Must differ from the absent default.
    expect(present.lineSpacing).toBe(2);
    expect(present.lineSpacing).not.toBe(absent.lineSpacing ?? null);
  });
});

describe("CB-L-2 — renderModelToHtml renders line spacing as per-<p> inline line-height", () => {
  const modelWith = (lineSpacing) => ({
    paragraphs: [
      {
        runs: [{ text: "Body", bold: false, italic: false, underline: false, sizePt: null, color: null }],
        align: "left",
        spaceBeforePt: 0,
        spaceAfterPt: 0,
        lineSpacing,
        lineRule: "auto",
        list: null,
      },
    ],
  });

  it("puts the model's line-height ON the <p> and MOVES with the value (RED on HEAD: no per-paragraph line-height)", () => {
    const html15 = renderModelToHtml(modelWith(1.5));
    const html20 = renderModelToHtml(modelWith(2));
    // Value, not mere presence: "line-height present" would be satisfied by the
    // container's hardcoded 1.3, so assert the number and that it moves.
    expect(html15).toMatch(/line-height:\s*1\.5\b/);
    expect(html20).toMatch(/line-height:\s*2\b/);
    expect(html15).not.toEqual(html20);
    // It must be inline on the paragraph the browser will lay out.
    expect(html15).toMatch(/<p[^>]*style="[^"]*line-height:\s*1\.5/);
  });
});

describe("CB-P-2 (invariant) + CB-R-1 — no override leaves source defaults untouched", () => {
  it("a list item with no override keeps margin:0 (renderListItemHtml:265) — the source-fidelity default", () => {
    const model = {
      paragraphs: [
        {
          runs: [{ text: "Bullet one", bold: false, italic: false, underline: false, sizePt: null, color: null }],
          align: "left",
          spaceBeforePt: 0,
          spaceAfterPt: 0,
          list: { numId: "1", ilvl: 0, ordered: false },
        },
      ],
    };
    const html = renderModelToHtml(model);
    expect(html).toMatch(/<li style="margin:0;/);
  });

  it("a source paragraph's own spaceAfterPt round-trips into the rendered margin (CB-R-1 guard)", () => {
    const model = {
      paragraphs: [
        {
          runs: [{ text: "Header", bold: true, italic: false, underline: false, sizePt: null, color: null }],
          align: "left",
          spaceBeforePt: 0,
          spaceAfterPt: 6,
          list: null,
        },
      ],
    };
    // Green today and must stay green: the source's 6pt bottom margin survives.
    expect(renderModelToHtml(model)).toMatch(/margin:0pt 0 6pt/);
  });
});
