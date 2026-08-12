// Turns a deck outline (lib/experience/deckOutline.js) into an actual .pptx
// (OOXML zip), inheriting an uploaded template's look.
//
// pptxgenjs cannot do this: it defines masters/layouts in JavaScript and has
// no way to *consume* an arbitrary uploaded .pptx's theme and layouts. Using
// it would silently deliver "a deck" instead of "a deck that follows my
// template" - so this is hand-rolled OOXML instead. The template's own
// `ppt/theme/*`, `ppt/slideMasters/*` and `ppt/slideLayouts/*` parts are
// carried through the output zip UNTOUCHED (byte-for-byte, as raw bytes -
// never round-tripped through a string), and only new `ppt/slides/slideN.xml`
// parts are generated, each referencing one of the template's own layouts via
// its own `_rels/slideN.xml.rels`. Layout selection itself is not
// reimplemented here - see lib/experience/pptxTemplate.js's
// inspectPptxTemplate, which this file calls to get `titleLayout` and
// `titleContentLayout` (chosen by the layout's OOXML `type` attribute, then
// by display name, falling back to the first layout - never by a fixed
// index).
//
// Every new slide's text is escaped so that title/bullet text containing
// "&", "<", ">", '"' or "'" (an ordinary project named "R&D", say) cannot
// produce a file PowerPoint refuses to open.
//
// No template is never a blocker: with `template: null` a minimal, valid
// deck is built from a small built-in skeleton instead. A template that
// *was* supplied but cannot be read (not a zip, or not a usable PowerPoint
// file per inspectPptxTemplate) is reported by throwing an Error whose
// message names the template - never silently ignored, which would produce
// an off-brand deck the caller presents believing it followed the template.

import JSZip from "jszip";
import { inspectPptxTemplate } from "./pptxTemplate.js";

const RELS_NS = "http://schemas.openxmlformats.org/package/2006/relationships";
const SLIDE_REL_TYPE = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/slide";
const SLIDE_LAYOUT_REL_TYPE =
  "http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideLayout";
const IMAGE_REL_TYPE = "http://schemas.openxmlformats.org/officeDocument/2006/relationships/image";
const R_NS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";

// Every new slide's own rels file (slideRelsXml below) is written FRESH by
// this writer - never merged with a pre-existing one - and always puts the
// layout relationship at rId1 first. So the one OTHER relationship a slide
// can carry (its embedded picture, see resolveImageEmbed) can safely use a
// fixed id: there is nothing else in that file's id space to collide with.
const IMAGE_REL_ID = "rId2";

// Same escaping approach as lib/document/docx.js's (unexported) escapeXml:
// the five XML-significant characters, "&" first so the entities produced
// for the other four are never themselves re-escaped.
function escapeXml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

function textParagraphXml(text) {
  return `<a:p><a:r><a:t>${escapeXml(text)}</a:t></a:r></a:p>`;
}

// ---------------------------------------------------------------------------
// Built-in minimal deck, used when template is null. Deliberately tiny but a
// structurally complete OOXML presentation: content types, package rels,
// presentation.xml (+ its rels), one theme, one slide master (+ its rels),
// and two slide layouts (title / title+content), each with its own rels
// pointing back at the master. This gives `resolveTemplateInfo` the exact
// same shape - `{ parts, layouts, titleLayout, titleContentLayout }` -
// regardless of whether the deck came from an upload or from here.
// ---------------------------------------------------------------------------

const BUILTIN_CONTENT_TYPES = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/ppt/presentation.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.presentation.main+xml"/><Override PartName="/ppt/theme/theme1.xml" ContentType="application/vnd.openxmlformats-officedocument.theme+xml"/><Override PartName="/ppt/slideMasters/slideMaster1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideMaster+xml"/><Override PartName="/ppt/slideLayouts/slideLayout1.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml"/><Override PartName="/ppt/slideLayouts/slideLayout2.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slideLayout+xml"/></Types>`;

