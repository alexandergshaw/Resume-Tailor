// Non-AI screenshot reader: OCR the image with Tesseract.js, then derive the
// job title / company with the same deterministic parser the tailor route uses.
// Returns the same shape as the AI vision reader so the endpoint can swap them.

import { extractPostingMeta } from "@/lib/llm/postingMeta";

// One worker, reused across requests — creating it downloads the wasm core and
// English language data, which we only want to pay once.
let workerPromise = null;

async function getWorker() {
  if (!workerPromise) {
    workerPromise = (async () => {
      const { createWorker } = await import("tesseract.js");
      return createWorker("eng");
    })().catch((err) => {
      workerPromise = null; // let the next call retry a fresh worker
      throw err;
    });
  }
  return workerPromise;
}

// Plain-text OCR of an image buffer. Exposed for testing/seam injection.
export async function ocrImage(buffer) {
  const worker = await getWorker();
  const { data } = await worker.recognize(buffer);
  return String(data?.text || "").trim();
}

// Derive the reader contract from already-extracted OCR text (e.g. OCR done in
// the browser): { jobTitle, company, location, postingText, searchQuery }.
export function fieldsFromText(text) {
  const body = String(text || "");
  const { jobTitle, companyName } = extractPostingMeta(body);
  return {
    jobTitle: jobTitle || "",
    company: companyName || "",
    location: "",
    postingText: body,
    searchQuery: [jobTitle, companyName].filter(Boolean).join(" "),
  };
}

// Read a screenshot offline (server-side OCR) into the same reader contract.
export async function readScreenshotOffline(buffer, { ocr = ocrImage } = {}) {
  return fieldsFromText(await ocr(buffer));
}
