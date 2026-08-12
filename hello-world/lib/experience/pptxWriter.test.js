import { describe, it, expect } from "vitest";
import JSZip from "jszip";
import { buildDeck } from "./pptxWriter.js";

// Writes the .pptx: takes a deck outline (lib/experience/deckOutline.js) plus an
// optional uploaded template, and produces a zip.
//
// The whole reason this is hand-rolled over jszip rather than done with a deck
// library is the template. pptxgenjs defines masters in JavaScript and cannot
// inherit an arbitrary uploaded deck's theme and layouts, so using it would
// quietly deliver "a deck" instead of "a deck that follows my template" - which
// is the entire request. These tests exist to hold that distinction, so the
// central assertion is that the template's own parts come through UNTOUCHED and
// the new slides REFERENCE them rather than restating them.
//
// Every fixture is built with jszip here in the test, so this needs no binary
// fixture checked into the repo.

const CONTENT_TYPES = `<?xml version="1.0" encoding="UTF-8"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/>
</Types>`;

const THEME_XML = `<?xml version="1.0"?><a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="BrandTheme"><a:themeElements/></a:theme>`;

function layoutXml(name, type) {
  return `<?xml version="1.0"?><p:sldLayout xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" type="${type}"><p:cSld name="${name}"/></p:sldLayout>`;
}

async function templateZip({ extraContentTypes = "" } = {}) {
  const zip = new JSZip();
  const contentTypes = extraContentTypes
    ? CONTENT_TYPES.replace("</Types>", `${extraContentTypes}</Types>`)
    : CONTENT_TYPES;
  zip.file("[Content_Types].xml", contentTypes);
  zip.file("_rels/.rels", `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="ppt/presentation.xml"/></Relationships>`);
  zip.file("ppt/presentation.xml", `<?xml version="1.0"?><p:presentation xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:sldIdLst/></p:presentation>`);
  zip.file("ppt/_rels/presentation.xml.rels", `<?xml version="1.0"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="slideMasters/slideMaster1.xml"/></Relationships>`);
  zip.file("ppt/theme/theme1.xml", THEME_XML);
  zip.file("ppt/slideMasters/slideMaster1.xml", `<?xml version="1.0"?><p:sldMaster xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"/>`);
  zip.file("ppt/slideLayouts/slideLayout1.xml", layoutXml("Title Slide", "title"));
  zip.file("ppt/slideLayouts/slideLayout2.xml", layoutXml("Title and Content", "obj"));
  return zip.generateAsync({ type: "uint8array" });
}

const OUTLINE = [
  { kind: "title", title: "Payments migration" },
  { kind: "content", title: "What changed", bullets: ["Dropped the legacy processor", "Cut settlement to a day"] },
];

async function open(bytes) {
  return JSZip.loadAsync(bytes);
}

const slidePaths = (zip) =>
  Object.keys(zip.files)
    .filter((p) => /^ppt\/slides\/slide\d+\.xml$/.test(p))
    .sort();

