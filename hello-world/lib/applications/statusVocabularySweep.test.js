// AC-3a — the status vocabulary has ONE home. This sweep is the executable
// half of that criterion: every `.js` file under app/ and lib/ (excluding
// test files) is searched, with comments stripped first, for any of the 11
// `applications.status` values written as a double-quoted literal.
//
// Precedent for this exact discipline — a directory walker, a paired
// positive control, and self-exclusion by exact resolved path rather than a
// `.test.js` suffix rule — is lib/supabase/driveMigrationShape.test.js.
//
// MEASURED, not assumed: a raw sweep of this corpus turns up EIGHT files, not
// the "the module, plus the two dialogs if inlined" outcome the original
// acceptance criteria envisioned. Five of the eight are coincidental
// collisions with a DIFFERENT vocabulary (a React `key=`, a
// `Promise.allSettled` result `.status`, an email keyword list, and
// `interview_stages.stage_type` twice) — each individually verified below,
// by reading the exact line, not assumed from a name. The remaining three are
// real: the vocabulary module itself (expected — it is the one place
// permitted to name every value), plus TWO residual files this wave's own
// brief places off limits (app/page.js, lib/feed/tailorAndQueue.js) that
// still pass a bare status string as a literal ARGUMENT at a handful of call
// sites 3-plan-dataloss.md's own F-1/F-7 sections name and deliberately do
// NOT convert to a `STATUS.*` constant. See the comments on
// `KNOWN_RESIDUALS` below for the exact citations — this is reported as a
// finding, not silently normalised away.

import { describe, it, expect, beforeAll } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { APPLICATION_STATUSES } from "@/lib/applications/statusVocabulary.js";

const ROOT = fileURLToPath(new URL("../../", import.meta.url));
const APP_DIR = path.join(ROOT, "app");
const LIB_DIR = path.join(ROOT, "lib");

// Excluded by exact resolved path, never by a `.test.js` suffix rule (the
// walker below already excludes every `.test.js` file, but that exclusion
// covers this file only incidentally — a corpus change that stopped
// filtering test files must still not make this sweep flag itself).
const SELF_PATH = path.resolve(fileURLToPath(import.meta.url));

// Read from the module rather than hand-typed a second time, so this sweep's
// notion of "the 11 statuses" can never drift from the module's own —
// exactly the drift AC-4's partition test exists to prevent for every OTHER
// consumer, applied here too.
const STATUSES = APPLICATION_STATUSES;

function hasStatusLiteral(text) {
  return STATUSES.some((status) => text.includes(`"${status}"`));
}

