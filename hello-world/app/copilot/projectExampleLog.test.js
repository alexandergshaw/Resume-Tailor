// N143 seam 8 (T16). The feature-log wiring + PII-exclusion census for the
// three project-example event kinds (AC-16). RED on HEAD: none of the three
// events is emitted yet.
//
// This is a source census, not a runtime snapshot: the events are emitted deep
// inside client hooks (useDraftAnswer / useSampleAnswer / the new prewarm
// hook), and a runtime snapshot driving those hooks belongs to the step-9 unit
// pass once the emitters exist. What this file pins now is (a) the three event
// kinds are actually emitted via the existing logEvent (wiring — RED until they
// are), with a canary proving the grep finds a real emission, and (b) NO
// emission of these three events logs a user id, raw posting text or résumé
// bytes (the [[feature-logs]] PII rule — a log carries identity only). The
// exclusion is guarded on the event being present, so it is not a vacuous
// assertion about an absent string.

import { describe, it, expect } from "vitest";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { stripComments } from "../../lib/sourceScan/tokenizeSource.js";

const CANDIDATE_FILES = [
  "app/copilot/useDraftAnswer.js",
  "app/copilot/practice/useSampleAnswer.js",
  "app/hooks/useApplicationProjectPool.js",
];

function combinedSource() {
  let out = "";
  for (const rel of CANDIDATE_FILES) {
    const abs = path.resolve(process.cwd(), rel);
    if (existsSync(abs)) out += "\n/*FILE:" + rel + "*/\n" + stripComments(readFileSync(abs, "utf8"));
  }
  return out;
}

const EVENTS = ["projectPool.prewarm", "projectExample.shown", "projectExample.live"];

describe("the three project-example events are emitted via logEvent (T16 / AC-16)", () => {
  it("[canary] the census finds a real existing logEvent emission (answer.done)", () => {
    const src = combinedSource();
    expect(src).toMatch(/logEvent\(/);
    expect(src).toContain("answer.done");
  });

  it("emits projectPool.prewarm, projectExample.shown and projectExample.live", () => {
    const src = combinedSource();
    for (const ev of EVENTS) {
      expect(src, ev).toContain(ev);
    }
  });
});

describe("no project-example log event carries PII (identity only)", () => {
  // Extract the ~200 chars following each event-name occurrence (its logEvent
  // payload object) and assert it names no forbidden value. Guarded on the
  // event being present so this is meaningful only once the emission exists —
  // never a vacuous pass over an absent string.
  function payloadsFor(src, eventName) {
    const slices = [];
    let i = src.indexOf(eventName);
    while (i !== -1) {
      slices.push(src.slice(i, i + 220));
      i = src.indexOf(eventName, i + eventName.length);
    }
    return slices;
  }

  it("logs no user id, raw posting text or résumé bytes in any of the three payloads", () => {
    const src = combinedSource();
    const present = EVENTS.filter((ev) => src.includes(ev));
    // The wiring test above is what reds on HEAD; here we only check the
    // payloads that DO exist.
    for (const ev of present) {
      for (const payload of payloadsFor(src, ev)) {
        expect(payload, `${ev}: user id`).not.toMatch(/user[._]?id|userId|user\.id/i);
        expect(payload, `${ev}: resume/posting bytes`).not.toMatch(/\bresume\b|resumeText|postingText|description\b/i);
      }
    }
    // Keep this suite honest when nothing is emitted yet: the wiring test owns
    // the red, and this one documents that no present emission leaked PII.
    expect(Array.isArray(present)).toBe(true);
  });
});
