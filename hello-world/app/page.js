"use client";

import { useState, useEffect, useRef, useMemo } from "react";
import JSZip from "jszip";
import styles from "./page.module.css";
import JobDescriptionTab from "./components/JobDescriptionTab";
import PostingUrlTab from "./components/PostingUrlTab";
import AutoTailorTab from "./components/AutoTailorTab";
import ApplyingControls from "./components/ApplyingControls";
import Accordion from "@mui/material/Accordion";
import AccordionDetails from "@mui/material/AccordionDetails";
import AccordionSummary from "@mui/material/AccordionSummary";
import Box from "@mui/material/Box";
import Checkbox from "@mui/material/Checkbox";
import Button from "@mui/material/Button";
import FormControl from "@mui/material/FormControl";
import InputLabel from "@mui/material/InputLabel";
import MenuItem from "@mui/material/MenuItem";
import Select from "@mui/material/Select";
import TextField from "@mui/material/TextField";
import IconButton from "@mui/material/IconButton";
import Tooltip from "@mui/material/Tooltip";
import Autocomplete from "@mui/material/Autocomplete";
import Chip from "@mui/material/Chip";
import DescriptionIcon from "@mui/icons-material/Description";
import Badge from "@mui/material/Badge";
import Menu from "@mui/material/Menu";
import FormControlLabel from "@mui/material/FormControlLabel";
import Switch from "@mui/material/Switch";
import CircularProgress from "@mui/material/CircularProgress";
import Dialog from "@mui/material/Dialog";
import DialogActions from "@mui/material/DialogActions";
import DialogContent from "@mui/material/DialogContent";
import DialogTitle from "@mui/material/DialogTitle";
import Fab from "@mui/material/Fab";
import Slider from "@mui/material/Slider";
import Table from "@mui/material/Table";
import TableBody from "@mui/material/TableBody";
import TableCell from "@mui/material/TableCell";
import TableContainer from "@mui/material/TableContainer";
import TableHead from "@mui/material/TableHead";
import TableRow from "@mui/material/TableRow";
import TableSortLabel from "@mui/material/TableSortLabel";
import { GREENHOUSE_COMPANIES, COMPANY_CATEGORIES } from "../lib/greenhouse/companies";
import { createClient } from "../lib/supabase/client";
import { upsertPosition } from "../lib/supabase/upsertPosition";
import { upsertApplication, getPositionId } from "../lib/supabase/upsertApplication";
import { saveGeneratedResume } from "../lib/supabase/saveGeneratedResume";
import { getInterviewStages, upsertInterviewStage } from "../lib/supabase/upsertInterviewStage";
import { createRecruiterCommunication, listRecruiterCommunications } from "../lib/supabase/recruiterCommunications";

const WORDPROCESSINGML_NS =
  "http://schemas.openxmlformats.org/wordprocessingml/2006/main";

const JOB_DESCRIPTION_HEADINGS = [
  "About the Role",
  "About You",
  "About Us",
  "What You'll Do",
  "What You Will Do",
  "What We're Looking For",
  "What We Are Looking For",
  "Responsibilities",
  "Key Responsibilities",
  "Requirements",
  "Minimum Qualifications",
  "Preferred Qualifications",
  "Qualifications",
  "Nice to Have",
  "Must Have",
  "Skills",
  "Experience",
  "Benefits",
  "Compensation",
  "Interview Process",
  "Equal Opportunity",
];

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function normalizeJobDescriptionText(text) {
  if (!text) return "";

  let normalized = text.replace(/\r\n/g, "\n").replace(/\u00a0/g, " ");

  normalized = normalized.replace(/\s*[•·▪◦]\s*/g, "\n• ");

  for (const heading of JOB_DESCRIPTION_HEADINGS) {
    const pattern = new RegExp(`(^|\\s+)(${escapeRegExp(heading)})(:)?(?=\\s|$)`, "gi");
    normalized = normalized.replace(pattern, (_match, prefix, title, colon) => {
      const suffix = colon ? ":" : "";
      return `${prefix.includes("\n") ? "" : "\n\n"}${title}${suffix}\n`;
    });
  }

  normalized = normalized
    .replace(/\n{3,}/g, "\n\n")
    .split("\n")
    .map((line) => line.replace(/\s+/g, " ").trim())
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  return normalized;
}

