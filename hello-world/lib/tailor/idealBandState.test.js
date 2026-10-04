// N105 Step 8 (4b) — the band-state machine + the clean-verdict license (K3).
// Binds to: N105.plan.r2.md Step 8 + PL-10; N105.ux.r2.md 5.8 (three axes, the
// 36-combination table, P1 forbidden-phrase sweep), UX-26/UX-34/UX-43; N106 AC-17.
//
// WHY THIS IS THE HEADLINE POWER ROW (K3, SILENT). A partial or absent review
// rendering the clean "No issues flagged" verdict over an unanalyzed draft is the
// single worst outcome: the user submits believing they passed. The pure machine
// below must grant the clean license in EXACTLY ONE of the 36 input combinations
// and in no other render the forbidden clean-verdict phrases.
//
// MUTANTS (built & watched in the scratchpad pass):
//   m1  verdictClean = (flags.length === 0), ignoring coverage -> true on every
//       partial-empty combo -> "exactly one true" + partial-headline sweep red
//   m2  trust coverage.complete without checking evaluatedCategories -> the
//       complete-but-incomplete-categories combo greens -> red (via reviewVerdict)
//   m3  raw ===  text compare for freshness -> a trimmed-vs-untrimmed fresh
//       result reads other-version -> the trailing-newline test reds
//   m4  missing coverage treated as complete -> partial combos grant the license
//   no-op control: reorder two independent precedence checks -> all green
//
// RED on HEAD: module absent (collection failure); satisfiability proven by the
// scratchpad reference.

import { describe, it, expect } from "vitest";
import { idealBandState } from "./idealBandState.js";

const SEVEN = [
  "missing-keyword",
  "vague-unsupported",
  "repetition",
  "unverifiable-metric",
  "employer-plausibility",
  "consistency",
  "unsupported-authority",
];

const APP_TEXT = "Jane Doe\nSenior Engineer\nReduced support tickets at Acme Corp";

// Build an `ideal` for a given (R, thin, hasFindings) triple.
function buildIdeal(R, thin, hasFindings) {
  if (R === "none") {
    return { applicationReady: { result: APP_TEXT }, review: null };
  }
  const coverage =
    R === "complete"
      ? { evaluatedCategories: SEVEN, complete: true }
      : { evaluatedCategories: SEVEN.slice(0, 3), complete: false };
  const review = {
    flags: hasFindings ? [{ draftKind: "applicationReady", spanId: "s1", category: "vague-unsupported", message: "x" }] : [],
    unresolvedQualifications: [],
    removed: [],
    leftOut: [],
    coverage,
    counts: { kept: 3, keptAccomplishments: thin ? 0 : 2, removed: 0, leftOut: 0 },
  };
  return { applicationReady: { result: APP_TEXT }, review };
}

// Build the inputs for a given (F, R, thin, hasFindings) combination.
function buildInputs(F, R, thin, hasFindings) {
  const ideal = buildIdeal(R, thin, hasFindings);
  let currentText = APP_TEXT; // fresh
  let handEdited = false;
  if (F === "edited") {
    currentText = `${APP_TEXT}\nAn edit I made`;
    handEdited = true;
  } else if (F === "other-version") {
    currentText = `${APP_TEXT}\nA different saved version`;
    handEdited = false;
  }
  return { ideal, currentText, handEdited };
}

const FORBIDDEN = [
  /no issues flagged/i,
  /no weaknesses/i,
  /nothing (was )?(flagged|found)/i,
  /found nothing/i,
  /no (problems|concerns|issues)\b/i,
  /all clear/i,
  /looks good/i,
  /\bpassed\b/i,
  /\bverified\b/i,
  /safe to send/i,
];

const FS = ["fresh", "edited", "other-version"];
const RS = ["none", "partial", "complete"];

describe("idealBandState — the clean license is granted in EXACTLY ONE of 36 combos (UX-26)", () => {
  it("verdictClean is true only for (fresh, complete, not-thin, no-findings)", () => {
    const trueCombos = [];
    for (const F of FS) {
      for (const R of RS) {
        for (const thin of [false, true]) {
          for (const hasFindings of [false, true]) {
            const state = idealBandState(buildInputs(F, R, thin, hasFindings));
            expect(typeof state.verdictClean).toBe("boolean"); // total over all 36
            if (state.verdictClean) trueCombos.push({ F, R, thin, hasFindings });
          }
        }
      }
    }
    expect(trueCombos).toEqual([{ F: "fresh", R: "complete", thin: false, hasFindings: false }]);
  });

  it("the clean headline (and only it) contains the C17 phrase; the other 35 contain no forbidden phrase", () => {
    for (const F of FS) {
      for (const R of RS) {
        for (const thin of [false, true]) {
          for (const hasFindings of [false, true]) {
            const state = idealBandState(buildInputs(F, R, thin, hasFindings));
            const headline = String(state.headline || "");
            if (state.verdictClean) {
              expect(headline).toMatch(/no issues flagged/i); // positive control
            } else {
              for (const re of FORBIDDEN) {
                expect(headline).not.toMatch(re);
              }
            }
          }
        }
      }
    }
  });
});

describe("idealBandState — Axis F freshness (m3 guard, UX-43)", () => {
  it("a FRESH result whose current text differs only by a trailing newline still reads fresh (normalize, not raw ===)", () => {
    const ideal = buildIdeal("complete", false, false);
    const state = idealBandState({ ideal, currentText: `${APP_TEXT}\n`, handEdited: false });
    // Trimmed-equal to the reviewed text -> fresh -> clean license granted.
    expect(state.verdictClean).toBe(true);
  });

  it("a text-only hand edit reads 'edited', not 'other-version' (UX-43)", () => {
    const ideal = buildIdeal("complete", false, false);
    const state = idealBandState({
      ideal,
      currentText: `${APP_TEXT}\nAn inserted line`,
      handEdited: true,
    });
    expect(state.verdictClean).toBe(false);
    expect(String(state.headline)).not.toMatch(/no issues flagged/i);
  });
});

describe("idealBandState — the partial copy never offers an unreachable remedy (UX-34)", () => {
  it("a partial review's headline does not say 'needs the AI engine'", () => {
    const ideal = buildIdeal("partial", false, false);
    const state = idealBandState({ ideal, currentText: APP_TEXT, handEdited: false });
    expect(String(state.headline)).not.toMatch(/needs the (ai|gemini) engine/i);
    // and it must distinguish itself as a partial review
    expect(String(state.headline).toLowerCase()).toMatch(/partial|mechanical|unchecked/);
  });

  it("the no-review state (R=none) renders its own copy, never the clean verdict", () => {
    const state = idealBandState({
      ideal: buildIdeal("none", false, false),
      currentText: APP_TEXT,
      handEdited: false,
    });
    expect(state.verdictClean).toBe(false);
    expect(String(state.headline)).not.toMatch(/no issues flagged/i);
  });
});
