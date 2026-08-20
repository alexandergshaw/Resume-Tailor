// Global test-environment polyfills that this repo's tests need but jsdom
// (as pinned here) doesn't provide. jsdom implements no `CSS` global at all
// -- no CSS.escape, no CSS.supports (see jsdom/jsdom#1541) -- which is
// invisible for as long as no jsdom test resolves a `<label for>`
// association by id. app/components/JobDescriptionTab.test.js is the first
// one that does (its `accessibleName` helper calls `CSS.escape` to build a
// `label[for="..."]` selector).
//
// This file is loaded for every test (both the default "node" environment
// and per-file "jsdom" overrides) via test.setupFiles in vitest.config.js;
// it's a no-op cost for the node-environment majority.
// AC-R1: jsdom implements no `Element.prototype.scrollIntoView` at all
// (jsdom/jsdom#1695) -- every real browser does, and
// app/copilot/TranscriptView.js's page-scroll fallback
// (`lastRowRef.current?.scrollIntoView({ block: "nearest" })`) genuinely
// needs the method to exist, not to actually move anything under a test. A
// no-op keeps that code path exercised under jsdom (RoleDrillClient's
// recording tests are the first ones to feed real `finals` through this
// component) instead of every caller having to feature-detect a method
// every real browser already provides.
if (typeof globalThis.Element !== "undefined" && typeof globalThis.Element.prototype.scrollIntoView !== "function") {
  globalThis.Element.prototype.scrollIntoView = function scrollIntoView() {};
}

if (typeof globalThis.CSS === "undefined") {
  globalThis.CSS = {};
}
if (typeof globalThis.CSS.escape !== "function") {
  // The standard "serialize an identifier" algorithm
  // (https://drafts.csswg.org/cssom/#serialize-an-identifier), the same one
  // browsers implement for CSS.escape. Adapted from the public-domain
  // reference polyfill (Mathias Bynens, https://github.com/mathiasbynens/CSS.escape).
  globalThis.CSS.escape = function escape(value) {
    const string = String(value);
    const length = string.length;
    const firstCodeUnit = string.charCodeAt(0);
    let result = "";
    let index = -1;

    while (++index < length) {
      const codeUnit = string.charCodeAt(index);
      if (codeUnit === 0x0000) {
        result += "�";
        continue;
      }
      if (
        (codeUnit >= 0x0001 && codeUnit <= 0x001f) ||
        codeUnit === 0x007f ||
        (index === 0 && codeUnit >= 0x0030 && codeUnit <= 0x0039) ||
        (index === 1 && codeUnit >= 0x0030 && codeUnit <= 0x0039 && firstCodeUnit === 0x002d)
      ) {
        result += `\\${codeUnit.toString(16)} `;
        continue;
      }
      if (index === 0 && length === 1 && codeUnit === 0x002d) {
        result += `\\${string.charAt(index)}`;
        continue;
      }
      if (
        codeUnit >= 0x0080 ||
        codeUnit === 0x002d ||
        codeUnit === 0x005f ||
        (codeUnit >= 0x0030 && codeUnit <= 0x0039) ||
        (codeUnit >= 0x0041 && codeUnit <= 0x005a) ||
        (codeUnit >= 0x0061 && codeUnit <= 0x007a)
      ) {
        result += string.charAt(index);
        continue;
      }
      result += `\\${string.charAt(index)}`;
    }
    return result;
  };
}
