"use client";

import { useState, useEffect, useRef } from "react";
import JSZip from "jszip";
import styles from "./page.module.css";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import Checkbox from "@mui/material/Checkbox";
import FormControl from "@mui/material/FormControl";
import FormControlLabel from "@mui/material/FormControlLabel";
import InputLabel from "@mui/material/InputLabel";
import ListItemText from "@mui/material/ListItemText";
import MenuItem from "@mui/material/MenuItem";
import Select from "@mui/material/Select";
import TextField from "@mui/material/TextField";
import Autocomplete from "@mui/material/Autocomplete";
import Chip from "@mui/material/Chip";
import { GREENHOUSE_COMPANIES, COMPANY_CATEGORIES } from "../lib/greenhouse/companies";

const WORDPROCESSINGML_NS =
  "http://schemas.openxmlformats.org/wordprocessingml/2006/main";

export default function Home() {
  const [resumeFile, setResumeFile] = useState(null);
  const [coverLetterFile, setCoverLetterFile] = useState(null);
  const [additionalContext, setAdditionalContext] = useState("");
  const [contextFiles, setContextFiles] = useState([]);
  const [jobQuery, setJobQuery] = useState("");
  const [minSalary, setMinSalary] = useState("0");
  const [datePosted, setDatePosted] = useState("today");
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
  const [urlPosting, setUrlPosting] = useState("");
  const [urlResult, setUrlResult] = useState("");
  const [urlResultLines, setUrlResultLines] = useState([]);
  const [urlCoverLetterResultLines, setUrlCoverLetterResultLines] = useState([]);
  const [urlGeneratedJobTitle, setUrlGeneratedJobTitle] = useState("");
  const [urlIsSubmitting, setUrlIsSubmitting] = useState(false);
  const [urlError, setUrlError] = useState("");
  const [urlHasCompleted, setUrlHasCompleted] = useState(false);
  const [urlIsDownloading, setUrlIsDownloading] = useState(false);
  const [activeSection, setActiveSection] = useState("search");
  const [ignoredJobIds, setIgnoredJobIds] = useState(new Set());
  const [appliedJobIds, setAppliedJobIds] = useState(new Set());
  const [trackedJobs, setTrackedJobs] = useState([]);
  const [showIgnored, setShowIgnored] = useState(false);
  const [publisherFilter, setPublisherFilter] = useState([]);
  const [selectedCompanies, setSelectedCompanies] = useState([]);
  const [selectedCategories, setSelectedCategories] = useState([]);

  // Refs for targeted re-fetches when individual controls change
  const hasFetchedRef = useRef(false);
  const activeQueryRef = useRef("");
  const jsearchResultsRef = useRef([]);
  const ghResultsRef = useRef([]);

  const JOB_BOARDS = ["LinkedIn", "Indeed", "ZipRecruiter", "Glassdoor", "Monster", "CareerBuilder", "Talent.com"];

  useEffect(() => {
    const saved = localStorage.getItem("activeSection");
    if (saved === "search" || saved === "url" || saved === "manual") {
      setActiveSection(saved);
    }
  }, []);

  useEffect(() => {
    localStorage.setItem("activeSection", activeSection);
  }, [activeSection]);

  useEffect(() => {
    try {
      const saved = localStorage.getItem("ignoredJobIds");
      if (saved) setIgnoredJobIds(new Set(JSON.parse(saved)));
    } catch {}
  }, []);

  useEffect(() => {
    localStorage.setItem("ignoredJobIds", JSON.stringify([...ignoredJobIds]));
  }, [ignoredJobIds]);

  useEffect(() => {
    try {
      const saved = localStorage.getItem("appliedJobIds");
      if (saved) setAppliedJobIds(new Set(JSON.parse(saved)));
    } catch {}
  }, []);

  useEffect(() => {
    localStorage.setItem("appliedJobIds", JSON.stringify([...appliedJobIds]));
  }, [appliedJobIds]);

  useEffect(() => {
    try {
      const saved = localStorage.getItem("trackedJobs");
      if (saved) setTrackedJobs(JSON.parse(saved));
    } catch {}
  }, []);

  useEffect(() => {
    localStorage.setItem("trackedJobs", JSON.stringify(trackedJobs));
  }, [trackedJobs]);

  useEffect(() => {
    try {
      const q = localStorage.getItem("jobQuery");
      const sal = localStorage.getItem("minSalary");
      const date = localStorage.getItem("datePosted");
      const excl = localStorage.getItem("excludeNoSalary");
      const boards = localStorage.getItem("publisherFilter");
      const url = localStorage.getItem("urlPosting");
      const manual = localStorage.getItem("jobPosting");
      if (q) setJobQuery(q);
      if (sal) setMinSalary(sal);
      if (date) setDatePosted(date);
      if (excl !== null) setExcludeNoSalary(excl === "true");
      if (boards) setPublisherFilter(JSON.parse(boards));
      const companySlugs = localStorage.getItem("selectedCompanies");
      if (companySlugs) {
        const slugs = JSON.parse(companySlugs);
        setSelectedCompanies(GREENHOUSE_COMPANIES.filter((c) => slugs.includes(c.slug)));
      }
      const savedCategories = localStorage.getItem("selectedCategories");
      if (savedCategories) setSelectedCategories(JSON.parse(savedCategories));
      if (url) setUrlPosting(url);
      if (manual) setJobPosting(manual);
    } catch {}
  }, []);

  useEffect(() => { localStorage.setItem("jobQuery", jobQuery); }, [jobQuery]);
  useEffect(() => { localStorage.setItem("minSalary", minSalary); }, [minSalary]);
  useEffect(() => { localStorage.setItem("datePosted", datePosted); }, [datePosted]);
  useEffect(() => { localStorage.setItem("excludeNoSalary", String(excludeNoSalary)); }, [excludeNoSalary]);
  useEffect(() => { localStorage.setItem("publisherFilter", JSON.stringify(publisherFilter)); }, [publisherFilter]);
  useEffect(() => { localStorage.setItem("selectedCompanies", JSON.stringify(selectedCompanies.map((c) => c.slug))); }, [selectedCompanies]);
  useEffect(() => { localStorage.setItem("selectedCategories", JSON.stringify(selectedCategories)); }, [selectedCategories]);

  // When categories change, drive the company multiselect
  useEffect(() => {
    const matched =
      selectedCategories.length === 0
        ? []
        : GREENHOUSE_COMPANIES.filter((c) =>
            c.categories.some((cat) => selectedCategories.includes(cat))
          );
    setSelectedCompanies(matched);
  }, [selectedCategories]);

  useEffect(() => {
    if (!hasFetchedRef.current || !activeQueryRef.current) return;
    const query = activeQueryRef.current;
    const ghUrl = `/api/greenhouse?query=${encodeURIComponent(query)}${
      selectedCompanies.length > 0
        ? `&companies=${selectedCompanies.map((c) => c.slug).join(",")}`
        : ""
    }`;
    fetch(ghUrl)
      .then((r) => r.json())
      .then((data) => {
        const ghJobs = data.jobs || [];
        ghResultsRef.current = ghJobs;
        const seenUrls = new Set(ghJobs.map((j) => j.url));
        const jsJobs = jsearchResultsRef.current;
        setJobResults([...ghJobs, ...jsJobs.filter((j) => j.url && !seenUrls.has(j.url))]);
      })
      .catch(() => {});
  }, [selectedCompanies]); // eslint-disable-line react-hooks/exhaustive-deps

  // Re-fetch JSearch when salary/date/salary-filter controls change
  useEffect(() => {
    if (!hasFetchedRef.current || !activeQueryRef.current) return;
    const query = activeQueryRef.current;
    const params = new URLSearchParams({ query });
    if (minSalary !== "0") params.set("minSalary", minSalary);
    if (excludeNoSalary) params.set("excludeNoSalary", "1");
    if (datePosted !== "today") params.set("datePosted", datePosted);
    setIsSearching(true);
    fetch(`/api/jobs?${params.toString()}`)
      .then((r) => r.json())
      .then((data) => {
        const jsJobs = data.jobs || [];
        jsearchResultsRef.current = jsJobs;
        const ghJobs = ghResultsRef.current;
        const seenUrls = new Set(ghJobs.map((j) => j.url));
        setJobResults([...ghJobs, ...jsJobs.filter((j) => j.url && !seenUrls.has(j.url))]);
      })
      .catch(() => {})
      .finally(() => setIsSearching(false));
  }, [minSalary, datePosted, excludeNoSalary]); // eslint-disable-line react-hooks/exhaustive-deps

  // Re-run full search (debounced) when the query text changes
  useEffect(() => {
    if (!hasFetchedRef.current || !jobQuery.trim()) return;
    const timer = setTimeout(() => {
      activeQueryRef.current = jobQuery.trim();
      const params = new URLSearchParams({ query: jobQuery.trim() });
      if (minSalary !== "0") params.set("minSalary", minSalary);
      if (excludeNoSalary) params.set("excludeNoSalary", "1");
      if (datePosted !== "today") params.set("datePosted", datePosted);
      setIsSearching(true);
      setJobSearchError("");
      const ghCompanyParam = selectedCompanies.length > 0
        ? `&companies=${selectedCompanies.map((c) => c.slug).join(",")}`
        : "";
      Promise.allSettled([
        fetch(`/api/jobs?${params.toString()}`).then((r) => r.json()),
        fetch(`/api/greenhouse?query=${encodeURIComponent(jobQuery.trim())}${ghCompanyParam}`).then((r) => r.json()),
      ]).then(([jsearchResult, ghResult]) => {
        const jsJobs = jsearchResult.status === "fulfilled" && jsearchResult.value.jobs ? jsearchResult.value.jobs : [];
        const ghJobs = ghResult.status === "fulfilled" && ghResult.value.jobs ? ghResult.value.jobs : [];
        jsearchResultsRef.current = jsJobs;
        ghResultsRef.current = ghJobs;
        const seenUrls = new Set(ghJobs.map((j) => j.url));
        setJobResults([...ghJobs, ...jsJobs.filter((j) => j.url && !seenUrls.has(j.url))]);
      }).catch(() => {}).finally(() => setIsSearching(false));
    }, 500);
    return () => clearTimeout(timer);
  }, [jobQuery]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { localStorage.setItem("urlPosting", urlPosting); }, [urlPosting]);
  useEffect(() => { localStorage.setItem("jobPosting", jobPosting); }, [jobPosting]);

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
    hasFetchedRef.current = false;
    activeQueryRef.current = jobQuery.trim();

    try {
      const params = new URLSearchParams({ query: jobQuery.trim() });
      if (minSalary !== "0") params.set("minSalary", minSalary);
      if (excludeNoSalary) params.set("excludeNoSalary", "1");
      if (datePosted !== "today") params.set("datePosted", datePosted);

      const [jsearchResult, ghResult] = await Promise.allSettled([
        fetch(`/api/jobs?${params.toString()}`).then((r) => r.json()),
        fetch(`/api/greenhouse?query=${encodeURIComponent(jobQuery.trim())}${selectedCompanies.length > 0 ? `&companies=${selectedCompanies.map((c) => c.slug).join(",")}` : ""}`).then((r) => r.json()),
      ]);

      const jsearchJobs =
        jsearchResult.status === "fulfilled" && jsearchResult.value.jobs
          ? jsearchResult.value.jobs
          : [];
      const ghJobs =
        ghResult.status === "fulfilled" && ghResult.value.jobs
          ? ghResult.value.jobs
          : [];

      if (jsearchJobs.length === 0 && ghJobs.length === 0) {
        const err =
          jsearchResult.status === "rejected"
            ? jsearchResult.reason?.message
            : jsearchResult.value?.error;
        throw new Error(err || "Failed to fetch jobs.");
      }

      jsearchResultsRef.current = jsearchJobs;
      ghResultsRef.current = ghJobs;
      hasFetchedRef.current = true;
      const seenUrls = new Set(ghJobs.map((j) => j.url));
      const merged = [...ghJobs, ...jsearchJobs.filter((j) => j.url && !seenUrls.has(j.url))];

      setJobResults(merged);
    } catch (err) {
      setJobSearchError(err.message || "Failed to fetch jobs.");
    } finally {
      setIsSearching(false);
    }
  }

  function handleIgnoreJob(jobId) {
    setIgnoredJobIds((prev) => new Set([...prev, jobId]));
  }

  function handleRestoreJob(jobId) {
    setIgnoredJobIds((prev) => {
      const next = new Set(prev);
      next.delete(jobId);
      return next;
    });
  }

  function handleToggleApplied(jobId) {
    setAppliedJobIds((prev) => {
      const next = new Set(prev);
      if (next.has(jobId)) next.delete(jobId);
      else {
        next.add(jobId);
        handleUntrackJob(jobId);
      }
      return next;
    });
  }

  function handleTrackJob(job) {
    setTrackedJobs((prev) => {
      if (prev.some((j) => j.id === job.id)) return prev;
      return [...prev, { id: job.id, title: job.title, company: job.company, url: job.url }];
    });
  }

  function handleUntrackJob(jobId) {
    setTrackedJobs((prev) => prev.filter((j) => j.id !== jobId));
  }

  async function handleTailorJob(job) {
    handleTrackJob(job);
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
      downloaded: false,
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
      } else {
        updateTailoringJob(job.id, { downloaded: true });
      }
    } catch (err) {
      updateTailoringJob(job.id, { status: "error", error: err.message || "Unexpected error." });
    }
  }

  async function handleUrlSubmit(event) {
    event.preventDefault();

    if (!urlPosting.trim()) {
      setUrlError("Please enter a job posting URL.");
      return;
    }

    if (!resumeFile) {
      setUrlError("Please upload a resume file.");
      return;
    }

    setUrlError("");
    setUrlResult("");
    setUrlResultLines([]);
    setUrlGeneratedJobTitle("");
    setUrlHasCompleted(false);
    setUrlIsSubmitting(true);

    try {
      const formData = new FormData();
      formData.append("jobPostingUrl", urlPosting.trim());
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
      const nextCoverLetterResultLines = Array.isArray(payload.coverLetterResultLines)
        ? payload.coverLetterResultLines
        : [];

      setUrlResult(nextResult);
      setUrlResultLines(nextResultLines);
      setUrlCoverLetterResultLines(nextCoverLetterResultLines);
      setUrlGeneratedJobTitle(nextJobTitle);
      setUrlHasCompleted(true);

      const dlError = await downloadDocxFiles({
        jobTitle: nextJobTitle,
        result: nextResult,
        resultLines: nextResultLines,
        coverLetterResultLines: nextCoverLetterResultLines,
      });

      if (dlError) setUrlError(dlError);
    } catch (err) {
      setUrlError(err.message || "Unexpected error.");
      setUrlHasCompleted(true);
    } finally {
      setUrlIsSubmitting(false);
    }
  }

  async function handleUrlDownload() {
    setUrlIsDownloading(true);
    const dlError = await downloadDocxFiles({
      jobTitle: urlGeneratedJobTitle,
      result: urlResult,
      resultLines: urlResultLines,
      coverLetterResultLines: urlCoverLetterResultLines,
    });
    if (dlError) setUrlError(dlError);
    setUrlIsDownloading(false);
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

        <hr className={styles.sectionDivider} />

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
            className={activeSection === "url" ? styles.sectionTabActive : styles.sectionTab}
            onClick={() => setActiveSection("url")}
          >
            Posting URL
          </button>
          <button
            type="button"
            className={activeSection === "manual" ? styles.sectionTabActive : styles.sectionTab}
            onClick={() => setActiveSection("manual")}
          >
            Job Description
          </button>
        </div>

        {activeSection === "search" ? (
          <section className={styles.tabPanel}>
            <form onSubmit={handleJobSearch} style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
              <TextField
                fullWidth
                size="small"
                label="Job title or keywords"
                value={jobQuery}
                onChange={(e) => setJobQuery(e.target.value)}
              />
              <Box sx={{ display: "flex", gap: 1.5, flexWrap: "wrap", alignItems: "center" }}>
                <FormControl size="small" sx={{ minWidth: 140 }}>
                  <InputLabel>Salary</InputLabel>
                  <Select
                    label="Salary"
                    value={minSalary}
                    onChange={(e) => setMinSalary(e.target.value)}
                  >
                    <MenuItem value="0">Any salary</MenuItem>
                    <MenuItem value="50000">$50k+</MenuItem>
                    <MenuItem value="75000">$75k+</MenuItem>
                    <MenuItem value="100000">$100k+</MenuItem>
                    <MenuItem value="125000">$125k+</MenuItem>
                    <MenuItem value="150000">$150k+</MenuItem>
                    <MenuItem value="175000">$175k+</MenuItem>
                    <MenuItem value="200000">$200k+</MenuItem>
                  </Select>
                </FormControl>
                <FormControl size="small" sx={{ minWidth: 150 }}>
                  <InputLabel>Date posted</InputLabel>
                  <Select
                    label="Date posted"
                    value={datePosted}
                    onChange={(e) => setDatePosted(e.target.value)}
                  >
                    <MenuItem value="today">Past 24 hours</MenuItem>
                    <MenuItem value="3days">Past 3 days</MenuItem>
                    <MenuItem value="week">Past week</MenuItem>
                    <MenuItem value="month">Past month</MenuItem>
                  </Select>
                </FormControl>
                <FormControl size="small" sx={{ minWidth: 180 }}>
                  <InputLabel>Job boards</InputLabel>
                  <Select
                    multiple
                    label="Job boards"
                    value={publisherFilter}
                    onChange={(e) => {
                      const val = e.target.value;
                      setPublisherFilter(typeof val === "string" ? val.split(",") : val);
                    }}
                    renderValue={(selected) =>
                      selected.length === 0
                        ? "All boards"
                        : `${selected.length} board${selected.length > 1 ? "s" : ""} selected`
                    }
                  >
                    {JOB_BOARDS.map((board) => (
                      <MenuItem key={board} value={board}>
                        <Checkbox checked={publisherFilter.includes(board)} size="small" />
                        <ListItemText primary={board} />
                      </MenuItem>
                    ))}
                  </Select>
                </FormControl>
                <FormControlLabel
                  control={
                    <Checkbox
                      checked={excludeNoSalary}
                      onChange={(e) => setExcludeNoSalary(e.target.checked)}
                      size="small"
                    />
                  }
                  label="Listed salary only"
                />
              </Box>
              <Autocomplete
                multiple
                options={COMPANY_CATEGORIES}
                value={selectedCategories}
                onChange={(_, newValue) => {
                  setSelectedCategories(newValue);
                }}
                renderInput={(params) => (
                  <TextField
                    {...params}
                    size="small"
                    label="Categories"
                    placeholder={selectedCategories.length === 0 ? "All categories" : ""}
                  />
                )}
                renderTags={(value, getTagProps) =>
                  value.map((option, index) => (
                    <Chip key={option} label={option} size="small" {...getTagProps({ index })} />
                  ))
                }
              />
              <Autocomplete
                multiple
                options={GREENHOUSE_COMPANIES}
                getOptionLabel={(option) => option.name}
                value={selectedCompanies}
                onChange={(_, newValue) => setSelectedCompanies(newValue)}
                isOptionEqualToValue={(option, value) => option.slug === value.slug}
                renderInput={(params) => (
                  <TextField
                    {...params}
                    size="small"
                    label="Companies"
                    placeholder={selectedCompanies.length === 0 ? "All Greenhouse companies" : ""}
                  />
                )}
                renderTags={(value, getTagProps) =>
                  value.map((option, index) => (
                    <Chip key={option.slug} label={option.name} size="small" {...getTagProps({ index })} />
                  ))
                }
              />
              <Button
                type="submit"
                variant="contained"
                disabled={isSearching || !jobQuery.trim()}
                sx={{ whiteSpace: "nowrap", alignSelf: "flex-start" }}
              >
                {isSearching ? "Searching..." : "Search Jobs"}
              </Button>
            </form>

            {jobSearchError ? <p className={styles.error}>{jobSearchError}</p> : null}

            {jobResults.length > 0 ? (() => {
              const boardFiltered =
                publisherFilter.length === 0
                  ? jobResults
                  : jobResults.filter((j) =>
                      publisherFilter.some((b) =>
                        j.publisher?.toLowerCase().includes(b.toLowerCase())
                      )
                    );
              const visibleJobs = boardFiltered.filter((j) => !ignoredJobIds.has(j.id));
              const ignoredInResults = boardFiltered.filter((j) => ignoredJobIds.has(j.id));
              return (
                <>
                  {visibleJobs.length > 0 ? (
                    <div className={styles.jobGrid}>
                      {visibleJobs.map((job) => {
                        const tailoring = tailoringMap[job.id] || {};
                        const isDone = tailoring.status === "done";
                        const isTailoring = tailoring.status === "tailoring";
                        const isDownloaded = tailoring.downloaded === true;
                        const isError = tailoring.status === "error";
                        const isApplied = appliedJobIds.has(job.id);

                        return (
                          <div key={job.id} className={`${styles.jobCard}${isApplied ? ` ${styles.jobCardApplied}` : ""}`}>
                            <div>
                              <p className={styles.jobCardTitle}>{job.title}</p>
                              <p className={styles.jobCardMeta}>
                                {[job.company, job.location].filter(Boolean).join(" · ")}
                              </p>
                              {job.publisher ? (
                                <p className={styles.jobCardPublisher}>{job.publisher}</p>
                              ) : null}
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
                                View
                              </a>
                              <div className={styles.cardActions}>
                                <button
                                  type="button"
                                  className={`${styles.cardBtn} ${isApplied ? styles.cardBtnApplied : styles.cardBtnSecondary}`}
                                  onClick={() => handleToggleApplied(job.id)}
                                >
                                  {isApplied ? "Applied ✓" : "Applied"}
                                </button>
                                <button
                                  type="button"
                                  className={`${styles.cardBtn} ${styles.cardBtnSecondary}`}
                                  onClick={() => handleIgnoreJob(job.id)}
                                >
                                  Ignore
                                </button>
                                <button
                                  type="button"
                                  className={`${styles.cardBtn} ${styles.cardBtnPrimary}`}
                                  disabled={!resumeFile || isTailoring || (isDone && !isDownloaded)}
                                  title={!resumeFile ? "Upload a resume to generate" : undefined}
                                  onClick={() => handleTailorJob(job)}
                                >
                                  {isTailoring ? "Tailoring..." : isDownloaded ? "Regenerate" : isDone ? "Done ✓" : "Generate"}
                                </button>
                              </div>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  ) : null}

                  {ignoredInResults.length > 0 ? (
                    <div className={styles.ignoredSection}>
                      <button
                        type="button"
                        className={styles.ignoredToggle}
                        onClick={() => setShowIgnored((v) => !v)}
                      >
                        {ignoredInResults.length} ignored{showIgnored ? " · Hide" : " · Show"}
                      </button>
                      {showIgnored ? (
                        <div className={styles.jobGrid}>
                          {ignoredInResults.map((job) => (
                            <div key={job.id} className={`${styles.jobCard} ${styles.jobCardIgnored}`}>
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
                              </div>
                              <div className={styles.jobCardFooter}>
                                <a
                                  href={job.url}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className={styles.jobCardLink}
                                >
                                  View
                                </a>
                                <div className={styles.cardActions}>
                                  <button
                                    type="button"
                                    className={`${styles.cardBtn} ${styles.cardBtnSecondary}`}
                                    onClick={() => handleRestoreJob(job.id)}
                                  >
                                    Restore
                                  </button>
                                </div>
                              </div>
                            </div>
                          ))}
                        </div>
                      ) : null}
                    </div>
                  ) : null}
                </>
              );
            })() : null}
          </section>
        ) : activeSection === "manual" ? (
          <section className={styles.tabPanel}>
            <form className={styles.form} onSubmit={handleManualSubmit} style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
              <TextField
                id="job-posting"
                name="jobPosting"
                label="Job Posting"
                multiline
                rows={10}
                fullWidth
                placeholder="Paste the full job posting here..."
                value={jobPosting}
                onChange={(e) => setJobPosting(e.target.value)}
              />
              <Box>
                <Button
                  type="submit"
                  variant="contained"
                  disabled={manualIsSubmitting}
                >
                  {manualIsSubmitting ? "Generating..." : "Generate"}
                </Button>
              </Box>
            </form>

            {manualError ? <p className={styles.error}>{manualError}</p> : null}

            {manualHasCompleted && manualResult ? (
              <section className={styles.resultSection}>
                <Button
                  variant="outlined"
                  onClick={handleManualDownload}
                  disabled={manualIsDownloading}
                >
                  {manualIsDownloading ? "Preparing DOCX..." : "Download Resume"}
                </Button>
              </section>
            ) : null}
          </section>
        ) : (
          <section className={styles.tabPanel}>
            <form className={styles.form} onSubmit={handleUrlSubmit} style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
              <TextField
                id="job-posting-url"
                type="url"
                label="Job Posting URL"
                fullWidth
                placeholder="https://..."
                value={urlPosting}
                onChange={(e) => setUrlPosting(e.target.value)}
              />
              <Box>
                <Button
                  type="submit"
                  variant="contained"
                  disabled={urlIsSubmitting}
                >
                  {urlIsSubmitting ? "Generating..." : "Generate"}
                </Button>
              </Box>
            </form>

            {urlError ? <p className={styles.error}>{urlError}</p> : null}

            {urlHasCompleted && urlResult ? (
              <section className={styles.resultSection}>
                <Button
                  variant="outlined"
                  onClick={handleUrlDownload}
                  disabled={urlIsDownloading}
                >
                  {urlIsDownloading ? "Preparing DOCX..." : "Download Resume"}
                </Button>
              </section>
            ) : null}
          </section>
        )}
      </main>

      {trackedJobs.length > 0 ? (
        <div className={styles.floatingToolbar}>
          <span className={styles.toolbarLabel}>Viewed ({trackedJobs.length})</span>
          <div className={styles.toolbarItems}>
            {trackedJobs.map((job) => {
              const tailoring = tailoringMap[job.id] || {};
              const status = tailoring.status;
              return (
                <a
                  key={job.id}
                  href={job.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={`${styles.toolbarChip}${
                    status === "done" ? ` ${styles.toolbarChipDone}` :
                    status === "tailoring" ? ` ${styles.toolbarChipGenerating}` :
                    status === "error" ? ` ${styles.toolbarChipError}` : ""
                  }`}
                >
                  <span className={styles.toolbarChipTitle}>{job.title}</span>
                  {job.company ? <span className={styles.toolbarChipCompany}>{job.company}</span> : null}
                  {status === "done" ? (
                    <span className={styles.toolbarChipBadge}>✓ Ready</span>
                  ) : status === "tailoring" ? (
                    <span className={styles.toolbarChipBadge}>Generating…</span>
                  ) : null}
                  <button
                    type="button"
                    className={styles.toolbarChipRemove}
                    onClick={(e) => { e.preventDefault(); e.stopPropagation(); handleUntrackJob(job.id); }}
                    aria-label="Remove"
                  >
                    ×
                  </button>
                </a>
              );
            })}
          </div>
          <button
            type="button"
            className={styles.toolbarClear}
            onClick={() => setTrackedJobs([])}
          >
            Clear all
          </button>
        </div>
      ) : null}
    </div>
  );
}
