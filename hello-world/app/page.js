"use client";

import { useState } from "react";
import { Document, Packer, Paragraph, TextRun } from "docx";
import JSZip from "jszip";
import styles from "./page.module.css";

const WORDPROCESSINGML_NS =
  "http://schemas.openxmlformats.org/wordprocessingml/2006/main";

const HEADING_STYLE_HINTS = ["heading", "title", "subtitle", "header"];

export default function Home() {
  const [jobPosting, setJobPosting] = useState("");
  const [resumeFile, setResumeFile] = useState(null);
  const [result, setResult] = useState("");
  const [error, setError] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [hasCompletedCall, setHasCompletedCall] = useState(false);
  const [isDownloading, setIsDownloading] = useState(false);

  function getDownloadFileName() {
    const fallback = "tailored-resume.docx";

    if (!resumeFile?.name) {
      return fallback;
    }

    const withoutExtension = resumeFile.name.replace(/\.[^/.]+$/, "");
    return `${withoutExtension}-tailored.docx`;
  }

  function isDocxResume(file) {
    return file?.name?.toLowerCase().endsWith(".docx");
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

  function classifyGeneratedLine(line) {
    const trimmed = line.trim();

    if (!trimmed) {
      return "blank";
    }

    if (/^[-*•]\s+/.test(trimmed)) {
      return "list";
    }

    if ((trimmed.endsWith(":") && trimmed.length <= 70) || /^[A-Z0-9\s&/,-]+$/.test(trimmed)) {
      return "heading";
    }

    return "body";
  }

  function classifyTemplateParagraph(paragraphNode) {
    const plainText = getParagraphPlainText(paragraphNode).trim();
    const paragraphProperties = paragraphNode.getElementsByTagNameNS(
      WORDPROCESSINGML_NS,
      "pPr",
    )[0];

    if (!plainText) {
      return "blank";
    }

    if (
      paragraphProperties?.getElementsByTagNameNS(WORDPROCESSINGML_NS, "numPr")
        .length
    ) {
      return "list";
    }

    const paragraphStyle = paragraphProperties
      ?.getElementsByTagNameNS(WORDPROCESSINGML_NS, "pStyle")?.[0]
      ?.getAttributeNS(WORDPROCESSINGML_NS, "val")
      ?.toLowerCase();

    if (
      paragraphStyle &&
      HEADING_STYLE_HINTS.some((hint) => paragraphStyle.includes(hint))
    ) {
      return "heading";
    }

    if (plainText.length <= 70 && /^[A-Z0-9\s&/,-]+$/.test(plainText)) {
      return "heading";
    }

    return "body";
  }

  function removeBulletPrefix(line) {
    return line.replace(/^[-*•]\s+/, "").trimStart();
  }

  function setParagraphText(paragraphNode, value, xmlDoc) {
    const textNodes = paragraphNode.getElementsByTagNameNS(
      WORDPROCESSINGML_NS,
      "t",
    );

    if (textNodes.length > 0) {
      textNodes[0].textContent = value || "";

      if (value && (value.startsWith(" ") || value.endsWith(" "))) {
        textNodes[0].setAttribute("xml:space", "preserve");
      } else {
        textNodes[0].removeAttribute("xml:space");
      }

      for (let index = 1; index < textNodes.length; index += 1) {
        textNodes[index].textContent = "";
      }

      return;
    }

    const runNode = xmlDoc.createElementNS(WORDPROCESSINGML_NS, "w:r");
    const textNode = xmlDoc.createElementNS(WORDPROCESSINGML_NS, "w:t");
    textNode.textContent = value || "";
    runNode.appendChild(textNode);
    paragraphNode.appendChild(runNode);
  }

  async function buildDocxFromUploadedTemplate(file, generatedText) {
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

    const lines = normalizeResultLines(generatedText);
    const existingParagraphs = getDirectChildrenByTag(bodyNode, "p");

    if (existingParagraphs.length === 0) {
      throw new Error("Uploaded DOCX template has no editable paragraphs.");
    }

    const paragraphsByType = {
      heading: [],
      list: [],
      body: [],
      blank: [],
    };

    existingParagraphs.forEach((paragraphNode) => {
      const type = classifyTemplateParagraph(paragraphNode);
      paragraphsByType[type].push(paragraphNode);
    });

    const fallbackTemplate =
      paragraphsByType.body[0] ||
      paragraphsByType.list[0] ||
      paragraphsByType.heading[0] ||
      existingParagraphs[0];

    const cursors = {
      heading: 0,
      list: 0,
      body: 0,
      blank: 0,
    };

    function takeTemplateParagraph(type) {
      const pool = paragraphsByType[type];

      if (pool.length > 0) {
        const index = Math.min(cursors[type], pool.length - 1);
        cursors[type] += 1;
        return pool[index];
      }

      return fallbackTemplate;
    }

    const generatedParagraphs = lines.map((line) => {
      const lineType = classifyGeneratedLine(line);
      const templateParagraph = takeTemplateParagraph(lineType);
      const clonedParagraph = templateParagraph.cloneNode(true);
      const usesListTemplate = classifyTemplateParagraph(templateParagraph) === "list";
      const finalText =
        lineType === "list" && usesListTemplate ? removeBulletPrefix(line) : line;

      setParagraphText(clonedParagraph, finalText, xmlDoc);
      return clonedParagraph;
    });

    const sectionNode = getDirectChildrenByTag(bodyNode, "sectPr")[0] || null;

    existingParagraphs.forEach((paragraphNode) => {
      bodyNode.removeChild(paragraphNode);
    });

    generatedParagraphs.forEach((paragraphNode) => {
      if (sectionNode) {
        bodyNode.insertBefore(paragraphNode, sectionNode);
      } else {
        bodyNode.appendChild(paragraphNode);
      }
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

    setIsDownloading(true);

    try {
      let blob;

      if (isDocxResume(resumeFile)) {
        blob = await buildDocxFromUploadedTemplate(resumeFile, result);
      } else {
        const paragraphs = result.split("\n").map((line) => {
          if (!line.trim()) {
            return new Paragraph({ children: [new TextRun("")] });
          }

          return new Paragraph({ children: [new TextRun(line)] });
        });

        const doc = new Document({
          sections: [
            {
              properties: {},
              children: paragraphs,
            },
          ],
        });

        blob = await Packer.toBlob(doc);
      }

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
