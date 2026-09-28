// @vitest-environment jsdom
//
// N69 (SPACING) — the DOWNLOAD is the point: what the preview shows, the file
// must carry. This suite drives the REAL production download path,
// createDocumentDownloaders(...).downloadDocxFiles({ ..., spacing }), captures
// the produced .docx, and re-parses its bytes. Everything here is jsdom-safe:
// JSZip + DOMParser, never a measured height (N74).
//
// ===========================================================================
// THE DOWNLOAD-TRIGGER SEAM — read before touching the mock (checker F, "mock
// the RIGHT module").
// ===========================================================================
// downloadDocxFiles (docx.js) calls `triggerBlobDownload`, which docx.js
// IMPORTS from "./download.js" (docx.js:8) and merely RE-EXPORTS. So the module
// that must be mocked to intercept the produced blob is ./download.js. Mocking
// docx.js's re-export instead leaves the internal call bound to the real
// download.js — the mock records nothing, `capturedBlob()` is undefined, and
// every assertion below runs against nothing: a vacuous pass. The control in
// "harness" below (exactly one Blob captured per download) is what proves the
// mock is on the right module.
//
// RED-on-HEAD, in one line: no download arg named `spacing` exists, and
// resolveDocumentBlob applies no spacing (docx.js:548). A spacing-only download
// is served verbatim, so the produced doc carries the fixture's ORIGINAL
// spacing, never the values the user set. Every "spacing applied" assertion is
// therefore red until the sweep lands.

import { describe, it, expect, vi, beforeEach } from "vitest";
import JSZip from "jszip";

vi.mock("./download.js", () => ({ triggerBlobDownload: vi.fn() }));

import { triggerBlobDownload } from "./download.js";
import { createDocumentDownloaders, WORDPROCESSINGML_NS as NS } from "./docx.js";

// ---------------------------------------------------------------------------
// fixtures + harness
// ---------------------------------------------------------------------------

