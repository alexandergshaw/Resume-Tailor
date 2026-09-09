// node (this repo's default environment) — a SOURCE-TEXT test, deliberately,
// for the reason CopilotClient.extraction.test.js's own header already gives:
// the property under test IS the shape of the source — which module owns the
// session control row, and whether the caller still carries a copy of it.
//
// app/copilot/SessionControls.js is a LINE-BUDGET EXTRACTION out of
// app/copilot/CopilotClient.js, not a feature change — the same kind of move
// lib/copilot/captureNotices.js, lib/copilot/identityProps.js and
// app/copilot/useTypeAnnouncements.js each record in their own test headers.
// CopilotClient.js sat at EXACTLY 950 against the hard, executable 950-line
// ceiling at CopilotClient.extraction.test.js:48-50 — zero headroom, and no
// room for the next feature to mount anything at all. Moving the Start/Stop
// control row out took it to 873.
//
// The two failure modes this file exists to catch are the two
// CopilotClient.extraction.test.js's header names, restated for this move:
//
//   1. An "extraction" that adds a correct new module and never wires it up —
//      or, worse, wires it up and leaves the old JSX behind as well. A
//      DUPLICATED control row is invisible to every behaviour test that
//      already covers this row: CopilotClient.downloadLog.test.js finds its
//      button with `[...querySelectorAll("button")].find(…)`, which takes the
//      first of two happily, and practice/PracticeControls.test.js:133 pins a
//      count precisely because that has happened before. The `not.toMatch`
//      bans below close it from the source side instead, by naming things the
//      old row cannot exist without.
//
//   2. Hitting a line target by deleting comments instead of moving code.
//      Hence the floor on the new module's own CODE lines, counted the way
//      CopilotClient.extraction.test.js counts them (F11: a raw line count is
//      the one metric comments inflate, so it is useless as a floor).

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const read = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");

// Byte-for-byte the helper CopilotClient.extraction.test.js:31-35 uses, so
// "not a stub" means the same thing on both sides of this move.
const codeLines = (src) =>
  src
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("//") && !l.startsWith("*") && !l.startsWith("/*")).length;

// The lesson askAiPreSession.test.js:362-374 already paid for once: prose that
// NAMES a thing is not a call site, and a guard that cannot tell the two apart
// rejects correct code — which is a guard a future implementer deletes. Every
// claim in this file is about what the source DOES, and both modules carry
// comments naming the very controls under test (this move's own module doc
// says "useState", and the caller's mount comment says "Download session
// log"), so all of it reads the source with comments removed. Block comments
// — which is what `{/* … */}` is — and whole-line `//` comments only; a
// mid-line `//` strip would truncate any line holding a URL.
const stripComments = (src) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");

const CLIENT = read("./CopilotClient.js");
const CONTROLS = read("./SessionControls.js");
const CLIENT_CODE = stripComments(CLIENT);
const CONTROLS_CODE = stripComments(CONTROLS);

