import { describe, it, expect } from "vitest";

import { MAX_BUZZWORDS, postingBuzzwords } from "./postingBuzzwords.js";

// AC-L2 changed this file's whole premise: postingBuzzwords used to rank by
// the extractor's own score, which is a property of the POSTING alone, so
// the top MAX_BUZZWORDS terms were the same six words for every question
// asked against a given posting (see postingBuzzwordsRelevance.test.js for
// the reported bug and the fix's contract). Every test below that used to
// call postingBuzzwords with no `question`/`points` now supplies ones that
// are actually about a real posting term — a call with no question has
// nothing to be relevant TO, so it always returns [] (covered explicitly
// below) rather than exercising anything interesting.

const POSTING = [
  "Senior Platform Engineer",
  "We are looking for an engineer with deep Kubernetes and Terraform experience.",
  "Requirements:",
  "- 5+ years with Python and Django",
  "- Strong background in CI/CD, observability and incident response",
  "- Experience mentoring engineers and driving cross functional collaboration",
  "Nice to have: AWS, PostgreSQL, Docker",
].join("\n");

// Restates most of POSTING's own vocabulary back as a question, so nearly
// every candidate term in it is relevant — used by the cap/dedupe tests
// below, which need to know the pool of relevant terms exceeds MAX_BUZZWORDS
// rather than happening to land under it.
const ASK_ABOUT_EVERYTHING = {
  question:
    "How do you use Kubernetes, Terraform, AWS, Docker, Django, PostgreSQL, and Python, and how do you approach CI/CD, observability, incident response, and mentoring, as a senior platform engineer with deep Kubernetes expertise mentoring engineers?",
  points: [
    "I have hands-on experience with Kubernetes, Terraform, AWS, Docker, Django, PostgreSQL, and Python.",
    "I handle CI/CD, observability, and incident response daily while mentoring engineers.",
  ],
};

