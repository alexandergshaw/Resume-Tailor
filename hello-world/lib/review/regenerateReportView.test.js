// N104 Waves D/E (4b) - the pure view-model for "What regenerating changed"
// (UX 6.2 / UXW-3). It turns a ClosureReport (compareReviewGaps output) plus the
// new run's set-aside counts into the report's headline, groups, sentences and
// footer. RED on HEAD: lib/review/regenerateReportView.js does not exist.
//
// Two safety properties the view OWNS (not just the comparator):
//   * F1 guard carried into the view: when the two reviews' requirement id sets did
//     not correspond (correspondenceUnavailable), the view renders NO per-gap "No
//     longer flagged" row AND the headline makes no "{a} of {b} no longer flagged"
//     claim - even if handed closed rows. The comparator already empties `closed`
//     in that case; the view must ALSO refuse to assert closure, so a future break
//     on either side cannot ship a false "no longer flagged".
//   * The forbidden-vocabulary sweep (design 6.3): the chrome never says fixed /
//     resolved / addressed / closed / filled / ATS / score / optimize, nor the K2
//     set, because the mechanical check detects PRESENCE, not that a gap was fixed.

import { describe, it, expect } from "vitest";
import { regenerateReportView } from "./regenerateReportView.js";

// The exact forbidden patterns of design 6.3 + 5.3 (chrome only; quoted keyword
// terms carried from the posting are excluded, exactly as the band's clean sweep
// excludes [data-quoted] nodes).
const FORBIDDEN = [
  /\b(fixed|resolved|addressed|closed|filled)\b/i,
  /all (clear|done|good)/i,
  /nothing left/i,
  /\bATS\b/,
  /\bscore\b/i,
  /optimi[sz]/i,
  /\b(fill|fix|guarantee|guaranteed|verified|safe)\b/i,
  /\b100%/,
];

// Everything the view renders as its OWN words. Row `term`s (the posting's keyword)
// are the user's data, not chrome, so they are excluded from the sweep.
function chromeStrings(view) {
  const out = [view.headline, view.footer, ...(view.lines || [])];
  for (const group of view.groups || []) {
    out.push(group.title);
    if (group.hint) out.push(group.hint);
    for (const row of group.rows || []) out.push(row.label); // label is fixed vocabulary; term is excluded
  }
  return out.filter((s) => typeof s === "string");
}

function sweep(view) {
  return chromeStrings(view).flatMap((s) => FORBIDDEN.filter((re) => re.test(s)).map((re) => `${re} :: ${s}`));
}

const gap = (requirementId, term) => ({ category: "missing-keyword", requirementId, term, label: "Posting keyword missing" });

// A corresponding closure: the pin held, so per-gap closure is trustworthy.
const CORRESPONDING = Object.freeze({
  correspondenceUnavailable: false,
  closed: [gap("q1", "kubernetes"), gap("q2", "terraform")],
  stillOpen: [gap("q3", "graphql")],
  countsBefore: { missingKeyword: 3, vague: 2, repetition: 1 },
  countsAfter: { missingKeyword: 1, vague: 1, repetition: 1 },
  lineCountBefore: 30,
  lineCountAfter: 28,
  genuinelyUnqualifiedStillOpen: [{ requirementId: "q9", text: "Active TS/SCI clearance." }],
});

describe("regenerateReportView - the positive control (so the guard test is not vacuous)", () => {
  const view = regenerateReportView({ closure: CORRESPONDING, setAside: { removed: 2, leftOut: 1 }, confirmCount: 1 });

  it("renders a 'No longer flagged' group carrying the closed terms when the pin held", () => {
    const group = (view.groups || []).find((g) => g.title === "No longer flagged");
    expect(group, "a corresponding closure with closed gaps must render this group").toBeTruthy();
    expect(group.rows.map((r) => r.term)).toEqual(["kubernetes", "terraform"]);
  });

  it("renders a 'Still flagged' group for the gaps present in both reviews", () => {
    const group = (view.groups || []).find((g) => g.title === "Still flagged");
    expect(group).toBeTruthy();
    expect(group.rows.map((r) => r.term)).toEqual(["graphql"]);
  });

  it("uses the exact group titles from the copy deck (K14) and the K18 footer", () => {
    const titles = (view.groups || []).map((g) => g.title);
    for (const t of titles) expect(["No longer flagged", "Still flagged", "Newly flagged"]).toContain(t);
    expect(view.footer).toBe("This compares what the checks that ran flagged. It is not a verdict on the whole resume.");
  });

  it("the headline is the {a} of {b} form when the pin held and closures exist", () => {
    // a = 2 closed, b = 2 closed + 1 still open = 3
    expect(view.headline).toBe("Regenerated. 2 of 3 suggestions are no longer flagged.");
  });
});

describe("regenerateReportView - F1 guard carried into the view (the key safety mutant)", () => {
  it("renders NO 'No longer flagged' group when correspondence is unavailable, even if handed closed rows", () => {
    // The comparator empties `closed` under the guard; this feeds a HOSTILE input
    // (guard set AND closed non-empty) so the mutant that trusts closure.closed
    // regardless of the flag renders a false "No longer flagged" row -> RED.
    const hostile = { ...CORRESPONDING, correspondenceUnavailable: true, closed: [gap("q1", "kubernetes")] };
    const view = regenerateReportView({ closure: hostile, setAside: {}, confirmCount: 0 });
    expect((view.groups || []).some((g) => g.title === "No longer flagged")).toBe(false);
    expect(view.correspondenceUnavailable).toBe(true);
  });

  it("the headline makes no '{a} of {b} no longer flagged' claim under the guard", () => {
    const hostile = { ...CORRESPONDING, correspondenceUnavailable: true, closed: [gap("q1", "kubernetes")] };
    const view = regenerateReportView({ closure: hostile, setAside: {}, confirmCount: 0 });
    expect(view.headline).not.toMatch(/no longer flagged/i);
  });

  it("still reports the category count deltas under the guard (closure needs no identity)", () => {
    const hostile = { ...CORRESPONDING, correspondenceUnavailable: true, closed: [], stillOpen: [] };
    const view = regenerateReportView({ closure: hostile, setAside: {}, confirmCount: 0 });
    // the Length line survives the guard (it is a count, not a per-gap claim)
    expect(view.lines.some((l) => /Length: 30 lines before, 28 now\./.test(l))).toBe(true);
  });
});

