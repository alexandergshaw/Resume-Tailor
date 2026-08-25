// The page citation has to be READABLE, or the feature that exists to make an
// answer trustworthy is the least legible thing in it.
//
// R-228 already settled the rule for this app and stated it in numbers:
// `--text-muted` measures below the 4.5:1 WCAG threshold for normal text, so
// NEW surfaces use `--text-secondary`; the existing uses under `app/copilot`
// are a separate, pre-existing problem that is not licence to add more.
//
// The citation shipped in `--text-muted`. Measured against the background it
// actually renders on — `--bg-soft`, which is the fill of all three panels
// that render AnswerLines (CopilotDashboard's RealPanel, QuestionFeed's
// QuestionCard, and practice's SampleAnswer) — that is 3.90:1 in the default
// light theme, against 4.5:1 required. It is `variant="caption"` at 0.75rem,
// so it is normal text and the 3:1 large-text allowance does not apply.
//
// Two assertions, because either alone is weak: the computed ratio (which a
// token change could silently break) and the token the component actually
// names (which is what R-228's rule is written in terms of). Reading source
// text is normally a poor test and is right here, because the property IS
// which token the component chose.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { tokens } from "@/app/theme/tokens.js";

const lightTokens = tokens.light;
const darkTokens = tokens.dark;

const read = (rel) => readFileSync(path.join(process.cwd(), rel), "utf8");

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

// WCAG 1.4.3 for text under 18.66px regular.
const REQUIRED = 4.5;

describe("the answer-line page citation clears the contrast threshold", () => {
  it("is not painted in the token R-228 forbids for new surfaces", () => {
    const src = read("app/copilot/AnswerLines.js");
    // Anchor on the JSX, not on the identifier. An earlier version of this
    // case searched for "line.pageSource" and matched the doc COMMENT sixty
    // lines above the markup, so its 600-character window covered prose and
    // the assertion passed against the very code it was written to reject.
    const start = src.indexOf("{line.pageSource ? (");
    expect(start).toBeGreaterThan(-1);
    const citationBlock = src.slice(start, src.indexOf(") : null}", start));
    // Positive control: the window really does contain the styling, so a
    // future refactor that moves the sx elsewhere fails loudly here rather
    // than silently making this vacuous again.
    expect(citationBlock).toContain("variant=\"caption\"");
    expect(citationBlock).toContain("color:");
    expect(citationBlock).not.toContain("var(--text-muted)");
    // The POSITIVE half, and this case was weak without it: "not
    // --text-muted" is satisfied by a third token that fails 4.5:1 just as
    // badly, and by no color token at all. The measurement case below is
    // written in terms of --text-secondary specifically, so this is what ties
    // the two together — without it, that case measures a token the component
    // need not be using.
    expect(citationBlock).toContain("var(--text-secondary)");
  });

  it("meets 4.5:1 on the panel fill it actually renders on, in BOTH themes", () => {
    // --bg-soft, not --bg-surface: RealPanel, QuestionCard and SampleAnswer
    // all paint the soft fill behind these lines, and it is the darker of the
    // two in light mode — so measuring against white would flatter it.
    expect(contrast(lightTokens["text-secondary"], lightTokens["bg-soft"])).toBeGreaterThanOrEqual(REQUIRED);
    expect(contrast(darkTokens["text-secondary"], darkTokens["bg-soft"])).toBeGreaterThanOrEqual(REQUIRED);
  });

  it("records why the muted token was rejected, so nobody re-introduces it", () => {
    // The failing measurement itself, pinned. If someone later darkens
    // --text-muted app-wide this goes green and the rule above can be
    // revisited deliberately rather than by accident.
    expect(contrast(lightTokens["text-muted"], lightTokens["bg-soft"])).toBeLessThan(REQUIRED);
  });
});
