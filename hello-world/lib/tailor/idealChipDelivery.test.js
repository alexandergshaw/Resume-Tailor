// N107 go-live (F-C) -- an Ideal generation on the chip/feed path OPENS THE
// PREVIEW and never auto-downloads; a standard run is unchanged.
//
// At N105 slice-1 shouldAutoOpenIdealPreview is DEAD: it has no production
// caller (exportReachability records it as test-referenced only). The chip/feed
// handler (app/page.js#handleTailorJob) auto-downloads every finished run via
// downloadDocxFiles. An Ideal result is two documents plus a review that lives
// only in the preview, so it must never be silently saved to disk: the handler
// must open the preview for review instead, and leave a standard run exactly as
// it is.
//
// This file pins the behavior in two layers:
//
//   (1) resolveIdealChipDelivery -- the PURE decision the handler must make,
//       unit-tested with controls. A NEW export of lib/tailor/idealDelivery.js
//       that wraps the existing shouldAutoOpenIdealPreview and adds the
//       never-auto-download-an-Ideal-result rule. "Pin the behavior, not the
//       helper name": the implementer may rename it, but a renamed function must
//       keep this truth table AND be wired at the call site below.
//
//   (2) a call-site WIRING check over app/page.js#handleTailorJob -- because
//       that handler lives in a line-capped god component that cannot be mounted
//       in jsdom (it needs the whole app shell), the faithful instrument for the
//       JOIN is a comment-stripped source read of the real caller, the sanctioned
//       tool for a capped caller (loop-traps-tests: "gate the CHANGE, not only
//       the pieces"). DISCLOSED LIMIT: this proves the handler consults the
//       decision and reaches the preview-open seam; it does NOT prove the branch
//       is taken at runtime (jsdom cannot render page.js). Layer (1) carries the
//       decision's teeth; a verifier mounting the live app is the missing
//       instrument.
//
// RED on HEAD: resolveIdealChipDelivery does not exist (layer 1), and
// handleTailorJob references neither it nor any preview-open nor payload.ideal
// (layer 2). Canary in layer 2 proves the function slice was found.

import { describe, it, expect } from "vitest";
import * as delivery from "./idealDelivery.js";

const resolve = (...args) => delivery.resolveIdealChipDelivery(...args);
const IDEAL_PAYLOAD = { result: "ready", ideal: { applicationReady: { result: "ready" }, hypothetical: { result: "h" } } };
const STANDARD_PAYLOAD = { result: "ready", resultLines: ["ready"] };

describe("resolveIdealChipDelivery -- the chip/feed delivery decision", () => {
  it("exports a function (RED on HEAD -- the decision is unbuilt)", () => {
    expect(typeof delivery.resolveIdealChipDelivery).toBe("function");
  });

  it("an Ideal run with no preview open OPENS the preview and does NOT auto-download (D1/D2)", () => {
    expect(resolve({ payload: IDEAL_PAYLOAD, previewOpen: false, opts: {} })).toEqual({
      openPreview: true,
      autoDownload: false,
    });
  });

  it("an Ideal run while a preview is already open does NOT displace it and still does NOT download (D3/D1)", () => {
    expect(resolve({ payload: IDEAL_PAYLOAD, previewOpen: true, opts: {} })).toEqual({
      openPreview: false,
      autoDownload: false,
    });
  });

  it("a skipDownload Ideal run (batch tailor-only) neither opens nor downloads (D4)", () => {
    expect(resolve({ payload: IDEAL_PAYLOAD, previewOpen: false, opts: { skipDownload: true } })).toEqual({
      openPreview: false,
      autoDownload: false,
    });
  });

  it("CONTROL -- a STANDARD run auto-downloads and never opens the preview (the Ideal path is scoped)", () => {
    // Over-fire guard: a build that opened the preview for every run, or that
    // suppressed the download for every run, reds here.
    expect(resolve({ payload: STANDARD_PAYLOAD, previewOpen: false, opts: {} })).toEqual({
      openPreview: false,
      autoDownload: true,
    });
  });

  it("CONTROL -- a standard skipDownload run downloads nothing and opens nothing", () => {
    expect(resolve({ payload: STANDARD_PAYLOAD, previewOpen: false, opts: { skipDownload: true } })).toEqual({
      openPreview: false,
      autoDownload: false,
    });
  });
});

describe("the chip/feed handler is WIRED to the decision (call-site join over app/page.js)", () => {
  // Extract the handleTailorJob function body by brace-matching from its
  // declaration, comment-stripped, so the assertions read CODE not prose
  // (loop-traps-tests: a source-text sweep must strip comments).
  async function handleTailorJobSource() {
    const { readFileSync } = await import("node:fs");
    const { fileURLToPath } = await import("node:url");
    const path = fileURLToPath(new URL("../../app/page.js", import.meta.url));
    const raw = readFileSync(path, "utf8");
    const code = raw.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");
    const start = code.indexOf("async function handleTailorJob");
    if (start === -1) return { code, fn: "" };
    // Skip the parameter list first: `opts = {}` default means the body's
    // opening brace is only the first `{` AFTER the params' closing `)`.
    let i = code.indexOf("(", start);
    let paren = 0;
    for (; i < code.length; i += 1) {
      if (code[i] === "(") paren += 1;
      else if (code[i] === ")") {
        paren -= 1;
        if (paren === 0) { i += 1; break; }
      }
    }
    const bodyStart = code.indexOf("{", i);
    let depth = 0;
    let j = bodyStart;
    for (; j < code.length; j += 1) {
      if (code[j] === "{") depth += 1;
      else if (code[j] === "}") {
        depth -= 1;
        if (depth === 0) break;
      }
    }
    return { code, fn: code.slice(bodyStart, j + 1) };
  }

  it("CANARY -- the handleTailorJob slice is found (so an absence assertion below means something)", async () => {
    const { fn } = await handleTailorJobSource();
    expect(fn).toMatch(/downloadDocxFiles/);
  });

  it("page.js imports the Ideal chip delivery decision (RED on HEAD -- not wired)", async () => {
    const { code } = await handleTailorJobSource();
    expect(code).toMatch(/resolveIdealChipDelivery/);
  });

  it("handleTailorJob consults the decision, reads the payload's `ideal` block, and reaches the preview-open seam", async () => {
    const { fn } = await handleTailorJobSource();
    // Consults the delivery decision rather than unconditionally downloading.
    expect(fn).toMatch(/resolveIdealChipDelivery/);
    // Stores/reads the Ideal block so the preview surface (idealSurfaceFor) has
    // something to render.
    expect(fn).toMatch(/\.ideal\b/);
    // Reaches the real preview-open seam used by the URL-paste flow.
    expect(fn).toMatch(/openResumePreview|finishByOpeningPreview/);
  });
});
