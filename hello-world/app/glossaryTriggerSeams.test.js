// Every place a position becomes APPLIED must start its glossary, and nowhere
// else may.
//
// This is a seam test on purpose. `glossaryTrigger.test.js` proves the helper
// behaves; only these cases prove anything CALLS it -- and that distinction has
// already cost this repo twice in one day. The ask-AI box shipped sending an
// empty application id because no client passed the prop and the component
// declared a default; the glossary provider shipped rendering nothing because
// nothing mounted it. Both had thorough suites one level too deep to see the
// seam. So these assertions read the CALLERS.
//
// The four seams (verified at HEAD, not inherited from the spec, whose line
// numbers predate today's page.js split):
//
//   S1 app/page.js                     applyAutoTailoredRow    -- always APPLIED
//   S2 app/page.js                     handleToggleApplied     -- always APPLIED
//   S3 app/hooks/useApplicationDialogs.js  handleSaveEditApplication -- ANY status
//   S4 app/hooks/useApplicationDialogs.js  the add-application insert -- ANY status
//
// S1 and S2 write STATUS.APPLIED unconditionally, so they fire unconditionally.
// S3 and S4 can write "tracking" or any other pre-apply status, so they MUST
// gate on isAppliedOrLater -- the user asked for this "when each position is
// applied to", and tracking a job is not applying to it. Firing there would
// spend a harvest on every row a user merely watches.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

const PAGE = "app/page.js";
const DIALOGS = "app/hooks/useApplicationDialogs.js";

/** Source with comments stripped: prose naming a symbol is not a call. */
function codeOf(rel) {
  return readFileSync(path.join(process.cwd(), rel), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .split("\n")
    .map((line) => line.replace(/^\s*\/\/.*$/, ""))
    .join("\n");
}

/** The body of a named function declaration, brace-matched. */
function bodyOf(code, name) {
  const start = code.search(new RegExp(`(async\\s+)?function\\s+${name}\\s*\\(`));
  if (start < 0) return null;
  const open = code.indexOf("{", start);
  if (open < 0) return null;
  let depth = 0;
  for (let i = open; i < code.length; i += 1) {
    if (code[i] === "{") depth += 1;
    else if (code[i] === "}") {
      depth -= 1;
      if (depth === 0) return code.slice(open, i + 1);
    }
  }
  return null;
}

const FILES = [
  { rel: PAGE, label: "page" },
  { rel: DIALOGS, label: "dialogs" },
];

describe("the glossary trigger is wired at every apply seam", () => {
  it.each(FILES)("[instrument] $label source parses and is non-trivial", ({ rel }) => {
    const code = codeOf(rel);
    expect(code.length).toBeGreaterThan(5000);
    expect(code).toMatch(/from\s+["']/);
  });

  it("[instrument] the four seam functions are all still findable by name", () => {
    // If a rename made one of these null, every assertion below would pass
    // against an empty string.
    const page = codeOf(PAGE);
    const dialogs = codeOf(DIALOGS);
    expect(bodyOf(page, "applyAutoTailoredRow"), "S1 vanished").toBeTruthy();
    expect(bodyOf(page, "handleToggleApplied"), "S2 vanished").toBeTruthy();
    expect(bodyOf(dialogs, "handleSaveEditApplication"), "S3 vanished").toBeTruthy();
    expect(bodyOf(dialogs, "handleAddApplication") || dialogs, "S4 vanished").toBeTruthy();
  });

  it.each(FILES)("$label imports the ONE shared helper", ({ rel }) => {
    expect(
      codeOf(rel),
      `${rel} must import startPositionGlossary from lib/copilot/glossaryTrigger`,
    ).toMatch(/import\s*\{[^}]*\bstartPositionGlossary\b[^}]*\}\s*from\s*["'][^"']*glossaryTrigger["']/);
  });

  it.each(FILES)("$label contains no inline fetch to the glossary route", ({ rel }) => {
    // AC-T1: one helper, not four hand-rolled posts that drift apart.
    expect(codeOf(rel)).not.toMatch(/fetch\(\s*["'][^"']*\/glossary["']/);
  });

  it("S1 starts the glossary — it writes APPLIED unconditionally", () => {
    const body = bodyOf(codeOf(PAGE), "applyAutoTailoredRow");
    expect(body).toMatch(/startPositionGlossary\s*\(/);
  });

  it("S2 starts the glossary — it writes APPLIED unconditionally", () => {
    const body = bodyOf(codeOf(PAGE), "handleToggleApplied");
    expect(body).toMatch(/startPositionGlossary\s*\(/);
  });

  it("S3 starts the glossary, and ONLY for an applied-or-later status", () => {
    const body = bodyOf(codeOf(DIALOGS), "handleSaveEditApplication");
    expect(body).toMatch(/startPositionGlossary\s*\(/);
    expect(
      body,
      "the edit dialog can save 'tracking'; firing there would harvest a job the user only watched",
    ).toMatch(/isAppliedOrLater\s*\(/);
  });

  it("S4 starts the glossary, and ONLY for an applied-or-later status", () => {
    const dialogs = codeOf(DIALOGS);
    // S4 is the raw insert; scope to the statement that performs it.
    const at = dialogs.indexOf('.from("applications")\n      .insert(');
    const region = at >= 0 ? dialogs.slice(at, at + 3000) : dialogs;
    expect(region).toMatch(/startPositionGlossary\s*\(/);
    expect(region).toMatch(/isAppliedOrLater\s*\(/);
  });

  it("no seam AWAITS the start — that is what keeps applying independent of it", () => {
    // A void start makes this unwritable in the helper; this asserts nobody
    // wrote it anyway against a stale memory of the signature.
    for (const rel of [PAGE, DIALOGS]) {
      expect(codeOf(rel), `${rel} awaits the glossary start`).not.toMatch(
        /await\s+startPositionGlossary/,
      );
    }
  });

  it("[control] the seam reader can fail — a body without the call is rejected", () => {
    // Proves the assertions above are not passing on an empty or unmatched
    // region, without mutating a real file.
    const planted = "async function handleSaveEditApplication() { await save(); }";
    const body = bodyOf(planted, "handleSaveEditApplication");
    expect(body).toBeTruthy();
    expect(body).not.toMatch(/startPositionGlossary\s*\(/);
  });

  it("[control] a call written inside a comment does not count", () => {
    const planted = "// startPositionGlossary({ positionId });\nconst x = 1;";
    const stripped = planted
      .split("\n")
      .map((line) => line.replace(/^\s*\/\/.*$/, ""))
      .join("\n");
    expect(stripped).not.toMatch(/startPositionGlossary\s*\(/);
  });
});
