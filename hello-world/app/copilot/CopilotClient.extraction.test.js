// AC-X1. CopilotClient.js sits at 975 lines against this project's 1000-line
// verification cap, so group T's wiring (a pin control, a company-brief panel
// and a voice-cue sidebar) cannot land until real code comes OUT of it first.
//
// The property under test IS the shape of the source — which module owns which
// piece, and how big the caller is left — so a source-text test is the right
// tool here, the same reasoning CopilotClient.structure.test.js already
// documents for JSX placement.
//
// Two failure modes this file exists to catch, both of which have shipped in
// this repo before:
//   1. A "extraction" that adds correct new modules and never wires them up:
//      the new files sit beside a caller that still contains the old code,
//      fully tested and never rendered. Hence the assertions that the caller
//      IMPORTS and USES each piece and that the old code is GONE from it.
//   2. Hitting a line target by deleting comments instead of moving code.
//      Hence a target well under the cap (820), plus a floor on the extracted
//      files' own sizes — a token extraction that moves four lines out passes
//      a bare "under 1000" check.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const read = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");
const lines = (src) => src.split("\n").length;

// F11: a raw line count is the one metric COMMENTS inflate, which makes it
// useless as the floor on an extracted file's size — a ten-line component under
// a thirty-five-line banner passes. This counts only lines that carry code.
const codeLines = (src) =>
  src
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("//") && !l.startsWith("*") && !l.startsWith("/*")).length;

const CLIENT = read("./CopilotClient.js");

describe("CopilotClient.js stays under the project's file-size cap", () => {
  // F1: this used to assert <= 820, the post-EXTRACTION figure. The file
  // landed at 817, so the cap was unsatisfiable the moment group T's own
  // wiring (pin state, the company-brief hook and panel, the cue sidebar,
  // pinnedId threading) started landing — and a test that can only be
  // satisfied by deleting comments is the exact failure this file's header
  // says it exists to prevent. 950 is the real cap: under the project's 1000
  // with genuine headroom, and reachable only because the three extractions
  // below actually moved code out.
  it("is at most 950 lines", () => {
    expect(lines(CLIENT)).toBeLessThanOrEqual(950);
  });
});

describe("the who's-talking bar moved to SpeakerBar.js", () => {
  it("exists and is not a stub", () => {
    expect(codeLines(read("./SpeakerBar.js"))).toBeGreaterThan(40);
  });

  it("owns the announcement state and the SpeakerChip row", () => {
    const bar = read("./SpeakerBar.js");
    expect(bar).toMatch(/barAnnouncement/);
    expect(bar).toMatch(/<SpeakerChip/);
    expect(bar).toMatch(/aria-live="polite"/);
  });

  it("is rendered by CopilotClient, which no longer holds the bar itself", () => {
    expect(CLIENT).toMatch(/<SpeakerBar/);
    expect(CLIENT).toMatch(/from "\.\/SpeakerBar"/);
    expect(CLIENT).not.toMatch(/<SpeakerChip/);
    expect(CLIENT).not.toMatch(/barAnnouncementNonceRef/);
  });

  it("stays inside the bounded live wrapper, above the fold", () => {
    // Same anchor CopilotClient.structure.test.js uses for the wrapper's end.
    const wrapperOpen = CLIENT.indexOf("ref={liveWrapperRef}");
    const wrapperClose = CLIENT.indexOf("{/* D1/AC-S3.11: split into its own file", wrapperOpen);
    const barIdx = CLIENT.indexOf("<SpeakerBar", wrapperOpen);
    expect(wrapperOpen).toBeGreaterThan(-1);
    expect(wrapperClose).toBeGreaterThan(wrapperOpen);
    expect(barIdx).toBeGreaterThan(wrapperOpen);
    expect(barIdx).toBeLessThan(wrapperClose);
  });
});

