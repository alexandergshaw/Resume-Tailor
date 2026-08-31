// The currency instrument deciding whether a Drive copy still matches the
// document shown in the app.
//
// This module supplies the two low-level primitives (per ARCH.md Wave 2A):
// hashing an arbitrary string, and comparing two hashes to a verdict. It
// does NOT assemble the byte-source tuple itself -- per DATA.md rev 2 /
// AC-P6, the real currency hash is SHA-256 over
// `["v1", scope, text, edited, engineDocxDigest, docxPath, templateDigest]`,
// not over the text alone and NEVER over the produced .docx bytes (JSZip
// stamps a wall-clock timestamp into the archive, so four builds of
// identical content produce four different digests -- measured in DATA.md
// §6). Callers hash `JSON.stringify(tuple)` through sha256Hex below.
//
// Earlier design hashed `name:size:lastModified` for the template member.
// That was unstable across page loads: app/page.js:401-406 rebuilds the
// uploaded template as `new File([data], "resume.docx", { type })` on every
// sign-in, with no `lastModified` (defaults to Date.now()) and a hardcoded
// `name` -- so that key changed on every reload for every returning user and
// would have read "differs from Drive" permanently and universally. The
// corrected instrument hashes the template's actual BYTES instead, which is
// stable by construction.

function getSubtleCrypto() {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) {
    throw new Error("contentHash: Web Crypto (crypto.subtle) is unavailable in this environment");
  }
  return subtle;
}

function toHex(buffer) {
  return Array.from(new Uint8Array(buffer))
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

// sha256Hex(text) -> Promise<string|null>
//
// Hex-encoded SHA-256 digest of `text`. Returns `null` (never rejects, never
// hashes a placeholder) when `text` isn't a string -- the case a scope whose
// blob resolved to `null` produces (AC-S27/AC-S28: no bytes, no currency
// state). An empty string IS a valid string and hashes normally; it is not
// treated the same as "no bytes".
export async function sha256Hex(text) {
  if (typeof text !== "string") return null;
  const bytes = new TextEncoder().encode(text);
  const digest = await getSubtleCrypto().digest("SHA-256", bytes);
  return toHex(digest);
}

// driveCopyState(current, stored) -> "current" | "stale" | "unknown"
//
// Pure comparison, no hashing. `current` is the freshly recomputed hash for
// what's on screen right now; `stored` is drive_content_hash as persisted.
// "unknown" when either side isn't a real hash -- unhashable content
// (current === null, e.g. a null blob per AC-S28) or no prior save to
// compare against (stored missing) means there is nothing to certify either
// way, and the caller must suppress the current/older badge rather than
// guess.
export function driveCopyState(current, stored) {
  if (typeof current !== "string" || !current) return "unknown";
  if (typeof stored !== "string" || !stored) return "unknown";
  return current === stored ? "current" : "stale";
}
