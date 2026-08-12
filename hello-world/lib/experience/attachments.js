// Attachment rules for project pages: what kind of file a given upload is
// (and whether it's small enough to accept), and the storage key it gets
// inside the existing `resumes` bucket. Pure — no Supabase import, no
// browser API — so both the API route and AttachmentPanel.js can call the
// same logic and never disagree about a size cap or a sanitized name.
//
// See lib/experience/attachments.test.js for the contract this file exists
// to satisfy. Revision 2, after an audit ran 27 mutants against the first
// draft and 13 survived — including three of that draft's own "hostile
// filename" fixtures, which turned out to assert nothing at all. Two things
// came out of it, both load-bearing:
//
//  1. storagePathFor takes the attachment's id and puts it IN the key
//     (`${userId}/experience/${pageId}/${attachmentId}-${safeName}`), so
//     uniqueness is never the sanitizer's job — a same-named upload from
//     two different attachments can never collide.
//  2. The sanitize pipeline runs in a SPECIFIC order (see sanitizeSegment
//     below). A variant that passed the entire first draft still emitted
//     "../../other-user/resume.docx" from fullwidth characters that
//     NFKC-fold into "." and "/", because it normalized at the END of its
//     pipeline instead of the start.

const MB = 1024 * 1024;
const VIDEO_CAP_BYTES = 100 * MB;
const DEFAULT_CAP_BYTES = 25 * MB;

// Extension -> kind, consulted only when the mime type (if any) doesn't
// already say what this is. Case is normalized before lookup, so "shot.PNG"
// and "shot.png" resolve the same way.
const EXTENSION_KIND = {
  png: "image",
  jpg: "image",
  jpeg: "image",
  gif: "image",
  webp: "image",
  bmp: "image",
  svg: "image",
  heic: "image",
  heif: "image",
  pdf: "pdf",
  mp4: "video",
  mov: "video",
  webm: "video",
  avi: "video",
  mkv: "video",
  m4v: "video",
  txt: "text",
  md: "text",
  markdown: "text",
  csv: "text",
  json: "text",
  log: "text",
  rtf: "text",
  doc: "text",
  docx: "text",
  pages: "text",
  odt: "text",
};

function extensionOf(name) {
  const s = String(name);
  const dot = s.lastIndexOf(".");
  if (dot <= 0 || dot === s.length - 1) return "";
  return s.slice(dot + 1).toLowerCase();
}

function kindFromMime(mime) {
  const m = String(mime || "").toLowerCase().trim();
  if (!m) return "";
  if (m.startsWith("image/")) return "image";
  if (m === "application/pdf") return "pdf";
  if (m.startsWith("video/")) return "video";
  if (m.startsWith("text/")) return "text";
  if (
    m === "application/msword" ||
    m === "application/vnd.openxmlformats-officedocument.wordprocessingml.document" ||
    m === "application/rtf"
  ) {
    return "text";
  }
  return "";
}

function kindOf(name, mime) {
  return kindFromMime(mime) || EXTENSION_KIND[extensionOf(name)] || "other";
}

function capFor(kind) {
  return kind === "video" ? VIDEO_CAP_BYTES : DEFAULT_CAP_BYTES;
}

function mbLabel(bytes) {
  return `${Math.round(bytes / MB)} MB`;
}

// classifyAttachment({ name, type, size }) -> { kind, ok, reason }.
//
// `kind` is decided first, from the mime type falling back to the
// extension, and is never affected by size — a 200 MB video is still
// `kind: "video"` even though `ok` is false, so the UI can show the right
// icon beside a "too large" message instead of an anonymous "other".
// `kind: "other"` (an unrecognized type) is always rejected regardless of
// size: defaulting an unknown extension to "text" would hand a model
// arbitrary binary as if it were readable context.
export function classifyAttachment(input) {
  const src = input && typeof input === "object" ? input : {};
  const name = typeof src.name === "string" && src.name ? src.name : "file";
  const type = typeof src.type === "string" ? src.type : "";
  const size = src.size;

  const kind = kindOf(name, type);

  if (kind === "other") {
    return { kind, ok: false, reason: `"${name}" is not a supported file type.` };
  }

  const sizeIsReadable = typeof size === "number" && Number.isFinite(size) && size > 0;
  if (!sizeIsReadable) {
    return { kind, ok: false, reason: `"${name}" has no readable file size.` };
  }

  const cap = capFor(kind);
  if (size > cap) {
    return { kind, ok: false, reason: `"${name}" is over the ${mbLabel(cap)} limit.` };
  }

  return { kind, ok: true, reason: "" };
}

