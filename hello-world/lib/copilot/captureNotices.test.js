// node (this repo's default environment). `lib/copilot/captureNotices.js` is a
// LINE-BUDGET EXTRACTION, not a chunk-C feature: `CopilotClient.js` sits at
// 948 lines against a hard, executable ceiling of 950
// (`CopilotClient.extraction.test.js:48-49`), and the natural relief — moving
// the choice-change subscriber block out — is impossible, because
// `CopilotClient.interviewTypeWiring.test.js` pins that block to that file by
// source text in at least fourteen assertions.
//
// So wave 0 moves `shareInstructions` (`CopilotClient.js:464-480`) into a
// genuinely NEW module instead. That distinction is the whole safety argument:
// "moving lines from one capped file into another capped file is not
// extraction" (prohibition 7), and chunk A lost a round to exactly that
// failure.
//
// Written BEFORE the implementation exists (step 4b): every case fails on the
// missing `./captureNotices.js` module until wave 0 lands.
//
// The three strings below are pinned by EQUALITY because the move must be
// behaviour-preserving: they are what `CopilotClient.js` renders today, and
// nothing else in the tree reads them (verified two ways — by identifier and
// by rendered string, both returning that one file). An extraction that
// "tidied" the wording while relocating it would be a content change wearing
// an extraction's clothes, and no other test in this repo would notice.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { shareInstructionsFor } from "./captureNotices.js";

const CLIENT_SOURCE = readFileSync(
  fileURLToPath(new URL("../../app/copilot/CopilotClient.js", import.meta.url)),
  "utf8",
);

const INPERSON = "Everyone speaks into your selected microphone. There is no tab or screen to share.";
const SYSTEM =
  'Share your Entire Screen (with "Share system audio" enabled) and allow your mic — use this when the interview is running in a desktop app (Zoom, Teams, etc.) rather than a browser tab.';
const TAB = 'Share the meeting tab (with "Share tab audio" enabled) and allow your mic.';

describe("shareInstructionsFor — the three branches, byte for byte", () => {
  it("describes no share dialog at all for the in-person source (AC-M1.5.3)", () => {
    // "inperson" is mic-only capture via `getUserMedia` — there IS no share
    // dialog — so neither the tab nor the system wording may render for it.
    // This branch says so instead of describing a picker that never appears.
    expect(shareInstructionsFor("inperson")).toBe(INPERSON);
  });

  it("gives the entire-screen wording, with its when-to-use note, for the system source", () => {
    expect(shareInstructionsFor("system")).toBe(SYSTEM);
  });

  it("keeps today's tab wording verbatim as the default", () => {
    expect(shareInstructionsFor("tab")).toBe(TAB);
  });

  it("falls to the tab wording for anything unrecognised, and never throws", () => {
    for (const source of [undefined, null, "", "retired-source", 42]) {
      expect(() => shareInstructionsFor(source)).not.toThrow();
      expect(shareInstructionsFor(source)).toBe(TAB);
    }
  });
});

describe("the in-person sentence keeps its PERIOD (adversarial review, screen readers)", () => {
  it("joins its two independent clauses with a full stop, never an em dash", () => {
    // This codebase's screen-reader rule, recorded in several copilot notices'
    // own comments and in `choiceChangeInvalidation.js:155-162`: an em dash is
    // not spoken as a pause at default punctuation settings, so a sentence
    // whose two independent clauses depend on that pause for meaning is a
    // defect, not a style choice.
    const text = shareInstructionsFor("inperson");
    expect(text).not.toContain("—");
    expect(text).toContain("microphone. There is no tab");
  });

  it("leaves the system branch's em dash alone — it joins a clause to a NOTE", () => {
    // Deliberately NOT the same treatment. Nothing in that sentence's meaning
    // depends on the pause; changing it here would be a content edit smuggled
    // into an extraction.
    expect(shareInstructionsFor("system")).toContain("—");
  });
});

describe("the extraction is ADOPTED, not merely added (AC-X1b, prohibition 7)", () => {
  // Pinning the three strings proves the new module is correct. It does NOT
  // prove anything was extracted: an implementer can add this module, leave
  // the `shareInstructions` ternary sitting at `CopilotClient.js:464-480`, and
  // be green — at which point A-7/A-8's whole stated purpose (relieving a file
  // at 948 of a hard, executable 950) is unmet, the wave-3 feature edits have
  // no headroom to land in, and the tree carries two copies of three
  // user-facing strings that will drift.
  //
  // This is dead code detected the only way a new module's own suite can
  // detect it: by reading its intended caller.

  it("CopilotClient.js imports and calls it WITH THE CAPTURE SOURCE", () => {
    expect(CLIENT_SOURCE).toMatch(
      /import\s*\{[^}]*\bshareInstructionsFor\b[^}]*\}\s*from\s*["']@\/lib\/copilot\/captureNotices(?:\.js)?["']/,
    );
    expect(CLIENT_SOURCE).toMatch(/\bshareInstructionsFor\s*\(/);

    // PRESENCE IS NOT BEHAVIOUR. `shareInstructionsFor("tab")` satisfies the
    // import, satisfies the call, and removes the literals — and the in-person
    // and system branches never render again. AC-M1.5.3 then regresses
    // silently: an in-person session, which has no share dialog at all, is
    // told to share a meeting tab that does not exist.
    expect(CLIENT_SOURCE).toMatch(/\bshareInstructionsFor\s*\(\s*source\s*\)/);
    expect(CLIENT_SOURCE).not.toMatch(/\bshareInstructionsFor\s*\(\s*["'`]/);
  });

  it("CopilotClient.js no longer carries the literals themselves", () => {
    // The half that makes it an extraction rather than a duplication. Verified
    // repo-wide before this file was written: these three strings appear in
    // exactly one file today, and nothing — no test, no other component —
    // references the identifier or any of them.
    expect(CLIENT_SOURCE).not.toContain("There is no tab or screen to share");
    expect(CLIENT_SOURCE).not.toContain("Share your Entire Screen");
    expect(CLIENT_SOURCE).not.toContain("Share the meeting tab");
  });
});
