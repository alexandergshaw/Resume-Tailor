// "A DECISION THAT ENDED IN NOTHING", AS AN ENFORCED PROPERTY.
//
// ---------------------------------------------------------------------------
// THE GAP THIS SWEEP EXISTS TO CLOSE
// ---------------------------------------------------------------------------
// The owner's top-priority feature silently did nothing, and the downloaded
// activity log could not say why. activityChannels.js states the root cause in
// its own words: the `act` channel "depends on feature code calling
// recordActivity(), so a feature that never calls it contributes nothing here,
// and this file cannot tell you that it happened."
//
// The three automatic channels (net, err, nav) capture EFFECTS. What failed for
// the owner was a DECISION -- the app choosing not to act -- and a decision that
// stops before its first network call produces nothing in any automatic channel.
// So the one class of event that most needs explaining has no automatic capture
// AND, before this sweep, no enforcement that a feature opts in.
//
// activityCoverage.sweep.test.js guards the registry's SHAPE and that the
// document PRINTS it. It does NOT require any feature to actually call the
// recorder. This file adds the missing teeth.
//
// ---------------------------------------------------------------------------
// THE REGISTRY DESIGN, AND WHY IT IS HARD TO BYPASS SILENTLY
// ---------------------------------------------------------------------------
// HAND-MAINTAINED LIST cross-checked against a DERIVED scan -- exactly the
// FEATURE_LOG_LEDGER idiom (asserted `toEqual` in both directions against a tree
// walk), for the same reason: a pure hand list goes stale, a pure derived scan
// cannot carry human judgement (a label, the reason a refusal matters). So:
//
//   * DECISION_LEDGER (activityChannels.js) is the hand list. Each entry names
//     the production `module` that owns a user-visible decision, the `id` it
//     records under, the closed `fields` its records may carry, and the
//     `outcomes` it can end in -- which MUST include a negative one.
//
//   * The DERIVED reality is every production module that actually calls
//     `recordDecision(` -- the single, greppable seam a decision record goes
//     through. The recorder's own modules (lib/activityLog/) are excluded: they
//     DEFINE recordDecision, they do not make decisions.
//
//   * `toEqual` in both directions binds them. A feature that is LISTED but
//     records nothing fails (the owner's exact bug). A feature that RECORDS but
//     is unlisted fails (a half-wired orphan). Neither can ship green.
//
// What this canNOT do, stated plainly rather than implied away: no static scan
// can force a brand-new decision feature whose author never instruments it AND
// never lists it to appear here -- "makes a user-visible decision" is a semantic
// property. The forcing function is the recording seam: the day someone wires
// `recordDecision(` into a new feature, the reverse direction turns red until
// they declare it, at which point the refusal property below binds them too. The
// residual hole -- a feature nobody instruments and nobody lists -- is closed on
// the human side by the document (see the "[document]" describe): the file names
// its decision reporters, so a reader can tell "this feature was silent this
// session" from "this feature never reports at all", which is precisely the
// distinction the owner could not draw.
//
// ---------------------------------------------------------------------------
// KEEPING THIS OFF THE LOAD-ARTIFACT LIST (backlog N58/N77)
// ---------------------------------------------------------------------------
// tokenizeSource.test.js and coverBytePaths.census.test.js time out at the
// default 5000ms. This sweep walks the tree exactly ONCE at module load (one
// shared TREE, the activityCoverage idiom) and, before spending the tokenizer on
// any file, pre-filters on a cheap raw `.includes("recordDecision")` -- at HEAD
// that is zero files, so no masking runs at all. The tree-walking `it`s carry an
// explicit 20s budget so a slow CI box cannot make this the third load artifact.

import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { tokenizeSource } from "../sourceScan/tokenizeSource.js";
// Namespace import on purpose: at HEAD none of these decision exports exist yet,
// and a NAMED import of a missing export can hard-error the whole module at load
// under strict ESM -- which would take the GREEN scanner canaries below down with
// the RED definition tests. A namespace member is simply `undefined` when absent,
// so collection always succeeds and every red is a clean assertion failure.
import * as channels from "./activityChannels.js";
import { renderActivityLog } from "./activityLogDocument.js";
import { createActivityLog } from "./appActivityLog.js";

const ROOT = process.cwd();
const rel = (full) => path.relative(ROOT, full).split(path.sep).join("/");

function walk(dir, out = []) {
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (entry.endsWith(".js")) out.push(full);
  }
  return out;
}

