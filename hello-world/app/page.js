"use client";

import { useState, useEffect, useRef } from "react";
import JSZip from "jszip";
import styles from "./page.module.css";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import FormControl from "@mui/material/FormControl";
import InputLabel from "@mui/material/InputLabel";
import MenuItem from "@mui/material/MenuItem";
import Select from "@mui/material/Select";
import TextField from "@mui/material/TextField";
import Autocomplete from "@mui/material/Autocomplete";
import Chip from "@mui/material/Chip";
import { GREENHOUSE_COMPANIES, COMPANY_CATEGORIES } from "../lib/greenhouse/companies";
import { createClient } from "../lib/supabase/client";

const WORDPROCESSINGML_NS =
  "http://schemas.openxmlformats.org/wordprocessingml/2006/main";

export default function Home() {
  const [resumeFile, setResumeFile] = useState(null);
  const [coverLetterFile, setCoverLetterFile] = useState(null);
  const [additionalContext, setAdditionalContext] = useState("");
  const [contextFiles, setContextFiles] = useState([]);
  const [jobQuery, setJobQuery] = useState("");
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
  const [highlightedJobId, setHighlightedJobId] = useState(null);
  const [toolbarCanScrollLeft, setToolbarCanScrollLeft] = useState(false);
  const [toolbarCanScrollRight, setToolbarCanScrollRight] = useState(false);
  const [showIgnored, setShowIgnored] = useState(false);
  const [selectedCompanies, setSelectedCompanies] = useState([]);
  const [selectedCategories, setSelectedCategories] = useState([]);
  const [maxYearsExp, setMaxYearsExp] = useState("any");
  const [currentUser, setCurrentUser] = useState(null);

  // Refs for targeted re-fetches when individual controls change
  const hasFetchedRef = useRef(false);
  const activeQueryRef = useRef("");
  const toolbarScrollRef = useRef(null);

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

  // Track auth state + load applied jobs + load stored files
  useEffect(() => {
    const supabase = createClient();

    async function loadUserData(user) {
      if (user) {
        setCurrentUser(user);

        // Load applied jobs
        const { data: appliedData } = await supabase
          .from("applied_jobs")
          .select("job_id")
          .eq("user_id", user.id);
        if (appliedData) {
          setAppliedJobIds(new Set(appliedData.map((j) => j.job_id)));
        }

        // Load stored resume + cover letter from Storage
        for (const [storageName, setter] of [
          ["resume", setResumeFile],
          ["cover-letter", setCoverLetterFile],
        ]) {
          const { data } = await supabase.storage
            .from("resumes")
            .download(`${user.id}/${storageName}`);
          if (data) {
            setter(new File([data], storageName === "resume" ? "resume.docx" : "cover-letter.docx", { type: data.type }));
          }
        }
      } else {
        setCurrentUser(null);
        // Fallback: localStorage for applied jobs
        try {
          const saved = localStorage.getItem("appliedJobIds");
          if (saved) setAppliedJobIds(new Set(JSON.parse(saved)));
        } catch {}
      }
    }

    supabase.auth.getSession().then(({ data: { session } }) => loadUserData(session?.user ?? null));

    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      loadUserData(session?.user ?? null);
    });
    return () => subscription.unsubscribe();
  }, []);

  useEffect(() => {
    try {
      const saved = localStorage.getItem("trackedJobs");
      if (saved) setTrackedJobs(JSON.parse(saved));
    } catch {}
  }, []);

  useEffect(() => {
    localStorage.setItem("trackedJobs", JSON.stringify(trackedJobs));
    // Re-evaluate arrow visibility after chips update
    setTimeout(handleToolbarScroll, 50);
  }, [trackedJobs]);

  useEffect(() => {
    try {
      const q = localStorage.getItem("jobQuery");
      const url = localStorage.getItem("urlPosting");
      const manual = localStorage.getItem("jobPosting");
      if (q) setJobQuery(q);
      const companySlugs = localStorage.getItem("selectedCompanies");
      if (companySlugs) {
        const slugs = JSON.parse(companySlugs);
        setSelectedCompanies(GREENHOUSE_COMPANIES.filter((c) => slugs.includes(c.slug)));
      }
      const savedCategories = localStorage.getItem("selectedCategories");
      if (savedCategories) setSelectedCategories(JSON.parse(savedCategories));
      const yrs = localStorage.getItem("maxYearsExp");
      if (yrs) setMaxYearsExp(yrs);
      if (url) setUrlPosting(url);
      if (manual) setJobPosting(manual);
    } catch {}
  }, []);

  useEffect(() => { localStorage.setItem("jobQuery", jobQuery); }, [jobQuery]);
  useEffect(() => { localStorage.setItem("selectedCompanies", JSON.stringify(selectedCompanies.map((c) => c.slug))); }, [selectedCompanies]);
  useEffect(() => { localStorage.setItem("selectedCategories", JSON.stringify(selectedCategories)); }, [selectedCategories]);
  useEffect(() => { localStorage.setItem("maxYearsExp", maxYearsExp); }, [maxYearsExp]);

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
      .then((data) => { setJobResults(data.jobs || []); })
      .catch(() => {});
  }, [selectedCompanies]); // eslint-disable-line react-hooks/exhaustive-deps

  // Re-run search (debounced) when the query text changes
  useEffect(() => {
    if (!hasFetchedRef.current || !jobQuery.trim()) return;
    const timer = setTimeout(() => {
      activeQueryRef.current = jobQuery.trim();
      setIsSearching(true);
      setJobSearchError("");
      const ghCompanyParam = selectedCompanies.length > 0
        ? `&companies=${selectedCompanies.map((c) => c.slug).join(",")}`
        : "";
      fetch(`/api/greenhouse?query=${encodeURIComponent(jobQuery.trim())}${ghCompanyParam}`)
        .then((r) => r.json())
        .then((data) => { setJobResults(data.jobs || []); })
        .catch(() => {})
        .finally(() => setIsSearching(false));
    }, 500);
    return () => clearTimeout(timer);
  }, [jobQuery]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { localStorage.setItem("urlPosting", urlPosting); }, [urlPosting]);
  useEffect(() => { localStorage.setItem("jobPosting", jobPosting); }, [jobPosting]);

  function extractMinYearsRequired(description) {
    if (!description) return null;
    const text = description.toLowerCase();
    const patterns = [
      /(\d+)\s*\+\s*years?/,
      /(\d+)\s*or\s*more\s*years?/,
      /at\s*least\s*(\d+)\s*years?/,
      /minimum\s*(?:of\s*)?(\d+)\s*years?/,
      /(\d+)\s*-\s*\d+\s*years?/,
      /(\d+)\s*to\s*\d+\s*years?/,
      /(\d+)\s*years?\s*(?:of\s*)?(?:professional\s*)?(?:experience|exp)/,
    ];
    const found = [];
    for (const pattern of patterns) {
      const match = text.match(pattern);
      if (match) {
        const yrs = parseInt(match[1], 10);
        if (!isNaN(yrs) && yrs <= 25) found.push(yrs);
      }
    }
    return found.length > 0 ? Math.min(...found) : null;
  }

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
      const ghCompanyParam = selectedCompanies.length > 0
        ? `&companies=${selectedCompanies.map((c) => c.slug).join(",")}`
        : "";
      const data = await fetch(
        `/api/greenhouse?query=${encodeURIComponent(jobQuery.trim())}${ghCompanyParam}`
      ).then((r) => r.json());

      const ghJobs = data.jobs || [];
      if (ghJobs.length === 0) throw new Error(data.error || "No jobs found.");

      hasFetchedRef.current = true;
      setJobResults(ghJobs);
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

  async function handleToggleApplied(job) {
    const jobId = typeof job === "string" ? job : job.id;
    const isApplied = appliedJobIds.has(jobId);

    // Optimistic update
    setAppliedJobIds((prev) => {
      const next = new Set(prev);
      if (isApplied) next.delete(jobId);
      else {
        next.add(jobId);
        handleUntrackJob(jobId);
      }
      return next;
    });

    if (currentUser) {
      const supabase = createClient();
      if (isApplied) {
        await supabase
          .from("applied_jobs")
          .delete()
          .eq("user_id", currentUser.id)
          .eq("job_id", jobId);
      } else {
        await supabase.from("applied_jobs").upsert(
          {
            user_id: currentUser.id,
            job_id: jobId,
            job_title: job.title,
            company: job.company,
            job_url: job.url,
            job_description: job.description,
          },
          { onConflict: "user_id,job_id" },
        );
      }
    } else {
      // Not signed in — persist to localStorage
      setAppliedJobIds((current) => {
        localStorage.setItem("appliedJobIds", JSON.stringify([...current]));
        return current;
      });
    }
  }

  function handleToolbarScroll() {
    const el = toolbarScrollRef.current;
    if (!el) return;
    setToolbarCanScrollLeft(el.scrollLeft > 0);
    setToolbarCanScrollRight(el.scrollLeft + el.clientWidth < el.scrollWidth - 1);
  }

  function scrollToolbar(dir) {
    const el = toolbarScrollRef.current;
    if (!el) return;
    el.scrollBy({ left: dir * 320, behavior: "smooth" });
  }

  function handleToolbarWheel(e) {
    const el = toolbarScrollRef.current;
    if (!el || el.scrollWidth <= el.clientWidth) return;
    e.preventDefault();
    el.scrollBy({ left: e.deltaY > 0 ? 120 : -120, behavior: "smooth" });
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
            onChange={async (event) => {
              const file = event.target.files?.[0] || null;
              setResumeFile(file);
              if (file && currentUser) {
                const supabase = createClient();
                await supabase.storage
                  .from("resumes")
                  .upload(`${currentUser.id}/resume`, file, { upsert: true });
              }
            }}
          />
          {resumeFile && (
            <>
              <div style={{ fontSize: 13, color: "var(--text-secondary)", marginTop: 4 }}>
                Last uploaded: {resumeFile.name}
              </div>
              <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 2 }}>
                Unless you upload a different resume file, this will be used for all tailoring and downloads.
              </div>
            </>
          )}
                  
        
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
            onChange={async (event) => {
              const file = event.target.files?.[0] || null;
              setCoverLetterFile(file);
              if (file && currentUser) {
                const supabase = createClient();
                await supabase.storage
                  .from("resumes")
                  .upload(`${currentUser.id}/cover-letter`, file, { upsert: true });
              }
            }}
          />
          {coverLetterFile && (
            <div style={{ fontSize: 13, color: "var(--text-secondary)", marginTop: 4 }}>
              Last uploaded: {coverLetterFile.name}
            </div>
          )}
          <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 2 }}>
            Unless you upload a different cover letter file, this will be used for all tailoring and downloads.
          </div>
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
              <FormControl size="small" sx={{ minWidth: 150, alignSelf: "flex-start" }}>
                <InputLabel>Experience</InputLabel>
                <Select
                  label="Experience"
                  value={maxYearsExp}
                  onChange={(e) => setMaxYearsExp(e.target.value)}
                >
                  <MenuItem value="any">Any experience</MenuItem>
                  <MenuItem value="0">Entry level (0 yrs)</MenuItem>
                  <MenuItem value="1">Up to 1 yr</MenuItem>
                  <MenuItem value="2">Up to 2 yrs</MenuItem>
                  <MenuItem value="3">Up to 3 yrs</MenuItem>
                  <MenuItem value="5">Up to 5 yrs</MenuItem>
                  <MenuItem value="7">Up to 7 yrs</MenuItem>
                  <MenuItem value="10">Up to 10 yrs</MenuItem>
                </Select>
              </FormControl>
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
              const yearsFiltered =
                maxYearsExp === "any"
                  ? jobResults
                  : jobResults.filter((j) => {
                      const minReq = extractMinYearsRequired(j.description);
                      if (minReq === null) return true;
                      return minReq <= parseInt(maxYearsExp, 10);
                    });
              const visibleJobs = yearsFiltered.filter((j) => !ignoredJobIds.has(j.id));
              const ignoredInResults = yearsFiltered.filter((j) => ignoredJobIds.has(j.id));
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
                          <div key={job.id} id={`job-card-${job.id}`} className={`${styles.jobCard}${isApplied ? ` ${styles.jobCardApplied}` : ""}${highlightedJobId === job.id ? ` ${styles.jobCardHighlighted}` : ""}`}>
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
                                  onClick={() => handleToggleApplied(job)}
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
        <div className={styles.floatingToolbar} onWheel={handleToolbarWheel}>
          <span className={styles.toolbarLabel}>Generated ({trackedJobs.length})</span>
          <button
            type="button"
            className={`${styles.toolbarArrow} ${!toolbarCanScrollLeft ? styles.toolbarArrowHidden : ""}`}
            onClick={() => scrollToolbar(-1)}
            aria-label="Scroll left"
          >
            ‹
          </button>
          <div
            className={styles.toolbarItems}
            ref={toolbarScrollRef}
            onScroll={handleToolbarScroll}
          >
            {trackedJobs.map((job) => {
              const tailoring = tailoringMap[job.id] || {};
              const status = tailoring.status;
              const fullJob = jobResults.find((j) => j.id === job.id);
              const isTailoringChip = status === "tailoring";
              const canRegenerate = !!resumeFile && !!fullJob && !isTailoringChip;
              return (
                <div
                  key={job.id}
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
                  <div className={styles.toolbarChipActions}>
                    <button
                      type="button"
                      className={styles.toolbarChipBtn}
                      title="Go to card"
                      onClick={() => {
                        const card = document.getElementById(`job-card-${job.id}`);
                        if (card) card.scrollIntoView({ behavior: "smooth", block: "center" });
                        setHighlightedJobId(job.id);
                        setTimeout(() => setHighlightedJobId(null), 3000);
                      }}
                    >
                      ↩
                    </button>
                    <a
                      href={job.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className={styles.toolbarChipBtn}
                      title="View posting"
                    >
                      ↗
                    </a>
                    <button
                      type="button"
                      className={styles.toolbarChipBtn}
                      title={canRegenerate ? "Regenerate" : !resumeFile ? "Upload a resume first" : "Regenerate"}
                      disabled={!canRegenerate}
                      onClick={() => fullJob && handleTailorJob(fullJob)}
                    >
                      ↺
                    </button>
                    <button
                      type="button"
                      className={styles.toolbarChipBtn}
                      title="Mark as applied"
                      onClick={() => handleToggleApplied(job)}
                    >
                      ✓
                    </button>
                    <button
                      type="button"
                      className={styles.toolbarChipBtn}
                      title="Ignore"
                      onClick={() => { handleIgnoreJob(job.id); handleUntrackJob(job.id); }}
                    >
                      ⊗
                    </button>
                    <button
                      type="button"
                      className={styles.toolbarChipRemove}
                      title="Remove"
                      onClick={() => handleUntrackJob(job.id)}
                      aria-label="Remove"
                    >
                      ×
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
          <button
            type="button"
            className={`${styles.toolbarArrow} ${!toolbarCanScrollRight ? styles.toolbarArrowHidden : ""}`}
            onClick={() => scrollToolbar(1)}
            aria-label="Scroll right"
          >
            ›
          </button>
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
