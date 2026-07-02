// Noise filter for posting topic phrases. RAKE happily extracts hiring
// boilerplate ("criminal background check demonstrating eligibility"), policy
// references ("usg board policy 8.2.18.1.2"), and URLs from real postings —
// none of which is vocabulary worth suggesting for the tailoring library or
// counting as a coverage gap. Skills are short noun phrases; this rejects
// everything that clearly isn't one.

const URLISH_RE = /(?:https?:|www\.|\.(?:com|edu|org|gov|net|io)\b|@)/i;

// Section/statute-style references: "8.2.18.1.2", "section 6", "c2653", "p8.2".
const SECTION_REF_RE = /\b[a-z]?\d+(?:\.\d+)+\b|\bsection\s*\d|\bc\d{3,}\b|\bp\d+\.\d/i;

// Hiring-process and institutional boilerplate that appears in most postings
// but describes the process or the org, never a skill.
const BOILERPLATE_RE =
  /\b(?:polic(?:y|ies)|policymanual|board of regents|board polic\w*|criminal background|background (?:check|investigation)|equal (?:opportunity|employment)|affirmative action|cover letter|letter of (?:application|interest|recommendation)|drug screen(?:ing)?|credit check|veterans? status|review of applications?|employment (?:history|verification)|start date|salary (?:range|band)|benefits? package|core values|code of conduct|freedom of expression|human resources|job (?:id|code|posting|announcement)|applicants?|successful candidate|spot.?check\w*|conditions of employment|supervisory controls|physical demands|work environment|references upon request)\b/i;

// Real skill phrases are 1-4 words; longer RAKE output is sentence shrapnel.
const MAX_WORDS = 4;

export function isNoiseTopic(phrase) {
  const p = String(phrase || "").trim();
  if (!p) return true;
  if (p.split(/\s+/).length > MAX_WORDS) return true;
  return URLISH_RE.test(p) || SECTION_REF_RE.test(p) || BOILERPLATE_RE.test(p);
}
