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
import CircularProgress from "@mui/material/CircularProgress";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableContainer from "@mui/material/TableContainer";
import TableHead from "@mui/material/TableHead";
import TableRow from "@mui/material/TableRow";
import { GREENHOUSE_COMPANIES, COMPANY_CATEGORIES } from "../lib/greenhouse/companies";
import { createClient } from "../lib/supabase/client";
import { upsertPosition } from "../lib/supabase/upsertPosition";
import { upsertApplication, getPositionId } from "../lib/supabase/upsertApplication";
import { saveGeneratedResume } from "../lib/supabase/saveGeneratedResume";
import { getInterviewStages, upsertInterviewStage } from "../lib/supabase/upsertInterviewStage";

const WORDPROCESSINGML_NS =
  "http://schemas.openxmlformats.org/wordprocessingml/2006/main";

// Renders plain-text content (job descriptions, resumes) with basic structure.
function FormattedContent({ text, kind }) {
  if (!text) return null;
  const blocks = text.split(/\n{2,}/);
  return (
    <Box sx={{ fontSize: 13.5, lineHeight: 1.75, color: "inherit" }}>
      {blocks.map((block, i) => {
        const lines = block.split("\n").map((l) => l.trimEnd()).filter((l, idx, arr) => idx > 0 || l !== "");
        if (lines.length === 0) return null;

        // Single-line block that looks like a section heading
        if (lines.length === 1) {
          const line = lines[0].trim();
          const isHeading =
            line.length > 0 &&
            line.length < 80 &&
            (line === line.toUpperCase() || /^[A-Z][^a-z]{2,}$/.test(line) || line.endsWith(":"));
          if (isHeading) {
            return (
              <Box
                key={i}
                sx={{
                  fontWeight: 700,
                  fontSize: kind === "resume" ? 14 : 13.5,
                  mt: i > 0 ? 2.5 : 0,
                  mb: 0.5,
                  borderBottom: kind === "resume" ? "1px solid rgba(0,0,0,0.12)" : "none",
                  pb: kind === "resume" ? 0.25 : 0,
                  letterSpacing: 0.3,
                }}
              >
                {line.endsWith(":") ? line.slice(0, -1) : line}
              </Box>
            );
          }
        }

        // Block where majority of lines are bullet points
        const bulletLines = lines.filter((l) => /^\s*[-•*–·]\s/.test(l));
        if (bulletLines.length > 0 && bulletLines.length >= Math.ceil(lines.length * 0.5)) {
          return (
            <Box
              key={i}
              component="ul"
              sx={{ m: 0, mt: i > 0 ? 1 : 0, pl: 2.5, "& li": { mb: 0.4 } }}
            >
              {lines.map((line, j) => {
                const clean = line.replace(/^\s*[-•*–·]\s*/, "").trim();
                if (!clean) return null;
                return <li key={j}>{clean}</li>;
              })}
            </Box>
          );
        }

        // Regular paragraph / block
        return (
          <Box key={i} sx={{ mt: i > 0 ? 1.5 : 0, whiteSpace: "pre-wrap" }}>
            {block.trim()}
          </Box>
        );
      })}
    </Box>
  );
}

const STAGE_TYPE_OPTIONS = [
  ["phone_screen", "Phone Screen"],
  ["technical", "Technical"],
  ["behavioral", "Behavioral"],
  ["system_design", "System Design"],
  ["hiring_manager", "Hiring Manager"],
  ["panel", "Panel"],
  ["offer_call", "Offer Call"],
  ["other", "Other"],
];

const STAGE_TYPE_LABELS = Object.fromEntries(STAGE_TYPE_OPTIONS);

const STAGE_OUTCOME_OPTIONS = [
  ["pending", "Pending"],
  ["passed", "Passed"],
  ["failed", "Failed"],
  ["cancelled", "Cancelled"],
];

function createStageDialogState(overrides = {}) {
  return {
    open: false,
    applicationId: null,
    stageId: null,
    stageName: "",
    stageType: "phone_screen",
    scheduledAt: "",
    completedAt: "",
    durationMinutes: "",
    outcome: "pending",
    interviewerNames: "",
    notes: "",
    ...overrides,
  };
}

