import { describe, it, expect } from "vitest";
import { mkdtempSync, writeFileSync, rmSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { parseBacklogYaml } from "./yamlLite.mjs";
import { loadBacklogItems, BACKLOG_YML_PATH } from "./loadBacklog.mjs";
import { renderMarkdown } from "./renderMarkdown.mjs";

// N114 regression: the backlog renderer intermittently threw "yamlLite: unrecognized line N" on a
// file whose CONTENT was valid, and the error cleared after `tr -d '\r'` + `cp` with no content
// change. Root cause: this repo has core.autocrlf=true and docs/backlog.yml has no .gitattributes
// exemption, so any checkout/stash/rewrite that touches it smudges LF to CRLF. The parser split on
// "\n" only, leaving a trailing "\r" on every line, and its line regexes end in `(.*)$` where `.`
// refuses "\r" -- so every item and field line was "unrecognized". A leading BOM (U+FEFF) breaks
// the `^- id:` anchor the same way, and U+2028/U+2029 inside a quoted value break `.` likewise.
//
// What these tests pin is a PROPERTY, not a snapshot: parsing is invariant to line-ending and BOM
// artifacts. Every variant is compared against the parse of the clean LF text, and each test first
// asserts its input really carries the artifact so the comparison cannot pass vacuously.

const CLEAN_LINES = [
  '- id: "N1"',
  '  state: "actionable"',
  '  title: "résumé — done … → next, with a \\"quote\\" and a comma"',
  "  owed_by: null",
  '  evidence: ["ledger T3-C4b-6, T3-V6-6", "second"]',
  "  blocked_by: []",
  "",
  "# SECTION: owner decisions",
  '- id: "D2"',
  '  state: "owner"',
  '  title: "second item"',
  '  blocked_by: ["N1"]',
  "",
];
const CLEAN = CLEAN_LINES.join("\n");

const EXPECTED = [
  {
    id: "N1",
    state: "actionable",
    title: 'résumé — done … → next, with a "quote" and a comma',
    owed_by: null,
    evidence: ["ledger T3-C4b-6, T3-V6-6", "second"],
    blocked_by: [],
  },
  { id: "D2", state: "owner", title: "second item", blocked_by: ["N1"] },
];

const BOM = "﻿";

describe("parseBacklogYaml -- encoding and line-ending artifacts (N114)", () => {
  it("[control] the clean LF fixture parses to the expected items, so every variant below has a real baseline", () => {
    expect(parseBacklogYaml(CLEAN)).toEqual(EXPECTED);
  });

  it("parses CRLF-terminated input identically to the same content with LF endings", () => {
    const crlf = CLEAN.replace(/\n/g, "\r\n");
    expect(crlf).toContain("\r\n");
    expect(parseBacklogYaml(crlf)).toEqual(EXPECTED);
  });

  it("parses input with a leading BOM before the first item line identically to the clean text", () => {
    const withBom = BOM + CLEAN;
    expect(withBom.charCodeAt(0)).toBe(0xfeff);
    expect(withBom.slice(1, 3)).toBe("- ");
    expect(parseBacklogYaml(withBom)).toEqual(EXPECTED);
  });

  it("parses BOM + CRLF together identically to the clean text", () => {
    const both = BOM + CLEAN.replace(/\n/g, "\r\n");
    expect(both.charCodeAt(0)).toBe(0xfeff);
    expect(both).toContain("\r\n");
    expect(parseBacklogYaml(both)).toEqual(EXPECTED);
  });

  it("a BOM before a leading comment line was already tolerated and stays so", () => {
    const withBom = BOM + "# header comment\n" + CLEAN;
    expect(parseBacklogYaml(withBom)).toEqual(EXPECTED);
  });

  it("parses MIXED endings (a partly rewritten file: some lines CRLF, some LF) identically", () => {
    const mixed = CLEAN_LINES.map((line, i) => line + (i % 2 === 0 ? "\r\n" : "\n")).join("");
    expect(mixed).toContain("\r\n");
    expect(mixed).toContain("\n  ");
    expect(parseBacklogYaml(mixed)).toEqual(EXPECTED);
  });

  it("parses a final line that ends in a bare CR with no trailing LF (truncated CRLF write)", () => {
    const text = CLEAN.replace(/\n+$/, "").replace(/\n/g, "\r\n") + "\r";
    expect(text.endsWith("\r")).toBe(true);
    expect(text.endsWith("\n")).toBe(false);
    expect(parseBacklogYaml(text)).toEqual(EXPECTED);
  });

  it("parses doubled CR (\\r\\r\\n, left by a double CRLF conversion) identically", () => {
    const doubled = CLEAN.replace(/\n/g, "\r\r\n");
    expect(doubled).toContain("\r\r\n");
    expect(parseBacklogYaml(doubled)).toEqual(EXPECTED);
  });

  it("keeps U+2028 and U+2029 inside a quoted value verbatim -- `.` in a line regex refuses them", () => {
    const text = '- id: "N1"\n  title: "a b c"\n  evidence: ["x y", "z"]';
    const items = parseBacklogYaml(text);
    expect(items).toEqual([{ id: "N1", title: "a b c", evidence: ["x y", "z"] }]);
  });

  it("still throws on a genuinely unrecognized line under CRLF, and names the right 1-based line number", () => {
    const text = '- id: "N1"\r\ntitle without indentation or item marker\r\n';
    // Normalization must not weaken rejection: line 1 now parses, so the throw is about line 2,
    // and the reported line text carries no stray CR.
    expect(() => parseBacklogYaml(text)).toThrow(/unrecognized line 2: title without indentation or item marker$/);
  });

  it("still throws on a field line before any item under BOM + CRLF", () => {
    expect(() => parseBacklogYaml(BOM + '  title: "orphan"\r\n')).toThrow(/field line before any/);
  });
});

describe("real docs/backlog.yml -- encoding invariance at the load and render boundary (N114)", () => {
  // Rebuilt from LF so the baseline is the same whatever line endings this checkout smudged the
  // working copy to (the very autocrlf behaviour that caused the flake).
  const lf = readFileSync(BACKLOG_YML_PATH, "utf8").replace(/\r\n/g, "\n");
  const baseline = parseBacklogYaml(lf);

  it("the real file parses to a non-empty list from clean LF text (control)", () => {
    expect(lf).not.toContain("\r");
    expect(baseline.length).toBeGreaterThan(0);
  });

  it("parses to the same items when every line ending is CRLF, with or without a BOM", () => {
    const crlf = lf.replace(/\n/g, "\r\n");
    expect(crlf).toContain("\r\n");
    expect(parseBacklogYaml(crlf)).toEqual(baseline);
    expect(parseBacklogYaml(BOM + crlf)).toEqual(baseline);
  });

  it("renders a byte-identical BACKLOG.md from a CRLF + BOM copy of the real file", () => {
    const fresh = renderMarkdown(baseline);
    const fromCrlf = renderMarkdown(parseBacklogYaml(BOM + lf.replace(/\n/g, "\r\n")));
    expect(fromCrlf).toBe(fresh);
  });

  it("loadBacklogItems (the render.mjs entry) reads a CRLF + BOM file from disk and returns the same items", () => {
    const dir = mkdtempSync(join(tmpdir(), "backlog-n114-"));
    try {
      const path = join(dir, "backlog.yml");
      writeFileSync(path, BOM + lf.replace(/\n/g, "\r\n"), "utf8");
      // Node's utf8 decode keeps a BOM as U+FEFF, so this exercises the real read boundary.
      expect(readFileSync(path, "utf8").charCodeAt(0)).toBe(0xfeff);
      expect(loadBacklogItems(path)).toEqual(baseline);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
