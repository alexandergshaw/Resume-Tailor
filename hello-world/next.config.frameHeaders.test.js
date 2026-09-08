import { describe, it, expect } from "vitest";
import { pathToRegexp } from "next/dist/compiled/path-to-regexp";
import nextConfig from "./next.config.mjs";

// WHY THIS FILE EXISTS
//
// At 93ad8f7 this app sends NO frame-protection header of any kind. Measured,
// not assumed: `next.config.mjs` is 7 lines with no `headers()` key;
// `middleware.js` is 11 lines that only delegate to `updateSession`;
// `lib/supabase/middleware.js` touches cookies and redirects and never a
// response header; and `vercel.json` carries only `crons`, so nothing sets or
// overrides one at the platform edge either. A repo-wide grep for
// "X-Frame-Options", "frame-ancestors" and "Content-Security-Policy" over
// app/, lib/, public/ and the config files returns nothing outside comments.
//
// The consequence is that any origin on the internet can put /copilot, /
// (the tailor surface) or any résumé page in an invisible iframe over its own
// UI and harvest clicks from a signed-in victim. The data behind that session
// is legal name, address, phone number, full employment history and sometimes
// salary. That is the clickjacking surface this file pins shut.
//
// WHAT THIS FILE CAN AND CANNOT PROVE
//
// It exercises the real artifact Next consumes: it calls the actual exported
// `nextConfig.headers()` and resolves its rules against real request paths
// using Next's own bundled path-to-regexp, applying Next's documented
// last-rule-wins override. That is behavioural coverage of the config
// contract, not a source-text grep for the string "X-Frame-Options" — a grep
// like that cannot tell you the header reaches a response, and this repo
// already has a recorded case where one forced a module to keep a lint
// violation.
//
// It still cannot prove the byte leaves the server. That claim needs a running
// server and is a MANUAL CHECK:
//
//   MANUAL: from hello-world/, `npm run build && npm run start`, then
//     curl -sI http://localhost:3000/copilot | grep -i "frame"
//     curl -sI http://localhost:3000/api/drive/connect | grep -i "frame"
//   Both must show exactly one `X-Frame-Options: SAMEORIGIN` and one
//   `Content-Security-Policy: frame-ancestors 'self'`.
//
//   MANUAL: with that build running, exercise the combined "Save as PDF"
//   download (lib/document/combineDocuments.js `printCombinedHtml`). It frames
//   the app's own generated HTML with `iframe.srcdoc`, and a srcdoc document
//   INHERITS the parent's CSP. That inheritance is exactly why the criteria
//   require `frame-ancestors 'self'` and NOT `'none'`: under `'none'` the
//   srcdoc frame's ancestor (this app's own origin) matches nothing and the
//   print path is at risk of being blocked, while `'self'` admits it and still
//   denies every cross-origin framer. The print dialog must still open.
//
// The internal specifier `next/dist/compiled/path-to-regexp` is deliberate:
// `next` is a direct dependency, path-to-regexp is not, and compiling the rule
// with the same matcher Next uses is what makes the path assertions real
// rather than a re-implementation of Next's matching. This file is a test and
// is never bundled by `next build`. If a Next upgrade moves that path, replace
// the import — do not weaken the assertions to source-text matching.

/** Routes that render a document an attacker could frame, plus one API route:
 *  Next's `headers()` rules are matched before the filesystem and apply to
 *  route handlers too (the framework's own CORS example uses `/api/:path*`),
 *  so /api/* must be covered by the same rule and is asserted here. */
const PROTECTED_PATHS = [
  "/", // the tailor surface: résumé text, employment history
  "/copilot", // live + practice interview, camera and mic
  "/experience", // the experience library
  "/library",
  "/login", // public per middleware — still framable, still clickjackable
  "/auth/callback", // Supabase OAuth return; public per middleware
  "/api/drive/oauth2callback", // returns HTML, so it is a framable document
];

const XFO = "x-frame-options";
const CSP = "content-security-policy";

/** Every rule `headers()` returns, or [] when the key is missing entirely. */
async function rules() {
  if (typeof nextConfig.headers !== "function") return [];
  return (await nextConfig.headers()) ?? [];
}

/** Rules whose `source` matches `path`, split by whether they are gated on a
 *  `has`/`missing` condition. A frame header delivered only under a condition
 *  is a header an attacker can arrange to be absent. */
async function matchingRules(path) {
  const unconditional = [];
  const conditional = [];
  for (const rule of await rules()) {
    if (!rule?.source) continue;
    if (!pathToRegexp(rule.source).test(path)) continue;
    const gated = Boolean(rule.has?.length) || Boolean(rule.missing?.length);
    (gated ? conditional : unconditional).push(rule);
  }
  return { unconditional, conditional };
}

/** The effective response headers for `path`, applying Next's documented
 *  "if two rules set the same key, the last one wins" override. */
async function effectiveHeaders(path) {
  const { unconditional } = await matchingRules(path);
  const out = new Map();
  for (const rule of unconditional) {
    for (const { key, value } of rule.headers ?? []) {
      out.set(String(key).toLowerCase(), String(value));
    }
  }
  return out;
}

/** How many matching rules set `key` at all — Next's override collapses these
 *  to one value, but two sources for one header is how a later edit ends up
 *  shipping a comma-joined `SAMEORIGIN, DENY` that browsers may ignore. */
async function ruleCountSetting(path, key) {
  const { unconditional, conditional } = await matchingRules(path);
  return [...unconditional, ...conditional].filter((rule) =>
    (rule.headers ?? []).some((h) => String(h.key).toLowerCase() === key),
  ).length;
}

