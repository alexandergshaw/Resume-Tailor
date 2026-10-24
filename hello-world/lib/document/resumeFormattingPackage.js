// Server-only package boundary. No browser DOM, filesystem extraction or URL resolution.
import { createHash } from "node:crypto";
import { createInflateRaw } from "node:zlib";
import { DOMParser } from "@xmldom/xmldom";
import JSZip from "jszip";

const MiB = 1024 * 1024;
const W = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
const REL = "http://schemas.openxmlformats.org/package/2006/relationships";
const CT = "http://schemas.openxmlformats.org/package/2006/content-types";
const MARKER = "resume-tailor/formatting-v1.json";
const hash = bytes => createHash("sha256").update(bytes).digest("hex");
const fail = (code, message) => { throw Object.assign(new Error(message), { code }); };
const utf8 = new TextDecoder("utf-8", { fatal: true });
const own = (value, key) => Object.prototype.hasOwnProperty.call(value, key);
function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}
function inputBytes(value) {
  if (value instanceof Uint8Array) return new Uint8Array(value);
  if (value instanceof ArrayBuffer) return new Uint8Array(value.slice(0));
  fail("invalid-package", "Provide DOCX bytes as a byte array.");
}
function nameOf(bytes) {
  let name;
  try { name = utf8.decode(bytes); } catch { fail("invalid-zip", "ZIP names must use canonical UTF-8."); }
  if (!name || name.includes("\0") || name.includes("\\") || name.startsWith("/") || /^[a-z]:/i.test(name) || name.split("/").some(p => p === "." || p === ".." || p === "" && name !== "/" && !name.endsWith("/"))) fail("invalid-zip", "ZIP contains an unsafe part name.");
  if (name.includes("//") || /[\u0000-\u001f]/.test(name)) fail("invalid-zip", "ZIP contains an unsafe part name.");
  return name;
}
function directory(bytes) {
  if (!bytes.length || bytes.length > 4 * MiB) fail("package-limit", "DOCX must be at most 4 MiB.");
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const u16 = at => { if (at < 0 || at + 2 > bytes.length) fail("invalid-zip", "Truncated ZIP."); return view.getUint16(at, true); };
  const u32 = at => { if (at < 0 || at + 4 > bytes.length) fail("invalid-zip", "Truncated ZIP."); return view.getUint32(at, true); };
  let end = -1;
  for (let at = bytes.length - 22; at >= Math.max(0, bytes.length - 65557); at--) {
    if (u32(at) === 0x06054b50 && at + 22 + u16(at + 20) === bytes.length) { end = at; break; }
  }
  if (end < 0) fail("invalid-zip", "ZIP end record is missing.");
  const count = u16(end + 10), size = u32(end + 12), start = u32(end + 16);
  if (u16(end + 4) || u16(end + 6) || u16(end + 8) !== count || count === 65535 || size === 0xffffffff || start === 0xffffffff) fail("unsupported-zip", "Multi-disk and ZIP64 packages are unsupported.");
  if (!count || count > 128 || size > 128 * 1024 || start + size !== end) fail("package-limit", "ZIP directory exceeds supported limits.");
  const entries = [], names = new Set(), ranges = [];
  let at = start, total = 0;
  for (let index = 0; index < count; index++) {
    if (at + 46 > end || u32(at) !== 0x02014b50) fail("invalid-zip", "Invalid ZIP directory entry.");
    const flags = u16(at + 8), method = u16(at + 10), crc = u32(at + 16), compressed = u32(at + 20), length = u32(at + 24);
    const nameLength = u16(at + 28), extra = u16(at + 30), comment = u16(at + 32), local = u32(at + 42);
    if (u16(at + 34) || [compressed, length, local].includes(0xffffffff)) fail("unsupported-zip", "ZIP64 and multi-disk entries are unsupported.");
    if (flags & ~0x0806 || flags & 0x0001 || flags & 0x0008 || ![0, 8].includes(method)) fail("unsupported-zip", "Encrypted, streamed-descriptor or unsupported ZIP entry.");
    if (at + 46 + nameLength + extra + comment > end) fail("invalid-zip", "Truncated ZIP directory entry.");
    const nameBytes = bytes.subarray(at + 46, at + 46 + nameLength), name = nameOf(nameBytes), folded = name.toLowerCase();
    if (names.has(folded)) fail("invalid-zip", "Duplicate ZIP part name.");
    names.add(folded);
    // ZIP64 extra fields are rejected even if sentinel sizes were forged away.
    let ex = at + 46 + nameLength;
    while (ex < at + 46 + nameLength + extra) {
      if (ex + 4 > at + 46 + nameLength + extra) fail("invalid-zip", "Malformed ZIP extra field.");
      const kind = u16(ex), len = u16(ex + 2);
      if (kind === 1) fail("unsupported-zip", "ZIP64 is unsupported.");
      ex += 4 + len;
      if (ex > at + 46 + nameLength + extra) fail("invalid-zip", "Malformed ZIP extra field.");
    }
    total += length;
    if (length > 2 * MiB || total > 12 * MiB || length > Math.max(1, compressed) * 100) fail("package-limit", "ZIP expansion exceeds supported limits.");
    if (local + 30 > start || u32(local) !== 0x04034b50 || u16(local + 6) !== flags || u16(local + 8) !== method || u32(local + 14) !== crc || u32(local + 18) !== compressed || u32(local + 22) !== length) fail("invalid-zip", "Local and central ZIP records disagree.");
    const localName = u16(local + 26), localExtra = u16(local + 28), dataAt = local + 30 + localName + localExtra;
    if (localName !== nameLength || dataAt > start || nameOf(bytes.subarray(local + 30, local + 30 + localName)) !== name || dataAt + compressed > start) fail("invalid-zip", "Invalid local ZIP part bounds.");
    let localField = local + 30 + localName;
    while (localField < dataAt) {
      if (localField + 4 > dataAt) fail("invalid-zip", "Malformed local ZIP extra field.");
      if (u16(localField) === 1) fail("unsupported-zip", "ZIP64 is unsupported.");
      localField += 4 + u16(localField + 2);
      if (localField > dataAt) fail("invalid-zip", "Malformed local ZIP extra field.");
    }
    ranges.push([local, dataAt + compressed]);
    entries.push({ name, method, crc, compressed, length, dataAt, directory: name.endsWith("/") });
    at += 46 + nameLength + extra + comment;
  }
  if (at !== start + size) fail("invalid-zip", "Unexpected ZIP directory bytes.");
  ranges.sort((a, b) => a[0] - b[0]);
  let next = 0;
  for (const [left, right] of ranges) { if (left !== next || right < left) fail("invalid-zip", "ZIP part regions overlap or contain unexplained bytes."); next = right; }
  if (next !== start) fail("invalid-zip", "ZIP has unexplained bytes before its directory.");
  return entries;
}
async function extract(bytes, entries) {
  const result = new Map(); let actualTotal = 0;
  for (const entry of entries) {
    const compressed = bytes.subarray(entry.dataAt, entry.dataAt + entry.compressed);
    let output;
    if (entry.method === 0) output = new Uint8Array(compressed);
    else output = await new Promise((resolve, reject) => {
      const stream = createInflateRaw(), parts = []; let length = 0, done = false;
      const stop = error => { if (!done) { done = true; stream.destroy(); reject(error); } };
      stream.on("data", chunk => {
        length += chunk.length;
        if (length > 2 * MiB || actualTotal + length > 12 * MiB || length > entry.length) { stop(Object.assign(new Error("Actual ZIP inflation exceeds supported bounds."), { code: "package-limit" })); return; }
        parts.push(chunk);
      });
      stream.on("error", error => stop(Object.assign(error, { code: "invalid-zip" })));
      stream.on("end", () => {
        if (stream.bytesWritten !== compressed.length) { stop(Object.assign(new Error("The DEFLATE region contains trailing or concatenated bytes."), { code: "invalid-zip" })); return; }
        if (!done) { done = true; resolve(new Uint8Array(Buffer.concat(parts, length))); }
      });
      stream.end(compressed);
    });
    actualTotal += output.length;
    if (output.length !== entry.length || crc32(output) !== entry.crc) fail("invalid-zip", "ZIP part length or CRC does not match its directory.");
    result.set(entry.name, output);
  }
  // Check JSZip sees exactly the already bounded package, without trusting its path normalization.
  let zip;
  try { zip = await JSZip.loadAsync(bytes, { createFolders: false }); } catch { fail("invalid-zip", "The bounded ZIP package could not be read."); }
  const zipNames = Object.keys(zip.files).sort(), names = [...result.keys()].sort();
  if (JSON.stringify(zipNames) !== JSON.stringify(names)) fail("invalid-zip", "ZIP readers disagree on package part names.");
  for (const name of names) if (!zip.files[name].dir && hash(await zip.files[name].async("uint8array")) !== hash(result.get(name))) fail("invalid-zip", "ZIP readers disagree on package content.");
  return result;
}
function xmlDocument(bytes, partName) {
  if (bytes.length > MiB) fail("package-limit", "An XML part exceeds 1 MiB.");
  let source;
  try { source = utf8.decode(bytes).replace(/^\uFEFF/, ""); } catch { fail("invalid-xml", "XML must use valid UTF-8."); }
  if (/<!\s*(?:DOCTYPE|ENTITY)\b/i.test(source) || /<\?(?!xml\s)/i.test(source) || /<\?xml\b[^?]*encoding\s*=\s*["'](?!utf-8["'])/i.test(source)) fail("invalid-xml", "DTD, entities, processing instructions or alternate encodings are unsupported.");
  if (/&(?!(?:amp|lt|gt|quot|apos|#\d+|#x[\da-f]+);)/i.test(source)) fail("invalid-xml", "XML contains an unsupported entity reference.");
  // Bound nesting before DOM construction. Tokens include comments/CDATA/quoted attributes.
  const tokens = source.match(/<!--[\s\S]*?-->|<!\[CDATA\[[\s\S]*?\]\]>|<\?xml[\s\S]*?\?>|<(?:[^>"']|"[^"]*"|'[^']*')*>/g) || [];
  let depth = 0, nodes = 0;
  for (const token of tokens) {
    if (token.startsWith("<!") || token.startsWith("<?")) continue;
    if (token.startsWith("</")) depth--;
    else { nodes++; if (!/\/\s*>$/.test(token)) depth++; }
    if (depth < 0 || depth > 64 || nodes > 50000) fail("package-limit", "XML nesting or node count exceeds supported bounds.");
  }
  if (depth !== 0) fail("invalid-xml", "XML nesting is malformed.");
  let doc;
  const reject = () => fail("invalid-xml", `Malformed XML in ${partName}.`);
  try { doc = new DOMParser({ errorHandler: { warning: reject, error: reject, fatalError: reject } }).parseFromString(source, "application/xml"); }
  catch (error) { if (error.code) throw error; reject(); }
  if (!doc?.documentElement || doc.doctype || doc.getElementsByTagName("parsererror").length) reject();
  let count = 0;
  const visit = (node, level) => {
    if (++count > 50000 || level > 64) fail("package-limit", "XML tree exceeds supported bounds.");
    if (node.nodeType === 1) {
      if (node.namespaceURI === "http://www.w3.org/2001/XInclude" || node.attributes.length > 64) fail("invalid-xml", "Unsupported XML inclusion or attributes.");
      for (let i = 0; i < node.attributes.length; i++) if (node.attributes[i].value.length > 4096) fail("package-limit", "XML attribute exceeds supported bounds.");
    }
    for (let child = node.firstChild; child; child = child.nextSibling) visit(child, level + 1);
  };
  visit(doc, 0);
  return doc;
}
function children(node) { return Array.from(node.childNodes || []).filter(child => child.nodeType === 1); }
function wAttr(node, name) { return node.getAttributeNS(W, name) || node.getAttribute(`w:${name}`); }
function normalizeTarget(part, target) {
  if (!target || /[\\\u0000-\u001f]/.test(target) || /^[a-z][a-z\d+.-]*:/i.test(target) || target.includes("#") || target.includes("?")) fail("invalid-relationships", "Unsafe relationship target.");
  let decoded;
  try { decoded = decodeURIComponent(target); } catch { fail("invalid-relationships", "Malformed relationship target."); }
  if (decoded.includes("\\") || decoded.includes("\0")) fail("invalid-relationships", "Unsafe relationship target.");
  const owner = part === "_rels/.rels" ? "" : part.replace(/_rels\/([^/]+)\.rels$/, "$1");
  const segments = decoded.startsWith("/") ? [] : owner.split("/").slice(0, -1);
  for (const segment of decoded.replace(/^\//, "").split("/")) {
    if (!segment || segment === ".") continue;
    if (segment === "..") { if (!segments.length) fail("invalid-relationships", "Relationship escapes the package."); segments.pop(); }
    else segments.push(segment);
  }
  return segments.join("/");
}
function validateOpc(parts, documents) {
  for (const required of ["[Content_Types].xml", "_rels/.rels", "word/document.xml"]) if (!parts.has(required)) fail("invalid-package", `Required DOCX part ${required} is missing.`);
  const types = documents.get("[Content_Types].xml");
  if (types.documentElement.localName !== "Types" || types.documentElement.namespaceURI !== CT) fail("invalid-package", "Invalid content type declarations.");
  const opcAttributes = (node, names) => {
    for (const attribute of Array.from(node.attributes)) {
      if (attribute.namespaceURI === "http://www.w3.org/2000/xmlns/") continue;
      if (attribute.namespaceURI || !names.includes(attribute.name)) fail("invalid-package", `Unsupported OPC attribute ${attribute.name}.`);
    }
  };
  opcAttributes(types.documentElement, []);
  const defaults = new Map(), overrides = new Map();
  for (const item of children(types.documentElement)) {
    if (item.namespaceURI !== CT || !["Default", "Override"].includes(item.localName)) fail("invalid-package", "Unsupported content type declaration.");
    opcAttributes(item, item.localName === "Default" ? ["Extension", "ContentType"] : ["PartName", "ContentType"]);
    if (children(item).length) fail("invalid-package", "Content declarations cannot contain nested elements.");
    const contentType = item.getAttribute("ContentType");
    if (!contentType || /macro|oleObject|activeX|vba/i.test(contentType)) fail("unsupported-package", "Active package content is unsupported.");
    if (item.localName === "Default") { const extension = item.getAttribute("Extension"); if (!extension || defaults.has(extension)) fail("invalid-package", "Duplicate content declaration."); defaults.set(extension, contentType); }
    else { const name = item.getAttribute("PartName"); if (!name.startsWith("/") || !parts.has(name.slice(1)) || overrides.has(name.slice(1))) fail("invalid-package", "Invalid part declaration."); overrides.set(name.slice(1), contentType); }
  }
  for (const name of parts.keys()) {
    if (name.endsWith("/") || name === "[Content_Types].xml") continue;
    if (!overrides.has(name) && !defaults.has(name.split(".").pop())) fail("invalid-package", "A package part has no content type.");
    if (/\.(?:exe|dll|bin|js|vbs|com)$/i.test(name) || /(?:embeddings|activeX|vbaProject)\//i.test(name)) fail("unsupported-package", "Executable or embedded package content is unsupported.");
  }
  if ((overrides.get("word/document.xml") || defaults.get("xml")) !== "application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml") fail("invalid-package", "The main document must declare the supported Word document content type.");
  let mainRelationship = false;
  for (const [name, doc] of documents) {
    if (!name.endsWith(".rels")) continue;
    if (doc.documentElement.namespaceURI !== REL || doc.documentElement.localName !== "Relationships") fail("invalid-relationships", "Invalid relationships part.");
    opcAttributes(doc.documentElement, []);
    const ids = new Set();
    for (const item of children(doc.documentElement)) {
      const id = item.getAttribute("Id"), type = item.getAttribute("Type"), target = item.getAttribute("Target");
      opcAttributes(item, ["Id", "Type", "Target", "TargetMode"]);
      if (children(item).length) fail("invalid-relationships", "Relationships cannot contain nested elements.");
      if (item.localName !== "Relationship" || item.namespaceURI !== REL || !id || ids.has(id) || !type || item.getAttribute("TargetMode")) fail("invalid-relationships", "External or malformed relationships are unsupported.");
      ids.add(id);
      if (/altChunk|aFChunk|oleObject|attachedTemplate|hyperlink|image|vbaProject|package$/i.test(type)) fail("unsupported-package", "Unsupported active, linked or graphical relationship.");
      const resolved = normalizeTarget(name, target);
      if (!parts.has(resolved)) fail("invalid-relationships", "Relationship target is missing.");
      if (name === "_rels/.rels" && /\/officeDocument$/.test(type) && resolved === "word/document.xml") mainRelationship = true;
    }
  }
  if (!mainRelationship) fail("invalid-package", "The package does not identify its main document.");
}
const P_PROPERTIES = new Set(["pStyle", "jc", "spacing", "ind", "tabs", "numPr", "keepNext", "keepLines", "widowControl", "outlineLvl", "contextualSpacing"]);
const R_PROPERTIES = new Set(["rStyle", "rFonts", "b", "i", "u", "sz", "szCs", "color", "lang", "bCs", "iCs"]);
const integer = (min, max) => value => /^-?\d+$/.test(value) && Number(value) >= min && Number(value) <= max;
const values = (...allowed) => value => allowed.includes(value);
const boolean = values("0", "1", "true", "false", "on", "off");
const identifier = value => /^[A-Za-z0-9_-]{1,128}$/.test(value);
const PROPERTY_ATTRIBUTES = {
  pStyle: { val: identifier }, rStyle: { val: identifier }, jc: { val: values("left", "right", "center", "both", "start", "end") },
  spacing: { before: integer(0, 31680), after: integer(0, 31680), line: integer(240, 720), lineRule: values("auto"), beforeAutospacing: boolean, afterAutospacing: boolean },
  ind: { left: integer(-31680, 31680), right: integer(-31680, 31680), start: integer(-31680, 31680), end: integer(-31680, 31680), firstLine: integer(0, 31680), hanging: integer(0, 31680) },
  keepNext: { val: boolean }, keepLines: { val: boolean }, widowControl: { val: boolean }, contextualSpacing: { val: boolean }, outlineLvl: { val: integer(0, 8) },
  b: { val: boolean }, i: { val: boolean }, bCs: { val: boolean }, iCs: { val: boolean },
  u: { val: values("single", "none") }, sz: { val: integer(16, 144) }, szCs: { val: integer(16, 144) },
  color: { val: value => /^(?:[a-f\d]{6}|auto)$/i.test(value) },
  rFonts: { ascii: value => value.length > 0 && value.length <= 128, hAnsi: value => value.length > 0 && value.length <= 128, eastAsia: value => value.length > 0 && value.length <= 128, cs: value => value.length > 0 && value.length <= 128, hint: values("default", "eastAsia", "cs") },
  lang: { val: value => /^[a-z]{2,8}(?:-[a-z\d]{1,8})*$/i.test(value), eastAsia: value => /^[a-z]{2,8}(?:-[a-z\d]{1,8})*$/i.test(value), bidi: value => /^[a-z]{2,8}(?:-[a-z\d]{1,8})*$/i.test(value) },
  ilvl: { val: integer(0, 8) }, numId: { val: integer(0, 2147483647) },
  tab: { val: values("left", "center", "right", "decimal"), pos: integer(0, 31680), leader: values("none", "dot", "hyphen", "underscore") }, tabs: {}, numPr: {},
};
function checkedAttributes(node, schema, required = []) {
  const attributes = {};
  for (const attribute of Array.from(node.attributes || [])) {
    if (attribute.namespaceURI === "http://www.w3.org/2000/xmlns/") continue;
    if (attribute.namespaceURI !== W || !own(schema, attribute.localName) || !schema[attribute.localName](attribute.value)) fail("unsupported-format", `Unsupported ${node.nodeName} attribute/value ${attribute.name}.`);
    attributes[attribute.localName] = attribute.value;
  }
  for (const key of required) if (!own(attributes, key)) fail("unsupported-format", `Required ${node.nodeName} attribute ${key} is missing.`);
  return attributes;
}
function propertyModel(parent, allowed) {
  const properties = [];
  const seen = new Set();
  for (const item of children(parent)) {
    if (item.namespaceURI !== W || !allowed.has(item.localName) || seen.has(item.localName)) fail("unsupported-format", `Unsupported or duplicate formatting property ${item.nodeName}.`);
    seen.add(item.localName);
    const required = ["pStyle", "rStyle", "jc", "outlineLvl", "sz", "szCs", "color"].includes(item.localName) ? ["val"] : [];
    const attributes = checkedAttributes(item, PROPERTY_ATTRIBUTES[item.localName], required);
    if (Array.from(item.childNodes).some(child => [3, 4].includes(child.nodeType) && child.data.trim())) fail("unsupported-format", "Formatting properties cannot contain loose text.");
    const childIdentities = new Set();
    properties.push({ name: item.localName, attributes, children: children(item).map(child => {
      const accepted = item.localName === "numPr" ? ["ilvl", "numId"] : item.localName === "tabs" ? ["tab"] : [];
      if (child.namespaceURI !== W || !accepted.includes(child.localName)) fail("unsupported-format", "Unsupported nested formatting property.");
      const attrs = checkedAttributes(child, PROPERTY_ATTRIBUTES[child.localName], child.localName === "tab" ? ["val", "pos"] : ["val"]);
      const identity = child.localName === "tab" ? `tab:${attrs.pos}` : child.localName;
      if (childIdentities.has(identity)) fail("unsupported-format", "Duplicate nested formatting property.");
      childIdentities.add(identity);
      if (children(child).length) fail("unsupported-format", "Nested leaf formatting content is unsupported.");
      if (child.localName === "ilvl" && (!/^\d+$/.test(wAttr(child, "val")) || Number(wAttr(child, "val")) > 8)) fail("unsupported-format", "List nesting exceeds supported levels.");
      return { name: child.localName, attributes: attrs };
    }) });
  }
  return properties;
}
function sectionModel(section) {
  checkedAttributes(section, { rsidR: value => /^[a-f\d]{8}$/i.test(value), rsidSect: value => /^[a-f\d]{8}$/i.test(value) });
  const schema = {
    pgSz: { w: integer(1440, 31680), h: integer(1440, 31680), orient: values("portrait", "landscape"), code: integer(0, 255) },
    pgMar: { top: integer(0, 31680), bottom: integer(0, 31680), left: integer(0, 31680), right: integer(0, 31680), header: integer(0, 31680), footer: integer(0, 31680), gutter: integer(0, 31680) },
    cols: { num: values("1"), space: integer(0, 31680), equalWidth: values("1", "true", "on") },
    type: { val: values("continuous", "nextPage", "evenPage", "oddPage") }, titlePg: { val: boolean },
    docGrid: { type: values("default"), linePitch: integer(0, 31680), charSpace: values("0") },
  };
  const seen = new Set(), properties = [];
  for (const item of children(section)) {
    if (item.namespaceURI !== W || !own(schema, item.localName) || seen.has(item.localName) || children(item).length) fail("unsupported-format", `Unsupported section configuration ${item.nodeName}.`);
    seen.add(item.localName);
    const required = item.localName === "pgSz" ? ["w", "h"] : item.localName === "pgMar" ? ["top", "bottom", "left", "right"] : item.localName === "type" ? ["val"] : [];
    properties.push({ name: item.localName, attributes: checkedAttributes(item, schema[item.localName], required) });
  }
  const size = properties.find(item => item.name === "pgSz")?.attributes, margins = properties.find(item => item.name === "pgMar")?.attributes;
  if (size && margins && (Number(margins.left) + Number(margins.right) >= Number(size.w) || Number(margins.top) + Number(margins.bottom) >= Number(size.h))) fail("unsupported-format", "Section margins leave no usable page area.");
  return properties;
}
function stylesModel(doc) {
  const styles = new Map(); let defaults = null;
  if (!doc) return { styles, defaults };
  if (doc.documentElement.namespaceURI !== W || doc.documentElement.localName !== "styles") fail("unsupported-format", "Invalid styles namespace.");
  for (const node of children(doc.documentElement)) {
    if (node.namespaceURI !== W) fail("unsupported-format", "Unsupported style namespace.");
    if (node.localName === "docDefaults") {
      if (defaults) fail("unsupported-format", "Duplicate document style defaults.");
      checkedAttributes(node, {}); defaults = {};
      for (const item of children(node)) {
        if (item.namespaceURI !== W || !["pPrDefault", "rPrDefault"].includes(item.localName) || own(defaults, item.localName)) fail("unsupported-format", "Unsupported document defaults.");
        checkedAttributes(item, {});
        const props = children(item), expected = item.localName === "pPrDefault" ? "pPr" : "rPr";
        if (props.length > 1 || props.some(property => property.namespaceURI !== W || property.localName !== expected)) fail("unsupported-format", "Invalid default properties.");
        defaults[item.localName] = props.length ? propertyModel(props[0], expected === "pPr" ? P_PROPERTIES : R_PROPERTIES) : [];
      }
      continue;
    }
    if (node.localName !== "style") fail("unsupported-format", `Unsupported stylesheet element ${node.nodeName}.`);
    const attrs = checkedAttributes(node, { type: values("paragraph", "character", "numbering"), styleId: identifier, default: boolean, customStyle: boolean }, ["type", "styleId"]);
    if (styles.has(attrs.styleId)) fail("unsupported-format", "Duplicate style identity.");
    const style = { ...attrs, properties: [], runProperties: [], metadata: {} };
    for (const item of children(node)) {
      if (item.namespaceURI !== W || own(style.metadata, item.localName)) fail("unsupported-format", "Duplicate or unsupported style property.");
      if (item.localName === "pPr") { checkedAttributes(item, {}); style.properties = propertyModel(item, P_PROPERTIES); style.metadata.pPr = true; }
      else if (item.localName === "rPr") { checkedAttributes(item, {}); style.runProperties = propertyModel(item, R_PROPERTIES); style.metadata.rPr = true; }
      else {
        const schema = { name: { val: value => value.length > 0 && value.length <= 256 }, basedOn: { val: identifier }, next: { val: identifier }, link: { val: identifier }, uiPriority: { val: integer(0, 99) }, qFormat: { val: boolean }, semiHidden: { val: boolean }, unhideWhenUsed: { val: boolean }, autoRedefine: { val: boolean }, hidden: { val: boolean }, locked: { val: boolean } };
        if (!own(schema, item.localName) || children(item).length) fail("unsupported-format", `Unsupported style property ${item.nodeName}.`);
        style.metadata[item.localName] = checkedAttributes(item, schema[item.localName], ["name", "basedOn", "next", "link", "uiPriority"].includes(item.localName) ? ["val"] : []);
      }
    }
    styles.set(attrs.styleId, style);
  }
  for (const style of styles.values()) {
    for (const key of ["basedOn", "next", "link"]) if (style.metadata[key] && !styles.has(style.metadata[key].val)) fail("unsupported-format", "Style references an absent definition.");
    const visited = new Set(); let current = style;
    while (current?.metadata.basedOn) { if (visited.has(current.styleId)) fail("unsupported-format", "Cyclic style inheritance is unsupported."); visited.add(current.styleId); current = styles.get(current.metadata.basedOn.val); }
  }
  return { styles, defaults };
}
function numberingModel(doc) {
  const abstract = new Map(), numbers = new Map();
  if (!doc) return { abstract, numbers };
  if (doc.documentElement.namespaceURI !== W || doc.documentElement.localName !== "numbering") fail("unsupported-format", "Invalid numbering namespace.");
  checkedAttributes(doc.documentElement, {});
  for (const node of children(doc.documentElement)) {
    if (node.namespaceURI !== W) fail("unsupported-format", "Unsupported numbering content.");
    if (node.localName === "abstractNum") {
      const attrs = checkedAttributes(node, { abstractNumId: integer(0, 2147483647) }, ["abstractNumId"]), id = attrs.abstractNumId;
      if (abstract.has(id)) fail("unsupported-format", "Duplicate abstract list identity.");
      const levels = new Map();
      for (const child of children(node)) {
        if (child.namespaceURI !== W) fail("unsupported-format", "Unsupported abstract numbering content.");
        if (["nsid", "tmpl"].includes(child.localName)) { checkedAttributes(child, { val: value => /^[a-f\d]{8}$/i.test(value) }, ["val"]); if (children(child).length) fail("unsupported-format", "Unsupported list metadata."); continue; }
        if (child.localName === "multiLevelType") { checkedAttributes(child, { val: values("singleLevel", "multilevel", "hybridMultilevel") }, ["val"]); if (children(child).length) fail("unsupported-format", "Unsupported list metadata."); continue; }
        if (child.localName !== "lvl") fail("unsupported-format", `Unsupported numbering element ${child.nodeName}.`);
        const levelAttributes = checkedAttributes(child, { ilvl: integer(0, 8), tplc: value => /^[a-f\d]{8}$/i.test(value), tentative: boolean }, ["ilvl"]);
        if (levels.has(levelAttributes.ilvl)) fail("unsupported-format", "Duplicate list level.");
        const level = { level: Number(levelAttributes.ilvl), start: 1, format: null, text: null, properties: [], runProperties: [] }, seen = new Set();
        for (const item of children(child)) {
          if (item.namespaceURI !== W || seen.has(item.localName)) fail("unsupported-format", "Unsupported duplicate list level property.");
          seen.add(item.localName);
          if (item.localName === "pPr") { checkedAttributes(item, {}); level.properties = propertyModel(item, P_PROPERTIES); continue; }
          if (item.localName === "rPr") { checkedAttributes(item, {}); level.runProperties = propertyModel(item, R_PROPERTIES); continue; }
          const schemas = { start: { val: integer(0, 2147483647) }, numFmt: { val: values("decimal", "decimalZero", "lowerRoman", "upperRoman", "lowerLetter", "upperLetter", "bullet", "none") }, lvlText: { val: value => value.length <= 256 }, lvlJc: { val: values("left", "center", "right") }, suff: { val: values("tab", "space", "nothing") }, lvlRestart: { val: integer(0, 8) } };
          if (!own(schemas, item.localName) || children(item).length) fail("unsupported-format", `Unsupported list property ${item.nodeName}.`);
          const attrs = checkedAttributes(item, schemas[item.localName], ["val"]);
          if (item.localName === "start") level.start = Number(attrs.val);
          else if (item.localName === "numFmt") level.format = attrs.val;
          else if (item.localName === "lvlText") level.text = attrs.val;
          else level[item.localName] = attrs.val;
        }
        if (level.format === null || level.text === null) fail("unsupported-format", "List levels need explicit supported format and label.");
        levels.set(levelAttributes.ilvl, level);
      }
      if (!levels.size) fail("unsupported-format", "Abstract list contains no supported levels.");
      abstract.set(id, levels);
    } else if (node.localName === "num") {
      const attrs = checkedAttributes(node, { numId: integer(1, 2147483647) }, ["numId"]), items = children(node);
      if (numbers.has(attrs.numId) || items.length !== 1 || items[0].namespaceURI !== W || items[0].localName !== "abstractNumId" || children(items[0]).length) fail("unsupported-format", "Unsupported list override or duplicate list identity.");
      const reference = checkedAttributes(items[0], { val: integer(0, 2147483647) }, ["val"]);
      numbers.set(attrs.numId, reference.val);
    } else fail("unsupported-format", `Unsupported numbering element ${node.nodeName}.`);
  }
  for (const ref of numbers.values()) if (!abstract.has(ref)) fail("unsupported-format", "List references an absent abstract definition.");
  return { abstract, numbers };
}
function parseMain(doc, documents) {
  if (doc.documentElement.namespaceURI !== W || doc.documentElement.localName !== "document") fail("invalid-package", "Invalid main document namespace.");
  checkedAttributes(doc.documentElement, {});
  const bodies = children(doc.documentElement).filter(item => item.namespaceURI === W && item.localName === "body");
  if (bodies.length !== 1 || children(doc.documentElement).length !== 1) fail("unsupported-format", "Only one main document body is supported.");
  checkedAttributes(bodies[0], {});
  const paragraphs = [], sections = [];
  const noLooseText = parent => {
    for (const child of Array.from(parent.childNodes || [])) if ((child.nodeType === 3 || child.nodeType === 4) && child.data.trim()) fail("unsupported-format", "Text outside a supported text run is unsupported.");
  };
  noLooseText(bodies[0]);
  for (const node of children(bodies[0])) {
    if (node.namespaceURI !== W) fail("unsupported-format", "Unsupported main document content.");
    if (node.localName === "sectPr") { sections.push(sectionModel(node)); continue; }
    if (sections.length || node.localName !== "p") fail("unsupported-format", "Tables, multiple sections and complex body content are unsupported.");
    const revisionAttributes = { rsidR: value => /^[a-f\d]{8}$/i.test(value), rsidRPr: value => /^[a-f\d]{8}$/i.test(value), rsidP: value => /^[a-f\d]{8}$/i.test(value), rsidRDefault: value => /^[a-f\d]{8}$/i.test(value) };
    checkedAttributes(node, revisionAttributes);
    if (children(node).filter(child => child.namespaceURI === W && child.localName === "pPr").length > 1) fail("unsupported-format", "Duplicate paragraph properties.");
    noLooseText(node);
    const paragraph = { text: "", properties: [], runs: [] };
    for (const child of children(node)) {
      if (child.namespaceURI !== W) fail("unsupported-format", "Unsupported paragraph content.");
      if (child.localName === "pPr") { checkedAttributes(child, {}); paragraph.properties.push(...propertyModel(child, P_PROPERTIES)); continue; }
      if (child.localName !== "r") fail("unsupported-format", "Fields, links, tracked changes and embedded content are unsupported.");
      checkedAttributes(child, revisionAttributes);
      if (children(child).filter(item => item.namespaceURI === W && item.localName === "rPr").length > 1) fail("unsupported-format", "Duplicate run properties.");
      noLooseText(child);
      const run = { text: "", properties: [] };
      for (const item of children(child)) {
        if (item.namespaceURI !== W) fail("unsupported-format", "Unsupported run content.");
        if (item.localName === "rPr") { checkedAttributes(item, {}); run.properties.push(...propertyModel(item, R_PROPERTIES)); }
        else if (item.localName === "t") {
          for (const attribute of Array.from(item.attributes)) if (attribute.namespaceURI !== "http://www.w3.org/2000/xmlns/" && !(attribute.namespaceURI === "http://www.w3.org/XML/1998/namespace" && attribute.localName === "space" && ["preserve", "default"].includes(attribute.value))) fail("unsupported-format", "Unsupported text attribute.");
          if (children(item).length) fail("invalid-package", "Nested text markup is invalid."); run.text += item.textContent;
        }
        else if (item.localName === "tab") { checkedAttributes(item, {}); if (children(item).length) fail("unsupported-format", "Unsupported tab content."); run.text += "\t"; }
        else if (item.localName === "br" && (!wAttr(item, "type") || wAttr(item, "type") === "textWrapping")) { checkedAttributes(item, { type: values("textWrapping"), clear: values("none") }); if (children(item).length) fail("unsupported-format", "Unsupported break content."); run.text += "\n"; }
        else fail("unsupported-format", "Unsupported run property or page break.");
      }
      paragraph.text += run.text; paragraph.runs.push(run);
    }
    paragraphs.push(paragraph);
  }
  if (sections.length > 1) fail("unsupported-format", "Multiple sections are unsupported.");
  for (const [name, xml] of documents) {
    if (/word\/(?:header|footer)[^/]*\.xml$/i.test(name) && Array.from(xml.getElementsByTagNameNS(W, "t")).some(t => t.textContent.trim())) fail("unsupported-format", "Header/footer text is not editable in this surface.");
    if (name === "word/numbering.xml" && (xml.getElementsByTagNameNS(W, "lvlOverride").length || xml.getElementsByTagNameNS(W, "startOverride").length)) fail("unsupported-format", "Numbering overrides are unsupported.");
    if (["word/styles.xml", "word/numbering.xml"].includes(name)) {
      for (const property of Array.from(xml.getElementsByTagNameNS(W, "pPr"))) propertyModel(property, P_PROPERTIES);
      for (const property of Array.from(xml.getElementsByTagNameNS(W, "rPr"))) propertyModel(property, R_PROPERTIES);
    }
  }
  const numbering = numberingModel(documents.get("word/numbering.xml"));
  const styles = stylesModel(documents.get("word/styles.xml"));
  for (const paragraph of paragraphs) {
    // Owner ruling: do not claim supported inheritance for numbered paragraph styles.
    const explicitStyle = paragraph.properties.find(property => property.name === "pStyle")?.attributes.val;
    let paragraphStyle = explicitStyle ? styles.styles.get(explicitStyle) : [...styles.styles.values()].find(style => style.type === "paragraph" && ["1", "true", "on"].includes(style.default));
    while (paragraphStyle) {
      if (paragraphStyle.properties.some(property => property.name === "numPr")) fail("unsupported-numbered-style", "This paragraph uses numbering from a paragraph style or its basedOn inheritance. Numbered styles are not supported for formatting cleanup yet. Original bytes retained.");
      paragraphStyle = styles.styles.get(paragraphStyle.metadata.basedOn?.val);
    }
    for (const property of [...paragraph.properties, ...paragraph.runs.flatMap(run => run.properties)]) if (["pStyle", "rStyle"].includes(property.name) && !styles.styles.has(property.attributes.val)) fail("unsupported-format", "Paragraph or run references an absent style definition.");
    const number = paragraph.properties.find(property => property.name === "numPr");
    if (!number) continue;
    const id = number.children.find(property => property.name === "numId")?.attributes.val;
    const level = number.children.find(property => property.name === "ilvl")?.attributes.val || "0";
    if (!id) fail("unsupported-format", "A list paragraph is missing its list identity.");
    if (id !== "0" && !numbering.abstract.get(numbering.numbers.get(id))?.has(level)) fail("unsupported-format", "A paragraph references an absent list or level.");
  }
  return { paragraphs, semanticText: paragraphs.map(p => p.text).join("\n"), sectionCount: sections.length, sections,
    styles: { definitions: Object.fromEntries(styles.styles), defaults: styles.defaults },
    numbering: { abstract: Object.fromEntries([...numbering.abstract].map(([id, levels]) => [id, Object.fromEntries(levels)])), numbers: Object.fromEntries(numbering.numbers) } };
}
function checkMarker(parts, expected, role, semanticText, mainPartHash) {
  const markerBytes = parts.get(MARKER);
  if (!markerBytes) { if (role !== "original") fail("invalid-marker", "Formatting artifact marker is missing."); return null; }
  if (markerBytes.length > 128 * 1024) fail("package-limit", "Formatting marker exceeds supported bounds.");
  let marker;
  try { marker = JSON.parse(utf8.decode(markerBytes)); } catch { fail("invalid-marker", "Formatting marker is invalid JSON."); }
  if (!marker || typeof marker !== "object" || Array.isArray(marker) || marker.schemaVersion !== 1 || marker.kind !== "resume-formatting") fail("invalid-marker", "Unsupported formatting marker.");
  if (marker.mainPartHash !== mainPartHash || marker.textHash !== hash(Buffer.from(semanticText, "utf8"))) fail("invalid-marker", "Formatting marker does not match actual document content.");
  if (role !== "original" && marker.role !== role) fail("invalid-marker", "Formatting marker role does not match this operation.");
  const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
  if (role !== "original") {
    for (const key of ["pairId", "operationId", "versionId", "baseVersionId"]) if (typeof marker[key] !== "string" || !uuid.test(marker[key])) fail("invalid-marker", "Formatting operation identities are missing or malformed.");
    for (const key of ["captureId", "htmlHash", "textHash"]) if (typeof marker[key] !== "string" || !/^[a-f0-9]{64}$/.test(marker[key])) fail("invalid-marker", "Formatting capture identity is missing or malformed.");
    if (marker.serializerVersion !== 1 || !Array.isArray(marker.appliedChanges) || marker.appliedChanges.length > 128) fail("invalid-marker", "Formatting serializer or applied changes are invalid.");
  }
  for (const key of ["accountId", "applicationId", "pairId", "operationId", "versionId", "baseVersionId", "parentVersionId", "captureId", "textHash", "htmlHash"]) {
    if (own(expected, key) && marker[key] !== expected[key]) fail("invalid-marker", `Formatting marker ${key} does not match the expected operation.`);
  }
  return marker;
}

export async function validateFormattingPackage({ bytes, expected = {}, role } = {}) {
  try {
    if (!["original", "before", "cleanup"].includes(role) || !expected || typeof expected !== "object" || Array.isArray(expected)) fail("invalid-request", "A package role and expected identity are required.");
    const originalBytes = inputBytes(bytes), byteHash = hash(originalBytes);
    if (own(expected, "byteHash") && expected.byteHash !== byteHash) fail("identity-mismatch", "DOCX byte identity does not match this operation.");
    const parts = await extract(originalBytes, directory(originalBytes)), documents = new Map();
    let xmlTotal = 0;
    for (const [name, content] of parts) if (/\.(?:xml|rels)$/i.test(name)) {
      xmlTotal += content.length;
      if (xmlTotal > 6 * MiB) fail("package-limit", "Aggregate XML exceeds supported bounds.");
      documents.set(name, xmlDocument(content, name));
    }
    validateOpc(parts, documents);
    const model = parseMain(documents.get("word/document.xml"), documents), semanticText = model.semanticText;
    const textHash = hash(Buffer.from(semanticText, "utf8")), mainPartHash = hash(parts.get("word/document.xml"));
    for (const key of ["semanticText", "text"]) if (own(expected, key) && expected[key].replace(/\r\n/g, "\n") !== semanticText) fail("text-mismatch", "Document wording does not match the frozen current draft.");
    if (own(expected, "textHash") && expected.textHash !== textHash) fail("text-mismatch", "Document text identity does not match this operation.");
    const marker = checkMarker(parts, expected, role, semanticText, mainPartHash);
    const partHashes = Object.fromEntries([...parts].map(([name, content]) => [name, hash(content)]));
    return { ok: true, package: { byteHash, semanticText, textHash, mainPartHash, marker, model, partHashes, originalBytes }, code: null, error: null };
  } catch (error) {
    return { ok: false, package: null, code: error?.code || "invalid-package", error: error?.code ? error.message : "The DOCX package could not be validated. Original retained." };
  }
}
