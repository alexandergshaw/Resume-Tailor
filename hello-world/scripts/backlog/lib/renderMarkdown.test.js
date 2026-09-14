import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { renderMarkdown, GENERATED_HEADER } from "./renderMarkdown.mjs";
import { parseBacklogYaml } from "./yamlLite.mjs";
import { normalizeLineEndings } from "./normalizeLineEndings.mjs";
import { BACKLOG_YML_PATH, BACKLOG_MD_PATH } from "./loadBacklog.mjs";

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

  it("renders each table row from live item fields — changing a title in memory changes the output row", () => {
    const items = parseBacklogYaml(readFileSync(BACKLOG_YML_PATH, "utf8"));
    const mutated = items.map((it) => (it.id === "N1" ? { ...it, title: "CHANGED TITLE MARKER" } : it));
    const md = renderMarkdown(mutated);
    expect(md).toContain("CHANGED TITLE MARKER");
    // "SEC-1" also appears in the static prose block's worked example, so assert against N1's
    // own original title text specifically rather than that shared substring.
    expect(md).not.toContain("the engine-override fix, repo-wide");
  });
});
