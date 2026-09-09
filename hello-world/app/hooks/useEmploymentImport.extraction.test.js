// node — a SOURCE-TEXT test, same reasoning as its sibling
// app/hooks/useLayoutPrefs.extraction.test.js: the property under test is the
// shape of the source.
//
// app/hooks/useEmploymentImport.js is a LINE-BUDGET EXTRACTION out of
// app/page.js (3233 lines against a binding 3249 ceiling). It carries the
// "Import from résumé" action on the Materials tab's Employment History
// section: read a .docx/.txt on-device, get positions out of it, append them.
//
// This is the SIMPLEST of the three extractions to prove safe, and the guard
// says so explicitly: the module contains no effect at all, so it cannot
// reorder one. That claim is asserted rather than assumed, because it is the
// only thing standing between "a relocation" and "a behaviour change" if a
// later change adds an effect here.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const read = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");

const codeLines = (src) =>
  src
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("//") && !l.startsWith("*") && !l.startsWith("/*")).length;

const stripComments = (src) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");

const PAGE = read("../page.js");
const HOOK = read("./useEmploymentImport.js");
const PAGE_CODE = stripComments(PAGE);
const HOOK_CODE = stripComments(HOOK);

describe("the résumé employment import moved to useEmploymentImport.js", () => {
  it("[control] stripping comments leaves real code behind, in both files", () => {
    expect(PAGE_CODE).toMatch(/export default function Home\(\)/);
    expect(HOOK_CODE).toMatch(/export function useEmploymentImport\(/);
    // The stripper is not an identity function: both of these are RED without
    // it, because each phrase appears ONLY inside a comment.
    expect(HOOK).toMatch(/heuristic parser/); // module doc
    expect(HOOK_CODE).not.toMatch(/heuristic parser/);
    expect(PAGE).toMatch(/The hook holds/); // call-site comment
    expect(PAGE_CODE).not.toMatch(/The hook holds/);
  });

  it("exists and is not a stub", () => {
    // 91 today. The handler alone is 96 raw lines; a stub that re-implemented
    // only the happy path would fall well under this.
    expect(codeLines(HOOK)).toBeGreaterThan(70);
  });

  it("owns the whole import pipeline, including both parser paths", () => {
    expect(HOOK_CODE).toMatch(/async function importEmploymentFromResume\(file\)/);
    // The embedded-engine rule: never call the LLM route. Losing this branch
    // silently sends a local-only user's résumé over the network.
    expect(HOOK_CODE).toMatch(/if \(tailorEngine !== "embedded"\)/);
    expect(HOOK_CODE).toMatch(/fetch\("\/api\/extract-employment"/);
    expect(HOOK_CODE).toMatch(/positions = parseEmploymentHistory\(lines\)/);
    // The 4-slot cap and the de-dupe are what stop a re-upload stacking
    // duplicates; both are pure logic no other test covers.
    expect(HOOK_CODE).toMatch(/Math\.max\(0, 4 - existing\.length\)/);
    expect(HOOK_CODE).toMatch(/existingKeys\.has\(dedupeKey\(p\)\)/);
    expect(HOOK_CODE).toMatch(/offline parser — AI unavailable/);
  });

  it("page.js no longer holds any of it", () => {
    expect(PAGE_CODE).not.toMatch(/const \[employmentImport/);
    expect(PAGE_CODE).not.toMatch(/function importEmploymentFromResume/);
    expect(PAGE_CODE).not.toMatch(/extract-employment/);
    expect(PAGE_CODE).not.toMatch(/parseEmploymentHistory/);
    // The imports the move orphaned must be gone too — an unused import is
    // how a "deleted" block proves it was only half-deleted.
    expect(PAGE_CODE).not.toMatch(/isTextResume/);
    expect(PAGE_CODE).not.toMatch(/extractResumeTextLines/);
  });
});

describe("the extraction is ADOPTED, not merely added", () => {
  it("page.js imports it and destructures both returned values", () => {
    expect(PAGE_CODE).toMatch(
      /import \{ useEmploymentImport \} from "\.\/hooks\/useEmploymentImport"/,
    );
    expect(PAGE_CODE).toMatch(
      /const \{ employmentImport, importEmploymentFromResume \} = useEmploymentImport\(\{/,
    );
  });

  it("is handed the real controller and the real engine, not literals", () => {
    // `tailorEngine: "gemini"` type-checks, runs, and permanently disables the
    // embedded engine's on-device-only guarantee for this one action —
    // uploading a résumé the user believed never left the machine. That is
    // this extraction's version of the `sessionLogHasEvents={true}` mutant.
    const call = PAGE_CODE.slice(
      PAGE_CODE.indexOf("useEmploymentImport({"),
      PAGE_CODE.indexOf("});", PAGE_CODE.indexOf("useEmploymentImport({")) + 3,
    );
    expect(call).toMatch(/employmentCtl,/);
    expect(call).toMatch(/tailorEngine,/);
    expect(call).not.toMatch(/tailorEngine:/);
    expect(call).not.toMatch(/employmentCtl:/);
    expect(call.length).toBeLessThan(200);
  });

  it("both returned values reach <ApplyingControls>", () => {
    expect(PAGE_CODE).toMatch(/importEmploymentFromResume=\{importEmploymentFromResume\}/);
    expect(PAGE_CODE).toMatch(/employmentImport=\{employmentImport\}/);
  });
});

describe("the move is ORDER-PRESERVING, which is what made it safe", () => {
  it("holds no effect at all, so it cannot reorder one", () => {
    // The load-bearing claim. If a later feature genuinely needs an effect
    // here, AMEND this with the reason and re-derive where the call site must
    // sit — do not delete it. The guard is cheap and the property it names is
    // the one that made this move safe without any positional argument.
    expect(HOOK_CODE).not.toMatch(/\buseEffect\b/);
    expect(HOOK_CODE).not.toMatch(/\buseLayoutEffect\b/);
    // Exactly one useState, the action's own banner. More would mean state
    // was pulled across the boundary rather than relocated with its handler.
    expect(HOOK_CODE.match(/useState\(/g) || []).toHaveLength(1);
  });

  it("is instantiated in the exact gap its handler vacated", () => {
    const at = (needle) => {
      const i = PAGE_CODE.indexOf(needle);
      expect(i, `page.js no longer contains ${needle}`).toBeGreaterThan(-1);
      return i;
    };
    expect(at("useEmploymentImport({")).toBeGreaterThan(at("useLayoutPrefs()"));
    expect(at("useEmploymentImport({")).toBeLessThan(at("useMaterialsLocker({"));
  });
});

describe("nothing was lost on the way out", () => {
  const union = [PAGE, HOOK].join("\n");
  const mustSurvive = [
    // Why the embedded engine must never reach the route.
    "parse it entirely on-device with the",
    // Why re-uploading the same résumé does not stack duplicates.
    "doesn't stack duplicate entries",
  ];
  for (const fragment of mustSurvive) {
    it(`still explains: ${fragment}`, () => {
      expect(union).toContain(fragment);
    });
  }
});
