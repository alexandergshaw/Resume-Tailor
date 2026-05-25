"use client";

import { useState } from "react";
import JSZip from "jszip";
import styles from "./page.module.css";

const WORDPROCESSINGML_NS =
  "http://schemas.openxmlformats.org/wordprocessingml/2006/main";

export default function Home() {
  const [resumeFile, setResumeFile] = useState(null);
  const [coverLetterFile, setCoverLetterFile] = useState(null);
  const [additionalContext, setAdditionalContext] = useState("");
  const [contextFiles, setContextFiles] = useState([]);
  const [jobQuery, setJobQuery] = useState("");
  const [minSalary, setMinSalary] = useState("0");
  const [excludeNoSalary, setExcludeNoSalary] = useState(false);
  const [jobResults, setJobResults] = useState([]);
  const [isSearching, setIsSearching] = useState(false);
  const [jobSearchError, setJobSearchError] = useState("");
  const [tailoringMap, setTailoringMap] = useState({});
  const [jobPosting, setJobPosting] = useState("");
  const [manualResult, setManualResult] = useState("");
  const [manualResultLines, setManualResultLines] = useState([]);
  const [manualCoverLetterResultLines, setManualCoverLetterResultLines] = useState([]);
  const [manualGeneratedJobTitle, setManualGeneratedJobTitle] = useState("");
  const [manualIsSubmitting, setManualIsSubmitting] = useState(false);
  const [manualError, setManualError] = useState("");
  const [manualHasCompleted, setManualHasCompleted] = useState(false);
  const [manualIsDownloading, setManualIsDownloading] = useState(false);
  const [activeSection, setActiveSection] = useState("search");

  function sanitizeFileNamePart(value) {
    return value
      .replace(/[\\/:*?"<>|]/g, "")
      .replace(/\s+/g, " ")
      .trim();
  }

  function getDownloadFileNameForTitle(jobTitle) {
    const cleanedTitle = sanitizeFileNamePart(jobTitle || "").slice(0, 90);
    return `Resume - ${cleanedTitle || "Target Role"}.docx`;
  }

  function getDownloadCoverLetterFileNameForTitle(jobTitle) {
    const cleanedTitle = sanitizeFileNamePart(jobTitle || "").slice(0, 90);
    return `Cover Letter - ${cleanedTitle || "Target Role"}.docx`;
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

  async function downloadDocxFiles({ jobTitle, result, resultLines, coverLetterResultLines }) {
    if (!result?.trim()) return "Nothing to download yet.";
    if (!isDocxResume(resumeFile)) return "Upload the source resume as .docx to download.";

    try {
      const blob = await buildDocxFromUploadedTemplate(resumeFile, result, resultLines);
      const url = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = getDownloadFileNameForTitle(jobTitle);
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
        clLink.download = getDownloadCoverLetterFileNameForTitle(jobTitle);
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

  function updateTailoringJob(jobId, updater) {
    setTailoringMap((current) => ({
      ...current,
      [jobId]:
        typeof updater === "function"
          ? updater(current[jobId] || {})
          : { ...(current[jobId] || {}), ...updater },
    }));
  }

  async function handleJobSearch(event) {
    event.preventDefault();
    if (!jobQuery.trim()) return;

    setIsSearching(true);
    setJobSearchError("");
    setJobResults([]);
    setTailoringMap({});

    try {
      const params = new URLSearchParams({ query: jobQuery.trim() });
      if (minSalary !== "0") params.set("minSalary", minSalary);
      if (excludeNoSalary) params.set("excludeNoSalary", "1");

      const response = await fetch(`/api/jobs?${params.toString()}`);
      const payload = await response.json();

      if (!response.ok) {
        throw new Error(payload.error || "Failed to fetch jobs.");
      }

      setJobResults(payload.jobs || []);
    } catch (err) {
      setJobSearchError(err.message || "Failed to fetch jobs.");
    } finally {
      setIsSearching(false);
    }
  }

  async function handleTailorJob(job) {
    if (!resumeFile) {
      updateTailoringJob(job.id, { status: "error", error: "Upload a resume first." });
      return;
    }

    updateTailoringJob(job.id, {
      status: "tailoring",
      error: "",
      result: "",
      resultLines: [],
      generatedJobTitle: "",
    });

    try {
      const formData = new FormData();
      formData.append("jobPosting", job.description);
      formData.append("additionalContext", additionalContext);
      const templateLines = await buildTemplateLinesForUpload(resumeFile);
      formData.append("templateLines", JSON.stringify(templateLines));
      contextFiles.forEach((file) => formData.append("contextFiles", file));
      formData.append("resume", resumeFile);

      if (coverLetterFile) {
        const coverLetterTemplateLines = await buildTemplateLinesForUpload(coverLetterFile);
        formData.append("coverLetterTemplateLines", JSON.stringify(coverLetterTemplateLines));
        formData.append("coverLetter", coverLetterFile);
      }

      const response = await fetch("/api/tailor", { method: "POST", body: formData });
      const payload = await response.json();

      if (!response.ok) throw new Error(payload.error || "Failed to generate.");

      const result = payload.result?.trim() || "";
      const resultLines = Array.isArray(payload.resultLines) ? payload.resultLines : [];
      const generatedJobTitle = typeof payload.jobTitle === "string" ? payload.jobTitle.trim() : "";
      const coverLetterResultLines = Array.isArray(payload.coverLetterResultLines)
        ? payload.coverLetterResultLines
        : [];

      updateTailoringJob(job.id, {
        status: "done",
        result,
        resultLines,
        generatedJobTitle,
        coverLetterResultLines,
        error: "",
      });

      const dlError = await downloadDocxFiles({
        jobTitle: generatedJobTitle || job.title,
        result,
        resultLines,
        coverLetterResultLines,
      });

      if (dlError) {
        updateTailoringJob(job.id, { error: dlError });
      }
    } catch (err) {
      updateTailoringJob(job.id, { status: "error", error: err.message || "Unexpected error." });
    }
  }

  async function handleManualSubmit(event) {
    event.preventDefault();

    if (!jobPosting.trim()) {
      setManualError("Please provide a job posting.");
      return;
    }

    if (!resumeFile) {
      setManualError("Please upload a resume file.");
      return;
    }

    setManualError("");
    setManualResult("");
    setManualResultLines([]);
    setManualGeneratedJobTitle("");
    setManualHasCompleted(false);
    setManualIsSubmitting(true);

    try {
      const formData = new FormData();
      formData.append("jobPosting", jobPosting);
      formData.append("additionalContext", additionalContext);
      const templateLines = await buildTemplateLinesForUpload(resumeFile);
      formData.append("templateLines", JSON.stringify(templateLines));
      contextFiles.forEach((file) => formData.append("contextFiles", file));
      formData.append("resume", resumeFile);

      if (coverLetterFile) {
        const coverLetterTemplateLines = await buildTemplateLinesForUpload(coverLetterFile);
        formData.append("coverLetterTemplateLines", JSON.stringify(coverLetterTemplateLines));
        formData.append("coverLetter", coverLetterFile);
      }

      const response = await fetch("/api/tailor", { method: "POST", body: formData });
      const payload = await response.json();

      if (!response.ok) throw new Error(payload.error || "Failed to generate a response.");

      const nextResult = payload.result?.trim() || "No output returned from Gemini.";
      const nextResultLines = Array.isArray(payload.resultLines) ? payload.resultLines : [];
      const nextJobTitle = typeof payload.jobTitle === "string" ? payload.jobTitle.trim() : "";
      const nextCoverLetterResultLines = Array.isArray(payload.coverLetterResultLines) ? payload.coverLetterResultLines : [];

      setManualResult(nextResult);
      setManualResultLines(nextResultLines);
      setManualCoverLetterResultLines(nextCoverLetterResultLines);
      setManualGeneratedJobTitle(nextJobTitle);
      setManualHasCompleted(true);

      const dlError = await downloadDocxFiles({
        jobTitle: nextJobTitle,
        result: nextResult,
        resultLines: nextResultLines,
        coverLetterResultLines: nextCoverLetterResultLines,
      });

      if (dlError) setManualError(dlError);
    } catch (err) {
      setManualError(err.message || "Unexpected error.");
      setManualHasCompleted(true);
    } finally {
      setManualIsSubmitting(false);
    }
  }

  async function handleManualDownload() {
    setManualIsDownloading(true);
    const dlError = await downloadDocxFiles({
      jobTitle: manualGeneratedJobTitle,
      result: manualResult,
      resultLines: manualResultLines,
      coverLetterResultLines: manualCoverLetterResultLines,
    });
    if (dlError) setManualError(dlError);
    setManualIsDownloading(false);
  }

  return (
    <div className={styles.page}>
      <main className={styles.main}>
        <h1 className={styles.title}>Resume Tailor</h1>
        <p className={styles.subtitle}>
          Upload a resume, search for remote jobs, and let Gemini tailor your
          resume to each posting.
        </p>

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
            onChange={(event) => setResumeFile(event.target.files?.[0] || null)}
          />
        </div>

        <div className={styles.fieldGroup}>
          <label htmlFor="cover-letter" className={styles.label}>
            Cover Letter
          </label>
          <input
            id="cover-letter"
            name="coverLetter"
            type="file"
            className={styles.fileInput}
            accept=".txt,.md,.markdown,.docx"
            onChange={(event) => setCoverLetterFile(event.target.files?.[0] || null)}
          />
        </div>

        <div className={styles.fieldGroup}>
          <label htmlFor="additional-context" className={styles.label}>
            Additional Context
          </label>
          <textarea
            id="additional-context"
            name="additionalContext"
            className={`${styles.textarea} ${styles.contextTextarea}`}
            placeholder="Add extra direction for Gemini (priority skills, key achievements to emphasize, domain specifics, preferred wording, etc.)"
            value={additionalContext}
            onChange={(e) => setAdditionalContext(e.target.value)}
          />
        </div>

        <div className={styles.fieldGroup}>
          <label htmlFor="context-files" className={styles.label}>
            Supporting Files
          </label>
          <input
            id="context-files"
            name="contextFiles"
            type="file"
            multiple
            className={styles.fileInput}
            accept=".txt,.md,.markdown,.docx"
            onChange={(event) => setContextFiles(Array.from(event.target.files || []))}
          />
          <p className={styles.helperText}>
            {contextFiles.length > 0
              ? `${contextFiles.length} supporting file${
                  contextFiles.length > 1 ? "s" : ""
                } selected`
              : "Optional: upload extra files to provide more context for Gemini."}
          </p>
        </div>

        <div className={styles.sectionTabs}>
          <button
            type="button"
            className={activeSection === "search" ? styles.sectionTabActive : styles.sectionTab}
            onClick={() => setActiveSection("search")}
          >
            Job Search
          </button>
          <button
            type="button"
            className={activeSection === "manual" ? styles.sectionTabActive : styles.sectionTab}
            onClick={() => setActiveSection("manual")}
          >
            Job Posting
          </button>
        </div>

        {activeSection === "search" ? (
          <section className={styles.tabPanel}>
            <form className={styles.searchBar} onSubmit={handleJobSearch}>
              <input
                type="text"
                className={styles.searchInput}
                placeholder="Job title or keywords"
                value={jobQuery}
                onChange={(e) => setJobQuery(e.target.value)}
              />
              <select
                className={styles.searchInput}
                value={minSalary}
                onChange={(e) => setMinSalary(e.target.value)}
              >
                <option value="0">Any salary</option>
                <option value="50000">$50k+</option>
                <option value="75000">$75k+</option>
                <option value="100000">$100k+</option>
                <option value="125000">$125k+</option>
                <option value="150000">$150k+</option>
                <option value="175000">$175k+</option>
                <option value="200000">$200k+</option>
              </select>
              <label className={styles.checkboxLabel}>
                <input
                  type="checkbox"
                  checked={excludeNoSalary}
                  onChange={(e) => setExcludeNoSalary(e.target.checked)}
                />
                Listed salary only
              </label>
              <button
                type="submit"
                className={styles.button}
                disabled={isSearching || !jobQuery.trim()}
              >
                {isSearching ? "Searching..." : "Search Jobs"}
              </button>
            </form>

            {jobSearchError ? <p className={styles.error}>{jobSearchError}</p> : null}

            {jobResults.length > 0 ? (
              <div className={styles.jobGrid}>
                {jobResults.map((job) => {
                  const tailoring = tailoringMap[job.id] || {};
                  const isDone = tailoring.status === "done";
                  const isTailoring = tailoring.status === "tailoring";
                  const isError = tailoring.status === "error";

                  return (
                    <div key={job.id} className={styles.jobCard}>
                      <div>
                        <p className={styles.jobCardTitle}>{job.title}</p>
                        <p className={styles.jobCardMeta}>
                          {[job.company, job.location].filter(Boolean).join(" · ")}
                        </p>
                        {job.salaryMin || job.salaryMax ? (
                          <p className={styles.jobCardSalary}>
                            {job.salaryMin && job.salaryMax
                              ? `$${Math.round(job.salaryMin / 1000)}k–$${Math.round(job.salaryMax / 1000)}k`
                              : job.salaryMin
                              ? `From $${Math.round(job.salaryMin / 1000)}k`
                              : `Up to $${Math.round(job.salaryMax / 1000)}k`}
                          </p>
                        ) : null}
                        <p className={styles.jobCardDescription}>
                          {job.description.slice(0, 220).trim()}&hellip;
                        </p>
                        {isError ? (
                          <p className={styles.jobCardError}>{tailoring.error}</p>
                        ) : null}
                      </div>
                      <div className={styles.jobCardFooter}>
                        <a
                          href={job.url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className={styles.jobCardLink}
                        >
                          View posting
                        </a>
                        <button
                          type="button"
                          className={styles.button}
                          disabled={isTailoring || isDone}
                          onClick={() => handleTailorJob(job)}
                        >
                          {isTailoring ? "Tailoring..." : isDone ? "Done ✓" : "Tailor Resume"}
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : null}
          </section>
        ) : (
          <section className={styles.tabPanel}>
            <form className={styles.form} onSubmit={handleManualSubmit}>
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
                  onChange={(e) => setJobPosting(e.target.value)}
                />
              </div>
              <button
                className={styles.button}
                type="submit"
                disabled={manualIsSubmitting}
              >
                {manualIsSubmitting ? "Generating..." : "Generate"}
              </button>
            </form>

            {manualError ? <p className={styles.error}>{manualError}</p> : null}

            {manualHasCompleted && manualResult ? (
              <section className={styles.resultSection}>
                <button
                  type="button"
                  className={styles.secondaryButton}
                  onClick={handleManualDownload}
                  disabled={manualIsDownloading}
                >
                  {manualIsDownloading ? "Preparing DOCX..." : "Download Resume"}
                </button>
              </section>
            ) : null}
          </section>
        )}
      </main>
    </div>
  );
}
