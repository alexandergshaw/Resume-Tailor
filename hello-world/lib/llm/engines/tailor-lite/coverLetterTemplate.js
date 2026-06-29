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

let cache = null;

// Small wording tweaks applied to the bundled template at load time, so we don't
// have to regenerate the whole opaque base64 for a phrasing change.
const TEMPLATE_TEXT_PATCHES = [
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

// Assemble (once) the cover-letter template as a Node Buffer for loadDocx(),
// with every zip entry's timestamp pinned so the output base64 is deterministic.
export async function getCoverLetterTemplateBuffer() {
  if (cache) return cache;
  const zip = await JSZip.loadAsync(Buffer.from(COVER_LETTER_TEMPLATE_BASE64, "base64"));
  const docFile = zip.file("word/document.xml");
  if (docFile) {
    let xml = await docFile.async("string");
    for (const [from, to] of TEMPLATE_TEXT_PATCHES) xml = xml.split(from).join(to);
    zip.file("word/document.xml", xml, { date: FIXED_ENTRY_DATE });
  }
  for (const file of Object.values(zip.files)) file.date = FIXED_ENTRY_DATE;
  cache = await zip.generateAsync({ type: "nodebuffer" });
  return cache;
}
