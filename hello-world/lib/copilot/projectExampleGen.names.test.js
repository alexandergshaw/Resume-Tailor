// N143 fix round F1, m6 + m7. Two small facts about lib/copilot/projectExampleGen.js
// that the landed suites do not pin.
//
// m6: the prompt names the posting's company on its role line ("Role: SRE at
// Acme") and, before this round, said nothing about NAMES, so a project could
// open "At Acme, a strong candidate..." -- an invented claim about a real
// employer, in a card the candidate reads as a benchmark. The fix is an
// instruction, which a unit test can pin the presence of but cannot prove the
// model obeys: whether it does is the owner probe's (docs/loop/N143.probe.md).
//
// m7: the guard's significance floor comment used to say a posting headcount is
// always at or above it. It is not ("Team of 45"), and N128 accepted that as a
// residual. The second block pins the behaviour the corrected comment describes,
// so the comment and the code cannot drift apart again.

import { describe, it, expect } from "vitest";
import { buildPoolPrompt, buildOnTheSpotPrompt, stripPostingFigures } from "./projectExampleGen.js";

const POSTING = { title: "SRE", company: "Acme", description: "Own the estate and the pager." };

describe("the system instruction forbids naming an employer, school or person (m6)", () => {
  const pool = buildPoolPrompt(POSTING);
  const spot = buildOnTheSpotPrompt(POSTING, "Tell me about an outage.");

  it("[positive control] the role line still carries the company, so the instruction has something to forbid", () => {
    expect(pool.user).toContain("Role: SRE at Acme");
    expect(spot.user).toContain("Role: SRE at Acme");
  });

  it("carries a no-names rule naming employer, school and person, in both prompts", () => {
    for (const { system } of [pool, spot]) {
      expect(system).toMatch(/No names\./);
      expect(system).toMatch(/named employer, school, hospital, client or person/);
      // The specific failure: the company from the role line.
      expect(system).toMatch(/not the company in the role line/);
      expect(system).toMatch(/generic to the role and its domain/);
    }
  });

  it("is a rule in the numbered list and leaves the JSON-only rule last", () => {
    const lines = pool.system.split("\n").filter((l) => /^\d+\. /.test(l));
    expect(lines.map((l) => l.split(".")[0])).toEqual(["1", "2", "3", "4", "5", "6"]);
    expect(lines[4]).toMatch(/^5\. No names\./);
    expect(lines[5]).toMatch(/^6\. Output strict JSON only/);
  });

  it("[no regression] the third-person, hypothetical and invented-figures rules are still present", () => {
    expect(pool.system).toMatch(/Third person and hypothetical/);
    expect(pool.system).toMatch(/Invented figures only/);
    expect(pool.system).toMatch(/No generic skeleton/);
    expect(pool.system).toBe(spot.system);
  });
});

describe("the figure guard's significance floor and headcounts (m7)", () => {
  const entry = (bullets) => ({ competency: "team leadership", domain: "engineering", title: "Scaled the on-call", bullets, hypothetical: true });

  it("[positive control] a posting headcount at or above the floor IS stripped", () => {
    const posting = { title: "SRE", description: "We run a team of 1,200 engineers." };
    const out = stripPostingFigures(entry(["Led a group of 1,200 engineers", "Cut pages from 9 to 2"]), posting);
    // The echoing bullet is gone and the entry is left with one, so it is dropped whole.
    expect(out).toBeNull();
    const kept = stripPostingFigures(entry(["Led a group of 1,200 engineers", "Cut pages from 9 to 2", "Halved the backlog"]), posting);
    expect(kept.bullets).toEqual(["Cut pages from 9 to 2", "Halved the backlog"]);
  });

  it("a small posting headcount is NOT stripped -- the accepted residual the comment now describes", () => {
    const posting = { title: "SRE", description: "Join a team of 45 on a growing platform." };
    const bullets = ["Led a team of 45 through a migration", "Cut pages from 9 to 2"];
    const out = stripPostingFigures(entry(bullets), posting);
    expect(out.bullets).toEqual(bullets);
  });
});