describe("postingBuzzwords", () => {
  it("returns terms the posting actually contains, relevant to the question asked", () => {
    const terms = postingBuzzwords(POSTING, {
      question: "How do you approach incident response?",
      points: ["I ran incident response for the platform team."],
    });
    expect(terms.length).toBeGreaterThan(0);
    for (const term of terms) {
      expect(POSTING.toLowerCase()).toContain(term.toLowerCase());
    }
  });

  it("caps the list so it stays glanceable", () => {
    expect(MAX_BUZZWORDS).toBe(4);
    expect(postingBuzzwords(POSTING, ASK_ABOUT_EVERYTHING).length).toBeLessThanOrEqual(MAX_BUZZWORDS);
    expect(postingBuzzwords(POSTING, { ...ASK_ABOUT_EVERYTHING, limit: 3 })).toHaveLength(3);
  });

  it("ranks a term with more word overlap ahead of one with less, even against a lower tier", () => {
    // The same posting yields a different emphasis per question — this is
    // what makes the section worth showing on every answer rather than once
    // per session. Both "incident response" (both its words: RAKE topic,
    // tier 1) and "Kubernetes" (one word: taxonomy tier 0) are relevant to
    // this question, so this specifically exercises word-overlap-count
    // ranking ahead of tier — "incident response" only wins because it
    // overlaps on 2 words to Kubernetes's 1, not because of its tier (a
    // taxonomy term is normally preferred over a RAKE phrase at equal
    // overlap, so tier alone would have put Kubernetes first).
    const [first] = postingBuzzwords(POSTING, {
      question: "How do you approach incident response, and have you used Kubernetes?",
      points: ["I ran incident response for the platform team.", "I have some Kubernetes experience."],
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
    // "teams" is recognized as the Microsoft Teams alias regardless of
    // stopword status — taxonomy recognition and the word-overlap signal are
    // two different mechanisms, and stopwords ("team"/"teams" among them)
    // only gate the latter. So a question that says "teams" is exactly the
    // shape of question that makes Microsoft Teams the relevant candidate
    // here; the guard has to hold even then.
    const terms = postingBuzzwords(posting, {
      question: "How do you collaborate across teams?",
      points: ["I partner closely with other teams."],
    });
    expect(terms).not.toContain("Microsoft Teams");
    for (const term of terms) {
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
    // "Go" has no significant word of its own ("go" is 2 chars, below the
    // 3-char floor), so the only way to make it relevant at all is the
    // canonical-intersection signal — a question that says "golang" recognizes
    // the SAME taxonomy entry the posting matched. That still isn't enough:
    // the guard only lets a canonical through when it literally occurs, and
    // "Go" on its own never does here.
    const terms = postingBuzzwords(posting, {
      question: "Can you tell me about your golang experience?",
      points: ["I write services in golang day to day."],
    });
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
    const terms = postingBuzzwords(POSTING, { ...ASK_ABOUT_EVERYTHING, limit: MAX_BUZZWORDS });
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

  it("returns an empty list when nothing about the question relates to the posting", () => {
    // No fallback to "top terms for the posting" — an unrelated question
    // means an absent row, not noise. See postingBuzzwordsRelevance.test.js
    // for the full AC-L2 story this pins.
    expect(
      postingBuzzwords(POSTING, {
        question: "What are your salary expectations for this role?",
        points: ["I would like to understand the band before naming a number."],
      }),
    ).toEqual([]);
  });

  it("is deterministic for the same posting and question", () => {
    const args = { question: "Tell me about a time you shipped under pressure.", points: ["I shipped it."] };
    expect(postingBuzzwords(POSTING, args)).toEqual(postingBuzzwords(POSTING, args));
  });

  it("still finds terms in a posting the technology taxonomy barely matches", () => {
    // A non-technical posting must not come back empty — the RAKE topic
    // phrases are the fallback tier for exactly this case, so long as the
    // question is actually about them.
    const posting = [
      "Customer Success Lead",
      "You will own quarterly business reviews and drive customer retention.",
      "Requirements: stakeholder management, executive communication, renewal forecasting.",
    ].join("\n");
    const terms = postingBuzzwords(posting, {
      question: "How do you run quarterly business reviews and drive customer retention?",
      points: [
        "I focus on stakeholder management and renewal forecasting to keep executive communication clear.",
      ],
    });
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
  // below target the topic tier specifically. Each question below is crafted
  // to overlap heavily with the offending phrase's own words, so the bound
  // is shown holding under maximum relevance pressure, not just because the
  // phrase was never a candidate to begin with.
  describe("C5: usability bounds on the RAKE topic tier", () => {
    it("never surfaces a single chip built from an unbounded run of words", () => {
      const posting = [
        "Operations Lead",
        "Responsibilities include operating scaling securing observing distributed event driven microservice platforms.",
      ].join("\n");
      const terms = postingBuzzwords(posting, {
        question:
          "How do you approach operating, scaling, securing, and observing distributed, event driven microservice platforms as an operations lead?",
        points: ["I have run distributed microservice platforms in production as an operations lead."],
      });
      expect(terms.length).toBeGreaterThan(0);
      for (const term of terms) {
        expect(term.length).toBeLessThanOrEqual(32);
        expect(term.trim().split(/\s+/).length).toBeLessThanOrEqual(4);
      }
    });

    it("never surfaces a pathologically long chip from repeated input", () => {
      // A description of "Kubernetes " repeated 2000 times produced a single
      // ~21,000-character chip label before this fix.
      const posting = `Requirements: ${"Kubernetes ".repeat(2000)}`;
      const terms = postingBuzzwords(posting, {
        question: "Tell me about your Kubernetes experience.",
        points: ["I have deployed Kubernetes clusters extensively."],
      });
      expect(terms.length).toBeGreaterThan(0);
      for (const term of terms) {
        expect(term.length).toBeLessThanOrEqual(32);
      }
    });

    it("never surfaces punctuation-split garbage phrases", () => {
      const rdPosting = "You will support R&D partnership across four business units.";
      const rdTerms = postingBuzzwords(rdPosting, {
        question: "How do you work across four business units?",
        points: ["I support R&D partnership initiatives across business units."],
      }).map((t) => t.toLowerCase());
      expect(rdTerms).not.toContain("d partnership");
      expect(rdTerms).not.toContain("support r");

      const gradePosting = "Grade C or above required.";
      const gradeTerms = postingBuzzwords(gradePosting, {
        question: "What grade level did you require?",
        points: ["We required a grade of B or higher."],
      }).map((t) => t.toLowerCase());
      expect(gradeTerms).not.toContain("grade c");
    });
  });
});
