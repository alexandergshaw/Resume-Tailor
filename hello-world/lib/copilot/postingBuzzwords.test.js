import { describe, it, expect } from "vitest";

import { MAX_BUZZWORDS, postingBuzzwords } from "./postingBuzzwords.js";

const POSTING = [
  "Senior Platform Engineer",
  "We are looking for an engineer with deep Kubernetes and Terraform experience.",
  "Requirements:",
  "- 5+ years with Python and Django",
  "- Strong background in CI/CD, observability and incident response",
  "- Experience mentoring engineers and driving cross functional collaboration",
  "Nice to have: AWS, PostgreSQL, Docker",
].join("\n");

describe("postingBuzzwords", () => {
  it("returns terms the posting actually contains", () => {
    const terms = postingBuzzwords(POSTING);
    expect(terms.length).toBeGreaterThan(0);
    for (const term of terms) {
      expect(POSTING.toLowerCase()).toContain(term.toLowerCase());
    }
  });

  it("caps the list so it stays glanceable", () => {
    expect(postingBuzzwords(POSTING).length).toBeLessThanOrEqual(MAX_BUZZWORDS);
    expect(postingBuzzwords(POSTING, { limit: 3 })).toHaveLength(3);
  });

  it("ranks a term the answer already touches ahead of a higher-scoring one it does not", () => {
    // The same posting yields a different emphasis per question — this is
    // what makes the section worth showing on every answer rather than once
    // per session.
    const [first] = postingBuzzwords(POSTING, {
      question: "How do you approach incident response?",
      points: ["I ran incident response for the platform team."],
    });
    expect(first.toLowerCase()).toBe("incident response");
  });

  it("never surfaces a taxonomy inference the posting never literally used", () => {
    // The recorded "team" -> "Microsoft Teams" hazard. Telling a candidate to
    // say "Microsoft Teams" because the posting said "team" would put a term
    // in their mouth that nobody wrote, in a live interview.
    const posting = [
      "Engineering Manager",
      "You will lead a team of engineers and partner with four product teams.",
      "Requirements: strong communication and mentoring skills.",
    ].join("\n");
    for (const term of postingBuzzwords(posting)) {
      expect(term).not.toBe("Microsoft Teams");
      expect(posting.toLowerCase()).toContain(term.toLowerCase());
    }
  });

  // T4: every other case in this file checks literallyMentioned's guard with
  // a plain substring assertion (`toContain`), which a naive `.includes()`
  // implementation would also satisfy — none of them exercise the WORD
  // BOUNDARY anchoring specifically. "Go" is taxonomy-registered with
  // match_canonical:false and alias "golang" (skills_taxonomy.json), so it
  // gets extracted here via the token "golang" — but the bare word "Go"
  // never occurs on its own anywhere in this posting, only embedded inside
  // "golang". A naive substring check would see "go" inside "golang" and
  // wrongly let the canonical through; the real \b-anchored guard must not.
  it("never surfaces a canonical that appears only as a substring of a longer word", () => {
    const posting = [
      "Backend Engineer",
      "We build all backend services in golang.",
      "Requirements: strong systems programming background.",
    ].join("\n");
    const terms = postingBuzzwords(posting);
    expect(terms).not.toContain("Go");
  });

  // T3: investigated whether a case-insensitive duplicate is actually
  // reachable through this public API. rakePhrases (keywords.js) explicitly
  // skips any candidate phrase that is already a registered taxonomy alias
  // (`if (aliasMap.has(joined)) continue`), and each tier already de-dupes
  // ITSELF before postingBuzzwords ever sees it — the taxonomy tier
  // accumulates into a Map keyed by canonical (extractKeywords' `acc`), and
  // the RAKE tier into a Map keyed by the joined phrase (rakePhrases'
  // `scored`). So a taxonomy term and a RAKE topic phrase can never collide,
  // and neither tier can collide with itself: no posting reachable through
  // postingBuzzwords/extractKeywords can hand the `seen` Set in
  // postingBuzzwords.js something it has already seen. The Set is
  // defensive, not load-bearing, for this input (or any input this pipeline
  // can produce) — this test documents that invariant rather than
  // fabricating a duplicate the real pipeline structurally cannot produce.
  it("never produces case-insensitive duplicates (the two tiers are disjoint by construction)", () => {
    const terms = postingBuzzwords(POSTING, { limit: MAX_BUZZWORDS });
    const lowered = terms.map((t) => t.toLowerCase());
    expect(new Set(lowered).size).toBe(lowered.length);
  });

  it("returns an empty list for a missing, blank or non-string description", () => {
    // The whole subsection is absent when no posting was selected — never a
    // header with nothing under it.
    expect(postingBuzzwords("")).toEqual([]);
    expect(postingBuzzwords("   ")).toEqual([]);
    expect(postingBuzzwords(undefined)).toEqual([]);
    expect(postingBuzzwords(null)).toEqual([]);
  });

  it("is deterministic for the same posting and question", () => {
    const args = { question: "Tell me about a time you shipped under pressure.", points: ["I shipped it."] };
    expect(postingBuzzwords(POSTING, args)).toEqual(postingBuzzwords(POSTING, args));
  });

  it("still finds terms in a posting the technology taxonomy barely matches", () => {
    // A non-technical posting must not come back empty — the RAKE topic
    // phrases are the fallback tier for exactly this case.
    const posting = [
      "Customer Success Lead",
      "You will own quarterly business reviews and drive customer retention.",
      "Requirements: stakeholder management, executive communication, renewal forecasting.",
    ].join("\n");
    const terms = postingBuzzwords(posting);
    expect(terms.length).toBeGreaterThan(0);
    for (const term of terms) {
      expect(posting.toLowerCase()).toContain(term.toLowerCase());
    }
  });

  // C5 regression (should-fix): the RAKE `topic` tier is unbounded free text
  // pulled off the posting — with no usability filter it can hand back one
  // absurdly long chip, or punctuation-split garbage. Both are pinned here
  // with the exact observed inputs from the adversarial review. Neither
  // defect is reachable in the taxonomy tier (real canonicals like "Go",
  // "R", "C", "C++", "C#" are short/single-word by design), so both cases
  // below target the topic tier specifically.
  describe("C5: usability bounds on the RAKE topic tier", () => {
    it("never surfaces a single chip built from an unbounded run of words", () => {
      const posting = [
        "Operations Lead",
        "Responsibilities include operating scaling securing observing distributed event driven microservice platforms.",
      ].join("\n");
      for (const term of postingBuzzwords(posting)) {
        expect(term.length).toBeLessThanOrEqual(32);
        expect(term.trim().split(/\s+/).length).toBeLessThanOrEqual(4);
      }
    });

    it("never surfaces a pathologically long chip from repeated input", () => {
      // A description of "Kubernetes " repeated 2000 times produced a single
      // ~21,000-character chip label before this fix.
      const posting = `Requirements: ${"Kubernetes ".repeat(2000)}`;
      const terms = postingBuzzwords(posting);
      expect(terms.length).toBeGreaterThan(0);
      for (const term of terms) {
        expect(term.length).toBeLessThanOrEqual(32);
      }
    });

    it("never surfaces punctuation-split garbage phrases", () => {
      const rdPosting = "You will support R&D partnership across four business units.";
      const rdTerms = postingBuzzwords(rdPosting).map((t) => t.toLowerCase());
      expect(rdTerms).not.toContain("d partnership");
      expect(rdTerms).not.toContain("support r");

      const gradePosting = "Grade C or above required.";
      const gradeTerms = postingBuzzwords(gradePosting).map((t) => t.toLowerCase());
      expect(gradeTerms).not.toContain("grade c");
    });
  });
});
