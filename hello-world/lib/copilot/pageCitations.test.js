// The contract for lib/copilot/pageCitations.js — which of the candidate's
// own knowledge-base pages each drafted point actually came from. Written
// from the acceptance criteria before the module existed.
//
// THE FAILURE THIS MODULE EXISTS TO PREVENT: a candidate, mid-interview,
// reading "from your Payments migration page" out loud for a page the model
// invented. lib/meeting/insightContract.js's normalizeInsights learned this
// first and downgrades any page citation that is not in the set the prompt
// actually showed; this is the same rule for a different surface, with one
// rule made stricter — see the title case below.

import { describe, it, expect } from "vitest";
import { resolvePageSources } from "./pageCitations.js";

const INCLUDED = [
  { id: "p1", title: "Payments migration", excerpted: false },
  { id: "p2", title: "Search reindex", excerpted: true },
];

describe("resolvePageSources", () => {
  it("pairs each cited page with the point at the same index", () => {
    const out = resolvePageSources(["p1", null, "p2"], { includedPages: INCLUDED, pointCount: 3 });
    // The whole sequence, not a spot check: an implementation that returned
    // only the non-null entries would shift every later citation onto the
    // wrong point, which is the exact defect this pairing rule exists for.
    expect(out).toEqual([
      { id: "p1", title: "Payments migration" },
      null,
      { id: "p2", title: "Search reindex" },
    ]);
  });

  it("drops a page id the prompt never showed, instead of trusting it", () => {
    const out = resolvePageSources(["p1", "p-invented"], { includedPages: INCLUDED, pointCount: 2 });
    expect(out).toEqual([{ id: "p1", title: "Payments migration" }, null]);
  });

  it("takes the title from what was shown, never from the model", () => {
    // Stricter than insightContract.js, which accepts the model's own
    // pageTitle. A model that copies the id correctly and paraphrases the
    // title produces a citation the user cannot recognise as their own page —
    // and we already hold the real value.
    //
    // The fixture is built so an echoing implementation is DISTINGUISHABLE
    // from a looking-up one: the whitelist's title for `p1` is nothing like
    // the id, so returning the title proves it was fetched from
    // includedPages rather than derived from the input.
    const out = resolvePageSources(["p1"], { includedPages: INCLUDED, pointCount: 1 });
    expect(out).toEqual([{ id: "p1", title: "Payments migration" }]);
  });

  it("refuses a citation that is not a plain id string", () => {
    // The declared model channel is `"pageIds": (string|null)[]`, so an
    // object here is corruption, not a richer citation to be unwrapped.
    // Unwrapping it would take the model's own `title` — exactly what the
    // case above exists to forbid.
    const out = resolvePageSources([{ id: "p1", title: "The Payments Thing" }], {
      includedPages: INCLUDED,
      pointCount: 1,
    });
    expect(out).toEqual([null]);
  });

  it("never lets a blank id match a blank entry in the whitelist", () => {
    // A page row whose id is empty or whitespace is not citable. Matching on
    // it would attach a real-looking citation to a page nobody can open.
    const included = [{ id: "   ", title: "Broken row", excerpted: false }, ...INCLUDED];
    expect(resolvePageSources(["   "], { includedPages: included, pointCount: 1 })).toEqual([null]);
    expect(resolvePageSources([""], { includedPages: included, pointCount: 1 })).toEqual([null]);
  });

  it("resolves a duplicated id to the first page shown under it", () => {
    // Two entries can only share an id through a caller bug, and picking the
    // later one would silently attribute the point to whichever page
    // happened to sort last.
    const included = [
      { id: "dup", title: "The page the model was shown", excerpted: false },
      { id: "dup", title: "A different page entirely", excerpted: false },
    ];
    expect(resolvePageSources(["dup"], { includedPages: included, pointCount: 1 })).toEqual([
      { id: "dup", title: "The page the model was shown" },
    ]);
  });

  it("drops EVERY citation when the count does not match the points", () => {
    // All-or-nothing, the same rule resolveCues and answerLines already apply
    // to positional pairing: a citation against the wrong beat is worse than
    // no citation at all.
    expect(resolvePageSources(["p1"], { includedPages: INCLUDED, pointCount: 3 })).toEqual([null, null, null]);
    expect(resolvePageSources(["p1", "p2", "p1", "p2"], { includedPages: INCLUDED, pointCount: 2 })).toEqual([
      null,
      null,
    ]);
  });

  it("returns an empty array — not an array of nulls — when no page reached the draft", () => {
    // The difference is load-bearing downstream: answerLines pairs only when
    // the lengths match, so [] fails the gate and NOTHING renders (AC-6.3, no
    // empty row, no "0 pages"), whereas an array of nulls of the right length
    // would pass the gate and render a citation slot for every line.
    expect(resolvePageSources(["p1"], { includedPages: [], pointCount: 1 })).toEqual([]);
    expect(resolvePageSources([], { includedPages: INCLUDED, pointCount: 0 })).toEqual([]);
  });

  it("treats a missing or malformed citation array as no citations at all", () => {
    for (const raw of [undefined, null, "p1", 7, {}]) {
      expect(resolvePageSources(raw, { includedPages: INCLUDED, pointCount: 2 })).toEqual([null, null]);
    }
  });

  it("never throws, whatever it is handed", () => {
    expect(() => resolvePageSources(null, null)).not.toThrow();
    expect(() => resolvePageSources(["p1"], { includedPages: null, pointCount: null })).not.toThrow();
    expect(() => resolvePageSources([null, undefined], { includedPages: [null, {}], pointCount: 2 })).not.toThrow();
  });
});
