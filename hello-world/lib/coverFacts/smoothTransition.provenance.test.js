import { describe, it, expect, vi } from "vitest";
import { requestSmoothTransition, confirmSmoothTransition } from "./smoothTransition.js";

// N94 (AC-B4, coverage hole found by the N92 Wave 3 verifier) -- a smoothing
// PRESERVES the fact's provenance: `id`/`url`/`title` are never touched, and the
// record's locator is RE-LOCATED to the smoothed fact text (the AC-A5 invariant:
// `lines[lineIndex].slice(offset, offset + text.length) === text`). That
// locator is what the one-click Remove excises by, and `url` is what the source
// link renders from -- so a smoothing that dropped either would silently strip
// the review affordances off a claim that goes to an employer.
//
// The behaviour was already correct (the verifier probed it); this file pins it
// so a future change to buildProposal cannot break it unnoticed. The mount-level
// half -- the link and Remove actually rendering and working -- is
// app/components/preview/coverFactSmoothProvenance.rc.test.js.
//
// Not vacuous on three counts: (1) the smoothing demonstrably changed the
// record's text (so "preserved" is not "never touched"), (2) a SECOND, unsmoothed
// record is carried through byte-identical, and (3) the provenance predicate is
// itself shown to FAIL on a stripped / mis-located record (the negative control).

const FACT_TEXT = "Acme opened a Dublin lab in 2021.";
const OTHER_FACT = "The team grew to forty engineers.";
const P1 = `I led the platform team. ${FACT_TEXT} We shipped quickly.`;
const P2 = `I also built the tooling. ${OTHER_FACT} It scaled well.`;

const SMOOTHED_OK = {
  status: "ok",
  before: "Leading the platform team,",
  fact: "I watched Acme open a Dublin lab in 2021,",
  after: "which let us ship quickly.",
};

function letter() {
  const lines = ["Dear Hiring Manager,", P1, P2, "Sincerely,"];
  const records = [
    { id: "f1", text: FACT_TEXT, lineIndex: 1, offset: P1.indexOf(FACT_TEXT), url: "https://news.example.com/dublin", title: "Acme opens a Dublin lab" },
    { id: "f2", text: OTHER_FACT, lineIndex: 2, offset: P2.indexOf(OTHER_FACT), url: "https://news.example.com/growth", title: "Team growth" },
  ];
  return { lines, records };
}

async function propose() {
  const { lines, records } = letter();
  const fetchImpl = vi.fn(async () => new Response(JSON.stringify({ smoothed: SMOOTHED_OK }), { status: 200 }));
  const candidate = await requestSmoothTransition({ engine: "gemini", lines, records, id: "f1", fetchImpl });
  expect(candidate.status, "fixture did not produce a proposed candidate -- every test below would be vacuous").toBe("proposed");
  return { candidate, lines, records };
}

// The provenance contract for one record, as a list of violations (empty = holds).
function provenanceViolations(record, original, afterLines) {
  const out = [];
  if (!record) return ["record missing"];
  for (const key of ["id", "url", "title"]) {
    if (typeof record[key] !== "string" || record[key] === "" || record[key] !== original[key]) out.push(`${key} changed or dropped`);
  }
  const line = String(afterLines[record.lineIndex] ?? "");
  if (typeof record.text !== "string" || !record.text || line.slice(record.offset, record.offset + record.text.length) !== record.text) {
    out.push("locator does not point at the record's own text");
  }
  return out;
}

describe("[control] the provenance predicate can fail", () => {
  it("flags a record that lost its url, and one whose locator no longer matches its text", () => {
    const { records } = letter();
    const [orig] = records;
    const lines = ["x", P1];
    expect(provenanceViolations({ ...orig }, orig, lines)).toEqual([]);
    expect(provenanceViolations({ ...orig, url: "" }, orig, lines), "a dropped url went unnoticed").toContain("url changed or dropped");
    expect(provenanceViolations({ ...orig, title: undefined }, orig, lines), "a dropped title went unnoticed").toContain("title changed or dropped");
    expect(provenanceViolations({ ...orig, id: "other" }, orig, lines), "a changed id went unnoticed").toContain("id changed or dropped");
    expect(provenanceViolations({ ...orig, offset: orig.offset + 1 }, orig, lines), "a stale locator went unnoticed").toContain(
      "locator does not point at the record's own text",
    );
  });
});

describe("a smoothing preserves the record's provenance (AC-B4)", () => {
  it("the proposal's record keeps id/url/title and is re-located to the SMOOTHED fact text", async () => {
    const { candidate, records } = await propose();
    const after = candidate.after.records.find((r) => r.id === "f1");
    const original = records[0];

    // positive control: the smoothing really did rewrite the fact's text.
    expect(after.text, "the fixture's smoothing did not change the fact text -- 'preserved' would be vacuous").not.toBe(original.text);
    expect(after.text).toBe(SMOOTHED_OK.fact);
    expect(provenanceViolations(after, original, candidate.after.lines)).toEqual([]);
  });

  it("what confirm hands the persistence layer carries the same provenance (the applied records, not just the preview)", async () => {
    const { candidate, records } = await propose();
    const persist = vi.fn(async () => ({ ok: true }));
    await confirmSmoothTransition(candidate, { persist });

    expect(persist).toHaveBeenCalledTimes(1);
    const applied = persist.mock.calls[0][0];
    const after = applied.records.find((r) => r.id === "f1");
    expect(provenanceViolations(after, records[0], applied.lines)).toEqual([]);
  });

  it("an UNSMOOTHED sibling fact is carried through untouched, with its locator still valid", async () => {
    const { candidate, records } = await propose();
    const sibling = candidate.after.records.find((r) => r.id === "f2");

    expect(sibling, "the sibling record was dropped by the smoothing").toEqual(records[1]);
    expect(provenanceViolations(sibling, records[1], candidate.after.lines)).toEqual([]);
    expect(candidate.after.records.length, "the smoothing added or removed a record").toBe(records.length);
  });
});
