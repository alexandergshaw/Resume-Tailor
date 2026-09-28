// N89 PART 1 (4b/TDD) -- THE PRODUCTION WIRING HOP (AC-9 / S-1).
//
// The rc tests hand `coverLetterFile` straight into useCompanyResearch, so they
// prove the HOOK honours it -- but they cannot prove PAGE.JS passes it. That is
// exactly the "harness wires differently from production" trap
// (loop-traps-tests): the hook could read coverLetterFile and page.js never
// supply it, leaving every Shape-B letter refusing in the real app while the
// suite is green. page.js already holds `coverLetterFile` in state (:123) and
// already forwards it to DocumentPreviewMount/createDocumentDownloaders, but the
// useCompanyResearch({...}) call at :250 does NOT include it today.
//
// This is a source-text assertion because the property IS the shape of the
// source (same justification as the landed component-extraction wiring tests):
// mounting page.js (3000+ lines) to observe one prop is impractical, and a
// render test that spreads or hand-builds the hook args would reproduce the very
// wiring bug it must catch. Comments are stripped first (the security-sweep
// lesson: a comment naming the symbol must not count as usage).
//
// RED ON HEAD: the useCompanyResearch call object contains tailoringMap,
// setTailoringMap, setPreviewReloadKey, defaultPlacement, supabase, currentUser
// -- but not coverLetterFile.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";
import { stripComments } from "../lib/sourceScan/tokenizeSource.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const PAGE_PATH = path.join(HERE, "page.js");

// Extract the balanced { ... } argument object of the FIRST `useCompanyResearch(`
// call in the (comment-stripped) source. Returns null if the call is absent.
function useCompanyResearchArgs(src) {
  const call = src.indexOf("useCompanyResearch(");
  if (call < 0) return null;
  const open = src.indexOf("{", call);
  if (open < 0) return null;
  let depth = 0;
  for (let i = open; i < src.length; i += 1) {
    const ch = src[i];
    if (ch === "{") depth += 1;
    else if (ch === "}") {
      depth -= 1;
      if (depth === 0) return src.slice(open, i + 1);
    }
  }
  return null;
}

describe("page.js threads coverLetterFile into useCompanyResearch (AC-9 wiring)", () => {
  const src = stripComments(readFileSync(PAGE_PATH, "utf8"));
  const args = useCompanyResearchArgs(src);

  it("the useCompanyResearch call site was located (extraction canary)", () => {
    expect(args, "could not find a useCompanyResearch({...}) call in page.js").toBeTruthy();
    // Canary: the extracted block is the real call -- it carries a key that is
    // known to be present today, so the assertion below is scoped to the right
    // object, not to a comment or an unrelated brace pair.
    expect(args).toMatch(/\btailoringMap\b/);
  });

  it("passes coverLetterFile as one of the hook's arguments", () => {
    // RED on HEAD: page.js:250 omits coverLetterFile from this object. The fix
    // is to add `coverLetterFile` (the state at page.js:123) to this call.
    expect(
      args,
      "page.js does not pass coverLetterFile into useCompanyResearch -- the hook cannot tell Shape B from Shape C in production, so every fresh Gemini letter refuses even after the hook fix lands",
    ).toMatch(/\bcoverLetterFile\b/);
  });
});
