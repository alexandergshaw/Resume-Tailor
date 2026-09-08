// WCAG 1.4.3 (Contrast Minimum) — a light-mode contrast failure in
// CopilotDashboard's own informational copy, distinct from (but caused by
// the same token as) the one R-228 already fixed one file over.
//
// app/copilot/answerLineContrast.test.js already measured and named this
// exact problem: "`--text-muted` measures below the 4.5:1 WCAG threshold
// for normal text, so NEW surfaces use `--text-secondary`; the existing
// uses under `app/copilot` are a separate, pre-existing problem that is not
// licence to add more." This file is that separate, pre-existing problem —
// CopilotDashboard.js's half.
//
// Four sites here paint real informational body copy in `--text-muted`,
// every one of them inside a panel whose fill is `--bg-soft`:
//   - CurrentAnswerPanel's "no current answer yet" copy (`!current` branch)
//   - CurrentAnswerPanel's "Drafting…" (status === "loading" branch)
//   - CurrentAnswerPanel's "no points" copy (final branch)
//   - ReadingSlot's "speed/filler: not measured yet" fallback
// CurrentAnswerPanel is wrapped in RealPanel (panelShells.js:32-39,
// `background: "var(--bg-soft)"`); ReadingSlot is called from DeliveryPanel,
// whose own Box also sets `background: "var(--bg-soft)"` (this file). All
// four Typography elements are `variant="body2"` — MUI's default body2 is
// 0.875rem (14px) at weight 400 — nowhere near the 18.66px-bold / 24px
// floor WCAG 1.4.3 sets for "large text", so the 4.5:1 minimum applies to
// every one of them, not the 3:1 large-text allowance.
//
// Two-part shape, same as answerLineContrast.test.js and for the same
// reason: a source check alone only proves which token was chosen, and a
// numeric check alone can't prove the COMPONENT actually uses the token it
// measures. Together they prove both, without asserting a specific hex
// string (a different failing colour would still fail the numeric case).

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { tokens, MODES } from "@/app/theme/tokens.js";

const SRC_PATH = "app/copilot/dashboard/CopilotDashboard.js";
const read = () => readFileSync(path.join(process.cwd(), SRC_PATH), "utf8");

// Same comment-stripping regex as app/theme/themeSystem.test.js, so a prose
// mention of the rejected token (this file's own module doc, or the
// existing "a 0.75rem caption fails contrast at the muted color" comment a
// few lines above the caption fix) can't be mistaken for real usage.
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

// WCAG 1.4.3 for text under 18.66px bold / 24px regular — every site this
// file checks (see the module doc above for why none of them qualify as
// "large text").
const REQUIRED = 4.5;

describe("CopilotDashboard's informational body copy clears contrast in light mode", () => {
  it("does not paint any real usage in --text-muted (comments aside)", () => {
    const withoutComments = stripComments(read());
    expect(withoutComments).not.toMatch(/var\(--text-muted\)/);
  });

  it("uses --text-secondary at the four sites instead (existing token, not a new one)", () => {
    const matches = read().match(/color:\s*"var\(--text-secondary\)"/g) || [];
    // 3 sites already use --text-secondary this way (the stale-draft
    // caption, and the two section titles) — >= 7 is what the 4 sites this
    // case exists for add on top, as a floor rather than a brittle exact
    // count a future unrelated edit would have to keep in lockstep.
    expect(matches.length).toBeGreaterThanOrEqual(7);
  });

  for (const mode of MODES) {
    it(`--text-secondary on --bg-soft (the panel fill these sites render on) clears 4.5:1 in ${mode}`, () => {
      const ratio = contrast(tokens[mode]["text-secondary"], tokens[mode]["bg-soft"]);
      expect(
        ratio,
        `--text-secondary ${tokens[mode]["text-secondary"]} on --bg-soft ${tokens[mode]["bg-soft"]} = ${ratio.toFixed(2)}:1`
      ).toBeGreaterThanOrEqual(REQUIRED);
    });
  }

  it("records why --text-muted was rejected in light mode, so nobody re-introduces it here", () => {
    // The failing measurement itself, pinned — if --text-muted is ever
    // darkened app-wide this goes green and the rule above can be revisited
    // deliberately instead of by accident (same guard as
    // answerLineContrast.test.js's own final case).
    const ratio = contrast(tokens.light["text-muted"], tokens.light["bg-soft"]);
    expect(ratio).toBeLessThan(REQUIRED);
  });
});
