import { describe, it, expect } from "vitest";
import { parseBacklogYaml } from "./yamlLite.mjs";

describe("parseBacklogYaml", () => {
  it("parses a single item with every scalar kind: quoted string, null, empty array, populated array", () => {
    const text = [
      '- id: "N1"',
      '  state: "actionable"',
      '  title: "hello"',
      "  owed_by: null",
      '  evidence: ["a", "b"]',
      "  blocked_by: []",
    ].join("\n");
    const items = parseBacklogYaml(text);
    expect(items).toEqual([
      { id: "N1", state: "actionable", title: "hello", owed_by: null, evidence: ["a", "b"], blocked_by: [] },
    ]);
  });

  it("unescapes \\\" and \\\\ inside a quoted string — kills a mutant that drops the escape handling", () => {
    const text = '- id: "N1"\n  title: "a \\"quoted\\" word and a backslash \\\\ here"';
    const items = parseBacklogYaml(text);
    expect(items[0].title).toBe('a "quoted" word and a backslash \\ here');
  });

  it("preserves unicode (em dash, accented letters, ellipsis, arrows) verbatim", () => {
    const text = '- id: "N1"\n  title: "résumé — done … → next"';
    const items = parseBacklogYaml(text);
    expect(items[0].title).toBe("résumé — done … → next");
  });

  it("splits a flow array on top-level commas only, not on a comma inside a quoted element", () => {
    const text = '- id: "N1"\n  evidence: ["ledger T3-C4b-6, T3-V6-6", "second"]';
    const items = parseBacklogYaml(text);
    // Kills a mutant that splits the array by a naive `.split(",")` over the raw text: that
    // would produce THREE elements here instead of two, because the first element's own comma
    // would be mistaken for the array separator.
    expect(items[0].evidence).toEqual(["ledger T3-C4b-6, T3-V6-6", "second"]);
  });

  it("skips blank lines and comment lines anywhere, including between items", () => {
    const text = ['# a comment', '', '- id: "N1"', '  title: "x"', '', '# another', '- id: "N2"', '  title: "y"'].join(
      "\n"
    );
    const items = parseBacklogYaml(text);
    expect(items.map((it) => it.id)).toEqual(["N1", "N2"]);
  });

  it("throws on a field line before any item has started — never silently drops it", () => {
    const text = '  title: "orphan"';
    expect(() => parseBacklogYaml(text)).toThrow(/field line before any/);
  });

  it("throws on an unrecognized line rather than silently ignoring it", () => {
    const text = '- id: "N1"\ntitle without indentation or item marker';
    expect(() => parseBacklogYaml(text)).toThrow(/unrecognized line/);
  });

  it("real backlog.yml: parses to exactly 15 items with unique, namespaced ids (N1-N12, D1-D2, V1)", async () => {
    const { readFileSync } = await import("node:fs");
    const { BACKLOG_YML_PATH } = await import("./loadBacklog.mjs");
    const items = parseBacklogYaml(readFileSync(BACKLOG_YML_PATH, "utf8"));
    expect(items).toHaveLength(15);
    expect(new Set(items.map((it) => it.id)).size).toBe(15);
    expect(items.filter((it) => it.state === "actionable")).toHaveLength(12);
    expect(items.filter((it) => it.state === "owner")).toHaveLength(2);
    expect(items.filter((it) => it.state === "verification")).toHaveLength(1);
  });
});