const BUILTIN_ROOT_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="${RELS_NS}"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="ppt/presentation.xml"/></Relationships>`;

const BUILTIN_PRESENTATION_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:presentation xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="${R_NS}" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:sldMasterIdLst><p:sldMasterId id="2147483648" r:id="rId1"/></p:sldMasterIdLst><p:sldIdLst/><p:sldSz cx="12192000" cy="6858000"/><p:notesSz cx="6858000" cy="9144000"/></p:presentation>`;

const BUILTIN_PRESENTATION_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="${RELS_NS}"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="slideMasters/slideMaster1.xml"/><Relationship Id="rId2" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme" Target="theme/theme1.xml"/></Relationships>`;

const BUILTIN_THEME_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<a:theme xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" name="Default Theme"><a:themeElements><a:clrScheme name="Default"><a:dk1><a:sysClr val="windowText" lastClr="000000"/></a:dk1><a:lt1><a:sysClr val="window" lastClr="FFFFFF"/></a:lt1><a:dk2><a:srgbClr val="1F497D"/></a:dk2><a:lt2><a:srgbClr val="EEECE1"/></a:lt2><a:accent1><a:srgbClr val="4F81BD"/></a:accent1><a:accent2><a:srgbClr val="C0504D"/></a:accent2><a:accent3><a:srgbClr val="9BBB59"/></a:accent3><a:accent4><a:srgbClr val="8064A2"/></a:accent4><a:accent5><a:srgbClr val="4BACC6"/></a:accent5><a:accent6><a:srgbClr val="F79646"/></a:accent6><a:hlink><a:srgbClr val="0000FF"/></a:hlink><a:folHlink><a:srgbClr val="800080"/></a:folHlink></a:clrScheme><a:fontScheme name="Default"><a:majorFont><a:latin typeface="Calibri"/></a:majorFont><a:minorFont><a:latin typeface="Calibri"/></a:minorFont></a:fontScheme><a:fmtScheme name="Default"><a:fillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:fillStyleLst><a:lnStyleLst><a:ln><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln><a:ln><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln><a:ln><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:ln></a:lnStyleLst><a:effectStyleLst><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle><a:effectStyle><a:effectLst/></a:effectStyle></a:effectStyleLst><a:bgFillStyleLst><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill><a:solidFill><a:schemeClr val="phClr"/></a:solidFill></a:bgFillStyleLst></a:fmtScheme></a:themeElements></a:theme>`;

const BUILTIN_SLIDE_MASTER_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sldMaster xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="${R_NS}" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/></p:spTree></p:cSld><p:clrMap bg1="lt1" tx1="dk1" bg2="lt2" tx2="dk2" accent1="accent1" accent2="accent2" accent3="accent3" accent4="accent4" accent5="accent5" accent6="accent6" hlink="hlink" folHlink="folHlink"/><p:sldLayoutIdLst><p:sldLayoutId id="2147483649" r:id="rId1"/><p:sldLayoutId id="2147483650" r:id="rId2"/></p:sldLayoutIdLst></p:sldMaster>`;

const BUILTIN_SLIDE_MASTER_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="${RELS_NS}"><Relationship Id="rId1" Type="${SLIDE_LAYOUT_REL_TYPE}" Target="../slideLayouts/slideLayout1.xml"/><Relationship Id="rId2" Type="${SLIDE_LAYOUT_REL_TYPE}" Target="../slideLayouts/slideLayout2.xml"/><Relationship Id="rId3" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/theme" Target="../theme/theme1.xml"/></Relationships>`;

const BUILTIN_LAYOUT_RELS = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="${RELS_NS}"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/slideMaster" Target="../slideMasters/slideMaster1.xml"/></Relationships>`;

function builtinLayoutXml(name, type) {
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sldLayout xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="${R_NS}" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main" type="${type}"><p:cSld name="${name}"><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/></p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sldLayout>`;
}

