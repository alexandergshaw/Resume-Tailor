import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const read = (name) => readFileSync(join(here, name), "utf8");
// Matches `wc -l`, which is the metric this project's 1000-line cap is stated
// in. A bare `split` count includes the empty string after a trailing newline
// and reports 1000 for a file `wc -l` calls 999 — an off-by-one landing
// exactly on the boundary these assertions exist to police.
const lineCount = (src) => src.split("\n").length - (src.endsWith("\n") ? 1 : 0);

// AC-X1. The question pipeline leaves useLiveSession.js, and actually leaves.
//
// WHY A SOURCE-TEXT TEST, WHICH IS NORMALLY A POOR ONE. The property under
// test IS the shape of the source: that the caller stopped holding this logic
// and started delegating it. Every piece-level test of an extracted hook
// imports that hook DIRECTLY, so a refactor can ship completely inert — the
// new module sitting beside its caller, fully tested, and never imported. That
// has happened in this repo: 27 tests passed against a component extraction
// whose caller was still 1320 lines, still rendered the defect being fixed,
// and never imported any of the three new components. The regression case
// would have been closed on paper with nothing changed on screen.
//
// WHY THE SPLIT IS FORCED. `useLiveSession.js` reached 999 of this project's
// hard 1000-line cap. The last change to it got back under by tightening prose
// written moments earlier, which is not repeatable — the next feature to touch
// this file fails verification before it starts. It is the fifth extraction
// out of this file (useSessionLogRecorder, useDraftAnswer, useQuestionPin,
// useVoiceCues, useCueActions preceded it), and each of those records the same
// reason in its own header.
//
// WHY THE QUESTION PIPELINE IS THE SEAM. `addQuestion`, `addManualQuestion`,
// `acceptQuestion`, `evaluateUtterance` and `handleUtterance` are one job —
// turning a finished utterance into an answered card — and they are the
// largest coherent block in the file after `start`, which is the session
// lifecycle and is entangled with every callback the session takes.

const CALLER = "useLiveSession.js";
const EXTRACTED = "useQuestionPipeline.js";

// A CEILING with real headroom, not a number tuned to today's file. Two
// failures this project has already suffered pull in opposite directions: a
// bound set to the freshly-extracted size went red on the very next legitimate
// change, and the reflex was to shave comments to hit it; while "under 1000"
// is satisfied by a token extraction that moves nothing. 880 is far enough out
// that only real drift back toward the cap reaches it, and tight enough that
// an extraction which moved nothing cannot pass.
const CALLER_CEILING = 880;

describe("useLiveSession.js is under the cap with room to grow (AC-X1)", () => {
  it("is comfortably below the ceiling, not merely under the hard cap", () => {
    const lines = lineCount(read(CALLER));
    expect(lines).toBeLessThan(CALLER_CEILING);
  });

  it("keeps every extracted module under the cap too", () => {
    // A split that just moves the problem is not a split.
    for (const name of [
      CALLER,
      EXTRACTED,
      "useCueActions.js",
      "useDraftAnswer.js",
      "useQuestionPin.js",
      "useVoiceCues.js",
      "useSessionLogRecorder.js",
    ]) {
      expect(lineCount(read(name))).toBeLessThan(1000);
    }
  });
});

describe("the extraction is wired, not merely present (AC-X1)", () => {
  it("imports the extracted hook", () => {
    expect(read(CALLER)).toMatch(/import \{[^}]*useQuestionPipeline[^}]*\} from "\.\/useQuestionPipeline"/);
  });

  it("calls it", () => {
    // Naming the CALL SITE, not just the import — adding a correct module and
    // never invoking it is the single most likely way to finish this refactor
    // with a green suite and nothing actually moved.
    expect(read(CALLER)).toMatch(/useQuestionPipeline\(/);
  });

  it("no longer defines the pipeline callbacks itself", () => {
    // The other half of "it actually left": the caller must not still hold a
    // copy. Asserted as definitions (`const x = useCallback`), not as bare
    // mentions, so passing one of these down as an argument or naming it in a
    // comment does not trip the check.
    const caller = read(CALLER);
    for (const name of [
      "addQuestion",
      "addManualQuestion",
      "acceptQuestion",
      "evaluateUtterance",
      "handleUtterance",
    ]) {
      expect(caller).not.toMatch(new RegExp(`const ${name} = useCallback`));
    }
  });

  it("the extracted module actually defines them", () => {
    // The positive control for the assertion above. Without it, that check is
    // an assertion of ABSENCE and is satisfied by simply deleting the feature
    // — which this project has shipped before: every dedupe case said "still
    // only one card", which is exactly what a totally deaf detector produces.
    const extracted = read(EXTRACTED);
    for (const name of [
      "addQuestion",
      "addManualQuestion",
      "acceptQuestion",
      "evaluateUtterance",
      "handleUtterance",
    ]) {
      expect(extracted).toMatch(new RegExp(`const ${name} = useCallback`));
    }
  });

  it("says why it left, the way its four siblings do", () => {
    // Every previous extraction out of this file records the line cap as its
    // reason. A module with no such note reads like a design boundary somebody
    // chose, and the next person tries to justify it on cohesion grounds.
    expect(read(EXTRACTED)).toMatch(/1000|line cap|useLiveSession/i);
  });
});
