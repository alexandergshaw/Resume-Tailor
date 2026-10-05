// N107 go-live -- a cover-only regenerate must never take the Ideal level.
//
// An Ideal run produces a resume pair and returns no cover letter, but the chip
// and URL regenerate handlers write `coverLetterResultLines: []` over a cover
// letter whenever the run's scope includes it. So a "Regenerate cover letter"
// with the slider on Ideal would spend an Ideal run and then blank the user's
// letter. lib/tailor/tailorLevel.js#levelToRequestFields already keeps a
// "cover" scope on the saved 1-5 level; this pins that the two handlers that HAVE
// a scope actually pass it to appendTailorLevel.
//
// DISCLOSED LIMIT: app/page.js cannot be mounted in jsdom (it needs the whole app
// shell), so this is a comment-stripped read of the real source -- the same
// instrument idealChipDelivery.test.js uses for the chip handler's join. It proves
// the handlers hand `scope` over; levelToRequestFields' own suite proves what
// happens to it there.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const raw = readFileSync(fileURLToPath(new URL("./page.js", import.meta.url)), "utf8");
const code = raw.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");

// From a handler's declaration to the next sibling function declaration.
function handlerSlice(name) {
  const start = code.indexOf(`function ${name}(`);
  if (start === -1) return "";
  const rest = code.slice(start + 1);
  const next = rest.search(/\n {2}(async )?function \w+\(/);
  return next === -1 ? rest : rest.slice(0, next);
}

const CALL = /appendTailorLevel\(formData, tailorMode, aggressiveness, \{[^}]*\}\)/;

describe("the regenerate handlers hand their scope to appendTailorLevel", () => {
  it("CANARY -- every handler slice is found and contains the level call", () => {
    for (const name of ["handleTailorJob", "handleUrlSubmit", "handleTailorFeedPosting"]) {
      expect(handlerSlice(name), `${name} slice`).toMatch(CALL);
    }
  });

  it.each(["handleTailorJob", "handleUrlSubmit"])("%s passes `scope`", (name) => {
    expect(handlerSlice(name).match(CALL)[0]).toMatch(/\bscope\b/);
  });

  it("CONTROL -- the feed handler has no scope concept and passes none", () => {
    expect(handlerSlice("handleTailorFeedPosting").match(CALL)[0]).not.toMatch(/\bscope\b/);
  });
});
