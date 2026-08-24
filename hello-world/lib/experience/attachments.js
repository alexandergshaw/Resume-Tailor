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
//
// ".key" is deliberately absent: "server.key" is a PEM private key far more
// often than it is a Keynote file, so a bare .key with no mime must fall
// through to "other" rather than being waved through as a deck. Only the
// unambiguous application/vnd.apple.keynote mime (in FIXED_MIME_KIND below)
// yields "slides" for a Keynote file.
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
  ppt: "slides",
  pptx: "slides",
  pptm: "slides",
  potx: "slides",
  ppsx: "slides",
  pps: "slides",
  odp: "slides",
  xls: "sheet",
  xlsx: "sheet",
  xlsm: "sheet",
  xlsb: "sheet",
  xltx: "sheet",
  ods: "sheet",
  numbers: "sheet",
  zip: "archive",
};

// table[key] on a plain object literal walks the prototype chain, so a name
// like "notes.constructor" or "payload.__proto__" resolves to a built-in
// function/object instead of undefined - truthy, not the string "other", and
// therefore sails past the unsupported-type check into an accepted upload
// with a function or object as its kind. Both EXTENSION_KIND lookups in
// kindOf (the plain case and the ambiguous-mime override) and the
// FIXED_MIME_KIND lookup in kindFromMime go through this guard for that
// reason - a mime of exactly "constructor" is the same hazard as an
// extension of "constructor".
function ownLookup(table, key) {
  return Object.prototype.hasOwnProperty.call(table, key) ? table[key] : undefined;
}

function extensionOf(name) {
  const s = String(name);
  const dot = s.lastIndexOf(".");
  if (dot <= 0 || dot === s.length - 1) return "";
  return s.slice(dot + 1).toLowerCase();
}

function normalizeMime(mime) {
  return String(mime || "").toLowerCase().trim();
}

// Fixed mime -> kind mappings that aren't a simple "type/" prefix. Every key
// here MUST be written lower-case: kindFromMime lowercases the incoming mime
// before it looks anything up, so a table entry in its "real" casing (e.g.
// Windows sending "...macroEnabled.12") could never match.
const FIXED_MIME_KIND = {
  "application/pdf": "pdf",
  "application/msword": "text",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "text",
  "application/rtf": "text",
  // PowerPoint / Keynote / OpenDocument presentations (AC1).
  "application/vnd.openxmlformats-officedocument.presentationml.presentation": "slides",
  "application/vnd.openxmlformats-officedocument.presentationml.template": "slides",
  "application/vnd.openxmlformats-officedocument.presentationml.slideshow": "slides",
  "application/vnd.ms-powerpoint.presentation.macroenabled.12": "slides",
  "application/vnd.ms-powerpoint": "slides",
  "application/vnd.oasis.opendocument.presentation": "slides",
  "application/vnd.apple.keynote": "slides",
  // Excel / Numbers / OpenDocument spreadsheets (AC2). application/vnd.ms-excel
  // is also listed here, but kindOf below overrides it for a file whose
  // extension disagrees - see AMBIGUOUS_SHEET_MIME.
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "sheet",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.template": "sheet",
  "application/vnd.ms-excel.sheet.macroenabled.12": "sheet",
  "application/vnd.ms-excel.sheet.binary.macroenabled.12": "sheet",
  "application/vnd.ms-excel": "sheet",
  "application/vnd.oasis.opendocument.spreadsheet": "sheet",
  "application/vnd.apple.numbers": "sheet",
  // Generic zip mimes (AC3). Both are ambiguous, not fixed, the same way
  // application/vnd.ms-excel is - see AMBIGUOUS_MIMES below for why they
  // live in that set instead of resolving to "archive" outright here.
  "application/zip": "archive",
  "application/x-zip-compressed": "archive",
};

function kindFromMime(mime) {
  const m = normalizeMime(mime);
  if (!m) return "";
  if (m.startsWith("image/")) return "image";
  if (m.startsWith("video/")) return "video";
  if (m.startsWith("text/")) return "text";
  return ownLookup(FIXED_MIME_KIND, m) || "";
}

// Mimes this file treats as ambiguous rather than authoritative, because a
// mainstream OS hands out each one for files that are NOT the kind it
// nominally names:
//  - application/vnd.ms-excel: Windows reports it for a plain .csv whenever
//    Excel is the registered handler (see attachments.test.js, "keeps a
//    .csv reported as an Excel type a text file"), and a csv IS readable
//    text - the whole point of the "text" kind, per classifyAttachment's
//    own note that an unrecognized binary must never be handed to a model
//    as if it were readable.
//  - application/zip and application/x-zip-compressed: every OOXML Office
//    file (.docx/.pptx/.xlsx and friends) genuinely IS a zip container, and
//    Windows/several file managers report it with a generic zip mime -
//    mapping those straight to "archive" would silently reclassify a real
//    Word/PowerPoint/Excel document as an opaque archive and start lying
//    about its contents not being read.
// This list is deliberately short: every other mime keeps today's
// precedence of mime-beats-extension (see attachments.test.js's "still lets
// an unambiguous mime type override the extension"), so do not add to this
// set casually - only when a real OS is known to overload that exact mime
// for files whose extension already has its own trustworthy mapping.
const AMBIGUOUS_MIMES = new Set([
  "application/vnd.ms-excel",
  "application/zip",
  "application/x-zip-compressed",
]);

