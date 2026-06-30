// The bundled cover-letter template is the user-authored {{placeholder}} .docx
// (embedded as base64 in coverLetterTemplateBase64.js). It is a full-page letter
// that already uses the strategy's {{PLACEHOLDER}} vocabulary, so we load it
// verbatim (with pinned entry dates for deterministic output) and let the same
// scan -> keywords -> strategy -> fill pipeline as the résumé populate it.
//
// To change the wording or formatting, replace coverLetterTemplateBase64.js with
// a new base64-encoded .docx that uses the same {{PLACEHOLDER}} vocabulary.

import JSZip from "jszip";
import { FIXED_ENTRY_DATE } from "./docxModel.js";
import { COVER_LETTER_TEMPLATE_BASE64 } from "./coverLetterTemplateBase64.js";

const cache = new Map();

// The bundled template is authored as an adjunct-teaching letter. For a teaching
// posting we keep that framing (TEACHING_PATCHES); for an industry role the
// teaching paragraphs read as a mismatch ("support students", "rubrics",
// "students and courses"), so INDUSTRY_PATCHES rewrites the intro and the two
// teaching paragraphs into role-focused prose. Both share the same {{PLACEHOLDER}}
// vocabulary, so the same fill pipeline populates either variant.

// Applied to BOTH variants. Paragraph 2 (the current-role paragraph) always states
// that the candidate leads an engineering team of five — a standing fact that should
// surface in every letter regardless of posting or framing.
const SHARED_PATCHES = [
  [
    "In my current role at {{CURRENT_EMPLOYER}}, I lead {{INITIATIVE_TYPE}} initiatives",
    "In my current role at {{CURRENT_EMPLOYER}}, I lead an engineering team of five on {{INITIATIVE_TYPE}} initiatives",
  ],
];

// Small wording tweaks applied to the bundled template at load time, so we don't
// have to regenerate the whole opaque base64 for a phrasing change.
const TEACHING_PATCHES = [
  // Add a broad, posting-matched technical-skills sentence to the second
  // paragraph so EVERY tool/tech/method the posting names appears in the letter
  // (the short prose capability lines can't hold them all). ROLE_RELEVANT_STACK is
  // uncapped, so this line carries the full relevant stack.
  [
    "to {{ACTION_RESULT}} across {{DOMAIN_CAPABILITIES}}.",
    "to {{ACTION_RESULT}} across {{DOMAIN_CAPABILITIES}}. My technical toolkit for this kind of work spans {{ROLE_RELEVANT_STACK}}.",
  ],
  // Opening paragraph rewrite. The original third sentence was one run-on with
  // three comma-joined sub-lists (technical / domain / leadership capabilities)
  // plus a trailing teaching clause. Break it into separate sentences and keep the
  // soft-skills line as "experience in <soft skills>" (not "leadership in"). The
  // concrete adjunct figures (courses built/revamped, students per term) now live
  // in the intro sentence (see the "teaching as an adjunct professor" patch below).
  [
    "My background spans hands-on work with {{TECHNICAL_CAPABILITIES}}, domain expertise in {{DOMAIN_CAPABILITIES}}, and leadership in {{LEADERSHIP_CAPABILITIES}}, alongside the higher-education instruction that maps directly to this role.",
    "My background spans hands-on work with {{TECHNICAL_CAPABILITIES}}. I pair that with domain expertise in {{DOMAIN_CAPABILITIES}} and experience in {{LEADERSHIP_CAPABILITIES}}.",
  ],
  // Anchor the industry half of the intro sentence with concrete production
  // scale (kept as literals here so the letter can state exact daily figures).
  [
    "{{YEARS_OF_EXPERIENCE}}+ years in industry and several years teaching",
    "{{YEARS_OF_EXPERIENCE}}+ years in industry building systems that support 10,000 daily users and 75,000 daily service hits, and several years teaching",
  ],
  // Split the intro into two sentences: the credentials stand on their own
  // ("I am a …" gives the otherwise-subjectless "As a …" clause a main verb),
  // then the "I bring …" statement follows as its own sentence. The teaching half
  // sets its activities off with a comma and states them as two distinct actions
  // ("designing and revamping … courses and teaching … students") so the figures
  // are unambiguous — not the stacked "-ing" run or "courses for … students" that
  // read as if the courses were sized for the students.
  ["As a {{RANK}} {{PRIMARY_FUNCTION}} with", "I am a {{RANK}} {{PRIMARY_FUNCTION}} with"],
  [
    "several years teaching as an adjunct professor, I bring both genuine technical depth",
    "several years as an adjunct professor, designing and revamping eight project-based courses and teaching more than 100 students each term. I bring both genuine technical depth",
  ],
  // The opening paragraph now carries the headline teaching figures (courses
  // built, students per term), so soften paragraph 3 to keep the qualitative
  // feedback point without repeating "project-based courses" / the student count.
  ["building project-based courses around", "building hands-on courses around"],
  [
    "giving clear, constructive feedback to more than 100 students each term",
    "giving every student clear, constructive feedback",
  ],
  // Spell out contractions throughout for a more formal register. (Possessives
  // like "the team's" and "{{TARGET_ORGANIZATION}}'s" are left untouched.)
  ["I'm excited to apply", "I am excited to apply"],
  ["and it's work I genuinely enjoy", "and it is work I genuinely enjoy"],
  ["professor, I've taught", "professor, I have taught"],
  ["I'd be glad to support", "I would be glad to support"],
  ["I'm careful to apply", "I am careful to apply"],
  ["I'd welcome the chance", "I would welcome the chance"],
];