function formatDateTimeLocalInputValue(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (part) => String(part).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

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
  const [mainTab, setMainTab] = useState("applying");
  const [applicationData, setApplicationData] = useState([]);
  const [applicationLoading, setApplicationLoading] = useState(false);
  const [applicationError, setApplicationError] = useState(null);
  const [applicationStages, setApplicationStages] = useState({});
  const [appDialog, setAppDialog] = useState({ open: false, rowIndex: null, kind: "jd" });
  const [stageDialog, setStageDialog] = useState(createStageDialogState());
  const [stageSaving, setStageSaving] = useState(false);
  const [stageError, setStageError] = useState("");

  // Refs for targeted re-fetches when individual controls change
  const hasFetchedRef = useRef(false);
  const activeQueryRef = useRef("");
  const toolbarScrollRef = useRef(null);

  useEffect(() => {
    const saved = localStorage.getItem("activeSection");
    if (saved === "search" || saved === "url" || saved === "manual") {
      setActiveSection(saved);
    }
    const savedTab = localStorage.getItem("mainTab");
    if (savedTab === "applying" || savedTab === "interviewing") {
      setMainTab(savedTab);
    }
  }, []);

  useEffect(() => {
    localStorage.setItem("activeSection", activeSection);
  }, [activeSection]);

  useEffect(() => {
    localStorage.setItem("mainTab", mainTab);
  }, [mainTab]);

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

        // Load applied jobs from applications table
        const { data: appliedData } = await supabase
          .from("applications")
          .select("positions(external_id)")
          .eq("user_id", user.id)
          .eq("status", "applied");
        if (appliedData) {
          setAppliedJobIds(new Set(appliedData.map((a) => a.positions?.external_id).filter(Boolean)));
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
      // Support both known company slugs and custom company names
      let ghCompanyParam = "";
      if (selectedCompanies.length > 0) {
        const slugs = selectedCompanies.filter((c) => typeof c !== "string").map((c) => c.slug);
        const names = selectedCompanies.filter((c) => typeof c === "string").map((c) => c);
        if (slugs.length > 0) {
          ghCompanyParam += `&companies=${slugs.join(",")}`;
        }
        if (names.length > 0) {
          ghCompanyParam += names.map((n) => `&companyName=${encodeURIComponent(n)}`).join("");
        }
      }
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

  async function loadStagesForApplication(applicationId) {
    if (!applicationId) return;
    const supabase = createClient();
    const stages = await getInterviewStages(supabase, applicationId);
    setApplicationStages((prev) => ({
      ...prev,
      [applicationId]: stages,
    }));
  }

  async function handleSaveStage() {
    if (!currentUser || !stageDialog.applicationId) return;

    setStageSaving(true);
    setStageError("");

    const supabase = createClient();
    const savedStageId = await upsertInterviewStage(supabase, {
      userId: currentUser.id,
      applicationId: stageDialog.applicationId,
      stageId: stageDialog.stageId || undefined,
      stageName: (stageDialog.stageName || STAGE_TYPE_LABELS[stageDialog.stageType] || "Interview Stage").trim(),
      stageType: stageDialog.stageType,
      scheduledAt: stageDialog.scheduledAt ? new Date(stageDialog.scheduledAt).toISOString() : undefined,
      completedAt: stageDialog.completedAt ? new Date(stageDialog.completedAt).toISOString() : undefined,
      durationMinutes: stageDialog.durationMinutes ? parseInt(stageDialog.durationMinutes, 10) : undefined,
      outcome: stageDialog.outcome,
      interviewerNames: stageDialog.interviewerNames
        .split(",")
        .map((name) => name.trim())
        .filter(Boolean),
      notes: stageDialog.notes.trim() || undefined,
    });

    if (!savedStageId) {
      setStageError("Unable to save interview stage.");
      setStageSaving(false);
      return;
    }

    await loadStagesForApplication(stageDialog.applicationId);
    setStageDialog(createStageDialogState());
    setStageSaving(false);
  }

  useEffect(() => {
    if (mainTab !== "interviewing" || !currentUser) return;
    let cancelled = false;
    async function loadApplications() {
      setApplicationLoading(true);
      setApplicationError(null);
      const supabase = createClient();

      // Step 1: fetch applications + positions
      const { data: appRows, error: appErr } = await supabase
        .from("applications")
        .select(`
          id, status, applied_at, tracked_at, notes, application_url, resume_used_id,
          positions ( external_id, title, company, description, url )
        `)
        .eq("user_id", currentUser.id)
        .neq("status", "tracking")
        .order("applied_at", { ascending: false });

      if (appErr) {
        console.error("[loadApplications] applications query failed:", appErr);
        if (!cancelled) {
          setApplicationError(appErr.message);
          setApplicationLoading(false);
        }
        return;
      }

      // Step 2: fetch resumes for rows that have one
      const resumeIds = (appRows || []).map((r) => r.resume_used_id).filter(Boolean);
      let resumeMap = {};
      if (resumeIds.length > 0) {
        const { data: resumeRows, error: resumeErr } = await supabase
          .from("generated_resumes")
          .select("id, content")
          .in("id", resumeIds);
        if (resumeErr) {
          console.warn("[loadApplications] resume fetch failed (non-fatal):", resumeErr);
        } else {
          resumeMap = Object.fromEntries((resumeRows || []).map((r) => [r.id, r]));
        }
      }

      const merged = (appRows || []).map((app) => ({
        ...app,
        generated_resumes: app.resume_used_id ? (resumeMap[app.resume_used_id] ?? null) : null,
      }));

      const appIds = merged.map((app) => app.id).filter(Boolean);
      let nextStageMap = {};
      if (appIds.length > 0) {
        const { data: stageRows, error: stageErr } = await supabase
          .from("interview_stages")
          .select("id, application_id, stage_name, stage_type, scheduled_at, completed_at, duration_minutes, outcome, interviewer_names, notes, created_at, updated_at")
          .in("application_id", appIds)
          .order("scheduled_at", { ascending: false });

        if (stageErr) {
          console.warn("[loadApplications] stage fetch failed (non-fatal):", stageErr);
        } else {
          nextStageMap = (stageRows || []).reduce((acc, stage) => {
            if (!acc[stage.application_id]) acc[stage.application_id] = [];
            acc[stage.application_id].push(stage);
            return acc;
          }, {});
        }
      }

      if (!cancelled) {
        setApplicationData(merged);
        setApplicationStages(nextStageMap);
        setApplicationLoading(false);
      }
    }
    loadApplications();
    return () => { cancelled = true; };
  }, [mainTab, currentUser]);

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
      // Support both known company slugs and custom company names
      let ghCompanyParam = "";
      if (selectedCompanies.length > 0) {
        const slugs = selectedCompanies.filter((c) => typeof c !== "string").map((c) => c.slug);
        const names = selectedCompanies.filter((c) => typeof c === "string").map((c) => c);
        if (slugs.length > 0) {
          ghCompanyParam += `&companies=${slugs.join(",")}`;
        }
        if (names.length > 0) {
          ghCompanyParam += names.map((n) => `&companyName=${encodeURIComponent(n)}`).join("");
        }
      }
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
        // Un-apply: revert application status to tracking
        const positionId = await getPositionId(supabase, jobId);
        if (positionId) {
          await upsertApplication(supabase, { userId: currentUser.id, positionId, status: "tracking" });
        }
      } else {
        // Apply: upsert position → upsert application as applied
        const positionId = typeof job !== "string" ? await upsertPosition(supabase, job) : null;
        if (positionId) {
          await upsertApplication(supabase, { userId: currentUser.id, positionId, status: "applied" });
        }
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

  async function handleTrackJob(job) {
    setTrackedJobs((prev) => {
      if (prev.some((j) => j.id === job.id)) return prev;
      return [...prev, { id: job.id, title: job.title, company: job.company, url: job.url }];
    });
    if (currentUser && typeof job === "object") {
      const supabase = createClient();
      const positionId = await upsertPosition(supabase, job);
      if (positionId) {
        await upsertApplication(supabase, { userId: currentUser.id, positionId, status: "tracking" });
      }
    }
  }

  async function handleUntrackJob(jobId) {
    setTrackedJobs((prev) => prev.filter((j) => j.id !== jobId));
    if (currentUser) {
      const supabase = createClient();
      const positionId = await getPositionId(supabase, jobId);
      if (positionId) {
        // Only delete if still in tracking state — leave applied rows intact
        await supabase
          .from("applications")
          .delete()
          .eq("user_id", currentUser.id)
          .eq("position_id", positionId)
          .eq("status", "tracking");
      }
    }
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

      // Persist the generated resume and link it to the application
      if (currentUser) {
        const supabase = createClient();
        const positionId = await getPositionId(supabase, job.id);
        const generatedResumeId = await saveGeneratedResume(supabase, {
          userId: currentUser.id,
          positionId,
          content: result,
          contentLines: resultLines,
          sourceResumePath: `${currentUser.id}/resume`,
          additionalContext: additionalContext || null,
        });
        if (generatedResumeId && positionId) {
          await supabase
            .from("applications")
            .update({ resume_used_id: generatedResumeId })
            .eq("user_id", currentUser.id)
            .eq("position_id", positionId);
        }
      }

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

      // Persist the generated resume (no position linked for URL flow)
      if (currentUser) {
        const supabase = createClient();
        await saveGeneratedResume(supabase, {
          userId: currentUser.id,
          positionId: null,
          content: nextResult,
          contentLines: nextResultLines,
          sourceResumePath: `${currentUser.id}/resume`,
          additionalContext: additionalContext || null,
        });
      }

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

      // Persist the generated resume (no position linked for manual flow)
      if (currentUser) {
        const supabase = createClient();
        await saveGeneratedResume(supabase, {
          userId: currentUser.id,
          positionId: null,
          content: nextResult,
          contentLines: nextResultLines,
          sourceResumePath: `${currentUser.id}/resume`,
          additionalContext: additionalContext || null,
        });
      }

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

        <div className={styles.mainTabs}>
          <button
            type="button"
            className={mainTab === "applying" ? styles.mainTabActive : styles.mainTab}
            onClick={() => setMainTab("applying")}
          >
            Applying
          </button>
          <button
            type="button"
            className={mainTab === "interviewing" ? styles.mainTabActive : styles.mainTab}
            onClick={() => setMainTab("interviewing")}
          >
            Interviewing
          </button>
        </div>

        {mainTab === "applying" && (
          <>

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
            <>
              <div style={{ fontSize: 13, color: "var(--text-secondary)", marginTop: 4 }}>
                Last uploaded: {coverLetterFile.name}
              </div>
              <div style={{ fontSize: 12, color: "var(--text-muted)", marginTop: 2 }}>
                Unless you upload a different cover letter file, this will be used for all tailoring and downloads.
              </div>
            </>
          )}
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
                freeSolo
                options={GREENHOUSE_COMPANIES}
                getOptionLabel={(option) => typeof option === "string" ? option : option.name}
                value={selectedCompanies}
                onChange={(_, newValue) => {
                  setSelectedCompanies(
                    newValue.map((entry) => {
                      if (typeof entry === "string") {
                        // Try to match to a known company
                        const match = GREENHOUSE_COMPANIES.find((c) => c.name.toLowerCase() === entry.toLowerCase());
                        return match || entry;
                      }
                      return entry;
                    })
                  );
                }}
                isOptionEqualToValue={(option, value) => {
                  if (typeof option === "string" || typeof value === "string") return option === value;
                  return option.slug === value.slug;
                }}
                renderInput={(params) => (
                  <TextField
                    {...params}
                    size="small"
                    label="Companies"
                    placeholder={selectedCompanies.length === 0 ? "All Greenhouse companies" : ""}
                  />
                )}
                renderTags={(value, getTagProps) =>
                  value.map((option, index) => {
                    const label = typeof option === "string" ? option : option.name;
                    return <Chip key={label} label={label} size="small" {...getTagProps({ index })} />;
                  })
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

          </>
        )}

        {mainTab === "interviewing" && (
          <section className={styles.tabPanel}>
            {!currentUser ? (
              <p style={{ color: "var(--text-secondary)" }}>Sign in to see your applications.</p>
            ) : applicationLoading ? (
              <Box sx={{ display: "flex", justifyContent: "center", py: 4 }}>
                <CircularProgress />
              </Box>
            ) : applicationError ? (
              <p style={{ color: "var(--error, #d32f2f)" }}>Error loading applications: {applicationError}</p>
            ) : applicationData.length === 0 ? (
              <p style={{ color: "var(--text-secondary)" }}>No applications yet. Apply to jobs in the Applying tab.</p>
            ) : (
              <TableContainer>
                <Table size="small">
                  <TableHead>
                    <TableRow>
                      <TableCell sx={{ fontWeight: 700 }}>Company</TableCell>
                      <TableCell sx={{ fontWeight: 700 }}>Role</TableCell>
                      <TableCell sx={{ fontWeight: 700 }}>Status</TableCell>
                      <TableCell sx={{ fontWeight: 700 }}>Applied</TableCell>
                      <TableCell sx={{ fontWeight: 700 }}>Job Description</TableCell>
                      <TableCell sx={{ fontWeight: 700 }}>Your Resume</TableCell>
                      <TableCell sx={{ fontWeight: 700 }}>Notes</TableCell>
                      <TableCell sx={{ fontWeight: 700 }}>Links</TableCell>
                    </TableRow>
                  </TableHead>
                  <TableBody>
                    {applicationData.map((app, idx) => {
                      const pos = app.positions;
                      const resume = app.generated_resumes;
                      const stages = applicationStages[app.id] || [];
                      const statusConfig = {
                        applied:       { label: "Applied",       color: "primary" },
                        phone_screen:  { label: "Phone Screen",  color: "info" },
                        interviewing:  { label: "Interviewing",  color: "warning" },
                        offer:         { label: "Offer",         color: "secondary" },
                        accepted:      { label: "Accepted",      color: "success" },
                        rejected:      { label: "Rejected",      color: "error" },
                        withdrawn:     { label: "Withdrawn",     color: "default" },
                      }[app.status] || { label: app.status, color: "default" };
                      return (
                        <TableRow key={app.id} hover>
                          <TableCell sx={{ fontWeight: 600, whiteSpace: "nowrap" }}>
                            {pos?.company || "—"}
                          </TableCell>
                          <TableCell sx={{ whiteSpace: "nowrap" }}>
                            {pos?.title || "—"}
                          </TableCell>
                          <TableCell>
                            <Box sx={{ display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 0.75 }}>
                              <Box sx={{ display: "flex", alignItems: "center", gap: 0.75, flexWrap: "wrap" }}>
                                <Chip label={statusConfig.label} color={statusConfig.color} size="small" />
                                <Button
                                  size="small"
                                  sx={{ minWidth: 0, p: 0, fontSize: 11 }}
                                  onClick={() => {
                                    setStageError("");
                                    setStageDialog(createStageDialogState({
                                      open: true,
                                      applicationId: app.id,
                                    }));
                                  }}
                                >
                                  + Stage
                                </Button>
                              </Box>
                              {stages.length > 0 ? (
                                <Box sx={{ display: "flex", alignItems: "center", gap: 0.5, flexWrap: "wrap" }}>
                                  {stages.slice(0, 2).map((stage) => {
                                    const stageLabel = `${stage.stage_name || STAGE_TYPE_LABELS[stage.stage_type] || stage.stage_type}${stage.outcome && stage.outcome !== "pending" ? ` · ${stage.outcome}` : ""}`;
                                    return (
                                      <Chip
                                        key={stage.id}
                                        label={stageLabel}
                                        size="small"
                                        variant="outlined"
                                        onClick={() => {
                                          setStageError("");
                                          setStageDialog(createStageDialogState({
                                            open: true,
                                            applicationId: app.id,
                                            stageId: stage.id,
                                            stageName: stage.stage_name || "",
                                            stageType: stage.stage_type || "phone_screen",
                                            scheduledAt: formatDateTimeLocalInputValue(stage.scheduled_at),
                                            completedAt: formatDateTimeLocalInputValue(stage.completed_at),
                                            durationMinutes: stage.duration_minutes ? String(stage.duration_minutes) : "",
                                            outcome: stage.outcome || "pending",
                                            interviewerNames: (stage.interviewer_names || []).join(", "),
                                            notes: stage.notes || "",
                                          }));
                                        }}
                                      />
                                    );
                                  })}
                                  {stages.length > 2 ? (
                                    <Box component="span" sx={{ fontSize: 12, color: "var(--text-secondary)" }}>
                                      +{stages.length - 2} more
                                    </Box>
                                  ) : null}
                                </Box>
                              ) : null}
                            </Box>
                          </TableCell>
                          <TableCell sx={{ whiteSpace: "nowrap" }}>
                            {app.applied_at
                              ? new Date(app.applied_at).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" })
                              : "—"}
                          </TableCell>
                          <TableCell sx={{ maxWidth: 220 }}>
                            {pos?.description ? (
                              <Box sx={{ display: "flex", alignItems: "flex-start", gap: 0.5, flexDirection: "column" }}>
                                <span style={{ fontSize: 12, color: "var(--text-secondary)", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>
                                  {pos.description}
                                </span>
                                <Button size="small" sx={{ p: 0, minWidth: 0, fontSize: 11 }}
                                  onClick={() => setAppDialog({ open: true, rowIndex: idx, kind: "jd" })}>
                                  View full
                                </Button>
                              </Box>
                            ) : "—"}
                          </TableCell>
                          <TableCell sx={{ maxWidth: 200 }}>
                            {resume?.content ? (
                              <Box sx={{ display: "flex", alignItems: "flex-start", gap: 0.5, flexDirection: "column" }}>
                                <span style={{ fontSize: 12, color: "var(--text-secondary)", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>
                                  {resume.content}
                                </span>
                                <Button size="small" sx={{ p: 0, minWidth: 0, fontSize: 11 }}
                                  onClick={() => setAppDialog({ open: true, rowIndex: idx, kind: "resume" })}>
                                  View full
                                </Button>
                              </Box>
                            ) : "—"}
                          </TableCell>
                          <TableCell sx={{ maxWidth: 160, fontSize: 12, color: "var(--text-secondary)" }}>
                            {app.notes || "—"}
                          </TableCell>
                          <TableCell>
                            {(app.application_url || pos?.url) && (
                              <Button size="small" href={app.application_url || pos.url}
                                target="_blank" rel="noopener noreferrer" sx={{ whiteSpace: "nowrap" }}>
                                Posting ↗
                              </Button>
                            )}
                          </TableCell>
                        </TableRow>
                      );
                    })}
                  </TableBody>
                </Table>
              </TableContainer>
            )}

            <Dialog
              open={stageDialog.open}
              onClose={() => {
                setStageError("");
                setStageDialog(createStageDialogState());
              }}
              maxWidth="sm"
              fullWidth
            >
              <DialogTitle>{stageDialog.stageId ? "Edit Interview Stage" : "Add Interview Stage"}</DialogTitle>
              <DialogContent dividers sx={{ display: "flex", flexDirection: "column", gap: 2, pt: 2 }}>
                <TextField
                  label="Stage Name"
                  value={stageDialog.stageName}
                  onChange={(e) => setStageDialog((prev) => ({ ...prev, stageName: e.target.value }))}
                  fullWidth
                  size="small"
                  placeholder="e.g. Technical Round 1"
                />
                <FormControl fullWidth size="small">
                  <InputLabel id="stage-type-label">Type</InputLabel>
                  <Select
                    labelId="stage-type-label"
                    value={stageDialog.stageType}
                    label="Type"
                    onChange={(e) => setStageDialog((prev) => ({ ...prev, stageType: e.target.value }))}
                  >
                    {STAGE_TYPE_OPTIONS.map(([value, label]) => (
                      <MenuItem key={value} value={value}>{label}</MenuItem>
                    ))}
                  </Select>
                </FormControl>
                <TextField
                  type="datetime-local"
                  label="Scheduled"
                  value={stageDialog.scheduledAt}
                  onChange={(e) => setStageDialog((prev) => ({ ...prev, scheduledAt: e.target.value }))}
                  fullWidth
                  size="small"
                  InputLabelProps={{ shrink: true }}
                />
                <TextField
                  type="datetime-local"
                  label="Completed"
                  value={stageDialog.completedAt}
                  onChange={(e) => setStageDialog((prev) => ({ ...prev, completedAt: e.target.value }))}
                  fullWidth
                  size="small"
                  InputLabelProps={{ shrink: true }}
                />
                <TextField
                  type="number"
                  label="Duration (minutes)"
                  value={stageDialog.durationMinutes}
                  onChange={(e) => setStageDialog((prev) => ({ ...prev, durationMinutes: e.target.value }))}
                  fullWidth
                  size="small"
                />
                <FormControl fullWidth size="small">
                  <InputLabel id="stage-outcome-label">Outcome</InputLabel>
                  <Select
                    labelId="stage-outcome-label"
                    value={stageDialog.outcome}
                    label="Outcome"
                    onChange={(e) => setStageDialog((prev) => ({ ...prev, outcome: e.target.value }))}
                  >
                    {STAGE_OUTCOME_OPTIONS.map(([value, label]) => (
                      <MenuItem key={value} value={value}>{label}</MenuItem>
                    ))}
                  </Select>
                </FormControl>
                <TextField
                  label="Interviewer Names"
                  value={stageDialog.interviewerNames}
                  onChange={(e) => setStageDialog((prev) => ({ ...prev, interviewerNames: e.target.value }))}
                  fullWidth
                  size="small"
                  placeholder="Comma-separated names"
                  helperText="Separate multiple names with commas"
                />
                <TextField
                  label="Notes"
                  value={stageDialog.notes}
                  onChange={(e) => setStageDialog((prev) => ({ ...prev, notes: e.target.value }))}
                  fullWidth
                  multiline
                  rows={4}
                  size="small"
                />
                {stageError ? (
                  <p style={{ color: "var(--error, #d32f2f)", margin: 0 }}>{stageError}</p>
                ) : null}
              </DialogContent>
              <DialogActions>
                <Button
                  onClick={() => {
                    setStageError("");
                    setStageDialog(createStageDialogState());
                  }}
                >
                  Cancel
                </Button>
                <Button
                  variant="contained"
                  onClick={handleSaveStage}
                  disabled={stageSaving}
                >
                  {stageSaving ? "Saving..." : "Save Stage"}
                </Button>
              </DialogActions>
            </Dialog>

            {(() => {
              const dApp = appDialog.rowIndex != null ? applicationData[appDialog.rowIndex] : null;
              const dPos = dApp?.positions;
              const dResume = dApp?.generated_resumes;
              const pages = [
                dPos?.description ? "jd" : null,
                dResume?.content ? "resume" : null,
              ].filter(Boolean);
              const pageIdx = pages.indexOf(appDialog.kind);
              const dialogTitle = appDialog.kind === "jd"
                ? `${dPos?.company || ""} — Job Description`
                : `Your Resume — ${dPos?.title || "Role"}`;
              const dialogContent = appDialog.kind === "jd"
                ? (dPos?.description ?? "")
                : (dResume?.content ?? "");
              const navigate = (dir) => {
                const next = pageIdx + dir;
                if (next >= 0 && next < pages.length) {
                  setAppDialog((prev) => ({ ...prev, kind: pages[next] }));
                }
              };
              return (
                <Dialog
                  open={appDialog.open}
                  onClose={() => setAppDialog({ open: false, rowIndex: null, kind: "jd" })}
                  maxWidth="md"
                  fullWidth
                  PaperProps={{
                    onKeyDown: (e) => {
                      if (e.key === "ArrowRight") navigate(1);
                      if (e.key === "ArrowLeft") navigate(-1);
                    },
                    tabIndex: -1,
                  }}
                >
                  <DialogTitle sx={{ pb: 1 }}>
                    <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                      <Button
                        size="small"
                        disabled={pageIdx <= 0}
                        onClick={() => navigate(-1)}
                        sx={{ minWidth: 36, px: 0.75, fontSize: 22, lineHeight: 1 }}
                        aria-label="Previous"
                      >
                        ‹
                      </Button>
                      <Box sx={{ flex: 1, fontWeight: 700, fontSize: "1rem" }}>
                        {dialogTitle}
                        {pages.length > 1 && (
                          <Box component="span" sx={{ ml: 1.5, fontSize: 12, fontWeight: 400, color: "text.secondary" }}>
                            {pageIdx + 1} / {pages.length}
                          </Box>
                        )}
                      </Box>
                      <Button
                        size="small"
                        disabled={pageIdx >= pages.length - 1}
                        onClick={() => navigate(1)}
                        sx={{ minWidth: 36, px: 0.75, fontSize: 22, lineHeight: 1 }}
                        aria-label="Next"
                      >
                        ›
                      </Button>
                    </Box>
                  </DialogTitle>
                  <DialogContent dividers sx={{ maxHeight: "70vh" }}>
                    <FormattedContent text={dialogContent} kind={appDialog.kind} />
                  </DialogContent>
                  <DialogActions>
                    <Button onClick={() => setAppDialog({ open: false, rowIndex: null, kind: "jd" })}>
                      Close
                    </Button>
                  </DialogActions>
                </Dialog>
              );
            })()}
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
