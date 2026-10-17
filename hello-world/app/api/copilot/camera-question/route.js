import { getAuth, unauthorized } from "@/lib/experience/apiAuth";
import { createRateLimiter, identify, rateLimitHeaders } from "@/lib/rateLimit/index";
import { ocrImage } from "@/lib/scrape/screenshotOcr";
import { MAX_CAMERA_BYTES, MAX_CAMERA_TEXT, validCameraPng } from "@/lib/copilot/cameraQuestion";

export const runtime = "nodejs";
export const maxDuration = 60;
const limiter = createRateLimiter({ limit: 10, windowMs: 600000, prefix: "camera-question" });
// Per-instance camera admission only. Other OCR consumers own their own work.
let busy = false;
const error = (message, status, headers) => Response.json({ error: message }, { status, headers });

export async function POST(request) {
  const { userId } = await getAuth();
  if (!userId) return unauthorized();
  const decision = await limiter.check(identify(request, { userId }));
  if (!decision.allowed) return error("Too many camera reads. Wait a few minutes and retry.", 429, rateLimitHeaders(decision));
  if (request.headers.get("content-type")?.split(";")[0].trim().toLowerCase() !== "image/png") return error("Capture a PNG image.", 415);
  if (Number(request.headers.get("content-length")) > MAX_CAMERA_BYTES) return error("Image is too large. Capture one question.", 413);
  let bytes;
  try {
    const reader = request.body?.getReader();
    if (!reader) return error("No image received. Capture again.", 400);
    const chunks = []; let size = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > MAX_CAMERA_BYTES) {
          await reader.cancel().catch(() => {});
          return error("Image is too large. Capture one question.", 413);
        }
        chunks.push(value);
      }
    } finally { reader.releaseLock(); }
    bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  } catch { return error("Could not receive image. Capture again.", 400); }
  if (!validCameraPng(bytes)) return error("Image is invalid or too large. Capture a smaller area.", 422);
  if (busy) return error("Camera reader is busy. Wait and retry.", 503, { "Retry-After": "5" });
  busy = true;
  let timer;
  // A response timeout does not cancel the shared worker. Hold admission until
  // actual settlement, including a late rejection; never terminate that worker.
  const work = Promise.resolve().then(() => ocrImage(bytes)).then((raw) => {
    const text = typeof raw === "string" ? raw.trim() : "";
    return text && text.length <= MAX_CAMERA_TEXT ? Response.json({ text }) : error("No readable question. Capture a smaller, clearer area.", 422);
  }, () => error("Could not decode the image. Capture again.", 422)).finally(() => { busy = false; clearTimeout(timer); });
  const timeout = new Promise((resolve) => {
    timer = setTimeout(() => resolve(error("Reading timed out. Wait and retry, or type the question.", 504)), 20000);
  });
  return Promise.race([work, timeout]);
}
