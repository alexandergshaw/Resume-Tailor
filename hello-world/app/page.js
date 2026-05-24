"use client";

import { useState } from "react";
import { Badge, Box, IconButton, Tab, Tabs, Tooltip } from "@mui/material";
import JSZip from "jszip";
import styles from "./page.module.css";

const WORDPROCESSINGML_NS =
  "http://schemas.openxmlformats.org/wordprocessingml/2006/main";

function createTabId() {
  if (typeof crypto !== "undefined" && crypto.randomUUID) {
    return crypto.randomUUID();
  }

  return `tab-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function createResumeTab(index) {
  return {
    id: createTabId(),
    title: `Job Posting ${index}`,
    jobPosting: "",
    additionalContext: "",
    contextFiles: [],
    result: "",
    resultLines: [],
    coverLetterResultLines: [],
    generatedJobTitle: "",
    hasDownloadNotification: false,
    error: "",
    isSubmitting: false,
    hasCompletedCall: false,
    isDownloading: false,
  };
}

const INITIAL_TAB = createResumeTab(1);

export default function Home() {
  const [resumeFile, setResumeFile] = useState(null);
  const [coverLetterFile, setCoverLetterFile] = useState(null);
  const [tabs, setTabs] = useState([INITIAL_TAB]);
  const [activeTabId, setActiveTabId] = useState(INITIAL_TAB.id);

  const activeTab = tabs.find((tab) => tab.id === activeTabId) || tabs[0];

  function updateTab(tabId, updater) {
    setTabs((currentTabs) =>
      currentTabs.map((tab) => {
        if (tab.id !== tabId) {
          return tab;
        }

        if (typeof updater === "function") {
          return updater(tab);
        }

        return { ...tab, ...updater };
      }),
    );
  }

  function addTab() {
    const newTab = createResumeTab(tabs.length + 1);
    setTabs((currentTabs) => [...currentTabs, newTab]);
    setActiveTabId(newTab.id);
  }

  function closeTab(tabId) {
    if (tabs.length === 1) {
      return;
    }

    const closedTabIndex = tabs.findIndex((tab) => tab.id === tabId);
    const updatedTabs = tabs.filter((tab) => tab.id !== tabId);
    setTabs(updatedTabs);

    if (activeTabId === tabId) {
      const nextTab = updatedTabs[Math.max(0, closedTabIndex - 1)] || updatedTabs[0];
      setActiveTabId(nextTab.id);
    }
  }

  function sanitizeFileNamePart(value) {
    return value
      .replace(/[\\/:*?"<>|]/g, "")
      .replace(/\s+/g, " ")
      .trim();
  }

  function getDownloadFileName() {
    const cleanedTitle = sanitizeFileNamePart(activeTab.generatedJobTitle || "").slice(
      0,
      90,
    );
    return `Resume - ${cleanedTitle || "Target Role"}.docx`;
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

  async function downloadDocxForTab({ tabId, jobTitle, result, resultLines, coverLetterResultLines }) {
    if (!result.trim()) {
      updateTab(tabId, { error: "Nothing to download yet. Generate a resume first." });
      return;
    }

    if (!isDocxResume(resumeFile)) {
      updateTab(tabId, {
        error:
          "To preserve internal metadata and formatting exactly, upload the source resume as .docx.",
      });
      return;
    }

    updateTab(tabId, { isDownloading: true, error: "" });

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

      updateTab(tabId, { hasDownloadNotification: true });
    } catch (downloadError) {
      updateTab(tabId, {
        error: downloadError.message || "Unable to download DOCX file.",
      });
    } finally {
      updateTab(tabId, { isDownloading: false });
    }
  }

  async function handleDownloadDocx() {
    await downloadDocxForTab({
      tabId: activeTab.id,
      jobTitle: activeTab.generatedJobTitle,
      result: activeTab.result,
      resultLines: activeTab.resultLines,
      coverLetterResultLines: activeTab.coverLetterResultLines,
    });
  }

  async function handleSubmit(event) {
    event.preventDefault();

    const tabId = activeTab.id;
    const tabSnapshot = tabs.find((tab) => tab.id === tabId);

    updateTab(tabId, {
      error: "",
      result: "",
      resultLines: [],
      generatedJobTitle: "",
      hasCompletedCall: false,
    });

    if (!tabSnapshot) {
      return;
    }

    if (!tabSnapshot.jobPosting.trim()) {
      updateTab(tabId, { error: "Please provide a job posting." });
      return;
    }

    if (!resumeFile) {
      updateTab(tabId, { error: "Please upload a resume file." });
      return;
    }

    updateTab(tabId, { isSubmitting: true, hasDownloadNotification: false });

    try {
      const formData = new FormData();
      formData.append("jobPosting", tabSnapshot.jobPosting);
      formData.append("additionalContext", tabSnapshot.additionalContext || "");
      const templateLines = await buildTemplateLinesForUpload(resumeFile);
      formData.append("templateLines", JSON.stringify(templateLines));
      tabSnapshot.contextFiles.forEach((file) => {
        formData.append("contextFiles", file);
      });

      formData.append("resume", resumeFile);

      if (coverLetterFile) {
        const coverLetterTemplateLines = await buildTemplateLinesForUpload(coverLetterFile);
        formData.append("coverLetterTemplateLines", JSON.stringify(coverLetterTemplateLines));
        formData.append("coverLetter", coverLetterFile);
      }

      const response = await fetch("/api/tailor", {
        method: "POST",
        body: formData,
      });

      const payload = await response.json();

      if (!response.ok) {
        throw new Error(payload.error || "Failed to generate a response.");
      }

      const nextResult = payload.result?.trim() || "No output returned from Gemini.";
      const nextResultLines = Array.isArray(payload.resultLines) ? payload.resultLines : [];
      const nextJobTitle =
        typeof payload.jobTitle === "string" ? payload.jobTitle.trim() : "";
      const nextCoverLetterResultLines = Array.isArray(payload.coverLetterResultLines)
        ? payload.coverLetterResultLines
        : [];

      updateTab(tabId, (tab) => ({
        ...tab,
        result: nextResult,
        resultLines: nextResultLines,
        coverLetterResultLines: nextCoverLetterResultLines,
        generatedJobTitle: nextJobTitle,
        hasCompletedCall: true,
        title:
          nextJobTitle
            ? nextJobTitle.slice(0, 36)
            : tab.title,
      }));

      await downloadDocxForTab({
        tabId,
        jobTitle: nextJobTitle,
        result: nextResult,
        resultLines: nextResultLines,
        coverLetterResultLines: nextCoverLetterResultLines,
      });
    } catch (submitError) {
      updateTab(tabId, {
        error: submitError.message || "Unexpected error.",
        hasCompletedCall: true,
      });
    } finally {
      updateTab(tabId, { isSubmitting: false });
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
            onChange={(event) => {
              setCoverLetterFile(event.target.files?.[0] || null);
            }}
          />
        </div>

        <Box className={styles.tabsBar}>
          <Tabs
            value={activeTab.id}
            onChange={(_, value) => setActiveTabId(value)}
            variant="scrollable"
            scrollButtons="auto"
            sx={{
              minHeight: 0,
              flex: 1,
              "& .MuiTab-root": {
                minHeight: 40,
                textTransform: "none",
                border: "1px solid var(--border)",
                borderBottom: "none",
                borderTopLeftRadius: 12,
                borderTopRightRadius: 12,
                marginRight: "8px",
                backgroundColor: "rgba(255, 255, 255, 0.7)",
                color: "var(--text-muted)",
                padding: "6px 12px",
                backdropFilter: "blur(4px)",
                transition:
                  "background-color 0.2s ease, color 0.2s ease, border-color 0.2s ease, box-shadow 0.2s ease",
                "&:hover": {
                  backgroundColor: "rgba(255, 255, 255, 0.94)",
                  color: "var(--text-primary)",
                },
              },
              "& .MuiTab-root.Mui-selected": {
                color: "var(--accent)",
                backgroundColor: "var(--bg-surface)",
                borderColor: "var(--border-strong)",
                boxShadow: "0 8px 16px -14px rgba(17, 60, 110, 0.55)",
                fontWeight: 700,
              },
              "& .MuiTabs-indicator": {
                display: "none",
              },
            }}
          >
            {tabs.map((tab) => {
              const tooltipTitle = tab.generatedJobTitle || tab.title;
              const isActive = tab.id === activeTab.id;

              return (
                <Tooltip key={tab.id} title={tooltipTitle} arrow>
                  <Tab
                    value={tab.id}
                    sx={{
                      "&::after": {
                        content: '""',
                        position: "absolute",
                        left: 10,
                        right: 10,
                        bottom: 0,
                        height: 2,
                        borderRadius: 999,
                        backgroundColor: isActive ? "var(--accent)" : "transparent",
                        transition: "background-color 0.2s ease",
                      },
                    }}
                    label={
                      <Box
                        sx={{
                          position: "relative",
                          display: "flex",
                          alignItems: "center",
                          justifyContent: "space-between",
                          width: "100%",
                          minWidth: 130,
                          pr: 0.5,
                        }}
                      >
                        <span style={{ paddingRight: 8 }}>{tab.title}</span>
                        <Badge
                          color="error"
                          variant="dot"
                          invisible={!tab.hasDownloadNotification}
                          sx={{
                            position: "absolute",
                            top: -4,
                            right: 2,
                            "& .MuiBadge-badge": {
                              transform: "none",
                            },
                          }}
                        />
                        {tabs.length > 1 ? (
                          <Box
                            component="span"
                            sx={{
                              display: "inline-flex",
                              alignItems: "center",
                              justifyContent: "center",
                              width: 18,
                              height: 18,
                              borderRadius: "50%",
                              fontSize: 13,
                              lineHeight: 1,
                              marginLeft: "auto",
                              color: "var(--text-secondary)",
                              transition: "background-color 0.15s ease, color 0.15s ease",
                              "&:hover": {
                                backgroundColor: "rgba(17, 34, 51, 0.08)",
                                color: "var(--text-primary)",
                              },
                            }}
                            onClick={(event) => {
                              event.stopPropagation();
                              closeTab(tab.id);
                            }}
                          >
                            x
                          </Box>
                        ) : null}
                      </Box>
                    }
                  />
                </Tooltip>
              );
            })}
          </Tabs>
          <Tooltip title="New tab">
            <IconButton
              aria-label="Add new tab"
              onClick={addTab}
              sx={{
                border: "1px solid var(--border)",
                borderRadius: "12px 12px 0 0",
                width: 38,
                height: 38,
                backgroundColor: "rgba(255, 255, 255, 0.78)",
                color: "var(--text-secondary)",
                transition: "background-color 0.2s ease, color 0.2s ease",
                "&:hover": {
                  backgroundColor: "var(--bg-surface)",
                  color: "var(--accent)",
                },
              }}
            >
              +
            </IconButton>
          </Tooltip>
        </Box>

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
              value={activeTab.jobPosting}
              onChange={(event) => {
                updateTab(activeTab.id, { jobPosting: event.target.value });
              }}
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
              value={activeTab.additionalContext}
              onChange={(event) => {
                updateTab(activeTab.id, { additionalContext: event.target.value });
              }}
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
              accept=".txt,.md,.markdown,.docx,.pdf"
              onChange={(event) => {
                updateTab(activeTab.id, {
                  contextFiles: Array.from(event.target.files || []),
                });
              }}
            />
            <p className={styles.helperText}>
              {activeTab.contextFiles.length > 0
                ? `${activeTab.contextFiles.length} supporting file${
                    activeTab.contextFiles.length > 1 ? "s" : ""
                  } selected`
                : "Optional: upload extra files to provide more context for Gemini."}
            </p>
          </div>

          <button className={styles.button} type="submit" disabled={activeTab.isSubmitting}>
            {activeTab.isSubmitting ? "Generating..." : "Generate"}
          </button>
        </form>

        {activeTab.error ? <p className={styles.error}>{activeTab.error}</p> : null}

        {activeTab.hasCompletedCall && activeTab.result ? (
          <section className={styles.resultSection}>
            <button
              type="button"
              className={styles.secondaryButton}
              onClick={handleDownloadDocx}
              disabled={activeTab.isDownloading}
            >
              {activeTab.isDownloading ? "Preparing DOCX..." : "Download Resume"}
            </button>
          </section>
        ) : null}
      </main>
    </div>
  );
}
