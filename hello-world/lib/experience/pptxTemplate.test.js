import { describe, it, expect } from "vitest";
import JSZip from "jszip";
import { inspectPptxTemplate } from "./pptxTemplate.js";

// pptxTemplate.js reads an uploaded .pptx with jszip and reports which slide
// layouts a renderer can use: their names, and which is usable as a title
// layout and a title-plus-content layout. Every fixture here is built with
// jszip in the test itself, so this needs no binary fixture file and stays
// readable as documentation of what a real .pptx part looks like.
//
// Layouts are selected BY NAME (the layout's own declared `type` attribute,
// or its human-readable <p:cSld name="...">), never by array index, with a
// documented fallback to the first available layout. The two "unusual
// template" and "not a pptx" / "corrupt zip" cases below exist specifically
// to prove that contract, not just the happy path.

const CONTENT_TYPES_PRESENTATION = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>
</Types>`;

function slideLayoutXml(name, type) {
  const typeAttr = type ? ` type="${type}"` : "";
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sldLayout xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"${typeAttr}>
  <p:cSld name="${name}">
    <p:spTree/>
  </p:cSld>
</p:sldLayout>`;
}

// Builds a synthetic .pptx zip with the given slide layouts (each
// { num, name, type }), returned as a Node Buffer ready to hand to
// inspectPptxTemplate.
async function buildPptxBuffer(layouts, { includeContentTypes = true, includePresentation = true } = {}) {
  const zip = new JSZip();
  if (includeContentTypes) zip.file("[Content_Types].xml", CONTENT_TYPES_PRESENTATION);
  if (includePresentation) zip.file("ppt/presentation.xml", "<p:presentation/>");
  for (const layout of layouts) {
    zip.file(`ppt/slideLayouts/slideLayout${layout.num}.xml`, slideLayoutXml(layout.name, layout.type));
  }
  return zip.generateAsync({ type: "nodebuffer" });
}

describe("inspectPptxTemplate", () => {
  it("reports every layout in a well-formed template, and picks the title and title+content layouts by name", async () => {
    const buffer = await buildPptxBuffer([
      { num: 1, name: "Title Slide", type: "title" },
      { num: 2, name: "Title and Content", type: "obj" },
      { num: 10, name: "Blank", type: "blank" },
    ]);

    const report = await inspectPptxTemplate(buffer, "Deck.pptx");

    expect(report.ok).toBe(true);
    expect(report.fileName).toBe("Deck.pptx");
    // Numeric filename order (1, 2, 10), not lexicographic (1, 10, 2).
    expect(report.layouts.map((l) => l.name)).toEqual(["Title Slide", "Title and Content", "Blank"]);
    expect(report.titleLayout).toMatchObject({ name: "Title Slide", type: "title" });
    expect(report.titleContentLayout).toMatchObject({ name: "Title and Content", type: "obj" });
  });

  it("falls back to the first available layout, by name/type not by index, for an unusually named template", async () => {
    // Neither layout is named or typed the way a default PowerPoint theme
    // names them. "Supporting Detail" is still usable as a content layout
    // because its declared `type` says so; nothing here claims to be a
    // title layout, so that one must fall back to the first layout in the
    // file rather than guessing an index.
    const buffer = await buildPptxBuffer([
      { num: 1, name: "Big Idea", type: "" },
      { num: 2, name: "Supporting Detail", type: "obj" },
    ]);

    const report = await inspectPptxTemplate(buffer, "Unusual.pptx");

    expect(report.ok).toBe(true);
    expect(report.titleContentLayout).toMatchObject({ name: "Supporting Detail" });
    // Fallback: first available layout, because nothing matched by name or type.
    expect(report.titleLayout).toMatchObject({ name: "Big Idea" });
  });

  it("names the file and the problem for a well-formed zip that is not a PowerPoint file at all", async () => {
    const zip = new JSZip();
    zip.file("hello.txt", "just a text file, not a deck");
    const buffer = await zip.generateAsync({ type: "nodebuffer" });

    const report = await inspectPptxTemplate(buffer, "notes.txt.zip");

    expect(report.ok).toBe(false);
    expect(report.error).toContain("notes.txt.zip");
    expect(report.error.toLowerCase()).toMatch(/powerpoint|pptx|content.types/);
  });

  it("names the file and the problem for a corrupt zip, rather than throwing something opaque", async () => {
    const garbage = Buffer.from([0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07, 0x08]);

    const report = await inspectPptxTemplate(garbage, "broken-upload.pptx");

    expect(report.ok).toBe(false);
    expect(report.error).toContain("broken-upload.pptx");
    expect(report.error.toLowerCase()).toMatch(/zip|corrupt/);
  });

  it("rejects a zip that merely has a path matching a slide layout's location but is not really a PowerPoint file", async () => {
    // A zip whose only resemblance to a .pptx is having *something* at
    // ppt/slideLayouts/slideLayout1.xml. It has a [Content_Types].xml (so
    // the "no content types at all" check does not fire), but that file
    // does not declare a presentation part, and there is no
    // ppt/presentation.xml either. Without the presentationml/presentation
    // checks, this would slip past the "has no layouts" guard (there IS a
    // matching path) and get reported as a usable template with a garbage
    // layout name.
    const zip = new JSZip();
    zip.file(
      "[Content_Types].xml",
      `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="xml" ContentType="application/xml"/>
</Types>`,
    );
    zip.file("ppt/slideLayouts/slideLayout1.xml", "not slide layout xml at all");
    const buffer = await zip.generateAsync({ type: "nodebuffer" });

    const report = await inspectPptxTemplate(buffer, "fake.pptx");

    expect(report.ok).toBe(false);
    expect(report.error).toContain("fake.pptx");
  });

  it("never throws for any of the malformed inputs above", async () => {
    const zip = new JSZip();
    zip.file("hello.txt", "not a deck");
    const notPptx = await zip.generateAsync({ type: "nodebuffer" });
    const garbage = Buffer.from([0xff, 0xd8, 0xff, 0x00]);

    await expect(inspectPptxTemplate(notPptx, "a.pptx")).resolves.toMatchObject({ ok: false });
    await expect(inspectPptxTemplate(garbage, "b.pptx")).resolves.toMatchObject({ ok: false });
  });

  it("unescapes an ampersand in a layout's display name rather than leaving XML entities in it", async () => {
    const buffer = await buildPptxBuffer([{ num: 1, name: "R&amp;D Overview", type: "" }]);

    const report = await inspectPptxTemplate(buffer, "Deck.pptx");

    expect(report.ok).toBe(true);
    expect(report.layouts[0].name).toBe("R&D Overview");
  });
});
