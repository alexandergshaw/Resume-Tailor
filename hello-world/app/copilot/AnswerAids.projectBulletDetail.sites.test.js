// N154 — the two-surface mount census + the feature-log PII census (plan R4,
// unit 12). RED on HEAD: neither CopilotClient nor PracticeClient mounts a
// ProjectBulletDetailScope, and no projectExample.bulletDetail event is emitted.
//
// WHY A CENSUS, not a full CopilotClient render. The runtime reachability of the
// control is proven by AnswerAids.projectBulletDetail.warmOnMount.test.js (a REAL
// scope wrapping a REAL AnswerAids yields an interactive control). This file
// establishes the other half of the chain — that BOTH surfaces actually mount
// the scope — the same split the landed AnswerAids.projectExampleSites.test.js
// uses for the module-internal dashboard mounts. A scope mounted on one surface
// but not the other is a SILENT absence: the feature works in dev on whichever
// surface was wired, and is simply gone on the other.
//
// Source is comment-stripped so a rule ABOUT the scope is never read as a mount
// of it, and every sweep carries a canary against a known-present string.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { stripComments } from "../../lib/sourceScan/tokenizeSource.js";

const SURFACES = [
  { file: "app/copilot/CopilotClient.js", name: "live" },
  { file: "app/copilot/practice/PracticeClient.js", name: "practice" },
];

function src(file) {
  return stripComments(readFileSync(path.resolve(process.cwd(), file), "utf8"));
}

// The chars following a marker, for a region-scoped substring check (the
// projectExampleLog.test.js payloadsFor pattern). Kept short so the window stays
// around the logEvent payload rather than reaching into unrelated nearby code.
function windowsAfter(code, marker, span = 180) {
  const out = [];
  let i = code.indexOf(marker);
  while (i !== -1) {
    out.push(code.slice(i, i + span));
    i = code.indexOf(marker, i + marker.length);
  }
  return out;
}

describe("both surfaces mount ProjectBulletDetailScope (R4)", () => {
  it("[canary] both surfaces already mount the sibling TechTermDetailScope (the sweep works)", () => {
    for (const s of SURFACES) expect(src(s.file), s.file).toContain("TechTermDetailScope");
  });

  it.each(SURFACES)("the $name surface mounts a ProjectBulletDetailScope with questions and request", ({ file }) => {
    const code = src(file);
    expect(code, file).toContain("ProjectBulletDetailScope");
    // The mount wires its question list and grounding, like the sibling scope.
    const regions = windowsAfter(code, "ProjectBulletDetailScope");
    expect(regions.some((r) => /questions\s*=/.test(r)), `${file}: scope passes questions`).toBe(true);
    expect(regions.some((r) => /request\s*=/.test(r)), `${file}: scope passes request`).toBe(true);
  });
});

describe("the feature-log event projectExample.bulletDetail is emitted, carrying no content (unit 12)", () => {
  const EVENT = "projectExample.bulletDetail";

  it("[canary] an existing logEvent emission is present on at least one surface", () => {
    const combined = SURFACES.map((s) => src(s.file)).join("\n");
    expect(combined).toMatch(/logEvent\(|logTechTermDetail|logEvent\b/);
  });

  it("the bulletDetail outcome is logged on a surface (wiring — RED until it is)", () => {
    const combined = SURFACES.map((s) => src(s.file)).join("\n");
    expect(combined).toContain(EVENT);
  });

  it("no bulletDetail log payload carries a user id, the bullet, the question, the detail, or resume/posting bytes", () => {
    // Guarded on the event being present, so this is meaningful only once the
    // emission exists — never a vacuous pass over an absent string.
    for (const s of SURFACES) {
      const code = src(s.file);
      if (!code.includes(EVENT)) continue;
      for (const payload of windowsAfter(code, EVENT)) {
        expect(payload, `${s.file}: user id`).not.toMatch(/user[._]?id|userId|user\.id/i);
        // Ban the CONTENT property reads (the leak), not the param name "detail":
        // logging `detail.status`/`detail.code` is fine; logging the bullet text,
        // the question, the title or the explanation value is not.
        expect(payload, `${s.file}: content property leak`).not.toMatch(/\.bullet\b|\.question\b|\.title\b|\.detail\b|\.text\b/i);
        expect(payload, `${s.file}: resume/posting bytes`).not.toMatch(/\bresume\b|resumeText|postingText/i);
      }
    }
  });
});
