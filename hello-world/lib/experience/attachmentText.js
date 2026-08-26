// extractAttachmentText({ bytes, kind, name }) -> Promise<{ text, status,
// chars, reason }>. See attachmentText.test.js's header comment for the full
// argument this module exists to satisfy — every branch that returns text is
// a claim, made to a model, that a candidate will speak aloud in an
// interview; every branch that returns `unsupported` is this app admitting
// it did not read a file the user attached. Getting the SECOND kind wrong is
// worse, because it fails silently and in the user's favour-sounding
// direction — an over-eager decode of a file this app cannot actually read
// looks, to everyone, like it worked.
//
// NOT "pure" in the sense the rest of lib/experience/** uses that word — it
// really does call into mammoth and unpdf, real parsers with real failure
// modes — but it keeps that module's contract in every way that matters to
// its callers: no Supabase, no fetch, no DOM, and deterministic given the
// same bytes. Stated this way on purpose rather than claimed as "pure",
// because "pure" invites a future author to bolt an OCR call or a network
// fetch onto this exact function later, and this file's job is to extract
// from bytes ALREADY IN MEMORY, nothing else.
//
// async, not sync: both `mammoth.extractRawText` and unpdf's `extractText`
// return Promises, so a sync signature here would only have forced every
// caller to unwrap this module's own synchronous wrapper around them later.
//
// EXTRACTION IS AN INGEST-TIME OPERATION. This module is called once, when
// an attachment is uploaded (or during an explicit backfill pass over
// existing rows) — never from a live request path. The interview copilot's
// answer route reads the `extracted_text` COLUMN this module's caller writes
// (lib/experience/knowledgeBase.js's contract), and never imports this file
// or downloads an attachment's bytes itself; see that route's own latency
// test for the budget this module must stay out of.
//
// STATUS VOCABULARY THIS MODULE RETURNS: "ok" | "empty" | "unsupported" |
// "too_large" | "failed". Two more states exist in the STORED column
// (supabase/migrations/20260826000000_experience_attachment_text.sql) —
// "pending" (never extracted) and "running" (a backfill claimed this row and
// has not finished) — but this module never returns either: "pending" is
// what a row IS before this function is ever called on it, and "running" is
// bookkeeping the caller does around the call, not an outcome of the call
// itself.
//   - "ok": real text was found (possibly capped — see MAX_EXTRACTED_CHARS
//     and `chars` below).
//   - "empty": the file was read successfully and contained no extractable
//     text (whitespace-only, or — the single most common real PDF case — a
//     scanned page with no text layer at all). NOT the same claim as "ok":
//     calling a scanned PDF "ok" with empty text tells the model it read the
//     document and found nothing, which reads as "your design doc doesn't
//     cover that" rather than the true "this app could not read this PDF's
//     text at all".
//   - "unsupported": this file's kind or extension is not one this module
//     ever reads, so nothing was attempted. See the allow-list discussion
//     below for why this is the DEFAULT for anything not explicitly listed,
//     not a leftover `default:` case nobody thought through.
//   - "too_large": the raw bytes are too large to safely hand to a
//     full-buffer parser (mammoth, unpdf) inside a request/backfill budget,
//     so extraction was never attempted. See MAX_PDF_PARSE_BYTES and
//     MAX_DOCX_PARSE_BYTES below — the two binary formats now have SEPARATE
//     ceilings, not a shared one, because PDF and docx have very different
//     parse-cost shapes (see MAX_DOCX_PARSE_BYTES's own comment) — and why
//     this exists only for those two binary formats and not for plain-text
//     decoding, which bounds its OWN read instead (see MAX_EXTRACTED_CHARS).
//   - "failed": the kind IS supported and the file was small enough to
//     attempt, but the parser itself could not read these particular bytes
//     (a corrupt .docx, a corrupt PDF). Distinct from "unsupported" because
//     the user-facing sentence differs — "couldn't read this file" with a
//     retry, vs. "can't read this kind of file" with none.
//
// NEVER THROWS. Runs inside an upload request (a throw there fails an
// otherwise-successful upload — see S5) and inside a whole-library backfill
// loop (a throw there stalls the batch on one bad row). Every branch below
// that calls into mammoth or unpdf is wrapped in its own try/catch and
// reports `failed` rather than propagating; the outer try/catch in
// `extractAttachmentText` itself exists only to catch a bug in THIS file, not
// as the expected path for a bad attachment.

