// AC-G1, AC-G4, §3.3, §3.5 -- Pass A and the anchor space.
//
// Pass A produces TWO different things and conflating them is a real defect:
//
//   * THE A-TERMS -- the stored "in this posting" list. TAXONOMY CANONICALS
//     ONLY. The RAKE `topic` tier is EXCLUDED, because it was measured
//     producing `push campaigns end`, `leadership monthly`, `000 employees`,
//     `averaged 30 percent` -- each literally present in the posting, so the
//     kind-derivation rule would PROMOTE each to `kind: explicit` and show it
//     to a candidate under "In this posting".
//   * THE ANCHOR SPACE -- parents, never stored as terms. Taxonomy canonicals
//     UNION RAKE topic phrases UNION one validated role token. Without the RAKE
//     tier a charge-nurse posting has ZERO anchors and the whole job family caps
//     at fifteen terms.
//
// A naive "declare a parent from the Pass-A list" rule does nothing at all: it
// checks string membership and never the child-parent relation. `Communication`
// is a taxonomy canonical present in every posting measured, so it could anchor
// a hundred children, and one incidental `SQL` mention licenses a hundred
// PostgreSQL-internals terms for a lifecycle marketer. The budgets are what
// bound the volume; nothing in this repository can detect relevance, and this
// file does not claim to.

import { describe, it, expect } from "vitest";
import { anchorSpace, explicitTermsFor, maxAnticipatedForRow, evidenceFor } from "./glossaryAnchors.js";
import { MAX_ANTICIPATED_TERMS } from "./glossaryConstants.js";

const ENGINEERING = [
  "Senior Platform Engineer, Payments",
  "You will own our PostgreSQL estate, our Kubernetes clusters and the payments ledger.",
  "Experience with Python, Terraform and AWS is expected.",
  "We care about idempotency in every write path.",
  "Strong communication and cross-functional collaboration are expected.",
].join("\n");

// The measured hard case: a posting whose Pass-A taxonomy hits are all generic
// professional phrases, so its taxonomy anchor count is effectively zero. Every
// anchor it has comes from the RAKE topic tier, and without that tier the whole
// job family caps at fifteen terms.
const NURSING = [
  "RN Charge Nurse, Med-Surg",
  "You will coordinate patient throughput across a thirty-two bed medical surgical unit.",
  "Responsibilities include staffing assignments, discharge planning and escalation to the rapid response team.",
  "Bedside shift report and hourly rounding are part of the unit culture.",
  "You will chair the daily interdisciplinary huddle and own the acuity based assignment sheet.",
  "Familiarity with pressure injury staging and fall risk assessment protocols is expected.",
  "You will precept new graduate nurses through their first ninety days on the unit.",
  "Charge nurses escalate to the house supervisor for capacity and staffing exceptions.",
  "Strong communication and attention to detail are expected.",
].join("\n");

describe("explicitTermsFor -- the A-terms", () => {
  it("returns taxonomy canonicals that are literally present in the posting", () => {
    const terms = explicitTermsFor(ENGINEERING);
    expect(terms.length).toBeGreaterThan(0);
    for (const t of terms) {
      expect({ t, present: ENGINEERING.toLowerCase().includes(t.toLowerCase()) }).toEqual({
        t,
        present: true,
      });
    }
  });

  it("is uncapped -- MAX_BUZZWORDS is a display budget for a different feature", () => {
    expect(explicitTermsFor(ENGINEERING).length).toBeGreaterThan(4);
  });

  it("excludes the RAKE topic tier, so no scored phrase is ever shown as a posting term", () => {
    const terms = explicitTermsFor(ENGINEERING).map((t) => t.toLowerCase());
    expect(terms).not.toContain("payments ledger");
    expect(terms.every((t) => !/^\d/.test(t))).toBe(true);
  });

  it("degrades to an empty list rather than throwing on empty input", () => {
    expect(explicitTermsFor("")).toEqual([]);
    expect(explicitTermsFor(null)).toEqual([]);
  });
});

describe("anchorSpace -- the closed set every anticipated term must name", () => {
  it("includes taxonomy canonicals, topic phrases and exactly one role token", () => {
    const space = anchorSpace(ENGINEERING, "Senior Platform Engineer");
    expect(space.roleToken).toBe("role:senior platform engineer");
    expect(space.all.has(space.roleToken)).toBe(true);
    expect(space.taxonomy.length).toBeGreaterThan(0);
    expect([...space.all].filter((a) => a.startsWith("role:"))).toHaveLength(1);
  });

  it("is NON-EMPTY for a posting with zero taxonomy anchors (AC-G4)", () => {
    // The measured charge-nurse case. Without the RAKE topic tier this posting's
    // anchor space is empty and the whole job family caps at fifteen terms.
    const space = anchorSpace(NURSING, "RN Charge Nurse");
    expect(space.all.size).toBeGreaterThan(1);
    expect(space.topics.length).toBeGreaterThan(0);
  });

  it("excludes an anchor that would not survive the term rules applied to ITSELF", () => {
    // `Communication` is a soft-skill taxonomy canonical present in almost every
    // posting. As an anchor it would license a hundred unrelated children.
    const space = anchorSpace(ENGINEERING, "Senior Platform Engineer");
    expect([...space.all].map((a) => a.toLowerCase())).not.toContain("communication");
  });

  it("normalises the role token from the position title, not a constant", () => {
    // Deliberately not the literal string "role": the model must NAME the role
    // and we validate that name against positions.title.
    expect(anchorSpace(NURSING, "RN Charge Nurse").roleToken).toBe("role:rn charge nurse");
  });
});

describe("maxAnticipatedForRow (AC-G1)", () => {
  it("is the minimum of the hard cap, the anchor budgets and the quote budget", () => {
    expect(maxAnticipatedForRow({ taxonomyCount: 15, topicCount: 7, quoteCount: 9 })).toBe(
      Math.min(MAX_ANTICIPATED_TERMS, 8 * 15 + 8 * 7 + 20, 6 * 9),
    );
  });

  it("reaches at least forty on the charge-nurse posting (AC-G4)", () => {
    const space = anchorSpace(NURSING, "RN Charge Nurse");
    const quotes = NURSING.split("\n").filter((l) => l.trim().length > 20);
    const ceiling = maxAnticipatedForRow({
      taxonomyCount: space.taxonomy.length,
      topicCount: space.topics.length,
      quoteCount: quotes.length,
    });
    expect(ceiling).toBeGreaterThanOrEqual(40);
  });

  it("never exceeds the hard anticipated ceiling", () => {
    expect(maxAnticipatedForRow({ taxonomyCount: 500, topicCount: 500, quoteCount: 500 })).toBe(
      MAX_ANTICIPATED_TERMS,
    );
  });
});

describe("evidenceFor (AC-Q3)", () => {
  it("returns a verbatim span of the description containing the term", () => {
    const evidence = evidenceFor(ENGINEERING, "PostgreSQL");
    expect(ENGINEERING.includes(evidence)).toBe(true);
    expect(evidence.toLowerCase()).toContain("postgresql");
    expect(evidence.length).toBeLessThanOrEqual(200);
  });

  it("returns null for a term the description does not contain", () => {
    expect(evidenceFor(ENGINEERING, "COBOL")).toBe(null);
  });

  it("never invents text -- the snippet is extracted by US, never quoted back by a model", () => {
    const long = `${"x".repeat(500)} idempotency ${"y".repeat(500)}`;
    const evidence = evidenceFor(long, "idempotency");
    expect(long.includes(evidence)).toBe(true);
    expect(evidence.length).toBeLessThanOrEqual(200);
  });
});
