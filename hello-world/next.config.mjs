/** @type {import('next').NextConfig} */
const nextConfig = {
  // tesseract.js loads its worker/wasm at runtime; keep it out of the server
  // bundle so webpack doesn't try to bundle the worker script.
  serverExternalPackages: ["tesseract.js"],

  // Clickjacking protection: neither header was sent anywhere before this.
  // Both must agree on 'self'/SAMEORIGIN (never 'none'/DENY) because
  // lib/document/combineDocuments.js's printCombinedHtml drives Save-as-PDF
  // through iframe.srcdoc, and a srcdoc document inherits this policy with
  // this app's own origin as its ancestor. Set here (not in middleware) so
  // every path — including API routes — gets exactly one value for each
  // header, unconditionally. Do not add any other CSP directive: a broader
  // policy would break emotion's runtime-injected styles and would also be
  // inherited by the srcdoc print frame.
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Frame-Options", value: "SAMEORIGIN" },
          { key: "Content-Security-Policy", value: "frame-ancestors 'self'" },
        ],
      },
    ];
  },
};

export default nextConfig;
