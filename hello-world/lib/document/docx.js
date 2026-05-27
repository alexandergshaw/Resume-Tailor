// DOCX template parsing, line fitting, and download helpers. Pure helpers are
// exported directly; the three download wrappers that need component state
// are exposed through `createDocumentDownloaders(deps)`.

import JSZip from "jszip";
import { createClient } from "../supabase/client";

export const WORDPROCESSINGML_NS =
  "http://schemas.openxmlformats.org/wordprocessingml/2006/main";

export function sanitizeFileNamePart(value) {
  return value
    .replace(/[\\/:*?"<>|]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

export function getDownloadFileNameForTitle(jobTitle, company) {
  const cleanedTitle = sanitizeFileNamePart(jobTitle || "").slice(0, 90);
  const cleanedCompany = sanitizeFileNamePart(company || "").slice(0, 60);
  const titlePart = cleanedTitle || "Target Role";
  return cleanedCompany
    ? `Resume - ${cleanedCompany} - ${titlePart}.docx`
    : `Resume - ${titlePart}.docx`;
}

export function getDownloadCoverLetterFileNameForTitle(jobTitle, company) {
  const cleanedTitle = sanitizeFileNamePart(jobTitle || "").slice(0, 90);
  const cleanedCompany = sanitizeFileNamePart(company || "").slice(0, 60);
  const titlePart = cleanedTitle || "Target Role";
  return cleanedCompany
    ? `Cover Letter - ${cleanedCompany} - ${titlePart}.docx`
    : `Cover Letter - ${titlePart}.docx`;
}

export function isDocxResume(file) {
  return file?.name?.toLowerCase().endsWith(".docx");
}

export function isTextResume(file) {
  const lowerName = file?.name?.toLowerCase() || "";
  return [".txt", ".md", ".markdown"].some((extension) =>
    lowerName.endsWith(extension),
  );
}

export function normalizeResultLines(text) {
  return text
    .replace(/\r\n/g, "\n")
    .split("\n")
    .map((line) => line.trimEnd());
}

export function getDirectChildrenByTag(parentNode, localTagName) {
  return Array.from(parentNode.childNodes).filter(
    (node) =>
      node.nodeType === Node.ELEMENT_NODE &&
      node.localName === localTagName &&
      node.namespaceURI === WORDPROCESSINGML_NS,
  );
}

export function getParagraphPlainText(paragraphNode) {
  const textNodes = paragraphNode.getElementsByTagNameNS(
    WORDPROCESSINGML_NS,
    "t",
  );

  return Array.from(textNodes)
    .map((node) => node.textContent || "")
    .join("");
}

export function fitLinesToTemplate(lines, targetCount) {
  if (targetCount <= 0) {
    return [];
  }

  if (lines.length === 0) {
    return new Array(targetCount).fill("");
  }

  if (lines.length <= targetCount) {
    return [...lines, ...new Array(targetCount - lines.length).fill("")];
  }

  const head = lines.slice(0, targetCount - 1);
  const tail = lines.slice(targetCount - 1).join(" ").replace(/\s+/g, " ").trim();
  return [...head, tail];
}

export async function extractTemplateLinesFromDocx(file) {
  const zip = await JSZip.loadAsync(await file.arrayBuffer());
  const documentXmlPath = "word/document.xml";
  const xmlContent = await zip.file(documentXmlPath)?.async("string");

  if (!xmlContent) {
    throw new Error("Unable to read DOCX template content.");
  }

  const parser = new DOMParser();
  const xmlDoc = parser.parseFromString(xmlContent, "application/xml");
  const bodyNode = xmlDoc.getElementsByTagNameNS(WORDPROCESSINGML_NS, "body")[0];

  if (!bodyNode) {
    throw new Error("Uploaded DOCX template is missing body content.");
  }

  const existingParagraphs = getDirectChildrenByTag(bodyNode, "p");
  const editableParagraphs = existingParagraphs.filter(
    (paragraphNode) => getParagraphPlainText(paragraphNode).length > 0,
  );

  return editableParagraphs.map((paragraphNode) => getParagraphPlainText(paragraphNode));
}

export async function buildTemplateLinesForUpload(file) {
  if (isDocxResume(file)) {
    return extractTemplateLinesFromDocx(file);
  }

  if (isTextResume(file)) {
    const text = await file.text();
    return normalizeResultLines(text).filter((line) => line.trim().length > 0);
  }

  return [];
}

export function setParagraphText(paragraphNode, value, xmlDoc) {
  const textNodes = paragraphNode.getElementsByTagNameNS(
    WORDPROCESSINGML_NS,
    "t",
  );

  if (textNodes.length > 0) {
    const currentLengths = Array.from(textNodes).map(
      (node) => (node.textContent || "").length,
    );
    const totalLength = currentLengths.reduce((sum, length) => sum + length, 0);
    const fallbackLength = Math.max(1, Math.ceil((value || "").length / textNodes.length));
    const effectiveLengths = currentLengths.map((length) =>
      length > 0 ? length : fallbackLength,
    );
    const effectiveTotal =
      totalLength > 0
        ? totalLength
        : effectiveLengths.reduce((sum, length) => sum + length, 0);

    let cursor = 0;

    for (let index = 0; index < textNodes.length; index += 1) {
      const isLast = index === textNodes.length - 1;
      const sliceLength = isLast
        ? Math.max(0, (value || "").length - cursor)
        : Math.max(
            0,
            Math.round(((value || "").length * effectiveLengths[index]) / effectiveTotal),
          );
      const nextCursor = Math.min((value || "").length, cursor + sliceLength);
      const chunk = (value || "").slice(cursor, nextCursor);

      textNodes[index].textContent = chunk;

      if (chunk.startsWith(" ") || chunk.endsWith(" ")) {
        textNodes[index].setAttribute("xml:space", "preserve");
      } else {
        textNodes[index].removeAttribute("xml:space");
      }

      cursor = nextCursor;
    }

    if (cursor < (value || "").length) {
      const lastNode = textNodes[textNodes.length - 1];
      const tail = (value || "").slice(cursor);
      lastNode.textContent = `${lastNode.textContent || ""}${tail}`;
    }

    return;
  }

  const runNode = xmlDoc.createElementNS(WORDPROCESSINGML_NS, "w:r");
  const textNode = xmlDoc.createElementNS(WORDPROCESSINGML_NS, "w:t");
  textNode.textContent = value || "";
  runNode.appendChild(textNode);
  paragraphNode.appendChild(runNode);
}

export async function buildDocxFromUploadedTemplate(file, generatedText, generatedLines = []) {
  const zip = await JSZip.loadAsync(await file.arrayBuffer());
  const documentXmlPath = "word/document.xml";
  const xmlContent = await zip.file(documentXmlPath)?.async("string");

  if (!xmlContent) {
    throw new Error("Unable to read DOCX template content.");
  }

  const parser = new DOMParser();
  const xmlDoc = parser.parseFromString(xmlContent, "application/xml");
  const bodyNode = xmlDoc.getElementsByTagNameNS(WORDPROCESSINGML_NS, "body")[0];

  if (!bodyNode) {
    throw new Error("Uploaded DOCX template is missing body content.");
  }

  const lines =
    generatedLines.length > 0 ? generatedLines : normalizeResultLines(generatedText);
  const existingParagraphs = getDirectChildrenByTag(bodyNode, "p");

  if (existingParagraphs.length === 0) {
    throw new Error("Uploaded DOCX template has no editable paragraphs.");
  }

  const editableParagraphs = existingParagraphs.filter(
    (paragraphNode) => getParagraphPlainText(paragraphNode).length > 0,
  );

  if (editableParagraphs.length === 0) {
    throw new Error("Uploaded DOCX template has no text paragraphs to update.");
  }

  const fittedLines = fitLinesToTemplate(lines, editableParagraphs.length);

  editableParagraphs.forEach((paragraphNode, index) => {
    setParagraphText(paragraphNode, fittedLines[index] || "", xmlDoc);
  });

  const serializedXml = new XMLSerializer().serializeToString(xmlDoc);
  zip.file(documentXmlPath, serializedXml);

  return zip.generateAsync({
    type: "blob",
    mimeType:
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
  });
}

export function createDocumentDownloaders(deps) {
  const { resumeFile, coverLetterFile, tailoringMap, applicationData } = deps;

  async function downloadDocxFiles({
    jobTitle,
    company,
    result,
    resultLines,
    coverLetterResultLines,
  }) {
    if (!result?.trim()) return "Nothing to download yet.";
    if (!isDocxResume(resumeFile)) return "Upload the source resume as .docx to download.";

    try {
      const blob = await buildDocxFromUploadedTemplate(resumeFile, result, resultLines);
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = getDownloadFileNameForTitle(jobTitle, company);
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);

      if (
        coverLetterFile &&
        isDocxResume(coverLetterFile) &&
        Array.isArray(coverLetterResultLines) &&
        coverLetterResultLines.length > 0
      ) {
        const clBlob = await buildDocxFromUploadedTemplate(
          coverLetterFile,
          coverLetterResultLines.join("\n"),
          coverLetterResultLines,
        );
        const clUrl = URL.createObjectURL(clBlob);
        const clLink = document.createElement("a");
        clLink.href = clUrl;
        clLink.download = getDownloadCoverLetterFileNameForTitle(jobTitle, company);
        document.body.appendChild(clLink);
        clLink.click();
        clLink.remove();
        URL.revokeObjectURL(clUrl);
      }
      return null;
    } catch (err) {
      return err.message || "Unable to download DOCX.";
    }
  }

  // Re-download a previously generated auto-tailored resume from Supabase by
  // its application row. Pulls generated_resumes.content/content_lines for
  // the linked resume_used_id and renders it through the user's uploaded
  // resume template. Returns null on success, or an error message string.
  async function downloadAutoTailoredResume(row) {
    if (!row?.resume_used_id) return "No generated resume linked to this posting.";
    if (!isDocxResume(resumeFile)) return "Upload your source resume as .docx first.";
    try {
      const supabase = createClient();
      const { data: gen, error } = await supabase
        .from("generated_resumes")
        .select("content, content_lines")
        .eq("id", row.resume_used_id)
        .maybeSingle();
      if (error) return error.message || "Unable to load generated resume.";
      if (!gen) return "Generated resume not found.";
      const lines = Array.isArray(gen.content_lines) ? gen.content_lines : [];
      const text = typeof gen.content === "string" ? gen.content : lines.join("\n");
      return await downloadDocxFiles({
        jobTitle: row.positions?.title,
        company: row.positions?.company,
        result: text,
        resultLines: lines,
        coverLetterResultLines: [],
      });
    } catch (err) {
      return err.message || "Unable to download.";
    }
  }

  // Download the tailored resume for a tracked job (chip in the floating
  // status bar). Prefers the in-memory tailoring result, otherwise falls back
  // to the saved generated_resumes row attached to the application that was
  // loaded for this position. Fire-and-forget: returns null on success or an
  // error message string. Errors are logged but not surfaced (the chip's
  // posting link should still open even if the download can't run).
  async function downloadResumeForChipJob(job) {
    if (!job) return "No job.";
    if (!isDocxResume(resumeFile)) return "Upload your source resume as .docx first.";

    const tailoring = tailoringMap[job.id] || {};
    let text = typeof tailoring.result === "string" ? tailoring.result : "";
    let lines = Array.isArray(tailoring.resultLines) ? tailoring.resultLines : [];
    let coverLines = Array.isArray(tailoring.coverLetterResultLines)
      ? tailoring.coverLetterResultLines
      : [];
    let jobTitle = tailoring.generatedJobTitle || job.title || "";
    let company = job.company || "";

    if (!text) {
      // Fall back to the saved application row (post-reload case).
      const app = (applicationData || []).find(
        (a) => String(a?.positions?.external_id || "") === String(job.id),
      );
      const gen = app?.generated_resumes;
      if (!gen?.content) return "No saved resume found for this posting.";
      text = gen.content;
      lines = Array.isArray(gen.content_lines) ? gen.content_lines : [];
      jobTitle = jobTitle || app?.positions?.title || "";
      company = company || app?.positions?.company || "";
    }

    return await downloadDocxFiles({
      jobTitle,
      company,
      result: text,
      resultLines: lines,
      coverLetterResultLines: coverLines,
    });
  }

  return { downloadDocxFiles, downloadAutoTailoredResume, downloadResumeForChipJob };
}
