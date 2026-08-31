// Ratchet for the files Wave 5C's app/page.js extraction touches or is
// pinned against. Same shape as lib/feed/liveFeedWiring.test.js:74-85 --
// there is no max-lines eslint rule in this repo, so without a test like
// this the ceiling is only enforced by a wc -l line in a hand-written report
// that nobody re-runs on the next change.
//
// WHAT THIS PROTECTS: that the `<DocumentPreviewDialog .../>` mount block
// (formerly app/page.js:3172-3270, 99 lines) stays OUT of page.js -- i.e.
// the file is not drifting back toward the hard limit the "page.js
// consolidation" effort exists to bring it under. This is a regression
// guard on the *shape of the source*, not on behaviour: a page.js that grew
// back to 3309+ lines could still pass every behavioural test in the suite
// while undoing the entire point of this wave.
//
// Every bound below has real margin, not a number tuned to today's exact
// byte count -- except app/hooks/useDocumentPreview.js, which is called out
// explicitly (see its own comment) because it has almost none left.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";

const read = (rel) => readFileSync(new URL(rel, import.meta.url), "utf8");
const lineCount = (rel) => read(rel).split("\n").length;

describe("app/page.js: strictly smaller than it was before Wave 5C", () => {
  it("stays under 3309 lines (its size immediately before the extraction) with room to spare", () => {
    // ARCH.md rev 2 Wave 5C: "app/page.js has strictly fewer than 3309
    // lines. Do not raise the constant." It was 3309 before this wave and
    // ~3218 after -- 91 lines of margin, so an unrelated future change of a
    // few dozen lines does not trip this, only a real regrowth of the
    // mount block (or something equally sized) would.
    expect(lineCount("../../app/page.js")).toBeLessThan(3309);
  });
});

describe("[src] every file this feature creates or is pinned against stays under 1000 lines", () => {
  const CAPPED_AT_1000 = [
    // Created by Wave 5C.
    "../../app/components/DocumentPreviewMount.js",
    // Pre-existing files ARCH.md rev 2 Wave 5C pins alongside the page.js
    // ratchet -- DocumentPreviewDialog.js is what DocumentPreviewMount.js
    // renders; useDriveDocuments mounts inside DocumentPreviewMount.js in
    // the next wave, not here, so neither of these gets Drive-wave lines
    // added to it by this change.
    "../../app/components/DocumentPreviewDialog.js",
  ];

  it.each(CAPPED_AT_1000)("%s stays under 1000 lines", (file) => {
    expect(lineCount(file)).toBeLessThan(1000);
  });
});

describe("app/hooks/useDocumentPreview.js: one line of margin, on purpose", () => {
  it("stays under 935 lines", () => {
    // This file sits at 934 lines today against this 935 bound -- a single
    // line of margin, not an oversight. It is called out explicitly (rather
    // than folded into the generic <1000 sweep above) so the ratchet fails
    // LOUDLY on the very next change that touches this file, instead of
    // quietly leaving one line of room that the change after that consumes
    // unnoticed. The next change that needs to grow this file must extract
    // logic into lib/ rather than add lines here directly -- do not "fix"
    // this test by raising the number.
    expect(lineCount("../../app/hooks/useDocumentPreview.js")).toBeLessThan(935);
  });
});
