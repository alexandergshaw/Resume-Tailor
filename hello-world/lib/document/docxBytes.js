// N151c -- the shared bytes -> base64 encoder for generated .docx content.
// Extracted from coverDocxStore.js's module-local copy so the cover-letter
// store and the regenerate-into-template module (regenerateIntoTemplate.js)
// encode through ONE implementation instead of two that could drift.

// Chunk size for the base64-encode loop below, matching
// lib/copilot/stt/elevenlabs.js's arrayBufferToBase64 -- large enough that a
// typical document needs only a handful of iterations, small enough to stay
// well under engines' call-argument limits for String.fromCharCode.apply.
const BASE64_CHUNK_SIZE = 0x8000;

// Encode bytes into a base64 string in both the browser and Node.
export function bytesToBase64(bytes) {
  if (typeof btoa === "function") {
    let binary = "";
    for (let i = 0; i < bytes.length; i += BASE64_CHUNK_SIZE) {
      binary += String.fromCharCode.apply(null, bytes.subarray(i, i + BASE64_CHUNK_SIZE));
    }
    return btoa(binary);
  }
  return Buffer.from(bytes).toString("base64");
}