import mammoth from "mammoth";
import { extractText } from "unpdf";

// Proposed at 20000 (AC.md's S2). This is a STORAGE cap, applied to whatever
// text a parser actually returns — see `chars` below for how a caller learns
// whether it was hit. It is not a truncation of the FILE (see
// MAX_TEXT_READ_BYTES for that half of the contract).
export const MAX_EXTRACTED_CHARS = 20000;

// CAP THE READ, NOT JUST THE WRITE. The default attachment upload cap is
// 25 MB (lib/experience/attachments.js's DEFAULT_CAP_BYTES) — a plain .txt or
// .log can legitimately be that large. Decoding all 25 MB of it into a
// serverless function's heap purely to then keep the first 20,000 characters
// is how a route dies of memory on a file that was already accepted at
// upload time. `TextDecoder` is handed only the first MAX_TEXT_READ_BYTES of
// the buffer, so decode work is bounded by a constant regardless of how large
// the underlying file is.
//
// *4, not *1: UTF-8 encodes one character in up to 4 bytes, so this is the
// smallest byte budget that can still yield MAX_EXTRACTED_CHARS characters
// for content that happens to be entirely multi-byte (dense CJK text, heavy
// emoji use). For plain ASCII content this reads well past 20,000 characters
// before the character cap below trims it back down — that asymmetry is
// accepted: `chars` reports how much this bounded read actually decoded, not
// a promise that the WHOLE file was considered (see MAX_EXTRACTED_CHARS's own
// comment and this module's header on why "ok" can still mean "capped").
//
// Slicing at a fixed byte offset can land mid-way through a multi-byte UTF-8
// sequence; `TextDecoder`'s default (non-fatal) mode replaces that one
// trailing fragment with U+FFFD rather than throwing. One replacement
// character at the very end of an already-truncated 20,000-character excerpt
// is a rounding error, not a correctness issue.
const MAX_TEXT_READ_BYTES = MAX_EXTRACTED_CHARS * 4;

// The ceiling past which this module will not even ATTEMPT to hand a PDF
// buffer to unpdf. Unlike plain-text decoding (bounded above by reading only
// a byte prefix), a PDF cannot be parsed from a truncated prefix of its own
// bytes — the format needs the whole container to be valid — so there is no
// cheap way to bound the WORK the way MAX_TEXT_READ_BYTES bounds it for
// text. A 25 MB PDF (the maximum this app already accepts at upload) can
// cost real seconds and real memory to parse, on EVERY row, inside both an
// upload request and a whole-library backfill loop that has to do this
// hundreds of times in one pass.
//
// Set well under the 25 MB upload cap (not equal to it) specifically so
// "too_large" is reachable for real uploads at the large end of the range
// that this app already accepts today — a threshold equal to the upload cap
// would make this status permanently unreachable for anything that could
// legitimately arrive here, which would just be "unsupported" wearing a
// different name. The most common LARGE PDF is a multi-megabyte scan full of
// page images with no text layer at all — exactly the file this status
// exists to give up on quickly rather than spend a full parse discovering
// "empty" the slow way.
//
// PDF-ONLY. This used to be one shared "binary parse" ceiling applied to
// docx as well; see MAX_DOCX_PARSE_BYTES immediately below for why that was
// wrong and docx now gets its own, much higher threshold.
//
// Exported (unlike the module-local constants above it) so
// attachmentText.test.js can pin the exact boundary directly, rather than a
// second, hand-copied literal that could silently drift from this one.
export const MAX_PDF_PARSE_BYTES = 15 * 1024 * 1024;