describe("the session control row moved to SessionControls.js", () => {
  it("[control] stripping comments leaves real code behind, in both files", () => {
    // Without this every ban below is satisfiable by a stripper that returned
    // "" — the vacuity failure this suite's other source tests each pin in
    // their own way.
    expect(CLIENT_CODE).toMatch(/export default function CopilotClient\(\)/);
    expect(CONTROLS_CODE).toMatch(/export default function SessionControls\(/);
    // ...and that it really did remove the two comment occurrences the bans
    // below would otherwise trip on, rather than being an identity function.
    // These are not hypothetical: both were RED before the stripper existed.
    expect(CONTROLS).toMatch(/\buseState\b/); // present, in this module's doc
    expect(CONTROLS_CODE).not.toMatch(/\buseState\b/); // ...and only there
    expect(CLIENT).toMatch(/Download session log/); // present, in the mount's comment
    expect(CLIENT_CODE).not.toMatch(/Download session log/); // ...and only there
  });

  it("exists and is not a stub", () => {
    // 118 today. A token extraction that moved four lines out would pass a
    // bare "the file exists" check; this is what stops that.
    expect(codeLines(CONTROLS)).toBeGreaterThan(80);
  });

  it("owns every control that used to sit in the row", () => {
    expect(CONTROLS_CODE).toMatch(/<StatusPill status=\{status\}/);
    expect(CONTROLS_CODE).toMatch(/\{fmtClock\(elapsed\)\}/);
    expect(CONTROLS_CODE).toMatch(/Start session/);
    expect(CONTROLS_CODE).toMatch(/Auto-draft/);
    expect(CONTROLS_CODE).toMatch(/Download session log/);
    // D6: the disabled reason is a VISIBLE caption pointed at by
    // aria-describedby, never an aria-label on the disabled button — the
    // whole property CopilotClient.downloadLog.test.js renders to check.
    expect(CONTROLS_CODE).toMatch(
      /aria-describedby=\{sessionLogHasEvents \? undefined : "live-download-log-reason"\}/,
    );
    expect(CONTROLS_CODE).toMatch(/id="live-download-log-reason"/);
  });

  it("holds no state of its own, which is what makes the move order-preserving", () => {
    // The load-bearing claim of a React extraction: hook call order is
    // positional, so an extraction that carried a useState or a useEffect
    // across this boundary would be a behaviour change rather than a
    // relocation. This component has none — every value it renders is a prop.
    // If a later feature genuinely needs local state here, AMEND this with the
    // reason rather than deleting it; the guard is cheap and the property it
    // names is the one that made this move safe.
    expect(CONTROLS_CODE).not.toMatch(/\buseState\b/);
    expect(CONTROLS_CODE).not.toMatch(/\buseEffect\b/);
    expect(CONTROLS_CODE).not.toMatch(/\buseRef\b/);
    expect(CONTROLS_CODE).not.toMatch(/\buseCallback\b/);
  });

  it("is imported AND rendered by CopilotClient, which no longer holds the row itself", () => {
    expect(CLIENT_CODE).toMatch(/import SessionControls from "\.\/SessionControls"/);
    expect(CLIENT_CODE).toMatch(/<SessionControls/);
    // The bans. Each names something the old row could not exist without and
    // that nothing else in CopilotClient.js legitimately needs, so a leftover
    // copy — or a second one — turns this red.
    expect(CLIENT_CODE).not.toMatch(/<StatusPill/);
    expect(CLIENT_CODE).not.toMatch(/fmtClock\(/);
    expect(CLIENT_CODE).not.toMatch(/Download session log/);
    expect(CLIENT_CODE).not.toMatch(/live-download-log-reason/);
  });
});

describe("the extraction is WIRED, not merely mounted", () => {
  // S9's lesson, restated: `toMatch(/SessionControls/)` is satisfied by the
  // import line alone, and `<SessionControls />` with no props renders a row
  // of dead controls that still looks right in a screenshot. Each assertion
  // below names a prop whose loss is SILENT — the row still renders, it just
  // stops doing its job.
  const mountIdx = CLIENT_CODE.indexOf("<SessionControls");
  const mount = CLIENT_CODE.slice(mountIdx, CLIENT_CODE.indexOf("/>", mountIdx));

  it("hands over the real handlers, not placeholders", () => {
    expect(mount).toMatch(/stop=\{stop\}/);
    // BUG-3: onStartSession, never the bare `start` — see its own comment in
    // CopilotClient.js for why the speaker bar's announcement must not survive
    // into a new session. `start={start}` would render an identical button.
    expect(mount).toMatch(/onStartSession=\{onStartSession\}/);
    expect(mount).not.toMatch(/\bstart=\{start\}/);
    expect(mount).toMatch(/copyTranscript=\{copyTranscript\}/);
    expect(mount).toMatch(/clearAll=\{clearAll\}/);
    expect(mount).toMatch(/downloadLog=\{downloadLog\}/);
  });

  it("hands over the real disabled-state inputs, not literals", () => {
    // `sessionLogHasEvents={true}` type-checks, renders, and silently deletes
    // D6's caption from the screen for every session that recorded nothing;
    // `finals={[]}` disables Copy and Clear forever. Both are exactly the
    // `postingGroundingNotice=""` mutant that CopilotClient.extraction
    // .test.js:126-133 was written to catch, in a different costume.
    expect(mount).toMatch(/sessionLogHasEvents=\{sessionLogHasEvents\}/);
    expect(mount).not.toMatch(/sessionLogHasEvents=\{(?:true|false)\}/);
    expect(mount).toMatch(/finals=\{finals\}/);
    expect(mount).toMatch(/questions=\{questions\}/);
    expect(mount).toMatch(/autoDraft=\{autoDraft\}/);
    expect(mount).toMatch(/setAutoDraft=\{setAutoDraft\}/);
    expect(mount).toMatch(/live=\{live\}/);
    expect(mount).toMatch(/status=\{status\}/);
    expect(mount).toMatch(/startedAt=\{startedAt\}/);
    expect(mount).toMatch(/elapsed=\{elapsed\}/);
  });

  it("[control] the mount slice really is the mount, not the whole file", () => {
    // Without this the two runs above degrade to whole-file substring checks,
    // which every one of them would pass with the props scattered anywhere.
    expect(mount.startsWith("<SessionControls")).toBe(true);
    expect(mount.length).toBeLessThan(600);
    expect(mount).not.toMatch(/<SessionSetup/);
  });
});

describe("nothing was lost on the way out", () => {
  // The union of the caller and the new module must still carry the sentences
  // whose loss would cost the next reader a re-derivation of a real defect —
  // the same discipline CopilotClient.extraction.test.js:146-169 applies to
  // its own three extractions.
  const union = [CLIENT, CONTROLS].join("\n");

  const mustSurvive = [
    // Why the Start button calls a wrapper rather than useLiveSession's `start`.
    "onStartSession, not the bare `start`",
    // Why the disabled reason is a visible caption and not an aria-label.
    "out of the tab order",
    // Why the control is named the same thing in both modes.
    "named the same feature two different things",
  ];

  for (const fragment of mustSurvive) {
    it(`still explains: ${fragment}`, () => {
      expect(union).toContain(fragment);
    });
  }
});
