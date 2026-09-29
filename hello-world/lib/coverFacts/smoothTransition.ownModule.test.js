import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";

// N92 Wave 3 (Control B) -- AC-B8a, the STRUCTURAL "strictly user-initiated"
// guard, made provable by putting the smoothing seam in its OWN module
// (lib/coverFacts/smoothTransition.js). The unattended paths -- the N72
// auto-insert path (useCompanyResearch.js), the auto-insert planner
// (factInsertion.js), and the tailor cron -- must NOT import that module, so a
// smoothing engine call can never fire on generation, a repaint, a reload, a
// version switch, Control A, or Control C. A file-level import census is the
// only thing that proves this cheaply; it is impossible if the smoothing
// handler were co-located in useCompanyResearch.js, which also hosts the
// auto-insert path (design N92 section 3.1).
//
// This is a source-text census (loop-tdd rule 10's sanctioned exception), so it
// carries its OWN canaries proving the import detector discriminates.
//
// HONEST RED/GUARD split (AC-B8 states this verbatim):
//   * GENUINELY RED at HEAD: a USER-INITIATED production module must import the
//     smoothing seam -- at HEAD nothing does (the module does not exist), so the
//     seam is unreachable and this reds.
//   * VACUOUS-GUARD at HEAD: "the unattended paths do not import it" is trivially
//     true while the module does not exist. Disclosed as vacuous, not counted as
//     coverage; it becomes load-bearing the moment the module lands.

const ROOT = process.cwd();
const SEAM = "coverFacts/smoothTransition";

// Detect an ES import that pulls from the smoothing seam. Matches
//   import ... from "@/lib/coverFacts/smoothTransition"
//   import ... from "../coverFacts/smoothTransition.js"
// and a dynamic import(...) of the same, but NOT the seam's own name in prose.
function importsSeam(src) {
  if (typeof src !== "string") return false;
  const staticImport = /import[\s\S]*?from\s*['"][^'"]*coverFacts\/smoothTransition(?:\.js)?['"]/;
  const dynImport = /import\(\s*['"][^'"]*coverFacts\/smoothTransition(?:\.js)?['"]\s*\)/;
  return staticImport.test(src) || dynImport.test(src);
}

function read(rel) {
  const full = path.join(ROOT, rel);
  return existsSync(full) ? readFileSync(full, "utf8") : null;
}

// The unattended paths B8a forbids from reaching the smoothing seam.
const UNATTENDED_PATHS = [
  "app/hooks/useCompanyResearch.js", // hosts autoInsertFactsForJob (N72) + Control A/C
  "lib/acceptedFacts/factInsertion.js", // the auto-insert planner (planAcceptForEntry)
  "app/api/cron/tailor/route.js", // the headless tailor cron (inserts no facts today)
];

describe("[canary] the import detector discriminates (source-text census control)", () => {
  it("flags a real import of the smoothing seam", () => {
    expect(importsSeam('import { requestSmoothTransition } from "@/lib/coverFacts/smoothTransition";')).toBe(true);
    expect(importsSeam('import x from "../coverFacts/smoothTransition.js";')).toBe(true);
    expect(importsSeam('const m = await import("@/lib/coverFacts/smoothTransition.js");')).toBe(true);
  });
  it("does NOT flag an unrelated import or a mere mention in prose", () => {
    expect(importsSeam('import { planMoveFact } from "@/lib/acceptedFacts/factMove";')).toBe(false);
    expect(importsSeam("// see coverFacts/smoothTransition for the smoothing seam")).toBe(false);
    expect(importsSeam('const label = "smoothTransition";')).toBe(false);
  });
});

describe("the unattended paths never import the smoothing seam (AC-B8a) -- VACUOUS at HEAD, load-bearing once B lands", () => {
  // DISCLOSED: at HEAD the seam does not exist so no file imports it and this
  // passes vacuously -- it is NOT counted as coverage. It bites the day someone
  // co-locates smoothing on the auto path.
  for (const rel of UNATTENDED_PATHS) {
    it(`${rel} does not import smoothTransition`, () => {
      const src = read(rel);
      expect(src, `${rel} is missing -- the census cannot run`).not.toBeNull();
      expect(importsSeam(src), `${rel} imports the smoothing seam -- an unattended path can now fire a paid engine call`).toBe(false);
    });
  }
});

describe("a user-initiated production path DOES reach the smoothing seam (AC-B8a) -- GENUINELY RED at HEAD", () => {
  it("some production module under app/ imports smoothTransition, proving the seam is reachable from a click", () => {
    // The seam is worthless if NOTHING production imports it: it would be a
    // test-only export (loop-tdd rule 6 / the export-reachability sweep). At
    // HEAD the confirm UI + the route do not exist, so this reds. Once Wave 3
    // lands, the confirm surface (app/components/preview/*) and/or the route
    // import it and this goes green.
    const CANDIDATE_IMPORTERS = [
      "app/components/DocumentPreviewMount.js",
      "app/components/preview/CoverFactSmoothConfirm.js",
      "app/api/cover-fact-smooth/route.js",
    ];
    const importers = CANDIDATE_IMPORTERS.filter((rel) => {
      const src = read(rel);
      return src && importsSeam(src);
    });
    expect(
      importers.length,
      "no production, user-initiated module imports smoothTransition -- the smoothing seam is unreachable (or test-only)",
    ).toBeGreaterThan(0);
  });
});
