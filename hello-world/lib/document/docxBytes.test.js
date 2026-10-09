// N151c (4b) — S4 / T-enc: the shared Blob->base64 encoder extracted out of
// coverDocxStore.js's module-local copy into lib/document/docxBytes.js, so the
// regen module (regenerateIntoTemplate.js) and coverDocxStore reuse ONE encoder
// instead of a second copy (plan §E S4, CT-13 / PL-13).
//
// RED on HEAD: lib/document/docxBytes.js does not exist, so the import is a
// module-not-found — every test here is red until Step S4 lands the module.
//
// THE PROPERTY, not a re-encode of the mechanism under test: the round-trip is
// checked against an INDEPENDENT decoder (Node's Buffer base64), never against
// the sibling base64ToBytes (which shares the same chunking assumptions and
// would move with a bug). A known-literal canary proves the independent decoder
// is not blind. The multi-chunk case (> BASE64_CHUNK_SIZE = 0x8000) is the one
// the truncate-the-loop mutant breaks: a single-chunk array cannot tell a
// correct loop from one that stops after the first iteration.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

import { bytesToBase64 } from "@/lib/document/docxBytes.js";

// Independent oracle: Node's base64 decoder, nothing to do with the chunk loop
// under test.
function decodeIndependently(b64) {
  return new Uint8Array(Buffer.from(b64, "base64"));
}

function varyingBytes(n) {
  const out = new Uint8Array(n);
  for (let i = 0; i < n; i += 1) out[i] = (i * 37 + 11) & 0xff;
  return out;
}

const CHUNK = 0x8000; // must match the module's BASE64_CHUNK_SIZE

describe("bytesToBase64 — shared Blob->base64 encoder (S4 / T-enc)", () => {
  it("CANARY: the independent decoder really reads a known literal (not blind)", () => {
    // "PK\x03\x04" -> a base64 any correct encoder must produce.
    expect(bytesToBase64(new Uint8Array([0x50, 0x4b, 0x03, 0x04]))).toBe("UEsDBA==");
    // And the oracle inverts it.
    expect(Array.from(decodeIndependently("UEsDBA=="))).toEqual([0x50, 0x4b, 0x03, 0x04]);
  });

  it("round-trips a short array through an INDEPENDENT decoder", () => {
    const bytes = new Uint8Array([0, 1, 2, 250, 251, 255, 128, 64]);
    expect(Array.from(decodeIndependently(bytesToBase64(bytes)))).toEqual(Array.from(bytes));
  });

  it("round-trips a MULTI-CHUNK array (> 0x8000) — the truncate-the-loop mutant reds here", () => {
    // Two full chunks plus a remainder, so an encoder that stops after the
    // first String.fromCharCode.apply pass loses > 32KB of bytes.
    const bytes = varyingBytes(CHUNK * 2 + 777);
    const decoded = decodeIndependently(bytesToBase64(bytes));
    expect(decoded.length, "encoded output lost bytes past the first chunk").toBe(bytes.length);
    expect(Array.from(decoded)).toEqual(Array.from(bytes));
  });

  it("round-trips the exact chunk boundary (length === 0x8000) without an off-by-one", () => {
    const bytes = varyingBytes(CHUNK);
    expect(Array.from(decodeIndependently(bytesToBase64(bytes)))).toEqual(Array.from(bytes));
  });

  it("an empty array encodes to the empty string and back", () => {
    expect(bytesToBase64(new Uint8Array([]))).toBe("");
    expect(decodeIndependently("").length).toBe(0);
  });
});

// ---------------------------------------------------------------------------
// ADOPTION (CT-13): coverDocxStore must IMPORT the shared encoder, not keep its
// own copy. A move that left the local definition behind is a duplicate, not an
// extraction, and the two copies would drift. This is the same shape as
// useDocumentPreview.wiring.test.js's adoption half (the property IS the shape
// of the source), with a positive control so deleting the usage can't pass it.
// ---------------------------------------------------------------------------
describe("coverDocxStore adopts the shared encoder (CT-13 / PL-13)", () => {
  const read = (rel) => readFileSync(new URL(rel, import.meta.url), "utf8");
  const STORE = "./coverDocxStore.js";
  const MODULE = "./docxBytes.js";

  it("the shared module exports bytesToBase64", () => {
    expect(read(MODULE)).toMatch(/export\s+function\s+bytesToBase64/);
  });

  it("coverDocxStore imports bytesToBase64 from docxBytes and no longer defines it", () => {
    const src = read(STORE);
    // Positive control: it must still USE the encoder.
    expect(src).toMatch(/bytesToBase64\(/);
    // Imported from the shared module...
    expect(src).toMatch(/from\s+["'][^"']*docxBytes(?:\.js)?["']/);
    // ...and not redefined locally (that would be the drift this guards).
    expect(src).not.toMatch(/function\s+bytesToBase64/);
  });
});