// Strips block comments first (handles a comment spanning multiple lines),
// then strips a `//` to end-of-line PROVIDED it is not inside a string —
// naive quote tracking, but sufficient for this corpus: no file swept here
// puts a "//" inside a string literal adjacent to a status word.
function stripComments(src) {
  const withoutBlocks = src.replace(/\/\*[\s\S]*?\*\//g, "");
  return withoutBlocks
    .split("\n")
    .map((line) => {
      let inString = null;
      for (let i = 0; i < line.length; i++) {
        const ch = line[i];
        if (inString) {
          if (ch === "\\") {
            i += 1;
            continue;
          }
          if (ch === inString) inString = null;
          continue;
        }
        if (ch === '"' || ch === "'" || ch === "`") {
          inString = ch;
          continue;
        }
        if (ch === "/" && line[i + 1] === "/") return line.slice(0, i);
      }
      return line;
    })
    .join("\n");
}

let SOURCE_CACHE = null;

function sourceFiles() {
  if (SOURCE_CACHE) return SOURCE_CACHE;
  const found = [];
  const walk = (dir) => {
    for (const name of readdirSync(dir)) {
      const full = path.join(dir, name);
      if (statSync(full).isDirectory()) {
        walk(full);
        continue;
      }
      if (!full.endsWith(".js")) continue;
      if (full.endsWith(".test.js")) continue;
      if (path.resolve(full) === SELF_PATH) continue;
      found.push(full);
    }
  };
  walk(APP_DIR);
  walk(LIB_DIR);
  SOURCE_CACHE = found.map((f) => [path.relative(ROOT, f).split(path.sep).join("/"), readFileSync(f, "utf8")]);
  return SOURCE_CACHE;
}

beforeAll(() => {
  sourceFiles();
}, 60_000);

// ---------------------------------------------------------------------------
// Coincidental collisions with a DIFFERENT vocabulary — each individually
// read and verified (not assumed from the file name). Excluding these is
// what makes the sweep below meaningful instead of permanently red from
// prose that has nothing to do with `applications.status`.
// ---------------------------------------------------------------------------
const KNOWN_FALSE_POSITIVES = new Set([
  // `<MenuItem key="applied">` — a React list key on the StatusBar's own
  // "Mark as applied" menu item, not a write to applications.status.
  "app/components/StatusBar.js",
  // `stage.stage_type || "phone_screen"` — interview_stages.stage_type
  // (lib/tracking/stages.js's STAGE_TYPE_OPTIONS), a DIFFERENT column and a
  // DIFFERENT vocabulary that happens to share one value's spelling.
  "app/components/TrackingTab.js",
  // `faceResult.status === "rejected"` — a Promise.allSettled() settlement
  // status, not applications.status.
  "lib/copilot/bodyLandmarks.js",
  // JOB_SIGNAL_WORDS — an email body/subject keyword list used to guess
  // whether an inbound email is job-related, not a status write.
  "lib/gmail/emailUtils.js",
  // The SAME interview_stages.stage_type vocabulary TrackingTab.js reads.
  "lib/tracking/stages.js",
]);

// ---------------------------------------------------------------------------
// Real `applications.status` literals that remain after this wave, OUTSIDE
// this wave's allowed files, each with the exact citation for why the
// literal was not converted to a `STATUS.*` constant.
// ---------------------------------------------------------------------------
const KNOWN_RESIDUALS = new Set([
  // THE MODULE ITSELF — expected. It is the one file this criterion permits
  // to name every value, because it is what everything else is supposed to
  // read from instead.
  "lib/applications/statusVocabulary.js",
  // 3-plan-dataloss.md PART 4 / F-1's own "[R2-M2] three call sites" ruling
  // explicitly leaves `handleTrackJob`'s `status: "tracking"`,
  // `handleUrlSubmit`'s `status: "applied"` and `handleTailorFeedPosting`'s
  // `status: "applied"` as literal arguments to `upsertApplication(...)` —
  // "fixed TRANSITIVELY... without changing a character at the call site."
  // A fourth, unrelated site (`loadAutoTailored`'s
  // `.eq("status", "auto_tailored")`, a feature query no criterion in this
  // chunk names) also remains. app/page.js is off limits to this wave — see
  // this wave's brief and the finding recorded in the final report.
  "app/page.js",
  // `tailorAndQueueOne`'s initial `upsertApplication(admin, {..., status:
  // "tracking"})` call, which establishes the row before the queue-placement
  // write. F-7 converts the SECOND statement (the queue placement) to
  // `writeApplicationStatus(..., STATUS.AUTO_QUEUED)` but never names this
  // first one. lib/feed/tailorAndQueue.js is off limits to this wave.
  "lib/feed/tailorAndQueue.js",
]);

describe("[src] applications.status literals — AC-3a, one home", () => {
  it("[control] the sweep walks a populated tree and excludes only itself by resolved path", () => {
    const swept = sourceFiles().map(([rel]) => rel);
    expect(swept.length).toBeGreaterThan(100);
    expect(swept).toContain("lib/applications/statusVocabulary.js");
    expect(swept).not.toContain("lib/applications/statusVocabularySweep.test.js");
  });

  it("[canary] every one of the 11 status literals is individually detectable, and there are exactly 11", () => {
    // Closes the "multi-limb grep hides a dead limb" trap: prove each OR
    // branch actually fires against a synthetic hit, rather than trusting
    // that the real corpus happens to exercise every one of the eleven.
    expect(STATUSES.length).toBe(11);
    for (const status of STATUSES) {
      expect(hasStatusLiteral(`const x = "${status}";`), `"${status}" should be detectable`).toBe(true);
    }
    expect(hasStatusLiteral('const x = "screening";')).toBe(false);
  });

  it("[canary] stripComments removes a /* */ block and a // line comment, but keeps real code", () => {
    const src = [
      'const a = "tailored"; /* also mentions "applied" here */',
      '// a whole-line comment naming "offer"',
      'const b = "withdrawn"; // trailing comment naming "rejected"',
    ].join("\n");
    const stripped = stripComments(src);
    expect(stripped).toContain('"tailored"');
    expect(stripped).toContain('"withdrawn"');
    expect(stripped).not.toContain('"applied"');
    expect(stripped).not.toContain('"offer"');
    expect(stripped).not.toContain('"rejected"');
  });

  it("[control] the checker finds the vocabulary module itself (positive control)", () => {
    const [, src] = sourceFiles().find(([rel]) => rel === "lib/applications/statusVocabulary.js");
    expect(hasStatusLiteral(stripComments(src))).toBe(true);
  });

  it("[control] stripping comments does not eat real code — app/page.js still names a real literal", () => {
    // False-negative control: proves the stripper is not so aggressive it
    // erases genuine code. The specific site is F-1's own named residual
    // (handleTrackJob), not a guess.
    const [, src] = sourceFiles().find(([rel]) => rel === "app/page.js");
    expect(stripComments(src)).toContain('"tracking"');
  });

  it("[control] a comment-only mention is NOT flagged — app/api/auto-apply-queue/[id]/route.js", () => {
    // False-positive control: this file's header comment explains the
    // allow-list by quoting `"offer"` in prose. The RAW source matches (proof
    // this file was not simply silent on the vocabulary to begin with); the
    // STRIPPED source must not.
    const [, src] = sourceFiles().find(([rel]) => rel === "app/api/auto-apply-queue/[id]/route.js");
    expect(hasStatusLiteral(src)).toBe(true);
    expect(hasStatusLiteral(stripComments(src))).toBe(false);
  });

  it("[pinned] every excluded false positive really does carry a coincidental hit — the exclusion is not vacuous", () => {
    for (const rel of KNOWN_FALSE_POSITIVES) {
      const entry = sourceFiles().find(([r]) => r === rel);
      expect(entry, `expected ${rel} to exist in the swept corpus`).toBeDefined();
      const [, src] = entry;
      expect(hasStatusLiteral(stripComments(src)), `${rel} was expected to still raw-match`).toBe(true);
    }
  });

  it("consolidates applications.status literals to ONE place, plus two named off-lane residuals — toEqual, not toContain", () => {
    const flagged = sourceFiles()
      .filter(([rel]) => !KNOWN_FALSE_POSITIVES.has(rel))
      .filter(([, src]) => hasStatusLiteral(stripComments(src)))
      .map(([rel]) => rel)
      .sort();

    expect(flagged).toEqual(["app/page.js", "lib/applications/statusVocabulary.js", "lib/feed/tailorAndQueue.js"]);

    // Every flagged file must be an EXPECTED residual — not merely "not a
    // false positive". A ninth file appearing here (a brand-new stray
    // literal) fails this even if the toEqual above were relaxed to
    // toContain, which is why toEqual is used above and this is a second,
    // independent check of the same property.
    for (const rel of flagged) {
      expect(KNOWN_RESIDUALS.has(rel), `${rel} is flagged but not a named, cited residual`).toBe(true);
    }
  });
});
