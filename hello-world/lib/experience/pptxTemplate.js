// Reads an uploaded .pptx (or .potx) with jszip and reports what a renderer
// can use to build a template-faithful deck: the slide layouts it defines,
// their display names, and which one is usable as a title layout and which
// as a title-plus-content layout.
//
// This is a READ-only inspector. It does not modify the zip, and it does
// not write any new OOXML - that is the job of the (later, separate) slide
// renderer this outline feeds. See lib/experience/deckOutline.js for the
// abstract slide model that renderer will consume alongside this report.
//
// Deliberately avoids DOMParser/XMLSerializer: this has to work wherever
// the template-generation feature ends up running, and Node has no
// DOMParser global without pulling in another dependency (jsdom here is a
// devDependency for tests only, never a runtime one - see vitest.config.js).
// The two attributes this file actually needs - a layout's declared `type`
// and its human-readable <p:cSld name="...">, both on the layout part's
// root-ish elements - are pulled out with small, targeted regexes instead
// of a general-purpose XML parse.
//
// Never throws for an unusable upload. A corrupt zip and a well-formed zip
// that simply is not a PowerPoint file are both ordinary, expected inputs -
// the user picked the wrong file, or the upload got mangled - so both
// resolve to `{ ok: false, error }` with a message naming the file and the
// specific problem, for the caller to show and then offer "generate without
// a template" instead of crashing the whole feature.

import JSZip from "jszip";

const LAYOUT_FILE_RE = /^ppt\/slideLayouts\/slideLayout(\d+)\.xml$/;

// Single-pass XML entity unescape, ORDER MATTERS: the four named entities
// and numeric references are decoded before "&amp;" so that "&amp;lt;" (a
// literal ampersand followed by the text "lt;") correctly becomes the
// literal text "&lt;" rather than being double-decoded into "<". Decoding
// "&amp;" last is what makes that a single pass instead of a recursive one.
function unescapeXmlEntities(value) {
  return String(value ?? "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, code) => String.fromCodePoint(parseInt(code, 16)))
    .replace(/&amp;/g, "&");
}

function extractAttr(tagSource, attrName) {
  const re = new RegExp(`\\b${attrName}="([^"]*)"`);
  const match = re.exec(tagSource || "");
  return match ? unescapeXmlEntities(match[1]) : "";
}

// Pulls just the two attributes this file cares about out of a slideLayout
// part's XML: the root element's `type` attribute, and the display `name`
// on its <cSld>. Namespace prefixes are not assumed to be "p" - every real
// template uses that prefix by convention, but this matches whatever
// prefix (or none) is actually present rather than hard-coding it.
function readLayoutMeta(xmlText) {
  const rootMatch = /<([a-zA-Z0-9]+:)?sldLayout\b([^>]*)>/.exec(xmlText || "");
  const type = rootMatch ? extractAttr(rootMatch[2], "type") : "";

  const cSldMatch = /<([a-zA-Z0-9]+:)?cSld\b([^>]*?)\/?>/.exec(xmlText || "");
  const name = cSldMatch ? extractAttr(cSldMatch[2], "name") : "";

  return { type, name };
}

function layoutSortKey(fileName) {
  const match = LAYOUT_FILE_RE.exec(fileName);
  return match ? Number(match[1]) : Number.MAX_SAFE_INTEGER;
}

// Selects a layout by what it declares itself to be, never by position:
// first the OOXML `type` attribute (the schema's own name for what a
// layout is - "title", "obj", and so on), then a case-insensitive match
// against the layout's human-readable display name, and only once neither
// says anything usable, the first layout in the template. That last step
// is a documented, deliberate fallback - not an assumption that slot 0 is
// ever the title - so a template that simply doesn't label its layouts the
// way PowerPoint's own default theme does still produces a usable pick
// instead of no pick at all.
function selectLayout(layouts, { types, nameRe }) {
  const byType = layouts.find((l) => types.includes(l.type));
  if (byType) return byType;
  const byName = layouts.find((l) => nameRe.test(l.name || ""));
  if (byName) return byName;
  return layouts[0] || null;
}

const TITLE_TYPES = ["title"];
const TITLE_NAME_RE = /title\s*slide|^title$/i;
const CONTENT_TYPES = ["obj", "twoObj", "objAndTx", "txAndObj"];
const CONTENT_NAME_RE = /title\s*(and|&|,)?\s*content|content\s*(and|&|,)?\s*title/i;

function fail(fileName, error) {
  return { ok: false, fileName, error };
}

// inspectPptxTemplate(data, fileName) -> Promise<Report>
//
// `data` is anything JSZip.loadAsync accepts (Buffer, Uint8Array,
// ArrayBuffer, base64 string, ...). `fileName` is used only for error
// messages and the returned report's `fileName` field.
//
// Report shape on success:
//   { ok: true, fileName, layouts: [{ file, name, type }, ...],
//     titleLayout: { file, name, type } | null,
//     titleContentLayout: { file, name, type } | null }
// Report shape on failure:
//   { ok: false, fileName, error: "<message naming the file and problem>" }
export async function inspectPptxTemplate(data, fileName = "template.pptx") {
  const label = fileName || "template.pptx";

  let zip;
  try {
    zip = await JSZip.loadAsync(data);
  } catch (err) {
    return fail(
      label,
      `Could not open "${label}" as a PowerPoint file: the upload is not a valid zip archive (${
        err && err.message ? err.message : "corrupt file"
      }).`,
    );
  }

  const contentTypesFile = zip.file("[Content_Types].xml");
  if (!contentTypesFile) {
    return fail(label, `"${label}" is not a PowerPoint file: it has no [Content_Types].xml.`);
  }

  let contentTypesXml = "";
  try {
    contentTypesXml = await contentTypesFile.async("string");
  } catch {
    return fail(label, `"${label}" could not be read: its [Content_Types].xml is unreadable.`);
  }

  if (!contentTypesXml.includes("presentationml")) {
    return fail(
      label,
      `"${label}" is not a PowerPoint (.pptx) file: its content types don't declare a presentation.`,
    );
  }

  if (!zip.file("ppt/presentation.xml")) {
    return fail(label, `"${label}" is not a PowerPoint file: it has no ppt/presentation.xml.`);
  }

  const layoutFiles = zip
    .file(LAYOUT_FILE_RE)
    .slice()
    .sort((a, b) => layoutSortKey(a.name) - layoutSortKey(b.name));

  if (layoutFiles.length === 0) {
    return fail(label, `"${label}" is not a usable PowerPoint template: it has no slide layouts.`);
  }

  const layouts = [];
  for (const entry of layoutFiles) {
    let xmlText = "";
    try {
      xmlText = await entry.async("string");
    } catch {
      // One unreadable layout part does not sink the whole template - skip
      // it and still report every layout that could be read.
      continue;
    }
    const meta = readLayoutMeta(xmlText);
    layouts.push({ file: entry.name, name: meta.name, type: meta.type });
  }

  if (layouts.length === 0) {
    return fail(label, `"${label}"'s slide layouts could not be read.`);
  }

  return {
    ok: true,
    fileName: label,
    layouts,
    titleLayout: selectLayout(layouts, { types: TITLE_TYPES, nameRe: TITLE_NAME_RE }),
    titleContentLayout: selectLayout(layouts, { types: CONTENT_TYPES, nameRe: CONTENT_NAME_RE }),
  };
}