// Renders plain-text content (job descriptions, resumes) with basic structure.
function FormattedContent({ text, kind }) {
  if (!text) return null;
  const normalizedText = kind === "jd" ? normalizeJobDescriptionText(text) : text;
  const blocks = normalizedText.split(/\n{2,}/);
  return (
    <Box sx={{ fontSize: kind === "jd" ? 14 : 13.5, lineHeight: kind === "jd" ? 1.8 : 1.75, color: "inherit" }}>
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
                  fontSize: kind === "resume" ? 14 : 14.5,
                  mt: i > 0 ? 2.5 : 0,
                  mb: kind === "jd" ? 1 : 0.5,
                  borderBottom: kind === "resume" ? "1px solid rgba(0,0,0,0.12)" : kind === "jd" ? "1px solid rgba(25, 118, 210, 0.18)" : "none",
                  pb: kind === "resume" ? 0.25 : kind === "jd" ? 0.35 : 0,
                  letterSpacing: kind === "jd" ? 0.15 : 0.3,
                  color: kind === "jd" ? "#163b66" : "inherit",
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
              sx={{ m: 0, mt: i > 0 ? 1 : 0, pl: 2.75, "& li": { mb: kind === "jd" ? 0.8 : 0.4 } }}
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
          <Box
            key={i}
            sx={{
              mt: i > 0 ? 1.5 : 0,
              whiteSpace: "pre-wrap",
              color: kind === "jd" ? "rgba(0, 0, 0, 0.82)" : "inherit",
            }}
          >
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

const AGGRESSIVENESS_MARKS = [
  { value: 1, label: "Light" },
  { value: 3, label: "Balanced" },
  { value: 5, label: "Strong" },
];

function createStageDialogState(overrides = {}) {
  return {
    open: false,
    applicationId: null,
    stageId: null,
    stageName: "",
    stageType: "phone_screen",
    scheduledAt: "",
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

function normalizeInterviewValue(value) {
  return (value || "").trim().toLowerCase();
}

export default function Home() {
  const [resumeFile, setResumeFile] = useState(null);
  const [coverLetterFile, setCoverLetterFile] = useState(null);
  const [additionalContext, setAdditionalContext] = useState("");
  const [contextFiles, setContextFiles] = useState([]);
  const [jobKeywords, setJobKeywords] = useState([]);
  const [jobResults, setJobResults] = useState([]);
  const [isSearching, setIsSearching] = useState(false);
  const [jobSearchError, setJobSearchError] = useState("");
  const [tailoringMap, setTailoringMap] = useState({});
  const [batchTailorState, setBatchTailorState] = useState({
    running: false,
    total: 0,
    completed: 0,
  });
  const [batchTailorDialog, setBatchTailorDialog] = useState({
    open: false,
    candidates: [],
    selectedIds: [],
  });
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
  const [excludedCompanies, setExcludedCompanies] = useState([]);
  const [excludedTitleKeywords, setExcludedTitleKeywords] = useState([]);
  const [selectedCategories, setSelectedCategories] = useState([]);
  const [maxYearsExp, setMaxYearsExp] = useState("any");
  // Saved searches: each entry captures the current values of the search-tab
  // controls so the user can restore them with one click.
  const [savedSearches, setSavedSearches] = useState([]);
  // The id of the saved search whose values currently populate the controls.
  // Cleared as soon as the user modifies any of the search controls.
  const [activeSavedSearchId, setActiveSavedSearchId] = useState(null);
  // Pre-warmed Greenhouse results for saved searches, keyed by saved-search id.
  // Populated in the background after savedSearches loads, then consumed by
  // applySavedSearch so clicking a chip shows results instantly.
  // Shape: { [id]: { jobs: Job[], fetchedAt: number, error: string|null } }
  const [prewarmedResults, setPrewarmedResults] = useState({});
  // Auto-tailored postings shown on the Auto Tailor tab. Populated lazily when the tab is opened.
  const [autoTailoredPostings, setAutoTailoredPostings] = useState([]);
  const [autoTailoredLoading, setAutoTailoredLoading] = useState(false);
  const [autoTailoredError, setAutoTailoredError] = useState(null);
  // In-app notification state (bell UI in header).
  const [notifications, setNotifications] = useState([]);
  const [notifUnreadCount, setNotifUnreadCount] = useState(0);
  const [notifAnchorEl, setNotifAnchorEl] = useState(null);
  const [currentUser, setCurrentUser] = useState(null);
  const [mainTab, setMainTab] = useState("applying");
  const [applicationData, setApplicationData] = useState([]);
  const [applicationLoading, setApplicationLoading] = useState(false);
  const [applicationError, setApplicationError] = useState(null);
  const [applicationStages, setApplicationStages] = useState({});
  const [interviewSearch, setInterviewSearch] = useState("");
  const [interviewSort, setInterviewSort] = useState({ field: null, dir: "asc" });
  // Width (in px) of the frozen columns on the Interviewing tab. User can drag
  // the right edge of each header to resize; persisted to localStorage.
  const [companyColWidth, setCompanyColWidth] = useState(140);
  const [roleColWidth, setRoleColWidth] = useState(180);
  // Position of the floating AI Help FAB; user can drag it anywhere.
  // Stored as offsets from the right/bottom of the viewport (in px).
  const [fabPos, setFabPos] = useState({ right: 24, bottom: 24 });
  const [fabDragging, setFabDragging] = useState(false);
  const fabDragStartRef = useRef(null);
  const [contextPanelOpen, setContextPanelOpen] = useState(false);
  const [aggressiveness, setAggressiveness] = useState(3);
  const [chatOpen, setChatOpen] = useState(false);
  const [chatMessages, setChatMessages] = useState([]);
  const [chatInput, setChatInput] = useState("");
  const [chatSending, setChatSending] = useState(false);
  const [chatError, setChatError] = useState("");
  const [chatPinnedContext, setChatPinnedContext] = useState(null);
  const [chatAttachedFiles, setChatAttachedFiles] = useState([]);
  const [chatAttachError, setChatAttachError] = useState("");
  const [chatCopiedIndex, setChatCopiedIndex] = useState(null);
  const [chatDragActive, setChatDragActive] = useState(false);
  // Resizable chat panel: stored size in px. Default matches prior sm breakpoint values.
  const [chatSize, setChatSize] = useState({ width: 380, height: 520 });
  const [chatResizing, setChatResizing] = useState(false);
  const chatResizeStartRef = useRef(null);
  const chatPanelRef = useRef(null);
  const chatScrollRef = useRef(null);

  // Personal references the user can keep handy and copy when an application
  // asks for them. Stored locally only.
  const [references, setReferences] = useState([]);
  const [referencesOpen, setReferencesOpen] = useState(false);
  const [referenceCopiedId, setReferenceCopiedId] = useState(null);

  // Education entries the user can store and copy into applications.
  const [educationEntries, setEducationEntries] = useState([]);
  const [educationOpen, setEducationOpen] = useState(false);
  const [educationCopiedId, setEducationCopiedId] = useState(null);
  const chatInputRef = useRef(null);
  const [appDialog, setAppDialog] = useState({ open: false, rowIndex: null, kind: "jd" });
  const [stageDialog, setStageDialog] = useState(createStageDialogState());
  const [stageSaving, setStageSaving] = useState(false);
  const [stageError, setStageError] = useState("");
  const [communicationsDialog, setCommunicationsDialog] = useState({
    open: false,
    applicationId: null,
    company: "",
    role: "",
    loading: false,
    error: "",
    items: [],
  });
  const [addCommunicationDialog, setAddCommunicationDialog] = useState({
    open: false,
    applicationId: null,
    company: "",
    role: "",
    body: "",
  });
  const [communicationSaving, setCommunicationSaving] = useState(false);
  const [communicationError, setCommunicationError] = useState("");
  const [editAppDialog, setEditAppDialog] = useState({
    open: false,
    applicationId: null,
    positionId: null,
    company: "",
    role: "",
    status: "applied",
    appliedAt: "",
    applicationUrl: "",
    description: "",
  });
  const [editAppSaving, setEditAppSaving] = useState(false);
  const [editAppError, setEditAppError] = useState("");
  const [addAppDialog, setAddAppDialog] = useState({
    open: false,
    company: "",
    role: "",
    status: "applied",
    appliedAt: "",
    applicationUrl: "",
    description: "",
  });
  const [addAppSaving, setAddAppSaving] = useState(false);
  const [addAppError, setAddAppError] = useState("");
  const [addAppResumeFile, setAddAppResumeFile] = useState(null);
  const [editAppResumeFile, setEditAppResumeFile] = useState(null);
  const [applicationsRefreshKey, setApplicationsRefreshKey] = useState(0);

  // Refs for targeted re-fetches when individual controls change
  const hasFetchedRef = useRef(false);
  const activeQueryRef = useRef("");
  const toolbarScrollRef = useRef(null);
  const contextLoadedRef = useRef(false);
  const uiPrefsLoadedRef = useRef(false);

  useEffect(() => {
    const saved = localStorage.getItem("activeSection");
    if (saved === "search" || saved === "url" || saved === "manual") {
      setActiveSection(saved);
    }
    const savedTab = localStorage.getItem("mainTab");
    if (savedTab === "applying" || savedTab === "interviewing") {
      setMainTab(savedTab);
    }
    const savedContextPanel = localStorage.getItem("contextPanelOpen");
    if (savedContextPanel === "true" || savedContextPanel === "false") {
      setContextPanelOpen(savedContextPanel === "true");
    }
    const savedAggressiveness = Number.parseInt(localStorage.getItem("aggressiveness") || "", 10);
    if (!Number.isNaN(savedAggressiveness) && savedAggressiveness >= 1 && savedAggressiveness <= 5) {
      setAggressiveness(savedAggressiveness);
    }
  }, []);

  useEffect(() => {
    localStorage.setItem("activeSection", activeSection);
  }, [activeSection]);

  useEffect(() => {
    localStorage.setItem("mainTab", mainTab);
  }, [mainTab]);

  useEffect(() => {
    localStorage.setItem("contextPanelOpen", String(contextPanelOpen));
  }, [contextPanelOpen]);

  useEffect(() => {
    localStorage.setItem("aggressiveness", String(aggressiveness));
  }, [aggressiveness]);

  useEffect(() => {
    try {
      const saved = localStorage.getItem("ignoredJobIds");
      if (saved) setIgnoredJobIds(new Set(JSON.parse(saved)));
    } catch {}
  }, []);

  useEffect(() => {
    localStorage.setItem("ignoredJobIds", JSON.stringify([...ignoredJobIds]));
  }, [ignoredJobIds]);

  // Persist additional context to Redis (per-user), debounced
  useEffect(() => {
    if (!currentUser || !contextLoadedRef.current) return;
    const handle = setTimeout(() => {
      fetch("/api/user-context", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ additionalContext }),
      }).catch(() => {});
    }, 600);
    return () => clearTimeout(handle);
  }, [additionalContext, currentUser]);

  // Persist UI prefs (accordion open/shut) to Redis (per-user), debounced
  useEffect(() => {
    if (!currentUser || !uiPrefsLoadedRef.current) return;
    const handle = setTimeout(() => {
      fetch("/api/user-prefs", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          prefs: {
            referencesOpen,
            educationOpen,
            appliedSort: interviewSort,
          },
        }),
      }).catch(() => {});
    }, 400);
    return () => clearTimeout(handle);
  }, [referencesOpen, educationOpen, interviewSort, currentUser]);

  // Track auth state + load applied jobs + load stored files
  useEffect(() => {
    const supabase = createClient();

    async function loadUserData(user) {
      if (user) {
        setCurrentUser(user);

        // Load saved additional context from Redis (per-user)
        contextLoadedRef.current = false;
        try {
          const res = await fetch("/api/user-context", { cache: "no-store" });
          if (res.ok) {
            const json = await res.json();
            if (typeof json?.additionalContext === "string") {
              setAdditionalContext(json.additionalContext);
            }
          }
        } catch {}
        contextLoadedRef.current = true;

        // Load saved UI prefs (accordion open/shut states) from Redis.
        uiPrefsLoadedRef.current = false;
        try {
          const res = await fetch("/api/user-prefs", { cache: "no-store" });
          if (res.ok) {
            const json = await res.json();
            const prefs = json?.prefs && typeof json.prefs === "object" ? json.prefs : {};
            if (typeof prefs.referencesOpen === "boolean") setReferencesOpen(prefs.referencesOpen);
            if (typeof prefs.educationOpen === "boolean") setEducationOpen(prefs.educationOpen);
            if (
              prefs.appliedSort &&
              typeof prefs.appliedSort === "object" &&
              (prefs.appliedSort.field === null || typeof prefs.appliedSort.field === "string") &&
              (prefs.appliedSort.dir === "asc" || prefs.appliedSort.dir === "desc")
            ) {
              setInterviewSort({
                field: prefs.appliedSort.field || null,
                dir: prefs.appliedSort.dir,
              });
            }
          }
        } catch {}
        uiPrefsLoadedRef.current = true;

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
        contextLoadedRef.current = false;
        uiPrefsLoadedRef.current = false;
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

  // Hydrate tailoringMap (chip statuses) from localStorage on mount. We only
  // persist a slim summary per job (status/error/downloaded/generated title)
  // so the floating toolbar chips render with their last-known status after a
  // reload. Full tailored output (result, resultLines, coverLetterResultLines)
  // is regenerated when the user clicks Regenerate.
  const tailoringPersistMountedRef = useRef(false);
  useEffect(() => {
    try {
      const saved = localStorage.getItem("tailoringMapStatus");
      if (saved) {
        const parsed = JSON.parse(saved);
        if (parsed && typeof parsed === "object") setTailoringMap(parsed);
      }
    } catch {}
  }, []);
  useEffect(() => {
    if (!tailoringPersistMountedRef.current) {
      tailoringPersistMountedRef.current = true;
      return;
    }
    try {
      const slim = {};
      for (const [jobId, entry] of Object.entries(tailoringMap || {})) {
        if (!entry || typeof entry !== "object") continue;
        slim[jobId] = {
          status: entry.status || null,
          error: entry.error || "",
          downloaded: !!entry.downloaded,
          generatedJobTitle: entry.generatedJobTitle || "",
        };
      }
      localStorage.setItem("tailoringMapStatus", JSON.stringify(slim));
    } catch {}
  }, [tailoringMap]);

  useEffect(() => {
    try {
      const kwRaw = localStorage.getItem("jobKeywords");
      const legacyQuery = localStorage.getItem("jobQuery");
      const url = localStorage.getItem("urlPosting");
      const manual = localStorage.getItem("jobPosting");
      if (kwRaw) {
        try {
          const parsed = JSON.parse(kwRaw);
          if (Array.isArray(parsed)) {
            setJobKeywords(parsed.filter((s) => typeof s === "string" && s.trim().length > 0));
          }
        } catch {}
      } else if (legacyQuery && legacyQuery.trim()) {
        // Migrate old single-string query into chip array.
        const tokens = legacyQuery.trim().split(/\s+/).filter(Boolean);
        if (tokens.length > 0) setJobKeywords(tokens);
      }
      const companyEntries = localStorage.getItem("selectedCompanies");
      if (companyEntries) {
        const entries = JSON.parse(companyEntries);
        if (Array.isArray(entries) && entries.length > 0) {
          const restored = entries
            .map((entry) => {
              if (typeof entry !== "string") return null;
              const match = GREENHOUSE_COMPANIES.find((c) => c.slug === entry);
              return match || entry; // fall back to freeform string
            })
            .filter(Boolean);
          setSelectedCompanies(restored);
        }
      }
      const excludedSlugs = localStorage.getItem("excludedCompanies");
      if (excludedSlugs) {
        const slugs = JSON.parse(excludedSlugs);
        setExcludedCompanies(GREENHOUSE_COMPANIES.filter((c) => slugs.includes(c.slug)));
      }
      const savedCategories = localStorage.getItem("selectedCategories");
      if (savedCategories) setSelectedCategories(JSON.parse(savedCategories));
      const yrs = localStorage.getItem("maxYearsExp");
      if (yrs) setMaxYearsExp(yrs);
      const savedSearchesRaw = localStorage.getItem("savedSearches");
      if (savedSearchesRaw) {
        try {
          const parsed = JSON.parse(savedSearchesRaw);
          // Only hydrate from localStorage for the brief moment before the
          // server fetch (in the currentUser effect) overrides it. For
          // anonymous users this is the permanent source.
          if (Array.isArray(parsed)) setSavedSearches(parsed);
        } catch {}
      }
      if (url) setUrlPosting(url);
      if (manual) setJobPosting(manual);
    } catch {}
  }, []);

  useEffect(() => {
    localStorage.setItem("jobKeywords", JSON.stringify(jobKeywords));
  }, [jobKeywords]);
  useEffect(() => {
    localStorage.setItem(
      "selectedCompanies",
      JSON.stringify(
        selectedCompanies
          .map((c) => (typeof c === "string" ? c : c?.slug))
          .filter(Boolean),
      ),
    );
  }, [selectedCompanies]);
  useEffect(() => { localStorage.setItem("excludedCompanies", JSON.stringify(excludedCompanies.map((c) => c.slug))); }, [excludedCompanies]);
  useEffect(() => { localStorage.setItem("selectedCategories", JSON.stringify(selectedCategories)); }, [selectedCategories]);
  useEffect(() => { localStorage.setItem("maxYearsExp", maxYearsExp); }, [maxYearsExp]);
  useEffect(() => {
    // Only persist to localStorage when no user is signed in. For signed-in
    // users the server (saved_searches table) is the source of truth.
    if (currentUser) return;
    try { localStorage.setItem("savedSearches", JSON.stringify(savedSearches)); } catch {}
  }, [savedSearches, currentUser]);

  // Map a saved_searches row from the API into the shape this UI uses.
  function rowToSavedSearchEntry(row) {
    return {
      id: row.id,
      name: row.name || "",
      jobKeywords: Array.isArray(row.job_keywords) ? row.job_keywords : [],
      maxYearsExp: row.max_years_exp || "any",
      selectedCategories: Array.isArray(row.selected_categories) ? row.selected_categories : [],
      selectedCompanies: Array.isArray(row.selected_companies) ? row.selected_companies : [],
      excludedCompanies: Array.isArray(row.excluded_companies) ? row.excluded_companies : [],
      excludedTitleKeywords: Array.isArray(row.excluded_title_keywords) ? row.excluded_title_keywords : [],
      autoTailorEnabled: !!row.auto_tailor_enabled,
      autoTailorDailyCap: Number.isFinite(row.auto_tailor_daily_cap) ? row.auto_tailor_daily_cap : 10,
    };
  }

  // One-time hydration + migration: when a user signs in, pull their
  // saved_searches from the API. If they have none on the server but local
  // ones exist, migrate the local copies up to the server.
  useEffect(() => {
    if (!currentUser) return;
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch("/api/saved-searches", { cache: "no-store" });
        if (!res.ok) return;
        const json = await res.json();
        const server = Array.isArray(json?.searches) ? json.searches : [];
        if (cancelled) return;
        if (server.length > 0) {
          setSavedSearches(server.map(rowToSavedSearchEntry));
          return;
        }
        // No server entries — migrate from localStorage if present.
        let local = [];
        try {
          const raw = localStorage.getItem("savedSearches");
          if (raw) {
            const parsed = JSON.parse(raw);
            if (Array.isArray(parsed)) local = parsed;
          }
        } catch {}
        if (local.length === 0) return;
        const created = [];
        for (const entry of local) {
          const body = {
            name: entry.name || "Untitled search",
            jobKeywords: Array.isArray(entry.jobKeywords)
              ? entry.jobKeywords
              : (typeof entry.jobQuery === "string" ? entry.jobQuery.split(/\s+/).filter(Boolean) : []),
            maxYearsExp: entry.maxYearsExp || "any",
            selectedCategories: entry.selectedCategories || [],
            selectedCompanies: entry.selectedCompanies || [],
            excludedCompanies: entry.excludedCompanies || [],
            excludedTitleKeywords: entry.excludedTitleKeywords || [],
          };
          try {
            const r = await fetch("/api/saved-searches", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify(body),
            });
            if (r.ok) {
              const j = await r.json();
              if (j?.search) created.push(rowToSavedSearchEntry(j.search));
            }
          } catch {}
        }
        if (!cancelled && created.length > 0) {
          setSavedSearches(created);
          try { localStorage.removeItem("savedSearches"); } catch {}
        }
      } catch {}
    })();
    return () => { cancelled = true; };
  }, [currentUser]);

  // How long a pre-warmed result counts as "fresh enough" to display without
  // re-fetching, and how many parallel prewarm requests we'll fire at once.
  const PREWARM_FRESH_MS = 5 * 60 * 1000;
  const PREWARM_CONCURRENCY = 3;

  // Build the /api/greenhouse search URL. Shared between the live search
  // (`runJobSearch`) and the saved-search pre-warmer so they stay in sync.
  function buildGreenhouseSearchUrl(query, companies) {
    let params = "";
    const list = Array.isArray(companies) ? companies : [];
    if (list.length > 0) {
      const slugs = list.filter((c) => typeof c !== "string").map((c) => c.slug);
      const names = list.filter((c) => typeof c === "string");
      if (slugs.length > 0) params += `&companies=${slugs.join(",")}`;
      if (names.length > 0) params += names.map((n) => `&companyName=${encodeURIComponent(n)}`).join("");
    }
    return `/api/greenhouse?query=${encodeURIComponent(query)}${params}`;
  }

  // Pre-warm saved-search results in the background. Runs whenever the
  // saved-search list (re)loads. Skips entries we already have fresh results
  // for, and caps concurrency so we don't blast the upstream API.
  useEffect(() => {
    if (!Array.isArray(savedSearches) || savedSearches.length === 0) return;
    const now = Date.now();
    const targets = savedSearches.filter((entry) => {
      const kws = Array.isArray(entry.jobKeywords)
        ? entry.jobKeywords.filter((s) => typeof s === "string" && s.trim().length > 0)
        : [];
      if (kws.length === 0) return false;
      const cached = prewarmedResults[entry.id];
      if (cached && now - cached.fetchedAt < PREWARM_FRESH_MS) return false;
      return true;
    });
    if (targets.length === 0) return;
    let cancelled = false;
    (async () => {
      const queue = targets.slice();
      const workers = new Array(Math.min(PREWARM_CONCURRENCY, queue.length))
        .fill(null)
        .map(async () => {
          while (queue.length > 0 && !cancelled) {
            const entry = queue.shift();
            const kws = entry.jobKeywords.filter(
              (s) => typeof s === "string" && s.trim().length > 0,
            );
            const query = kws.join(" ").trim();
            if (!query) continue;
            const companySlugs = Array.isArray(entry.selectedCompanies)
              ? entry.selectedCompanies
              : [];
            const companyObjs = companySlugs
              .map((slug) => GREENHOUSE_COMPANIES.find((c) => c.slug === slug) || slug)
              .filter(Boolean);
            try {
              const data = await fetch(buildGreenhouseSearchUrl(query, companyObjs)).then(
                (r) => r.json(),
              );
              if (cancelled) return;
              const jobs = Array.isArray(data?.jobs) ? data.jobs : [];
              setPrewarmedResults((prev) => ({
                ...prev,
                [entry.id]: {
                  jobs,
                  fetchedAt: Date.now(),
                  error: jobs.length === 0 ? data?.error || null : null,
                },
              }));
            } catch (err) {
              if (cancelled) return;
              setPrewarmedResults((prev) => ({
                ...prev,
                [entry.id]: {
                  jobs: [],
                  fetchedAt: Date.now(),
                  error: err?.message || "fetch failed",
                },
              }));
            }
          }
        });
      await Promise.all(workers);
    })();
    return () => { cancelled = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [savedSearches]);

  // Saved-search helpers
  async function saveCurrentSearch() {
    const defaultName = jobKeywords.join(" ").trim() || (selectedCategories[0] || "Untitled search");
    const name = (typeof window !== "undefined" ? window.prompt("Name this saved search:", defaultName) : "")?.trim();
    if (!name) return;
    const entry = {
      id: `ss-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      name,
      jobKeywords: [...jobKeywords],
      maxYearsExp,
      selectedCategories: [...selectedCategories],
      selectedCompanies: selectedCompanies
        .map((c) => (typeof c === "string" ? c : c?.slug))
        .filter(Boolean),
      excludedCompanies: excludedCompanies.map((c) => c.slug),
      excludedTitleKeywords: [...excludedTitleKeywords],
      autoTailorEnabled: false,
      autoTailorDailyCap: 10,
    };
    if (currentUser) {
      try {
        const res = await fetch("/api/saved-searches", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            name: entry.name,
            jobKeywords: entry.jobKeywords,
            maxYearsExp: entry.maxYearsExp,
            selectedCategories: entry.selectedCategories,
            selectedCompanies: entry.selectedCompanies,
            excludedCompanies: entry.excludedCompanies,
            excludedTitleKeywords: entry.excludedTitleKeywords,
          }),
        });
        if (res.ok) {
          const json = await res.json();
          if (json?.search) {
            setSavedSearches((prev) => [rowToSavedSearchEntry(json.search), ...prev]);
            return;
          }
          console.error("[saveCurrentSearch] response missing 'search':", json);
          window.alert("Saved search did not return expected data. Check console.");
          return;
        }
        let detail = "";
        try { detail = (await res.json())?.error || ""; } catch {}
        console.error("[saveCurrentSearch] POST failed", res.status, detail);
        window.alert(`Could not save to server (HTTP ${res.status}${detail ? `: ${detail}` : ""}). Saved locally as a fallback.`);
      } catch (err) {
        console.error("[saveCurrentSearch] network error", err);
        window.alert(`Network error saving search: ${err?.message || err}. Saved locally as a fallback.`);
      }
    }
    setSavedSearches((prev) => [entry, ...prev]);
  }
  function applySavedSearch(entry) {
    if (!entry) return;
    let nextJobKeywords = [];
    if (Array.isArray(entry.jobKeywords)) {
      nextJobKeywords = entry.jobKeywords.filter((s) => typeof s === "string" && s.trim().length > 0);
    } else if (typeof entry.jobQuery === "string" && entry.jobQuery.trim()) {
      nextJobKeywords = entry.jobQuery.trim().split(/\s+/).filter(Boolean);
    }
    const nextMaxYears = typeof entry.maxYearsExp === "string" ? entry.maxYearsExp : "any";
    const nextCategories = Array.isArray(entry.selectedCategories) ? entry.selectedCategories : [];
    const companies = Array.isArray(entry.selectedCompanies) ? entry.selectedCompanies : [];
    const nextSelectedCompanies = companies
      .map((slug) => GREENHOUSE_COMPANIES.find((c) => c.slug === slug) || slug)
      .filter(Boolean);
    const excluded = Array.isArray(entry.excludedCompanies) ? entry.excludedCompanies : [];
    const nextExcludedCompanies = GREENHOUSE_COMPANIES.filter((c) => excluded.includes(c.slug));
    const nextExcludedTitleKeywords = Array.isArray(entry.excludedTitleKeywords)
      ? entry.excludedTitleKeywords.filter((s) => typeof s === "string" && s.trim().length > 0)
      : [];

    setJobKeywords(nextJobKeywords);
    setMaxYearsExp(nextMaxYears);
    setSelectedCategories(nextCategories);
    setSelectedCompanies(nextSelectedCompanies);
    setExcludedCompanies(nextExcludedCompanies);
    setExcludedTitleKeywords(nextExcludedTitleKeywords);
    setActiveSavedSearchId(entry.id);

    // If the pre-warmer already fetched results for this saved search and
    // they're still fresh, render them instantly instead of round-tripping
    // through runJobSearch (which would flash a loading state).
    const cached = prewarmedResults[entry.id];
    const query = nextJobKeywords.join(" ").trim();
    if (
      query &&
      cached &&
      Array.isArray(cached.jobs) &&
      cached.jobs.length > 0 &&
      Date.now() - cached.fetchedAt < PREWARM_FRESH_MS
    ) {
      setIsSearching(false);
      setJobSearchError("");
      setJobResults(cached.jobs);
      // Clear stale tailoring entries (same hygiene as runJobSearch).
      setTailoringMap((current) => {
        const trackedIds = new Set(trackedJobs.map((j) => j.id));
        const next = {};
        for (const [jobId, e] of Object.entries(current || {})) {
          if (trackedIds.has(jobId)) next[jobId] = e;
        }
        return next;
      });
      hasFetchedRef.current = true;
      activeQueryRef.current = query;
      return;
    }

    // Fire the search using the entry's values directly so we don't have to
    // wait for React state batching to flush.
    runJobSearch({
      jobKeywords: nextJobKeywords,
      selectedCompanies: nextSelectedCompanies,
    });
  }
  function deleteSavedSearch(id) {
    setSavedSearches((prev) => prev.filter((s) => s.id !== id));
    setActiveSavedSearchId((current) => (current === id ? null : current));
    if (currentUser && typeof id === "string" && !id.startsWith("ss-")) {
      // Server entries have UUID ids; local-only entries use the "ss-" prefix.
      fetch(`/api/saved-searches/${encodeURIComponent(id)}`, { method: "DELETE" }).catch(() => {});
    }
  }

  // Toggle auto-tailor on/off for a saved search. Persists to the server when
  // the user is signed in; updates local state immediately for snappy UX.
  async function setSavedSearchAutoTailor(id, { autoTailorEnabled, autoTailorDailyCap } = {}) {
    setSavedSearches((prev) =>
      prev.map((s) => {
        if (s.id !== id) return s;
        const next = { ...s };
        if (typeof autoTailorEnabled === "boolean") next.autoTailorEnabled = autoTailorEnabled;
        if (Number.isFinite(autoTailorDailyCap)) {
          next.autoTailorDailyCap = Math.max(1, Math.min(100, autoTailorDailyCap));
        }
        return next;
      }),
    );
    if (!currentUser || typeof id !== "string" || id.startsWith("ss-")) return;
    try {
      const body = {};
      if (typeof autoTailorEnabled === "boolean") body.autoTailorEnabled = autoTailorEnabled;
      if (Number.isFinite(autoTailorDailyCap)) body.autoTailorDailyCap = autoTailorDailyCap;
      if (Object.keys(body).length === 0) return;
      await fetch(`/api/saved-searches/${encodeURIComponent(id)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
    } catch {}
  }

  // Notifications: load on sign-in and poll every 60s. Also refetch when the
  // tab regains focus so the bell stays in sync.
  useEffect(() => {
    if (!currentUser) {
      setNotifications([]);
      setNotifUnreadCount(0);
      return;
    }
    let cancelled = false;
    async function load() {
      try {
        const res = await fetch("/api/notifications?limit=30", { cache: "no-store" });
        if (!res.ok) return;
        const json = await res.json();
        if (cancelled) return;
        setNotifications(Array.isArray(json?.notifications) ? json.notifications : []);
        setNotifUnreadCount(typeof json?.unreadCount === "number" ? json.unreadCount : 0);
      } catch {}
    }
    load();
    const interval = setInterval(load, 60_000);
    const onFocus = () => load();
    window.addEventListener("focus", onFocus);
    return () => {
      cancelled = true;
      clearInterval(interval);
      window.removeEventListener("focus", onFocus);
    };
  }, [currentUser]);

  async function markAllNotificationsRead() {
    if (notifUnreadCount === 0) return;
    setNotifUnreadCount(0);
    setNotifications((prev) =>
      prev.map((n) => (n.read_at ? n : { ...n, read_at: new Date().toISOString() })),
    );
    try {
      await fetch("/api/notifications", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ allRead: true }),
      });
    } catch {}
  }

  function handleNotificationClick(notif) {
    setNotifAnchorEl(null);
    if (notif?.related_application_id || notif?.kind === "auto_tailor") {
      setMainTab("interviewing");
    }
  }

  // Hydrate UI layout prefs (frozen-column widths + FAB position) once on mount.
  useEffect(() => {
    try {
      const cw = parseInt(localStorage.getItem("interviewCompanyColWidth") || "", 10);
      if (Number.isFinite(cw) && cw >= 80 && cw <= 600) setCompanyColWidth(cw);
      const rw = parseInt(localStorage.getItem("interviewRoleColWidth") || "", 10);
      if (Number.isFinite(rw) && rw >= 80 && rw <= 600) setRoleColWidth(rw);
      const fp = localStorage.getItem("fabPos");
      if (fp) {
        const parsed = JSON.parse(fp);
        if (
          parsed && typeof parsed.right === "number" && typeof parsed.bottom === "number"
        ) {
          setFabPos(parsed);
        }
      }
      const cs = localStorage.getItem("chatSize");
      if (cs) {
        const parsed = JSON.parse(cs);
        if (
          parsed && typeof parsed.width === "number" && typeof parsed.height === "number"
          && parsed.width >= 280 && parsed.height >= 320
        ) {
          setChatSize(parsed);
        }
      }
    } catch {}
  }, []);
  useEffect(() => {
    localStorage.setItem("interviewCompanyColWidth", String(companyColWidth));
  }, [companyColWidth]);
  useEffect(() => {
    localStorage.setItem("interviewRoleColWidth", String(roleColWidth));
  }, [roleColWidth]);
  useEffect(() => {
    localStorage.setItem("fabPos", JSON.stringify(fabPos));
  }, [fabPos]);
  useEffect(() => {
    localStorage.setItem("chatSize", JSON.stringify(chatSize));
  }, [chatSize]);

  // Hydrate the stored personal references once on mount.
  useEffect(() => {
    try {
      const raw = localStorage.getItem("applicationReferences");
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        setReferences(
          parsed
            .filter((r) => r && typeof r === "object")
            .map((r) => ({
              id: typeof r.id === "string" && r.id ? r.id : `ref-${Math.random().toString(36).slice(2, 10)}`,
              name: String(r.name || ""),
              title: String(r.title || ""),
              company: String(r.company || ""),
              relationship: String(r.relationship || ""),
              email: String(r.email || ""),
              phone: String(r.phone || ""),
              notes: String(r.notes || ""),
            })),
        );
      }
    } catch {}
  }, []);
  useEffect(() => {
    try {
      localStorage.setItem("applicationReferences", JSON.stringify(references));
    } catch {}
  }, [references]);

  // Hydrate/save stored education entries.
  useEffect(() => {
    try {
      const raw = localStorage.getItem("applicationEducation");
      if (!raw) return;
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) {
        setEducationEntries(
          parsed
            .filter((e) => e && typeof e === "object")
            .map((e) => ({
              id: typeof e.id === "string" && e.id ? e.id : `edu-${Math.random().toString(36).slice(2, 10)}`,
              school: String(e.school || ""),
              degree: String(e.degree || ""),
              field: String(e.field || ""),
              location: String(e.location || ""),
              startDate: String(e.startDate || ""),
              endDate: String(e.endDate || ""),
              gpa: String(e.gpa || ""),
              notes: String(e.notes || ""),
            })),
        );
      }
    } catch {}
  }, []);
  useEffect(() => {
    try {
      localStorage.setItem("applicationEducation", JSON.stringify(educationEntries));
    } catch {}
  }, [educationEntries]);

  // Close the chat when clicking outside its panel (but not on the FAB itself).
  useEffect(() => {
    if (!chatOpen) return;
    function handlePointerDown(e) {
      if (chatResizing) return;
      const panel = chatPanelRef.current;
      if (!panel) return;
      if (panel.contains(e.target)) return;
      // Don't close when the click is on the FAB — it has its own toggle.
      const fabEl = e.target.closest?.(".MuiFab-root");
      if (fabEl) return;
      setChatOpen(false);
    }
    document.addEventListener("mousedown", handlePointerDown);
    return () => document.removeEventListener("mousedown", handlePointerDown);
  }, [chatOpen, chatResizing]);

  // Drag handler shared by both frozen-column resize handles.
  function startColResize(which, event) {
    event.preventDefault();
    event.stopPropagation();
    const startX = event.clientX;
    const startWidth = which === "company" ? companyColWidth : roleColWidth;
    const setter = which === "company" ? setCompanyColWidth : setRoleColWidth;
    function onMove(e) {
      const delta = e.clientX - startX;
      const next = Math.min(600, Math.max(80, startWidth + delta));
      setter(next);
    }
    function onUp() {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
    }
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    document.body.style.cursor = "col-resize";
    document.body.style.userSelect = "none";
  }

  // Drag handler for resizing the chat panel from its top-left corner.
  function startChatResize(event) {
    event.preventDefault();
    event.stopPropagation();
    const startX = event.clientX;
    const startY = event.clientY;
    const startW = chatSize.width;
    const startH = chatSize.height;
    setChatResizing(true);
    function onMove(e) {
      // Panel is anchored to the right/bottom, so grow it as the user drags up/left.
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;
      const maxW = Math.max(280, window.innerWidth - 32);
      const maxH = Math.max(320, window.innerHeight - 32);
      const nextW = Math.min(maxW, Math.max(280, startW - dx));
      const nextH = Math.min(maxH, Math.max(320, startH - dy));
      setChatSize({ width: nextW, height: nextH });
    }
    function onUp() {
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
      document.body.style.cursor = "";
      document.body.style.userSelect = "";
      setChatResizing(false);
    }
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    document.body.style.cursor = "nwse-resize";
    document.body.style.userSelect = "none";
  }

  // Personal references helpers.
  function addReference() {
    setReferences((prev) => [
      ...prev,
      {
        id: `ref-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        name: "",
        title: "",
        company: "",
        relationship: "",
        email: "",
        phone: "",
        notes: "",
      },
    ]);
    setReferencesOpen(true);
  }
  function updateReference(id, field, value) {
    setReferences((prev) =>
      prev.map((ref) => (ref.id === id ? { ...ref, [field]: value } : ref)),
    );
  }
  function removeReference(id) {
    setReferences((prev) => prev.filter((ref) => ref.id !== id));
  }
  function formatReferenceBlock(ref) {
    if (!ref) return "";
    const headerBits = [ref.name, ref.title].filter(Boolean).join(", ");
    const orgLine = [ref.company, ref.relationship].filter(Boolean).join(" — ");
    const lines = [];
    if (headerBits) lines.push(headerBits);
    if (orgLine) lines.push(orgLine);
    if (ref.email) lines.push(`Email: ${ref.email}`);
    if (ref.phone) lines.push(`Phone: ${ref.phone}`);
    if (ref.notes) lines.push(ref.notes);
    return lines.join("\n");
  }
  async function copyReferenceBlock(ref) {
    const text = formatReferenceBlock(ref);
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      setReferenceCopiedId(ref.id);
      setTimeout(() => {
        setReferenceCopiedId((current) => (current === ref.id ? null : current));
      }, 1500);
    } catch {}
  }

  // Education entry helpers.
  function addEducationEntry() {
    setEducationEntries((prev) => [
      ...prev,
      {
        id: `edu-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        school: "",
        degree: "",
        field: "",
        location: "",
        startDate: "",
        endDate: "",
        gpa: "",
        notes: "",
      },
    ]);
    setEducationOpen(true);
  }
  function updateEducationEntry(id, field, value) {
    setEducationEntries((prev) =>
      prev.map((entry) => (entry.id === id ? { ...entry, [field]: value } : entry)),
    );
  }
  function removeEducationEntry(id) {
    setEducationEntries((prev) => prev.filter((entry) => entry.id !== id));
  }
  function formatEducationBlock(entry) {
    if (!entry) return "";
    const lines = [];
    if (entry.school) lines.push(entry.school);
    const degreeLine = [entry.degree, entry.field].filter(Boolean).join(", ");
    if (degreeLine) lines.push(degreeLine);
    const dateRange = [entry.startDate, entry.endDate].filter(Boolean).join(" – ");
    const metaBits = [entry.location, dateRange].filter(Boolean).join(" • ");
    if (metaBits) lines.push(metaBits);
    if (entry.gpa) lines.push(`GPA: ${entry.gpa}`);
    if (entry.notes) lines.push(entry.notes);
    return lines.join("\n");
  }
  async function copyEducationBlock(entry) {
    const text = formatEducationBlock(entry);
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      setEducationCopiedId(entry.id);
      setTimeout(() => {
        setEducationCopiedId((current) => (current === entry.id ? null : current));
      }, 1500);
    } catch {}
  }

  // Combined-copy helpers: copy every reference / education entry as one block.
  function formatAllReferences() {
    return references
      .map((ref) => formatReferenceBlock(ref))
      .filter(Boolean)
      .join("\n\n");
  }
  function formatAllEducation() {
    return educationEntries
      .map((entry) => formatEducationBlock(entry))
      .filter(Boolean)
      .join("\n\n");
  }
  const [allReferencesCopied, setAllReferencesCopied] = useState(false);
  const [allEducationCopied, setAllEducationCopied] = useState(false);
  async function copyAllReferences() {
    const text = formatAllReferences();
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      setAllReferencesCopied(true);
      setTimeout(() => setAllReferencesCopied(false), 1500);
    } catch {}
  }
  async function copyAllEducation() {
    const text = formatAllEducation();
    if (!text) return;
    try {
      await navigator.clipboard.writeText(text);
      setAllEducationCopied(true);
      setTimeout(() => setAllEducationCopied(false), 1500);
    } catch {}
  }

  // Per-field copy helper for references / education TextFields.
  const [fieldCopyKey, setFieldCopyKey] = useState(null);
  async function copyFieldValue(key, value) {
    if (!value) return;
    try {
      await navigator.clipboard.writeText(String(value));
      setFieldCopyKey(key);
      setTimeout(() => {
        setFieldCopyKey((current) => (current === key ? null : current));
      }, 1200);
    } catch {}
  }
  function renderCopyButton(keyId, value, options = {}) {
    const copied = fieldCopyKey === keyId;
    return (
      <Tooltip title={copied ? "Copied" : "Copy"} arrow>
        <span style={{ display: "inline-flex" }}>
          <IconButton
            size="small"
            disabled={!value}
            onClick={() => copyFieldValue(keyId, value)}
            aria-label={`Copy ${keyId}`}
            sx={{
              p: 0.5,
              alignSelf: options.alignTop ? "flex-start" : "center",
              mt: options.alignTop ? "4px" : 0,
              color: copied ? "#2e7d32" : "#546e7a",
              "&:hover": { color: "#1976d2", bgcolor: "transparent" },
            }}
          >
            {copied ? (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
            ) : (
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
            )}
          </IconButton>
        </span>
      </Tooltip>
    );
  }

  // When categories change, drive the company multiselect.
  // (Now handled inline in the Categories Autocomplete onChange so that
  // restoring saved categories from localStorage on reload doesn't clobber
  // the also-restored selectedCompanies.)

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
    if (!hasFetchedRef.current || jobKeywords.length === 0) return;
    const joined = jobKeywords.join(" ").trim();
    if (!joined) return;
    const timer = setTimeout(() => {
      activeQueryRef.current = joined;
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
      fetch(`/api/greenhouse?query=${encodeURIComponent(joined)}${ghCompanyParam}`)
        .then((r) => r.json())
        .then((data) => { setJobResults(data.jobs || []); })
        .catch(() => {})
        .finally(() => setIsSearching(false));
    }, 500);
    return () => clearTimeout(timer);
  }, [jobKeywords]); // eslint-disable-line react-hooks/exhaustive-deps

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

  async function openCommunicationsDialog(app) {
    if (!currentUser) return;

    setCommunicationsDialog({
      open: true,
      applicationId: app.id,
      company: app.positions?.company || "",
      role: app.positions?.title || "",
      loading: true,
      error: "",
      items: [],
    });

    const supabase = createClient();
    const { data, error } = await listRecruiterCommunications(supabase, app.id);

    setCommunicationsDialog((prev) => {
      if (prev.applicationId !== app.id) return prev;
      return {
        ...prev,
        loading: false,
        error: error?.message || "",
        items: data || [],
      };
    });
  }

  async function loadCommunicationsForApp(app) {
    if (!currentUser || !app?.id) return;
    setCommunicationsDialog((prev) => ({
      ...prev,
      applicationId: app.id,
      company: app.positions?.company || "",
      role: app.positions?.title || "",
      loading: true,
      error: "",
      items: prev.applicationId === app.id ? prev.items : [],
    }));

    const supabase = createClient();
    const { data, error } = await listRecruiterCommunications(supabase, app.id);

    setCommunicationsDialog((prev) => {
      if (prev.applicationId !== app.id) return prev;
      return {
        ...prev,
        loading: false,
        error: error?.message || "",
        items: data || [],
      };
    });
  }

  function openCommsInAppDialog(app, rowIndex) {
    setAppDialog({ open: true, rowIndex, kind: "communications" });
    loadCommunicationsForApp(app);
  }

  function openAddCommunicationDialog(app) {
    setCommunicationError("");
    setAddCommunicationDialog({
      open: true,
      applicationId: app.id,
      company: app.positions?.company || "",
      role: app.positions?.title || "",
      body: "",
    });
  }

  async function handleSaveCommunication() {
    if (!currentUser || !addCommunicationDialog.applicationId || !addCommunicationDialog.body.trim()) return;

    setCommunicationSaving(true);
    setCommunicationError("");

    const supabase = createClient();
    const { error } = await createRecruiterCommunication(supabase, {
      userId: currentUser.id,
      applicationId: addCommunicationDialog.applicationId,
      body: addCommunicationDialog.body.trim(),
    });

    if (error) {
      setCommunicationError(error.message || "Unable to save recruiter communication.");
      setCommunicationSaving(false);
      return;
    }

    const applicationId = addCommunicationDialog.applicationId;
    setAddCommunicationDialog({ open: false, applicationId: null, company: "", role: "", body: "" });
    setCommunicationSaving(false);

    if (communicationsDialog.applicationId === applicationId) {
      const { data, error: reloadError } = await listRecruiterCommunications(supabase, applicationId);
      setCommunicationsDialog((prev) => ({
        ...prev,
        error: reloadError?.message || "",
        items: data || [],
      }));
    }
  }

  function openEditApplicationDialog(app) {
    const pos = app.positions || {};
    setEditAppError("");
    setEditAppResumeFile(null);
    setEditAppDialog({
      open: true,
      applicationId: app.id,
      positionId: pos.id || null,
      company: pos.company || "",
      role: pos.title || "",
      status: app.status || "applied",
      appliedAt: app.applied_at ? new Date(app.applied_at).toISOString().slice(0, 10) : "",
      applicationUrl: app.application_url || pos.url || "",
      description: pos.description || "",
    });
  }

  async function uploadAndLinkResumeForApplication(supabase, {
    file,
    userId,
    applicationId,
    positionId,
  }) {
    if (!file || !userId || !applicationId) return { error: null };
    if (!isDocxResume(file) && !isTextResume(file)) {
      return { error: "Resume must be a .docx or .txt file." };
    }

    const ext = isDocxResume(file) ? "docx" : "txt";
    const storagePath = `${userId}/applications/${applicationId}.${ext}`;

    const { error: uploadErr } = await supabase
      .storage
      .from("resumes")
      .upload(storagePath, file, { upsert: true, contentType: file.type || undefined });
    if (uploadErr) {
      return { error: uploadErr.message || "Failed to upload resume." };
    }

    let contentLines = [];
    try {
      contentLines = await buildTemplateLinesForUpload(file);
    } catch {
      contentLines = [];
    }
    const content = (contentLines || []).join("\n").trim();
    if (!content) {
      return { error: "Could not extract text from the uploaded resume." };
    }

    const generatedResumeId = await saveGeneratedResume(supabase, {
      userId,
      positionId: positionId || null,
      content,
      contentLines,
      sourceResumePath: storagePath,
    });

    if (!generatedResumeId) {
      return { error: "Failed to save resume record." };
    }

    const { error: appErr } = await supabase
      .from("applications")
      .update({ resume_used_id: generatedResumeId })
      .eq("id", applicationId);
    if (appErr) {
      return { error: appErr.message || "Failed to link resume to application." };
    }

    return { error: null };
  }

  async function handleSaveEditApplication() {
    if (!editAppDialog.applicationId) return;
    setEditAppSaving(true);
    setEditAppError("");

    const supabase = createClient();

    const appUpdates = {
      status: editAppDialog.status,
      application_url: editAppDialog.applicationUrl.trim() || null,
      applied_at: editAppDialog.appliedAt ? new Date(editAppDialog.appliedAt).toISOString() : null,
    };

    const { error: appErr } = await supabase
      .from("applications")
      .update(appUpdates)
      .eq("id", editAppDialog.applicationId);

    if (appErr) {
      setEditAppError(appErr.message || "Failed to save changes.");
      setEditAppSaving(false);
      return;
    }

    if (editAppDialog.positionId) {
      const posUpdates = {
        title: editAppDialog.role.trim() || null,
        company: editAppDialog.company.trim() || null,
        description: editAppDialog.description || null,
      };
      const { error: posErr } = await supabase
        .from("positions")
        .update(posUpdates)
        .eq("id", editAppDialog.positionId);

      if (posErr) {
        setEditAppError(posErr.message || "Failed to save position changes.");
        setEditAppSaving(false);
        return;
      }
    }

    setApplicationData((prev) =>
      prev.map((a) =>
        a.id === editAppDialog.applicationId
          ? {
              ...a,
              status: appUpdates.status,
              application_url: appUpdates.application_url,
              applied_at: appUpdates.applied_at,
              positions: a.positions
                ? {
                    ...a.positions,
                    title: editAppDialog.role.trim() || a.positions.title,
                    company: editAppDialog.company.trim() || a.positions.company,
                    description: editAppDialog.description,
                  }
                : a.positions,
            }
          : a,
      ),
    );

    if (editAppResumeFile && currentUser?.id) {
      const { error: resumeErr } = await uploadAndLinkResumeForApplication(supabase, {
        file: editAppResumeFile,
        userId: currentUser.id,
        applicationId: editAppDialog.applicationId,
        positionId: editAppDialog.positionId,
      });
      if (resumeErr) {
        setEditAppError(resumeErr);
        setEditAppSaving(false);
        return;
      }
      setApplicationsRefreshKey((k) => k + 1);
    }

    setEditAppResumeFile(null);
    setEditAppSaving(false);
    setEditAppDialog((prev) => ({ ...prev, open: false }));
  }

  function openAddApplicationDialog() {
    setAddAppError("");
    setAddAppResumeFile(null);
    setAddAppDialog({
      open: true,
      company: "",
      role: "",
      status: "applied",
      appliedAt: new Date().toISOString().slice(0, 10),
      applicationUrl: "",
      description: "",
    });
  }

  async function handleSaveAddApplication() {
    if (!currentUser) return;
    const company = addAppDialog.company.trim();
    const role = addAppDialog.role.trim();
    if (!company || !role) {
      setAddAppError("Company and Role are required.");
      return;
    }
    setAddAppSaving(true);
    setAddAppError("");
    const supabase = createClient();

    const externalId = `manual-${(typeof crypto !== "undefined" && crypto.randomUUID)
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random().toString(36).slice(2)}`}`;

    const positionId = await upsertPosition(supabase, {
      id: externalId,
      title: role,
      company,
      description: addAppDialog.description || null,
      url: addAppDialog.applicationUrl.trim() || null,
    });

    if (!positionId) {
      setAddAppError("Failed to save position.");
      setAddAppSaving(false);
      return;
    }

    const { data: insertedApp, error: appErr } = await supabase
      .from("applications")
      .insert({
        user_id: currentUser.id,
        position_id: positionId,
        status: addAppDialog.status,
        application_url: addAppDialog.applicationUrl.trim() || null,
        applied_at: addAppDialog.appliedAt
          ? new Date(addAppDialog.appliedAt).toISOString()
          : new Date().toISOString(),
      })
      .select("id")
      .single();

    if (appErr) {
      setAddAppError(appErr.message || "Failed to save application.");
      setAddAppSaving(false);
      return;
    }

    if (addAppResumeFile && insertedApp?.id) {
      const { error: resumeErr } = await uploadAndLinkResumeForApplication(supabase, {
        file: addAppResumeFile,
        userId: currentUser.id,
        applicationId: insertedApp.id,
        positionId,
      });
      if (resumeErr) {
        setAddAppError(resumeErr);
        setAddAppSaving(false);
        return;
      }
    }

    setAddAppResumeFile(null);
    setAddAppSaving(false);
    setAddAppDialog((prev) => ({ ...prev, open: false }));
    setApplicationsRefreshKey((k) => k + 1);
  }

  async function handleDeleteApplication(app) {
    if (!app?.id) return;
    const label = `${app.positions?.company || "this application"}${app.positions?.title ? ` — ${app.positions.title}` : ""}`;
    if (!window.confirm(`Delete ${label}? This cannot be undone.`)) return;

    const supabase = createClient();
    const { error } = await supabase.from("applications").delete().eq("id", app.id);
    if (error) {
      window.alert(error.message || "Failed to delete application.");
      return;
    }

    setApplicationData((prev) => prev.filter((a) => a.id !== app.id));
    setApplicationStages((prev) => {
      if (!(app.id in prev)) return prev;
      const next = { ...prev };
      delete next[app.id];
      return next;
    });
  }

  useEffect(() => {
    if (!currentUser) return;
    let cancelled = false;
    async function loadApplications() {
      setApplicationLoading(true);
      setApplicationError(null);
      const supabase = createClient();

      // Step 1: fetch applications + positions
      const { data: appRows, error: appErr } = await supabase
        .from("applications")
        .select(`
          id, status, applied_at, tracked_at, application_url, resume_used_id,
          positions ( id, external_id, title, company, description, url )
        `)
        .eq("user_id", currentUser.id)
        .neq("status", "tracking")
        .neq("status", "auto_tailored")
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
          .select("id, content, content_lines")
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
          .select("id, application_id, stage_name, stage_type, scheduled_at, duration_minutes, outcome, interviewer_names, notes, created_at, updated_at")
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
  }, [currentUser, applicationsRefreshKey]);

  // Load auto-tailored postings for the Auto Tailor sub-tab. These are
  // applications whose status is "auto_tailored" — set either by the daily
  // cron, or by the "Tailor all visible" batch flow in the Job Search tab.
  // We also use this list to drive the unread-count badge on the sub-tab.
  useEffect(() => {
    if (!currentUser) {
      setAutoTailoredPostings([]);
      return;
    }
    let cancelled = false;
    async function loadAutoTailored() {
      setAutoTailoredLoading(true);
      setAutoTailoredError(null);
      const supabase = createClient();
      const { data, error } = await supabase
        .from("applications")
        .select(`
          id, status, applied_at, tracked_at, resume_used_id,
          positions ( id, title, company, url )
        `)
        .eq("user_id", currentUser.id)
        .eq("status", "auto_tailored")
        .order("tracked_at", { ascending: false })
        .limit(500);
      if (cancelled) return;
      if (error) {
        console.error("[loadAutoTailored] failed:", error);
        setAutoTailoredError(error.message);
        setAutoTailoredPostings([]);
      } else {
        setAutoTailoredPostings(data || []);
      }
      setAutoTailoredLoading(false);
    }
    loadAutoTailored();
    return () => { cancelled = true; };
  }, [currentUser, applicationsRefreshKey]);

  // Track which auto-tailored application ids the user has already viewed.
  // When the user opens the Auto Tailor tab we mark every currently-loaded
  // auto-tailored row as seen so the badge clears.
  const [autoTailorSeenVersion, setAutoTailorSeenVersion] = useState(0);
  function getAutoTailorSeenSet() {
    if (typeof window === "undefined") return new Set();
    try {
      const raw = window.localStorage.getItem("autoTailorSeenIds");
      const arr = raw ? JSON.parse(raw) : [];
      return new Set(Array.isArray(arr) ? arr : []);
    } catch {
      return new Set();
    }
  }
  function markAutoTailoredSeen(ids) {
    if (typeof window === "undefined") return;
    if (!Array.isArray(ids) || ids.length === 0) return;
    try {
      const seen = getAutoTailorSeenSet();
      let changed = false;
      for (const id of ids) {
        if (id && !seen.has(id)) {
          seen.add(id);
          changed = true;
        }
      }
      if (changed) {
        window.localStorage.setItem(
          "autoTailorSeenIds",
          JSON.stringify(Array.from(seen)),
        );
        setAutoTailorSeenVersion((v) => v + 1);
      }
    } catch {
      // ignore localStorage errors
    }
  }
  const autoTailorUnreadCount = useMemo(() => {
    if (!Array.isArray(autoTailoredPostings) || autoTailoredPostings.length === 0) return 0;
    const seen = getAutoTailorSeenSet();
    let count = 0;
    for (const row of autoTailoredPostings) {
      if (row?.id && !seen.has(row.id)) count++;
    }
    return count;
  }, [autoTailoredPostings, autoTailorSeenVersion]);
  // When the user opens the Auto Tailor tab, mark current rows as seen.
  useEffect(() => {
    if (mainTab !== "applying" || activeSection !== "autoTailor") return;
    if (!Array.isArray(autoTailoredPostings) || autoTailoredPostings.length === 0) return;
    markAutoTailoredSeen(autoTailoredPostings.map((r) => r.id).filter(Boolean));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mainTab, activeSection, autoTailoredPostings]);

  // Backfill chip statuses for tracked jobs from Supabase. Any tracked job
  // whose position has a matching application with a saved generated_resumes
  // row is treated as "done" so the floating toolbar chip is colored green
  // after a reload even if the slim localStorage status wasn't written by
  // the previous session.
  useEffect(() => {
    if (!Array.isArray(applicationData) || applicationData.length === 0) return;
    if (!Array.isArray(trackedJobs) || trackedJobs.length === 0) return;
    const externalIdToApp = new Map();
    for (const app of applicationData) {
      const ext = app?.positions?.external_id;
      if (ext) externalIdToApp.set(String(ext), app);
    }
    setTailoringMap((current) => {
      let changed = false;
      const next = { ...current };
      for (const job of trackedJobs) {
        const existing = next[job.id];
        if (existing && existing.status) continue;
        const app = externalIdToApp.get(String(job.id));
        if (!app) continue;
        if (!app.generated_resumes?.content) continue;
        next[job.id] = {
          ...(existing || {}),
          status: "done",
          downloaded: true,
          generatedJobTitle:
            existing?.generatedJobTitle || app.positions?.title || job.title || "",
          error: "",
        };
        changed = true;
      }
      return changed ? next : current;
    });
  }, [applicationData, trackedJobs]);

  const visibleApplicationData = [...applicationData]
    .filter((app) => {
      const query = normalizeInterviewValue(interviewSearch);
      if (!query) return true;
      const company = normalizeInterviewValue(app.positions?.company);
      const role = normalizeInterviewValue(app.positions?.title);
      return company.includes(query) || role.includes(query);
    })
    .sort((a, b) => {
      if (!interviewSort.field) return 0;
      const field = interviewSort.field;
      let av;
      let bv;
      if (field === "company" || field === "title") {
        av = (a.positions?.[field] || "").toString().toLowerCase();
        bv = (b.positions?.[field] || "").toString().toLowerCase();
      } else if (field === "status") {
        av = (a.status || "").toString().toLowerCase();
        bv = (b.status || "").toString().toLowerCase();
      } else if (field === "applied_at") {
        // Date sort: empty dates always sort to the bottom.
        av = a.applied_at ? new Date(a.applied_at).getTime() : NaN;
        bv = b.applied_at ? new Date(b.applied_at).getTime() : NaN;
        const aMissing = Number.isNaN(av);
        const bMissing = Number.isNaN(bv);
        if (aMissing && !bMissing) return 1;
        if (!aMissing && bMissing) return -1;
        if (aMissing && bMissing) return 0;
        return interviewSort.dir === "asc" ? av - bv : bv - av;
      } else {
        return 0;
      }
      // Empty string values sort to the end regardless of direction.
      if (!av && bv) return 1;
      if (av && !bv) return -1;
      if (!av && !bv) return 0;
      const cmp = av.localeCompare(bv);
      return interviewSort.dir === "asc" ? cmp : -cmp;
    });

  function toggleInterviewSort(field) {
    setInterviewSort((prev) => {
      if (prev.field !== field) return { field, dir: "asc" };
      if (prev.dir === "asc") return { field, dir: "desc" };
      return { field: null, dir: "asc" }; // third click clears
    });
  }

  // Shared sx for sort labels so the arrow icon is always visible (dimmed when
  // not the active sort column).
  function sortLabelSx(field) {
    const active = interviewSort.field === field;
    return {
      "& .MuiTableSortLabel-icon": {
        opacity: active ? 1 : 0.35,
      },
    };
  }

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

  function getDownloadFileNameForTitle(jobTitle, company) {
    const cleanedTitle = sanitizeFileNamePart(jobTitle || "").slice(0, 90);
    const cleanedCompany = sanitizeFileNamePart(company || "").slice(0, 60);
    const titlePart = cleanedTitle || "Target Role";
    return cleanedCompany
      ? `Resume - ${cleanedCompany} - ${titlePart}.docx`
      : `Resume - ${titlePart}.docx`;
  }

  function getDownloadCoverLetterFileNameForTitle(jobTitle, company) {
    const cleanedTitle = sanitizeFileNamePart(jobTitle || "").slice(0, 90);
    const cleanedCompany = sanitizeFileNamePart(company || "").slice(0, 60);
    const titlePart = cleanedTitle || "Target Role";
    return cleanedCompany
      ? `Cover Letter - ${cleanedCompany} - ${titlePart}.docx`
      : `Cover Letter - ${titlePart}.docx`;
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

  async function downloadDocxFiles({ jobTitle, company, result, resultLines, coverLetterResultLines }) {
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

  // "Apply" action for an auto-tailored row: download the tailored resume,
  // open the posting in a new tab, and bump the application status from
  // auto_tailored → applied so it moves out of the Auto Tailor tab and into
  // the Interviewing tab.
  async function applyAutoTailoredRow(row) {
    const dlError = await downloadAutoTailoredResume(row);
    if (dlError) {
      setAutoTailoredError(dlError);
      return;
    }
    setAutoTailoredError(null);
    const url = row?.positions?.url;
    if (url && typeof window !== "undefined") {
      window.open(url, "_blank", "noopener,noreferrer");
    }
    if (currentUser && row?.id) {
      const supabase = createClient();
      const { error: updErr } = await supabase
        .from("applications")
        .update({ status: "applied", applied_at: new Date().toISOString() })
        .eq("id", row.id)
        .eq("user_id", currentUser.id);
      if (updErr) {
        console.error("[applyAutoTailoredRow] status update failed:", updErr);
      }
      setApplicationsRefreshKey((k) => k + 1);
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
    if (event && typeof event.preventDefault === "function") event.preventDefault();
    await runJobSearch({ jobKeywords, selectedCompanies });
  }

  async function runJobSearch({ jobKeywords: keywordsArg, selectedCompanies: companiesArg }) {
    const keywords = (Array.isArray(keywordsArg) ? keywordsArg : [])
      .map((k) => (typeof k === "string" ? k.trim() : ""))
      .filter(Boolean);
    const query = keywords.join(" ").trim();
    if (!query) return;

    const companies = Array.isArray(companiesArg) ? companiesArg : [];

    setIsSearching(true);
    setJobSearchError("");
    setJobResults([]);
    // Drop tailoring entries for jobs that aren't currently tracked, so a
    // fresh search doesn't show stale ✓ Ready badges on cards that no longer
    // appear in the results — but preserve statuses for tracked jobs so the
    // floating toolbar chips don't lose their state.
    setTailoringMap((current) => {
      const trackedIds = new Set(trackedJobs.map((j) => j.id));
      const next = {};
      for (const [jobId, entry] of Object.entries(current || {})) {
        if (trackedIds.has(jobId)) next[jobId] = entry;
      }
      return next;
    });
    hasFetchedRef.current = false;
    activeQueryRef.current = query;

    try {
      const data = await fetch(buildGreenhouseSearchUrl(query, companies)).then((r) => r.json());

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

  async function addChatAttachments(fileList) {
    const files = Array.from(fileList || []);
    if (files.length === 0) return;
    setChatAttachError("");
    const accepted = [];
    for (const file of files) {
      if (!file) continue;
      if (file.size > 5 * 1024 * 1024) {
        setChatAttachError(`${file.name} is too large (max 5 MB).`);
        continue;
      }
      try {
        let content = "";
        if (isDocxResume(file)) {
          const lines = await buildTemplateLinesForUpload(file);
          content = (lines || []).join("\n").trim();
        } else if (
          isTextResume(file) ||
          /\.(txt|md|csv|json|log)$/i.test(file.name) ||
          (file.type && file.type.startsWith("text/"))
        ) {
          content = (await file.text()).trim();
        } else {
          setChatAttachError(`${file.name}: unsupported file type. Use .docx, .txt, .md, .csv, .json.`);
          continue;
        }
        if (!content) {
          setChatAttachError(`${file.name}: no text could be extracted.`);
          continue;
        }
        accepted.push({ name: file.name, content });
      } catch (err) {
        setChatAttachError(`${file.name}: ${err.message || "failed to read."}`);
      }
    }
    if (accepted.length > 0) {
      setChatAttachedFiles((prev) => [...prev, ...accepted]);
      setChatOpen(true);
    }
  }

  function askAiAbout({ label, content, prompt = "", sourceJobId = null }) {
    setChatPinnedContext({ label: label || "Context", content: content || "", sourceJobId: sourceJobId || null });
    setChatError("");
    // Always prefix any button-triggered chat with a consistent
    // "I need help with <origin>" opener so we (and the model) know where
    // the conversation came from. The `prompt` argument is intentionally
    // ignored — callers used to supply ad-hoc starters; this unifies them.
    void prompt;
    const origin = (label || "this").toString().trim() || "this";
    setChatInput(`I need help with ${origin}: `);
    setChatOpen(true);
    setTimeout(() => {
      const el = chatInputRef.current;
      if (!el) return;
      try {
        el.focus();
        const len = el.value?.length ?? 0;
        if (typeof el.setSelectionRange === "function") {
          el.setSelectionRange(len, len);
        }
      } catch {
        /* noop */
      }
    }, 80);
  }

  function buildJobContextString(job) {
    const lines = [];
    if (job.title) lines.push(`Title: ${job.title}`);
    if (job.company) lines.push(`Company: ${job.company}`);
    if (job.location) lines.push(`Location: ${job.location}`);
    if (job.isRemote) lines.push(`Remote: yes`);
    if (job.employmentType) lines.push(`Employment Type: ${job.employmentType}`);
    if (job.publisher) lines.push(`Publisher: ${job.publisher}`);
    if (job.salaryMin || job.salaryMax) {
      lines.push(`Salary: ${job.salaryMin || "?"} – ${job.salaryMax || "?"}`);
    }
    if (job.url) lines.push(`URL: ${job.url}`);
    if (job.description) lines.push(`Description:\n${job.description}`);
    return lines.join("\n");
  }

  function buildApplicationContextString(app) {
    const pos = app.positions || {};
    const resume = app.generated_resumes;
    const stages = applicationStages[app.id] || [];
    const lines = [];
    if (pos.company) lines.push(`Company: ${pos.company}`);
    if (pos.title) lines.push(`Role: ${pos.title}`);
    if (app.status) lines.push(`Status: ${app.status}`);
    if (app.applied_at) lines.push(`Applied: ${app.applied_at}`);
    if (app.application_url || pos.url) lines.push(`URL: ${app.application_url || pos.url}`);
    if (pos.description) lines.push(`Job Description:\n${pos.description}`);
    if (resume?.content) lines.push(`Tailored Resume:\n${resume.content}`);
    if (stages.length > 0) {
      lines.push("Interview Stages:");
      stages.forEach((s) => {
        const bits = [];
        if (s.stage_name) bits.push(s.stage_name);
        else if (s.stage_type) bits.push(s.stage_type);
        if (s.scheduled_at) bits.push(`@ ${s.scheduled_at}`);
        if (s.outcome && s.outcome !== "pending") bits.push(`(${s.outcome})`);
        if (Array.isArray(s.interviewer_names) && s.interviewer_names.length > 0) {
          bits.push(`with ${s.interviewer_names.join(", ")}`);
        }
        if (s.notes) bits.push(`notes: ${s.notes}`);
        lines.push(`  - ${bits.join(" ")}`);
      });
    }
    return lines.join("\n");
  }

  function buildStageContextString(app, stage) {
    const pos = app.positions || {};
    const lines = [];
    if (pos.company) lines.push(`Company: ${pos.company}`);
    if (pos.title) lines.push(`Role: ${pos.title}`);
    lines.push(`Stage: ${stage.stage_name || stage.stage_type || "Interview"}`);
    if (stage.stage_type) lines.push(`Type: ${stage.stage_type}`);
    if (stage.scheduled_at) lines.push(`Scheduled: ${stage.scheduled_at}`);
    if (stage.duration_minutes) lines.push(`Duration: ${stage.duration_minutes} min`);
    if (stage.outcome) lines.push(`Outcome: ${stage.outcome}`);
    if (Array.isArray(stage.interviewer_names) && stage.interviewer_names.length > 0) {
      lines.push(`Interviewers: ${stage.interviewer_names.join(", ")}`);
    }
    if (stage.notes) lines.push(`Notes: ${stage.notes}`);
    if (pos.description) lines.push(`Job Description:\n${pos.description}`);
    return lines.join("\n");
  }

  async function sendChatMessage() {
    const text = chatInput.trim();
    if (!text || chatSending) return;
    setChatInput("");
    await runChatRequest(text, chatMessages);
  }

  // Resend a previously-sent user message. Truncates the conversation so that
  // message becomes the most recent turn, then re-fires the request so the
  // assistant produces a fresh reply.
  async function resendUserMessage(index) {
    if (chatSending) return;
    const msg = chatMessages[index];
    if (!msg || msg.role !== "user") return;
    const baseMessages = chatMessages.slice(0, index);
    await runChatRequest(msg.content, baseMessages);
  }

  async function runChatRequest(text, baseMessages) {
    const trimmed = (text || "").trim();
    if (!trimmed) return;
    const userMsg = { role: "user", content: trimmed };
    const nextMessages = [...(baseMessages || []), userMsg];
    setChatMessages(nextMessages);
    setChatError("");
    setChatSending(true);
    try {
      let resumeText = "";
      if (resumeFile) {
        try {
          const lines = await buildTemplateLinesForUpload(resumeFile);
          resumeText = (lines || []).join("\n").trim();
        } catch {
          resumeText = "";
        }
      }

      const applicationsContext = (applicationData || []).map((app) => {
        const pos = app.positions || {};
        const resume = app.generated_resumes;
        const stages = applicationStages[app.id] || [];
        return {
          company: pos.company || null,
          role: pos.title || null,
          status: app.status || null,
          appliedAt: app.applied_at || null,
          applicationUrl: app.application_url || pos.url || null,
          jobDescription: pos.description || null,
          tailoredResume: resume?.content || null,
          stages: stages.map((s) => ({
            name: s.stage_name || null,
            type: s.stage_type || null,
            scheduledAt: s.scheduled_at || null,
            outcome: s.outcome || null,
            interviewers: s.interviewer_names || [],
            notes: s.notes || null,
          })),
        };
      });

      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: nextMessages,
          resumeText,
          applications: applicationsContext,
          pinnedContext: chatPinnedContext
            ? { label: chatPinnedContext.label, content: chatPinnedContext.content }
            : null,
          attachedFiles: (chatAttachedFiles || []).map((f) => ({ name: f.name, content: f.content })),
          tab: mainTab,
          section: activeSection,
        }),
      });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Chat request failed.");
      setChatMessages((prev) => [...prev, { role: "assistant", content: payload.reply || "" }]);
    } catch (err) {
      setChatError(err.message || "Chat request failed.");
    } finally {
      setChatSending(false);
    }
  }

  useEffect(() => {
    const el = chatScrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [chatMessages, chatSending, chatOpen]);

  useEffect(() => {
    if (!chatPinnedContext?.sourceJobId) return;
    const jobId = chatPinnedContext.sourceJobId;
    const tailoring = tailoringMap[jobId];
    if (!tailoring?.result) return;
    const tailoredBlock = `\n\nTailored Resume:\n${tailoring.result}`;
    if (chatPinnedContext.content?.includes(tailoredBlock)) return;
    const jobFromResults = jobResults.find((j) => j.id === jobId);
    const jobFromTracked = trackedJobs.find((j) => j.id === jobId);
    const jobForContext = jobFromResults || jobFromTracked;
    if (!jobForContext) return;
    setChatPinnedContext((prev) =>
      prev && prev.sourceJobId === jobId
        ? { ...prev, content: `${buildJobContextString(jobForContext)}${tailoredBlock}` }
        : prev,
    );
  }, [tailoringMap, chatPinnedContext, jobResults, trackedJobs]);

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

  function handleRegenerateSyntheticJob(job) {
    if (!job?.id) return;
    if (typeof job.id === "string" && job.id.startsWith("url-") && job.url) {
      handleUrlSubmit(null, { overrideUrl: job.url, syntheticJobId: job.id });
      return;
    }
    if (typeof job.id === "string" && job.id.startsWith("manual-") && job.description) {
      handleManualSubmit(null, { overridePosting: job.description, syntheticJobId: job.id });
    }
  }

  async function handleTailorJob(job, opts = {}) {
    const { skipDownload = false } = opts;
    // Await so its upsertApplication({status:'tracking'}) is guaranteed to
    // land BEFORE the later status promotion below. Otherwise a fire-and-
    // forget version can race in and overwrite auto_tailored back to tracking.
    await handleTrackJob(job);
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
      formData.append("aggressiveness", String(aggressiveness));
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
      const coverLetterError = typeof payload.coverLetterError === "string" ? payload.coverLetterError : "";

      updateTailoringJob(job.id, {
        status: "done",
        result,
        resultLines,
        generatedJobTitle,
        coverLetterResultLines,
        error: coverLetterError || "",
      });

      // Persist the generated resume and link it to the application
      if (currentUser) {
        const supabase = createClient();
        // Use upsertPosition (not just getPositionId) so a position row is
        // created on the fly if the user tailored a job they hadn't tracked.
        const positionId = await upsertPosition(supabase, job);
        if (!positionId) {
          console.error("[handleTailorJob] upsertPosition returned null for job", job?.id, job?.title);
        }
        const generatedResumeId = await saveGeneratedResume(supabase, {
          userId: currentUser.id,
          positionId,
          content: result,
          contentLines: resultLines,
          sourceResumePath: `${currentUser.id}/resume`,
          additionalContext: additionalContext || null,
        });
        if (!generatedResumeId) {
          console.error("[handleTailorJob] saveGeneratedResume returned null", { userId: currentUser.id, positionId });
        }
        if (generatedResumeId && positionId) {
          // Make sure an application row exists for this (user, position) so
          // the tailored job shows up in the Tracking tab even if the user
          // never clicked "Track" first.
          const appId = await upsertApplication(supabase, {
            userId: currentUser.id,
            positionId,
            status: "tracking",
          });
          if (!appId) {
            console.error("[handleTailorJob] upsertApplication returned null", { userId: currentUser.id, positionId });
          }
          // Always link the freshly generated resume.
          const { error: linkErr } = await supabase
            .from("applications")
            .update({ resume_used_id: generatedResumeId })
            .eq("user_id", currentUser.id)
            .eq("position_id", positionId);
          if (linkErr) console.error("[handleTailorJob] link resume failed:", linkErr);
          // Upgrade status → tailored (or auto_tailored when this run came
          // from "Tailor all visible" / batch flow). The auto_tailored
          // status routes these rows to the dedicated Auto Tailor tab
          // instead of the Interviewing tab.
          //
          // We use a NOT-IN filter on the applied-and-later pipeline states
          // (instead of a tighter IN filter on the pre-applied states) so
          // that any unexpected/stale value — including NULL, or a status
          // that wasn't anticipated — still gets promoted. We only refuse to
          // downgrade rows that are already past the apply stage.
          const targetStatus = opts.markAsAutoTailor ? "auto_tailored" : "tailored";
          const protectedStatuses = ["applied", "interviewing", "offer", "rejected", "withdrawn"];
          console.log(
            "[handleTailorJob] promoting status",
            { jobId: job?.id, positionId, targetStatus, markAsAutoTailor: !!opts.markAsAutoTailor },
          );
          const { data: updatedRows, error: statusErr } = await supabase
            .from("applications")
            .update({ status: targetStatus })
            .eq("user_id", currentUser.id)
            .eq("position_id", positionId)
            .not("status", "in", `(${protectedStatuses.join(",")})`)
            .select("id, status");
          if (statusErr) {
            console.error("[handleTailorJob] status update failed:", statusErr);
          } else {
            console.log(
              "[handleTailorJob] status update result",
              { jobId: job?.id, positionId, updatedRows },
            );
            // Read-back so we can see the row's final state even if 0 rows
            // were touched by the update (e.g. due to RLS, constraint, or
            // the row simply not existing).
            const { data: verifyRow } = await supabase
              .from("applications")
              .select("id, status")
              .eq("user_id", currentUser.id)
              .eq("position_id", positionId)
              .maybeSingle();
            console.log(
              "[handleTailorJob] post-update read-back",
              { jobId: job?.id, positionId, verifyRow },
            );
          }
          // Trigger the Interviewing tab to refetch so the new tailored row
          // (or its freshly attached resume) shows up immediately. During a
          // batch tailor this fires once per completed job so rows appear as
          // they're produced.
          setApplicationsRefreshKey((k) => k + 1);
        }
      }

      if (skipDownload) {
        // Caller (e.g. batch tailoring in "no download" mode) doesn't want a
        // file save prompt for every job. The result is still persisted and
        // available via the per-job card download button.
        return;
      }

      const dlError = await downloadDocxFiles({
        jobTitle: generatedJobTitle || job.title,
        company: job.company,
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

  // Concurrency-limited batch runner: tailor every job in `jobs` in parallel,
  // capped at `limit` simultaneous requests so we don't hammer Gemini.
  async function runWithConcurrency(items, limit, worker) {
    const queue = items.slice();
    const runners = new Array(Math.min(limit, queue.length)).fill(null).map(async () => {
      while (queue.length > 0) {
        const next = queue.shift();
        try {
          await worker(next);
        } catch {
          // worker is responsible for surfacing its own errors via
          // updateTailoringJob; swallow so one failure doesn't kill the batch.
        }
        setBatchTailorState((s) => ({ ...s, completed: s.completed + 1 }));
      }
    });
    await Promise.all(runners);
  }

  async function handleTailorAllVisible(jobs) {
    if (!resumeFile) {
      setJobSearchError("Upload a resume first before batch tailoring.");
      return;
    }
    const candidates = jobs.filter((job) => {
      if (appliedJobIds.has(job.id)) return false;
      const t = tailoringMap[job.id];
      if (!t) return true;
      return t.status !== "done" && t.status !== "tailoring";
    });
    if (candidates.length === 0) {
      setJobSearchError("Nothing to tailor — every visible job is already tailored, in progress, or marked applied.");
      return;
    }
    setJobSearchError("");
    setBatchTailorDialog({
      open: true,
      candidates,
      selectedIds: candidates.map((c) => c.id),
    });
  }

  async function startBatchTailor(skipDownload) {
    const { candidates, selectedIds } = batchTailorDialog;
    const selectedSet = new Set(selectedIds);
    const chosen = (candidates || []).filter((c) => selectedSet.has(c.id));
    setBatchTailorDialog({ open: false, candidates: [], selectedIds: [] });
    if (chosen.length === 0) return;
    setBatchTailorState({ running: true, total: chosen.length, completed: 0 });
    try {
      await runWithConcurrency(chosen, 3, (job) => handleTailorJob(job, { skipDownload, markAsAutoTailor: true }));
    } finally {
      setBatchTailorState((s) => ({ ...s, running: false }));
      // Force one more refresh after all jobs settle so the Auto Tailor tab
      // picks up every row, even when per-job refresh triggers raced with
      // the loader. When the user picked the no-download path, also drop
      // them on the Auto Tailor tab so the results are immediately visible
      // (they would otherwise have no downloaded files as a visual cue).
      setApplicationsRefreshKey((k) => k + 1);
      if (skipDownload) {
        setMainTab("applying");
        setActiveSection("autoTailor");
      }
    }
  }

  async function handleUrlSubmit(event, opts = {}) {
    if (event && typeof event.preventDefault === "function") event.preventDefault();

    const sourceUrl = (opts.overrideUrl ?? urlPosting).trim();

    if (!sourceUrl) {
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

    const trimmedUrl = sourceUrl;
    const syntheticJobId = opts.syntheticJobId ?? `url-${trimmedUrl}`;
    setTrackedJobs((prev) =>
      prev.some((j) => j.id === syntheticJobId)
        ? prev
        : [...prev, { id: syntheticJobId, title: "Generating from URL…", company: "", url: trimmedUrl }],
    );
    updateTailoringJob(syntheticJobId, { status: "tailoring" });

    try {
      const formData = new FormData();
      formData.append("jobPostingUrl", trimmedUrl);
      formData.append("additionalContext", additionalContext);
      formData.append("aggressiveness", String(aggressiveness));
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
      const nextJobDescription = typeof payload.jobDescription === "string" ? payload.jobDescription.trim() : "";
      const nextCompany = typeof payload.company === "string" ? payload.company.trim() : "";
      const nextCoverLetterResultLines = Array.isArray(payload.coverLetterResultLines)
        ? payload.coverLetterResultLines
        : [];
      const nextCoverLetterError = typeof payload.coverLetterError === "string" ? payload.coverLetterError : "";

      setUrlResult(nextResult);
      setUrlResultLines(nextResultLines);
      setUrlCoverLetterResultLines(nextCoverLetterResultLines);
      if (nextCoverLetterError) setUrlError(nextCoverLetterError);
      setUrlGeneratedJobTitle(nextJobTitle);
      setUrlHasCompleted(true);

      // Update the synthesized tracked job's title now that we have one.
      const syntheticJob = {
        id: syntheticJobId,
        title: nextJobTitle || "Untitled role",
        company: nextCompany,
        url: trimmedUrl,
        description: nextJobDescription,
      };
      setTrackedJobs((prev) =>
        prev.map((j) =>
          j.id === syntheticJobId
            ? { ...j, title: syntheticJob.title, company: syntheticJob.company || j.company }
            : j,
        ),
      );
      updateTailoringJob(syntheticJobId, { status: "done" });

      // Persist the generated resume and link to an application
      if (currentUser) {
        const supabase = createClient();
        const positionId = await upsertPosition(supabase, syntheticJob);
        const generatedResumeId = await saveGeneratedResume(supabase, {
          userId: currentUser.id,
          positionId,
          content: nextResult,
          contentLines: nextResultLines,
          sourceResumePath: `${currentUser.id}/resume`,
          additionalContext: additionalContext || null,
        });
        if (positionId) {
          await upsertApplication(supabase, { userId: currentUser.id, positionId, status: "applied" });
          if (generatedResumeId) {
            await supabase
              .from("applications")
              .update({ resume_used_id: generatedResumeId })
              .eq("user_id", currentUser.id)
              .eq("position_id", positionId);
          }
        }
        setApplicationsRefreshKey((k) => k + 1);
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
      updateTailoringJob(syntheticJobId, { status: "error" });
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

  async function handleManualSubmit(event, opts = {}) {
    if (event && typeof event.preventDefault === "function") event.preventDefault();

    const sourcePosting = opts.overridePosting ?? jobPosting;

    if (!sourcePosting.trim()) {
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

    const syntheticJobId = opts.syntheticJobId ?? `manual-${Date.now()}`;
    setTrackedJobs((prev) =>
      prev.some((j) => j.id === syntheticJobId)
        ? prev
        : [
            ...prev,
            { id: syntheticJobId, title: "Generating from posting…", company: "", url: "", description: sourcePosting },
          ],
    );
    updateTailoringJob(syntheticJobId, { status: "tailoring" });

    try {
      const formData = new FormData();
      formData.append("jobPosting", sourcePosting);
      formData.append("additionalContext", additionalContext);
      formData.append("aggressiveness", String(aggressiveness));
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
      const nextCoverLetterError = typeof payload.coverLetterError === "string" ? payload.coverLetterError : "";

      setManualResult(nextResult);
      setManualResultLines(nextResultLines);
      setManualCoverLetterResultLines(nextCoverLetterResultLines);
      if (nextCoverLetterError) setManualError(nextCoverLetterError);
      setManualGeneratedJobTitle(nextJobTitle);
      setManualHasCompleted(true);

      // Update the synthesized tracked job's title now that we have one.
      const syntheticJob = {
        id: syntheticJobId,
        title: nextJobTitle || "Untitled role",
        company: "",
        url: "",
        description: sourcePosting,
      };
      setTrackedJobs((prev) =>
        prev.map((j) => (j.id === syntheticJobId ? { ...j, title: syntheticJob.title } : j)),
      );
      updateTailoringJob(syntheticJobId, { status: "done" });

      // Persist the generated resume and link to an application
      if (currentUser) {
        const supabase = createClient();
        const positionId = await upsertPosition(supabase, syntheticJob);
        const generatedResumeId = await saveGeneratedResume(supabase, {
          userId: currentUser.id,
          positionId,
          content: nextResult,
          contentLines: nextResultLines,
          sourceResumePath: `${currentUser.id}/resume`,
          additionalContext: additionalContext || null,
        });
        if (positionId) {
          await upsertApplication(supabase, { userId: currentUser.id, positionId, status: "applied" });
          if (generatedResumeId) {
            await supabase
              .from("applications")
              .update({ resume_used_id: generatedResumeId })
              .eq("user_id", currentUser.id)
              .eq("position_id", positionId);
          }
        }
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
      updateTailoringJob(syntheticJobId, { status: "error" });
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
        <Box sx={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 2 }}>
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <h1 className={styles.title}>Resume Tailor</h1>
            <p className={styles.subtitle}>
              Upload a resume, search for remote jobs, and let Gemini tailor your
              resume to each posting.
            </p>
          </Box>
          {currentUser && (
            <Box sx={{ pt: 0.5, flexShrink: 0 }}>
              <Tooltip title="Notifications">
                <IconButton
                  size="large"
                  aria-label={`${notifUnreadCount} unread notifications`}
                  onClick={(e) => {
                    setNotifAnchorEl(e.currentTarget);
                    // Mark as read when the menu is opened.
                    setTimeout(() => { markAllNotificationsRead(); }, 0);
                  }}
                >
                  <Badge badgeContent={notifUnreadCount} color="error" max={99}>
                    <svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                      <path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"></path>
                      <path d="M13.73 21a2 2 0 0 1-3.46 0"></path>
                    </svg>
                  </Badge>
                </IconButton>
              </Tooltip>
              <Menu
                anchorEl={notifAnchorEl}
                open={Boolean(notifAnchorEl)}
                onClose={() => setNotifAnchorEl(null)}
                slotProps={{ paper: { sx: { maxWidth: 380, width: 360 } } }}
                anchorOrigin={{ vertical: "bottom", horizontal: "right" }}
                transformOrigin={{ vertical: "top", horizontal: "right" }}
              >
                <Box sx={{ px: 2, py: 1, display: "flex", alignItems: "center", justifyContent: "space-between", borderBottom: "1px solid #eceff1" }}>
                  <Box sx={{ fontWeight: 600 }}>Notifications</Box>
                </Box>
                {notifications.length === 0 ? (
                  <Box sx={{ px: 2, py: 3, color: "#78909c", fontSize: "0.85rem", textAlign: "center" }}>
                    No notifications yet.
                  </Box>
                ) : (
                  notifications.map((n) => (
                    <MenuItem
                      key={n.id}
                      onClick={() => handleNotificationClick(n)}
                      sx={{ whiteSpace: "normal", alignItems: "flex-start", py: 1, gap: 1, borderBottom: "1px solid #f5f5f5" }}
                    >
                      <Box sx={{ width: 8, height: 8, mt: 0.75, borderRadius: "50%", bgcolor: n.read_at ? "transparent" : "#1976d2", flexShrink: 0 }} />
                      <Box sx={{ flex: 1, minWidth: 0 }}>
                        <Box sx={{ fontWeight: 600, fontSize: "0.85rem" }}>{n.title}</Box>
                        {n.body && (
                          <Box sx={{ color: "#546e7a", fontSize: "0.75rem", whiteSpace: "pre-line", mt: 0.25 }}>
                            {n.body}
                          </Box>
                        )}
                        <Box sx={{ color: "#90a4ae", fontSize: "0.7rem", mt: 0.5 }}>
                          {new Date(n.created_at).toLocaleString()}
                        </Box>
                      </Box>
                    </MenuItem>
                  ))
                )}
              </Menu>
            </Box>
          )}
        </Box>

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
            Tracking
          </button>
        </div>

        {mainTab === "applying" && (
          <>

        <ApplyingControls
          currentUser={currentUser}
          resumeFile={resumeFile}
          setResumeFile={setResumeFile}
          coverLetterFile={coverLetterFile}
          setCoverLetterFile={setCoverLetterFile}
          contextPanelOpen={contextPanelOpen}
          setContextPanelOpen={setContextPanelOpen}
          aggressiveness={aggressiveness}
          setAggressiveness={setAggressiveness}
          additionalContext={additionalContext}
          setAdditionalContext={setAdditionalContext}
          setContextFiles={setContextFiles}
          referencesOpen={referencesOpen}
          setReferencesOpen={setReferencesOpen}
          references={references}
          addReference={addReference}
          updateReference={updateReference}
          removeReference={removeReference}
          copyReferenceBlock={copyReferenceBlock}
          formatReferenceBlock={formatReferenceBlock}
          referenceCopiedId={referenceCopiedId}
          copyAllReferences={copyAllReferences}
          formatAllReferences={formatAllReferences}
          allReferencesCopied={allReferencesCopied}
          educationOpen={educationOpen}
          setEducationOpen={setEducationOpen}
          educationEntries={educationEntries}
          addEducationEntry={addEducationEntry}
          updateEducationEntry={updateEducationEntry}
          removeEducationEntry={removeEducationEntry}
          copyEducationBlock={copyEducationBlock}
          formatEducationBlock={formatEducationBlock}
          educationCopiedId={educationCopiedId}
          copyAllEducation={copyAllEducation}
          formatAllEducation={formatAllEducation}
          allEducationCopied={allEducationCopied}
          renderCopyButton={renderCopyButton}
        />

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
            className={activeSection === "autoTailor" ? styles.sectionTabActive : styles.sectionTab}
            onClick={() => setActiveSection("autoTailor")}
          >
            Auto Tailor
            {autoTailorUnreadCount > 0 && (
              <Box
                component="span"
                sx={{
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  ml: 0.75,
                  minWidth: 18,
                  height: 18,
                  px: 0.5,
                  borderRadius: "9px",
                  bgcolor: "#d32f2f",
                  color: "#fff",
                  fontSize: "0.7rem",
                  fontWeight: 700,
                  lineHeight: 1,
                }}
              >
                {autoTailorUnreadCount > 99 ? "99+" : autoTailorUnreadCount}
              </Box>
            )}
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
              <Box
                sx={{
                  display: "flex",
                  gap: 1,
                  overflowX: "auto",
                  pb: 0.5,
                  // Hide scrollbar visually but keep scroll
                  scrollbarWidth: "thin",
                  "&::-webkit-scrollbar": { height: 6 },
                  "&::-webkit-scrollbar-thumb": { background: "#ccc", borderRadius: 3 },
                }}
              >
                <Box
                  role="button"
                  tabIndex={0}
                  onClick={saveCurrentSearch}
                  onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); saveCurrentSearch(); } }}
                  sx={{
                    flex: "0 0 auto",
                    minWidth: 130,
                    maxWidth: 180,
                    px: 1.25,
                    py: 1,
                    border: "1px dashed #90a4ae",
                    borderRadius: 1,
                    bgcolor: "#f5f8fa",
                    cursor: "pointer",
                    display: "flex",
                    flexDirection: "column",
                    justifyContent: "center",
                    alignItems: "center",
                    color: "#37474f",
                    fontSize: "0.75rem",
                    lineHeight: 1.2,
                    textAlign: "center",
                    "&:hover": { bgcolor: "#eceff1" },
                  }}
                  title="Save current search controls"
                >
                  <Box sx={{ fontSize: "1rem", fontWeight: 600 }}>+ Save</Box>
                  <Box sx={{ opacity: 0.7 }}>current search</Box>
                </Box>
                {savedSearches.map((entry) => {
                  const chipSummaryParts = [];
                  if (Array.isArray(entry.selectedCategories) && entry.selectedCategories.length > 0) {
                    chipSummaryParts.push(`${entry.selectedCategories.length} cat`);
                  }
                  if (Array.isArray(entry.selectedCompanies) && entry.selectedCompanies.length > 0) {
                    chipSummaryParts.push(`${entry.selectedCompanies.length} co`);
                  }
                  if (Array.isArray(entry.excludedCompanies) && entry.excludedCompanies.length > 0) {
                    chipSummaryParts.push(`-${entry.excludedCompanies.length} ex`);
                  }
                  if (entry.maxYearsExp && entry.maxYearsExp !== "any") {
                    chipSummaryParts.push(`≤${entry.maxYearsExp}y`);
                  }
                  const queryLabel =
                    (Array.isArray(entry.jobKeywords) && entry.jobKeywords.length > 0
                      ? entry.jobKeywords.join(", ")
                      : (entry.jobQuery || "").trim()) || "—";
                  const isActive = activeSavedSearchId === entry.id;
                  return (
                    <Box
                      key={entry.id}
                      role="button"
                      tabIndex={0}
                      onClick={() => applySavedSearch(entry)}
                      onKeyDown={(e) => { if (e.key === "Enter") { e.preventDefault(); applySavedSearch(entry); } }}
                      sx={{
                        flex: "0 0 auto",
                        minWidth: 150,
                        maxWidth: 220,
                        px: 1.25,
                        py: 0.75,
                        border: isActive ? "1px solid #1976d2" : "1px solid #cfd8dc",
                        borderRadius: 1,
                        bgcolor: isActive ? "#e3f2fd" : "#fff",
                        boxShadow: isActive ? "0 0 0 2px rgba(25, 118, 210, 0.18)" : "none",
                        cursor: "pointer",
                        position: "relative",
                        display: "flex",
                        flexDirection: "column",
                        gap: 0.25,
                        fontSize: "0.75rem",
                        transition: "background-color 120ms ease, box-shadow 120ms ease, border-color 120ms ease",
                        "&:hover": { borderColor: "#1976d2", boxShadow: isActive ? "0 0 0 2px rgba(25, 118, 210, 0.25)" : 1 },
                      }}
                      title={`Apply saved search: ${entry.name}`}
                    >
                      <Box
                        sx={{
                          fontWeight: 600,
                          fontSize: "0.8rem",
                          pr: 2,
                          whiteSpace: "nowrap",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                        }}
                      >
                        {entry.name}
                      </Box>
                      <Box
                        sx={{
                          color: "#546e7a",
                          whiteSpace: "nowrap",
                          overflow: "hidden",
                          textOverflow: "ellipsis",
                        }}
                      >
                        {queryLabel}
                      </Box>
                      {chipSummaryParts.length > 0 && (
                        <Box sx={{ color: "#78909c", fontSize: "0.7rem" }}>
                          {chipSummaryParts.join(" · ")}
                        </Box>
                      )}
                      <IconButton
                        size="small"
                        aria-label={`Delete saved search ${entry.name}`}
                        onClick={(e) => { e.stopPropagation(); deleteSavedSearch(entry.id); }}
                        sx={{
                          position: "absolute",
                          top: 2,
                          right: 2,
                          p: 0.25,
                          color: "#90a4ae",
                          "&:hover": { color: "#d32f2f", bgcolor: "transparent" },
                        }}
                      >
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
                      </IconButton>
                    </Box>
                  );
                })}
              </Box>
              <Autocomplete
                multiple
                freeSolo
                options={[]}
                value={jobKeywords}
                onChange={(_, newValue) => {
                  const cleaned = newValue
                    .map((v) => (typeof v === "string" ? v.trim() : ""))
                    .filter(Boolean);
                  const seen = new Set();
                  const deduped = [];
                  for (const v of cleaned) {
                    const key = v.toLowerCase();
                    if (seen.has(key)) continue;
                    seen.add(key);
                    deduped.push(v);
                  }
                  setJobKeywords(deduped);
                  setActiveSavedSearchId(null);
                }}
                renderInput={(params) => (
                  <TextField
                    {...params}
                    size="small"
                    label="Job title or keywords"
                    placeholder={
                      jobKeywords.length === 0
                        ? "e.g. react, frontend, typescript (press Enter to add)"
                        : ""
                    }
                  />
                )}
                renderTags={(value, getTagProps) =>
                  value.map((option, index) => (
                    <Chip key={option} label={option} size="small" {...getTagProps({ index })} />
                  ))
                }
              />
              <FormControl size="small" sx={{ minWidth: 150, alignSelf: "flex-start" }}>
                <InputLabel>Experience</InputLabel>
                <Select
                  label="Experience"
                  value={maxYearsExp}
                  onChange={(e) => { setMaxYearsExp(e.target.value); setActiveSavedSearchId(null); }}
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
                  setActiveSavedSearchId(null);
                  // Sync the company multiselect to match the chosen categories.
                  // Done inline (not via a reactive effect) so restoring
                  // `selectedCategories` from localStorage on reload doesn't
                  // clobber the also-restored `selectedCompanies`.
                  const matched =
                    newValue.length === 0
                      ? []
                      : GREENHOUSE_COMPANIES.filter((c) =>
                          c.categories.some((cat) => newValue.includes(cat))
                        );
                  setSelectedCompanies(matched);
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
                  setActiveSavedSearchId(null);
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
              <Autocomplete
                multiple
                options={GREENHOUSE_COMPANIES}
                getOptionLabel={(option) => option.name}
                value={excludedCompanies}
                onChange={(_, newValue) => { setExcludedCompanies(newValue); setActiveSavedSearchId(null); }}
                isOptionEqualToValue={(option, value) => option.slug === value.slug}
                renderInput={(params) => (
                  <TextField
                    {...params}
                    size="small"
                    label="Exclude Companies"
                    placeholder={excludedCompanies.length === 0 ? "Hide companies from results" : ""}
                  />
                )}
                renderTags={(value, getTagProps) =>
                  value.map((option, index) => (
                    <Chip key={option.slug} label={option.name} size="small" {...getTagProps({ index })} />
                  ))
                }
              />
              <Autocomplete
                multiple
                freeSolo
                options={[]}
                value={excludedTitleKeywords}
                onChange={(_, newValue) => {
                  const cleaned = newValue
                    .map((v) => (typeof v === "string" ? v.trim() : ""))
                    .filter(Boolean);
                  const seen = new Set();
                  const deduped = [];
                  for (const v of cleaned) {
                    const key = v.toLowerCase();
                    if (seen.has(key)) continue;
                    seen.add(key);
                    deduped.push(v);
                  }
                  setExcludedTitleKeywords(deduped);
                  setActiveSavedSearchId(null);
                }}
                renderInput={(params) => (
                  <TextField
                    {...params}
                    size="small"
                    label="Exclude title keywords"
                    placeholder={
                      excludedTitleKeywords.length === 0
                        ? "e.g. senior, manager, sales (press Enter to add)"
                        : ""
                    }
                  />
                )}
                renderTags={(value, getTagProps) =>
                  value.map((option, index) => (
                    <Chip key={option} label={option} size="small" {...getTagProps({ index })} />
                  ))
                }
              />
              <Button
                type="submit"
                variant="contained"
                disabled={isSearching || jobKeywords.length === 0}
                sx={{ whiteSpace: "nowrap", alignSelf: "flex-start" }}
              >
                {isSearching ? "Searching..." : "Search Jobs"}
              </Button>
            </form>

            {jobSearchError ? <p className={styles.error}>{jobSearchError}</p> : null}

            {jobResults.length > 0 ? (() => {
              const excludedNames = new Set(
                excludedCompanies.map((c) => (typeof c === "string" ? c : c.name).toLowerCase()),
              );
              const companyFiltered = excludedNames.size > 0
                ? jobResults.filter((j) => !excludedNames.has((j.company || "").toLowerCase()))
                : jobResults;
              const requiredKeywordsLower = jobKeywords
                .map((k) => k.trim().toLowerCase())
                .filter(Boolean);
              const keywordFiltered = requiredKeywordsLower.length > 0
                ? companyFiltered.filter((j) => {
                    const haystack = `${j.title || ""} ${j.description || ""}`.toLowerCase();
                    return requiredKeywordsLower.every((kw) => haystack.includes(kw));
                  })
                : companyFiltered;
              const titleKeywordsLower = excludedTitleKeywords
                .map((k) => k.trim().toLowerCase())
                .filter(Boolean);
              const titleFiltered = titleKeywordsLower.length > 0
                ? keywordFiltered.filter((j) => {
                    const title = (j.title || "").toLowerCase();
                    return !titleKeywordsLower.some((kw) => title.includes(kw));
                  })
                : keywordFiltered;
              const yearsFiltered =
                maxYearsExp === "any"
                  ? titleFiltered
                  : titleFiltered.filter((j) => {
                      const minReq = extractMinYearsRequired(j.description);
                      if (minReq === null) return true;
                      return minReq <= parseInt(maxYearsExp, 10);
                    });
              const visibleJobs = yearsFiltered.filter((j) => !ignoredJobIds.has(j.id));
              const ignoredInResults = yearsFiltered.filter((j) => ignoredJobIds.has(j.id));
              return (
                <>
                  {visibleJobs.length > 0 ? (
                    <Box sx={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: 1, mb: 1 }}>
                      <Box sx={{ fontSize: 13, color: "var(--text-secondary)" }}>
                        {batchTailorState.running
                          ? `Tailoring ${batchTailorState.completed} / ${batchTailorState.total}…`
                          : `${visibleJobs.length} job${visibleJobs.length === 1 ? "" : "s"} visible`}
                      </Box>
                      <Button
                        size="small"
                        variant="contained"
                        disabled={!resumeFile || batchTailorState.running}
                        onClick={() => handleTailorAllVisible(visibleJobs)}
                        sx={{ whiteSpace: "nowrap" }}
                      >
                        {batchTailorState.running
                          ? `Tailoring ${batchTailorState.completed}/${batchTailorState.total}…`
                          : (() => {
                              const pending = visibleJobs.filter((j) => {
                                if (appliedJobIds.has(j.id)) return false;
                                const t = tailoringMap[j.id];
                                if (!t) return true;
                                return t.status !== "done" && t.status !== "tailoring";
                              }).length;
                              return `Tailor all visible (${pending})`;
                            })()}
                      </Button>
                    </Box>
                  ) : null}
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
                              {job.url ? (
                                <a
                                  href={job.url}
                                  target="_blank"
                                  rel="noopener noreferrer"
                                  className={styles.jobCardTitle}
                                  style={{ textDecoration: "underline", color: "var(--accent, #1976d2)", cursor: "pointer" }}
                                >
                                  {job.title}
                                </a>
                              ) : (
                                <p className={styles.jobCardTitle}>{job.title}</p>
                              )}
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
                                  className={`${styles.cardBtn} ${styles.cardBtnSecondary}`}
                                  onClick={() => askAiAbout({
                                    label: `Job: ${job.company || ""}${job.company && job.title ? " — " : ""}${job.title || ""}`.trim() || "Job posting",
                                    content: buildJobContextString(job),
                                  })}
                                  title="Ask AI about this job"
                                >
                                  Ask AI
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
        ) : activeSection === "autoTailor" ? (
          <AutoTailorTab
            currentUser={currentUser}
            savedSearches={savedSearches}
            setSavedSearchAutoTailor={setSavedSearchAutoTailor}
            deleteSavedSearch={deleteSavedSearch}
            autoTailoredLoading={autoTailoredLoading}
            autoTailoredError={autoTailoredError}
            autoTailoredPostings={autoTailoredPostings}
            applyAutoTailoredRow={applyAutoTailoredRow}
            downloadAutoTailoredResume={downloadAutoTailoredResume}
            setAutoTailoredError={setAutoTailoredError}
          />
        ) : activeSection === "manual" ? (
          <JobDescriptionTab
            jobPosting={jobPosting}
            setJobPosting={setJobPosting}
            manualIsSubmitting={manualIsSubmitting}
            manualError={manualError}
            handleManualSubmit={handleManualSubmit}
            askAiAbout={askAiAbout}
          />
        ) : (
          <PostingUrlTab
            urlPosting={urlPosting}
            setUrlPosting={setUrlPosting}
            urlIsSubmitting={urlIsSubmitting}
            urlError={urlError}
            handleUrlSubmit={handleUrlSubmit}
            askAiAbout={askAiAbout}
          />
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
              <>
                <Box sx={{ mb: 2 }}>
                  <Button variant="outlined" size="small" onClick={openAddApplicationDialog}>
                    + Add Row
                  </Button>
                </Box>
                <p style={{ color: "var(--text-secondary)" }}>No applications yet. Apply to jobs in the Applying tab, or add your own row.</p>
              </>
            ) : (
              <>
                <Box sx={{ mb: 2.5, display: "flex", alignItems: "center", gap: 1.5, flexWrap: "wrap" }}>
                  <TextField
                    label="Search company or role"
                    value={interviewSearch}
                    onChange={(e) => setInterviewSearch(e.target.value)}
                    size="small"
                    placeholder="e.g. Stripe or frontend"
                    sx={{ maxWidth: 380, flex: 1, minWidth: 220 }}
                  />
                  <Button variant="outlined" size="small" onClick={openAddApplicationDialog}>
                    + Add Row
                  </Button>
                </Box>
                <TableContainer sx={{ maxHeight: "calc(100vh - 280px)" }}>
                  <Table size="small" stickyHeader>
                    <TableHead>
                      <TableRow>
                        <TableCell
                          sortDirection={interviewSort.field === "company" ? interviewSort.dir : false}
                          sx={{
                            fontWeight: 700,
                            position: "sticky",
                            left: 0,
                            width: companyColWidth,
                            minWidth: companyColWidth,
                            maxWidth: companyColWidth,
                            zIndex: 4,
                            backgroundColor: "var(--bg-surface, #fff)",
                            boxShadow: "1px 0 0 var(--border)",
                          }}
                        >
                          <Box sx={{ position: "relative", pr: 1.5 }}>
                            <TableSortLabel
                              active
                              direction={interviewSort.field === "company" ? interviewSort.dir : "asc"}
                              onClick={() => toggleInterviewSort("company")}
                              sx={sortLabelSx("company")}
                            >
                              Company
                            </TableSortLabel>
                            <Box
                              onPointerDown={(e) => startColResize("company", e)}
                              sx={{
                                position: "absolute",
                                top: -8,
                                right: -12,
                                width: 10,
                                height: "calc(100% + 16px)",
                                cursor: "col-resize",
                                "&:hover": { backgroundColor: "var(--accent, #1976d2)", opacity: 0.4 },
                              }}
                              title="Drag to resize"
                            />
                          </Box>
                        </TableCell>
                        <TableCell
                          sortDirection={interviewSort.field === "title" ? interviewSort.dir : false}
                          sx={{
                            fontWeight: 700,
                            position: "sticky",
                            left: companyColWidth,
                            width: roleColWidth,
                            minWidth: roleColWidth,
                            maxWidth: roleColWidth,
                            zIndex: 4,
                            backgroundColor: "var(--bg-surface, #fff)",
                            boxShadow: "1px 0 0 var(--border)",
                          }}
                        >
                          <Box sx={{ position: "relative", pr: 1.5 }}>
                            <TableSortLabel
                              active
                              direction={interviewSort.field === "title" ? interviewSort.dir : "asc"}
                              onClick={() => toggleInterviewSort("title")}
                              sx={sortLabelSx("title")}
                            >
                              Role
                            </TableSortLabel>
                            <Box
                              onPointerDown={(e) => startColResize("role", e)}
                              sx={{
                                position: "absolute",
                                top: -8,
                                right: -12,
                                width: 10,
                                height: "calc(100% + 16px)",
                                cursor: "col-resize",
                                "&:hover": { backgroundColor: "var(--accent, #1976d2)", opacity: 0.4 },
                              }}
                              title="Drag to resize"
                            />
                          </Box>
                        </TableCell>
                        <TableCell
                          sortDirection={interviewSort.field === "status" ? interviewSort.dir : false}
                          sx={{ fontWeight: 700 }}
                        >
                          <TableSortLabel
                            active
                            direction={interviewSort.field === "status" ? interviewSort.dir : "asc"}
                            onClick={() => toggleInterviewSort("status")}
                            sx={sortLabelSx("status")}
                          >
                            Status
                          </TableSortLabel>
                        </TableCell>
                        <TableCell
                          sortDirection={interviewSort.field === "applied_at" ? interviewSort.dir : false}
                          sx={{ fontWeight: 700 }}
                        >
                          <TableSortLabel
                            active
                            direction={interviewSort.field === "applied_at" ? interviewSort.dir : "asc"}
                            onClick={() => toggleInterviewSort("applied_at")}
                            sx={sortLabelSx("applied_at")}
                          >
                            Applied
                          </TableSortLabel>
                        </TableCell>
                        <TableCell sx={{ fontWeight: 700 }}>Recruiter Communications</TableCell>
                        <TableCell sx={{ fontWeight: 700 }}>Job Description</TableCell>
                        <TableCell sx={{ fontWeight: 700 }}>Your Resume</TableCell>
                        <TableCell sx={{ fontWeight: 700 }}>Links</TableCell>
                        <TableCell sx={{ fontWeight: 700 }}>Actions</TableCell>
                      </TableRow>
                    </TableHead>
                    <TableBody>
                      {visibleApplicationData.map((app) => {
                        const idx = applicationData.findIndex((candidate) => candidate.id === app.id);
                        const pos = app.positions;
                        const resume = app.generated_resumes;
                        const stages = applicationStages[app.id] || [];
                        const statusConfig = {
                          tailored: { label: "Tailored", color: "default" },
                          applied: { label: "Applied", color: "primary" },
                          phone_screen: { label: "Phone Screen", color: "info" },
                          interviewing: { label: "Interviewing", color: "warning" },
                          offer: { label: "Offer", color: "secondary" },
                          accepted: { label: "Accepted", color: "success" },
                          rejected: { label: "Rejected", color: "error" },
                          withdrawn: { label: "Withdrawn", color: "default" },
                        }[app.status] || { label: app.status, color: "default" };

                        return (
                          <TableRow
                            key={app.id}
                            hover
                            onClick={(e) => {
                              // Ignore clicks that originated on an interactive
                              // child (buttons, links, chips, inputs) so the
                              // row-level handler doesn't hijack inline actions.
                              if (e.target.closest("a, button, input, textarea, select, [role='button']")) {
                                return;
                              }
                              openEditApplicationDialog(app);
                            }}
                            sx={{ cursor: "pointer" }}
                          >
                            <TableCell
                              sx={{
                                fontWeight: 600,
                                whiteSpace: "nowrap",
                                overflow: "hidden",
                                textOverflow: "ellipsis",
                                position: "sticky",
                                left: 0,
                                width: companyColWidth,
                                minWidth: companyColWidth,
                                maxWidth: companyColWidth,
                                zIndex: 2,
                                backgroundColor: "var(--bg-surface, #fff)",
                                boxShadow: "1px 0 0 var(--border)",
                              }}
                            >
                              {pos?.company || "\u2014"}
                            </TableCell>
                            <TableCell
                              sx={{
                                whiteSpace: "nowrap",
                                overflow: "hidden",
                                textOverflow: "ellipsis",
                                position: "sticky",
                                left: companyColWidth,
                                width: roleColWidth,
                                minWidth: roleColWidth,
                                maxWidth: roleColWidth,
                                zIndex: 2,
                                backgroundColor: "var(--bg-surface, #fff)",
                                boxShadow: "1px 0 0 var(--border)",
                              }}
                            >
                              {pos?.title || "\u2014"}
                            </TableCell>
                            <TableCell>
                              <Box sx={{ display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 0.75 }}>
                                <Box sx={{ display: "flex", alignItems: "center", gap: 0.75, flexWrap: "wrap" }}>
                                  <Chip
                                    label={statusConfig.label}
                                    color={statusConfig.color}
                                    size="small"
                                    onClick={() => askAiAbout({
                                      label: `${pos?.company || "Application"}${pos?.title ? ` — ${pos.title}` : ""} · ${statusConfig.label}`,
                                      content: buildApplicationContextString(app),
                                      prompt: `Based on the "${statusConfig.label}" status of my application to ${pos?.company || "this company"}${pos?.title ? ` for ${pos.title}` : ""}, `,
                                    })}
                                    sx={{ cursor: "pointer" }}
                                    title="Ask AI about this status"
                                  />
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
                                              durationMinutes: stage.duration_minutes ? String(stage.duration_minutes) : "",
                                              outcome: stage.outcome || "pending",
                                              interviewerNames: (stage.interviewer_names || []).join(", "),
                                              notes: stage.notes || "",
                                            }));
                                          }}
                                          onDelete={() => askAiAbout({
                                            label: `${pos?.company || "Application"} · ${stageLabel}`,
                                            content: buildStageContextString(app, stage),
                                            prompt: `Help me prepare for my "${stage.stage_name || stage.stage_type || "interview"}" at ${pos?.company || "this company"}: `,
                                          })}
                                          deleteIcon={<span style={{ fontSize: 11, padding: "0 4px", color: "var(--accent, #1976d2)" }} title="Ask AI">AI</span>}
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
                            <TableCell sx={{ whiteSpace: "nowrap" }}>
                              <Box sx={{ display: "flex", flexDirection: "column", alignItems: "flex-start", gap: 0.2 }}>
                                <Button
                                  size="small"
                                  sx={{ minWidth: 0, p: 0, fontSize: 11 }}
                                  onClick={() => openCommsInAppDialog(app, idx)}
                                >
                                  View
                                </Button>
                                <Button
                                  size="small"
                                  sx={{ minWidth: 0, p: 0, fontSize: 11 }}
                                  onClick={() => openAddCommunicationDialog(app)}
                                >
                                  Add
                                </Button>
                              </Box>
                            </TableCell>
                            <TableCell sx={{ maxWidth: 220 }}>
                              {pos?.description ? (
                                <Box sx={{ display: "flex", alignItems: "flex-start", gap: 0.5, flexDirection: "column" }}>
                                  <span style={{ fontSize: 12, color: "var(--text-secondary)", display: "-webkit-box", WebkitLineClamp: 2, WebkitBoxOrient: "vertical", overflow: "hidden" }}>
                                    {pos.description}
                                  </span>
                                  <Button size="small" sx={{ p: 0, minWidth: 0, fontSize: 11 }} onClick={() => setAppDialog({ open: true, rowIndex: idx, kind: "jd" })}>
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
                                  <Box sx={{ display: "flex", gap: 1, flexWrap: "wrap" }}>
                                    <Button size="small" sx={{ p: 0, minWidth: 0, fontSize: 11 }} onClick={() => setAppDialog({ open: true, rowIndex: idx, kind: "resume" })}>
                                      View full
                                    </Button>
                                    <Tooltip title="Download or drag to upload tailored DOCX">
                                      <span
                                        style={{ display: "inline-flex", alignItems: "center", cursor: (!resumeFile || !isDocxResume(resumeFile)) ? "not-allowed" : "pointer", opacity: (!resumeFile || !isDocxResume(resumeFile)) ? 0.5 : 1 }}
                                        tabIndex={0}
                                        role="button"
                                        onClick={async (e) => {
                                          if (!resumeFile || !isDocxResume(resumeFile)) return;
                                          const lines = Array.isArray(resume.content_lines) && resume.content_lines.length > 0
                                            ? resume.content_lines
                                            : (resume.content || "").split("\n");
                                          const err = await downloadDocxFiles({
                                            jobTitle: pos?.title || "resume",
                                            result: resume.content,
                                            resultLines: lines,
                                            coverLetterResultLines: [],
                                          });
                                          if (err) window.alert(err);
                                        }}
                                        draggable={!!resumeFile && isDocxResume(resumeFile)}
                                        onDragStart={async (e) => {
                                          if (!resumeFile || !isDocxResume(resumeFile)) return;
                                          try {
                                            const lines = Array.isArray(resume.content_lines) && resume.content_lines.length > 0
                                              ? resume.content_lines
                                              : (resume.content || "").split("\n");
                                            const blob = await buildDocxFromUploadedTemplate(resumeFile, resume.content, lines);
                                            const file = new File([blob], getDownloadFileNameForTitle(pos?.title, pos?.company), { type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document" });
                                            e.dataTransfer.clearData();
                                            e.dataTransfer.effectAllowed = "copy";
                                            e.dataTransfer.setData("application/vnd.openxmlformats-officedocument.wordprocessingml.document", "");
                                            e.dataTransfer.items.add(file);
                                          } catch {}
                                        }}
                                        title={
                                          !resumeFile
                                            ? "Upload your source resume (.docx) to enable downloads."
                                            : !isDocxResume(resumeFile)
                                            ? "Source resume must be a .docx file to download."
                                            : "Download or drag tailored .docx"
                                        }
                                      >
                                        <DescriptionIcon fontSize="small" color="primary" />
                                      </span>
                                    </Tooltip>
                                  </Box>
                                </Box>
                              ) : "—"}
                            </TableCell>
                            <TableCell>
                              {(app.application_url || pos?.url) && (
                                <Button size="small" href={app.application_url || pos.url} target="_blank" rel="noopener noreferrer" sx={{ whiteSpace: "nowrap" }}>
                                  Posting ↗
                                </Button>
                              )}
                            </TableCell>
                            <TableCell sx={{ whiteSpace: "nowrap" }}>
                              <Box sx={{ display: "flex", gap: 0.5 }}>
                                <Button
                                  size="small"
                                  sx={{ minWidth: 0, p: 0.25, fontSize: 11 }}
                                  onClick={() => askAiAbout({
                                    label: `${pos?.company || "Application"}${pos?.title ? ` — ${pos.title}` : ""}`,
                                    content: buildApplicationContextString(app),
                                  })}
                                >
                                  Ask AI
                                </Button>
                                <Button
                                  size="small"
                                  sx={{ minWidth: 0, p: 0.25, fontSize: 11 }}
                                  onClick={() => openEditApplicationDialog(app)}
                                >
                                  Edit
                                </Button>
                                <Button
                                  size="small"
                                  color="error"
                                  sx={{ minWidth: 0, p: 0.25, fontSize: 11 }}
                                  onClick={() => handleDeleteApplication(app)}
                                >
                                  Delete
                                </Button>
                              </Box>
                            </TableCell>
                          </TableRow>
                        );
                      })}
                    </TableBody>
                  </Table>
                </TableContainer>
                {visibleApplicationData.length === 0 ? (
                  <p style={{ color: "var(--text-secondary)", marginTop: 12 }}>
                    No applications match that company or role.
                  </p>
                ) : null}
              </>
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
                  slotProps={{ inputLabel: { shrink: true } }}
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

            <Dialog
              open={communicationsDialog.open}
              onClose={() => setCommunicationsDialog({ open: false, applicationId: null, company: "", role: "", loading: false, error: "", items: [] })}
              maxWidth="md"
              fullWidth
            >
              <DialogTitle>
                Recruiter Communications
                {(communicationsDialog.company || communicationsDialog.role) ? ` — ${communicationsDialog.company || "Unknown Company"}${communicationsDialog.role ? ` / ${communicationsDialog.role}` : ""}` : ""}
              </DialogTitle>
              <DialogContent dividers sx={{ maxHeight: "70vh" }}>
                {communicationsDialog.loading ? (
                  <Box sx={{ display: "flex", justifyContent: "center", py: 4 }}>
                    <CircularProgress size={24} />
                  </Box>
                ) : communicationsDialog.error ? (
                  <p style={{ color: "var(--error, #d32f2f)", margin: 0 }}>{communicationsDialog.error}</p>
                ) : communicationsDialog.items.length === 0 ? (
                  <p style={{ color: "var(--text-secondary)", margin: 0 }}>No recruiter communications logged yet.</p>
                ) : (
                  <Box sx={{ display: "flex", flexDirection: "column", gap: 1.5 }}>
                    {communicationsDialog.items.map((item) => (
                      <Box
                        key={item.id}
                        sx={{
                          p: 1.5,
                          borderRadius: 2.5,
                          border: "1px solid rgba(15, 23, 42, 0.08)",
                          backgroundColor: "rgba(248, 250, 252, 0.8)",
                        }}
                      >
                        <Box sx={{ display: "flex", alignItems: "center", gap: 0.75, flexWrap: "wrap", mb: 1 }}>
                          <Chip size="small" label={item.direction || "inbound"} variant="outlined" />
                          <Chip size="small" label={item.type || "email"} variant="outlined" />
                          <Box component="span" sx={{ fontSize: 12, color: "var(--text-secondary)" }}>
                            {item.communicated_at ? new Date(item.communicated_at).toLocaleString() : "Logged communication"}
                          </Box>
                        </Box>
                        {item.subject ? (
                          <Box sx={{ fontWeight: 700, mb: 0.75 }}>{item.subject}</Box>
                        ) : null}
                        {(item.sender_name || item.sender_email || item.sender_title) ? (
                          <Box sx={{ mb: 0.75, fontSize: 12, color: "var(--text-secondary)" }}>
                            {[item.sender_name, item.sender_title, item.sender_email].filter(Boolean).join(" · ")}
                          </Box>
                        ) : null}
                        <Box sx={{ whiteSpace: "pre-wrap", lineHeight: 1.7, fontSize: 13.5 }}>
                          {item.body || "—"}
                        </Box>
                      </Box>
                    ))}
                  </Box>
                )}
              </DialogContent>
              <DialogActions>
                <Button onClick={() => setCommunicationsDialog({ open: false, applicationId: null, company: "", role: "", loading: false, error: "", items: [] })}>
                  Close
                </Button>
              </DialogActions>
            </Dialog>

            <Dialog
              open={addCommunicationDialog.open}
              onClose={() => {
                setCommunicationError("");
                setAddCommunicationDialog({ open: false, applicationId: null, company: "", role: "", body: "" });
              }}
              maxWidth="md"
              fullWidth
            >
              <DialogTitle>
                Add Recruiter Communication
                {(addCommunicationDialog.company || addCommunicationDialog.role) ? ` — ${addCommunicationDialog.company || "Unknown Company"}${addCommunicationDialog.role ? ` / ${addCommunicationDialog.role}` : ""}` : ""}
              </DialogTitle>
              <DialogContent dividers sx={{ pt: 2 }}>
                <TextField
                  label="Paste communication"
                  placeholder="Paste the recruiter email, LinkedIn message, or call notes here..."
                  value={addCommunicationDialog.body}
                  onChange={(e) => setAddCommunicationDialog((prev) => ({ ...prev, body: e.target.value }))}
                  fullWidth
                  multiline
                  minRows={12}
                  sx={{
                    "& .MuiOutlinedInput-root": {
                      alignItems: "flex-start",
                      borderRadius: 2.5,
                    },
                  }}
                />
                {communicationError ? (
                  <p style={{ color: "var(--error, #d32f2f)", margin: "12px 0 0" }}>{communicationError}</p>
                ) : null}
              </DialogContent>
              <DialogActions>
                <Button
                  onClick={() => {
                    setCommunicationError("");
                    setAddCommunicationDialog({ open: false, applicationId: null, company: "", role: "", body: "" });
                  }}
                >
                  Cancel
                </Button>
                <Button
                  variant="contained"
                  disabled={communicationSaving || !addCommunicationDialog.body.trim()}
                  onClick={handleSaveCommunication}
                >
                  {communicationSaving ? "Saving..." : "Save Communication"}
                </Button>
              </DialogActions>
            </Dialog>

            <Dialog
              open={editAppDialog.open}
              onClose={() => {
                if (editAppSaving) return;
                setEditAppDialog((prev) => ({ ...prev, open: false }));
              }}
              maxWidth="sm"
              fullWidth
            >
              <Box
                component="form"
                onSubmit={(e) => {
                  e.preventDefault();
                  if (editAppSaving) return;
                  handleSaveEditApplication();
                }}
              >
              <DialogTitle>Edit Application</DialogTitle>
              <DialogContent dividers sx={{ display: "flex", flexDirection: "column", gap: 2, pt: 2 }}>
                <TextField
                  label="Company"
                  value={editAppDialog.company}
                  onChange={(e) => setEditAppDialog((prev) => ({ ...prev, company: e.target.value }))}
                  fullWidth
                  size="small"
                />
                <TextField
                  label="Role"
                  value={editAppDialog.role}
                  onChange={(e) => setEditAppDialog((prev) => ({ ...prev, role: e.target.value }))}
                  fullWidth
                  size="small"
                />
                <FormControl fullWidth size="small">
                  <InputLabel id="edit-app-status-label">Status</InputLabel>
                  <Select
                    labelId="edit-app-status-label"
                    label="Status"
                    value={editAppDialog.status}
                    onChange={(e) => setEditAppDialog((prev) => ({ ...prev, status: e.target.value }))}
                  >
                    <MenuItem value="tailored">Tailored</MenuItem>
                    <MenuItem value="applied">Applied</MenuItem>
                    <MenuItem value="phone_screen">Phone Screen</MenuItem>
                    <MenuItem value="interviewing">Interviewing</MenuItem>
                    <MenuItem value="offer">Offer</MenuItem>
                    <MenuItem value="accepted">Accepted</MenuItem>
                    <MenuItem value="rejected">Rejected</MenuItem>
                    <MenuItem value="withdrawn">Withdrawn</MenuItem>
                  </Select>
                </FormControl>
                <TextField
                  type="date"
                  label="Applied"
                  value={editAppDialog.appliedAt}
                  onChange={(e) => setEditAppDialog((prev) => ({ ...prev, appliedAt: e.target.value }))}
                  fullWidth
                  size="small"
                  slotProps={{ inputLabel: { shrink: true } }}
                />
                <TextField
                  label="Application URL"
                  value={editAppDialog.applicationUrl}
                  onChange={(e) => setEditAppDialog((prev) => ({ ...prev, applicationUrl: e.target.value }))}
                  fullWidth
                  size="small"
                  placeholder="https://..."
                />
                <TextField
                  label="Job Description"
                  value={editAppDialog.description}
                  onChange={(e) => setEditAppDialog((prev) => ({ ...prev, description: e.target.value }))}
                  fullWidth
                  multiline
                  minRows={6}
                  size="small"
                />
                <Box sx={{ display: "flex", flexDirection: "column", gap: 0.5 }}>
                  <Box component="label" sx={{ fontSize: 13, fontWeight: 600, color: "var(--text-primary)" }}>
                    Resume used for this application (optional)
                  </Box>
                  <input
                    type="file"
                    accept=".docx,.txt,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain"
                    onChange={(e) => setEditAppResumeFile(e.target.files?.[0] || null)}
                  />
                  {editAppResumeFile ? (
                    <Box sx={{ fontSize: 12, color: "var(--text-secondary)" }}>
                      New upload: {editAppResumeFile.name}
                    </Box>
                  ) : (
                    <Box sx={{ fontSize: 12, color: "var(--text-secondary)" }}>
                      Upload a .docx (or .txt) to replace the resume associated with this row. Leave empty to keep the existing resume.
                    </Box>
                  )}
                </Box>
                {editAppError ? (
                  <p style={{ color: "var(--error, #d32f2f)", margin: 0 }}>{editAppError}</p>
                ) : null}
              </DialogContent>
              <DialogActions>
                <Button
                  onClick={() => setEditAppDialog((prev) => ({ ...prev, open: false }))}
                  disabled={editAppSaving}
                >
                  Cancel
                </Button>
                <Button
                  variant="contained"
                  onClick={handleSaveEditApplication}
                  disabled={editAppSaving}
                  type="submit"
                >
                  {editAppSaving ? "Saving..." : "Save Changes"}
                </Button>
              </DialogActions>
              </Box>
            </Dialog>

            <Dialog
              open={addAppDialog.open}
              onClose={() => {
                if (addAppSaving) return;
                setAddAppDialog((prev) => ({ ...prev, open: false }));
              }}
              maxWidth="sm"
              fullWidth
            >
              <DialogTitle>Add Application</DialogTitle>
              <DialogContent dividers sx={{ display: "flex", flexDirection: "column", gap: 2, pt: 2 }}>
                <TextField
                  label="Company"
                  value={addAppDialog.company}
                  onChange={(e) => setAddAppDialog((prev) => ({ ...prev, company: e.target.value }))}
                  fullWidth
                  size="small"
                  required
                />
                <TextField
                  label="Role"
                  value={addAppDialog.role}
                  onChange={(e) => setAddAppDialog((prev) => ({ ...prev, role: e.target.value }))}
                  fullWidth
                  size="small"
                  required
                />
                <FormControl fullWidth size="small">
                  <InputLabel id="add-app-status-label">Status</InputLabel>
                  <Select
                    labelId="add-app-status-label"
                    label="Status"
                    value={addAppDialog.status}
                    onChange={(e) => setAddAppDialog((prev) => ({ ...prev, status: e.target.value }))}
                  >
                    <MenuItem value="tailored">Tailored</MenuItem>
                    <MenuItem value="applied">Applied</MenuItem>
                    <MenuItem value="phone_screen">Phone Screen</MenuItem>
                    <MenuItem value="interviewing">Interviewing</MenuItem>
                    <MenuItem value="offer">Offer</MenuItem>
                    <MenuItem value="accepted">Accepted</MenuItem>
                    <MenuItem value="rejected">Rejected</MenuItem>
                    <MenuItem value="withdrawn">Withdrawn</MenuItem>
                  </Select>
                </FormControl>
                <TextField
                  type="date"
                  label="Applied"
                  value={addAppDialog.appliedAt}
                  onChange={(e) => setAddAppDialog((prev) => ({ ...prev, appliedAt: e.target.value }))}
                  fullWidth
                  size="small"
                  slotProps={{ inputLabel: { shrink: true } }}
                />
                <TextField
                  label="Application URL"
                  value={addAppDialog.applicationUrl}
                  onChange={(e) => setAddAppDialog((prev) => ({ ...prev, applicationUrl: e.target.value }))}
                  fullWidth
                  size="small"
                  placeholder="https://..."
                />
                <TextField
                  label="Job Description"
                  value={addAppDialog.description}
                  onChange={(e) => setAddAppDialog((prev) => ({ ...prev, description: e.target.value }))}
                  fullWidth
                  multiline
                  minRows={6}
                  size="small"
                />
                <Box sx={{ display: "flex", flexDirection: "column", gap: 0.5 }}>
                  <Box component="label" sx={{ fontSize: 13, fontWeight: 600, color: "var(--text-primary)" }}>
                    Resume used for this application (optional)
                  </Box>
                  <input
                    type="file"
                    accept=".docx,.txt,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/plain"
                    onChange={(e) => setAddAppResumeFile(e.target.files?.[0] || null)}
                  />
                  {addAppResumeFile ? (
                    <Box sx={{ fontSize: 12, color: "var(--text-secondary)" }}>
                      Selected: {addAppResumeFile.name}
                    </Box>
                  ) : (
                    <Box sx={{ fontSize: 12, color: "var(--text-secondary)" }}>
                      Optional. Upload a .docx (or .txt) of the resume you sent with this application.
                    </Box>
                  )}
                </Box>
                {addAppError ? (
                  <p style={{ color: "var(--error, #d32f2f)", margin: 0 }}>{addAppError}</p>
                ) : null}
              </DialogContent>
              <DialogActions>
                <Button
                  onClick={() => setAddAppDialog((prev) => ({ ...prev, open: false }))}
                  disabled={addAppSaving}
                >
                  Cancel
                </Button>
                <Button
                  variant="contained"
                  onClick={handleSaveAddApplication}
                  disabled={addAppSaving}
                >
                  {addAppSaving ? "Saving..." : "Add Application"}
                </Button>
              </DialogActions>
            </Dialog>

            {(() => {
              const dApp = appDialog.rowIndex != null ? applicationData[appDialog.rowIndex] : null;
              const dPos = dApp?.positions;
              const dResume = dApp?.generated_resumes;
              const pages = [
                dApp?.id ? "communications" : null,
                dPos?.description ? "jd" : null,
                dResume?.content ? "resume" : null,
              ].filter(Boolean);
              const pageIdx = pages.indexOf(appDialog.kind);
              const commsLoadedForThisApp =
                dApp && communicationsDialog.applicationId === dApp.id;
              const dialogTitle =
                appDialog.kind === "jd"
                  ? `${dPos?.company || ""} — Job Description`
                  : appDialog.kind === "resume"
                    ? `Your Resume — ${dPos?.title || "Role"}`
                    : `Recruiter Communications${
                        dPos?.company || dPos?.title
                          ? ` — ${dPos?.company || "Unknown Company"}${dPos?.title ? ` / ${dPos.title}` : ""}`
                          : ""
                      }`;
              const navigate = (dir) => {
                if (pages.length === 0) return;
                const next = (pageIdx + dir + pages.length) % pages.length;
                const nextKind = pages[next];
                setAppDialog((prev) => ({ ...prev, kind: nextKind }));
                if (nextKind === "communications" && dApp && communicationsDialog.applicationId !== dApp.id) {
                  loadCommunicationsForApp(dApp);
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
                        disabled={pages.length <= 1}
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
                        disabled={pages.length <= 1}
                        onClick={() => navigate(1)}
                        sx={{ minWidth: 36, px: 0.75, fontSize: 22, lineHeight: 1 }}
                        aria-label="Next"
                      >
                        ›
                      </Button>
                    </Box>
                  </DialogTitle>
                  <DialogContent dividers sx={{ maxHeight: "70vh" }}>
                    {appDialog.kind === "communications" ? (
                      !commsLoadedForThisApp || communicationsDialog.loading ? (
                        <Box sx={{ display: "flex", justifyContent: "center", py: 4 }}>
                          <CircularProgress size={24} />
                        </Box>
                      ) : communicationsDialog.error ? (
                        <p style={{ color: "var(--error, #d32f2f)", margin: 0 }}>{communicationsDialog.error}</p>
                      ) : communicationsDialog.items.length === 0 ? (
                        <Box sx={{ display: "flex", flexDirection: "column", gap: 1.5, alignItems: "flex-start" }}>
                          <p style={{ color: "var(--text-secondary)", margin: 0 }}>No recruiter communications logged yet.</p>
                          {dApp ? (
                            <Button size="small" variant="outlined" onClick={() => openAddCommunicationDialog(dApp)}>
                              Add Communication
                            </Button>
                          ) : null}
                        </Box>
                      ) : (
                        <Box sx={{ display: "flex", flexDirection: "column", gap: 1.5 }}>
                          {communicationsDialog.items.map((item) => (
                            <Box
                              key={item.id}
                              sx={{
                                p: 1.5,
                                borderRadius: 2.5,
                                border: "1px solid rgba(15, 23, 42, 0.08)",
                                backgroundColor: "rgba(248, 250, 252, 0.8)",
                              }}
                            >
                              <Box sx={{ display: "flex", alignItems: "center", gap: 0.75, flexWrap: "wrap", mb: 1 }}>
                                <Chip size="small" label={item.direction || "inbound"} variant="outlined" />
                                <Chip size="small" label={item.type || "email"} variant="outlined" />
                                <Box component="span" sx={{ fontSize: 12, color: "var(--text-secondary)" }}>
                                  {item.communicated_at ? new Date(item.communicated_at).toLocaleString() : "Logged communication"}
                                </Box>
                              </Box>
                              {item.subject ? (
                                <Box sx={{ fontWeight: 700, mb: 0.75 }}>{item.subject}</Box>
                              ) : null}
                              {(item.sender_name || item.sender_email || item.sender_title) ? (
                                <Box sx={{ mb: 0.75, fontSize: 12, color: "var(--text-secondary)" }}>
                                  {[item.sender_name, item.sender_title, item.sender_email].filter(Boolean).join(" · ")}
                                </Box>
                              ) : null}
                              <Box sx={{ whiteSpace: "pre-wrap", lineHeight: 1.7, fontSize: 13.5 }}>
                                {item.body || "—"}
                              </Box>
                            </Box>
                          ))}
                        </Box>
                      )
                    ) : (
                      <FormattedContent
                        text={appDialog.kind === "jd" ? (dPos?.description ?? "") : (dResume?.content ?? "")}
                        kind={appDialog.kind}
                      />
                    )}
                  </DialogContent>
                  <DialogActions>
                    {appDialog.kind === "communications" && dApp ? (
                      <Button onClick={() => openAddCommunicationDialog(dApp)}>
                        Add
                      </Button>
                    ) : null}
                    <Button onClick={() => setAppDialog({ open: false, rowIndex: null, kind: "jd" })}>
                      Close
                    </Button>
                  </DialogActions>
                </Dialog>
              );
            })()}
          </section>
        )}

        {/* Always-mounted dialogs (not gated by active main tab). */}
        <Dialog
          open={batchTailorDialog.open}
          onClose={() => {
            if (batchTailorState.running) return;
            setBatchTailorDialog({ open: false, candidates: [], selectedIds: [] });
          }}
          maxWidth="sm"
          fullWidth
        >
          <DialogTitle>
            Tailor {batchTailorDialog.selectedIds.length} of {batchTailorDialog.candidates.length} job
            {batchTailorDialog.candidates.length === 1 ? "" : "s"}?
          </DialogTitle>
          <DialogContent dividers>
            <Box sx={{ fontSize: 13, color: "var(--text-secondary)", mb: 1 }}>
              Each selected job will be tracked, run through the LLM, and the
              tailored resume saved to your library. Choose whether to also
              download the .docx files now.
            </Box>
            <Box sx={{ display: "flex", justifyContent: "flex-end", mb: 0.5 }}>
              <Button
                size="small"
                onClick={() => {
                  setBatchTailorDialog((prev) => {
                    const allSelected = prev.selectedIds.length === prev.candidates.length;
                    return {
                      ...prev,
                      selectedIds: allSelected ? [] : prev.candidates.map((c) => c.id),
                    };
                  });
                }}
                disabled={batchTailorState.running || batchTailorDialog.candidates.length === 0}
              >
                {batchTailorDialog.selectedIds.length === batchTailorDialog.candidates.length
                  ? "Deselect all"
                  : "Select all"}
              </Button>
            </Box>
            <Box
              sx={{
                maxHeight: 320,
                overflowY: "auto",
                border: "1px solid var(--border)",
                borderRadius: 1,
              }}
            >
              {batchTailorDialog.candidates.map((job) => {
                const checked = batchTailorDialog.selectedIds.includes(job.id);
                return (
                  <Box
                    key={job.id}
                    component="label"
                    sx={{
                      display: "flex",
                      alignItems: "flex-start",
                      gap: 1,
                      px: 1,
                      py: 0.5,
                      cursor: "pointer",
                      borderBottom: "1px solid var(--border)",
                      "&:last-of-type": { borderBottom: "none" },
                    }}
                  >
                    <Checkbox
                      size="small"
                      checked={checked}
                      disabled={batchTailorState.running}
                      onChange={(e) => {
                        const next = e.target.checked;
                        setBatchTailorDialog((prev) => {
                          const set = new Set(prev.selectedIds);
                          if (next) set.add(job.id);
                          else set.delete(job.id);
                          return { ...prev, selectedIds: Array.from(set) };
                        });
                      }}
                      sx={{ p: 0.5, mt: 0.25 }}
                    />
                    <Box sx={{ fontSize: 13, lineHeight: 1.3 }}>
                      <strong>{job.company || "Unknown"}</strong>
                      {job.title ? ` — ${job.title}` : ""}
                    </Box>
                  </Box>
                );
              })}
            </Box>
          </DialogContent>
          <DialogActions>
            <Button
              onClick={() => setBatchTailorDialog({ open: false, candidates: [], selectedIds: [] })}
              disabled={batchTailorState.running}
            >
              Cancel
            </Button>
            <Button
              onClick={() => startBatchTailor(true)}
              disabled={batchTailorState.running || batchTailorDialog.selectedIds.length === 0}
            >
              Tailor only (no download)
            </Button>
            <Button
              variant="contained"
              onClick={() => startBatchTailor(false)}
              disabled={batchTailorState.running || batchTailorDialog.selectedIds.length === 0}
            >
              Tailor &amp; download
            </Button>
          </DialogActions>
        </Dialog>
      </main>

      <Fab
        color="primary"
        variant="extended"
        onPointerDown={(e) => {
          if (e.button !== 0) return;
          fabDragStartRef.current = {
            x: e.clientX,
            y: e.clientY,
            startRight: fabPos.right,
            startBottom: fabPos.bottom,
            moved: false,
          };
          e.currentTarget.setPointerCapture(e.pointerId);
        }}
        onPointerMove={(e) => {
          const start = fabDragStartRef.current;
          if (!start) return;
          const dx = e.clientX - start.x;
          const dy = e.clientY - start.y;
          if (!start.moved && Math.hypot(dx, dy) < 4) return;
          start.moved = true;
          if (!fabDragging) setFabDragging(true);
          // right/bottom increase as we move left/up from the corner.
          const nextRight = Math.max(8, Math.min(window.innerWidth - 80, start.startRight - dx));
          const nextBottom = Math.max(8, Math.min(window.innerHeight - 48, start.startBottom - dy));
          setFabPos({ right: nextRight, bottom: nextBottom });
        }}
        onPointerUp={(e) => {
          const start = fabDragStartRef.current;
          fabDragStartRef.current = null;
          if (e.currentTarget.hasPointerCapture(e.pointerId)) {
            e.currentTarget.releasePointerCapture(e.pointerId);
          }
          setFabDragging(false);
          // Suppress click-toggle if the user actually dragged.
          if (start?.moved) return;
          setChatOpen((v) => !v);
        }}
        sx={{
          position: "fixed",
          right: fabPos.right,
          bottom: fabPos.bottom,
          zIndex: 1100,
          textTransform: "none",
          fontWeight: 700,
          letterSpacing: 0.1,
          cursor: fabDragging ? "grabbing" : "grab",
          touchAction: "none",
          boxShadow: "0 16px 32px rgba(25, 118, 210, 0.26)",
        }}
      >
        {chatOpen ? "Close" : "AI Help"}
      </Fab>

      {chatOpen ? (
        <Box
          ref={chatPanelRef}
          onDragOver={(e) => { e.preventDefault(); setChatDragActive(true); }}
          onDragEnter={(e) => { e.preventDefault(); setChatDragActive(true); }}
          onDragLeave={(e) => {
            if (e.currentTarget.contains(e.relatedTarget)) return;
            setChatDragActive(false);
          }}
          onDrop={(e) => {
            e.preventDefault();
            setChatDragActive(false);
            if (e.dataTransfer?.files?.length) {
              addChatAttachments(e.dataTransfer.files);
            }
          }}
          sx={{
            position: "fixed",
            right: fabPos.right,
            // Sit just above the FAB (~64px tall) with a small gap.
            bottom: fabPos.bottom + 68,
            width: chatSize.width,
            height: chatSize.height,
            maxWidth: "calc(100vw - 16px)",
            maxHeight: "calc(100vh - 16px)",
            zIndex: 1100,
            display: "flex",
            flexDirection: "column",
            backgroundColor: "var(--bg-surface)",
            border: chatDragActive ? "2px dashed var(--accent, #1976d2)" : "1px solid var(--border-strong)",
            borderRadius: 3,
            boxShadow: "0 24px 48px rgba(15, 23, 42, 0.18)",
            overflow: "hidden",
          }}
        >
          {/* Top-left corner resize handle. */}
          <Box
            onPointerDown={startChatResize}
            sx={{
              position: "absolute",
              top: 0,
              left: 0,
              width: 16,
              height: 16,
              cursor: "nwse-resize",
              zIndex: 2,
              touchAction: "none",
              "&::before": {
                content: '""',
                position: "absolute",
                top: 3,
                left: 3,
                width: 10,
                height: 10,
                borderTop: "2px solid var(--border-strong)",
                borderLeft: "2px solid var(--border-strong)",
                borderTopLeftRadius: 3,
                opacity: 0.6,
              },
              "&:hover::before": { opacity: 1, borderColor: "var(--accent, #1976d2)" },
            }}
          />
          <Box
            sx={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              px: 2,
              py: 1.25,
              borderBottom: "1px solid var(--border)",
              backgroundColor: "var(--bg-soft, #fbfdff)",
            }}
          >
            <Box sx={{ fontWeight: 700, fontSize: "0.95rem", color: "var(--text-primary)" }}>
              AI Help
            </Box>
            {chatMessages.length > 0 ? (
              <Button
                size="small"
                onClick={() => { setChatMessages([]); setChatError(""); }}
                sx={{ textTransform: "none", fontSize: "0.8rem", color: "var(--text-secondary)" }}
              >
                Clear
              </Button>
            ) : null}
          </Box>

          {chatPinnedContext ? (
            <Box
              sx={{
                px: 1.5,
                py: 0.75,
                borderBottom: "1px solid var(--border)",
                backgroundColor: "rgba(25, 118, 210, 0.06)",
                display: "flex",
                alignItems: "center",
                gap: 1,
              }}
            >
              <Box sx={{ fontSize: 11, fontWeight: 700, color: "var(--accent, #1976d2)", textTransform: "uppercase", letterSpacing: 0.4 }}>
                Context
              </Box>
              <Box sx={{ flex: 1, fontSize: "0.85rem", color: "var(--text-primary)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
                {chatPinnedContext.label}
              </Box>
              <Button
                size="small"
                onClick={() => setChatPinnedContext(null)}
                sx={{ minWidth: 0, p: 0.25, fontSize: 12, color: "var(--text-secondary)" }}
                aria-label="Remove context"
              >
                ✕
              </Button>
            </Box>
          ) : null}

          <Box
            ref={chatScrollRef}
            sx={{
              flex: 1,
              overflowY: "auto",
              px: 1.5,
              py: 1.5,
              display: "flex",
              flexDirection: "column",
              gap: 1,
            }}
          >
            {chatMessages.length === 0 ? (
              <Box sx={{ color: "var(--text-secondary)", fontSize: "0.9rem", lineHeight: 1.5, px: 0.5, pt: 0.5 }}>
                Ask anything about your resume, this posting, or your job search.
              </Box>
            ) : (
              chatMessages.map((m, i) => (
                <Box
                  key={i}
                  sx={{
                    alignSelf: m.role === "user" ? "flex-end" : "flex-start",
                    maxWidth: "85%",
                    position: "relative",
                    display: "flex",
                    flexDirection: "column",
                    gap: 0.25,
                  }}
                >
                  <Box
                    sx={{
                      px: 1.25,
                      py: 0.875,
                      borderRadius: 2.5,
                      fontSize: "0.9rem",
                      lineHeight: 1.5,
                      whiteSpace: "pre-wrap",
                      wordBreak: "break-word",
                      backgroundColor: m.role === "user" ? "var(--accent)" : "var(--bg-soft, #f3f6fb)",
                      color: m.role === "user" ? "#f8fbff" : "var(--text-primary)",
                      border: m.role === "user" ? "none" : "1px solid var(--border)",
                    }}
                  >
                    {m.content}
                  </Box>
                  {m.role === "assistant" ? (
                    <Box sx={{ display: "flex", justifyContent: "flex-start", pl: 0.5 }}>
                      <Button
                        size="small"
                        onClick={async () => {
                          try {
                            if (navigator.clipboard?.writeText) {
                              await navigator.clipboard.writeText(m.content || "");
                            } else {
                              const ta = document.createElement("textarea");
                              ta.value = m.content || "";
                              document.body.appendChild(ta);
                              ta.select();
                              document.execCommand("copy");
                              document.body.removeChild(ta);
                            }
                            setChatCopiedIndex(i);
                            setTimeout(() => {
                              setChatCopiedIndex((prev) => (prev === i ? null : prev));
                            }, 1500);
                          } catch {
                            /* noop */
                          }
                        }}
                        sx={{
                          minWidth: 0,
                          p: 0.25,
                          fontSize: 11,
                          textTransform: "none",
                          color: "var(--text-secondary)",
                          lineHeight: 1,
                        }}
                        title="Copy message"
                        aria-label="Copy message"
                      >
                        {chatCopiedIndex === i ? "✓ Copied" : "⧉ Copy"}
                      </Button>
                    </Box>
                  ) : null}
                  {m.role === "user" ? (
                    <Box sx={{ display: "flex", justifyContent: "flex-end", pr: 0.5 }}>
                      <Button
                        size="small"
                        disabled={chatSending}
                        onClick={() => resendUserMessage(i)}
                        sx={{
                          minWidth: 0,
                          p: 0.25,
                          fontSize: 11,
                          textTransform: "none",
                          color: "var(--text-secondary)",
                          lineHeight: 1,
                          display: "flex",
                          alignItems: "center",
                          gap: 0.5,
                        }}
                        title="Resend this message"
                        aria-label="Resend this message"
                      >
                        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                          <polyline points="23 4 23 10 17 10" />
                          <path d="M20.49 15a9 9 0 1 1-2.12-9.36L23 10" />
                        </svg>
                        Resend
                      </Button>
                    </Box>
                  ) : null}
                </Box>
              ))
            )}
            {chatSending ? (
              <Box
                sx={{
                  alignSelf: "flex-start",
                  fontSize: "0.85rem",
                  color: "var(--text-secondary)",
                  fontStyle: "italic",
                  px: 0.5,
                }}
              >
                Thinking…
              </Box>
            ) : null}
            {chatError ? (
              <Box sx={{ alignSelf: "flex-start", color: "var(--danger, #d32f2f)", fontSize: "0.85rem", px: 0.5 }}>
                {chatError}
              </Box>
            ) : null}
          </Box>

          <Box
            sx={{
              borderTop: "1px solid var(--border)",
              p: 1,
              display: "flex",
              flexDirection: "column",
              gap: 0.75,
              backgroundColor: "var(--bg-surface)",
            }}
          >
            {chatAttachedFiles.length > 0 ? (
              <Box sx={{ display: "flex", flexWrap: "wrap", gap: 0.5 }}>
                {chatAttachedFiles.map((f, i) => (
                  <Chip
                    key={`${f.name}-${i}`}
                    size="small"
                    label={f.name}
                    onDelete={() =>
                      setChatAttachedFiles((prev) => prev.filter((_, idx) => idx !== i))
                    }
                    sx={{ maxWidth: 220 }}
                  />
                ))}
              </Box>
            ) : null}
            {chatAttachError ? (
              <Box sx={{ fontSize: 12, color: "var(--danger, #d32f2f)" }}>
                {chatAttachError}
              </Box>
            ) : null}
            {chatDragActive ? (
              <Box sx={{ fontSize: 12, color: "var(--accent, #1976d2)", fontStyle: "italic" }}>
                Drop files to attach as context…
              </Box>
            ) : null}
            <Box sx={{ display: "flex", gap: 0.75, alignItems: "flex-end" }}>
              <Button
                component="label"
                size="small"
                variant="outlined"
                sx={{ textTransform: "none", minWidth: 0, px: 1, fontSize: 12 }}
                title="Attach files for context"
              >
                + File
                <input
                  type="file"
                  hidden
                  multiple
                  accept=".docx,.txt,.md,.csv,.json,.log,application/vnd.openxmlformats-officedocument.wordprocessingml.document,text/*"
                  onChange={(e) => {
                    addChatAttachments(e.target.files);
                    e.target.value = "";
                  }}
                />
              </Button>
              <TextField
                fullWidth
                size="small"
                multiline
                maxRows={4}
                placeholder="Message AI Help… (drop files anywhere here)"
                value={chatInput}
                inputRef={chatInputRef}
                onChange={(e) => setChatInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    sendChatMessage();
                  }
                }}
                disabled={chatSending}
              />
              <Button
                variant="contained"
                onClick={sendChatMessage}
                disabled={chatSending || !chatInput.trim()}
                sx={{ textTransform: "none", minWidth: 0, px: 2 }}
              >
                Send
              </Button>
            </Box>
          </Box>
        </Box>
      ) : null}

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
              const isSynthetic =
                typeof job.id === "string" &&
                (job.id.startsWith("url-") || job.id.startsWith("manual-"));
              const canRegenerateSynthetic =
                isSynthetic &&
                !!resumeFile &&
                !isTailoringChip &&
                ((job.id.startsWith("url-") && !!job.url) ||
                  (job.id.startsWith("manual-") && !!job.description));
              const canRegenerate = isSynthetic
                ? canRegenerateSynthetic
                : !!resumeFile && !!fullJob && !isTailoringChip;
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
                    {status === "done" && isDocxResume(resumeFile) ? (
                      <span
                        draggable
                        className={styles.toolbarChipBtn}
                        title="Drag tailored resume to upload"
                        style={{ cursor: "grab", display: "inline-flex", alignItems: "center" }}
                        onDragStart={async (e) => {
                          try {
                            const t = tailoringMap[job.id] || {};
                            const text = typeof t.result === "string" ? t.result : "";
                            const lines = Array.isArray(t.resultLines) ? t.resultLines : [];
                            if (!text) return;
                            const blob = await buildDocxFromUploadedTemplate(resumeFile, text, lines);
                            const fileName = getDownloadFileNameForTitle(
                              t.generatedJobTitle || job.title,
                              job.company,
                            );
                            const file = new File([blob], fileName, {
                              type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
                            });
                            e.dataTransfer.clearData();
                            e.dataTransfer.effectAllowed = "copy";
                            if (e.dataTransfer.items) {
                              e.dataTransfer.items.add(file);
                            }
                          } catch (err) {
                            console.warn("[chip drag] failed:", err);
                          }
                        }}
                      >
                        <DescriptionIcon fontSize="small" />
                      </span>
                    ) : null}
                    <button
                      type="button"
                      className={styles.toolbarChipBtn}
                      title="Ask AI about this job"
                      onClick={() => {
                        const jobForContext = fullJob || job;
                        const tailoredContent = tailoring?.result ? `\n\nTailored Resume:\n${tailoring.result}` : "";
                        askAiAbout({
                          label: `${job.title || "Job"}${job.company ? ` · ${job.company}` : ""}`,
                          content: `${buildJobContextString(jobForContext)}${tailoredContent}`,
                          prompt: `Help me with the ${job.title || "this"} role${job.company ? ` at ${job.company}` : ""}: `,
                          sourceJobId: job.id,
                        });
                      }}
                    >
                      AI
                    </button>
                    <button
                      type="button"
                      className={styles.toolbarChipBtn}
                      title="Go to card"
                      onClick={() => {
                        const isUrlJob =
                          typeof job.id === "string" && job.id.startsWith("url-");
                        const isManualJob =
                          typeof job.id === "string" && job.id.startsWith("manual-");
                        const targetSection = isUrlJob
                          ? "url"
                          : isManualJob
                            ? "manual"
                            : "search";
                        setMainTab("applying");
                        setActiveSection(targetSection);
                        if (targetSection === "search") {
                          setHighlightedJobId(job.id);
                          setTimeout(() => setHighlightedJobId(null), 3000);
                          setTimeout(() => {
                            const card = document.getElementById(`job-card-${job.id}`);
                            if (card) {
                              card.scrollIntoView({ behavior: "smooth", block: "center" });
                            }
                          }, 50);
                        }
                      }}
                    >
                      ↩
                    </button>
                    <a
                      href={job.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className={styles.toolbarChipBtn}
                      title="View posting (also downloads tailored resume)"
                      onClick={() => {
                        // Fire-and-forget download so the new tab still opens
                        // immediately. Re-downloads every time the chip link
                        // is clicked, even if already downloaded earlier.
                        downloadResumeForChipJob(job).then((err) => {
                          if (err) {
                            console.warn("[chip posting link] download skipped:", err);
                          }
                        });
                      }}
                    >
                      ↗
                    </a>
                    <button
                      type="button"
                      className={styles.toolbarChipBtn}
                      title={
                        canRegenerate
                          ? "Regenerate"
                          : !resumeFile
                            ? "Upload a resume first"
                            : "Regenerate"
                      }
                      disabled={!canRegenerate}
                      onClick={() => {
                        if (isSynthetic) {
                          handleRegenerateSyntheticJob(job);
                        } else if (fullJob) {
                          handleTailorJob(fullJob);
                        }
                      }}
                    >
                      ↺
                    </button>
                    <button
                      type="button"
                      className={styles.toolbarChipBtn}
                      title={isSynthetic ? "Not available for generated postings" : "Mark as applied"}
                      disabled={isSynthetic}
                      onClick={() => handleToggleApplied(job)}
                    >
                      ✓
                    </button>
                    <button
                      type="button"
                      className={styles.toolbarChipBtn}
                      title={isSynthetic ? "Not available for generated postings" : "Ignore"}
                      disabled={isSynthetic}
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