// The final segment cannot exceed this many characters — it is checked
// AFTER every transform below, because NFKC can expand one character into
// four (e.g. U+337F "㍿" -> "株式会社"); truncating before normalizing would
// let a name that looks short overflow the cap once expanded.
export const MAX_SEGMENT = 120;

const PLAIN_ID_RE = /^[A-Za-z0-9_-]+$/;

function assertPlainId(value, label) {
  if (typeof value !== "string" || !PLAIN_ID_RE.test(value)) {
    throw new Error(`Invalid ${label}: must be a plain identifier.`);
  }
}

// Code points no storage key segment may contain — C0/C1 controls, the
// zero-width/line/paragraph separators, bidi override and isolate
// characters, and the BOM. Built as ranges rather than typed escapes so
// this file (like its test) carries no literal invisible characters.
const FORBIDDEN_RANGES = [
  [0x0000, 0x001f],
  [0x007f, 0x009f],
  [0x200b, 0x200f],
  [0x2028, 0x2029],
  [0x202a, 0x202e],
  [0x2066, 0x2069],
  [0xfeff, 0xfeff],
];

function isForbiddenCodePoint(cp) {
  return FORBIDDEN_RANGES.some(([lo, hi]) => cp >= lo && cp <= hi);
}

function stripForbidden(s) {
  let out = "";
  for (const ch of s) {
    if (!isForbiddenCodePoint(ch.codePointAt(0))) out += ch;
  }
  return out;
}

// Normalizes and percent-decodes TOGETHER, to a fixed point, rather than
// normalizing once and then decoding: a percent-encoded fullwidth separator
// (e.g. "%EF%BC%8F" -> U+FF0F) is produced BY the decode, so a single
// normalize-then-decode pass never folds it — it survives into the key as
// an ordinary-looking character today and only turns into "/" the moment
// anything downstream (a log viewer, an export, an NFKC-aware filesystem)
// normalizes it. Each round normalizes first, then decodes; if decoding
// changed anything, the loop goes around again so the newly-decoded text
// gets its own normalize pass before the next decode attempt. A malformed
// sequence (caught by decodeURIComponent) or 15 rounds of no progress stops
// it, mirroring the same cap this file used for decode-only exhaustion.
// Returns { value, exhausted }. `exhausted` is true only when all 15 rounds
// ran without either the try/catch or the convergence check ever breaking
// out early — meaning the last thing that happened to `current` was a
// decode, with no normalize pass after it (see this function's own comment
// above). `value` is normalized one more time regardless of how the loop
// exited, but a caller must still treat `exhausted: true` as a hard failure
// rather than trust that extra pass alone: a name still changing on every
// round after 15 rounds is hostile by construction, not merely
// under-processed, and the fixed point it would eventually reach (if any)
// is unknown. See sanitizeSegment, which fails closed on this flag instead
// of sanitizing further.
function normalizeAndDecodeToExhaustion(s) {
  let current = s;
  let convergedEarly = false;
  for (let i = 0; i < 15; i++) {
    const normalized = current.normalize("NFKC");
    let decoded;
    try {
      decoded = decodeURIComponent(normalized);
    } catch {
      current = normalized;
      convergedEarly = true;
      break;
    }
    if (decoded === normalized) {
      current = normalized;
      convergedEarly = true;
      break;
    }
    current = decoded;
  }
  return { value: current.normalize("NFKC"), exhausted: !convergedEarly };
}

// Multiple consecutive path separators (either slash) collapse to a single
// underscore — this is a flat filename inside an already-owner-scoped
// folder, so a separator is never meaningful here, only dangerous. Mirrors
// lib/supabase/materials.js's safeMaterialName.
function collapseSeparators(s) {
  return s.replace(/[/\\]+/g, "_");
}

// Removes every occurrence of the literal substring ".." anywhere in the
// string, repeating until none remain. A single non-repeated pass can leave
// ".." behind (removing the first two dots of a four-dot run one pair at a
// time can re-expose a pair that a naive single replace already walked
// past), so this loops to a fixed point instead of trusting one call.
function stripDotDotRepeatedly(s) {
  let current = s;
  for (let i = 0; i < 50 && current.includes(".."); i++) {
    current = current.split("..").join("");
  }
  return current;
}

