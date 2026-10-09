// node (this repo's default environment) — a SOURCE-TEXT test, deliberately,
// for the reason SessionControls.extraction.test.js and
// CopilotClient.extraction.test.js both give: the property under test IS the
// shape of the source — which module owns the voice-cue / company-brief rail,
// and whether the caller still carries a copy of it.
//
// N144b S0 is a LINE-BUDGET EXTRACTION, not a feature: CopilotClient.js is at
// 945 of its hard 950-line ceiling, so `railContent` and `onCueActivate` move
// into app/copilot/LiveRail.js to buy headroom BEFORE any feature edit lands
// (plan §5.3, ledger L1/L2). Behaviour-preserving: CopilotClient keeps
// `railCollapsed` and both placement sites and still renders <LiveRail/>.
//
// RED on HEAD: LiveRail.js does not exist (so the "exists / not a stub" floor
// is 0), and CopilotClient.js still holds the <CompanyBriefPanel/
// <VoiceCueSidebar ternary inline (so the "no longer contains" bans and the
// "imports and renders <LiveRail" checks are red). The reads are made SAFE
// (ENOENT -> "") so each assertion reports its own red rather than the whole
// file erroring at collection — a clearer hand-off.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

function readOrEmpty(rel) {
  try {
    return readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");
  } catch {
    return "";
  }
}

// Byte-for-byte the helper the sibling extraction tests use, so "not a stub"
// means the same thing here.
const codeLines = (src) =>
  src
    .split("\n")
    .map((l) => l.trim())
    .filter((l) => l && !l.startsWith("//") && !l.startsWith("*") && !l.startsWith("/*")).length;

// Block comments and whole-line `//` comments only (a mid-line strip would
// truncate a line holding a URL) — the shared discipline of the other sweeps.
const stripComments = (src) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^[ \t]*\/\/.*$/gm, "");

const CLIENT = readOrEmpty("./CopilotClient.js");
const RAIL = readOrEmpty("./LiveRail.js");
const CLIENT_CODE = stripComments(CLIENT);
const RAIL_CODE = stripComments(RAIL);

describe("LiveRail.js exists and is a real extraction, not a stub", () => {
  it("[canary] CopilotClient.js is present and readable", () => {
    expect(CLIENT_CODE).toMatch(/export default function CopilotClient\(\)/);
  });

  it("exists and carries the moved rail logic (code-line floor, RED on HEAD)", () => {
    // The ternary plus the VoiceCueSidebar prop block is well over 25 code
    // lines; a token stub that re-exports nothing would fail this.
    expect(codeLines(RAIL)).toBeGreaterThan(20);
    expect(RAIL_CODE).toMatch(/export default function LiveRail/);
  });

  it("renders the company-brief / voice-cue ternary that moved out of the caller", () => {
    expect(RAIL_CODE).toMatch(/<CompanyBriefPanel/);
    expect(RAIL_CODE).toMatch(/<VoiceCueSidebar/);
    // "company" is the only action VOICE_CUES still recognises — the cue
    // handler moved here with the ternary.
    expect(RAIL_CODE).toMatch(/companyBrief\.openBrief\(\)/);
  });
});

describe("CopilotClient imports and renders LiveRail, and no longer holds the rail itself", () => {
  it("imports LiveRail and mounts <LiveRail (RED on HEAD)", () => {
    expect(CLIENT_CODE).toMatch(/import LiveRail from "\.\/LiveRail"/);
    expect(CLIENT_CODE).toMatch(/<LiveRail/);
  });

  it("no longer contains the rail's own JSX or its imports (RED on HEAD)", () => {
    expect(CLIENT_CODE).not.toMatch(/<CompanyBriefPanel/);
    expect(CLIENT_CODE).not.toMatch(/<VoiceCueSidebar/);
    expect(CLIENT_CODE).not.toMatch(/import CompanyBriefPanel from/);
    expect(CLIENT_CODE).not.toMatch(/import VoiceCueSidebar from/);
  });

  it("keeps railCollapsed and both placement sites in the caller (behaviour preserved)", () => {
    // S0 is behaviour-preserving: the render-phase auto-collapse and both
    // mount points (md+ rail Box and the isRailBelowMd Box) stay in CopilotClient.
    expect(CLIENT_CODE).toMatch(/railCollapsed/);
    // Tolerates the parenthesized multi-line JSX form `= (\n  <LiveRail` as
    // well as the one-line form — both keep railContent as the caller's own
    // LiveRail mount, which is the property under test.
    expect(CLIENT_CODE).toMatch(/const railContent =\s*\(?\s*<LiveRail/);
  });
});

describe("the LiveRail mount is WIRED with real values, not literals", () => {
  // S9's lesson: `<LiveRail/>` with hard-coded props renders a rail that looks
  // right and ignores the session. Each prop below is one whose loss is SILENT.
  const idx = CLIENT_CODE.indexOf("<LiveRail");
  const mount = idx === -1 ? "" : CLIENT_CODE.slice(idx, CLIENT_CODE.indexOf("/>", idx));

  it("passes collapsed from railCollapsed, not a literal", () => {
    expect(mount).toMatch(/collapsed=\{railCollapsed\}/);
    expect(mount).not.toMatch(/collapsed=\{(?:true|false)\}/);
  });

  it("passes the live attribution and snapshot through", () => {
    expect(mount).toMatch(/speakerSnapshot=\{speakerSnapshot\}/);
    expect(mount).toMatch(/speakerAttribution=\{speakerAttribution\}/);
    expect(mount).toMatch(/companyBrief=\{companyBrief\}/);
  });
});

describe("nothing load-bearing was lost on the way out", () => {
  // The union of the caller and the new module must still carry the two
  // fragments whose loss would cost the next reader a re-derivation — the same
  // discipline the sibling extraction tests apply. (GUARD: green on HEAD, since
  // the fragments live in CopilotClient today; it must stay green after S0.)
  const union = [CLIENT, RAIL].join("\n");
  for (const fragment of ["I11:", "AC-V2.8:"]) {
    it(`still explains: ${fragment}`, () => {
      expect(union).toContain(fragment);
    });
  }
});