function builtinTemplateInfo() {
  const parts = new Map([
    ["[Content_Types].xml", BUILTIN_CONTENT_TYPES],
    ["_rels/.rels", BUILTIN_ROOT_RELS],
    ["ppt/presentation.xml", BUILTIN_PRESENTATION_XML],
    ["ppt/_rels/presentation.xml.rels", BUILTIN_PRESENTATION_RELS],
    ["ppt/theme/theme1.xml", BUILTIN_THEME_XML],
    ["ppt/slideMasters/slideMaster1.xml", BUILTIN_SLIDE_MASTER_XML],
    ["ppt/slideMasters/_rels/slideMaster1.xml.rels", BUILTIN_SLIDE_MASTER_RELS],
    ["ppt/slideLayouts/slideLayout1.xml", builtinLayoutXml("Title Slide", "title")],
    ["ppt/slideLayouts/_rels/slideLayout1.xml.rels", BUILTIN_LAYOUT_RELS],
    ["ppt/slideLayouts/slideLayout2.xml", builtinLayoutXml("Title and Content", "obj")],
    ["ppt/slideLayouts/_rels/slideLayout2.xml.rels", BUILTIN_LAYOUT_RELS],
  ]);

  const layouts = [
    { file: "ppt/slideLayouts/slideLayout1.xml", name: "Title Slide", type: "title" },
    { file: "ppt/slideLayouts/slideLayout2.xml", name: "Title and Content", type: "obj" },
  ];

  return { parts, layouts, titleLayout: layouts[0], titleContentLayout: layouts[1] };
}

// ---------------------------------------------------------------------------
// Reading the supplied template (or falling back to the built-in one).
// ---------------------------------------------------------------------------

// Resolves `template` into `{ parts: Map<path, Uint8Array|string>, layouts,
// titleLayout, titleContentLayout }`. `parts` holds every part of the
// template (or the built-in skeleton) untouched, keyed by its in-zip path -
// callers copy these straight into the output zip before patching the
// handful of parts (content types, presentation.xml, its rels) that need new
// slide entries appended.
//
// Throws when a supplied template cannot be read as a usable PowerPoint file
// - this is the "report, don't silently ignore" behaviour: the thrown
// Error's message is inspectPptxTemplate's own message, which always names
// the template file.
async function resolveTemplateInfo(template, templateFileName) {
  if (template === null || template === undefined) {
    return builtinTemplateInfo();
  }

  const label = templateFileName || "template.pptx";

  const report = await inspectPptxTemplate(template, label);
  if (!report.ok) {
    throw new Error(report.error);
  }

  let zip;
  try {
    zip = await JSZip.loadAsync(template);
  } catch (err) {
    throw new Error(`Could not read template "${label}": ${err && err.message ? err.message : err}.`);
  }

  const parts = new Map();
  for (const path of Object.keys(zip.files)) {
    const entry = zip.files[path];
    if (entry.dir) continue;
    let data;
    try {
      data = await zip.file(path).async("uint8array");
    } catch (err) {
      throw new Error(
        `Could not read template "${label}": part "${path}" is unreadable (${
          err && err.message ? err.message : err
        }).`,
      );
    }
    parts.set(path, data);
  }

  return {
    parts,
    layouts: report.layouts,
    titleLayout: report.titleLayout,
    titleContentLayout: report.titleContentLayout,
  };
}

function partText(info, path) {
  const raw = info.parts.get(path);
  if (raw == null) return "";
  if (typeof raw === "string") return raw;
  return new TextDecoder("utf-8").decode(raw);
}

// A template that itself already contains slides (an uploaded deck used as a
// style reference, rather than a bare .potx) must never have those slide
// parts silently overwritten by ours - so new slides are numbered starting
// just after the highest slideN already present in the carried-through parts.
function nextSlideStart(info) {
  let max = 0;
  for (const path of info.parts.keys()) {
    const match = /^ppt\/slides\/slide(\d+)\.xml$/.exec(path);
    if (match) max = Math.max(max, Number(match[1]));
  }
  return max + 1;
}

// Same reasoning as nextSlideStart above, for `ppt/media/imageN.<ext>`: a
// template (or a deck this writer already generated once) may already ship
// its own media parts, so newly embedded images are numbered starting just
// past the highest imageN already present, never reusing - and overwriting
// - one of the template's own pictures.
function nextMediaStart(info) {
  let max = 0;
  for (const path of info.parts.keys()) {
    const match = /^ppt\/media\/image(\d+)\.[^/]+$/.exec(path);
    if (match) max = Math.max(max, Number(match[1]));
  }
  return max + 1;
}