// The ceiling past which this module will not even attempt to hand a .docx
// buffer to mammoth. Deliberately NOT the same value as MAX_PDF_PARSE_BYTES,
// and deliberately much higher — equal to attachments.js's own
// DEFAULT_CAP_BYTES, this app's upload cap for a "text"-kind file (which
// .docx is one of).
//
// THE BUG THIS FIXES, and why the PDF reasoning above does not transfer.
// MAX_PDF_PARSE_BYTES's justification is entirely about PDF PARSE COST
// scaling with bytes in a way this module cannot cheaply bound in advance —
// "the most common LARGE PDF is a multi-megabyte scan full of page images",
// i.e. the bytes that make the file big are exactly the bytes the parser has
// to walk. A .docx does not have that shape: its size is dominated by
// embedded media (images, embedded objects), and mammoth's extraction cost
// tracks the DOCUMENT XML, not the media next to it in the zip — a 16 MB
// .docx that is 15.9 MB of a single embedded photo and 3 KB of paragraph
// text extracts that 3 KB in milliseconds, regardless of how large the file
// on disk is. Sharing PDF's 15 MB ceiling with docx therefore returned
// "too_large" for a file the product had ALREADY ACCEPTED at upload (25 MB
// cap) — and "too_large" is terminal with no retry path, so the user was
// told, forever, that a file this app could have read in milliseconds could
// not be read at all. That is worse than the failure mode "too_large" exists
// to prevent (spending a full parse to discover "empty" the slow way): it is
// a full functional regression on a file class the app's own upload flow
// already promised to handle.
//
// Set equal to (not below) the upload cap for the same reason
// MAX_PDF_PARSE_BYTES is set BELOW it: here, unlike PDF, there is no
// meaningful parse-cost risk left to guard against once a file has already
// cleared the upload cap, so there is no reason to make "too_large"
// reachable for anything this module will actually be handed by the app's
// own upload path — MAX_EXTRACTED_CHARS still bounds the output size
// regardless of how large the input container was.
//
// Exported for the same reason as MAX_PDF_PARSE_BYTES above.
export const MAX_DOCX_PARSE_BYTES = 25 * 1024 * 1024;

// THE ALLOW-LIST IS AN ALLOW-LIST, NEVER A FALLBACK. lib/experience/
// attachments.js's `kindOf` maps ALL of .txt/.md/.rtf/.doc/.docx/.odt/.pages
// to the single kind "text" (and kindFromMime returns "text" for ANY
// text/* mime, so report.html and an extensionless README also arrive here
// as kind "text"). An .rtf file is mostly readable ASCII control-word soup —
// `{\rtf1\ansi\deff0{\fonttbl...` — so a naive "kind is text, therefore UTF-8
// decode it" implementation LOOKS like it worked while actually handing the
// model a document's markup instead of its words. Extension is checked
// explicitly against this allow-list; nothing not on it gets decoded, no
// matter how readable the bytes look.
const TEXT_DECODE_EXTENSIONS = new Set(["txt", "md", "markdown", "csv", "json", "log"]);

// Mirrors lib/experience/attachments.js's own extensionOf (case-insensitive,
// last dot, a leading dot or a trailing dot never counts as an extension) —
// duplicated rather than imported because this module needs only this one
// tiny piece of that file's logic, not its mime tables or its storage-key
// pipeline; importing the whole module for three lines would be a heavier
// coupling than it is worth (see this file's header comment on scope).
function extensionOf(name) {
  const s = typeof name === "string" ? name : "";
  const dot = s.lastIndexOf(".");
  if (dot <= 0 || dot === s.length - 1) return "";
  return s.slice(dot + 1).toLowerCase();
}

// Normalizes any byte-shaped input this module might be handed into a
// Uint8Array — or, for input that is not byte-shaped at all, into `null` so
// the caller can tell "no bytes" apart from "zero bytes" (see the callers of
// this function, and the header comment below, for why that distinction
// matters).
//
// THE BUG THIS FIXES. This function used to accept ONLY `instanceof
// Uint8Array` (a plain Uint8Array or a Node Buffer, since Buffer is a
// subclass of it) and silently returned an empty, ZERO-LENGTH Uint8Array for
// anything else — including a plain ArrayBuffer, which is exactly what
// `await file.arrayBuffer()` produces, wave 2's own documented way of
// reading an uploaded file's bytes into memory before calling this module.
// Every extraction branch below treats zero bytes as a legitimately EMPTY
// file (finishFromDecoded's `safe.trim() === ""` path, or an empty buffer
// handed straight to mammoth/unpdf), so an ArrayBuffer input silently became
// `status: "empty"` — "we read your file and it had nothing in it" — for a
// file this module never actually looked at. That is this module's own
// documented worst failure mode (this file's header comment): wrong, and
// wrong in the user's favour-sounding direction, because "empty" reads as
// "the app tried and found nothing" rather than "the app never tried".
//
// Accepts, in addition to a Uint8Array/Buffer:
//   - ArrayBuffer — what `file.arrayBuffer()` returns.
//   - any other ArrayBufferView (a DataView, or a typed array other than
//     Uint8Array) — read via its own buffer/byteOffset/byteLength rather
//     than `new Uint8Array(view)`, because for a non-Uint8 typed array that
//     constructor call REINTERPRETS each element as a raw byte instead of
//     reading the bytes actually backing it (e.g. a Float64Array's 64-bit
//     numbers, not the 8 bytes behind each one) — silently corrupting the
//     content while still "succeeding".
// Returns `null` for anything else (a plain object, a string, a number,
// null/undefined, an Array) — genuinely not bytes, not a zero-length buffer
// of them.
function normalizeBytes(value) {
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (ArrayBuffer.isView(value)) {
    return new Uint8Array(value.buffer, value.byteOffset, value.byteLength);
  }
  return null;
}