/** Every production .js under app/ and lib/, read once. */
function readTree() {
  const files = new Map();
  for (const dir of ["app", "lib"]) {
    for (const full of walk(path.join(ROOT, dir))) {
      const r = rel(full);
      if (r.endsWith(".test.js")) continue;
      files.set(r, readFileSync(full, "utf8"));
    }
  }
  return files;
}
const TREE = readTree();

// ---------------------------------------------------------------------------
// THE DERIVED CENSUS: every production module that records a decision.
//
// The seam is `recordDecision(` -- one named call, so the census is reliable and
// a decision record cannot be smuggled through some other channel and still
// count. Only real code counts: a call written in a comment, a string or a
// template literal is not a call site (the tokenizer's job). The recorder's own
// package DEFINES recordDecision; it is not a feature that makes decisions, so it
// is excluded, exactly as activityCoverage excludes lib/activityLog/ from the
// feature-log census.
// ---------------------------------------------------------------------------
const DECISION_CALL_RE = /\brecordDecision\s*\(/;

function decisionCallSites(files) {
  const found = new Set();
  for (const [file, src] of files) {
    if (typeof src !== "string") continue;
    if (file.startsWith("lib/activityLog/")) continue; // defines the seam
    if (!src.includes("recordDecision")) continue; // cheap pre-filter: no tokenize
    let code;
    try {
      code = tokenizeSource(src).codeMask;
    } catch {
      // A file the shared tokenizer refuses is a finding, not a skip: treat the
      // raw source as code so a real call site is never silently dropped.
      code = src;
    }
    if (DECISION_CALL_RE.test(code)) found.add(file);
  }
  return found;
}
const DECISION_SITES = decisionCallSites(TREE);

// ---------------------------------------------------------------------------
// PURE CHECKERS -- shared by the real (tree) assertions AND the planted canaries
// below, so the thing the canary proves discriminating is the SAME code that
// judges the real tree. (A canary that exercises a different code path than the
// gate is the "tested the easier mutant" trap this repo has hit repeatedly.)
// ---------------------------------------------------------------------------
const ledgerModules = (ledger) => (Array.isArray(ledger) ? ledger.map((e) => e && e.module) : []);

/** Modules the ledger DECLARES that do not actually record -- the owner's bug. */
function unrecordedModules(ledger, sites) {
  return ledgerModules(ledger)
    .filter((m) => !sites.has(m))
    .sort();
}
/** Modules that RECORD but the ledger never declared -- a half-wired orphan. */
function unlistedModules(ledger, sites) {
  const listed = new Set(ledgerModules(ledger));
  return [...sites].filter((m) => !listed.has(m)).sort();
}
/** An entry that can only ever report success is the exact hole the owner hit. */
function declaresRefusal(entry) {
  return (
    !!entry &&
    Array.isArray(entry.outcomes) &&
    entry.outcomes.some((o) => typeof o === "string" && o.length > 0 && o !== "acted")
  );
}

// ===========================================================================
// GREEN CONTROLS -- the instruments discriminate. These run and PASS at HEAD;
// they prove the checkers above bite before any of the red assertions rely on
// them. Without these, a broken scanner would make every "is it accounted for?"
// assertion pass by finding nothing to complain about.
// ===========================================================================
describe("[scanner] the recordDecision census discriminates", () => {
  it("reads a real, whole tree", { timeout: 20000 }, () => {
    // The non-vacuity floor. A census over a tree it failed to read is
    // indistinguishable from a clean codebase.
    expect(TREE.size).toBeGreaterThanOrEqual(400);
    expect(TREE.has("app/hooks/useDuplicateApplyCheck.js")).toBe(true);
    expect(TREE.has("lib/activityLog/activityChannels.js")).toBe(true);
  });

  it("finds a real recordDecision call, and returns the module it is in", () => {
    const synthetic = new Map([
      ["app/hooks/useThing.js", 'import { recordDecision } from "x";\nrecordDecision("thing", "refused", { reason: "r" });'],
      ["app/hooks/useQuiet.js", "export function useQuiet() { return 1; }"],
    ]);
    const sites = decisionCallSites(synthetic);
    expect(sites.has("app/hooks/useThing.js")).toBe(true);
    expect(sites.has("app/hooks/useQuiet.js")).toBe(false);
  });

  it("does NOT count a recordDecision written in a comment or a string", () => {
    // The masking canary. If the tokenizer regresses, a decision mentioned in
    // prose would be counted as a real site and the census would over-report.
    const synthetic = new Map([
      ["app/a.js", "// calls recordDecision( eventually, but not yet\nexport const a = 1;"],
      ["app/b.js", 'const doc = "see recordDecision( for how";\nexport const b = doc;'],
    ]);
    const sites = decisionCallSites(synthetic);
    expect(sites.has("app/a.js")).toBe(false);
    expect(sites.has("app/b.js")).toBe(false);
  });

  it("excludes the recorder's own package, which merely DEFINES the seam", () => {
    const synthetic = new Map([
      ["lib/activityLog/appActivityLog.js", "export function recordDecision(id, outcome, fields) {}"],
      ["app/hooks/useReal.js", 'recordDecision("real", "acted", {});'],
    ]);
    const sites = decisionCallSites(synthetic);
    expect(sites.has("lib/activityLog/appActivityLog.js")).toBe(false);
    expect(sites.has("app/hooks/useReal.js")).toBe(true);
  });

  it("the ledger checkers bite on a planted absence AND a planted orphan", () => {
    // ITEM 2, made concrete: a REGISTERED feature that records nothing must be
    // reported, not passed over. Plant exactly that and watch the checker catch
    // it -- this is the discrimination the whole red suite leans on.
    const plantedLedger = [
      { module: "app/hooks/useSilent.js", id: "silent", fields: ["reason"], outcomes: ["acted", "refused"] },
      { module: "app/hooks/useLoud.js", id: "loud", fields: ["reason"], outcomes: ["acted", "skipped"] },
    ];
    const sitesMissingOne = new Set(["app/hooks/useLoud.js", "app/hooks/useUndeclared.js"]);
    // useSilent is listed but never records -> reported by unrecordedModules.
    expect(unrecordedModules(plantedLedger, sitesMissingOne)).toEqual(["app/hooks/useSilent.js"]);
    // useUndeclared records but is not listed -> reported by unlistedModules.
    expect(unlistedModules(plantedLedger, sitesMissingOne)).toEqual(["app/hooks/useUndeclared.js"]);
    // And a fully-consistent pairing is clean, so the checkers do not over-fire.
    const consistent = new Set(["app/hooks/useSilent.js", "app/hooks/useLoud.js"]);
    expect(unrecordedModules(plantedLedger, consistent)).toEqual([]);
    expect(unlistedModules(plantedLedger, consistent)).toEqual([]);
  });

  it("the refusal property rejects a success-only feature and accepts a refusable one", () => {
    // Without this, a ledger in which every entry declared outcomes: ["acted"]
    // -- i.e. every feature records ONLY successes, the owner's hole -- would
    // sail through the property below.
    expect(declaresRefusal({ outcomes: ["acted"] })).toBe(false);
    expect(declaresRefusal({ outcomes: ["acted", "refused"] })).toBe(true);
    expect(declaresRefusal({ outcomes: [] })).toBe(false);
    expect(declaresRefusal({})).toBe(false);
  });
});

// ===========================================================================
// RED at HEAD -- the enforcement itself. Every assertion here depends on the
// DECISION_LEDGER / DECISION_OUTCOMES exports and on at least one feature routed
// through recordDecision(, none of which exist yet. They land the implementer's
// contract.
// ===========================================================================
describe("[THE DEFINITION] a decision registry with teeth", () => {
  it("exists, is a non-empty hand-maintained list of real decision features", () => {
    const ledger = channels.DECISION_LEDGER;
    expect(Array.isArray(ledger), "DECISION_LEDGER is not exported from activityChannels.js").toBe(true);
    expect(ledger.length, "the decision registry is empty -- it declares no feature at all").toBeGreaterThan(0);
    for (const entry of ledger) {
      expect(typeof entry.module, `${entry.id} names no production module`).toBe("string");
      expect(typeof entry.id, "a ledger entry has no id").toBe("string");
      expect(typeof entry.label, `${entry.id} has no human label`).toBe("string");
      expect(TREE.has(entry.module), `${entry.module} is on the decision ledger but does not exist`).toBe(true);
    }
  });

  it("matches the tree's recordDecision call sites EXACTLY, in both directions", { timeout: 20000 }, () => {
    const ledger = channels.DECISION_LEDGER;
    expect(Array.isArray(ledger)).toBe(true);
    // Non-vacuity: there must be at least one feature actually recording, or the
    // toEqual below is [] === [] and proves nothing.
    expect(DECISION_SITES.size, "no production module records a decision at all").toBeGreaterThan(0);
    expect(ledgerModules(ledger).sort(), "the decision ledger and the tree disagree").toEqual([...DECISION_SITES].sort());
  });

  it("fails when a REGISTERED feature records nothing (the owner's exact bug)", { timeout: 20000 }, () => {
    const ledger = channels.DECISION_LEDGER;
    expect(Array.isArray(ledger)).toBe(true);
    expect(ledger.length).toBeGreaterThan(0);
    expect(
      unrecordedModules(ledger, DECISION_SITES),
      "a feature is declared as making decisions but never calls recordDecision()",
    ).toEqual([]);
  });

  it("fails when a feature records a decision it never declared", { timeout: 20000 }, () => {
    const ledger = channels.DECISION_LEDGER;
    expect(Array.isArray(ledger)).toBe(true);
    expect(
      unlistedModules(ledger, DECISION_SITES),
      "a module calls recordDecision() but is missing from DECISION_LEDGER",
    ).toEqual([]);
  });
});

describe("[THE DEFINITION] a declared decision must be able to report a refusal", () => {
  it("defines a closed outcome vocabulary that includes at least one negative", () => {
    const outcomes = channels.DECISION_OUTCOMES;
    expect(Array.isArray(outcomes), "DECISION_OUTCOMES is not exported").toBe(true);
    expect(outcomes).toContain("acted"); // the one positive
    // "nothing happened, because X" must be expressible. A vocabulary of only
    // "acted" is the enforcement gap re-opened.
    expect(outcomes.some((o) => o !== "acted"), "no negative outcome exists in the vocabulary").toBe(true);
    expect(outcomes).toContain("refused");
  });

  it("requires every registered feature to declare a negative outcome, not only success", () => {
    const ledger = channels.DECISION_LEDGER;
    expect(Array.isArray(ledger)).toBe(true);
    expect(ledger.length).toBeGreaterThan(0);
    const outcomes = channels.DECISION_OUTCOMES || [];
    for (const entry of ledger) {
      expect(
        declaresRefusal(entry),
        `${entry.id} can only ever report success -- a feature that records only successes leaves exactly the owner's hole`,
      ).toBe(true);
      // Every declared outcome is from the closed vocabulary (no free text).
      for (const o of entry.outcomes) {
        expect(outcomes, `${entry.id} declares an outcome outside DECISION_OUTCOMES`).toContain(o);
      }
    }
  });

  it("declares a closed field vocabulary for every registered feature", () => {
    // The closed vocabulary is what lets the recorder drop content it was never
    // meant to carry (see decisionRedaction.test.js). An entry with no declared
    // fields could not carry a reason at all.
    const ledger = channels.DECISION_LEDGER;
    expect(Array.isArray(ledger)).toBe(true);
    expect(ledger.length).toBeGreaterThan(0);
    for (const entry of ledger) {
      expect(Array.isArray(entry.fields), `${entry.id} declares no field vocabulary`).toBe(true);
      expect(entry.fields.length, `${entry.id} has an empty field vocabulary`).toBeGreaterThan(0);
      for (const f of entry.fields) expect(typeof f, `${entry.id} has a non-string field name`).toBe("string");
    }
  });
});

describe("[THE DEFINITION][document] the downloaded file names its decision reporters", () => {
  // ITEM 4. A reader holding the .md must be able to tell "this feature was
  // silent this session" from "this feature never reports". The list of decision
  // reporters is what draws that line, so it must appear even in a session where
  // NOTHING was recorded -- the owner's own situation.
  const emptyMd = renderActivityLog(createActivityLog({ now: () => 1, startedAt: 1 }).snapshot());

  it("prints every registered decision feature, even with an empty session", () => {
    const ledger = channels.DECISION_LEDGER;
    expect(Array.isArray(ledger)).toBe(true);
    expect(ledger.length).toBeGreaterThan(0);
    for (const entry of ledger) {
      expect(emptyMd, `the file never names the "${entry.label}" decision reporter`).toContain(entry.label);
    }
  });

  it("gives the reader a decisions section, distinct from the feature-log list", () => {
    // A heading naming decisions, so the labels above read as "features that
    // report decisions" rather than being scattered anonymously in the file.
    expect(emptyMd, "the file has no heading that names decision reporting").toMatch(/^#+\s.*decision/im);
  });

  it("does not merely contain any label we hand it (the toContain control)", () => {
    // Proves the two assertions above measure a real print, not a substring that
    // happens to appear. A label that is not a decision reporter must be absent.
    expect(emptyMd).not.toContain("Nonexistent decision reporter QZX-000");
  });
});
