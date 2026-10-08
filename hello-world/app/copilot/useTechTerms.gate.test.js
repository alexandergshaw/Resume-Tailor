// N150 Wave C — T-F3a, the SHARED Row-1 fire gate across the three producers
// (useDraftAnswer, practice/useSampleAnswer, practice/useRoomQuestions).
//
// WHAT THIS IS AND IS NOT. These are capped React hooks that the node suite
// cannot drive to a done-frame here, so this is a SOURCE-STRUCTURAL instrument,
// comment-stripped (the files' comments name every symbol it forbids/requires —
// a raw grep would read the documentation as code). It pins the design's F3
// decision: fireTechTerms is gated by the SAME extracted Row-1 core as
// fireProjectExampleLive (one named local, NOT two parallel inline checks), it
// probes its OWN fetch export (fetchTechTerms via techTermsFetchAvailable, NOT
// fetchProjectExampleLive — correction C2), and techTerms is cleared alongside
// the example rows on redraft/reuse.
//
// RED on HEAD: none of these symbols exist in the producers yet.
//
// LIMIT, stated: a source check cannot catch a gate that is PRESENT but subtly
// WRONG (e.g. an example check that always passes). It catches the two failure
// shapes the design names — a MISSING/parallel example gate, and a MISSING clear
// — and it cannot replace a behavioural test if one later becomes cheap. Its
// companion is T-F3b (the emission-equivalence guard), which has real teeth.

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { stripComments } from "../../lib/sourceScan/tokenizeSource.js";

function code(rel) {
  return stripComments(readFileSync(path.resolve(process.cwd(), rel), "utf8"), { label: rel });
}

describe("useDraftAnswer — one shared example gate, its own fetch probe (F3 / C2)", () => {
  const src = () => code("app/copilot/useDraftAnswer.js");

  it("extracts ONE named Row-1 core that BOTH fires call (not two parallel inline checks)", () => {
    const s = src();
    expect(s).toMatch(/\bconst exampleRowEnabled\b/);
    // Both fires reference the shared local, so they cannot drift apart.
    const calls = s.match(/exampleRowEnabled\s*\(/g) || [];
    expect(calls.length).toBeGreaterThanOrEqual(2);
    expect(s).toMatch(/\bfireTechTerms\b/);
    expect(s).toMatch(/\bfireProjectExampleLive\b/);
  });

  it("the shared core gates on the example AND the application (the authoritative Row-1 signal)", () => {
    const s = src();
    const decl = /const exampleRowEnabled\s*=\s*\([^)]*\)\s*=>([\s\S]*?);/.exec(s);
    expect(decl, "exampleRowEnabled must be an arrow with the gate in its body").not.toBeNull();
    const body = decl[1];
    expect(body).toMatch(/applicationId/);
    expect(body).toMatch(/example/);
  });

  it("fireTechTerms fires startTechTerms through fetchTechTerms, probed by its OWN availability check (C2)", () => {
    const s = src();
    expect(s).toMatch(/\btechTermsFetchAvailable\b/);
    expect(s).toMatch(/startTechTerms\s*\(/);
    // The fetchTerms the fire wires is fetchTechTerms, never fetchProjectExampleLive.
    expect(s).toMatch(/fetchTerms:[^,\n}]*fetchTechTerms/);
  });

  it("clears techTerms alongside projectExample/projectExampleLive on both the redraft and the cache-hit path", () => {
    const s = src();
    // The HEAD file clears the two example rows with `undefined` on exactly two
    // writes (the loading transition and the cache-hit clear); techTerms must
    // join them so a redraft/reuse never leaves a stale list on the new answer.
    const clears = s.match(/techTerms:\s*undefined/g) || [];
    expect(clears.length).toBeGreaterThanOrEqual(2);
  });
});

describe("practice/useSampleAnswer — fireTechTerms beside the Row-2 fire, techTerms exposed (C3)", () => {
  const src = () => code("app/copilot/practice/useSampleAnswer.js");

  it("adds the tech-terms fire, gated on the example, wired to fetchTechTerms", () => {
    const s = src();
    expect(s).toMatch(/\bfireTechTerms\b|startTechTerms\s*\(/);
    expect(s).toMatch(/\bfetchTechTerms\b/);
    expect(s).toMatch(/\bexample\b/);
  });

  it("exposes techTerms in its returned object so SampleAnswer/PracticeClient can pass it", () => {
    expect(src()).toMatch(/\btechTerms\b/);
  });
});

describe("practice/useRoomQuestions — fireTechTerms beside the room fire, cleared on invalidate (C4)", () => {
  const src = () => code("app/copilot/practice/useRoomQuestions.js");

  it("adds the tech-terms fire wired to fetchTechTerms", () => {
    const s = src();
    expect(s).toMatch(/startTechTerms\s*\(|\bfireTechTerms\b/);
    expect(s).toMatch(/\bfetchTechTerms\b/);
  });

  it("clears techTerms where it clears the example rows", () => {
    expect(src()).toMatch(/techTerms:\s*undefined/);
  });
});

describe("the detail context is mounted beside the expansion scope (D5/D6)", () => {
  // Without TechTermDetailScope mounted, the useTechTermDetails context is
  // missing and chips expand to nothing — a silent failure. RED on HEAD.
  it("CopilotClient mounts <TechTermDetailScope> (beside <ExpansionScope>)", () => {
    expect(code("app/copilot/CopilotClient.js")).toMatch(/<TechTermDetailScope\b/);
  });

  it("PracticeClient mounts <TechTermDetailScope> and threads techTerms through", () => {
    const s = code("app/copilot/practice/PracticeClient.js");
    expect(s).toMatch(/<TechTermDetailScope\b/);
    expect(s).toMatch(/\btechTerms\b/);
  });
});
