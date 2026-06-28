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

// Read a screenshot offline into the reader contract shared with the AI path:
// { jobTitle, company, location, postingText, searchQuery }.
export async function readScreenshotOffline(buffer, { ocr = ocrImage } = {}) {
  const text = await ocr(buffer);
  const { jobTitle, companyName } = extractPostingMeta(text);
  return {
    jobTitle: jobTitle || "",
    company: companyName || "",
    location: "",
    postingText: text,
    searchQuery: [jobTitle, companyName].filter(Boolean).join(" "),
  };
}
