// N102 AC-8 -- the as-me persona must not leak into any other surface.
//
// A scoped source census: each of the three new symbols may be referenced ONLY
// by the files that legitimately implement the chat toggle; any reference from
// another route/engine (tailor, copilot, salary, reviewer) is a leak and fails
// here. Comments are stripped with the SHARED stripComments
// (lib/sourceScan/tokenizeSource.js) before scanning -- a prose citation of a
// module must not be read as USING it (MEMORY: loop-traps-tests, "prose citing
// a module is read as using it").
//
// DISCLOSURE (standing rule 1): this is a GUARD. At HEAD none of the three
// symbols exist, so the leak sets are empty and every leak assertion passes
// vacuously. It becomes a real containment guard on the built diff. The CANARY
// below is the discriminating part -- it proves the census actually finds
// references and is not a dead search.
//
// CANARY NOTE: the N102 AC/design said "SYSTEM_PROMPT is referenced by route.js
// only". That is INACCURATE at this HEAD -- lib/copilot/askPrompt.js also
// references it. SYSTEM_PROMPT is used here purely as a liveness canary (a
// known-positive whose set must be non-empty and must include route.js); its
// exact membership is not an N102 property.

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { stripComments } from "../sourceScan/tokenizeSource.js";

const ROOT = process.cwd();
const SCAN_DIRS = ["app", "lib"];

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    if (entry === "node_modules" || entry.startsWith(".")) continue;
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (entry.endsWith(".js") && !entry.endsWith(".test.js")) out.push(full);
  }
  return out;
}

const FILES = SCAN_DIRS.flatMap((d) => walk(path.join(ROOT, d)));

// relPath -> comment-stripped source (strings/code preserved).
const SOURCES = new Map(
  FILES.map((file) => {
    const rel = path.relative(ROOT, file).split(path.sep).join("/");
    return [rel, stripComments(readFileSync(file, "utf8"))];
  }),
);

function filesMatching(re) {
  return [...SOURCES.entries()].filter(([, src]) => re.test(src)).map(([rel]) => rel).sort();
}

describe("AC-8: the as-me persona is referenced only by the chat path", () => {
  it("CANARY: the census is live -- SYSTEM_PROMPT is found, including in route.js", () => {
    // If this came back empty, the scanner is dead and every leak assertion
    // below would be meaninglessly green.
    const hits = filesMatching(/\bSYSTEM_PROMPT\b/);
    expect(hits.length).toBeGreaterThan(0);
    expect(hits).toContain("app/api/chat/route.js");
  });

  it("ANSWER_AS_ME_DIRECTIVE lives only in the chat route", () => {
    const allowed = ["app/api/chat/route.js"];
    const leaks = filesMatching(/\bANSWER_AS_ME_DIRECTIVE\b/).filter((f) => !allowed.includes(f));
    expect(leaks, `ANSWER_AS_ME_DIRECTIVE leaked into: ${leaks.join(", ")}`).toEqual([]);
  });

  it("the answerAsMe store is imported only by ChatPanel and the chat request shaper", () => {
    const allowed = ["app/components/ChatPanel.js", "lib/chat/chatbot.js"];
    const leaks = filesMatching(/["'][^"']*settings\/answerAsMe["']/).filter((f) => !allowed.includes(f));
    expect(leaks, `the answerAsMe store is imported by an unexpected file: ${leaks.join(", ")}`).toEqual([]);
  });

  it("the answerAsMe field/flag is referenced only by the store, the shaper, the route and the panel", () => {
    const allowed = [
      "app/settings/answerAsMe.js",
      "lib/chat/chatbot.js",
      "app/api/chat/route.js",
      "app/components/ChatPanel.js",
    ];
    const leaks = filesMatching(/\banswerAsMe\b/).filter((f) => !allowed.includes(f));
    expect(leaks, `the answerAsMe flag leaked into: ${leaks.join(", ")}`).toEqual([]);
  });

  it("the other LLM call sites are untouched by the as-me symbols", () => {
    // Explicit blast-radius enumeration: none of these may reference the field
    // or the directive. (Vacuous at HEAD; real on the diff.)
    const forbidden = /\banswerAsMe\b|\bANSWER_AS_ME_DIRECTIVE\b/;
    const others = [
      "lib/llm/tailorResume.js",
      "lib/chat/salaryEstimateRequest.js",
    ].filter((f) => SOURCES.has(f));
    for (const f of others) {
      expect(forbidden.test(SOURCES.get(f)), `${f} references an as-me symbol`).toBe(false);
    }
    // The copilot answer route + reviewer surfaces, by directory.
    const copilotOrReview = [...SOURCES.keys()].filter(
      (f) => f.startsWith("app/api/copilot/") || /review/i.test(f),
    );
    for (const f of copilotOrReview) {
      expect(forbidden.test(SOURCES.get(f)), `${f} references an as-me symbol`).toBe(false);
    }
  });
});
