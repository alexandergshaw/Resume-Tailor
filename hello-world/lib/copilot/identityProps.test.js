// node (this repo's default environment). `lib/copilot/identityProps.js` is a
// LINE-BUDGET EXTRACTION out of `app/copilot/CopilotClient.js`, not a feature
// change — the same reason `captureNotices.js` exists (see that module's own
// test header): this file sits against a hard, executable 950-line ceiling
// (`CopilotClient.extraction.test.js`) and wave 3's own feature edits need
// room to land.
//
// Written BEFORE the implementation exists: every case fails on the missing
// `./identityProps.js` module until the extraction lands.
//
// Behaviour-preserving: `identityPropsFor` is the exact ternary that used to
// sit inline at `CopilotClient.js`'s `identityProps` declaration, moved
// verbatim (comments included) — nothing here changes what is returned for
// any input.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { identityPropsFor } from "./identityProps.js";

const CLIENT_SOURCE = readFileSync(
  fileURLToPath(new URL("../../app/copilot/CopilotClient.js", import.meta.url)),
  "utf8",
);

const speakerLabelFor = () => "Interviewer";
const onAssignUser = () => {};

describe("identityPropsFor — gated on source, AC-M1.5.6", () => {
  it("returns an empty object for a non-in-person source (BUG-2's compatibility gate)", () => {
    expect(identityPropsFor({ source: "tab", speakerLabelFor, identityUnsettled: true, live: true, speakerSnapshot: { tags: [] }, onAssignUser })).toEqual({});
    expect(identityPropsFor({ source: "system", speakerLabelFor, identityUnsettled: true, live: true, speakerSnapshot: { tags: [] }, onAssignUser })).toEqual({});
  });

  it("hands back speakerLabelFor and onAssignUser UNCHANGED for the in-person source", () => {
    const props = identityPropsFor({
      source: "inperson",
      speakerLabelFor,
      identityUnsettled: false,
      live: false,
      speakerSnapshot: { tags: [] },
      onAssignUser,
    });
    expect(props.speakerLabelFor).toBe(speakerLabelFor);
    expect(props.onAssignUser).toBe(onAssignUser);
  });
});

describe("identityUnsettled's extra gate (BUG-5)", () => {
  it("claims unsettled only while live, even if the caller says unsettled", () => {
    const props = identityPropsFor({
      source: "inperson",
      speakerLabelFor,
      identityUnsettled: true,
      live: true,
      speakerSnapshot: { tags: [] },
      onAssignUser,
    });
    expect(props.identityUnsettled).toBe(true);
  });

  it("also claims unsettled once at least one voice has been observed, even when not live", () => {
    const props = identityPropsFor({
      source: "inperson",
      speakerLabelFor,
      identityUnsettled: true,
      live: false,
      speakerSnapshot: { tags: ["a"] },
      onAssignUser,
    });
    expect(props.identityUnsettled).toBe(true);
  });

  it("never claims unsettled once idle with nothing observed — the bug this gate fixes", () => {
    const props = identityPropsFor({
      source: "inperson",
      speakerLabelFor,
      identityUnsettled: true,
      live: false,
      speakerSnapshot: { tags: [] },
      onAssignUser,
    });
    expect(props.identityUnsettled).toBe(false);
  });

  it("stays false when the caller itself never claimed unsettled", () => {
    const props = identityPropsFor({
      source: "inperson",
      speakerLabelFor,
      identityUnsettled: false,
      live: true,
      speakerSnapshot: { tags: [] },
      onAssignUser,
    });
    expect(props.identityUnsettled).toBe(false);
  });
});

describe("the extraction is ADOPTED, not merely added (prohibition 7)", () => {
  it("CopilotClient.js imports and calls it", () => {
    expect(CLIENT_SOURCE).toMatch(
      /import\s*\{[^}]*\bidentityPropsFor\b[^}]*\}\s*from\s*["']@\/lib\/copilot\/identityProps(?:\.js)?["']/,
    );
    expect(CLIENT_SOURCE).toMatch(/\bidentityPropsFor\s*\(/);
  });

  it("CopilotClient.js no longer carries the inline ternary itself", () => {
    expect(CLIENT_SOURCE).not.toMatch(/identityUnsettled:\s*identityUnsettled\s*&&/);
  });
});