function kindOf(name, mime) {
  const ext = extensionOf(name);

  // When the mime is one of the ambiguous types above AND the extension has
  // its own known mapping, trust the extension instead (rows.csv -> "text",
  // not "sheet"; report.docx -> "text", not "archive"). When there's no
  // known extension (e.g. export.bin, or an actual bundle.zip), the mime
  // still decides, because that's the only signal available.
  if (AMBIGUOUS_MIMES.has(normalizeMime(mime)) && ownLookup(EXTENSION_KIND, ext)) {
    return ownLookup(EXTENSION_KIND, ext);
  }

  return kindFromMime(mime) || ownLookup(EXTENSION_KIND, ext) || "other";
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

// Every character a storage key segment keeps must be inside Supabase
// Storage's own key charset — storage-api's isValidKey, copied into this
// file's test as STORAGE_KEY_SAFE:
//   /^(\w|\/|!|-|\.|\*|'|\(|\)| |&|\$|@|=|;|:|\+|,|\?)*$/
// `\w` there carries no `u` flag, so it is ASCII [A-Za-z0-9_] only — every
// non-ASCII code point is outside the set too. @supabase/storage-js does no
// client-side check for this, so a key outside the set was refused
// server-side at upload time, and the API route reported that refusal as a
// bare "Could not save this attachment." — this is the real failure:
// PowerPoint appends "[Autosaved]" to its own autosave copies, and "[" / "]"
// are outside the set.
//
// Two replacement rules, not one, because collapsing everything to a single
// "_" would merge "中文.png" and "日本語.png" onto the identical name part —
// forbidden by "does not merge names that differ only by case or by script"
// below, the same mistake lower-casing made for "Notes.MD" vs "notes.md" in
// the first draft (see this file's header comment).
//  - Disallowed ASCII (brackets, braces, angle brackets, quote, pipe, caret,
//    tilde, backtick, #, %, ...) -> "_", so "[Autosaved]" reads as
//    "_Autosaved_" instead of disappearing — this key is internal (the
//    user-facing name is the unmodified `name` column), so validity matters
//    more than readability, but "_" still keeps it recognisable.
//  - Non-ASCII -> "u" followed by its lowercase hex code point, left-padded
//    to at least 4 digits ("Ü" -> "u00dc", "中" -> "u4e2d", an emoji outside
//    the BMP -> "u1f389", ...), which keeps every script and every emoji
//    distinguishable from every other while staying pure ASCII. Excludes
//    "/" from the allowed set even though STORAGE_KEY_SAFE permits it
//    elsewhere in the full path: this function only ever sees one flat
//    segment (collapseSeparators, just above, already removed any slash),
//    so treating "/" as unsafe here is a second, independent guarantee this
//    stage cannot manufacture a separator, not merely a consequence of
//    running after collapseSeparators.
//
// Iterates by CODE POINT, not UTF-16 unit — codePointAt over a for...of
// loop, same pattern as stripForbidden above — or an emoji's surrogate pair
// is escaped as two separate, broken halves instead of one.
const STORAGE_SAFE_ASCII_RE = /^[A-Za-z0-9_!\-.*'() &$@=;:+,?]$/;

function escapeUnsafeChars(s) {
  let out = "";
  for (const ch of s) {
    const cp = ch.codePointAt(0);
    if (cp > 0x7f) {
      out += `u${cp.toString(16).padStart(4, "0")}`;
    } else if (STORAGE_SAFE_ASCII_RE.test(ch)) {
      out += ch;
    } else {
      out += "_";
    }
  }
  return out;
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
// characters -> collapse separators -> escape characters outside the
// storage charset -> strip ".." repeatedly -> trim leading dots and
// trailing dots/spaces -> rename reserved device names -> truncate. (The
// first two stages run as one fixed-point loop — see
// normalizeAndDecodeToExhaustion's own comment for why.) The charset-escape
// stage sits BEFORE the ".." pass and AFTER collapseSeparators — its two
// outputs are "_" and "u<hex>" text, and neither can ever contain ".", "/"
// or "\", so it cannot manufacture a traversal (see escapeUnsafeChars' own
// comment for why it also refuses to treat "/" as safe on its own account).
// A name that loop cannot converge on in 15 rounds never reaches stage
// three at all: it is hostile by construction (still changing on every
// round), so it is replaced with a safe generated name instead of being
// sanitized further. Truncation stays LAST — a hex escape turns one code
// point into five, so a name that measured short before this stage can
// overflow MAX_SEGMENT only after it, never before.
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
  s = escapeUnsafeChars(s);
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