// ---------------------------------------------------------------------------
// Slide content.
// ---------------------------------------------------------------------------

function pickLayout(slide, info) {
  const kind = slide && typeof slide === "object" ? slide.kind : null;
  if (kind === "title") return info.titleLayout || info.layouts[0];
  return info.titleContentLayout || info.titleLayout || info.layouts[0];
}

function blocksToLines(blocks) {
  const lines = [];
  for (const block of Array.isArray(blocks) ? blocks : []) {
    if (!block || typeof block !== "object") continue;
    if (block.kind === "paragraph" && block.text) {
      lines.push(String(block.text));
    } else if (block.kind === "bullets" && Array.isArray(block.items)) {
      for (const item of block.items) if (item) lines.push(String(item));
    } else if (block.kind === "code" && block.text) {
      lines.push(String(block.text));
    } else if (block.kind === "quote" && block.text) {
      lines.push(String(block.text));
    }
  }
  return lines;
}

function slideTitleText(slide) {
  switch (slide.kind) {
    case "title":
    case "content":
      return typeof slide.title === "string" ? slide.title : "";
    case "image":
      return slide.caption || slide.name || "Image";
    case "videoPlaceholder":
      return slide.title || slide.name || "Video";
    default:
      return typeof slide.title === "string" ? slide.title : "";
  }
}

function slideBodyLines(slide) {
  switch (slide.kind) {
    case "content": {
      const bullets = Array.isArray(slide.bullets)
        ? slide.bullets.filter((b) => typeof b === "string" && b)
        : [];
      return bullets.length > 0 ? bullets : blocksToLines(slide.blocks);
    }
    case "image": {
      const lines = [];
      if (slide.name) lines.push(String(slide.name));
      if (slide.caption) lines.push(String(slide.caption));
      return lines;
    }
    case "videoPlaceholder": {
      // Fixture/outline shapes disagree on field names (deckOutline.js
      // produces { name, notes, title: "Video: <name>" }; other callers may
      // pass { title: "<name>", caption }) - accept either so the file name
      // and its caption always land on the slide regardless of which shape
      // supplied them.
      const fileName = slide.name || slide.title || "";
      const caption = slide.caption ?? slide.notes ?? "";
      const lines = [];
      if (fileName) lines.push(`File: ${fileName}`);
      if (caption) lines.push(String(caption));
      return lines;
    }
    default:
      return [];
  }
}

// ---------------------------------------------------------------------------
// Embedding an "image" slide's own attachment as a real picture.
//
// `images` (buildDeck's own parameter) is a map from attachment id -
// deckOutline.js's `attachmentId` field on an "image" slide - to
// { bytes: Uint8Array, mime: string }, supplied by the CALLER. This file
// never fetches anything itself: that is what keeps buildDeck a pure
// function of its inputs, and it is the caller (BulkActionsBar.js) that
// already holds the signed URLs a fetch would need.
// ---------------------------------------------------------------------------

// OOXML's own image content types ARE just "image/<subtype>" (the same
// shape a browser's Content-Type header already uses), so the attachment's
// stored mime doubles as both the zip entry's extension and its
// [Content_Types].xml Default ContentType - no separate lookup table to
// keep in sync with whatever kinds classifyAttachment ever allows through.
// "jpg" is normalized to the canonical "jpeg" so a mime of either spelling
// never produces two different Default entries for what PowerPoint treats
// as one extension.
function imageExtensionAndContentType(mime) {
  const normalized = typeof mime === "string" ? mime.trim().toLowerCase() : "";
  const match = /^image\/([a-z0-9.+-]+)$/.exec(normalized);
  if (!match) return null;
  const ext = match[1] === "jpg" ? "jpeg" : match[1];
  return { ext, contentType: `image/${ext}` };
}

