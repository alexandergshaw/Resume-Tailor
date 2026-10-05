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

// ---------------------------------------------------------------------------
// N111 follow-up -- the cover-blank data loss has THREE sites, not two, and the
// cover's edit flag must follow the cover. The assertions above only prove each
// handler NAMES the helper; a handler could name it and still carry the old bare
// write beside it. These joins read the handler's own "done" write (the
// updateTailoringJob call that sets status "done") and prove the cover is
// written ONLY through the helper, and that the helper is handed the payload
// (without it the helper cannot tell an Ideal run from a standard one and would
// blank the cover just as before).
//
// DISCLOSED LIMIT: as above, a source read proves the wiring, not the runtime
// branch. The pure decisions carry their teeth in
// lib/tailor/idealCoverPreserve.test.js.

// The text from the "(" at `open` through its matching ")", or "" if unbalanced.
function matchParens(src, open) {
  let depth = 0;
  for (let i = open; i < src.length; i += 1) {
    if (src[i] === "(") depth += 1;
    else if (src[i] === ")") {
      depth -= 1;
      if (depth === 0) return src.slice(open, i + 1);
    }
  }
  return "";
}

// The argument text of the first `name(...)` call in `src` whose arguments match
// `mustMatch`; "" when there is none.
function callArgs(src, name, mustMatch) {
  const needle = `${name}(`;
  for (let at = src.indexOf(needle); at !== -1; at = src.indexOf(needle, at + needle.length)) {
    const args = matchParens(src, at + name.length);
    if (mustMatch.test(args)) return args;
  }
  return "";
}

// `src` with the first `name(...)` call removed.
function withoutCall(src, name) {
  const at = src.indexOf(`${name}(`);
  if (at === -1) return src;
  const args = matchParens(src, at + name.length);
  return src.slice(0, at) + src.slice(at + name.length + args.length);
}

const doneWrite = (handler) => callArgs(sliceOf(handler), "updateTailoringJob", /status:\s*"done"/);
const COVER_KEY = /\bcoverLetter(ResultLines|DocxB64)\b/;
const HANDLERS = ["handleTailorJob", "handleUrlSubmit", "handleTailorFeedPosting"];

describe("INSTRUMENT CANARY -- the cover-write extractor tells a bare write from a routed one", () => {
  const bare = `x(); updateTailoringJob(id, { status: "done", coverLetterResultLines: lines, coverLetterDocxB64: b64 })`;
  const shorthand = `updateTailoringJob(id, (e) => ({ ...e, status: "done", ...(applyCover ? { coverLetterResultLines, coverLetterDocxB64 } : {}) }))`;
  const routed = `updateTailoringJob(id, { status: "done", ...resolveIdealCoverEntryFields({ payload, applyCover: true, coverLetterResultLines: lines, coverLetterDocxB64: b64 }) })`;
  const bareOutside = (src) => COVER_KEY.test(withoutCall(callArgs(src, "updateTailoringJob", /status:\s*"done"/), "resolveIdealCoverEntryFields"));

  it("flags a bare key:value write and a bare shorthand write, and passes a routed one", () => {
    expect(bareOutside(bare)).toBe(true);
    expect(bareOutside(shorthand)).toBe(true);
    expect(bareOutside(routed)).toBe(false);
  });

  it("finds the done write (not some other updateTailoringJob call) in each real handler", () => {
    for (const name of HANDLERS) {
      expect(doneWrite(name), `${name} has no updateTailoringJob({ status: "done" ... }) write`).not.toBe("");
    }
  });
});

describe("the cover entry-write is ROUTED through the helper at all three sites", () => {
  it.each(HANDLERS)("%s: its done write goes through resolveIdealCoverEntryFields and carries no cover key of its own", (name) => {
    const write = doneWrite(name);
    expect(write).toMatch(/resolveIdealCoverEntryFields\(/);
    expect(withoutCall(write, "resolveIdealCoverEntryFields")).not.toMatch(COVER_KEY);
  });

  it.each(HANDLERS)("%s: hands the helper the payload and the scope, so it can tell an Ideal run from a standard one", (name) => {
    const args = callArgs(doneWrite(name), "resolveIdealCoverEntryFields", /./);
    expect(args).toMatch(/\bpayload\b/);
    expect(args).toMatch(/\bapplyCover\b/);
  });

  it("the FEED handler's cover write is the third site: it feeds the helper its own cover locals (RED on HEAD -- bare unconditional write)", () => {
    const args = callArgs(doneWrite("handleTailorFeedPosting"), "resolveIdealCoverEntryFields", /./);
    expect(args).toMatch(/coverLetterResultLines:\s*nextCoverLetterResultLines/);
    expect(args).toMatch(/coverLetterDocxB64:\s*nextCoverLetterDocxB64/);
  });
});

describe("the cover's edit flag follows the cover decision at all three sites", () => {
  it.each(HANDLERS)("%s: derives its cleared edit scopes from regeneratedEditedScopes, reading the entry's existing flags", (name) => {
    const write = doneWrite(name);
    expect(write).toMatch(/withClearedEditedScopes\(\s*entry\s*,/);
    const args = callArgs(write, "regeneratedEditedScopes", /./);
    expect(args).toMatch(/\bpayload\b/);
    expect(args).toMatch(/\bapplyCover\b/);
  });

  it.each(HANDLERS)("%s: has no inline scope list or fixed { resume: false, cover: false } left to clear the cover flag on an Ideal run", (name) => {
    const write = doneWrite(name);
    expect(write).not.toMatch(/\["cover"\]/);
    expect(write).not.toMatch(/edited:\s*\{\s*resume:\s*false\s*,\s*cover:\s*false\s*\}/);
  });
});
