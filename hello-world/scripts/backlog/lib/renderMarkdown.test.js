import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { renderMarkdown, GENERATED_HEADER } from "./renderMarkdown.mjs";
import { parseBacklogYaml } from "./yamlLite.mjs";
import { normalizeLineEndings } from "./normalizeLineEndings.mjs";
import { BACKLOG_YML_PATH, BACKLOG_MD_PATH } from "./loadBacklog.mjs";
import { compareIds } from "./idOrder.mjs";

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