function trimDotsAndSpaces(s) {
  return s.replace(/^\.+/, "").replace(/[. ]+$/, "");
}

// Windows cannot create a file with one of these names (with or without an
// extension) — a download would be silently unopenable however safe the
// key itself is. Prefixing with an underscore is enough to break the match
// without discarding the rest of the name.
const RESERVED_NAME_RE = /^(con|prn|aux|nul|com\d|lpt\d)(\.|$)/i;

function renameReserved(s) {
  return RESERVED_NAME_RE.test(s) ? `_${s}` : s;
}

// Truncates LAST (after every other transform), preserving the extension —
// see MAX_SEGMENT's comment for why order matters here. Code-point aware
// (Array.from, not .slice) so a surrogate pair is never cut in half.
function truncatePreservingExtension(s, maxLen) {
  const codepoints = Array.from(s);
  if (codepoints.length <= maxLen) return s;

  const dot = s.lastIndexOf(".");
  const hasExt = dot > 0 && dot < s.length - 1 && s.length - dot <= 16;
  const ext = hasExt ? s.slice(dot) : "";
  const stem = hasExt ? s.slice(0, dot) : s;

  const extCps = Array.from(ext);
  const stemCps = Array.from(stem);
  const stemBudget = Math.max(0, maxLen - extCps.length);
  const truncated = stemCps.slice(0, stemBudget).join("") + ext;

  const truncatedCps = Array.from(truncated);
  return truncatedCps.length <= maxLen ? truncated : truncatedCps.slice(0, maxLen).join("");
}

// The pipeline order is part of the contract (see the file-header comment):
// NFKC normalize -> percent-decode to exhaustion -> strip forbidden
// characters -> collapse separators -> strip ".." repeatedly -> trim
// leading dots and trailing dots/spaces -> rename reserved device names ->
// truncate. (The first two stages run as one fixed-point loop — see
// normalizeAndDecodeToExhaustion's own comment for why.) A name that loop
// cannot converge on in 15 rounds never reaches stage three at all: it is
// hostile by construction (still changing on every round), so it is
// replaced with a safe generated name instead of being sanitized further.
function sanitizeSegment(fileName, maxLen) {
  let s = typeof fileName === "string" ? fileName : String(fileName ?? "");
  const decoded = normalizeAndDecodeToExhaustion(s);
  if (decoded.exhausted) {
    // 15 rounds of alternating normalize/decode never reached a fixed
    // point. Continuing to sanitize `decoded.value` would be trusting the
    // same partial processing that let a deeply percent-encoded fullwidth
    // traversal slip through in the first draft (either still-un-normalized
    // separators, or literal percent-escapes) — discard it wholesale
    // instead of returning anything derived from it.
    return "file";
  }
  s = decoded.value;
  s = stripForbidden(s);
  s = collapseSeparators(s);
  s = stripDotDotRepeatedly(s);
  s = trimDotsAndSpaces(s);
  if (!s) s = "file";
  s = renameReserved(s);
  s = truncatePreservingExtension(s, Math.max(1, maxLen));
  // Truncation is the LAST transform, so a cut can land exactly on a
  // trailing space or dot — reintroducing the trailing character the trim
  // above already removed — or, in principle, leave only part of a dotted
  // extension as a leading dot. Re-run the full trim (not just the
  // leading-dot half of it) now that truncation is done, and fall back to
  // "file" if that empties the string.
  s = trimDotsAndSpaces(s);
  if (!s) s = "file";
  return s;
}

// storagePathFor(userId, pageId, attachmentId, fileName) ->
// `${userId}/experience/${pageId}/${attachmentId}-${safeName}`.
//
// `userId`, `pageId` and `attachmentId` come from the session and from
// database uuids today, never from user input — but they are interpolated
// raw, so this throws on anything that isn't a plain identifier rather than
// trusting the caller. The day one of them arrives from a URL segment
// instead, the prefix itself is what would escape.
export function storagePathFor(userId, pageId, attachmentId, fileName) {
  assertPlainId(userId, "userId");
  assertPlainId(pageId, "pageId");
  assertPlainId(attachmentId, "attachmentId");

  const budget = MAX_SEGMENT - (attachmentId.length + 1);
  const safeName = sanitizeSegment(fileName, budget);

  return `${userId}/experience/${pageId}/${attachmentId}-${safeName}`;
}