// For an industry (non-teaching) posting, rewrite the intro and the two teaching
// paragraphs into role-focused prose, drop the "support students / rubrics /
// students and courses" framing, and keep the same posting-matched technical
// toolkit sentence the teaching variant adds to paragraph 2. Targets the RAW
// template text (so these run instead of TEACHING_PATCHES, not after them).
const INDUSTRY_PATCHES = [
  // Same broad, posting-matched technical-skills sentence added to paragraph 2.
  [
    "to {{ACTION_RESULT}} across {{DOMAIN_CAPABILITIES}}.",
    "to {{ACTION_RESULT}} across {{DOMAIN_CAPABILITIES}}. My technical toolkit for this kind of work spans {{ROLE_RELEVANT_STACK}}.",
  ],
  // Intro: lead with industry scale and a shipping track record instead of the
  // "several years teaching … enthusiasm for helping students learn" framing.
  [
    "As a {{RANK}} {{PRIMARY_FUNCTION}} with {{YEARS_OF_EXPERIENCE}}+ years in industry and several years teaching as an adjunct professor, I bring both genuine technical depth and a real enthusiasm for helping students learn. My background spans hands-on work with {{TECHNICAL_CAPABILITIES}}, domain expertise in {{DOMAIN_CAPABILITIES}}, and leadership in {{LEADERSHIP_CAPABILITIES}}, alongside the higher-education instruction that maps directly to this role.",
    "I am a {{RANK}} {{PRIMARY_FUNCTION}} with {{YEARS_OF_EXPERIENCE}}+ years building systems that support 10,000 daily users and 75,000 daily service hits. I bring genuine technical depth and a track record of shipping production-quality software that teams depend on. My background spans hands-on work with {{TECHNICAL_CAPABILITIES}}. I pair that with domain expertise in {{DOMAIN_CAPABILITIES}} and experience in {{LEADERSHIP_CAPABILITIES}}.",
  ],
  // Replace the teaching paragraph with a craft / ownership paragraph (treats
  // shared systems as a product; names paying down technical debt explicitly).
  [
    "I also teach, and it's work I genuinely enjoy. As an adjunct professor, I've taught {{AREA_OF_EMPHASIS}} and {{AREA_OF_EMPHASIS}}, building project-based courses around {{LIST OF 4 COURSE TOPICS RELEVANT TO JOB POSTING - PRIORITIZE TECHNOLOGIES, PEOPLE SKILLS}} and giving clear, constructive feedback to more than 100 students each term. Those terms taught me how to explain complex technical concepts simply, assess student work fairly and consistently, and meet learners wherever they are.",
    "Beyond shipping features, I care about the work that makes an entire team faster: {{AREAS_OF_EMPHASIS}}. I treat shared systems and standards as a product — building reusable building blocks, paying down technical debt before it slows delivery, and holding a high bar for quality and consistency so teams can move quickly without breaking things. I rely on {{DELIVERY_PRACTICES}} to keep that work disciplined, partnering closely with {{SCOPE_OR_STAKEHOLDERS}} to turn requirements into reliable production software.",
  ],
  // Replace the "mix of industry and classroom / support students" paragraph.
  [
    "That mix of industry and classroom is exactly what draws me to {{TARGET_ORGANIZATION}}. I'd be glad to support students across {{AREAS_OF_EMPHASIS}}, pairing that subject-matter depth with strengths in {{LEADERSHIP_CAPABILITIES}} to give timely, useful feedback while working closely with the instructional team. I'm careful to apply rubrics consistently, keep feedback objective and value-neutral, and meet the team's turnaround times.",
    "{{TARGET_ORGANIZATION}}'s work is exactly the kind of problem I want to help build. I would bring that same focus on {{AREAS_OF_EMPHASIS}}, pairing technical depth with strengths in {{LEADERSHIP_CAPABILITIES}} to align teams, resolve ambiguity early, and keep the group shipping consistent, high-quality work.",
  ],
  // Closing: drop "higher-education instruction" and "students and courses".
  [
    "I'd welcome the chance to talk about how my experience across {{DOMAIN_CAPABILITIES}} and higher-education instruction could support {{TARGET_ORGANIZATION}}'s students and courses. Thank you for your time and consideration.",
    "I would welcome the chance to talk about how my experience across {{DOMAIN_CAPABILITIES}} could help {{TARGET_ORGANIZATION}} build and scale the software your team is investing in. Thank you for your time and consideration.",
  ],
  // Formality: the only contraction left in the industry variant is the opening.
  ["I'm excited to apply", "I am excited to apply"],
];

// Assemble (and cache per variant) the cover-letter template as a Node Buffer for
// loadDocx(), with every zip entry's timestamp pinned so the output base64 is
// deterministic. `teaching` (default true) selects the framing: the bundled
// adjunct-teaching letter, or the industry rewrite for a non-teaching posting.
export async function getCoverLetterTemplateBuffer({ teaching = true } = {}) {
  const key = teaching ? "teaching" : "industry";
  const cached = cache.get(key);
  if (cached) return cached;
  const zip = await JSZip.loadAsync(Buffer.from(COVER_LETTER_TEMPLATE_BASE64, "base64"));
  const docFile = zip.file("word/document.xml");
  if (docFile) {
    let xml = await docFile.async("string");
    for (const [from, to] of [...SHARED_PATCHES, ...(teaching ? TEACHING_PATCHES : INDUSTRY_PATCHES)]) {
      xml = xml.split(from).join(to);
    }
    zip.file("word/document.xml", xml, { date: FIXED_ENTRY_DATE });
  }
  for (const file of Object.values(zip.files)) file.date = FIXED_ENTRY_DATE;
  const buffer = await zip.generateAsync({ type: "nodebuffer" });
  cache.set(key, buffer);
  return buffer;
}
