"use client";

import { useState } from "react";
import JSZip from "jszip";
import styles from "./page.module.css";

const WORDPROCESSINGML_NS =
  "http://schemas.openxmlformats.org/wordprocessingml/2006/main";

export default function Home() {
  const [jobPosting, setJobPosting] = useState("");
  const [resumeFile, setResumeFile] = useState(null);
  const [result, setResult] = useState("");
  const [resultLines, setResultLines] = useState([]);
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [hasCompletedCall, setHasCompletedCall] = useState(false);
  const [isDownloading, setIsDownloading] = useState(false);

  function sanitizeFileNamePart(value) {
    return value
      .replace(/[\\/:*?"<>|]/g, "")
      .replace(/\s+/g, " ")
      .trim();
  }

  function cleanTitleCandidate(value) {
    return value
      .replace(/^[:\-\s]+/, "")
      .replace(/\s*\((remote|hybrid|onsite|on-site)\)\s*$/i, "")
      .replace(/\s+[\-|\|]\s+.+$/, "")
      .replace(/\s{2,}/g, " ")
      .trim();
  }

  function scoreTitleCandidate(candidate, lineIndex) {
    const lowered = candidate.toLowerCase();
    const words = candidate.split(/\s+/).filter(Boolean);
    const roleKeywords = [
      "engineer",
      "developer",
      "manager",
      "director",
      "analyst",
      "scientist",
      "specialist",
      "architect",
      "consultant",
      "designer",
      "lead",
      "principal",
      "coordinator",
      "administrator",
      "officer",
      "associate",
      "recruiter",
      "product",
      "project",
      "program",
      "marketing",
      "sales",
      "account",
      "operations",
      "customer",
      "qa",
      "devops",
      "security",
      "data",
      "full stack",
      "frontend",
      "backend",
    ];
    const bannedKeywords = [
      "responsibilities",
      "requirements",
      "qualifications",
      "benefits",
      "about",
      "company",
      "summary",
      "overview",
      "description",
      "salary",
      "compensation",
      "location",
      "experience",
      "years",
    ];

    let score = 0;

    if (words.length >= 2 && words.length <= 8) {
      score += 3;
    }

    if (roleKeywords.some((keyword) => lowered.includes(keyword))) {
      score += 7;
    }

    if (/^[A-Z][A-Za-z0-9+&/\-\s(),.]*$/.test(candidate)) {
      score += 2;
    }

    if (lineIndex >= 0) {
      score += Math.max(0, 5 - Math.floor(lineIndex / 4));
    }

    if (bannedKeywords.some((keyword) => lowered.includes(keyword))) {
      score -= 8;
    }

    if (candidate.length > 80 || candidate.length < 3) {
      score -= 5;
    }

    return score;
  }

  function inferJobTitleFromPosting(posting) {
    const lines = posting
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean);
    const maxLinesToInspect = Math.min(lines.length, 80);
    const candidates = [];

    function addCandidate(rawValue, lineIndex = -1, bonus = 0) {
      const cleaned = cleanTitleCandidate(rawValue || "");

      if (!cleaned) {
        return;
      }

      candidates.push({
        value: cleaned,
        score: scoreTitleCandidate(cleaned, lineIndex) + bonus,
      });
    }

    const labeledPattern =
      /^(job title|title|role|position|opening|opportunity)\s*[:\-]\s*(.+)$/i;
    const phrasePattern =
      /(?:hiring|seeking|looking for|position(?:\s+is)?|role(?:\s+is)?|opening(?:\s+for)?|join us as)\s+(?:an?\s+)?([A-Z][A-Za-z0-9+&/\-\s(),]{2,80})/i;

    for (let index = 0; index < maxLinesToInspect; index += 1) {
      const line = lines[index];
      const labeledMatch = line.match(labeledPattern);

      if (labeledMatch?.[2]) {
        addCandidate(labeledMatch[2], index, 12);
      }

      const phraseMatch = line.match(phrasePattern);
      if (phraseMatch?.[1]) {
        addCandidate(phraseMatch[1], index, 9);
      }

      const segmentedParts = line.split(/\s*[|\u2022]\s*|\s+-\s+|\s+@\s+|\s+at\s+/i);
      segmentedParts.forEach((part) => addCandidate(part, index));
    }

    if (candidates.length === 0) {
      const fallback = lines[0] || "Target Role";
      return sanitizeFileNamePart(cleanTitleCandidate(fallback)) || "Target Role";
    }

    candidates.sort((left, right) => right.score - left.score);
    const best = candidates[0].value;

    return sanitizeFileNamePart(best).slice(0, 90) || "Target Role";
  }

  function getDownloadFileName() {
    const inferredTitle = inferJobTitleFromPosting(jobPosting) || "Target Role";
    return `Resume - ${inferredTitle}.docx`;
  }

  function isDocxResume(file) {
    return file?.name?.toLowerCase().endsWith(".docx");
  }

  function isTextResume(file) {
    const lowerName = file?.name?.toLowerCase() || "";
    return [".txt", ".md", ".markdown"].some((extension) =>
      lowerName.endsWith(extension),
    );
  }

  function normalizeResultLines(text) {
    return text
      .replace(/\r\n/g, "\n")
      .split("\n")
      .map((line) => line.trimEnd());
  }

  function getDirectChildrenByTag(parentNode, localTagName) {
    return Array.from(parentNode.childNodes).filter(
      (node) =>
        node.nodeType === Node.ELEMENT_NODE &&
        node.localName === localTagName &&
        node.namespaceURI === WORDPROCESSINGML_NS,
    );
  }

  function getParagraphPlainText(paragraphNode) {
    const textNodes = paragraphNode.getElementsByTagNameNS(
      WORDPROCESSINGML_NS,
      "t",
    );

    return Array.from(textNodes)
      .map((node) => node.textContent || "")
      .join("");
  }

  function fitLinesToTemplate(lines, targetCount) {
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

  async function extractTemplateLinesFromDocx(file) {
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

  async function buildTemplateLinesForUpload(file) {
    if (isDocxResume(file)) {
      return extractTemplateLinesFromDocx(file);
    }

    if (isTextResume(file)) {
      const text = await file.text();
      return normalizeResultLines(text).filter((line) => line.trim().length > 0);
    }

    return [];
  }

  function setParagraphText(paragraphNode, value, xmlDoc) {
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

  async function buildDocxFromUploadedTemplate(file, generatedText, generatedLines = []) {
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

  async function handleDownloadDocx() {
    if (!result.trim()) {
      setError("Nothing to download yet. Generate a resume first.");
      return;
    }

    if (!isDocxResume(resumeFile)) {
      setError(
        "To preserve internal metadata and formatting exactly, upload the source resume as .docx.",
      );
      return;
    }

    setIsDownloading(true);

    try {
      const blob = await buildDocxFromUploadedTemplate(
        resumeFile,
        result,
        resultLines,
      );

      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = getDownloadFileName();
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
    } catch (downloadError) {
      setError(downloadError.message || "Unable to download DOCX file.");
    } finally {
      setIsDownloading(false);
    }
  }

  async function handleSubmit(event) {
    event.preventDefault();

    setError("");
    setResult("");
    setResultLines([]);
    setHasCompletedCall(false);

    if (!jobPosting.trim()) {
      setError("Please provide a job posting.");
      return;
    }

    if (!resumeFile) {
      setError("Please upload a resume file.");
      return;
    }

    setIsSubmitting(true);

    try {
      const formData = new FormData();
      formData.append("jobPosting", jobPosting);
      const templateLines = await buildTemplateLinesForUpload(resumeFile);
      formData.append("templateLines", JSON.stringify(templateLines));

      if (resumeFile) {
        formData.append("resume", resumeFile);
      }

      const response = await fetch("/api/tailor", {
        method: "POST",
        body: formData,
      });

      const payload = await response.json();

      if (!response.ok) {
        throw new Error(payload.error || "Failed to generate a response.");
      }

      setResult(payload.result?.trim() || "No output returned from Gemini.");
      setResultLines(Array.isArray(payload.resultLines) ? payload.resultLines : []);
      setHasCompletedCall(true);
    } catch (submitError) {
      setError(submitError.message || "Unexpected error.");
      setHasCompletedCall(true);
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <div className={styles.page}>
      <main className={styles.main}>
        <h1 className={styles.title}>Resume Tailor</h1>
        <p className={styles.subtitle}>
          Upload a resume (.txt, .md, or .docx) and a job posting, then Gemini
          will generate a tailored version that mirrors the original layout and
          formatting.
        </p>

        <form className={styles.form} onSubmit={handleSubmit}>
          <div className={styles.fieldGroup}>
            <label htmlFor="job-posting" className={styles.label}>
              Job Posting
            </label>
            <textarea
              id="job-posting"
              name="jobPosting"
              className={styles.textarea}
              placeholder="Paste the full job posting here..."
              value={jobPosting}
              onChange={(event) => setJobPosting(event.target.value)}
            />
          </div>

          <div className={styles.fieldGroup}>
            <label htmlFor="resume" className={styles.label}>
              Resume
            </label>
            <input
              id="resume"
              name="resume"
              type="file"
              className={styles.fileInput}
              accept=".txt,.md,.markdown,.docx"
              onChange={(event) => {
                setResumeFile(event.target.files?.[0] || null);
              }}
            />
          </div>

          <button className={styles.button} type="submit" disabled={isSubmitting}>
            {isSubmitting ? "Generating..." : "Generate"}
          </button>
        </form>

        {error ? <p className={styles.error}>{error}</p> : null}

        {hasCompletedCall && result ? (
          <section className={styles.resultSection}>
            <h2 className={styles.resultTitle}>Gemini Output</h2>
            <pre className={styles.result}>{result}</pre>
            <button
              type="button"
              className={styles.secondaryButton}
              onClick={handleDownloadDocx}
              disabled={isDownloading}
            >
              {isDownloading ? "Preparing DOCX..." : "Download Resume"}
            </button>
          </section>
        ) : null}
      </main>
    </div>
  );
}