/** Parse a CSP header value into directive-name -> value-tokens. */
function parseCsp(value) {
  const directives = new Map();
  for (const part of value.split(";")) {
    const tokens = part.trim().split(/\s+/).filter(Boolean);
    if (tokens.length === 0) continue;
    directives.set(tokens[0].toLowerCase(), tokens.slice(1));
  }
  return directives;
}

describe("next.config.mjs delivers frame protection (AC-1)", () => {
  it("exposes a headers() function at all", async () => {
    expect(typeof nextConfig.headers).toBe("function");
  });

  it.each(PROTECTED_PATHS)("sends X-Frame-Options: SAMEORIGIN for %s", async (path) => {
    const headers = await effectiveHeaders(path);
    expect(headers.get(XFO)).toBe("SAMEORIGIN");
  });

  it.each(PROTECTED_PATHS)("sends frame-ancestors 'self' for %s", async (path) => {
    const csp = await effectiveHeaders(path).then((h) => h.get(CSP));
    expect(csp, `no Content-Security-Policy applies to ${path}`).toBeTypeOf("string");
    expect(parseCsp(csp ?? "").get("frame-ancestors")).toEqual(["'self'"]);
  });
});

describe("the two controls must not disagree (AC-2)", () => {
  // CSP2 §7.7.1: "The frame-ancestors directive obsoletes the X-Frame-Options
  // header. If a resource has both policies, the frame-ancestors policy SHOULD
  // be enforced and the X-Frame-Options policy SHOULD be ignored." SHOULD, not
  // MUST — browsers have historically differed, so the only safe design is to
  // make the two say the same thing and never rely on precedence. Both are
  // wanted: frame-ancestors is the modern control, X-Frame-Options is the
  // legacy one older browsers still honour and is what protects them.
  it.each(PROTECTED_PATHS)("X-Frame-Options and frame-ancestors say the same thing for %s", async (path) => {
    const headers = await effectiveHeaders(path);
    const xfo = headers.get(XFO);
    const frameAncestors = parseCsp(headers.get(CSP) ?? "").get("frame-ancestors");
    expect(xfo, `X-Frame-Options missing for ${path}`).toBeTypeOf("string");
    expect(frameAncestors, `frame-ancestors missing for ${path}`).toBeTypeOf("object");
    const sameOriginOnly = xfo === "SAMEORIGIN" && JSON.stringify(frameAncestors) === JSON.stringify(["'self'"]);
    const denyBoth = xfo === "DENY" && JSON.stringify(frameAncestors) === JSON.stringify(["'none'"]);
    expect(sameOriginOnly || denyBoth, `X-Frame-Options ${xfo} disagrees with frame-ancestors ${frameAncestors}`).toBe(true);
  });

  it.each(PROTECTED_PATHS)("exactly one rule sets each frame header for %s", async (path) => {
    // Two rules setting X-Frame-Options is how a response ends up with a
    // comma-joined value, which several browsers treat as invalid and ignore
    // outright — turning a "hardened" app back into a framable one.
    expect(await ruleCountSetting(path, XFO)).toBe(1);
    expect(await ruleCountSetting(path, CSP)).toBe(1);
  });

  it.each(PROTECTED_PATHS)("delivers the frame headers unconditionally for %s", async (path) => {
    // A header gated on `has`/`missing` is a header an attacker can arrange to
    // be absent by controlling the request.
    const { conditional } = await matchingRules(path);
    const gatedKeys = conditional.flatMap((rule) =>
      (rule.headers ?? []).map((h) => String(h.key).toLowerCase()),
    );
    expect(gatedKeys).not.toContain(XFO);
    expect(gatedKeys).not.toContain(CSP);
    // and the unconditional set is where they actually are:
    const headers = await effectiveHeaders(path);
    expect(headers.has(XFO) && headers.has(CSP)).toBe(true);
  });
});

describe("this stays a frame-protection change, not a CSP project (AC-3)", () => {
  // Scope guard, and a real correctness constraint rather than bureaucracy. A
  // CSP header carrying ONLY frame-ancestors imposes no script or style
  // restriction, so it cannot break MUI/emotion's runtime-injected styles. The
  // moment someone adds default-src/script-src/style-src here, two things
  // break at once: emotion's injected <style> tags, and the srcdoc print path
  // in lib/document/combineDocuments.js, which INHERITS whatever policy this
  // header carries. Widening this header is its own project with its own
  // measurement — it must not ride along on the clickjacking fix.
  it.each(PROTECTED_PATHS)("the CSP set here carries frame-ancestors and nothing else for %s", async (path) => {
    const csp = await effectiveHeaders(path).then((h) => h.get(CSP));
    expect(csp, `no Content-Security-Policy applies to ${path}`).toBeTypeOf("string");
    expect([...parseCsp(csp ?? "").keys()]).toEqual(["frame-ancestors"]);
  });

  it("does not silently break the Drive OAuth popup or the OAuth callback", async () => {
    // Both flows this app has that involve a third party are POPUPS, not
    // frames: useDriveDocuments.js line 561 opens /api/drive/connect with
    // window.open and the callback talks back over window.opener.postMessage,
    // and the Supabase OAuth return is a top-level redirect through
    // app/auth/callback/route.js. Neither X-Frame-Options nor frame-ancestors
    // applies to a popup or a top-level navigation, so same-origin framing
    // protection cannot break either — but both routes must still be COVERED
    // by the rule, because the callback returns a framable HTML document.
    for (const path of ["/api/drive/connect", "/api/drive/oauth2callback", "/auth/callback"]) {
      const headers = await effectiveHeaders(path);
      expect(headers.get(XFO), `${path} is uncovered`).toBe("SAMEORIGIN");
    }
  });
});