describe("buildDeck with a template", () => {
  it("produces a readable zip containing a slide per outline entry", async () => {
    const out = await buildDeck({ outline: OUTLINE, template: await templateZip() });
    const zip = await open(out);
    expect(slidePaths(zip)).toHaveLength(OUTLINE.length);
  });

  it("leaves the template's theme, master and layouts byte-identical", async () => {
    // This is the whole feature. Regenerating these parts instead of carrying
    // them through is exactly how a "templated" deck comes out looking like a
    // default deck, and it would pass any test that only counted slides.
    const template = await templateZip();
    const before = await open(template);
    const after = await open(await buildDeck({ outline: OUTLINE, template }));

    for (const part of [
      "ppt/theme/theme1.xml",
      "ppt/slideMasters/slideMaster1.xml",
      "ppt/slideLayouts/slideLayout1.xml",
      "ppt/slideLayouts/slideLayout2.xml",
    ]) {
      expect(after.file(part), part).not.toBeNull();
      expect(await after.file(part).async("string"), part).toBe(
        await before.file(part).async("string"),
      );
    }
  });

  it("points each new slide at a layout that came from the template", async () => {
    const out = await buildDeck({ outline: OUTLINE, template: await templateZip() });
    const zip = await open(out);
    for (const path of slidePaths(zip)) {
      const rels = zip.file(path.replace("ppt/slides/", "ppt/slides/_rels/") + ".rels");
      expect(rels, `${path} has no rels`).not.toBeNull();
      const xml = await rels.async("string");
      expect(xml).toContain("slideLayout");
    }
  });

  it("declares every new slide in [Content_Types].xml and the presentation rels", async () => {
    // A slide part that exists in the zip but is undeclared makes PowerPoint
    // report the file as corrupt - and nothing in a slide-counting test would
    // notice.
    const zip = await open(await buildDeck({ outline: OUTLINE, template: await templateZip() }));
    const types = await zip.file("[Content_Types].xml").async("string");
    const rels = await zip.file("ppt/_rels/presentation.xml.rels").async("string");
    const presentation = await zip.file("ppt/presentation.xml").async("string");

    for (const path of slidePaths(zip)) {
      expect(types, path).toContain(`/${path}`);
    }
    expect((rels.match(/slides\/slide\d+\.xml/g) || []).length).toBe(OUTLINE.length);
    expect(presentation).toContain("sldId");
  });

  it("keeps the slides in the outline's order", async () => {
    const zip = await open(await buildDeck({ outline: OUTLINE, template: await templateZip() }));
    const first = await zip.file("ppt/slides/slide1.xml").async("string");
    expect(first).toContain("Payments migration");
  });
});

describe("text that would break the XML", () => {
  it("escapes ampersands and angle brackets in titles and bullets", async () => {
    // A project called "R&D" is ordinary, and an unescaped ampersand makes the
    // whole file unopenable. Assert the escaped form is present and the raw
    // character is not, or a test could pass on a file PowerPoint refuses.
    const outline = [
      { kind: "title", title: "R&D <phase 2>" },
      { kind: "content", title: "Trade-offs", bullets: ['a "quoted" value & more', "x < y"] },
    ];
    const zip = await open(await buildDeck({ outline, template: await templateZip() }));
    const all = (
      await Promise.all(slidePaths(zip).map((p) => zip.file(p).async("string")))
    ).join("");

    expect(all).toContain("R&amp;D");
    expect(all).toContain("&lt;phase 2&gt;");
    expect(all).toContain("x &lt; y");
    expect(all).not.toMatch(/>[^<]*R&D/);
  });

  it("survives a title that is only markup characters", async () => {
    const outline = [{ kind: "title", title: "<<&&>>" }];
    await expect(buildDeck({ outline, template: await templateZip() })).resolves.toBeTruthy();
  });
});

describe("without a usable template", () => {
  it("still builds a deck when no template was ever uploaded", async () => {
    // "No template" must never be a blocker - the user asked for a deck.
    const zip = await open(await buildDeck({ outline: OUTLINE, template: null }));
    expect(slidePaths(zip)).toHaveLength(OUTLINE.length);
    expect(zip.file("[Content_Types].xml")).not.toBeNull();
  });

  it("reports a template it cannot read instead of silently ignoring it", async () => {
    // Falling back quietly produces an off-brand deck the user then presents,
    // believing it followed their template. The caller needs to be able to say
    // so and offer generation without it.
    const notAZip = new Uint8Array([1, 2, 3, 4, 5]);
    const result = await buildDeck({ outline: OUTLINE, template: notAZip }).catch((err) => err);
    if (result instanceof Error) {
      expect(String(result.message)).toMatch(/template/i);
    } else {
      expect(result.templateError).toBeTruthy();
      expect(String(result.templateError)).toMatch(/template/i);
    }
  });
});