describe("the grounding notice moved to lib/copilot/groundingNotice.js", () => {
  it("is imported and called by CopilotClient, which no longer builds it inline", () => {
    expect(CLIENT).toMatch(/postingGroundingNotice/);
    expect(CLIENT).toMatch(/groundingNotice/);
    // The clause helper and the ternary chain both left.
    expect(CLIENT).not.toMatch(/function submittedDocsClause/);
    expect(CLIENT).not.toMatch(/The embedded engine drafts talking points on this server/);
  });
});

describe("the live-column measurement moved to useLiveColumnHeight.js", () => {
  it("exists and is not a stub", () => {
    expect(codeLines(read("./useLiveColumnHeight.js"))).toBeGreaterThan(15);
  });

  it("keeps the scroll-invariant offset and the dvh fallback", () => {
    const hook = read("./useLiveColumnHeight.js");
    expect(hook).toMatch(/window\.scrollY/);
    expect(hook).toMatch(/dvh/);
    expect(hook).toMatch(/ResizeObserver/);
  });

  // S12: the bans are CALL-shaped, not bare substrings. `not.toMatch(
  // /getBoundingClientRect/)` also forbids a comment explaining where the
  // measurement went, which pulls against the "nothing was lost" block below.
  // S9: `toMatch(/useLiveColumnHeight/)` is satisfied by the IMPORT LINE
  // alone, so a mutant that imports the hook, never calls it, and hardcodes
  // `const liveHeight = null` passed — silently deleting R-142's dual-screen
  // fix. The call-shaped assertion is what closes that.
  it("is used by CopilotClient, which no longer measures inline", () => {
    expect(CLIENT).toMatch(/useLiveColumnHeight\(/);
    expect(CLIENT).not.toMatch(/new ResizeObserver\(/);
    expect(CLIENT).not.toMatch(/\.getBoundingClientRect\(/);
    // The ref and the measured height still reach the JSX, and the height is
    // the hook's, not a local stand-in.
    expect(CLIENT).toMatch(/ref=\{liveWrapperRef\}/);
    expect(CLIENT).not.toMatch(/(?:const|let|var)\s+liveHeight\s*=/);
  });
});

describe("the extracted pieces are actually wired, not merely imported", () => {
  // S9: every one of these mutants passed the first version of this file.
  it("passes a real grounding notice to SessionSetup, not an empty string", () => {
    // `postingGroundingNotice=""` satisfies a bare /postingGroundingNotice/
    // match and deletes the privacy notice from the screen.
    expect(CLIENT).toMatch(/postingGroundingNotice=\{postingGroundingNotice\}/);
    expect(CLIENT).not.toMatch(/postingGroundingNotice=""/);
    // ...and the value handed over is the lib function's result.
    expect(CLIENT).toMatch(/postingGroundingNotice\(\{/);
  });

  it("keeps SpeakerBar's live region unconditional", () => {
    // BUG-2: a region that mounts already carrying its text is not announced;
    // only a text change on an already-mounted node is. Nesting it inside
    // `{barAnnouncement.text ? ... : null}` reintroduces that verbatim while
    // still matching a bare /aria-live="polite"/ check.
    const bar = read("./SpeakerBar.js");
    expect(bar).not.toMatch(/barAnnouncement\.text\s*\?/);
    expect(bar).not.toMatch(/barAnnouncement\.text\s*&&/);
  });
});

describe("nothing was lost on the way out", () => {
  // Every extracted file plus the caller, concatenated, must still carry the
  // load-bearing comment fragments that explained WHY each piece is the way it
  // is. Agents trim comments to hit a line target; these are the sentences
  // whose loss would cost the next reader a re-derivation of a real defect.
  const union = [
    CLIENT,
    read("./SpeakerBar.js"),
    read("./useLiveColumnHeight.js"),
    read("../../lib/copilot/groundingNotice.js"),
  ].join("\n");

  const mustSurvive = [
    "React bails out of re-rendering a mounted node",
    "getBoundingClientRect().top is viewport-relative",
    "mark yourself as yourself",
    "BUG-H5",
  ];

  for (const fragment of mustSurvive) {
    it(`still explains: ${fragment}`, () => {
      expect(union).toContain(fragment);
    });
  }
});
