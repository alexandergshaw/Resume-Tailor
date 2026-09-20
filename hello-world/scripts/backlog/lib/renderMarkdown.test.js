import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { renderMarkdown, GENERATED_HEADER } from "./renderMarkdown.mjs";
import { parseBacklogYaml } from "./yamlLite.mjs";
import { normalizeLineEndings } from "./normalizeLineEndings.mjs";
import { BACKLOG_YML_PATH, BACKLOG_MD_PATH } from "./loadBacklog.mjs";
import { compareIds } from "./idOrder.mjs";

function item(overrides) {
  return {
    id: "N1",
    state: "actionable",
    title: "t",
    owed_by: "o",
    evidence: ["e"],
    blocked_reason: null,
    instrument: null,
    owns: null,
    verify: null,
    verify_proof: null,
    blocked_by: [],
    ...overrides,
  };
}

describe("renderMarkdown", () => {
  it("reproduces the committed docs/BACKLOG.md BYTE FOR BYTE from a fresh parse of docs/backlog.yml", () => {
    const items = parseBacklogYaml(readFileSync(BACKLOG_YML_PATH, "utf8"));
    const fresh = normalizeLineEndings(renderMarkdown(items));
    const committed = normalizeLineEndings(readFileSync(BACKLOG_MD_PATH, "utf8"));
    expect(fresh).toBe(committed);
  });

  it("starts with the generated-header marker, so a hand-edit is visibly wrong at a glance", () => {
    const items = parseBacklogYaml(readFileSync(BACKLOG_YML_PATH, "utf8"));
    const md = renderMarkdown(items);
    expect(md.startsWith(GENERATED_HEADER)).toBe(true);
  });

  it("CRLF no-op control: a byte-identical file except for CRLF line endings still matches after normalization", () => {
    // Fixes the gap named in review: a drift check whose only control is a planted MISMATCH never
    // exercises the normalizer itself. This constructs the case the normalizer exists for and
    // asserts it is a NO-OP on real content, not just that mismatches are caught.
    const items = parseBacklogYaml(readFileSync(BACKLOG_YML_PATH, "utf8"));
    const fresh = renderMarkdown(items);
    const crlfVariant = fresh.replace(/\n/g, "\r\n");
    expect(normalizeLineEndings(fresh)).toBe(normalizeLineEndings(crlfVariant));
  });

  it("a genuinely different committed file is NOT reported equal after normalization (the check can still fail)", () => {
    const items = parseBacklogYaml(readFileSync(BACKLOG_YML_PATH, "utf8"));
    const fresh = normalizeLineEndings(renderMarkdown(items));
    const driftedFixture = fresh.replace("# Backlog", "# Backlog (hand-edited)");
    expect(fresh).not.toBe(normalizeLineEndings(driftedFixture));
  });

  it("renders each table row from live item fields — changing a title in memory changes that item's output row", () => {
    const items = parseBacklogYaml(readFileSync(BACKLOG_YML_PATH, "utf8"));
    // Select the item to mutate by property (lowest-id actionable item), not by a hard-coded id, so
    // this test does not re-couple to which items currently exist in docs/backlog.yml.
    const target = items
      .filter((it) => it.state === "actionable")
      .sort((a, b) => compareIds(a.id, b.id))[0];
    expect(target).toBeDefined();

    const rowPrefix = `| ${target.id} |`;
    const originalLines = renderMarkdown(items).split("\n");
    const originalRow = originalLines.find((line) => line.startsWith(rowPrefix));
    expect(originalRow).toBeDefined();

    const mutated = items.map((it) => (it.id === target.id ? { ...it, title: "CHANGED TITLE MARKER" } : it));
    const mutatedLines = renderMarkdown(mutated).split("\n");
    const mutatedRow = mutatedLines.find((line) => line.startsWith(rowPrefix));

    expect(mutatedRow).toContain("CHANGED TITLE MARKER");
    expect(mutatedRow).not.toBe(originalRow);
    // Only the mutated item's row changed; every other line of the document is untouched.
    expect(mutatedLines.length).toBe(originalLines.length);
    mutatedLines.forEach((line, i) => {
      if (line === mutatedRow) return;
      expect(line).toBe(originalLines[i]);
    });
  });

  it("joins every entry of a multi-entry evidence array into the row, not just the first (a renderer that drops content is a defective instrument)", () => {
    const items = parseBacklogYaml(readFileSync(BACKLOG_YML_PATH, "utf8"));
    const target = items
      .filter((it) => it.state === "actionable")
      .sort((a, b) => compareIds(a.id, b.id))[0];
    const withMultiEvidence = items.map((it) =>
      it.id === target.id ? { ...it, evidence: ["FIRST ENTRY MARKER", "SECOND ENTRY MARKER", "THIRD ENTRY MARKER"] } : it,
    );

    const md = renderMarkdown(withMultiEvidence);
    const row = md.split("\n").find((line) => line.startsWith(`| ${target.id} |`));

    expect(row).toBeDefined();
    // [mutant this kills: `it.evidence[0]` reinstated in nextRow] every entry
    // must reach the rendered row, not only the first.
    expect(row).toContain("FIRST ENTRY MARKER");
    expect(row).toContain("SECOND ENTRY MARKER");
    expect(row).toContain("THIRD ENTRY MARKER");
  });

  it("SITE renderMarkdown.mjs:28 -- the 'Next' table lists actionable rows in FILE order, not by numeric id", () => {
    // Non-monotonic fixture: N30 first in the array, N2 second -- the reverse of numeric order, so
    // "sorts by id" and "preserves file order" produce different, named row orders.
    const items = [
      item({ id: "N30", title: "T30 MARKER" }),
      item({ id: "N2", title: "T2 MARKER" }),
    ];
    const md = renderMarkdown(items);
    const idxN30 = md.indexOf("| N30 |");
    const idxN2 = md.indexOf("| N2 |");
    expect(idxN30).toBeGreaterThanOrEqual(0);
    expect(idxN2).toBeGreaterThanOrEqual(0);
    // Resists vacuity: reinstating the sort at renderMarkdown.mjs:28 puts the N2 row first.
    expect(idxN30).toBeLessThan(idxN2);
  });

  it("SITE renderMarkdown.mjs:29 -- the 'Owner decisions' table lists rows in FILE order, not by numeric/age id", () => {
    const items = [
      item({ id: "D5", state: "owner", title: "Q5 MARKER", blocked_reason: "w5" }),
      item({ id: "D2", state: "owner", title: "Q2 MARKER", blocked_reason: "w2" }),
    ];
    const md = renderMarkdown(items);
    const idxD5 = md.indexOf("| D5 |");
    const idxD2 = md.indexOf("| D2 |");
    expect(idxD5).toBeGreaterThanOrEqual(0);
    expect(idxD2).toBeGreaterThanOrEqual(0);
    // Resists vacuity: reinstating the sort at renderMarkdown.mjs:29 puts the D2 row first (R-BL-1
    // ruled this section is hand-ordered too, not age-ordered).
    expect(idxD5).toBeLessThan(idxD2);
  });

  it("SITE renderMarkdown.mjs:30 -- the 'Verification owed' table lists rows in FILE order, not by numeric/age id", () => {
    // This is one of the two call sites a prior round's single-site mutant left uncaught (all
    // landed tests green) -- named explicitly in backlog N31.
    const items = [
      item({ id: "V5", state: "verification", title: "R5 MARKER", instrument: "i5" }),
      item({ id: "V2", state: "verification", title: "R2 MARKER", instrument: "i2" }),
    ];
    const md = renderMarkdown(items);
    const idxV5 = md.indexOf("| V5 |");
    const idxV2 = md.indexOf("| V2 |");
    expect(idxV5).toBeGreaterThanOrEqual(0);
    expect(idxV2).toBeGreaterThanOrEqual(0);
    // Resists vacuity: reinstating the sort at renderMarkdown.mjs:30 puts the V2 row first.
    expect(idxV5).toBeLessThan(idxV2);
  });

  it("regression: renders the real docs/backlog.yml's 'Next' table in the file's own hand-set order, not by id", () => {
    const items = parseBacklogYaml(readFileSync(BACKLOG_YML_PATH, "utf8"));
    const actionableFileOrder = items.filter((it) => it.state === "actionable").map((it) => it.id);

    // Loud precondition (see the equivalent guard in pick.test.js): this check only has power
    // while the real file's actionable order is not already ascending by id.
    expect(
      actionableFileOrder,
      "the real docs/backlog.yml's actionable ids are currently ascending -- this regression check has lost its power and must be re-armed",
    ).not.toEqual([...actionableFileOrder].sort(compareIds));

    const md = renderMarkdown(items);
    const renderedOrder = [...md.matchAll(/^\| (N\d+) \|/gm)].map((m) => m[1]);
    expect(renderedOrder).toEqual(actionableFileOrder);
  });

  it("regression: rendering still succeeds after an item is removed from an in-memory copy of the real backlog.yml (the coupling the hard-coded 'N1' id used to create)", () => {
    const items = parseBacklogYaml(readFileSync(BACKLOG_YML_PATH, "utf8"));
    const target = items
      .filter((it) => it.state === "actionable")
      .sort((a, b) => compareIds(a.id, b.id))[0];
    const shrunk = items.filter((it) => it.id !== target.id);

    const md = renderMarkdown(shrunk);

    expect(md.startsWith(GENERATED_HEADER)).toBe(true);
    expect(md).not.toContain(`| ${target.id} |`);
  });
});