describe("video placeholders", () => {
  it("names the file on the slide rather than omitting it", async () => {
    const outline = [
      { kind: "title", title: "Payments" },
      { kind: "videoPlaceholder", attachmentId: "v1", title: "demo.mp4", caption: "walkthrough" },
    ];
    const zip = await open(await buildDeck({ outline, template: await templateZip() }));
    const all = (
      await Promise.all(slidePaths(zip).map((p) => zip.file(p).async("string")))
    ).join("");
    expect(all).toContain("demo.mp4");
    expect(all).toContain("walkthrough");
  });
});

describe("degenerate input", () => {
  it("builds an empty but valid deck for an empty outline", async () => {
    const zip = await open(await buildDeck({ outline: [], template: await templateZip() }));
    expect(zip.file("[Content_Types].xml")).not.toBeNull();
    expect(slidePaths(zip)).toHaveLength(0);
  });

  it("does not throw on malformed outline entries", async () => {
    const outline = [null, {}, { kind: "unknown-kind" }, { kind: "content", title: "ok" }];
    await expect(buildDeck({ outline, template: null })).resolves.toBeTruthy();
  });
});

// buildDeck({ ..., images }) embeds a real <p:pic> for an "image" outline
// slide when the caller supplies that attachment's bytes - the actual gap
// this file exists to close: without this, an image slide only ever carried
// its attachment's NAME and CAPTION as text, so a page with a diagram
// attached produced a slide reading "topology.png" with no diagram on it.
//
// `images` is keyed by deckOutline.js's own `attachmentId` field on an
// "image" slide - see slidesForAttachment there. The writer never fetches
// anything itself; it only ever embeds bytes the caller already handed it,
// which is what keeps it a pure function of its inputs and testable without
// a network.
function imageSlide(attachmentId, name, caption) {
  return { kind: "image", attachmentId, name, caption };
}

// Two distinct, deliberately tiny byte payloads (not real, decodable image
// files - the writer never inspects image content, only carries bytes
// through), so a test can prove the SPECIFIC bytes supplied for ONE
// attachment land in the zip, not just that "some bytes" were written
// somewhere.
const IMG_A = new Uint8Array([137, 80, 78, 71, 13, 10, 26, 10, 1, 2, 3, 4, 5]);
const IMG_B = new Uint8Array([255, 216, 255, 224, 9, 8, 7, 6]);

const mediaPaths = (zip) =>
  Object.keys(zip.files).filter((p) => /^ppt\/media\/[^/]+$/.test(p) && !zip.files[p].dir);

