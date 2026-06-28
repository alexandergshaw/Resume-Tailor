/** @type {import('next').NextConfig} */
const nextConfig = {
  // tesseract.js loads its worker/wasm at runtime; keep it out of the server
  // bundle so webpack doesn't try to bundle the worker script.
  serverExternalPackages: ["tesseract.js"],
};

export default nextConfig;