// A minimal .docx (base64) whose word/document.xml body is `bodyXml`, plus any
// extra parts, so structural-equivalence can assert the OTHER parts survive.
async function fixtureB64(bodyXml, extraParts = {}) {
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
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="${NS}"><w:body>${bodyXml}<w:sectPr><w:pgSz w:w="12240" w:h="15840"/><w:pgMar w:top="1440" w:bottom="1440"/></w:sectPr></w:body></w:document>`,
  );
  for (const [path, content] of Object.entries(extraParts)) zip.file(path, content);
  return zip.generateAsync({ type: "base64" });
}

// Drive the real résumé download path with a whole-document spacing override.
// Unedited + docxB64 => resolveDocumentBlob serves verbatim, and the plan's
// post-pass sweep is where the override must land. Returns the captured blob.
async function download(spacing, b64) {
  const { downloadDocxFiles } = createDocumentDownloaders({
    resumeFile: null,
    coverLetterFile: null,
    tailoringMap: {},
    applicationData: [],
  });
  const err = await downloadDocxFiles({
    jobTitle: "Staff Engineer",
    company: "Acme",
    result: "",
    resultLines: [],
    coverLetterResultLines: [],
    docxB64: b64,
    spacing, // <- ignored on HEAD; the field the sweep must honor
  });
  expect(err, `download returned an error: ${err}`).toBeFalsy();
  return capturedBlob();
}

function capturedBlob() {
  const calls = triggerBlobDownload.mock.calls;
  return calls.length ? calls[calls.length - 1][0] : undefined;
}

async function producedXml(blob) {
  const zip = await JSZip.loadAsync(await blob.arrayBuffer());
  return zip.file("word/document.xml").async("string");
}
async function producedZip(blob) {
  return JSZip.loadAsync(await blob.arrayBuffer());
}

function firstParagraph(xml) {
  const doc = new DOMParser().parseFromString(xml, "application/xml");
  return doc.getElementsByTagNameNS(NS, "p")[0];
}
function pPrOrder(pNode) {
  const pPr = pNode.getElementsByTagNameNS(NS, "pPr")[0];
  if (!pPr) return null;
  return Array.from(pPr.childNodes)
    .filter((n) => n.nodeType === 1)
    .map((n) => n.localName);
}
function spacingEl(pNode) {
  return pNode.getElementsByTagNameNS(NS, "spacing")[0] || null;
}
function textNodeValues(pNode) {
  return Array.from(pNode.getElementsByTagNameNS(NS, "t")).map((n) => n.textContent);
}
function brCount(pNode) {
  return pNode.getElementsByTagNameNS(NS, "br").length;
}

// The whole-document override the tests set. Documented OOXML mapping:
//   lineSpacing 1.5 (auto) -> w:line = round(1.5*240) = 360, w:lineRule="auto"
//   paragraphSpacingPt 12  -> w:after = round(12*20) = 240 twips, w:before=0
const OVERRIDE = { lineSpacing: 1.5, paragraphSpacingPt: 12 };

beforeEach(() => {
  triggerBlobDownload.mockClear();
});

// ---------------------------------------------------------------------------
// harness control — proves the RIGHT module is mocked (not a vacuous pass)
// ---------------------------------------------------------------------------
describe("harness", () => {
  it("captures exactly one Blob from the mocked ./download.js per download", async () => {
    const blob = await download(OVERRIDE, await fixtureB64(`<w:p><w:pPr><w:jc w:val="left"/></w:pPr><w:r><w:t>Body</w:t></w:r></w:p>`));
    // If ./download.js were not the mocked module, this would be 0 and every
    // re-parse below would assert against `undefined`.
    expect(triggerBlobDownload).toHaveBeenCalledTimes(1);
    expect(blob).toBeInstanceOf(Blob);
  });
});

// ---------------------------------------------------------------------------
// CB-D-1 — a spacing change reaches the produced .docx
// ---------------------------------------------------------------------------
describe("CB-D-1 — the set spacing values survive the real download", () => {
  const BODY = `<w:p><w:pPr><w:jc w:val="left"/></w:pPr><w:r><w:t>Body paragraph</w:t></w:r></w:p>`;

  it("POSITIVE CANARY: the re-parse reader really sees a known w:after (not blind)", async () => {
    // A hand-built doc that ALREADY carries w:after=240; prove the reader reports
    // it, so a later "== 240" assertion cannot pass by reading nothing.
    const b64 = await fixtureB64(`<w:p><w:pPr><w:spacing w:after="240"/></w:pPr><w:r><w:t>x</w:t></w:r></w:p>`);
    // Serve it verbatim (no override) and read it back.
    const blob = await download(null, b64);
    expect(spacingEl(firstParagraph(await producedXml(blob))).getAttribute("w:after")).toBe("240");
  });

  it("produced paragraph carries the set paragraph spacing AND line spacing (RED on HEAD)", async () => {
    const blob = await download(OVERRIDE, await fixtureB64(BODY));
    const xml = await producedXml(blob);
    const sp = spacingEl(firstParagraph(xml));
    expect(sp, "no <w:spacing> reached the produced paragraph").toBeTruthy();
    expect(sp.getAttribute("w:after")).toBe("240"); // 12pt
    expect(sp.getAttribute("w:line")).toBe("360"); // 1.5x
    expect(sp.getAttribute("w:lineRule")).toBe("auto");
  });

  it("NO-OP CONTROL: a download with no override does NOT invent the set values (must survive)", async () => {
    const blob = await download(null, await fixtureB64(BODY));
    const xml = await producedXml(blob);
    // The fixture carries no w:line and no w:after=240 of its own; a spacing-less
    // pass must leave it that way. This survives on HEAD and post-impl alike.
    expect(xml).not.toMatch(/w:line="360"/);
    expect(xml).not.toMatch(/w:after="240"/);
  });
});

// ---------------------------------------------------------------------------
// CB-D-2 — spacing-only is pPr-only; the soft break is preserved (N54 seam)
// ---------------------------------------------------------------------------
describe("CB-D-2 — a spacing-only change never corrupts a soft line break", () => {
  // The AC/plan fixture: a sign-off paragraph split by a <w:br> into two text
  // nodes. Its plain-text join is "Sincerely,Alex Shaw"; the model line the
  // text-rebuild would pass carries a newline ("Sincerely,\nAlex Shaw", len 20)
  // whose proportional re-slice across the [10,9] nodes SHIFTS the boundary
  // (verified in the TDD notes' scratchpad run) — so a mutant routing the
  // spacing write through setParagraphText corrupts node 0 to "Sincerely,\n".
  const BREAK_BODY = `<w:p><w:pPr><w:jc w:val="left"/></w:pPr><w:r><w:t>Sincerely,</w:t></w:r><w:r><w:br/></w:r><w:r><w:t>Alex Shaw</w:t></w:r></w:p>`;

  it("PRECONDITION: the fixture actually has the break and the two text nodes (else 'preserved' is vacuous)", async () => {
    // Serve verbatim, no override — this is the baseline the change must match.
    const blob = await download(null, await fixtureB64(BREAK_BODY));
    const p = firstParagraph(await producedXml(blob));
    expect(brCount(p)).toBe(1);
    expect(textNodeValues(p)).toEqual(["Sincerely,", "Alex Shaw"]);
  });

  it("after a spacing-only change: break intact, text nodes intact, AND spacing applied (RED on HEAD)", async () => {
    const blob = await download(OVERRIDE, await fixtureB64(BREAK_BODY));
    const p = firstParagraph(await producedXml(blob));
    // Break integrity — the mutant (setParagraphText route) fails HERE.
    expect(brCount(p)).toBe(1);
    expect(textNodeValues(p)).toEqual(["Sincerely,", "Alex Shaw"]);
    // ...while the spacing genuinely landed (this is the half that is red today).
    const sp = spacingEl(p);
    expect(sp, "spacing was not applied").toBeTruthy();
    expect(sp.getAttribute("w:after")).toBe("240");
  });
});

// ---------------------------------------------------------------------------
// F1 — the <w:spacing> element lands in a SCHEMA-VALID position
// ---------------------------------------------------------------------------
describe("F1 — pPr child order (the 'Word offers to repair this file' class)", () => {
  it("F1a: into an existing pPr, w:spacing goes BEFORE w:jc and w:rPr (RED on HEAD)", async () => {
    const body = `<w:p><w:pPr><w:jc w:val="center"/><w:rPr><w:b/></w:rPr></w:pPr><w:r><w:t>Hi</w:t></w:r></w:p>`;
    const p = firstParagraph(await producedXml(await download(OVERRIDE, await fixtureB64(body))));
    const order = pPrOrder(p);
    expect(order).toContain("spacing"); // red today: never inserted
    expect(order.indexOf("spacing")).toBeLessThan(order.indexOf("jc"));
    expect(order.indexOf("spacing")).toBeLessThan(order.indexOf("rPr"));
  });

  it("F1b: with NO pPr, a pPr is created as the FIRST child of the paragraph (RED on HEAD)", async () => {
    const body = `<w:p><w:r><w:t>Body</w:t></w:r></w:p>`;
    const p = firstParagraph(await producedXml(await download(OVERRIDE, await fixtureB64(body))));
    const firstEl = Array.from(p.childNodes).find((n) => n.nodeType === 1);
    expect(firstEl.localName).toBe("pPr");
    expect(spacingEl(p)).toBeTruthy();
  });

  it("F1c: an EXISTING w:spacing is replaced IN PLACE — one element, same position, new value (RED on HEAD)", async () => {
    const body = `<w:p><w:pPr><w:pStyle w:val="Body"/><w:spacing w:after="100"/><w:ind w:left="720"/></w:pPr><w:r><w:t>Body</w:t></w:r></w:p>`;
    const p = firstParagraph(await producedXml(await download(OVERRIDE, await fixtureB64(body))));
    const order = pPrOrder(p);
    // Exactly one spacing element (no duplicate appended).
    expect(order.filter((n) => n === "spacing")).toHaveLength(1);
    // Position preserved: still between pStyle and ind.
    expect(order).toEqual(["pStyle", "spacing", "ind"]);
    // Value replaced.
    expect(spacingEl(p).getAttribute("w:after")).toBe("240");
  });
});

// ---------------------------------------------------------------------------
// F2 — the order IS automatable: a jsdom lint over the produced file
// ---------------------------------------------------------------------------
describe("F2 — a pPr child-order lint, with a canary proving it discriminates", () => {
  // Subset of CT_PPr (ISO 29500) child order. `spacing` must precede ind,
  // contextualSpacing, jc, rPr, sectPr.
  const CT_PPR_ORDER = [
    "pStyle", "keepNext", "keepLines", "pageBreakBefore", "framePr", "widowControl",
    "numPr", "suppressLineNumbers", "pBdr", "shd", "tabs", "suppressAutoHyphens",
    "kinsoku", "wordWrap", "overflowPunct", "topLinePunct", "autoSpaceDE", "autoSpaceDN",
    "bidi", "adjustRightInd", "snapToGrid", "spacing", "ind", "contextualSpacing",
    "mirrorIndents", "suppressOverlap", "jc", "textDirection", "textAlignment",
    "textboxTightWrap", "outlineLvl", "divId", "cnfStyle", "rPr", "sectPr", "pPrChange",
  ];
  function orderIsValid(order) {
    let last = -1;
    for (const name of order) {
      const idx = CT_PPR_ORDER.indexOf(name);
      if (idx === -1) continue;
      if (idx < last) return false;
      last = idx;
    }
    return true;
  }
  const orderOf = (xml) => {
    const doc = new DOMParser().parseFromString(xml, "application/xml");
    const pPr = doc.getElementsByTagNameNS(NS, "pPr")[0];
    return Array.from(pPr.childNodes).filter((n) => n.nodeType === 1).map((n) => n.localName);
  };

  it("CANARY: the lint flags a KNOWN-BAD order and passes a KNOWN-GOOD one", () => {
    const bad = `<w:pPr xmlns:w="${NS}"><w:jc w:val="center"/><w:spacing w:after="200"/></w:pPr>`;
    const good = `<w:pPr xmlns:w="${NS}"><w:spacing w:after="200"/><w:jc w:val="center"/></w:pPr>`;
    expect(orderIsValid(orderOf(`<w:document xmlns:w="${NS}"><w:p>${bad}</w:p></w:document>`))).toBe(false);
    expect(orderIsValid(orderOf(`<w:document xmlns:w="${NS}"><w:p>${good}</w:p></w:document>`))).toBe(true);
  });

  it("the PRODUCED file passes the lint AND carries the spacing (RED on HEAD: spacing absent)", async () => {
    const body = `<w:p><w:pPr><w:jc w:val="center"/><w:rPr><w:b/></w:rPr></w:pPr><w:r><w:t>Hi</w:t></w:r></w:p>`;
    const xml = await producedXml(await download(OVERRIDE, await fixtureB64(body)));
    const order = orderOf(xml);
    expect(order).toContain("spacing"); // red today
    expect(orderIsValid(order)).toBe(true); // and a naive append-after-rPr impl fails here
  });
});

// ---------------------------------------------------------------------------
// F4 — an explicit value clears the automatic-spacing + line-count flags
// ---------------------------------------------------------------------------
describe("F4 — writing an explicit value clears afterAutospacing/beforeAutospacing and the *Lines counts", () => {
  it("the produced spacing element sets before/after/line and drops the auto flags (RED on HEAD)", async () => {
    // Word IGNORES an explicit w:after while w:afterAutospacing="1" is set — so
    // an implementation that only sets before/after is a SILENT no-op here.
    const body = `<w:p><w:pPr><w:spacing w:afterAutospacing="1" w:beforeAutospacing="1" w:beforeLines="100" w:afterLines="100" w:line="240" w:lineRule="atLeast"/></w:pPr><w:r><w:t>x</w:t></w:r></w:p>`;
    const sp = spacingEl(firstParagraph(await producedXml(await download(OVERRIDE, await fixtureB64(body)))));
    expect(sp.getAttribute("w:after")).toBe("240"); // explicit value written (red today)
    expect(sp.getAttribute("w:line")).toBe("360");
    expect(sp.getAttribute("w:lineRule")).toBe("auto");
    // ...and the flags that would make Word ignore it are gone.
    expect(sp.hasAttribute("w:afterAutospacing")).toBe(false);
    expect(sp.hasAttribute("w:beforeAutospacing")).toBe(false);
    expect(sp.hasAttribute("w:afterLines")).toBe(false);
    expect(sp.hasAttribute("w:beforeLines")).toBe(false);
  });
});

// ---------------------------------------------------------------------------
// Structural equivalence + the XML prolog (checker's lower-severity pins)
// ---------------------------------------------------------------------------
describe("structural equivalence — a spacing-only pass changes ONLY spacing", () => {
  const BODY =
    `<w:p><w:pPr><w:jc w:val="center"/><w:ind w:left="360"/></w:pPr>` +
    `<w:r><w:rPr><w:b/></w:rPr><w:t xml:space="preserve"> Lead </w:t></w:r>` +
    `<w:r><w:t>engineer</w:t></w:r></w:p>`;
  const EXTRA = { "word/settings.xml": `<?xml version="1.0"?><w:settings xmlns:w="${NS}"><w:zoom w:percent="100"/></w:settings>` };

  it("preserves the <?xml?> prolog of word/document.xml (RED on HEAD via the spacing assertion; guards the re-serialize prolog-drop)", async () => {
    const blob = await download(OVERRIDE, await fixtureB64(BODY, EXTRA));
    const xml = await producedXml(blob);
    expect(xml.startsWith("<?xml")).toBe(true); // guards n69prolog: XMLSerializer drops this
    const sp = spacingEl(firstParagraph(xml));
    expect(sp, "spacing was not applied").toBeTruthy(); // red today
    expect(sp.getAttribute("w:after")).toBe("240");
  });

  it("preserves runs, text nodes, the other pPr children, and other archive parts (RED on HEAD via spacing)", async () => {
    const blob = await download(OVERRIDE, await fixtureB64(BODY, EXTRA));
    const zip = await producedZip(blob);
    const xml = await zip.file("word/document.xml").async("string");
    const p = firstParagraph(xml);
    // Text nodes and their content untouched.
    expect(textNodeValues(p)).toEqual([" Lead ", "engineer"]);
    // Two runs still present.
    const doc = new DOMParser().parseFromString(xml, "application/xml");
    expect(doc.getElementsByTagNameNS(NS, "r")).toHaveLength(2);
    // The other pPr children survive alongside the new spacing.
    const order = pPrOrder(p);
    expect(order).toContain("jc");
    expect(order).toContain("ind");
    // The unrelated archive part is byte-identical.
    expect(await zip.file("word/settings.xml").async("string")).toBe(EXTRA["word/settings.xml"]);
    // ...and the change that makes this red today: spacing actually applied.
    const sp = spacingEl(p);
    expect(sp, "spacing was not applied").toBeTruthy();
    expect(sp.getAttribute("w:after")).toBe("240");
  });
});
