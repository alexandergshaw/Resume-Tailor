// The bundled default résumé template IS the owner's real Resume.docx (embedded
// as base64 in resumeTemplateBase64.js). At load time we templatize the sections
// the engine tailors, leaving everything else byte-exact (run formatting on
// templatized paragraphs is preserved):
//   - Skills: five {{SKILLS_HEADING}} + five {{SKILLS_LINE}} slots, reordered by
//     posting relevance via SKILLS_DISTRIBUTE.
//   - Experience: each bullet -> {{EXP_<jobIndex>_BULLET}}, filled per job by
//     LIBRARY_MATCH so a job's own bullets reorder toward the posting (never
//     across employers). Job titles/companies/dates stay verbatim.
// Name, contact, summary, education and Projects are left byte-exact (Projects
// is next). To use a different résumé, replace resumeTemplateBase64.js.

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

// Templatize the Professional Experience section per job (jobIndex increments at
// each bold job-title line):
//   - each bullet -> {{EXP_<jobIndex>_BULLET}} (LIBRARY_MATCH reorders/selects a
//     job's own bullets; never moves a bullet to a different employer)
//   - the job-title text -> {{JOB_<jobIndex>_TITLE}}, KEEPING " | Company | Date"
//     verbatim, so LIBRARY_MATCH can pick the most posting-relevant title variant
// No-op if the section isn't found.
function templatizeExperience(documentXml) {
  const paragraphs = documentXml.match(PARAGRAPH_RE) || [];
  const startIdx = paragraphs.findIndex(
    (b) => /w:val="Heading3"/.test(b) && paragraphText(b).trim() === "Professional Experience",
  );
  if (startIdx === -1) return documentXml;
  const endIdx = paragraphs.findIndex((b, idx) => idx > startIdx && /w:val="Heading3"/.test(b));

  let i = -1;
  let jobIndex = -1;
  return documentXml.replace(PARAGRAPH_RE, (block) => {
    i += 1;
    if (i <= startIdx) return block;
    if (endIdx !== -1 && i >= endIdx) return block;
    if (/<w:numPr>/.test(block)) {
      return setParagraphText(block, `{{EXP_${jobIndex}_BULLET}}`);
    }
    if (/<w:b w:val="1"\/>/.test(block)) {
      jobIndex += 1; // a job-title line
      const text = paragraphText(block);
      const sep = text.indexOf(" | ");
      if (sep !== -1) {
        return setParagraphText(block, `{{JOB_${jobIndex}_TITLE}}${text.slice(sep)}`);
      }
    }
    return block;
  });
}

let cache = null;

// Assemble (once) the template as a Node Buffer ready for loadDocx(), with the
// Skills section templatized and entry dates pinned for deterministic output.
export async function getDefaultTemplateBuffer() {
  if (cache) return cache;
  const zip = await JSZip.loadAsync(Buffer.from(RESUME_TEMPLATE_BASE64, "base64"));
  const documentXml = await zip.file("word/document.xml").async("string");
  const templatized = templatizeExperience(templatizeSkills(documentXml));
  zip.file("word/document.xml", templatized, { date: FIXED_ENTRY_DATE });
  for (const file of Object.values(zip.files)) file.date = FIXED_ENTRY_DATE;
  cache = await zip.generateAsync({ type: "nodebuffer" });
  return cache;
}
