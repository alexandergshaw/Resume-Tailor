// The bundled default résumé template IS the owner's real Resume.docx (embedded
// as base64 in resumeTemplateBase64.js). At load time we templatize ONLY the
// Skills section — turning its five heading paragraphs into {{SKILLS_HEADING}}
// slots and its five row paragraphs into {{SKILLS_LINE}} slots — so the engine
// can reorder the skill blocks (and the skills within each row) toward the
// posting via SKILLS_DISTRIBUTE. Every other paragraph (name, contact, summary,
// education, experience, projects) is left byte-exact, and run formatting on the
// templatized paragraphs is preserved (bold headings stay bold).
//
// Experience bullets and Projects are NOT templatized yet (verbatim for now).
// To use a different résumé, replace resumeTemplateBase64.js.

import JSZip from "jszip";
import { FIXED_ENTRY_DATE } from "./docxModel.js";
import { RESUME_TEMPLATE_BASE64 } from "./resumeTemplateBase64.js";

const PARAGRAPH_RE = /<w:p\b[^>]*>[\s\S]*?<\/w:p>/g;

function paragraphText(block) {
  return (block.match(/<w:t[^>]*>([\s\S]*?)<\/w:t>/g) || [])
    .map((t) => t.replace(/<[^>]+>/g, ""))
    .join("");
}

// Set a paragraph's visible text to `text`: write it into the first run's <w:t>
// (keeping that run's formatting) and blank any other <w:t> runs.
function setParagraphText(block, text) {
  let first = true;
  return block.replace(/(<w:t\b[^>]*>)[\s\S]*?(<\/w:t>)/g, (_m, open, close) => {
    if (first) {
      first = false;
      return `${open}${text}${close}`;
    }
    return `${open}${close}`;
  });
}

// Turn the Skills section's heading/row paragraphs into slots. Headings are the
// bold paragraphs; rows are the non-bold ones. No-op if "Skills" isn't found.
function templatizeSkills(documentXml) {
  const paragraphs = documentXml.match(PARAGRAPH_RE) || [];
  const skillsIdx = paragraphs.findIndex(
    (b) => /w:val="Heading3"/.test(b) && paragraphText(b).trim() === "Skills",
  );
  if (skillsIdx === -1) return documentXml;

  let i = -1;
  return documentXml.replace(PARAGRAPH_RE, (block) => {
    i += 1;
    if (i <= skillsIdx) return block;
    const isHeading = /<w:b w:val="1"\/>/.test(block);
    return setParagraphText(block, isHeading ? "{{SKILLS_HEADING}}" : "{{SKILLS_LINE}}");
  });
}

let cache = null;

// Assemble (once) the template as a Node Buffer ready for loadDocx(), with the
// Skills section templatized and entry dates pinned for deterministic output.
export async function getDefaultTemplateBuffer() {
  if (cache) return cache;
  const zip = await JSZip.loadAsync(Buffer.from(RESUME_TEMPLATE_BASE64, "base64"));
  const documentXml = await zip.file("word/document.xml").async("string");
  zip.file("word/document.xml", templatizeSkills(documentXml), { date: FIXED_ENTRY_DATE });
  for (const file of Object.values(zip.files)) file.date = FIXED_ENTRY_DATE;
  cache = await zip.generateAsync({ type: "nodebuffer" });
  return cache;
}