// The `failed` result for input that normalizeBytes could not turn into
// bytes at all. Distinct from `emptyResult()` on purpose — see
// normalizeBytes's own header comment for the failure this distinction
// exists to prevent: "no bytes were given to read" must never present to
// the model as "this file was read and found empty".
function unreadableBytesResult() {
  return failedResult(new Error("Attachment bytes were not in a readable format."));
}

function describeError(err) {
  if (err instanceof Error && typeof err.message === "string" && err.message) {
    return err.message;
  }
  try {
    const asString = String(err);
    return asString || "Unknown extraction error.";
  } catch {
    return "Unknown extraction error.";
  }
}

function unsupportedResult() {
  return {
    text: "",
    status: "unsupported",
    chars: 0,
    reason: "This file type is not read for tailoring or interview answers.",
  };
}

// `limitBytes` is the ceiling that was actually exceeded — MAX_PDF_PARSE_
// BYTES or MAX_DOCX_PARSE_BYTES, passed in by the caller rather than read
// off a single shared constant, now that the two formats have different
// ceilings (see MAX_DOCX_PARSE_BYTES's own comment for why).
function tooLargeResult(limitBytes) {
  const mb = Math.round(limitBytes / (1024 * 1024));
  return {
    text: "",
    status: "too_large",
    chars: 0,
    reason: `File is larger than the ${mb} MB limit this app will parse for text.`,
  };
}

function failedResult(err) {
  return { text: "", status: "failed", chars: 0, reason: describeError(err) };
}

function emptyResult() {
  return { text: "", status: "empty", chars: 0, reason: "" };
}

// Shared by every branch that ends up with a plain decoded string (UTF-8
// text, mammoth's raw text, unpdf's merged text): decide empty vs. ok, then
// apply MAX_EXTRACTED_CHARS. `chars` is the PRE-CAP length of what THIS
// bounded read/parse actually produced (S12) — not a promise that the whole
// original file was considered when the read itself was bounded (see
// MAX_TEXT_READ_BYTES) — so `chars > text.length` is exactly the signal a
// caller needs to know something was left out, without a separate boolean.
// `chars` is reported only for "ok"; every other status reports 0, because
// nothing meaningful was kept for those (see this file's header comment on
// the status vocabulary).
function finishFromDecoded(decoded) {
  const safe = typeof decoded === "string" ? decoded : "";
  if (safe.trim() === "") return emptyResult();
  const chars = safe.length;
  const text = chars > MAX_EXTRACTED_CHARS ? safe.slice(0, MAX_EXTRACTED_CHARS) : safe;
  return { text, status: "ok", chars, reason: "" };
}

function decodeBoundedText(bytesInput) {
  try {
    const bytes = normalizeBytes(bytesInput);
    if (bytes === null) return unreadableBytesResult();
    const bounded = bytes.length > MAX_TEXT_READ_BYTES ? bytes.subarray(0, MAX_TEXT_READ_BYTES) : bytes;
    const decoded = new TextDecoder("utf-8", { fatal: false }).decode(bounded);
    return finishFromDecoded(decoded);
  } catch (err) {
    return failedResult(err);
  }
}

async function extractFromDocx(bytesInput) {
  const bytes = normalizeBytes(bytesInput);
  if (bytes === null) return unreadableBytesResult();
  // MAX_DOCX_PARSE_BYTES, not MAX_PDF_PARSE_BYTES — see that constant's own
  // comment for why docx needs, and gets, a much higher ceiling.
  if (bytes.length > MAX_DOCX_PARSE_BYTES) return tooLargeResult(MAX_DOCX_PARSE_BYTES);
  try {
    const buffer = Buffer.from(bytes);
    // Proven on this exact runtime at app/api/tailor/route.js:61 — same
    // library, same call shape, already a server-side dependency. Reusing it
    // here rather than a different docx reader is deliberate: lib/document/
    // docx.js also parses .docx client-side, but via DOMParser, so it cannot
    // run on the server at all; the two are recorded as allowed to disagree
    // on the same file (see this module's header / the design doc's A1).
    const { value } = await mammoth.extractRawText({ buffer });
    return finishFromDecoded(value);
  } catch (err) {
    return failedResult(err);
  }
}

