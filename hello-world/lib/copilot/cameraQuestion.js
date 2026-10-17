export const MAX_CAMERA_BYTES = 2 * 1024 * 1024;
const MAX_CAMERA_WIDTH = 1600;
const MAX_CAMERA_HEIGHT = 1200;
export const MAX_CAMERA_TEXT = 12000;

// Bounds only: the OCR decoder still rejects corrupt PNG content.
export function validCameraPng(bytes) {
  if (!bytes || bytes.length < 33 || bytes.length > MAX_CAMERA_BYTES) return false;
  const signature = [137, 80, 78, 71, 13, 10, 26, 10];
  if (signature.some((value, index) => bytes[index] !== value)) return false;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(8) !== 13 || view.getUint32(12) !== 0x49484452) return false;
  const width = view.getUint32(16), height = view.getUint32(20);
  return width > 0 && height > 0 && width <= MAX_CAMERA_WIDTH && height <= MAX_CAMERA_HEIGHT && width * height <= 1920000;
}

export async function captureCameraFrame(video) {
  if (!video || video.readyState < 2 || !video.videoWidth || !video.videoHeight) {
    throw new Error("Camera is not ready. Wait for the preview and try again.");
  }
  const scale = Math.min(1, MAX_CAMERA_WIDTH / video.videoWidth, MAX_CAMERA_HEIGHT / video.videoHeight);
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.floor(video.videoWidth * scale));
  canvas.height = Math.max(1, Math.floor(video.videoHeight * scale));
  const context = canvas.getContext("2d");
  if (!context) throw new Error("Image capture is unavailable in this browser.");
  context.drawImage(video, 0, 0, canvas.width, canvas.height);
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, "image/png"));
  if (!blob || !blob.size || blob.size > MAX_CAMERA_BYTES) throw new Error("Image is too large. Move closer to one question and retry.");
  return blob;
}

export async function readCameraFrame(blob, signal) {
  const response = await fetch("/api/copilot/camera-question", { method: "POST", headers: { "Content-Type": "image/png" }, body: blob, signal });
  const body = await response.json().catch(() => null);
  if (!response.ok) throw new Error(body?.error || "Could not read the question. Retry or type it instead.");
  if (typeof body?.text !== "string" || !body.text.trim() || body.text.length > MAX_CAMERA_TEXT) throw new Error("No readable question. Move closer and retry.");
  return body.text.trim();
}
