import { describe, it, expect } from "vitest";
import { mineSkillPhrases } from "./skillMiner.js";
import { isNoiseTopic } from "./topicNoise.js";
import { defaultLibraryData } from "./library/defaults.js";

const TAXONOMY = defaultLibraryData.taxonomy;

// Modeled directly on the Georgia Southwestern "Web Specialist" posting whose
// scan produced 12 policy-boilerplate suggestions and zero skills.
const HIGHERED_POSTING = [
  "The Web Specialist is responsible for developing and managing the overall web content strategy.",
  "Experience with content management systems, search engine optimization best practices, and analytics.",
  "More than three years of related experience required in web content strategy or creating/writing content for digital media.",
  "Knowledge of web management principles and practices. Knowledge of content strategy methods and analytics.",
  "Knowledge of writing engaging content for the web.",
  "Knowledge of university and departmental policies and procedures.",
  "Skill in grammar, editing, and proofreading with meticulous attention to detail.",
  "Ensure accessibility, mobile responsiveness, and ADA compliance across all forms.",
  "More details are available in USG Board Policy 8.2.18.1.2 at https://www.usg.edu/policymanual/section8/C224.",
  "Offers of employment are contingent upon completion of a criminal background check demonstrating eligibility.",
].join("\n");

describe("isNoiseTopic", () => {
  it("rejects URLs, section references, and hiring boilerplate", () => {
    expect(isNoiseTopic("www.usg.edu policymanual section8 c224 p8.2.18")).toBe(true);
    expect(isNoiseTopic("usg board policy 8.2.18.1.2")).toBe(true);
    expect(isNoiseTopic("criminal background check")).toBe(true);
    expect(isNoiseTopic("letter of application")).toBe(true);
    expect(isNoiseTopic("equal opportunity employer")).toBe(true);
  });

  it("rejects sentence shrapnel (5+ words) but keeps real skill phrases", () => {
    expect(isNoiseTopic("varied web management duties unique user requests")).toBe(true);
    expect(isNoiseTopic("content strategy")).toBe(false);
    expect(isNoiseTopic("information architecture")).toBe(false);
    expect(isNoiseTopic("digital media")).toBe(false);
  });
});

describe("mineSkillPhrases", () => {
  const mined = mineSkillPhrases(HIGHERED_POSTING, TAXONOMY);
  const phrases = mined.map((m) => m.phrase.toLowerCase());

  it("extracts skills from Knowledge-of / Skill-in / Experience-with constructions", () => {
    // "web management principles and practices" → "web management" is an alias
    // of the (new) Web Content Management entry — so it's already known; the
    // genuinely-unknown mined phrases must include real posting vocabulary.
    expect(phrases.length).toBeGreaterThan(0);
    expect(phrases.join(" | ")).toMatch(/grammar|interpersonal|engaging content|mobile responsiveness/i);
  });

  it("drops candidates the taxonomy already knows (alias- and plural-aware)", () => {
    expect(phrases).not.toContain("content management systems"); // CMS alias
    expect(phrases).not.toContain("search engine optimization"); // SEO alias
    expect(phrases).not.toContain("ada compliance"); // Accessibility alias
    expect(phrases).not.toContain("web content strategy"); // Content Strategy alias
    expect(phrases).not.toContain("proofreading"); // Editing alias
  });

  it("drops policy boilerplate and generic single words", () => {
    const joined = phrases.join(" | ");
    expect(joined).not.toMatch(/polic|board|criminal|background check|usg|www\./i);
    expect(phrases).not.toContain("content");
    expect(phrases).not.toContain("university");
  });

  it("strips trailing filler so the noun phrase is the candidate", () => {
    const withFiller = mineSkillPhrases(
      "Knowledge of chaos engineering best practices and experience with service mesh concepts.",
      TAXONOMY,
    ).map((m) => m.phrase.toLowerCase());
    expect(withFiller).toContain("chaos engineering");
    expect(withFiller).toContain("service mesh");
  });

  it("counts repeat mentions and is deterministic", () => {
    const twice = mineSkillPhrases(
      "Experience with chaos engineering required. Knowledge of chaos engineering preferred.",
      TAXONOMY,
    );
    expect(twice[0].phrase.toLowerCase()).toBe("chaos engineering");
    expect(twice[0].count).toBe(2);
    expect(mineSkillPhrases(HIGHERED_POSTING, TAXONOMY)).toEqual(mined);
  });

  it("handles empty input", () => {
    expect(mineSkillPhrases("", TAXONOMY)).toEqual([]);
  });
});