async function extractFromPdf(bytesInput) {
  const bytes = normalizeBytes(bytesInput);
  if (bytes === null) return unreadableBytesResult();
  if (bytes.length > MAX_PDF_PARSE_BYTES) return tooLargeResult(MAX_PDF_PARSE_BYTES);
  try {
    // Bytes are handed STRAIGHT to extractText — no getDocumentProxy call of
    // our own first. unpdf's extractText is built on its own internal
    // withDocument helper, which creates a PDFDocumentProxy from raw data
    // and destroys it again once the operation settles (`pdf.loadingTask.
    // destroy()`) — but ONLY when it created that proxy itself; a proxy the
    // CALLER passes in keeps its lifecycle with the caller and unpdf never
    // touches it (`if (pdf !== data) await pdf.loadingTask.destroy()`,
    // verified directly in unpdf@1.8.1's own source).
    //
    // THE BUG THIS FIXES. An earlier version of this function called
    // getDocumentProxy itself and passed the resulting proxy into
    // extractText — exactly the caller-supplied-proxy case unpdf's own doc
    // comment describes, so the proxy's teardown never ran. pdf.js retains
    // real state per document (fonts, decoded content streams, worker-side
    // document state); measured directly against this file's own test
    // fixture, that is ~2 KB retained per call, scaling with a real
    // document's fonts/images/page count — and this function runs inside a
    // whole-library backfill loop that calls it hundreds of times in one
    // pass, so the leak compounds across the whole run rather than staying
    // bounded to one request. Handing raw bytes to extractText directly
    // keeps this function in the case unpdf destroys for free, with no
    // try/finally of our own needed.
    //
    // mergePages: true collapses unpdf's per-page array into ONE string —
    // verified directly against unpdf@1.8.1's own source rather than assumed
    // from its README, because the shape of `text` (string vs. array) is
    // exactly the kind of detail a design doc can get wrong without anyone
    // noticing until a caller does `.slice()` on an array.
    const { text: merged } = await extractText(new Uint8Array(bytes), { mergePages: true });
    return finishFromDecoded(merged);
  } catch (err) {
    // Covers both a genuinely corrupt PDF (unpdf's internal getDocumentProxy
    // throws — verified against this exact fixture shape, "%PDF-1.4 and then
    // nothing valid at all", which unpdf rejects with "Invalid PDF
    // structure.") and any failure inside extractText itself. Either way:
    // the kind IS supported, this file could not be read — "failed", not
    // "unsupported".
    return failedResult(err);
  }
}

async function extractFromTextKind(bytesInput, name) {
  const ext = extensionOf(name);
  if (ext === "docx") return extractFromDocx(bytesInput);
  if (!TEXT_DECODE_EXTENSIONS.has(ext)) return unsupportedResult();
  return decodeBoundedText(bytesInput);
}

// extractAttachmentText({ bytes, kind, name }) -> Promise<{ text, status,
// chars, reason }>. See this file's header comment for the full contract.
export async function extractAttachmentText(input) {
  try {
    const src = input && typeof input === "object" ? input : {};
    const kind = typeof src.kind === "string" ? src.kind : "";
    const name = typeof src.name === "string" ? src.name : "";
    const bytes = normalizeBytes(src.bytes);

    if (kind === "text") return await extractFromTextKind(bytes, name);
    if (kind === "pdf") return await extractFromPdf(bytes, name);

    // Every other kind (image, video, slides, sheet, archive, "other", or
    // anything malformed/missing) is out of scope for this wave — see
    // AC.md's scope decisions. Total over `kind`, never a bare `default:`
    // that nobody asserts: every kind this module does not name explicitly
    // lands here, on purpose, not by falling through unnoticed.
    return unsupportedResult();
  } catch (err) {
    // Defensive outer catch. Every branch above already catches its own
    // failure mode and reports `failed` — reaching here means a bug in THIS
    // file's own dispatch logic, not in mammoth or unpdf, but this module's
    // whole reason for existing is to never let that become a thrown error
    // in an upload request or a stalled backfill batch either.
    return failedResult(err);
  }
}