// Resolves one "image" slide's embed, or null when it must degrade to the
// caption-only slide: no matching id in `images`, no bytes, or a mime this
// function cannot turn into a usable extension. Never throws - a missing or
// unusable image is the expected, common case (an expired signed URL, a
// caller that only fetched some of the attachments), not an error.
function resolveImageEmbed(slide, images) {
  if (!slide || slide.kind !== "image") return null;
  const id = slide.attachmentId;
  if (id === undefined || id === null) return null;
  const entry = images && typeof images === "object" ? images[id] : null;
  if (!entry || typeof entry !== "object") return null;
  const bytes = entry.bytes;
  if (!bytes || typeof bytes.length !== "number" || bytes.length === 0) return null;
  const meta = imageExtensionAndContentType(entry.mime);
  if (!meta) return null;
  return { bytes, ext: meta.ext, contentType: meta.contentType };
}

// Collects the `<Default Extension="..." ContentType="...">` this zip's
// [Content_Types].xml already declares, case-insensitively - both what the
// template shipped with and, for a re-generated deck, what a PRIOR run of
// this writer already added. Read once per buildDeck call so every new
// extension is added at most once regardless of how many images share it.
function declaredContentTypeExtensions(xml) {
  const extensions = new Set();
  for (const match of String(xml || "").matchAll(/<Default\s+Extension="([^"]+)"/g)) {
    extensions.add(match[1].toLowerCase());
  }
  return extensions;
}

function addContentTypeDefaults(xml, defaults) {
  if (!defaults || defaults.length === 0 || !/<\/Types>/.test(xml)) return xml;
  const entries = defaults
    .map(({ ext, contentType }) => `<Default Extension="${ext}" ContentType="${contentType}"/>`)
    .join("");
  return xml.replace(/<\/Types>/, `${entries}</Types>`);
}

// A minimal but valid <p:pic>: a fixed shape id (id="4" - always free, since
// every slide this writer generates has exactly a title (id 2) and a body
// (id 3) placeholder ahead of it and at most one picture), a blipFill
// referencing the relationship id, and a fixed position/size sized to sit
// under the title on either the built-in skeleton's 16:9 canvas or a
// typical 4:3 template. Real dimensions/aspect ratio are not attempted -
// making a slide LOOK right is a layout concern the outline itself carries
// no data for (deckOutline.js's "image" slide has no width/height), whereas
// showing the picture at all, sized reasonably, is the actual gap this
// closes.
function picXml(rId) {
  return `<p:pic><p:nvPicPr><p:cNvPr id="4" name="Picture"/><p:cNvPicPr><a:picLocks noChangeAspect="1"/></p:cNvPicPr><p:nvPr/></p:nvPicPr><p:blipFill><a:blip r:embed="${rId}"/><a:stretch><a:fillRect/></a:stretch></p:blipFill><p:spPr><a:xfrm><a:off x="1219200" y="1600200"/><a:ext cx="6858000" cy="3857625"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></p:spPr></p:pic>`;
}

function slideXml(slide, imageRel) {
  const title = slideTitleText(slide);
  const bodyLines = slideBodyLines(slide);
  const bodyParagraphs =
    bodyLines.length > 0 ? bodyLines.map((line) => textParagraphXml(line)).join("") : "<a:p/>";
  const picture = imageRel ? picXml(imageRel.rId) : "";

  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<p:sld xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:r="${R_NS}" xmlns:p="http://schemas.openxmlformats.org/presentationml/2006/main"><p:cSld><p:spTree><p:nvGrpSpPr><p:cNvPr id="1" name=""/><p:cNvGrpSpPr/><p:nvPr/></p:nvGrpSpPr><p:grpSpPr/><p:sp><p:nvSpPr><p:cNvPr id="2" name="Title"/><p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr><p:nvPr><p:ph type="title"/></p:nvPr></p:nvSpPr><p:spPr/><p:txBody><a:bodyPr/><a:lstStyle/>${textParagraphXml(
    title,
  )}</p:txBody></p:sp><p:sp><p:nvSpPr><p:cNvPr id="3" name="Body"/><p:cNvSpPr><a:spLocks noGrp="1"/></p:cNvSpPr><p:nvPr><p:ph type="body" idx="1"/></p:nvPr></p:nvSpPr><p:spPr/><p:txBody><a:bodyPr/><a:lstStyle/>${bodyParagraphs}</p:txBody></p:sp>${picture}</p:spTree></p:cSld><p:clrMapOvr><a:masterClrMapping/></p:clrMapOvr></p:sld>`;
}

function layoutRelTarget(layoutFile) {
  const withoutPptPrefix = String(layoutFile || "").replace(/^ppt\//, "");
  return `../${withoutPptPrefix}`;
}

// `imageRel`, when present, is always the SECOND relationship in this file -
// the layout relationship is written first, at the fixed id rId1, exactly
// as it always was before image embedding existed. See IMAGE_REL_ID's own
// comment for why a fixed id is safe here.
function slideRelsXml(layout, imageRel) {
  const target = layoutRelTarget(layout && layout.file);
  const imageRelXml = imageRel
    ? `<Relationship Id="${imageRel.rId}" Type="${IMAGE_REL_TYPE}" Target="${imageRel.target}"/>`
    : "";
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="${RELS_NS}"><Relationship Id="rId1" Type="${SLIDE_LAYOUT_REL_TYPE}" Target="${target}"/>${imageRelXml}</Relationships>`;
}

