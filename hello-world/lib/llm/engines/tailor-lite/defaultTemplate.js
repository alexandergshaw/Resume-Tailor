// The bundled default résumé template. The embedded engine fills ITS OWN
// template (it never receives the user's uploaded .docx — the route passes only
// extracted text, exactly like the external engine), so the template lives here
// as controlled OOXML. Keeping it as a single source of truth (rather than a
// committed binary that can drift) means editing the layout/placeholders is a
// code change in this one file, and the .docx bytes are assembled on demand.
//
// Placeholders use {{UPPER_SNAKE_CASE}}; one {Title Case} single-brace token is
// included to exercise that path. Repeated {{SKILLS_LINE}} get occurrence-keyed
// values (one skills category each), and accomplishment slots draw from the
// content library.

import { buildDocumentXml, buildDocxBuffer } from "./docxPackage.js";

const PARAGRAPHS = [
  { text: "{{FULL_NAME}}", bold: true, size: 36 },
  { text: "{{RANK}} {{PRIMARY_FUNCTION}} · {{YEARS_OF_EXPERIENCE}} years · {{CURRENT_EMPLOYER}}", size: 20, color: "555555" },
  { text: "Summary", bold: true, size: 24 },
  { text: "{{SPECIALIZATION}} specialist focused on {{AREA_OF_EMPHASIS}}." },
  { text: "Core Skills", bold: true, size: 24 },
  { text: "{{SKILLS_LINE}}" },
  { text: "{{SKILLS_LINE}}" },
  { text: "{{SKILLS_LINE}}" },
  { text: "{{SKILLS_LINE}}" },
  { text: "{{SKILLS_LINE}}" },
  { text: "Technologies: {{JOB_RELEVANT_TECHNOLOGIES}}" },
  { text: "Capabilities: {{TECHNICAL_CAPABILITIES}}" },
  { text: "Delivery practices: {{DELIVERY_PRACTICES}}" },
  { text: "Domains: {{DOMAIN_CAPABILITIES}}" },
  { text: "Leadership: {{LEADERSHIP_CAPABILITIES}}" },
  { text: "Experience", bold: true, size: 24 },
  { text: "{{CURRENT_EMPLOYER}} — {{RANK}} {{PRIMARY_FUNCTION}}", bold: true },
  { text: "• {{ACTION_RESULT}}" },
  { text: "• Delivered {{SOLUTION_DELIVERED}} achieving {{MEASURABLE_IMPACT}}." },
  { text: "• Owned {{SCOPE_OF_OWNERSHIP}} across {{PROJECT_TYPE}}." },
  { text: "• {{ACTION_RESULT}}" },
  { text: "• Drove {{MEASURABLE_IMPACT}} on {{PROJECT_TYPE}}." },
  { text: "Education", bold: true, size: 24 },
  { text: "Relevant coursework: {{COURSE_TOPICS_4}}" },
  { text: "Concentration: {Area of Emphasis}" },
];

const DOCUMENT_XML = buildDocumentXml(PARAGRAPHS);

let cache = null;

// Assemble (once) the default template as a Node Buffer ready for loadDocx().
export async function getDefaultTemplateBuffer() {
  if (!cache) cache = await buildDocxBuffer(DOCUMENT_XML);
  return cache;
}

export { DOCUMENT_XML as DEFAULT_DOCUMENT_XML };
