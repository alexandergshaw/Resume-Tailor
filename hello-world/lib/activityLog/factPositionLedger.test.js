// N92 Wave 1 (Control A) -- AC-X1 / plan W1-S5: Control A's move records its
// outcome via recordDecision under a NEW ledger entry `fact-position`, owned
// by app/hooks/useCompanyResearch.js (design §5, LOAD-BEARING: the module set
// must stay unique so decisionCoverage.sweep stays green in both directions).
// Wave 2's forward-nudge will record under this SAME entry -- no second entry
// (design §5/§6) -- but this file only pins the entry Wave 1 lands.
//
// N77 content-leak rule: the decision log is a DOWNLOADED artifact shared
// onward, so a record may carry counts/enums ONLY -- never a byte of the
// letter, the company, a url, or an article title.
//
// RED-on-HEAD: no `fact-position` entry exists in DECISION_LEDGER at HEAD, so
// recordDecision("fact-position", ...) fails closed to an EMPTY field
// whitelist -- the "declared field survives" assertions below go red until the
// entry lands. (The content-leak assertions pass vacuously at HEAD because
// fail-closed drops everything; they become load-bearing once the entry
// exists -- disclosed here, not counted as coverage on their own.)
//
// This file does NOT touch decisionCoverage.sweep.test.js (a landed
// instrument); it asserts the ledger ENTRY shape the sweep will then bind.

import { describe, it, expect } from "vitest";
import { DECISION_LEDGER } from "./activityChannels.js";
import { createActivityLog } from "./appActivityLog.js";

const FORBIDDEN_CONTENT_FIELDS = ["text", "company", "url", "title", "letter", "suggestion", "name", "paragraph"];

function factPositionEntry() {
  return DECISION_LEDGER.find((e) => e && e.id === "fact-position");
}

describe("the fact-position ledger entry (AC-X1)", () => {
  it("exists and is owned by the module that records the move", () => {
    const entry = factPositionEntry();
    expect(entry, "no fact-position entry in DECISION_LEDGER").toBeTruthy();
    expect(entry.module).toBe("app/hooks/useCompanyResearch.js");
    expect(typeof entry.label).toBe("string");
    expect(entry.label.length).toBeGreaterThan(0);
  });

  it("declares a closed, TEXT-FREE field vocabulary including the move direction", () => {
    const entry = factPositionEntry();
    expect(entry, "no fact-position entry in DECISION_LEDGER").toBeTruthy();
    expect(Array.isArray(entry.fields)).toBe(true);
    // direction is the discriminator a move must carry (forward/backward).
    expect(entry.fields).toContain("direction");
    // and NOTHING that could carry letter/company/url/title text (N77).
    for (const bad of FORBIDDEN_CONTENT_FIELDS) {
      expect(entry.fields, `fact-position must not declare a content field '${bad}'`).not.toContain(bad);
    }
  });

  it("declares a positive AND a negative outcome (a move that did nothing must be recordable)", () => {
    const entry = factPositionEntry();
    expect(entry, "no fact-position entry in DECISION_LEDGER").toBeTruthy();
    expect(entry.outcomes).toContain("acted");
    const negatives = ["skipped", "refused", "failed"];
    expect(negatives.some((o) => entry.outcomes.includes(o)), "no negative outcome declared").toBe(true);
  });
});

describe("recording a move through the REAL recorder (whitelist enforced by the recorder, not the caller)", () => {
  it("keeps the declared direction/reason and DROPS a smuggled letter/company field", () => {
    const log = createActivityLog({ now: () => 1, startedAt: 1 });
    // A caller trying to smuggle the letter text and the company through
    // undeclared fields must have them stripped by the closed whitelist.
    log.recordDecision("fact-position", "acted", {
      direction: "forward",
      reason: "moved",
      text: "Acme opened a Dublin lab.",
      company: "Acme",
    });
    const event = log.snapshot().events.find((e) => e.type === "fact-position.acted");
    // "acted" is a real outcome for this entry -> the type is not normalized to
    // ".unknown" (RED at HEAD: entry absent, so no acted event is meaningful).
    expect(event, "fact-position.acted was not recorded -- the entry is not declared").toBeTruthy();
    // Declared enum/count fields survive (RED at HEAD: fail-closed drops them).
    expect(event.direction).toBe("forward");
    expect(event.reason).toBe("moved");
    // Content leak guard: the smuggled fields never reach the downloaded log.
    expect(event).not.toHaveProperty("text");
    expect(event).not.toHaveProperty("company");
  });
});
