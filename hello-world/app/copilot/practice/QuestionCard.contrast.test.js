// WCAG 1.4.3 (Contrast Minimum) — a light-mode contrast failure in
// practice mode's QuestionCard, the same pre-existing `--text-muted`
// problem app/copilot/answerLineContrast.test.js already measured and
// scoped to "the existing uses under `app/copilot`" when it fixed
// AnswerLines.js's page citation. This file is that problem's QuestionCard
// half.
//
// Two sites here paint real informational body copy in `--text-muted`,
// both direct descendants of this component's own outer Box, whose
// `background` is `var(--bg-surface)` (QuestionCard.js: the returned
// `<Box sx={{ ..., background: "var(--bg-surface)" }}>`) with nothing
// between them and it that sets a different background:
//   - "Getting your next question…" (the `loading` branch, plain
//     Typography with no `variant` — MUI defaults an unset variant to
//     body1, 1rem/16px at weight 400)
//   - "Finishing up your answer…" (the `settling` branch, `variant="body2"`
//     — 0.875rem/14px at weight 400)
// Neither is within even the 18.66px-bold / 24px floor WCAG 1.4.3 sets for
// "large text" (both are well under 18.66px AND neither is bold), so the
// 4.5:1 minimum applies to both, not the 3:1 large-text allowance.
//
// Two-part shape, same as answerLineContrast.test.js: a source check
// (which token) plus a numeric contrast computation from the tokens.js the
// app actually ships (the real ratio, not a hex-string guess) — either
// alone is weak; together they prove the component uses the token AND that
// the token fails/clears the threshold.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { tokens, MODES } from "@/app/theme/tokens.js";

const SRC_PATH = "app/copilot/practice/QuestionCard.js";
const read = () => readFileSync(path.join(process.cwd(), SRC_PATH), "utf8");

function stripComments(source) {
  return source.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/[^\n]*/g, "$1");
}

function channels(hex) {
  const h = String(hex).replace("#", "");
  return [0, 2, 4].map((i) => parseInt(h.substr(i, 2), 16) / 255);
}

function luminance(hex) {
  const [r, g, b] = channels(hex).map((c) => (c <= 0.03928 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

function contrast(fg, bg) {
  const a = luminance(fg);
  const b = luminance(bg);
  const [hi, lo] = a > b ? [a, b] : [b, a];
  return (hi + 0.05) / (lo + 0.05);
}

// WCAG 1.4.3 for text under 18.66px bold / 24px regular — see the module
// doc above for why both sites this file checks qualify as normal text.
const REQUIRED = 4.5;

describe("practice QuestionCard's status copy clears contrast in light mode", () => {
  it("does not paint any real usage in --text-muted (comments aside)", () => {
    const withoutComments = stripComments(read());
    expect(withoutComments).not.toMatch(/var\(--text-muted\)/);
  });

  it("uses --text-secondary at the two status sites instead (existing token, not a new one)", () => {
    const matches = read().match(/color:\s*"var\(--text-secondary\)"/g) || [];
    // 1 site already uses --text-secondary this way (the question-type
    // Chip label) — >= 3 is what the 2 sites this case exists for add on
    // top, as a floor rather than a brittle exact count.
    expect(matches.length).toBeGreaterThanOrEqual(3);
  });

  for (const mode of MODES) {
    it(`--text-secondary on --bg-surface (the card's own background) clears 4.5:1 in ${mode}`, () => {
      const ratio = contrast(tokens[mode]["text-secondary"], tokens[mode]["bg-surface"]);
      expect(
        ratio,
        `--text-secondary ${tokens[mode]["text-secondary"]} on --bg-surface ${tokens[mode]["bg-surface"]} = ${ratio.toFixed(2)}:1`
      ).toBeGreaterThanOrEqual(REQUIRED);
    });
  }

  it("records why --text-muted was rejected in light mode, so nobody re-introduces it here", () => {
    // Pinned failing measurement — same guard as
    // answerLineContrast.test.js's own final case and
    // CopilotDashboard.contrast.test.js's sibling case.
    const ratio = contrast(tokens.light["text-muted"], tokens.light["bg-surface"]);
    expect(ratio).toBeLessThan(REQUIRED);
  });
});
