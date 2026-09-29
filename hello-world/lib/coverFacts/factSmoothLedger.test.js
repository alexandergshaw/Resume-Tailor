import { describe, it, expect } from "vitest";
import { existsSync } from "node:fs";
import path from "node:path";
// Namespace import (the decisionCoverage.sweep idiom): a named import of an
// export that may not exist can hard-error the whole module under strict ESM and
// take the green controls down with it. A namespace member is `undefined` when
// absent, so every red here is a clean assertion failure.
import * as channels from "../activityLog/activityChannels.js";

// N92 Wave 3 (Control B) -- the `fact-smooth` decision-ledger ENTRY (AC-X1,
// design N92 section 5, plan W3-S5). Control B records from its OWN module
// (lib/coverFacts/smoothTransition.js), which is what makes AC-B8a's own-module
// structure ALSO give smoothing its own natural ledger entry -- the module set
// stays unique, so the existing decisionCoverage.sweep.test.js stays green in
// both directions once the entry and its recordDecision( call land together.
//
// THIS FILE pins the ENTRY SHAPE (module/id/text-free fields/negative outcome).
// The bidirectional ledger<->call-site binding is already enforced by
// decisionCoverage.sweep.test.js; this file does not duplicate it. The per-outcome
// recording behaviour (acted/refused/failed/skipped) is proven against the real
// functions in smoothTransition.confirmPersist.rc.test.js.
//
// RED ON HEAD: no `fact-smooth` entry exists in DECISION_LEDGER, and its module
// file does not exist yet.

const ROOT = process.cwd();
const EXPECTED_MODULE = "lib/coverFacts/smoothTransition.js";

// Field names that would mean the downloaded, shared log carries letter/company/
// url/fact TEXT rather than enums (N77). A fact-smooth field must never be one of
// these -- the whole point of the closed vocabulary.
const TEXT_CARRYING_FIELDS = ["text", "fact", "factText", "before", "after", "url", "title", "company", "lines", "letter", "smoothed", "candidate", "prompt", "output"];

function factSmoothEntry() {
  const ledger = Array.isArray(channels.DECISION_LEDGER) ? channels.DECISION_LEDGER : [];
  return ledger.find((e) => e && e.id === "fact-smooth");
}

describe("[control] the ledger vocabulary is loaded and non-trivial", () => {
  it("DECISION_OUTCOMES exists and includes a negative (so a text-free-fields check is meaningful)", () => {
    expect(Array.isArray(channels.DECISION_OUTCOMES)).toBe(true);
    expect(channels.DECISION_OUTCOMES).toContain("acted");
    expect(channels.DECISION_OUTCOMES.some((o) => o !== "acted")).toBe(true);
  });
});

describe("the fact-smooth decision entry (AC-X1) -- RED at HEAD", () => {
  it("exists and records from its OWN module lib/coverFacts/smoothTransition.js (AC-B8a)", () => {
    const entry = factSmoothEntry();
    expect(entry, "no `fact-smooth` entry in DECISION_LEDGER -- Control B declares no decision reporter").toBeTruthy();
    expect(entry.module, "fact-smooth does not record from its own smoothing module").toBe(EXPECTED_MODULE);
    expect(existsSync(path.join(ROOT, EXPECTED_MODULE)), `${EXPECTED_MODULE} does not exist`).toBe(true);
    expect(typeof entry.label, "fact-smooth has no human label for the downloaded log").toBe("string");
  });

  it("declares a closed, TEXT-FREE field vocabulary (N77 -- the log is downloaded and shared)", () => {
    const entry = factSmoothEntry();
    expect(entry, "fact-smooth entry missing").toBeTruthy();
    expect(Array.isArray(entry.fields) && entry.fields.length > 0, "fact-smooth declares no field vocabulary").toBe(true);
    for (const f of entry.fields) {
      expect(typeof f).toBe("string");
      expect(
        TEXT_CARRYING_FIELDS,
        `fact-smooth declares a field '${f}' that would carry letter/fact text into a shared log`,
      ).not.toContain(f);
    }
  });

  it("can report a refusal AND a failure, not only success (the owner's hole)", () => {
    const entry = factSmoothEntry();
    expect(entry, "fact-smooth entry missing").toBeTruthy();
    const outcomes = Array.isArray(entry.outcomes) ? entry.outcomes : [];
    // confirmed+applied = acted; declined / auto-reject = refused; engine error = failed; embedded = skipped.
    expect(outcomes, "fact-smooth cannot report a user decline / auto-reject").toContain("refused");
    expect(outcomes, "fact-smooth cannot report an engine failure").toContain("failed");
    expect(outcomes, "fact-smooth cannot report success").toContain("acted");
    for (const o of outcomes) {
      expect(channels.DECISION_OUTCOMES, `fact-smooth declares an outcome '${o}' outside the closed vocabulary`).toContain(o);
    }
  });
});
