// The bundled default cover-letter template, filled by the same deterministic
// pipeline as the résumé (scan -> keywords -> strategy -> fill). Profile values
// populate the writer's details; keyword-join slots reflect the posting; and
// {{TARGET_ROLE}} / {{TARGET_ORGANIZATION}} are seeded from the job title /
// company passed to tailorCoverLetter (see engine.js). Editable here.

import { buildDocumentXml, buildDocxBuffer } from "./docxPackage.js";

const PARAGRAPHS = [
  { text: "{{FULL_NAME}}", bold: true, size: 28 },
  { text: "" },
  { text: "Dear Hiring Team at {{TARGET_ORGANIZATION}}," },
  { text: "" },
  {
    text:
      "I am writing to express my interest in the {{TARGET_ROLE}} role at {{TARGET_ORGANIZATION}}. As a {{RANK}} {{PRIMARY_FUNCTION}} with {{YEARS_OF_EXPERIENCE}} years of experience at {{CURRENT_EMPLOYER}}, I specialize in {{SPECIALIZATION}} and would bring that focus to your team.",
  },
  { text: "" },
  {
    text:
      "Your posting emphasizes {{JOB_RELEVANT_TECHNOLOGIES}} — areas where I have delivered hands-on results. I pair that technical depth with strengths in {{LEADERSHIP_CAPABILITIES}} and a delivery approach grounded in {{DELIVERY_PRACTICES}}.",
  },
  { text: "" },
  {
    text:
      "I would welcome the opportunity to discuss how my background in {{SPECIALIZATION}} can support {{TARGET_ORGANIZATION}}'s goals. Thank you for your time and consideration.",
  },
  { text: "" },
  { text: "Sincerely," },
  { text: "{{FULL_NAME}}" },
];

const DOCUMENT_XML = buildDocumentXml(PARAGRAPHS);

let cache = null;

// Assemble (once) the cover-letter template as a Node Buffer for loadDocx().
export async function getCoverLetterTemplateBuffer() {
  if (!cache) cache = await buildDocxBuffer(DOCUMENT_XML);
  return cache;
}

export { DOCUMENT_XML as COVER_LETTER_DOCUMENT_XML };
