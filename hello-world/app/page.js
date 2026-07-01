"use client";

import { useState, useEffect, useRef, useMemo } from "react";
import styles from "./page.module.css";
import JobDescriptionTab from "./components/JobDescriptionTab";
import PostingUrlTab from "./components/PostingUrlTab";
import ScreenshotTab from "./components/ScreenshotTab";
import ApplyingControls from "./components/ApplyingControls";
import NavTabs from "./components/NavTabs";
import TrackingTab from "./components/TrackingTab";
import LiveFeedTab from "./components/LiveFeedTab";
import LibraryEditor from "./components/LibraryEditor";
import ChatPanel from "./components/ChatPanel";
import StatusBar from "./components/StatusBar";
import BatchTailorDialog from "./components/BatchTailorDialog";
import DocumentPreviewDialog from "./components/DocumentPreviewDialog";
import CompanyResearchDialog from "./components/CompanyResearchDialog";
import SlotReviewDialog from "./components/SlotReviewDialog";
import {
  buildJobContextString,
  buildApplicationContextString as buildApplicationContextStringBase,
  buildStageContextString,
  createChatHandlers,
} from "../lib/chat/chatbot";
import {
  isDocxResume,
  isTextResume,
  buildTemplateLinesForUpload,
  buildDocxFromUploadedTemplate,
  getDownloadFileNameForTitle,
  createDocumentDownloaders,
  extractResumeTextLines,
  triggerBlobDownload,
  base64ToDocxBlob,
} from "../lib/document/docx";
import { parseDocxToModel, linesToModel } from "../lib/document/docxPreview";
import { weaveSources } from "../lib/document/coverLetterWeave";
import { parseEmploymentHistory } from "../lib/resume/parseEmployment";
import { useProfileEntries } from "./hooks/useProfileEntries";
import { useScreenshots } from "./hooks/useScreenshots";
import { useCompanyResearch } from "./hooks/useCompanyResearch";
import {
  REFERENCE_CONFIG,
  EDUCATION_CONFIG,
  EMPLOYMENT_CONFIG,
} from "../lib/materials/profileEntries";
import {
  listMaterials,
  uploadMaterial,
  downloadMaterialBlob,
  removeMaterial,
} from "../lib/supabase/materials";
import { openPostingBeside, openBlankBeside, navigateBeside } from "../lib/window/openPostingBeside";
import { useEngine } from "@/app/settings/engine";
import Box from "@mui/material/Box";
import Button from "@mui/material/Button";
import TextField from "@mui/material/TextField";
import FormControl from "@mui/material/FormControl";
import InputLabel from "@mui/material/InputLabel";
import MenuItem from "@mui/material/MenuItem";
import Fab from "@mui/material/Fab";
import Select from "@mui/material/Select";
import IconButton from "@mui/material/IconButton";
import Tooltip from "@mui/material/Tooltip";
import Autocomplete from "@mui/material/Autocomplete";
import Chip from "@mui/material/Chip";
import DescriptionIcon from "@mui/icons-material/Description";
import { GREENHOUSE_COMPANIES, COMPANY_CATEGORIES } from "../lib/greenhouse/companies";
import { createClient } from "../lib/supabase/client";
import { upsertPosition } from "../lib/supabase/upsertPosition";
import { upsertApplication, getPositionId } from "../lib/supabase/upsertApplication";
import { saveGeneratedResume } from "../lib/supabase/saveGeneratedResume";
import { getInterviewStages, upsertInterviewStage } from "../lib/supabase/upsertInterviewStage";
import { createRecruiterCommunication, listRecruiterCommunications } from "../lib/supabase/recruiterCommunications";
import {
  STAGE_TYPE_LABELS,
  createStageDialogState,
  normalizeInterviewValue,
} from "../lib/tracking/stages";

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
  // Preview/edit modal for a tracked posting's tailored resume + cover letter
  // (opened from the status-bar chips). `jobId` keys into tailoringMap for the
  // current text; `tab` is the document to open on ("resume" | "cover").
  const [resumePreview, setResumePreview] = useState({
    open: false,
    jobId: null,
    title: "",
    company: "",
    tab: "resume",
    // Posting source kept around so the preview can re-tailor (Gemini steering).
    posting: "",
    url: "",
    busy: false,
    notice: "",
    error: "",
  });
  // Bumped to force the open preview to reload after research is woven in.
  const [previewReloadKey, setPreviewReloadKey] = useState(0);
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
  // Manual (job-description) tailoring surface. Results flow through the shared
  // tailoringMap → StatusBar chip + preview dialog, so only submit status/error
  // live here.
  const [manualIsSubmitting, setManualIsSubmitting] = useState(false);
  const [manualError, setManualError] = useState("");
  // URL tailoring surface (same story as the manual surface above).
  const [urlPosting, setUrlPosting] = useState("");
  const [urlIsSubmitting, setUrlIsSubmitting] = useState(false);
  const [urlError, setUrlError] = useState("");
  const [activeSection, setActiveSection] = useState("url");
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
  const [hideAppliedJobs, setHideAppliedJobs] = useState(false);
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
  // Gmail messages, matched to applications for the Tracking tab's email
  // classification badges (loaded in the background).
  const [gmailMessages, setGmailMessages] = useState([]);
  const [highlightedAppId, setHighlightedAppId] = useState(null);
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
  // Document-generation engine ("gemini" | "external" | "embedded"). Owned by a
  // shared store so the top-bar picker and this tailoring logic stay in sync;
  // the store handles localStorage persistence under "tailorEngine".
  const { engine: tailorEngine } = useEngine();
  // External-engine "review fields" flow: fetched proposal slots the user can
  // edit before generating the document with those `values`.
  const [slotReview, setSlotReview] = useState({ open: false, loading: false, error: "", slots: [] });
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

  // Materials profile lists (references / education / employment). Each is a
  // self-contained controller: CRUD, per-row + all copy, localStorage
  // persistence, and docx export. See lib/materials/profileEntries.js.
  const referencesCtl = useProfileEntries(REFERENCE_CONFIG);
  const educationCtl = useProfileEntries(EDUCATION_CONFIG);
  const employmentCtl = useProfileEntries(EMPLOYMENT_CONFIG);
  // Status of the "import from résumé" action on the Employment History section.
  const [employmentImport, setEmploymentImport] = useState({ loading: false, error: "", message: "" });

  // Screenshots → tailored-documents pipeline (Manual Applying › Screenshots).
  const screenshots = useScreenshots({
    resumeFile,
    tailoringMap,
    openResumePreview,
    previewScopeAvailable,
    setTrackedJobs,
    handleTailorJob,
    updateTailoringJob,
  });

  // Per-job company research (warmed behind the preview; woven into the cover).
  const research = useCompanyResearch({ tailoringMap, setTailoringMap, setPreviewReloadKey });

  // Supplementary materials locker (transcripts etc.). Each item:
  // { name, size, source: "remote"|"local", file? }. Persisted to Supabase for
  // signed-in users; in-memory for the session otherwise. Download-only.
  const [materials, setMaterials] = useState([]);
  const [materialsBusy, setMaterialsBusy] = useState(false);
  const [materialsError, setMaterialsError] = useState("");
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
    if (saved === "url" || saved === "manual" || saved === "screenshots") {
      setActiveSection(saved);
    }
    const savedTab = localStorage.getItem("mainTab");
    if (
      savedTab === "applying" ||
      savedTab === "manualApplying" ||
      savedTab === "interviewing" ||
      savedTab === "feed" ||
      savedTab === "library"
    ) {
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
            referencesOpen: referencesCtl.open,
            educationOpen: educationCtl.open,
            employmentOpen: employmentCtl.open,
            appliedSort: interviewSort,
            hideAppliedJobs,
          },
        }),
      }).catch(() => {});
    }, 400);
    return () => clearTimeout(handle);
  }, [referencesCtl.open, educationCtl.open, employmentCtl.open, interviewSort, hideAppliedJobs, currentUser]);

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
            if (typeof prefs.referencesOpen === "boolean") referencesCtl.setOpen(prefs.referencesOpen);
            if (typeof prefs.educationOpen === "boolean") educationCtl.setOpen(prefs.educationOpen);
            if (typeof prefs.employmentOpen === "boolean") employmentCtl.setOpen(prefs.employmentOpen);
            if (typeof prefs.hideAppliedJobs === "boolean") setHideAppliedJobs(prefs.hideAppliedJobs);
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
    // Mount-only: sets up the auth subscription once. The profile controllers
    // used inside loadUserData change identity each render and must not re-run it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
      emailOnNewJobs: !!row.email_on_new_jobs,
      notifyEmail: row.notify_email || "",
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
      emailOnNewJobs: false,
      notifyEmail: "",
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
    // they're still fresh (less than 3 hours old), render them instantly
    // instead of round-tripping through runJobSearch (which would flash a
    // loading state and race the prewarmer).
    const APPLY_SAVED_MAX_AGE_MS = 3 * 60 * 60 * 1000;
    const cached = prewarmedResults[entry.id];
    const query = nextJobKeywords.join(" ").trim();
    if (
      query &&
      cached &&
      Array.isArray(cached.jobs) &&
      cached.jobs.length > 0 &&
      Date.now() - cached.fetchedAt < APPLY_SAVED_MAX_AGE_MS
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

  // Compare a saved-search entry's stored filter values against the current
  // control values. Used to show a "save" affordance on the active chip
  // whenever the user has tweaked something since applying it.
  const activeSavedSearchDirty = (() => {
    if (!activeSavedSearchId) return false;
    const entry = savedSearches.find((s) => s.id === activeSavedSearchId);
    if (!entry) return false;
    const norm = (a) =>
      JSON.stringify(
        [...(Array.isArray(a) ? a : [])]
          .map((v) => String(v).trim().toLowerCase())
          .filter(Boolean)
          .sort(),
      );
    const currentCompanies = selectedCompanies
      .map((c) => (typeof c === "string" ? c : c?.slug))
      .filter(Boolean);
    const currentExcludedCompanies = excludedCompanies.map((c) => c.slug);
    if (norm(jobKeywords) !== norm(entry.jobKeywords)) return true;
    if ((entry.maxYearsExp || "any") !== (maxYearsExp || "any")) return true;
    if (norm(selectedCategories) !== norm(entry.selectedCategories)) return true;
    if (norm(currentCompanies) !== norm(entry.selectedCompanies)) return true;
    if (norm(currentExcludedCompanies) !== norm(entry.excludedCompanies)) return true;
    if (norm(excludedTitleKeywords) !== norm(entry.excludedTitleKeywords)) return true;
    return false;
  })();

  // Overwrite a saved search with the current control values. Updates local
  // state immediately for snappy UX, then PUTs to the server for signed-in
  // users.
  async function updateSavedSearch(id) {
    if (!id) return;
    const payload = {
      jobKeywords: [...jobKeywords],
      maxYearsExp,
      selectedCategories: [...selectedCategories],
      selectedCompanies: selectedCompanies
        .map((c) => (typeof c === "string" ? c : c?.slug))
        .filter(Boolean),
      excludedCompanies: excludedCompanies.map((c) => c.slug),
      excludedTitleKeywords: [...excludedTitleKeywords],
    };
    setSavedSearches((prev) =>
      prev.map((s) => (s.id === id ? { ...s, ...payload } : s)),
    );
    // Drop any stale prewarmed results — they were fetched for the old query.
    setPrewarmedResults((prev) => {
      if (!prev[id]) return prev;
      const next = { ...prev };
      delete next[id];
      return next;
    });
    if (currentUser && typeof id === "string" && !id.startsWith("ss-")) {
      try {
        await fetch(`/api/saved-searches/${encodeURIComponent(id)}`, {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        });
      } catch {}
    }
  }

  // Toggle auto-tailor on/off for a saved search. Persists to the server when
  // the user is signed in; updates local state immediately for snappy UX.
  async function setSavedSearchAutoTailor(id, { autoTailorEnabled, autoTailorDailyCap, emailOnNewJobs, notifyEmail, persist = true } = {}) {
    setSavedSearches((prev) =>
      prev.map((s) => {
        if (s.id !== id) return s;
        const next = { ...s };
        if (typeof autoTailorEnabled === "boolean") next.autoTailorEnabled = autoTailorEnabled;
        if (Number.isFinite(autoTailorDailyCap)) {
          next.autoTailorDailyCap = Math.max(1, Math.min(100, autoTailorDailyCap));
        }
        if (typeof emailOnNewJobs === "boolean") next.emailOnNewJobs = emailOnNewJobs;
        if (typeof notifyEmail === "string") next.notifyEmail = notifyEmail;
        return next;
      }),
    );
    if (!persist) return;
    if (!currentUser || typeof id !== "string" || id.startsWith("ss-")) return;
    try {
      const body = {};
      if (typeof autoTailorEnabled === "boolean") body.autoTailorEnabled = autoTailorEnabled;
      if (Number.isFinite(autoTailorDailyCap)) body.autoTailorDailyCap = autoTailorDailyCap;
      if (typeof emailOnNewJobs === "boolean") body.emailOnNewJobs = emailOnNewJobs;
      if (typeof notifyEmail === "string") body.notifyEmail = notifyEmail;
      if (Object.keys(body).length === 0) return;
      await fetch(`/api/saved-searches/${encodeURIComponent(id)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
    } catch {}
  }

  // Auto-save: whenever an active saved search becomes dirty (the user tweaked
  // a control), persist the new control values back to that saved search after
  // a short debounce so reapplying the chip later restores the latest filters.
  useEffect(() => {
    if (!activeSavedSearchId || !activeSavedSearchDirty) return;
    const id = activeSavedSearchId;
    const handle = setTimeout(() => { updateSavedSearch(id); }, 600);
    return () => clearTimeout(handle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeSavedSearchId, activeSavedSearchDirty]);

  // Fetch Gmail messages from the server and match them to applications.
  // Used both by the icon click handler and by the periodic auto-refresh.
  async function loadGmailMessages() {
    try {
      const res = await fetch("/api/gmail/messages", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ maxResults: 200 }),
      });
      if (!res.ok) return;
      const data = await res.json();
      const { matchMessagesToApplications, classifyMessage } = await import("../lib/gmail/emailUtils");
      // threshold=5: requires at least a partial company name match (+10 max) or title overlap
      const matched = matchMessagesToApplications(data.messages || [], applicationData, 5)
        .map((item) => ({ ...item, classification: classifyMessage(item.message) }));
      setGmailMessages(matched);
    } catch {}
  }

  // Background refresh: fetch Gmail once after the user's applications load,
  // then every 30 minutes while the tab is open. Skipped when not signed in
  // or when there are no applications to filter against.
  useEffect(() => {
    if (!currentUser || applicationData.length === 0) return;
    loadGmailMessages();
    const id = setInterval(loadGmailMessages, 60 * 1000);
    return () => clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentUser, applicationData.length]);

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
          // Clamp to the current viewport so a position saved on a larger
          // screen can't strand the FAB off-screen on a small one.
          const maxRight = Math.max(8, window.innerWidth - 80);
          const maxBottom = Math.max(8, window.innerHeight - 48);
          setFabPos({
            right: Math.min(Math.max(8, parsed.right), maxRight),
            bottom: Math.min(Math.max(8, parsed.bottom), maxBottom),
          });
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
  // Keep the floating FAB inside the viewport when the window resizes (e.g.
  // rotating a phone or shrinking the window) so it never drifts off-screen.
  useEffect(() => {
    function clampFab() {
      setFabPos((prev) => {
        const maxRight = Math.max(8, window.innerWidth - 80);
        const maxBottom = Math.max(8, window.innerHeight - 48);
        const right = Math.min(Math.max(8, prev.right), maxRight);
        const bottom = Math.min(Math.max(8, prev.bottom), maxBottom);
        return right === prev.right && bottom === prev.bottom ? prev : { right, bottom };
      });
    }
    window.addEventListener("resize", clampFab);
    return () => window.removeEventListener("resize", clampFab);
  }, []);
  useEffect(() => {
    localStorage.setItem("chatSize", JSON.stringify(chatSize));
  }, [chatSize]);

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

  // Extract employment history from an uploaded résumé (.docx/.txt) using AI and
  // append the detected positions to the list (capped at 4). The file is parsed
  // to text on-device, then sent to /api/extract-employment (Gemini). If that
  // route is unavailable, we fall back to the on-device heuristic parser so the
  // feature still works. Existing non-empty entries are preserved; fields stay
  // editable so the user can fix any misses.
  async function importEmploymentFromResume(file) {
    if (!file) return;
    if (!isDocxResume(file) && !isTextResume(file)) {
      setEmploymentImport({ loading: false, error: "Upload a .docx or .txt résumé.", message: "" });
      return;
    }
    setEmploymentImport({ loading: true, error: "", message: "" });
    try {
      const lines = await extractResumeTextLines(file);
      const resumeText = lines.join("\n");

      let positions = [];
      let usedAi = false;
      try {
        const res = await fetch("/api/extract-employment", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ resumeText }),
        });
        if (res.ok) {
          const json = await res.json();
          if (Array.isArray(json?.positions)) {
            positions = json.positions;
            usedAi = true;
          }
        }
      } catch {
        // Network/route error — fall through to the offline parser.
      }
      if (!usedAi) {
        positions = parseEmploymentHistory(lines);
      }

      if (positions.length === 0) {
        setEmploymentImport({
          loading: false,
          error: "",
          message: "Couldn't detect any employment history. Add entries manually below.",
        });
        return;
      }
      const existing = employmentCtl.entries.filter(
        (e) => e.company || e.title || e.location || e.startDate || e.endDate || e.notes,
      );
      // Skip positions that already exist (by company + title) so re-uploading
      // the same résumé doesn't stack duplicate entries.
      const dedupeKey = (e) =>
        `${(e.company || "").trim().toLowerCase()}|${(e.title || "").trim().toLowerCase()}`;
      const existingKeys = new Set(existing.map(dedupeKey));
      const room = Math.max(0, 4 - existing.length);
      const additions = positions
        .filter((p) => !existingKeys.has(dedupeKey(p)))
        .slice(0, room)
        .map((entry) => ({
          id: `emp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          company: entry.company || "",
          title: entry.title || "",
          location: entry.location || "",
          startDate: entry.startDate || "",
          endDate: entry.endDate || "",
          notes: entry.notes || "",
        }));
      const added = additions.length;
      employmentCtl.setEntries([...existing, ...additions]);
      employmentCtl.setOpen(true);
      const suffix = usedAi ? "" : " (offline parser — AI unavailable)";
      const noRoomMessage =
        existing.length >= 4
          ? "Your 4 employment slots are already full."
          : "Those positions are already in your list.";
      setEmploymentImport({
        loading: false,
        error: "",
        message:
          added > 0
            ? `Imported ${added} position${added === 1 ? "" : "s"}${suffix}. Review and edit as needed.`
            : noRoomMessage,
      });
    } catch (err) {
      setEmploymentImport({
        loading: false,
        error: `Couldn't read that résumé: ${err?.message || "unknown error"}`,
        message: "",
      });
    }
  }

  // ── Supplementary materials locker ────────────────────────────────────────
  // Load the user's stored materials on sign-in.
  useEffect(() => {
    if (!currentUser) return undefined;
    let cancelled = false;
    (async () => {
      const supabase = createClient();
      const list = await listMaterials(supabase, currentUser.id);
      if (!cancelled) setMaterials(list.map((m) => ({ ...m, source: "remote" })));
    })();
    return () => { cancelled = true; };
  }, [currentUser]);

  async function uploadMaterials(fileList) {
    const files = Array.from(fileList || []);
    if (files.length === 0) return;
    setMaterialsError("");

    // Signed-out: keep files in memory for the session only.
    if (!currentUser) {
      const additions = files.map((file) => ({
        name: file.name,
        size: file.size,
        source: "local",
        file,
      }));
      setMaterials((prev) => [...prev, ...additions]);
      return;
    }

    setMaterialsBusy(true);
    const supabase = createClient();
    for (const file of files) {
      if (file.size > 25 * 1024 * 1024) {
        setMaterialsError(`${file.name} is too large (max 25 MB).`);
        continue;
      }
      const { error } = await uploadMaterial(supabase, currentUser.id, file);
      if (error) setMaterialsError(`${file.name}: ${error}`);
    }
    const list = await listMaterials(supabase, currentUser.id);
    setMaterials(list.map((m) => ({ ...m, source: "remote" })));
    setMaterialsBusy(false);
  }

  async function downloadMaterialFile(item) {
    if (!item) return;
    setMaterialsError("");
    if (item.source === "local" && item.file) {
      triggerBlobDownload(item.file, item.name);
      return;
    }
    if (!currentUser) return;
    const supabase = createClient();
    const { blob, error } = await downloadMaterialBlob(supabase, currentUser.id, item.name);
    if (error) {
      setMaterialsError(error);
      return;
    }
    triggerBlobDownload(blob, item.name);
  }

  async function removeMaterialFile(item) {
    if (!item) return;
    setMaterialsError("");
    if (item.source === "local") {
      setMaterials((prev) => prev.filter((m) => m !== item));
      return;
    }
    if (!currentUser) return;
    const supabase = createClient();
    const { error } = await removeMaterial(supabase, currentUser.id, item.name);
    if (error) {
      setMaterialsError(error);
      return;
    }
    setMaterials((prev) => prev.filter((m) => m.name !== item.name));
  }

  // Open the chat with a supplementary material attached as context. For remote
  // files we fetch the bytes from Storage first; the chat attachment pipeline
  // then text-extracts or inlines (image/PDF) the file.
  async function askAiAboutMaterial(item) {
    if (!item) return;
    setMaterialsError("");
    setChatOpen(true);
    try {
      let file = item.source === "local" && item.file ? item.file : null;
      if (!file && currentUser) {
        const supabase = createClient();
        const { blob, error } = await downloadMaterialBlob(supabase, currentUser.id, item.name);
        if (error || !blob) {
          setMaterialsError(error || "Could not load that file.");
          return;
        }
        file = new File([blob], item.name, { type: blob.type || undefined });
      }
      if (file) await addChatAttachments([file]);
    } catch (err) {
      setMaterialsError(err?.message || "Could not attach that file.");
    }
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
              color: copied ? "var(--success)" : "var(--text-secondary)",
              "&:hover": { color: "var(--accent)", bgcolor: "transparent" },
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
  }, [selectedCompanies]);

  // Re-run search (debounced) when the query text changes
  useEffect(() => {
    if (!hasFetchedRef.current || jobKeywords.length === 0) return;
    const joined = jobKeywords.join(" ").trim();
    if (!joined) return;
    // Respect a fresh prewarm cache (≤ 3 hours old) for the active saved
    // search — render those results directly instead of refetching, so the
    // Search Jobs button doesn't flip into a loading state when we're not
    // actually hitting the endpoint.
    const PREWARM_MAX_AGE_MS = 3 * 60 * 60 * 1000;
    const cached = activeSavedSearchId && !activeSavedSearchDirty
      ? prewarmedResults[activeSavedSearchId]
      : null;
    if (
      cached &&
      Array.isArray(cached.jobs) &&
      cached.jobs.length > 0 &&
      Date.now() - cached.fetchedAt < PREWARM_MAX_AGE_MS
    ) {
      activeQueryRef.current = joined;
      setJobResults(cached.jobs);
      return;
    }
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
          positions ( id, external_id, title, company, description, url, posted_at )
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
          .select("id, content, content_lines, docx_path")
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
    // autoTailorSeenVersion is bumped when the seen set changes, forcing recompute.
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

  // Chatbot handlers — implementations live in ./lib/chatbot.
  const buildApplicationContextString = (app) =>
    buildApplicationContextStringBase(app, applicationStages);
  const {
    addChatAttachments,
    askAiAbout,
    sendChatMessage,
    resendUserMessage,
    startChatResize,
  } = createChatHandlers({
    chatInput,
    chatMessages,
    chatSending,
    chatPinnedContext,
    chatAttachedFiles,
    chatSize,
    setChatInput,
    setChatMessages,
    setChatSending,
    setChatError,
    setChatOpen,
    setChatPinnedContext,
    setChatAttachedFiles,
    setChatAttachError,
    setChatSize,
    setChatResizing,
    chatInputRef,
    resumeFile,
    applicationData,
    applicationStages,
    mainTab,
    activeSection,
    isDocxResume,
    isTextResume,
    buildTemplateLinesForUpload,
  });

  // Document download handlers — implementations live in ../lib/document/docx.
  const {
    downloadDocxFiles,
    downloadAutoTailoredResume,
    downloadResumeForChipJob,
  } = createDocumentDownloaders({
    resumeFile,
    coverLetterFile,
    tailoringMap,
    applicationData,
  });

  // ── Resume preview/edit modal (opened from the status-bar chips) ──────────
  // Does the tailoring entry have content for a given scope?
  function previewScopeAvailable(entry, scope) {
    if (!entry) return false;
    if (scope === "cover") {
      return Array.isArray(entry.coverLetterResultLines) && entry.coverLetterResultLines.length > 0;
    }
    return typeof entry.result === "string" && entry.result.trim().length > 0;
  }
  function openResumePreview(job, opts = {}) {
    if (!job) return;
    const t = tailoringMap[job.id] || {};
    const wantsCover = opts.tab === "cover" && previewScopeAvailable(t, "cover");
    setResumePreview({
      open: true,
      jobId: job.id,
      title: t.generatedJobTitle || job.title || "",
      company: job.company || "",
      tab: wantsCover ? "cover" : "resume",
      posting: t.jobDescription || job.description || "",
      url: job.url || "",
      busy: false,
      notice: "",
      error: "",
    });
    // Warm company research as soon as the preview opens (only when a cover
    // letter exists — that's where the references are used).
    if (previewScopeAvailable(t, "cover")) {
      research.startBackgroundResearch({
        jobId: job.id,
        company: job.company || "",
        jobTitle: t.generatedJobTitle || job.title || "",
        posting: t.jobDescription || job.description || "",
      });
    }
  }
  function closeResumePreview() {
    setResumePreview((prev) => ({ ...prev, open: false }));
  }
  // The faithful .docx blob for a scope: serve the engine's finished doc when
  // unedited, otherwise rebuild from the (edited) text through the user's
  // template so formatting is preserved.
  async function buildPreviewBlob(scope) {
    const entry = tailoringMap[resumePreview.jobId] || {};
    if (scope === "cover") {
      const lines = Array.isArray(entry.coverLetterResultLines) ? entry.coverLetterResultLines : [];
      if (!entry.edited && typeof entry.coverLetterDocxB64 === "string" && entry.coverLetterDocxB64) {
        return base64ToDocxBlob(entry.coverLetterDocxB64);
      }
      if (isDocxResume(coverLetterFile)) {
        return buildDocxFromUploadedTemplate(coverLetterFile, lines.join("\n"), lines);
      }
      return null; // plain-text fallback handled by the loader
    }
    const lines = Array.isArray(entry.resultLines) ? entry.resultLines : [];
    if (!entry.edited && typeof entry.docxB64 === "string" && entry.docxB64) {
      return base64ToDocxBlob(entry.docxB64);
    }
    if (isDocxResume(resumeFile)) {
      return buildDocxFromUploadedTemplate(resumeFile, entry.result || "", lines);
    }
    return null;
  }
  // Parse the active document into a render model for the preview dialog. Falls
  // back to a plain-text model when there is no .docx template to mirror.
  async function loadPreviewModel(scope) {
    const entry = tailoringMap[resumePreview.jobId] || {};
    const blob = await buildPreviewBlob(scope);
    if (blob) return parseDocxToModel(await blob.arrayBuffer());
    const lines =
      scope === "cover"
        ? entry.coverLetterResultLines || []
        : entry.resultLines || String(entry.result || "").split("\n");
    return linesToModel(lines);
  }
  // The text + line payload currently stored for a scope (seed for the editor).
  function previewScopeText(entry, scope) {
    if (scope === "cover") {
      const lines = Array.isArray(entry?.coverLetterResultLines) ? entry.coverLetterResultLines : [];
      return lines.join("\n");
    }
    return entry?.result || "";
  }
  // Save edits back to the tailoring entry so this becomes the document the
  // posting's chip uses for download / drag this session.
  function saveDocumentPreview(scope, payload) {
    const jobId = resumePreview.jobId;
    if (!jobId) return;
    const text = typeof payload === "string" ? payload : payload?.text || "";
    const html = typeof payload === "object" ? payload?.html : undefined;
    const lines = text.split("\n");
    setTailoringMap((current) => {
      const entry = current[jobId] || {};
      const next =
        scope === "cover"
          ? { ...entry, coverLetterResultLines: lines, coverLetterPreviewHtml: html, edited: true }
          : { ...entry, result: text, resultLines: lines, resumePreviewHtml: html, edited: true };
      return { ...current, [jobId]: { ...next, status: entry.status || "done" } };
    });
    setResumePreview((prev) => ({
      ...prev,
      notice: `Saved — this is now the ${scope === "cover" ? "cover letter" : "resume"} for this posting.`,
      error: "",
    }));
  }
  async function downloadDocumentPreview(scope, payload) {
    const text = typeof payload === "string" ? payload : payload?.text || "";
    const lines = text.split("\n");
    setResumePreview((prev) => ({ ...prev, busy: true, error: "", notice: "" }));
    const entry = tailoringMap[resumePreview.jobId] || {};
    const unchanged = text === previewScopeText(entry, scope);
    const serveFinished = !entry.edited && unchanged;
    const args = {
      jobTitle: resumePreview.title,
      company: resumePreview.company,
      result: "",
      resultLines: [],
      coverLetterResultLines: [],
      docxB64: "",
      coverLetterDocxB64: "",
    };
    if (scope === "cover") {
      args.coverLetterResultLines = lines;
      if (serveFinished && typeof entry.coverLetterDocxB64 === "string") args.coverLetterDocxB64 = entry.coverLetterDocxB64;
    } else {
      args.result = text;
      args.resultLines = lines;
      if (serveFinished && typeof entry.docxB64 === "string") args.docxB64 = entry.docxB64;
    }
    const err = await downloadDocxFiles(args);
    setResumePreview((prev) => ({ ...prev, busy: false, error: err || "" }));
  }

  // Re-run the Gemini tailor for the previewed document using the free-text
  // steering instructions the user typed in the preview. Updates only the
  // active scope (resume or cover letter), drops any cached/edited preview HTML
  // so the fresh draft renders, and refreshes the open preview. Returns true on
  // success so the dialog can clear its input. Gemini-only by design — the
  // offline engines don't read steering instructions.
  async function resubmitDocumentPreview(scope, instructions) {
    const jobId = resumePreview.jobId;
    const text = String(instructions || "").trim();
    if (!jobId || !text) return false;
    if (!resumeFile) {
      setResumePreview((prev) => ({ ...prev, error: "Upload a resume first to revise it.", notice: "" }));
      return false;
    }
    const entry = tailoringMap[jobId] || {};
    const posting = (resumePreview.posting || entry.jobDescription || "").trim();
    const url = (resumePreview.url || "").trim();
    if (!posting && !url) {
      setResumePreview((prev) => ({ ...prev, error: "Couldn't find the job posting to revise against.", notice: "" }));
      return false;
    }
    const applyCover = scope === "cover";

    setResumePreview((prev) => ({ ...prev, busy: true, notice: "", error: "" }));
    try {
      const formData = new FormData();
      if (posting) formData.append("jobPosting", posting);
      else formData.append("jobPostingUrl", url);
      formData.append("additionalContext", additionalContext);
      formData.append("aggressiveness", String(aggressiveness));
      formData.append("engine", "gemini");
      formData.append("steeringInstructions", text);
      const templateLines = await buildTemplateLinesForUpload(resumeFile);
      formData.append("templateLines", JSON.stringify(templateLines));
      contextFiles.forEach((file) => formData.append("contextFiles", file));
      formData.append("resume", resumeFile);
      // Only regenerate the cover letter when that's the document being revised.
      if (applyCover && coverLetterFile) {
        const coverLetterTemplateLines = await buildTemplateLinesForUpload(coverLetterFile);
        formData.append("coverLetterTemplateLines", JSON.stringify(coverLetterTemplateLines));
        formData.append("coverLetter", coverLetterFile);
      }

      const response = await fetch("/api/tailor", { method: "POST", body: formData });
      const payload = await response.json();
      if (!response.ok) throw new Error(payload.error || "Failed to revise the document.");

      if (applyCover) {
        const lines = Array.isArray(payload.coverLetterResultLines) ? payload.coverLetterResultLines : [];
        const coverErr = typeof payload.coverLetterError === "string" ? payload.coverLetterError : "";
        if (coverErr) throw new Error(coverErr);
        if (lines.length === 0) throw new Error("Gemini returned an empty cover letter.");
        updateTailoringJob(jobId, {
          coverLetterResultLines: lines,
          coverLetterDocxB64: typeof payload.coverLetterDocxB64 === "string" ? payload.coverLetterDocxB64 : "",
          coverLetterPreviewHtml: undefined,
          edited: false,
          status: "done",
        });
      } else {
        const result = payload.result?.trim() || "";
        const lines = Array.isArray(payload.resultLines) ? payload.resultLines : [];
        if (!result) throw new Error("Gemini returned an empty resume.");
        const nextTitle = typeof payload.jobTitle === "string" ? payload.jobTitle.trim() : "";
        updateTailoringJob(jobId, {
          result,
          resultLines: lines,
          docxB64: typeof payload.docxB64 === "string" ? payload.docxB64 : "",
          resumePreviewHtml: undefined,
          ...(nextTitle ? { generatedJobTitle: nextTitle } : {}),
          edited: false,
          status: "done",
        });
      }

      setPreviewReloadKey((k) => k + 1);
      setResumePreview((prev) => ({
        ...prev,
        busy: false,
        error: "",
        notice: `Revised the ${applyCover ? "cover letter" : "resume"} with your instructions.`,
      }));
      return true;
    } catch (err) {
      setResumePreview((prev) => ({ ...prev, busy: false, error: err?.message || "Couldn't revise the document.", notice: "" }));
      return false;
    }
  }

  // Called by the Generate flows once the resume + cover letter exist: open the
  // preview modal (cover tab when there's a cover letter) and warm company
  // research in the background so it's ready behind the "Research company" button.
  // The user reviews and downloads from the preview.
  function finishByOpeningPreview(ctx) {
    const { jobId, jobTitle, company, posting, url, applyCover, coverLetterResultLines } = ctx;
    const hasCover =
      applyCover && Array.isArray(coverLetterResultLines) && coverLetterResultLines.length > 0;
    setResumePreview({
      open: true,
      jobId,
      title: jobTitle || "",
      company: company || "",
      tab: hasCover ? "cover" : "resume",
      posting: posting || "",
      url: url || "",
      busy: false,
      notice: "",
      error: "",
    });
    if (hasCover) research.startBackgroundResearch({ jobId, company, jobTitle, posting });
  }


  // "Apply" action for an auto-tailored row: download the tailored resume,
  // open the posting in a new tab, and bump the application status from
  // auto_tailored → applied so it moves out of the Auto Tailor tab and into
  // the Interviewing tab.
  async function applyAutoTailoredRow(row) {
    const url = row?.positions?.url;
    // Open a positioned blank popup synchronously, before the awaited download,
    // so Chrome grants popup-window placement (it downgrades to a tab if
    // window.open runs after an await). We navigate it once the download is done.
    const presetPopup =
      url && typeof window !== "undefined" ? openBlankBeside() : null;
    const dlError = await downloadAutoTailoredResume(row);
    if (dlError) {
      setAutoTailoredError(dlError);
      if (presetPopup && !presetPopup.closed) presetPopup.close();
      return;
    }
    setAutoTailoredError(null);
    if (url && typeof window !== "undefined") {
      const navigated = navigateBeside(presetPopup, url);
      if (!navigated) {
        const opened = openPostingBeside(url);
        if (!opened) window.open(url, "_blank", "noopener,noreferrer");
      }
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
    // If the current form matches an active saved search and the pre-warmer
    // already has results that are less than 3 hours old, render those
    // directly instead of hitting the Greenhouse API again — the live fetch
    // tends to race the prewarmer and clobber its results.
    const PREWARM_SEARCH_MAX_AGE_MS = 3 * 60 * 60 * 1000;
    const cached = activeSavedSearchId && !activeSavedSearchDirty
      ? prewarmedResults[activeSavedSearchId]
      : null;
    if (
      cached &&
      Array.isArray(cached.jobs) &&
      cached.jobs.length > 0 &&
      Date.now() - cached.fetchedAt < PREWARM_SEARCH_MAX_AGE_MS
    ) {
      const query = jobKeywords.join(" ").trim();
      setIsSearching(false);
      setJobSearchError("");
      setJobResults(cached.jobs);
      setTailoringMap((current) => {
        const trackedIds = new Set(trackedJobs.map((j) => j.id));
        const next = {};
        for (const [jobId, entry] of Object.entries(current || {})) {
          if (trackedIds.has(jobId)) next[jobId] = entry;
        }
        return next;
      });
      hasFetchedRef.current = true;
      activeQueryRef.current = query;
      return;
    }
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

  function handleRegenerateSyntheticJob(job, scope = "both") {
    if (!job?.id) return;
    if (typeof job.id === "string" && job.id.startsWith("url-") && job.url) {
      handleUrlSubmit(null, { overrideUrl: job.url, syntheticJobId: job.id, scope });
      return;
    }
    if (typeof job.id === "string" && job.id.startsWith("manual-") && job.description) {
      handleManualSubmit(null, { overridePosting: job.description, syntheticJobId: job.id, scope });
    }
  }

  // Regenerate from a status-bar chip, scoped to the résumé, cover letter, or
  // both. Dispatches to the synthetic (url/manual) or search handler.
  function onRegenerateChipJob(job, scope = "both") {
    if (!job?.id) return;
    const isSynthetic =
      typeof job.id === "string" && (job.id.startsWith("url-") || job.id.startsWith("manual-"));
    if (isSynthetic) {
      handleRegenerateSyntheticJob(job, scope);
    } else {
      handleTailorJob(job, { scope });
    }
  }

  async function handleTailorJob(job, opts = {}) {
    const { skipDownload = false, scope = "both" } = opts;
    const applyResume = scope !== "cover";
    const applyCover = scope !== "resume";
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
      formData.append("engine", tailorEngine);
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
      const engineUsed = typeof payload.engine === "string" ? payload.engine : "";
      const docxB64 = typeof payload.docxB64 === "string" ? payload.docxB64 : "";
      const coverLetterDocxB64 = typeof payload.coverLetterDocxB64 === "string" ? payload.coverLetterDocxB64 : "";

      updateTailoringJob(job.id, {
        status: "done",
        generatedJobTitle,
        engine: engineUsed,
        edited: false,
        error: coverLetterError || "",
        ...(applyResume ? { result, resultLines, docxB64 } : {}),
        ...(applyCover ? { coverLetterResultLines, coverLetterDocxB64 } : {}),
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
        const generatedResumeId = applyResume
          ? await saveGeneratedResume(supabase, {
              userId: currentUser.id,
              positionId,
              content: result,
              contentLines: resultLines,
              sourceResumePath: `${currentUser.id}/resume`,
              additionalContext: additionalContext || null,
              docxB64,
            })
          : null;
        if (applyResume && !generatedResumeId) {
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
        return { ok: true };
      }

      const dlError = await downloadDocxFiles({
        jobTitle: generatedJobTitle || job.title,
        company: job.company,
        result: applyResume ? result : "",
        resultLines: applyResume ? resultLines : [],
        coverLetterResultLines: applyCover ? coverLetterResultLines : [],
        docxB64: applyResume ? docxB64 : "",
        coverLetterDocxB64: applyCover ? coverLetterDocxB64 : "",
      });

      if (dlError) {
        updateTailoringJob(job.id, { error: dlError });
        return { ok: false, error: dlError };
      }
      updateTailoringJob(job.id, { downloaded: true });
      return { ok: true };
    } catch (err) {
      const message = err.message || "Unexpected error.";
      updateTailoringJob(job.id, { status: "error", error: message });
      return { ok: false, error: message };
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
      }
    }
  }

  async function handleUrlSubmit(event, opts = {}) {
    if (event && typeof event.preventDefault === "function") event.preventDefault();

    const scope = opts.scope || "both";
    const applyResume = scope !== "cover";
    const applyCover = scope !== "resume";
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
      formData.append("engine", tailorEngine);
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
      const nextEngine = typeof payload.engine === "string" ? payload.engine : "";
      const nextDocxB64 = typeof payload.docxB64 === "string" ? payload.docxB64 : "";
      const nextCoverLetterDocxB64 = typeof payload.coverLetterDocxB64 === "string" ? payload.coverLetterDocxB64 : "";

      if (nextCoverLetterError) setUrlError(nextCoverLetterError);

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
      updateTailoringJob(syntheticJobId, {
        status: "done",
        generatedJobTitle: nextJobTitle,
        engine: nextEngine,
        edited: false,
        ...(applyResume ? { result: nextResult, resultLines: nextResultLines, docxB64: nextDocxB64 } : {}),
        ...(applyCover ? { coverLetterResultLines: nextCoverLetterResultLines, coverLetterDocxB64: nextCoverLetterDocxB64 } : {}),
      });

      // Persist the generated resume and link to an application
      if (currentUser) {
        const supabase = createClient();
        const positionId = await upsertPosition(supabase, syntheticJob);
        const generatedResumeId = applyResume
          ? await saveGeneratedResume(supabase, {
              userId: currentUser.id,
              positionId,
              content: nextResult,
              contentLines: nextResultLines,
              sourceResumePath: `${currentUser.id}/resume`,
              additionalContext: additionalContext || null,
              docxB64: nextDocxB64,
            })
          : null;
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

      finishByOpeningPreview({
        jobId: syntheticJobId,
        jobTitle: nextJobTitle,
        company: nextCompany,
        posting: nextJobDescription || "",
        url: trimmedUrl,
        applyResume,
        applyCover,
        coverLetterResultLines: nextCoverLetterResultLines,
      });
    } catch (err) {
      setUrlError(err.message || "Unexpected error.");
      updateTailoringJob(syntheticJobId, { status: "error" });
    } finally {
      setUrlIsSubmitting(false);
    }
  }

  // Fetch the external engine's proposed slots for the current posting so the
  // user can review/override them before generating (review-then-generate).
  async function openSlotReview(postingText) {
    const posting = String(postingText || "").trim();
    if (!posting) {
      setManualError("Please provide a job posting first.");
      return;
    }
    setSlotReview({ open: true, loading: true, error: "", slots: [] });
    try {
      const res = await fetch("/api/tailor/proposals", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ posting, engine: tailorEngine, aggressiveness }),
      });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) {
        setSlotReview((prev) => ({ ...prev, loading: false, error: json?.error || "Could not load fields." }));
        return;
      }
      setSlotReview((prev) => ({
        ...prev,
        loading: false,
        slots: Array.isArray(json?.slots) ? json.slots : [],
      }));
    } catch (err) {
      setSlotReview((prev) => ({ ...prev, loading: false, error: err?.message || "Could not load fields." }));
    }
  }

  function closeSlotReview() {
    setSlotReview((prev) => ({ ...prev, open: false }));
  }

  // Generate the document with the reviewed slot values via the manual pipeline.
  function generateWithReviewedValues(values) {
    setSlotReview((prev) => ({ ...prev, open: false }));
    handleManualSubmit(null, { values });
  }

  async function handleManualSubmit(event, opts = {}) {
    if (event && typeof event.preventDefault === "function") event.preventDefault();

    const scope = opts.scope || "both";
    const applyResume = scope !== "cover";
    const applyCover = scope !== "resume";
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
      formData.append("engine", tailorEngine);
      if (opts.values && typeof opts.values === "object") {
        formData.append("values", JSON.stringify(opts.values));
      }
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
      const nextCompany = typeof payload.company === "string" ? payload.company.trim() : "";
      const nextCoverLetterResultLines = Array.isArray(payload.coverLetterResultLines) ? payload.coverLetterResultLines : [];
      const nextCoverLetterError = typeof payload.coverLetterError === "string" ? payload.coverLetterError : "";
      const nextEngine = typeof payload.engine === "string" ? payload.engine : "";
      const nextDocxB64 = typeof payload.docxB64 === "string" ? payload.docxB64 : "";
      const nextCoverLetterDocxB64 = typeof payload.coverLetterDocxB64 === "string" ? payload.coverLetterDocxB64 : "";

      if (nextCoverLetterError) setManualError(nextCoverLetterError);

      // Update the synthesized tracked job's title/company now that we have them.
      const syntheticJob = {
        id: syntheticJobId,
        title: nextJobTitle || "Untitled role",
        company: nextCompany,
        url: "",
        description: sourcePosting,
      };
      setTrackedJobs((prev) =>
        prev.map((j) =>
          j.id === syntheticJobId
            ? { ...j, title: syntheticJob.title, company: syntheticJob.company || j.company }
            : j,
        ),
      );
      updateTailoringJob(syntheticJobId, {
        status: "done",
        generatedJobTitle: nextJobTitle,
        engine: nextEngine,
        edited: false,
        ...(applyResume ? { result: nextResult, resultLines: nextResultLines, docxB64: nextDocxB64 } : {}),
        ...(applyCover ? { coverLetterResultLines: nextCoverLetterResultLines, coverLetterDocxB64: nextCoverLetterDocxB64 } : {}),
      });

      // Persist the generated resume and link to an application
      if (currentUser) {
        const supabase = createClient();
        const positionId = await upsertPosition(supabase, syntheticJob);
        const generatedResumeId = applyResume
          ? await saveGeneratedResume(supabase, {
              userId: currentUser.id,
              positionId,
              content: nextResult,
              contentLines: nextResultLines,
              sourceResumePath: `${currentUser.id}/resume`,
              additionalContext: additionalContext || null,
              docxB64: nextDocxB64,
            })
          : null;
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

      finishByOpeningPreview({
        jobId: syntheticJobId,
        jobTitle: nextJobTitle,
        company: nextCompany,
        posting: sourcePosting || "",
        applyResume,
        applyCover,
        coverLetterResultLines: nextCoverLetterResultLines,
      });
    } catch (err) {
      setManualError(err.message || "Unexpected error.");
      updateTailoringJob(syntheticJobId, { status: "error" });
    } finally {
      setManualIsSubmitting(false);
    }
  }

  // Tailor a résumé + cover letter for a Live Feed posting. Mirrors
  // handleUrlSubmit/handleManualSubmit so the shared StatusBar chip and the
  // tailoring pipeline behave identically. Prefers the posting URL; falls back
  // to the posting description text when no URL is available. Returns an error
  // message string on failure (or null on success) so the caller can surface it.
  async function handleTailorFeedPosting(posting) {
    if (!posting) return "Missing posting.";
    if (!resumeFile) return "Please upload a resume file first.";

    const postingUrl = (posting.url || "").trim();
    const postingText = (posting.description || posting.description_snippet || "").trim();
    if (!postingUrl && !postingText) {
      return "This posting has no URL or description to tailor against.";
    }

    const syntheticJobId = `feed-${posting.id}`;
    setTrackedJobs((prev) =>
      prev.some((j) => j.id === syntheticJobId)
        ? prev
        : [
            ...prev,
            {
              id: syntheticJobId,
              title: posting.title || "Tailoring posting…",
              company: posting.company || "",
              url: postingUrl,
              description: postingText,
            },
          ],
    );
    updateTailoringJob(syntheticJobId, { status: "tailoring" });

    try {
      const formData = new FormData();
      if (postingUrl) formData.append("jobPostingUrl", postingUrl);
      else formData.append("jobPosting", postingText);
      formData.append("additionalContext", additionalContext);
      formData.append("aggressiveness", String(aggressiveness));
      formData.append("engine", tailorEngine);
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
      const nextEngine = typeof payload.engine === "string" ? payload.engine : "";
      const nextDocxB64 = typeof payload.docxB64 === "string" ? payload.docxB64 : "";
      const nextCoverLetterDocxB64 = typeof payload.coverLetterDocxB64 === "string" ? payload.coverLetterDocxB64 : "";

      const syntheticJob = {
        id: syntheticJobId,
        title: nextJobTitle || posting.title || "Untitled role",
        company: nextCompany || posting.company || "",
        url: postingUrl,
        description: nextJobDescription || postingText,
      };
      setTrackedJobs((prev) =>
        prev.map((j) =>
          j.id === syntheticJobId
            ? { ...j, title: syntheticJob.title, company: syntheticJob.company || j.company }
            : j,
        ),
      );
      updateTailoringJob(syntheticJobId, {
        status: "done",
        result: nextResult,
        resultLines: nextResultLines,
        generatedJobTitle: nextJobTitle,
        coverLetterResultLines: nextCoverLetterResultLines,
        engine: nextEngine,
        docxB64: nextDocxB64,
        coverLetterDocxB64: nextCoverLetterDocxB64,
        edited: false,
      });

      // Persist the generated resume and link to an application.
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
          docxB64: nextDocxB64,
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
        jobTitle: nextJobTitle || posting.title,
        company: nextCompany || posting.company,
        result: nextResult,
        resultLines: nextResultLines,
        coverLetterResultLines: nextCoverLetterResultLines,
        docxB64: nextDocxB64,
        coverLetterDocxB64: nextCoverLetterDocxB64,
      });

      return dlError || null;
    } catch (err) {
      updateTailoringJob(syntheticJobId, { status: "error" });
      return err.message || "Unexpected error.";
    }
  }

  return (
    <div className={styles.page}>
      <main className={styles.main}>
        <Box
          sx={{
            display: "flex",
            flexDirection: { xs: "column", sm: "row" },
            alignItems: { xs: "stretch", sm: "flex-start" },
            justifyContent: "space-between",
            gap: { xs: 1.5, sm: 2 },
          }}
        >
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <h1 className={styles.title}>Resume Tailor</h1>
            <p className={styles.subtitle}>
              Upload a resume, search for remote jobs, and let Gemini tailor your
              resume to each posting.
            </p>
          </Box>
        </Box>

        <NavTabs
          size="main"
          value={mainTab}
          onChange={setMainTab}
          tabs={[
            { value: "applying", label: "Materials" },
            { value: "manualApplying", label: "Manual Applying" },
            { value: "feed", label: "Auto Applying" },
            { value: "interviewing", label: "Tracking" },
            { value: "library", label: "Library" },
          ]}
        />

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
          references={referencesCtl}
          education={educationCtl}
          employment={employmentCtl}
          importEmploymentFromResume={importEmploymentFromResume}
          employmentImport={employmentImport}
          materials={materials}
          materialsBusy={materialsBusy}
          materialsError={materialsError}
          uploadMaterials={uploadMaterials}
          downloadMaterialFile={downloadMaterialFile}
          removeMaterialFile={removeMaterialFile}
          askAiAboutMaterial={askAiAboutMaterial}
          currentUserPresent={!!currentUser}
          renderCopyButton={renderCopyButton}
        />

          </>
        )}

        {mainTab === "manualApplying" && (
          <>
        <NavTabs
          size="section"
          value={activeSection}
          onChange={setActiveSection}
          tabs={[
            { value: "url", label: "Posting URL" },
            { value: "manual", label: "Job Description" },
            { value: "screenshots", label: "Screenshots" },
          ]}
        />

        {activeSection === "manual" ? (
          <JobDescriptionTab
            jobPosting={jobPosting}
            setJobPosting={setJobPosting}
            manualIsSubmitting={manualIsSubmitting}
            manualError={manualError}
            handleManualSubmit={handleManualSubmit}
            askAiAbout={askAiAbout}
            tailorEngine={tailorEngine}
            onReviewFields={() => openSlotReview(jobPosting)}
          />
        ) : activeSection === "screenshots" ? (
          <ScreenshotTab
            items={screenshots.items}
            onAddFiles={screenshots.addFiles}
            onRemoveItem={screenshots.removeItem}
            onClear={screenshots.clear}
            onRetry={screenshots.retry}
            onPreview={screenshots.previewItem}
            processing={screenshots.processing}
            resumeReady={!!resumeFile}
            error={screenshots.error}
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
          <TrackingTab
            currentUser={currentUser}
            applicationLoading={applicationLoading}
            applicationError={applicationError}
            applicationData={applicationData}
            visibleApplicationData={visibleApplicationData}
            applicationStages={applicationStages}
            interviewSearch={interviewSearch}
            setInterviewSearch={setInterviewSearch}
            interviewSort={interviewSort}
            companyColWidth={companyColWidth}
            roleColWidth={roleColWidth}
            resumeFile={resumeFile}
            openAddApplicationDialog={openAddApplicationDialog}
            toggleInterviewSort={toggleInterviewSort}
            sortLabelSx={sortLabelSx}
            startColResize={startColResize}
            askAiAbout={askAiAbout}
            buildApplicationContextString={buildApplicationContextString}
            buildStageContextString={buildStageContextString}
            openCommsInAppDialog={openCommsInAppDialog}
            openAddCommunicationDialog={openAddCommunicationDialog}
            openEditApplicationDialog={openEditApplicationDialog}
            handleDeleteApplication={handleDeleteApplication}
            setAppDialog={setAppDialog}
            setStageError={setStageError}
            setStageDialog={setStageDialog}
            isDocxResume={isDocxResume}
            downloadDocxFiles={downloadDocxFiles}
            buildDocxFromUploadedTemplate={buildDocxFromUploadedTemplate}
            getDownloadFileNameForTitle={getDownloadFileNameForTitle}
            stageDialog={stageDialog}
            stageError={stageError}
            stageSaving={stageSaving}
            handleSaveStage={handleSaveStage}
            communicationsDialog={communicationsDialog}
            setCommunicationsDialog={setCommunicationsDialog}
            addCommunicationDialog={addCommunicationDialog}
            setAddCommunicationDialog={setAddCommunicationDialog}
            communicationError={communicationError}
            setCommunicationError={setCommunicationError}
            communicationSaving={communicationSaving}
            handleSaveCommunication={handleSaveCommunication}
            editAppDialog={editAppDialog}
            setEditAppDialog={setEditAppDialog}
            editAppSaving={editAppSaving}
            editAppError={editAppError}
            editAppResumeFile={editAppResumeFile}
            setEditAppResumeFile={setEditAppResumeFile}
            handleSaveEditApplication={handleSaveEditApplication}
            addAppDialog={addAppDialog}
            setAddAppDialog={setAddAppDialog}
            addAppSaving={addAppSaving}
            addAppError={addAppError}
            addAppResumeFile={addAppResumeFile}
            setAddAppResumeFile={setAddAppResumeFile}
            handleSaveAddApplication={handleSaveAddApplication}
            appDialog={appDialog}
            loadCommunicationsForApp={loadCommunicationsForApp}
            highlightedAppId={highlightedAppId}
            emailClassificationsByAppId={Object.fromEntries(
              Object.entries(
                gmailMessages.reduce((acc, { application, classification }) => {
                  if (!application?.id || !classification) return acc;
                  const priority = { rejection: 3, interview: 2, confirmation: 1 };
                  const existing = acc[application.id];
                  if (!existing || priority[classification] > priority[existing]) {
                    acc[application.id] = classification;
                  }
                  return acc;
                }, {})
              )
            )}
          />
        )}

        {mainTab === "feed" && (
          <LiveFeedTab
            currentUser={currentUser}
            savedSearches={savedSearches}
            setSavedSearches={setSavedSearches}
            setSavedSearchAutoTailor={setSavedSearchAutoTailor}
            deleteSavedSearch={deleteSavedSearch}
            GREENHOUSE_COMPANIES={GREENHOUSE_COMPANIES}
            COMPANY_CATEGORIES={COMPANY_CATEGORIES}
            onTailor={handleTailorFeedPosting}
            canTailor={!!resumeFile}
          />
        )}

        {mainTab === "library" && <LibraryEditor />}

        {/* Always-mounted dialogs (not gated by active main tab). */}
        <BatchTailorDialog
          batchTailorDialog={batchTailorDialog}
          setBatchTailorDialog={setBatchTailorDialog}
          batchTailorState={batchTailorState}
          startBatchTailor={startBatchTailor}
        />
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
        <ChatPanel
          chatPanelRef={chatPanelRef}
          chatScrollRef={chatScrollRef}
          chatInputRef={chatInputRef}
          chatDragActive={chatDragActive}
          setChatDragActive={setChatDragActive}
          addChatAttachments={addChatAttachments}
          fabPos={fabPos}
          chatSize={chatSize}
          startChatResize={startChatResize}
          chatMessages={chatMessages}
          setChatMessages={setChatMessages}
          chatError={chatError}
          setChatError={setChatError}
          chatPinnedContext={chatPinnedContext}
          setChatPinnedContext={setChatPinnedContext}
          chatSending={chatSending}
          chatCopiedIndex={chatCopiedIndex}
          setChatCopiedIndex={setChatCopiedIndex}
          resendUserMessage={resendUserMessage}
          chatAttachedFiles={chatAttachedFiles}
          setChatAttachedFiles={setChatAttachedFiles}
          chatAttachError={chatAttachError}
          chatInput={chatInput}
          setChatInput={setChatInput}
          sendChatMessage={sendChatMessage}
        />
      ) : null}

      <StatusBar
        trackedJobs={trackedJobs}
        setTrackedJobs={setTrackedJobs}
        tailoringMap={tailoringMap}
        jobResults={jobResults}
        resumeFile={resumeFile}
        toolbarScrollRef={toolbarScrollRef}
        toolbarCanScrollLeft={toolbarCanScrollLeft}
        toolbarCanScrollRight={toolbarCanScrollRight}
        handleToolbarWheel={handleToolbarWheel}
        handleToolbarScroll={handleToolbarScroll}
        scrollToolbar={scrollToolbar}
        isDocxResume={isDocxResume}
        buildDocxFromUploadedTemplate={buildDocxFromUploadedTemplate}
        getDownloadFileNameForTitle={getDownloadFileNameForTitle}
        askAiAbout={askAiAbout}
        buildJobContextString={buildJobContextString}
        setMainTab={setMainTab}
        setActiveSection={setActiveSection}
        setHighlightedJobId={setHighlightedJobId}
        downloadResumeForChipJob={downloadResumeForChipJob}
        onRegenerate={onRegenerateChipJob}
        handleToggleApplied={handleToggleApplied}
        handleIgnoreJob={handleIgnoreJob}
        handleUntrackJob={handleUntrackJob}
        openResumePreview={openResumePreview}
        openCompanyResearch={research.openCompanyResearch}
      />

      <DocumentPreviewDialog
        open={resumePreview.open}
        jobTitle={resumePreview.title}
        company={resumePreview.company}
        initialTab={resumePreview.tab}
        scopes={{
          resume: {
            available: previewScopeAvailable(tailoringMap[resumePreview.jobId], "resume"),
            text: tailoringMap[resumePreview.jobId]?.result || "",
            html: tailoringMap[resumePreview.jobId]?.resumePreviewHtml,
          },
          cover: {
            available: previewScopeAvailable(tailoringMap[resumePreview.jobId], "cover"),
            text: (tailoringMap[resumePreview.jobId]?.coverLetterResultLines || []).join("\n"),
            html: tailoringMap[resumePreview.jobId]?.coverLetterPreviewHtml,
          },
        }}
        engine={tailorEngine}
        loadModel={loadPreviewModel}
        reloadKey={previewReloadKey}
        onClose={closeResumePreview}
        onSave={saveDocumentPreview}
        onResubmit={resubmitDocumentPreview}
        onDownload={downloadDocumentPreview}
        onResearchCompany={() =>
          research.openCompanyResearch({
            id: resumePreview.jobId,
            title: resumePreview.title,
            company: resumePreview.company,
            description: tailoringMap[resumePreview.jobId]?.jobDescription || "",
          })
        }
        researchLoading={!!research.researchByJob[resumePreview.jobId]?.loading}
        researchCount={(research.researchByJob[resumePreview.jobId]?.articles || []).length}
        companyReferences={research.companyResearchByJob[resumePreview.jobId] || []}
        busy={resumePreview.busy}
        notice={resumePreview.notice}
        error={resumePreview.error}
      />

      <CompanyResearchDialog
        open={research.companyResearch.open}
        company={research.companyResearch.company}
        needsCompany={
          !!research.researchByJob[research.companyResearch.jobId]?.needsCompany &&
          (research.researchByJob[research.companyResearch.jobId]?.articles || []).length === 0
        }
        loading={!!research.researchByJob[research.companyResearch.jobId]?.loading}
        error={research.researchByJob[research.companyResearch.jobId]?.error || ""}
        articles={research.researchByJob[research.companyResearch.jobId]?.articles || []}
        warnings={research.researchByJob[research.companyResearch.jobId]?.warnings || []}
        busy={research.companyResearch.busy}
        coverLetterLines={tailoringMap[research.companyResearch.jobId]?.coverLetterResultLines || []}
        onClose={research.closeCompanyResearch}
        onApply={research.applyCompanyResearch}
        onResearch={research.researchTypedCompany}
        onAddUrl={research.addResearchUrl}
      />

      <SlotReviewDialog
        open={slotReview.open}
        loading={slotReview.loading}
        error={slotReview.error}
        slots={slotReview.slots}
        onClose={closeSlotReview}
        onGenerate={generateWithReviewedValues}
        busy={manualIsSubmitting}
      />
    </div>
  );
}
