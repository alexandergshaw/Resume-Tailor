// N111 -- the three N107 go-live gaps on secondary paths, pinned as call-site
// JOINS over app/page.js. page.js is a line-capped god component that cannot be
// mounted in jsdom (it needs the whole app shell), so the faithful instrument for
// each JOIN is a comment-stripped source read of the real handler -- the
// sanctioned tool for a capped caller (loop-traps-tests: "gate the CHANGE, not
// only the pieces"; idealChipDelivery.test.js uses it for handleTailorJob's
// delivery join).
//
// The three gaps:
//   #1 handleTailorJob        -- a both-scope Ideal regenerate must PRESERVE the
//                                cover (consult resolveIdealCoverEntryFields; see
//                                lib/tailor/idealCoverPreserve.test.js for the teeth)
//   #2 handleTailorFeedPosting -- an Ideal feed result must OPEN the preview (not
//                                auto-download) and STORE payload.ideal on the entry
//   #3 handleUrlSubmit        -- an Ideal URL result must STORE payload.ideal so
//                                its preview renders the review bands
//
// DISCLOSED LIMIT (step-6 flag): a source read proves the handler NAMES the
// decision/seam and reaches it; it does NOT prove the branch is taken at runtime.
// Each gap's runtime proof needs a verifier mounting the live app:
//   #1 regenerate a both-scope Ideal run on a job with a cover, assert the cover
//      survives; #2 tailor an Ideal feed posting, assert the preview opens and no
//      file downloads; #3 tailor an Ideal URL, assert the preview shows bands.
// The pure layers (idealCoverPreserve.test.js, idealChipDelivery.test.js,
// idealDelivery.goLive.test.js) carry each decision's own teeth.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const raw = readFileSync(fileURLToPath(new URL("./page.js", import.meta.url)), "utf8");
// Strip block and line comments, preserving the `://` in URLs, so the assertions
// read CODE not prose (loop-traps-tests: a source-text sweep must strip comments,
// else a comment naming a module reads as using it).
const code = raw.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");

// Extract one function's body by brace-matching from its declaration, skipping
// the parameter list first (a default like `opts = {}` puts a `{` inside the
// params). Robust regardless of what follows the handler (the next handler, or
// the component's `return (` JSX).
function sliceOf(name) {
  const start = code.search(new RegExp(`(async\\s+)?function\\s+${name}\\s*\\(`));
  if (start === -1) return "";
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
  return code.slice(bodyStart, j + 1);
}

describe("STRIP CANARY -- comment stripping works and the slices are real", () => {
  it("a token that exists only in a comment is gone after stripping", () => {
    // page.js has `// E2's fire point` etc.; the stripper removes line comments.
    expect(code).not.toMatch(/E2's fire point/);
    // and a real code token survives.
    expect(code).toMatch(/async function handleTailorJob/);
  });

  it.each(["handleTailorJob", "handleUrlSubmit", "handleTailorFeedPosting"])(
    "the %s slice is found and is a balanced body",
    (name) => {
      const fn = sliceOf(name);
      expect(fn.startsWith("{")).toBe(true);
      expect(fn.endsWith("}")).toBe(true);
      expect(fn).toMatch(/updateTailoringJob/);
    },
  );
});

describe("#1 handleTailorJob preserves the cover on a both-scope Ideal regenerate", () => {
  const fn = () => sliceOf("handleTailorJob");

  it("CANARY -- the slice holds the cover entry-write (so a wiring absence means something)", () => {
    // Today the cover is written via `applyCover ? { coverLetterResultLines, ... }`.
    expect(fn()).toMatch(/coverLetterResultLines/);
  });

  it("the handler consults the cover-preserve decision for its cover entry-write (RED on HEAD -- not wired)", () => {
    // The pure decision (idealCoverPreserve.test.js) returns {} for an Ideal run,
    // so spreading it writes no blank cover. The handler must route its cover
    // entry-write through it instead of the bare `applyCover ? {...} : {}`.
    expect(fn()).toMatch(/resolveIdealCoverEntryFields/);
  });
});

describe("#2 handleTailorFeedPosting opens the Ideal preview and stores the ideal block", () => {
  const fn = () => sliceOf("handleTailorFeedPosting");

  it("CANARY -- the slice auto-downloads today (so the wiring assertions below mean something)", () => {
    expect(fn()).toMatch(/downloadDocxFiles/);
  });

  it("consults the Ideal chip/feed delivery decision (RED on HEAD -- feed path downloads unconditionally)", () => {
    // Reuse the committed decision (lib/tailor/idealDelivery.js#resolveIdealChipDelivery,
    // its over/under-fire controls live in idealChipDelivery.test.js). The feed
    // path must consult it rather than always calling downloadDocxFiles.
    expect(fn()).toMatch(/resolveIdealChipDelivery/);
  });

  it("stores the payload's `ideal` block on the entry so the preview can render the bands (RED on HEAD)", () => {
    // Reads the ideal block off the payload...
    expect(fn()).toMatch(/payload\??\.ideal/);
    // ...and stores it on the tailoring entry (an `ideal:` key in an update).
    expect(fn()).toMatch(/\bideal:/);
  });

  it("reaches a real preview-open seam (RED on HEAD -- the feed path opens no preview today)", () => {
    expect(fn()).toMatch(/finishByOpeningPreview|openResumePreview/);
  });
});

describe("#3 handleUrlSubmit stores the ideal block so the URL preview renders the bands", () => {
  const fn = () => sliceOf("handleUrlSubmit");

  it("CANARY -- the URL path already opens the preview (so #3 is only the missing store)", () => {
    // Unlike the feed path, handleUrlSubmit already calls finishByOpeningPreview;
    // the only gap is that no `ideal` rides the entry, so the preview has no bands.
    expect(fn()).toMatch(/finishByOpeningPreview/);
  });

  it("reads the payload's `ideal` block (RED on HEAD -- the URL path never reads it)", () => {
    expect(fn()).toMatch(/payload\??\.ideal/);
  });

  it("stores the ideal block on the tailoring entry (RED on HEAD -- the applyResume write has no ideal key)", () => {
    expect(fn()).toMatch(/\bideal:/);
  });
});
