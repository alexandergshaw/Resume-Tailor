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

  // The per-state counts this test used to hardcode (12 actionable / 2 owner /
  // 1 verification) rotted on 2026-09-14, when closing four items and opening
  // three turned it red for a reason that had nothing to do with the parser it
  // is testing. A count of a list that is DESIGNED to change -- this file's own
  // "no diary" rule deletes closed items -- is an instrument that fires on
  // correct work. What is actually invariant is the NAMESPACE RULE the schema
  // header states: the id's leading letter and the `state` field are two
  // independent fields that must agree. Cross-checking them is a real
  // assertion; re-deriving a count from the file it validates would only prove
  // self-consistency ([[loop-traps-tests]]'s canary trap, backlog N3).
  const STATE_OF_PREFIX = { N: "actionable", D: "owner", V: "verification" };

  it("real backlog.yml: every item's id namespace agrees with its state, and ids are unique", async () => {
    const { readFileSync } = await import("node:fs");
    const { BACKLOG_YML_PATH } = await import("./loadBacklog.mjs");
    const items = parseBacklogYaml(readFileSync(BACKLOG_YML_PATH, "utf8"));

    expect(items.length).toBeGreaterThan(0);
    expect(new Set(items.map((it) => it.id)).size).toBe(items.length);

    for (const it of items) {
      expect(it.id, `id "${it.id}" is not namespaced N/D/V`).toMatch(/^[NDV]\d+$/);
      expect(it.state, `id "${it.id}" claims state "${it.state}"`).toBe(STATE_OF_PREFIX[it.id[0]]);
    }
  });

  it("[control] the namespace check can fail -- a V-prefixed item declaring itself actionable is rejected", () => {
    const items = parseBacklogYaml(
      [
        '- id: "V9"',
        '  state: "actionable"',
        '  title: "wrong state for a V id"',
        "  owed_by: null",
        "  evidence: []",
        "  blocked_reason: null",
        "  instrument: null",
        "  owns: null",
        "  verify: null",
        "  verify_proof: null",
        "  blocked_by: []",
      ].join(String.fromCharCode(10)),
    );
    expect(items).toHaveLength(1);
    expect(STATE_OF_PREFIX[items[0].id[0]]).toBe("verification");
    expect(items[0].state).not.toBe(STATE_OF_PREFIX[items[0].id[0]]);
  });
});
