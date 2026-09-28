// N59 step 2 -- upload/fetch helpers for a cover letter's engine .docx,
// reusing the existing `resumes` storage bucket. Upload keying mirrors
// saveGeneratedResume.js's row-id convention; download mirrors docx.js's
// fetchStoredDocxBlob, re-encoded to base64 for callers that keep the
// document in session state (mirroring lib/copilot/stt/elevenlabs.js).
//
// Two upload keying conventions (R2, refines AC-9):
//  - GENERATION path: caller supplies `{ id }` (the just-inserted row's id)
//    to key by `${userId}/generated/${id}.docx`.
//  - ACCEPT path: caller omits `id` -- the accept RPC mints the row AFTER
//    the upload, so the path cannot be keyed by an id that doesn't exist
//    yet. Keys by a fresh `${userId}/generated/cover-<uuid>.docx` instead,
//    still under the same prefix a future retention sweep would enumerate.

const DOCX_MIME =
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document";

// Chunk size for the base64-encode loop below, matching
// lib/copilot/stt/elevenlabs.js's arrayBufferToBase64 -- large enough that a
// typical document needs only a handful of iterations, small enough to stay
// well under engines' call-argument limits for String.fromCharCode.apply.
const BASE64_CHUNK_SIZE = 0x8000;

// Decode a base64 string into bytes in both the browser and Node (mirrors
// saveGeneratedResume.js's base64ToBytes).
function base64ToBytes(base64) {
  if (typeof atob === "function") {
    const binary = atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
    return bytes;
  }
  return new Uint8Array(Buffer.from(base64, "base64"));
}

// Encode bytes back into a base64 string in both the browser and Node.
function bytesToBase64(bytes) {
  if (typeof btoa === "function") {
    let binary = "";
    for (let i = 0; i < bytes.length; i += BASE64_CHUNK_SIZE) {
      binary += String.fromCharCode.apply(null, bytes.subarray(i, i + BASE64_CHUNK_SIZE));
    }
    return btoa(binary);
  }
  return Buffer.from(bytes).toString("base64");
}

// K12: crypto.randomUUID with a fallback for a runtime that has no webcrypto
// global at all.
function randomKey() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

/**
 * Uploads a cover letter's engine .docx to the `resumes` bucket and returns
 * the storage path, or null on any error or empty input -- never throws.
 *
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 * @param {string} userId
 * @param {string|null|undefined} docxB64
 * @param {{ id?: string|null }} [opts] Pass the row id on the generation
 *   path; omit it on the accept path (see module comment, R2).
 * @returns {Promise<string|null>}
 */
export async function uploadCoverDocx(supabase, userId, docxB64, { id = null } = {}) {
  if (!userId || typeof docxB64 !== "string" || docxB64.length === 0) return null;

  const key = id || `cover-${randomKey()}`;
  const path = `${userId}/generated/${key}.docx`;

  try {
    const { error } = await supabase.storage
      .from("resumes")
      .upload(path, base64ToBytes(docxB64), { contentType: DOCX_MIME, upsert: true });
    if (error) return null;
    return path;
  } catch {
    return null;
  }
}

/**
 * Downloads a cover letter's stored .docx and returns it re-encoded as
 * base64, or null on any error, empty path, or missing data -- never throws.
 *
 * @param {import('@supabase/supabase-js').SupabaseClient} supabase
 * @param {string|null|undefined} path
 * @returns {Promise<string|null>}
 */
export async function fetchCoverDocxB64(supabase, path) {
  if (typeof path !== "string" || path.length === 0) return null;

  try {
    const { data, error } = await supabase.storage.from("resumes").download(path);
    if (error || !data) return null;
    const buffer = await data.arrayBuffer();
    return bytesToBase64(new Uint8Array(buffer));
  } catch {
    return null;
  }
}
