import { describe, it, expect } from "vitest";

import { resumeAnchor } from "./resumeAnchor.js";

const RESUME = [
  "Experience",
  "Senior Software Engineer, Initech — Remote",
  "Jan 2021 – Present",
  "- Led a team of six engineers, cutting deployment time by 40%.",
  "- Built a payments migration platform serving 2M requests per day.",
  "Support Analyst, Acme Corp — Austin, TX",
  "Mar 2018 – Dec 2020",
  "- Managed customer escalations and improved response time by 25%.",
  "Skills: Python, Django, PostgreSQL, Docker",
].join("\n");

describe("resumeAnchor", () => {
  it("names the role whose own material the question is about, not merely the latest one", () => {
    const anchor = resumeAnchor(RESUME, {
      question: "Tell me about handling a difficult customer escalation.",
    });
    expect(anchor).toMatchObject({ title: "Support Analyst", company: "Acme Corp", matched: true });
  });

  it("scores against the drafted answer as well as the question", () => {
    // A question alone is often too short to discriminate; the draft already
    // selected the material that mattered, so it is the stronger signal.
    const anchor = resumeAnchor(RESUME, {
      question: "Tell me about a time you took ownership.",
      points: ["I managed customer escalations and improved response time by 25%."],
    });
    expect(anchor.company).toBe("Acme Corp");
  });

  it("falls back to the most recent role, and says so, when nothing overlaps", () => {
    const anchor = resumeAnchor(RESUME, { question: "What is your favorite color?" });
    // `matched: false` is the honest report that this role was NOT chosen for
    // relevance — the caller labels it differently because of it.
    expect(anchor).toMatchObject({ title: "Senior Software Engineer", company: "Initech", matched: false });
  });

  // T2/C2 regression: plain keyword overlap alone can't distinguish "the
  // whole-résumé search was deleted" from "it correctly used the named
  // role's own bullet", because in the ORIGINAL fixture both searches land
  // on the same line. This fixture forces them apart: the named role's own
  // bullet is short enough that relevantExperienceLine (answerLocal.js)
  // never even considers it a candidate (it skips lines under 24 chars), so
  // a whole-résumé search would instead surface a DIFFERENT employer's much
  // stronger bullet. This is the exact scenario from the adversarial review
  // (Acme's bullets are all short like "Handled tickets.", Initech has "Led
  // a team of six engineers…") — the old code returned Initech's bullet
  // under Acme's label; after the fix, no project is the correct, honest
  // result for a named role whose own bullets don't survive.
  it("draws the project from the role it just named, never from a different employer", () => {
    const material = [
      "Experience",
      "Support Analyst, Acme Corp — Austin, TX",
      "Mar 2018 – Dec 2020",
      "- Handled tickets.",
      "Senior Software Engineer, Initech — Remote",
      "Jan 2021 – Present",
      "- Led a team of six engineers, cutting deployment time by 40%.",
    ].join("\n");
    const anchor = resumeAnchor(material, {
      question: "Tell me about your work as a Support Analyst at Acme handling tickets.",
    });
    expect(anchor.title).toBe("Support Analyst");
    expect(anchor.company).toBe("Acme Corp");
    // Acme's own bullet doesn't survive as a usable project line — the
    // honest result is NO project, never Initech's bullet borrowed in under
    // Acme's label.
    expect(anchor.project).toBe("");
    expect(anchor.project).not.toMatch(/deployment time|team of six/i);
  });

  it("returns a project short enough to read at a glance", () => {
    const anchor = resumeAnchor(RESUME, { question: "Tell me about leading a team." });
    expect(anchor.project.trim().split(/\s+/).length).toBeLessThanOrEqual(12);
  });

  it("never presents a motivation line as a project", () => {
    // A cover letter's "I am applying for..." opener can out-score a real
    // accomplishment on keyword overlap alone. Presented as "a project you
    // can talk about" it is worse than nothing.
    const material = [
      "Experience",
      "Product Manager, Globex — Remote",
      "Jan 2020 – Present",
      "- I am applying for this cloud infrastructure role because I want to grow my career in cloud infrastructure.",
      "- Launched a self-serve onboarding flow that lifted activation 18%.",
    ].join("\n");
    const anchor = resumeAnchor(material, { question: "Why do you want this cloud infrastructure role?" });
    expect(anchor.project).not.toMatch(/applying/i);
  });

  it("returns null when there is no material at all", () => {
    expect(resumeAnchor("", { question: "Anything?" })).toBeNull();
    expect(resumeAnchor("   ", { question: "Anything?" })).toBeNull();
    expect(resumeAnchor(undefined, { question: "Anything?" })).toBeNull();
    expect(resumeAnchor(null, {})).toBeNull();
  });

  it("returns null rather than a blank role when nothing parses as employment", () => {
    expect(resumeAnchor("Just some prose with no dates and no job headers.", { question: "Tell me about it." })).toBeNull();
  });

  it("still offers a project when a bullet is usable but no role header parses", () => {
    const material = [
      "Led a migration of the billing platform to a new payments provider in 2022.",
      "Reduced checkout errors by 30% across the whole funnel.",
    ].join("\n");
    const anchor = resumeAnchor(material, { question: "Tell me about a migration you led." });
    expect(anchor.project).toBeTruthy();
    expect(anchor.matched).toBe(false);
  });

  it("never invents an employer, title or project that is not in the material", () => {
    const anchor = resumeAnchor(RESUME, { question: "Tell me about leading a team." });
    const lowered = RESUME.toLowerCase();
    expect(lowered).toContain(anchor.title.toLowerCase());
    expect(lowered).toContain(anchor.company.toLowerCase());
    // T5 fix: a WORD-BOUNDARY check, not a substring check. A substring
    // check cannot catch a mangled fragment — "ubled" (what "doubled" turns
    // into when a shortening bug eats its front two letters) IS a substring
    // of the original word "doubled" and of plenty of other unrelated résumé
    // text, so `toContain` would happily pass on corrupted output. Only a
    // genuine whole word counts as "actually in the material".
    for (const word of anchor.project.toLowerCase().match(/[a-z0-9]+/g) || []) {
      const wholeWordPresent = new RegExp(`\\b${word}\\b`).test(lowered);
      expect(wholeWordPresent).toBe(true);
    }
  });

  // C3 regression (should-fix): significantTerms used to accept a bare digit
  // run (e.g. "200") as a meaningful overlap term, so a role could score
  // `matched: true` purely because it shares a number with the question —
  // completely unrelated to the actual subject matter. Pinned with the exact
  // observed scenario: a Barista role and a system-design question that only
  // "overlap" on "200".
  it("never scores a bare number as an overlap signal (C3)", () => {
    const material = [
      "Experience",
      "Software Engineer, Vertex Systems — Remote",
      "Jan 2022 – Present",
      "- Migrated the billing platform to a new payments provider.",
      "Barista, Coffee House — Anytown",
      "Jun 2016 – Aug 2017",
      "- Served 200 customers a day during the morning rush.",
    ].join("\n");
    const anchor = resumeAnchor(material, {
      question: "Walk me through how you would design a system that processes 200 requests per second.",
    });
    // Before the fix, the shared "200" alone scored the Barista role
    // `matched: true` (surfaced as "Closest role on your resume: Barista —
    // Coffee House" against a system-design question). With numeric tokens
    // filtered out, neither role's own words overlap the question, so this
    // correctly falls back to the most recent role instead.
    expect(anchor.title).toBe("Software Engineer");
    expect(anchor.company).toBe("Vertex Systems");
    expect(anchor.matched).toBe(false);
  });

  it("is deterministic", () => {
    const args = { question: "Tell me about leading a team.", points: ["I led a team of six engineers."] };
    expect(resumeAnchor(RESUME, args)).toEqual(resumeAnchor(RESUME, args));
  });
});