function normalizeOutline(outline) {
  if (!Array.isArray(outline)) return [];
  return outline.filter((entry) => entry !== null && typeof entry === "object");
}

// ---------------------------------------------------------------------------
// Patching the three parts a new slide has to be declared in: content types,
// presentation.xml.rels, and presentation.xml's sldIdLst. Every other
// template part is copied through as-is (see buildDeck below) - these three
// are read back out as text, string-patched, and written back over the
// untouched copy, rather than parsed with a DOM (this has to run wherever
// deck generation ends up running, same reasoning as pptxTemplate.js
// avoiding DOMParser).
// ---------------------------------------------------------------------------

function patchContentTypes(xml, slideNumbers) {
  if (slideNumbers.length === 0 || !/<\/Types>/.test(xml)) return xml;
  const overrides = slideNumbers
    .map(
      (n) =>
        `<Override PartName="/ppt/slides/slide${n}.xml" ContentType="application/vnd.openxmlformats-officedocument.presentationml.slide+xml"/>`,
    )
    .join("");
  return xml.replace(/<\/Types>/, `${overrides}</Types>`);
}

function patchPresentationRels(xml, slideNumbers) {
  if (slideNumbers.length === 0) return { xml, slideRelIds: [] };

  const existingIds = [...xml.matchAll(/Id="rId(\d+)"/g)].map((m) => Number(m[1]));
  let nextId = (existingIds.length > 0 ? Math.max(...existingIds) : 0) + 1;

  const slideRelIds = [];
  const rels = slideNumbers
    .map((n) => {
      const rid = `rId${nextId}`;
      nextId += 1;
      slideRelIds.push(rid);
      return `<Relationship Id="${rid}" Type="${SLIDE_REL_TYPE}" Target="slides/slide${n}.xml"/>`;
    })
    .join("");

  const patched = /<\/Relationships>/.test(xml) ? xml.replace(/<\/Relationships>/, `${rels}</Relationships>`) : xml;
  return { xml: patched, slideRelIds };
}

function patchPresentationXml(xml, slideRelIds) {
  let withNamespace = xml;
  if (slideRelIds.length > 0 && !/xmlns:r=/.test(withNamespace) && /<p:presentation\b/.test(withNamespace)) {
    withNamespace = withNamespace.replace(/<p:presentation\b/, `<p:presentation xmlns:r="${R_NS}"`);
  }

  const entries = slideRelIds.map((rid, i) => `<p:sldId id="${256 + i}" r:id="${rid}"/>`).join("");
  const newList = `<p:sldIdLst>${entries}</p:sldIdLst>`;

  if (/<p:sldIdLst\s*\/>/.test(withNamespace)) {
    return withNamespace.replace(/<p:sldIdLst\s*\/>/, newList);
  }
  if (/<p:sldIdLst>[\s\S]*?<\/p:sldIdLst>/.test(withNamespace)) {
    return withNamespace.replace(/<p:sldIdLst>[\s\S]*?<\/p:sldIdLst>/, newList);
  }
  if (/<\/p:presentation>/.test(withNamespace)) {
    return withNamespace.replace(/<\/p:presentation>/, `${newList}</p:presentation>`);
  }
  return withNamespace;
}