describe("image attachments", () => {
  it("embeds the supplied bytes as a real picture, not just the caption", async () => {
    const outline = [
      { kind: "title", title: "Payments" },
      imageSlide("att1", "topology.png", "System diagram"),
    ];
    const images = { att1: { bytes: IMG_A, mime: "image/png" } };
    const zip = await open(await buildDeck({ outline, template: await templateZip(), images }));

    const media = mediaPaths(zip);
    expect(media).toHaveLength(1);
    const mediaBytes = await zip.file(media[0]).async("uint8array");
    expect([...mediaBytes]).toEqual([...IMG_A]);

    const contentTypes = await zip.file("[Content_Types].xml").async("string");
    expect(contentTypes).toMatch(/<Default Extension="png" ContentType="image\/png"\/>/);

    const [, imageSlidePath] = slidePaths(zip); // second slide is the image slide
    const relsPath = imageSlidePath.replace("ppt/slides/", "ppt/slides/_rels/") + ".rels";
    const relsXml = await zip.file(relsPath).async("string");
    const relMatch = /<Relationship Id="(rId\d+)" Type="[^"]*\/image" Target="([^"]+)"\/>/.exec(relsXml);
    expect(relMatch, relsXml).not.toBeNull();
    const [, rId, target] = relMatch;
    expect(target.replace(/^\.\.\//, "ppt/")).toBe(media[0]);

    // The layout relationship (always rId1, written first) must still be
    // there, untouched, and the new image relationship must be a DIFFERENT
    // id - colliding with rId1 would mean one of the two relationships gets
    // silently shadowed.
    expect(relsXml).toMatch(/Id="rId1"[^>]*slideLayout/);
    expect(rId).not.toBe("rId1");

    const slideXmlText = await zip.file(imageSlidePath).async("string");
    expect(slideXmlText).toContain("<p:pic>");
    expect(slideXmlText).toContain(`r:embed="${rId}"`);

    // The caption stays on the slide either way.
    expect(slideXmlText).toContain("topology.png");
    expect(slideXmlText).toContain("System diagram");
  });

  it("embeds a jpeg under its own extension alongside a png in the same deck", async () => {
    const outline = [imageSlide("att1", "a.png", "A"), imageSlide("att2", "b.jpg", "B")];
    const images = {
      att1: { bytes: IMG_A, mime: "image/png" },
      att2: { bytes: IMG_B, mime: "image/jpeg" },
    };
    const zip = await open(await buildDeck({ outline, template: await templateZip(), images }));
    const media = mediaPaths(zip).sort();
    expect(media).toHaveLength(2);

    const contentTypes = await zip.file("[Content_Types].xml").async("string");
    expect(contentTypes).toContain('<Default Extension="png" ContentType="image/png"/>');
    expect(contentTypes).toContain('<Default Extension="jpeg" ContentType="image/jpeg"/>');
  });

  it("declares a [Content_Types].xml Default extension once per extension, not once per image, and not twice if the template already declares it", async () => {
    const outline = [imageSlide("att1", "a.png", "A"), imageSlide("att2", "b.png", "B")];
    const images = {
      att1: { bytes: IMG_A, mime: "image/png" },
      att2: { bytes: IMG_B, mime: "image/png" },
    };
    const template = await templateZip({
      extraContentTypes: `<Default Extension="png" ContentType="image/png"/>`,
    });
    const zip = await open(await buildDeck({ outline, template, images }));

    const contentTypes = await zip.file("[Content_Types].xml").async("string");
    const matches = contentTypes.match(/<Default Extension="png"/g) || [];
    expect(matches).toHaveLength(1);
    expect(mediaPaths(zip)).toHaveLength(2);
  });

  it("degrades to the caption-only slide, with no media part and no dangling relationship, when no bytes are supplied", async () => {
    const outline = [imageSlide("att1", "topology.png", "System diagram")];
    const zip = await open(await buildDeck({ outline, template: await templateZip(), images: {} }));

    expect(mediaPaths(zip)).toHaveLength(0);

    const [path] = slidePaths(zip);
    const relsPath = path.replace("ppt/slides/", "ppt/slides/_rels/") + ".rels";
    const relsXml = await zip.file(relsPath).async("string");
    expect(relsXml).not.toMatch(/\/image"/); // no image-type relationship at all
    expect((relsXml.match(/<Relationship Id=/g) || []).length).toBe(1); // only the layout rel

    const slideXmlText = await zip.file(path).async("string");
    expect(slideXmlText).not.toContain("<p:pic>");
    expect(slideXmlText).toContain("topology.png");
    expect(slideXmlText).toContain("System diagram");
  });

  it("degrades the same way when `images` is omitted entirely, an unrecognized mime is supplied, or the attachment id has no entry", async () => {
    const outline = [
      imageSlide("att1", "topology.png", "no images arg"),
      imageSlide("att2", "weird.bin", "bad mime"),
      imageSlide("att3", "orphan.png", "no matching id"),
    ];
    const zip1 = await open(await buildDeck({ outline: [outline[0]], template: await templateZip() }));
    expect(mediaPaths(zip1)).toHaveLength(0);

    const zip2 = await open(
      await buildDeck({
        outline: [outline[1]],
        template: await templateZip(),
        images: { att2: { bytes: IMG_A, mime: "application/octet-stream" } },
      }),
    );
    expect(mediaPaths(zip2)).toHaveLength(0);

    const zip3 = await open(
      await buildDeck({
        outline: [outline[2]],
        template: await templateZip(),
        images: { "some-other-id": { bytes: IMG_A, mime: "image/png" } },
      }),
    );
    expect(mediaPaths(zip3)).toHaveLength(0);
  });
});

describe("round-trip manifest integrity", () => {
  // Resolves a relationship Target the same way the OPC spec does: relative
  // to the directory of the SOURCE part (the part whose own "_rels/<name>.rels"
  // this came from), not the .rels file's own directory.
  function resolveRelTarget(relsPath, target) {
    const m = /^(.*)_rels\/[^/]*\.rels$/.exec(relsPath);
    const sourceDir = m ? m[1].replace(/\/$/, "") : "";
    const combined = sourceDir ? `${sourceDir}/${target}` : target;
    const parts = [];
    for (const seg of combined.split("/")) {
      if (seg === "." || seg === "") continue;
      if (seg === "..") parts.pop();
      else parts.push(seg);
    }
    return parts.join("/");
  }

  // Every part [Content_Types].xml declares (by Override or by Default
  // extension) must exist in the zip; every part in the zip must be
  // declared (an Override for it, or a Default for its extension); every
  // relationship Target in every .rels file must resolve to an existing
  // part. Images are the first non-XML parts this writer adds, so this is
  // exactly the check that would catch an undeclared media part or a
  // dangling relationship - what PowerPoint itself reports as "the file is
  // corrupt".
  async function assertManifestIntegrity(zip) {
    const allPaths = new Set(Object.keys(zip.files).filter((p) => !zip.files[p].dir));

    const contentTypesXml = await zip.file("[Content_Types].xml").async("string");
    const overrides = [...contentTypesXml.matchAll(/<Override PartName="([^"]+)"/g)].map((m) =>
      m[1].replace(/^\//, ""),
    );
    const defaults = [...contentTypesXml.matchAll(/<Default Extension="([^"]+)"/g)].map((m) =>
      m[1].toLowerCase(),
    );

    for (const partName of overrides) {
      expect(allPaths.has(partName), `Override declares missing part ${partName}`).toBe(true);
    }

    for (const path of allPaths) {
      if (path === "[Content_Types].xml") continue;
      const ext = (path.split(".").pop() || "").toLowerCase();
      const declared = overrides.includes(path) || defaults.includes(ext);
      expect(declared, `${path} has no Override and no Default for ".${ext}"`).toBe(true);
    }

    const relsPaths = [...allPaths].filter((p) => p.endsWith(".rels"));
    for (const relsPath of relsPaths) {
      const xml = await zip.file(relsPath).async("string");
      for (const m of xml.matchAll(/Target="([^"]+)"(\s+TargetMode="External")?/g)) {
        if (m[2]) continue; // external targets never resolve inside the zip
        const resolved = resolveRelTarget(relsPath, m[1]);
        expect(allPaths.has(resolved), `${relsPath} -> "${m[1]}" (resolved "${resolved}") is missing`).toBe(true);
      }
    }
  }

  it("holds with a template, mixing an embedded image and a degraded one in the same deck", async () => {
    const outline = [
      { kind: "title", title: "Payments" },
      imageSlide("att1", "topology.png", "Has bytes"),
      imageSlide("att2", "missing.png", "No bytes supplied"),
    ];
    const images = { att1: { bytes: IMG_A, mime: "image/png" } };
    const zip = await open(await buildDeck({ outline, template: await templateZip(), images }));
    await assertManifestIntegrity(zip);
  });

  it("holds for the built-in skeleton too, with no template", async () => {
    const outline = [imageSlide("att1", "topology.png", "Has bytes")];
    const images = { att1: { bytes: IMG_A, mime: "image/png" } };
    const zip = await open(await buildDeck({ outline, template: null, images }));
    await assertManifestIntegrity(zip);
  });
});
