import { describe, it, expect } from "vitest";

// N65 step 2 — the DECISION_LEDGER entry for the salary estimate (S10).
//
// decisionCoverage.sweep.test.js already binds the ledger to the tree's
// recordDecision call sites in BOTH directions, and requires >=1 non-`acted`
// outcome and a non-empty field list — so it will turn RED unless the ledger
// entry and the recordDecision call in salaryEstimateRequest.js land together.
// This file adds the ONE thing that sweep does not check: that the closed field
// vocabulary carries NO disclosure-bearing data. This log is downloaded and
// shared onward, so an estimated number, the company name, a citation URL or a
// citation title in `fields` is a privacy defect (activityChannels.js's N77
// precedent), and the sweep only checks the fields are non-empty strings.
//
// Imports the REAL registry (which exists at HEAD), so these are clean
// assertion-level reds: the `salary-estimate` entry does not exist yet.

import { DECISION_LEDGER, DECISION_OUTCOMES } from "@/lib/activityLog/activityChannels";

const entry = () => DECISION_LEDGER.find((e) => e && e.id === "salary-estimate");

describe("DECISION_LEDGER — the salary-estimate entry (S10)", () => {
  it("declares the entry, owned by the client orchestrator that records it", () => {
    const e = entry();
    expect(e, "no salary-estimate entry in DECISION_LEDGER").toBeTruthy();
    // The sweep matches this string BYTE-for-BYTE against the file that contains
    // the recordDecision( call, so it must be the orchestrator's path.
    expect(e.module).toBe("lib/chat/salaryEstimateRequest.js");
    expect(typeof e.label).toBe("string");
    expect(e.label.length).toBeGreaterThan(0);
  });

  it("can report a non-success outcome (the owner's hole stays closed)", () => {
    const e = entry();
    expect(e).toBeTruthy();
    expect(Array.isArray(e.outcomes)).toBe(true);
    expect(e.outcomes.some((o) => o !== "acted")).toBe(true);
    // Every declared outcome is from the closed vocabulary.
    for (const o of e.outcomes) expect(DECISION_OUTCOMES).toContain(o);
  });

  it("carries a closed, PII-free field vocabulary — no number, company, URL or title", () => {
    const e = entry();
    expect(e).toBeTruthy();
    expect(e.fields).toEqual(["reason", "citationCount", "basisKind"]);
    // Belt and braces: none of the disclosure-bearing names may appear, however
    // the list is later reordered or extended.
    for (const forbidden of ["company", "range", "min", "max", "url", "title", "citations", "estimate"]) {
      expect(e.fields).not.toContain(forbidden);
    }
  });
});