describe("regenerateReportView - the forbidden vocabulary sweep (design 6.3)", () => {
  it("the corresponding-closure report's chrome matches none of the forbidden patterns", () => {
    const view = regenerateReportView({ closure: CORRESPONDING, setAside: { removed: 2, leftOut: 1 }, confirmCount: 1 });
    expect(sweep(view)).toEqual([]);
  });

  it("the unchanged-text and guarded reports are also clean", () => {
    const unchanged = regenerateReportView({ closure: CORRESPONDING, textUnchanged: true, setAside: {} });
    const guarded = regenerateReportView({
      closure: { ...CORRESPONDING, correspondenceUnavailable: true, closed: [], stillOpen: [] },
      setAside: {},
    });
    expect(sweep(unchanged)).toEqual([]);
    expect(sweep(guarded)).toEqual([]);
  });

  it("CANARY: the sweep has teeth - a planted 'fixed' / 'ATS score' in chrome is caught", () => {
    expect(sweep({ headline: "All 3 issues fixed", footer: "", lines: [], groups: [] }).length).toBeGreaterThan(0);
    expect(sweep({ headline: "Better ATS score now", footer: "", lines: [], groups: [] }).length).toBeGreaterThan(0);
  });
});

describe("regenerateReportView - closure-by-deletion is visible (G-6) and zeros are omitted", () => {
  it("renders the Length line only when the line counts differ", () => {
    const same = regenerateReportView({ closure: { ...CORRESPONDING, lineCountBefore: 30, lineCountAfter: 30 }, setAside: {} });
    expect(same.lines.some((l) => /Length:/.test(l))).toBe(false);
    const diff = regenerateReportView({ closure: CORRESPONDING, setAside: {} });
    expect(diff.lines.some((l) => /Length: 30 lines before, 28 now\./.test(l))).toBe(true);
  });

  it("renders the Set-aside line from the new run's counts, omitting a zero part", () => {
    const both = regenerateReportView({ closure: CORRESPONDING, setAside: { removed: 2, leftOut: 1 } });
    expect(both.lines.some((l) => /2 lines were set aside/.test(l) && /1 left out/.test(l))).toBe(true);
    const removedOnly = regenerateReportView({ closure: CORRESPONDING, setAside: { removed: 2, leftOut: 0 } });
    const line = removedOnly.lines.find((l) => /set aside/.test(l));
    expect(line).toBeTruthy();
    expect(line).not.toMatch(/left out/);
    const none = regenerateReportView({ closure: CORRESPONDING, setAside: { removed: 0, leftOut: 0 } });
    expect(none.lines.some((l) => /set aside/.test(l))).toBe(false);
  });

  it("never renders a zero count or the word 'none' anywhere in the chrome", () => {
    const view = regenerateReportView({ closure: CORRESPONDING, setAside: { removed: 2, leftOut: 1 }, confirmCount: 1 });
    for (const s of chromeStrings(view)) {
      expect(s).not.toMatch(/\b0\b/);
      expect(s).not.toMatch(/\bnone\b/i);
    }
  });
});

describe("regenerateReportView - genuinely-unqualified never reads as closed (AC-2)", () => {
  it("an unresolved requirement appears only in the 'Still listed' line, never as a closed/still-open row", () => {
    const view = regenerateReportView({ closure: CORRESPONDING, setAside: {}, confirmCount: 1 });
    const rowTerms = (view.groups || []).flatMap((g) => g.rows.map((r) => r.term));
    expect(rowTerms).not.toContain("q9");
    expect(view.lines.some((l) => /Still listed in the review:/.test(l) && /1 requirement/.test(l) && /1 to confirm/.test(l))).toBe(
      true,
    );
    expect(view.lines.some((l) => /add it to your resume and run again\./.test(l))).toBe(true); // K16 remedy, m>0
  });

  it("omits the unqualified remedy when none remain", () => {
    const view = regenerateReportView({ closure: { ...CORRESPONDING, genuinelyUnqualifiedStillOpen: [] }, setAside: {} });
    expect(view.lines.some((l) => /add it to your resume and run again/.test(l))).toBe(false);
  });
});

describe("regenerateReportView - headline variants (K13)", () => {
  it("still-flagged-only (no closures) reports the before-set as still flagged, not closed", () => {
    const view = regenerateReportView({ closure: { ...CORRESPONDING, closed: [], stillOpen: [gap("q3", "graphql")] }, setAside: {} });
    expect(view.headline).toBe("Regenerated. The 1 suggestion is still flagged.");
    expect(view.headline).not.toMatch(/no longer flagged/i);
  });

  it("unchanged text reports K13c and marks the view unchanged (nothing to replace)", () => {
    const view = regenerateReportView({ closure: CORRESPONDING, textUnchanged: true, setAside: {} });
    expect(view.unchanged).toBe(true);
    expect(view.headline).toBe(
      "Regenerated, but the text came out the same, so nothing changed. Your resume may not support more wording for these.",
    );
  });
});