// ---------------------------------------------------------------------------
// buildDeck({ outline, template, templateFileName?, images? }) -> Promise<Uint8Array>
//
// `outline` is the array produced by lib/experience/deckOutline.js's
// outlineFromPages (or hand-built, as the tests do). `template` is raw bytes
// of an uploaded .pptx/.potx (anything JSZip.loadAsync accepts), or null/
// undefined for "no template uploaded". `templateFileName` is optional and
// only used to name the template in an error message. `images` is an
// optional map from an "image" slide's own `attachmentId` to
// { bytes: Uint8Array, mime: string } - see resolveImageEmbed above. An
// entry missing, or one whose bytes/mime this file cannot use, degrades
// that one slide to caption-only text rather than failing the whole deck.
//
// Resolves to the finished .pptx's bytes (a Uint8Array), directly loadable
// by JSZip.loadAsync. Rejects (never resolves with a partial/garbage zip)
// when a *supplied* template cannot be read - see resolveTemplateInfo.
// ---------------------------------------------------------------------------
export async function buildDeck({ outline, template = null, templateFileName, images } = {}) {
  const slides = normalizeOutline(outline);
  const info = await resolveTemplateInfo(template, templateFileName);
  const imageMap = images && typeof images === "object" ? images : {};

  const zip = new JSZip();
  for (const [path, data] of info.parts) {
    zip.file(path, data);
  }

  const startN = nextSlideStart(info);
  const slideNumbers = slides.map((_, i) => startN + i);

  // Resolved up front (rather than inline in the forEach below) so the set
  // of NEW [Content_Types].xml Default extensions - across every image in
  // this deck - is known before that part gets patched once, further down:
  // one Default per extension, never one per image, and never one already
  // declared (by the template, or, e.g. in a hand-built test outline, by
  // more than one attachment sharing an extension).
  const existingExtensions = declaredContentTypeExtensions(partText(info, "[Content_Types].xml"));
  const newMediaDefaults = new Map(); // ext -> contentType
  let nextMediaN = nextMediaStart(info);

  const imageRels = slides.map((slide) => {
    const embed = resolveImageEmbed(slide, imageMap);
    if (!embed) return null;
    const mediaName = `image${nextMediaN}.${embed.ext}`;
    nextMediaN += 1;
    if (!existingExtensions.has(embed.ext) && !newMediaDefaults.has(embed.ext)) {
      newMediaDefaults.set(embed.ext, embed.contentType);
    }
    return {
      rId: IMAGE_REL_ID,
      target: `../media/${mediaName}`,
      mediaPath: `ppt/media/${mediaName}`,
      bytes: embed.bytes,
    };
  });

  slides.forEach((slide, i) => {
    const n = slideNumbers[i];
    const layout = pickLayout(slide, info);
    const imageRel = imageRels[i];
    if (imageRel) zip.file(imageRel.mediaPath, imageRel.bytes);
    zip.file(`ppt/slides/slide${n}.xml`, slideXml(slide, imageRel));
    zip.file(`ppt/slides/_rels/slide${n}.xml.rels`, slideRelsXml(layout, imageRel));
  });

  const contentTypesWithSlides = patchContentTypes(partText(info, "[Content_Types].xml"), slideNumbers);
  const contentTypesWithMedia = addContentTypeDefaults(
    contentTypesWithSlides,
    [...newMediaDefaults].map(([ext, contentType]) => ({ ext, contentType })),
  );
  zip.file("[Content_Types].xml", contentTypesWithMedia);

  const { xml: presentationRelsXml, slideRelIds } = patchPresentationRels(
    partText(info, "ppt/_rels/presentation.xml.rels"),
    slideNumbers,
  );
  zip.file("ppt/_rels/presentation.xml.rels", presentationRelsXml);

  zip.file(
    "ppt/presentation.xml",
    patchPresentationXml(partText(info, "ppt/presentation.xml"), slideRelIds),
  );

  return zip.generateAsync({ type: "uint8array" });
}
