"use client";

import { useState, useEffect, useRef, useMemo } from "react";
import styles from "./page.module.css";
import JobDescriptionTab from "./components/JobDescriptionTab";
import PostingUrlTab from "./components/PostingUrlTab";
import ScreenshotTab from "./components/ScreenshotTab";
import ApplyingControls from "./components/ApplyingControls";
import TabHeader from "./components/TabHeader";
import NavTabs from "./components/NavTabs";
import TrackingTab from "./components/TrackingTab";
import LiveFeedTab from "./components/LiveFeedTab";
import LibraryEditor from "./components/LibraryEditor";
import ExperienceTab from "./components/experience/ExperienceTab";
import CopilotClient from "./copilot/CopilotClient";
import ChatPanel from "./components/ChatPanel";
import StatusBar from "./components/StatusBar";
import BatchTailorDialog from "./components/BatchTailorDialog";
import DocumentPreviewMount from "./components/DocumentPreviewMount";
import CompanyResearchDialog from "./components/CompanyResearchDialog";
import LibraryUpdateDialog from "./components/LibraryUpdateDialog";
import SlotReviewDialog from "./components/SlotReviewDialog";
import {
  buildJobContextString,
  buildApplicationContextString as buildApplicationContextStringBase,
  buildStageContextString,
} from "../lib/chat/chatbot";
import {
  isDocxResume,
  isTextResume,
  buildTemplateLinesForUpload,
  getDownloadFileNameForTitle,
  createDocumentDownloaders,
  extractResumeTextLines,
  triggerBlobDownload,
  base64ToDocxBlob,
} from "../lib/document/docx";
import { parseDocxToModel, linesToModel } from "../lib/document/docxPreview";
import { weaveSources } from "../lib/document/coverLetterWeave";
import { parseEmploymentHistory } from "../lib/resume/parseEmployment";
import { editFingerprint } from "../lib/tailor/editMining";
import { recordMatchGaps, annotateAndRank, promotedEditRules } from "../lib/tailor/localSignals";
import { runWithConcurrency } from "../lib/tailor/runWithConcurrency";
import { useProfileEntries } from "./hooks/useProfileEntries";
import { useScreenshots } from "./hooks/useScreenshots";
import { useCompanyResearch } from "./hooks/useCompanyResearch";
import { useDocumentPreview } from "./hooks/useDocumentPreview";
import { useManualTailor } from "./hooks/useManualTailor";
import { useManualPostings } from "./hooks/useManualPostings";
import { useChat } from "./hooks/useChat";
import { useApplicationDialogs } from "./hooks/useApplicationDialogs";
import { useApplicationDigests } from "./hooks/useApplicationDigests";
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
import {
  writeApplicationStatus,
  loadAppliedOrLaterExternalIds,
  deleteUntrackedApplication,
} from "../lib/supabase/applicationStatusWriter";
import { STATUS, excludeTrackingTabHiddenStatuses } from "../lib/applications/statusVocabulary";
import { selectAppliedToggleAction } from "../lib/applications/applicationDecisions";
import { persistGeneratedDocuments } from "../lib/supabase/persistGeneration";
import { normalizeInterviewValue } from "../lib/tracking/stages";
import {
  fetchFullPostingDescription,
  tailorPostingFields,
  truncatedDescriptionNotice,
} from "@/lib/feed/postingDescription";

// Sets one scope of a tailoring entry's per-scope edited flag ({ resume,
// cover }) without disturbing the other, mirroring the same helper in
// app/hooks/useDocumentPreview.js. AC-2/AC-7: an entry may carry no `edited`
// field yet, or a legacy plain boolean from before this migration — either
// is normalized into the per-scope shape before the target scope is
// overwritten, so a generate run that only produced one document never
// wipes out the other document's hand-edit state.
function withEditedScope(entry, scope, value) {
  const e = entry?.edited;
  const base = e && typeof e === "object" ? e : { resume: !!e, cover: !!e };
  return { ...base, [scope]: value };
}

// Clears the edited flag for each listed scope on a tailoring entry, leaving
// any scope NOT listed untouched — used by the generate flows below, which
// (via opts.scope) may regenerate only the résumé, only the cover letter, or
// both (AC-3: a résumé-only regenerate must never clear a hand-edited cover
// letter's edited state, and vice versa).
function withClearedEditedScopes(entry, scopes) {
  return scopes.reduce((edited, scope) => withEditedScope({ edited }, scope, false), entry?.edited);
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
  // Manual (job-description) tailoring: the queue's own state lives in
  // app/hooks/useManualPostings.js, and the shared pipeline's submit/error
  // state lives in app/hooks/useManualTailor.js -- both instantiated below,
  // once the functions/state they close over (updateTailoringJob, preview,
  // maybeOfferLibraryUpdate, ...) exist.
  // URL tailoring surface (same story as the manual surface above).
  const [urlPosting, setUrlPosting] = useState("");
  const [urlIsSubmitting, setUrlIsSubmitting] = useState(false);
  const [urlError, setUrlError] = useState("");
  const [activeSection, setActiveSection] = useState("url");
  const [ignoredJobIds, setIgnoredJobIds] = useState(new Set());
  const [appliedJobIds, setAppliedJobIds] = useState(new Set());
  // Keyed by external id, populated only for signed-in users (see
  // loadAppliedOrLaterExternalIds below) — {status, appliedAt, applicationId}
  // for every row that is EITHER applied-or-later by status OR carries a
  // non-null applied_at (the disjunct that surfaces a row a past bug demoted
  // to "tracking" while leaving its real date in place). null until it has
  // loaded; StatusBar and handleToggleApplied both treat null as "unknown"
  // rather than "empty".
  const [appliedByExternalId, setAppliedByExternalId] = useState(null);
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
  // Populated in the background after savedSearches loads. `applySavedSearch`
  // (the live consumer this comment used to name) is gone — its only caller
  // was the now-deleted `handleJobSearch`/`runJobSearch` pair, part of the
  // orphaned JobSearchTab chain (see page-js-consolidation) — so this loop
  // is now a background fetch nothing reads; `prewarmedResults` itself is
  // still read by the freshness check a few lines below.
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
  // Library-update prompt: when an embedded tailor covers too little of the
  // posting, /api/tailor returns the buzzwords the user's library lacks and this
  // dialog asks permission before any of them are committed. Deduped per job.
  const [libraryPrompt, setLibraryPrompt] = useState(null);
  const libraryPromptSeenRef = useRef(new Set());
  // The previewer's "wrong focus" flag (opens a picker of the library's focus
  // areas; applying one re-tailors the previewed job with that focus pinned)
  // now lives as local state inside DocumentPreviewMount.js -- nothing else
  // in this file ever read it.
  const [contextPanelOpen, setContextPanelOpen] = useState(false);
  const [aggressiveness, setAggressiveness] = useState(3);
  // Document-generation engine ("gemini" | "external" | "embedded"). Owned by a
  // shared store so the top-bar picker and this tailoring logic stay in sync;
  // the store handles localStorage persistence under "tailorEngine".
  const { engine: tailorEngine } = useEngine();
  // External-engine "review fields" flow: fetched proposal slots the user can
  // edit before generating the document with those `values`.
  const [slotReview, setSlotReview] = useState({ open: false, loading: false, error: "", slots: [], posting: "" });
  // Floating "AI Help" chat panel (thread, pinned context, attachments, size).
  const chat = useChat({ resumeFile, applicationData, applicationStages, mainTab, activeSection });

  // Materials profile lists (references / education / employment). Each is a
  // self-contained controller: CRUD, per-row + all copy, localStorage
  // persistence, and docx export. See lib/materials/profileEntries.js.
  const referencesCtl = useProfileEntries(REFERENCE_CONFIG);
  const educationCtl = useProfileEntries(EDUCATION_CONFIG);
  const employmentCtl = useProfileEntries(EMPLOYMENT_CONFIG);
  // Status of the "import from résumé" action on the Employment History section.
  const [employmentImport, setEmploymentImport] = useState({ loading: false, error: "", message: "" });

  // Per-job company research (warmed behind the preview; woven into the cover).
  const research = useCompanyResearch({ tailoringMap, setTailoringMap, setPreviewReloadKey });

  // Supplementary materials locker (transcripts etc.). Each item:
  // { name, size, source: "remote"|"local", file? }. Persisted to Supabase for
  // signed-in users; in-memory for the session otherwise. Download-only.
  const [materials, setMaterials] = useState([]);
  const [materialsBusy, setMaterialsBusy] = useState(false);
  const [materialsError, setMaterialsError] = useState("");
  const [applicationsRefreshKey, setApplicationsRefreshKey] = useState(0);

  // Tracking-tab dialogs (add/edit/stage/communications) + their save handlers.
  // The application data itself stays here; the hook gets the setters it needs.
  const appDialogs = useApplicationDialogs({
    currentUser,
    setApplicationData,
    setApplicationStages,
    setApplicationsRefreshKey,
    // The arrow wrapper is REQUIRED — `window.confirm` as a bare method
    // reference is green under jsdom (which tolerates an unbound receiver)
    // but throws `TypeError: Illegal invocation` in a real browser. See
    // 3-plan-dataloss.md PART 6 / G-15.
    confirm: (message) => window.confirm(message),
  });

  // Company & role research column on the tracking table - see
  // app/hooks/useApplicationDigests.js for the fetch/auto-populate/Research
  // logic this only instantiates and hands down to <TrackingTab>.
  const applicationDigests = useApplicationDigests(applicationData);

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
      savedTab === "library" ||
      savedTab === "experience" ||
      savedTab === "copilot"
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

        // Load every external id this user is applied-or-later for — by
        // STATUS, or by a non-null applied_at regardless of status (the
        // disjunct that surfaces a row a past bug demoted to "tracking"
        // while leaving a real applied_at in place; see
        // lib/supabase/applicationStatusWriter.js's
        // loadAppliedOrLaterExternalIds and test/repro/appliedStatusDataLoss
        // .test.js). A bare `.eq("status", "applied")` — the previous query —
        // could never see that shape at all.
        const { ids, byExternalId } = await loadAppliedOrLaterExternalIds(supabase, user.id);
        setAppliedJobIds(ids);
        setAppliedByExternalId(byExternalId);

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

  // Build the /api/greenhouse search URL. `runJobSearch`, this comment's
  // other consumer, is gone (see the orphaning note on `prewarmedResults`
  // above) — only the saved-search pre-warmer below calls this now.
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

  // Extract employment history from an uploaded résumé (.docx/.txt) and append
  // the detected positions to the list (capped at 4). The file is parsed to text
  // on-device. On the Embedded engine we parse it entirely on-device with the
  // heuristic parser (no network/LLM); otherwise we send it to
  // /api/extract-employment (Gemini) and fall back to that same parser if the
  // route is unavailable. Existing non-empty entries are preserved; fields stay
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
      // Embedded engine: parse on-device only, never call the LLM route.
      if (tailorEngine !== "embedded") {
        try {
          const res = await fetch("/api/extract-employment", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ resumeText, engine: tailorEngine }),
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
    chat.setChatOpen(true);
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
      if (file) await chat.addChatAttachments([file]);
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

  useEffect(() => {
    if (!currentUser) return;
    let cancelled = false;
    async function loadApplications() {
      setApplicationLoading(true);
      setApplicationError(null);
      const supabase = createClient();

      // Step 1: fetch applications + positions
      const applicationsQuery = excludeTrackingTabHiddenStatuses(
        supabase
          .from("applications")
          .select(`
            id, status, applied_at, tracked_at, application_url, resume_used_id, cover_letter_id,
            positions ( id, external_id, title, company, description, url, posted_at )
          `)
          .eq("user_id", currentUser.id),
      );
      // NULLS FIRST for a DESC order is Postgres's own default (no
      // `nullsFirst` here) — deliberately left as-is; it is what pins a
      // stranded-applied_at row (a demoted row whose real date survived) to
      // the top where it is visible. See 3-plan-dataloss.md PART 6 / G-4.
      const { data: appRows, error: appErr } = await applicationsQuery.order("applied_at", { ascending: false });

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

      // Step 2b: fetch the linked cover letters so restored chips can preview
      // and download them (they mirror generated_resumes, linked via cover_letter_id).
      const coverIds = (appRows || []).map((r) => r.cover_letter_id).filter(Boolean);
      let coverMap = {};
      if (coverIds.length > 0) {
        const { data: coverRows, error: coverErr } = await supabase
          .from("generated_cover_letters")
          .select("id, content, content_lines")
          .in("id", coverIds);
        if (coverErr) {
          console.warn("[loadApplications] cover letter fetch failed (non-fatal):", coverErr);
        } else {
          coverMap = Object.fromEntries((coverRows || []).map((r) => [r.id, r]));
        }
      }

      const merged = (appRows || []).map((app) => ({
        ...app,
        generated_resumes: app.resume_used_id ? (resumeMap[app.resume_used_id] ?? null) : null,
        generated_cover_letters: app.cover_letter_id ? (coverMap[app.cover_letter_id] ?? null) : null,
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

  // Backfill tracked-job chips from Supabase after a reload. localStorage only
  // persists a slim status per chip, so any tracked job whose position has a
  // matching application with a saved resume/cover letter is rehydrated here:
  // status "done" (green chip) plus the full tailored content, so the preview /
  // edit modal, drag-to-upload, and downloads all work without regenerating.
  // In-session content (possibly edited) stays authoritative and is never
  // clobbered; chips still generating are left alone.
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
        // Keep freshly generated / edited in-memory content authoritative.
        if (existing?.result || existing?.status === "tailoring") continue;
        const app = externalIdToApp.get(String(job.id));
        if (!app) continue;
        const gen = app.generated_resumes;
        const cover = app.generated_cover_letters;
        const resumeText = typeof gen?.content === "string" ? gen.content : "";
        const resumeLines =
          Array.isArray(gen?.content_lines) && gen.content_lines.length > 0
            ? gen.content_lines
            : resumeText
              ? resumeText.split("\n")
              : [];
        const coverLines =
          Array.isArray(cover?.content_lines) && cover.content_lines.length > 0
            ? cover.content_lines
            : typeof cover?.content === "string" && cover.content
              ? cover.content.split("\n")
              : [];
        if (!resumeText && coverLines.length === 0) continue;
        next[job.id] = {
          ...(existing || {}),
          status: "done",
          downloaded: true,
          generatedJobTitle:
            existing?.generatedJobTitle || app.positions?.title || job.title || "",
          result: resumeText,
          resultLines: resumeLines,
          coverLetterResultLines: coverLines,
          // Preserve the faithful docx for the chip download's storage fallback.
          docxPath: typeof gen?.docx_path === "string" ? gen.docx_path : "",
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

  // Application-context builder for the chat + tracking table.
  const buildApplicationContextString = (app) =>
    buildApplicationContextStringBase(app, applicationStages);

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

  // Resume/cover-letter preview + edit modal (status-bar chips + end of Generate).
  const preview = useDocumentPreview({
    tailoringMap,
    setTailoringMap,
    updateTailoringJob,
    resumeFile,
    coverLetterFile,
    additionalContext,
    aggressiveness,
    contextFiles,
    downloadDocxFiles,
    startBackgroundResearch: research.startBackgroundResearch,
    setPreviewReloadKey,
    onDocumentEdited: handleDocumentEdited,
    currentUser,
  });

  // Screenshots → tailored-documents pipeline (Manual Applying › Screenshots).
  const screenshots = useScreenshots({
    resumeFile,
    tailoringMap,
    openResumePreview: preview.openResumePreview,
    previewScopeAvailable: preview.previewScopeAvailable,
    setTrackedJobs,
    handleTailorJob,
    updateTailoringJob,
  });

  // The manual (job-description) tailoring pipeline. Called directly by a
  // StatusBar chip's "Regenerate" and by the reviewed-fields flow below, AND
  // -- with `queued: true` -- once per posting by the multi-posting queue
  // (manualPostings, right below) so every posting tracks its own outcome
  // instead of fighting over one tab-wide submitting/error state.
  const manualTailor = useManualTailor({
    resumeFile,
    coverLetterFile,
    contextFiles,
    additionalContext,
    aggressiveness,
    tailorEngine,
    currentUser,
    setTrackedJobs,
    updateTailoringJob,
    maybeOfferLibraryUpdate,
    withClearedEditedScopes,
    finishByOpeningPreview: preview.finishByOpeningPreview,
  });

  // Manual Applying › Job Description: several posting boxes, each tracked
  // and tailored independently through manualTailor.tailorPosting, capped at
  // 3 concurrent /api/tailor calls (lib/tailor/runWithConcurrency.js).
  const manualPostings = useManualPostings({
    tailorPosting: (opts) => manualTailor.tailorPosting(null, opts),
    resumeFile,
    tailoringMap,
    openResumePreview: preview.openResumePreview,
    previewScopeAvailable: preview.previewScopeAvailable,
    // manualPostings only clears its OWN error -- manualTailor.error (set by,
    // say, a failed StatusBar chip regenerate) is invisible to it, and since
    // the tab renders `manualTailor.error || manualPostings.error`, a stale
    // message would otherwise survive a fully successful run forever. This is
    // the one place both hooks are visible, so the clear belongs here -- same
    // idea as the pre-multi-posting handleManualSubmit's setManualError("")
    // at the top of every submit.
    onRunRequested: () => manualTailor.setError(""),
  });

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
      // loadAutoTailored selects `positions ( id, ... )`, so row.positions.id
      // is the position id writeApplicationStatus's allow-list keys on.
      // Unconditionally writing status+applied_at by id (the previous code)
      // re-stamped a genuine applied_at with now() on every click if the row
      // had already moved past "auto_tailored" some other way — see
      // test/repro/appliedStatusDataLoss.test.js REPRO D4.
      const result = await writeApplicationStatus(supabase, {
        userId: currentUser.id,
        positionId: row.positions?.id,
        status: STATUS.APPLIED,
      });
      if (result.reason === "error" || result.reason === "no-key") {
        console.error("[applyAutoTailoredRow] status update failed:", result);
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

    if (!currentUser) {
      // No signed-in user, no `applications` row to protect — the data-loss
      // defect this function otherwise guards against (REPRO D1: an
      // un-apply nulling a real applied_at) cannot occur here. Keep the
      // original localStorage-only toggle.
      setAppliedJobIds((prev) => {
        const next = new Set(prev);
        if (next.has(jobId)) next.delete(jobId);
        else next.add(jobId);
        localStorage.setItem("appliedJobIds", JSON.stringify([...next]));
        return next;
      });
      return;
    }

    // R1: this control only ever PROMOTES now. The un-apply branch that used
    // to live here reverted an applied-or-later row straight back to
    // "tracking" — silently nulling a real applied_at — see
    // test/repro/appliedStatusDataLoss.test.js REPRO D1. A row already
    // applied-or-later routes to Tracking instead of a second "apply".
    const action = selectAppliedToggleAction(appliedByExternalId, jobId);
    if (action === "refuse-unknown") return; // the map hasn't loaded yet; do nothing rather than guess.
    if (action === "open-tracking") {
      setMainTab("interviewing");
      return;
    }

    const supabase = createClient();
    const positionId = typeof job !== "string" ? await upsertPosition(supabase, job) : null;
    if (!positionId) return;

    const result = await writeApplicationStatus(supabase, {
      userId: currentUser.id,
      positionId,
      status: STATUS.APPLIED,
    });
    if (!result.changed) return;

    setAppliedByExternalId((prev) => {
      const next = new Map(prev || []);
      next.set(jobId, { status: STATUS.APPLIED, appliedAt: new Date().toISOString(), applicationId: result.id });
      return next;
    });
    setAppliedJobIds((prev) => new Set(prev).add(jobId));
    // Lifted out of the optimistic setState updater and awaited (StrictMode
    // double-invokes an updater in development, which would have fired the
    // DELETE twice — see 3-plan-dataloss.md PART 6 / G-20).
    await handleUntrackJob(jobId);
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

  // Keep the pinned chat context in sync when a job's tailored resume updates.
  useEffect(() => {
    if (!chat.chatPinnedContext?.sourceJobId) return;
    const jobId = chat.chatPinnedContext.sourceJobId;
    const tailoring = tailoringMap[jobId];
    if (!tailoring?.result) return;
    const tailoredBlock = `\n\nTailored Resume:\n${tailoring.result}`;
    if (chat.chatPinnedContext.content?.includes(tailoredBlock)) return;
    const jobFromResults = jobResults.find((j) => j.id === jobId);
    const jobFromTracked = trackedJobs.find((j) => j.id === jobId);
    const jobForContext = jobFromResults || jobFromTracked;
    if (!jobForContext) return;
    chat.setChatPinnedContext((prev) =>
      prev && prev.sourceJobId === jobId
        ? { ...prev, content: `${buildJobContextString(jobForContext)}${tailoredBlock}` }
        : prev,
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tailoringMap, chat.chatPinnedContext, jobResults, trackedJobs]);

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
    // The optimistic chip removal is deferred until the delete reports
    // whether it actually ran (R9) — dropping the chip unconditionally, as
    // this used to, is how a row this guard refused (still carrying a real
    // applied_at, or already past "tracking") lost its only visible trace:
    // see test/repro/appliedStatusDataLoss.test.js REPRO D2/D5.
    let refused = false;
    if (currentUser) {
      const supabase = createClient();
      const positionId = await getPositionId(supabase, jobId);
      if (positionId) {
        const { deleted } = await deleteUntrackedApplication(supabase, {
          userId: currentUser.id,
          positionId,
        });
        refused = !deleted;
      }
    }
    if (refused) return;
    setTrackedJobs((prev) => prev.filter((j) => j.id !== jobId));
  }

  function handleRegenerateSyntheticJob(job, scope = "both") {
    if (!job?.id) return;
    if (typeof job.id === "string" && job.id.startsWith("url-") && job.url) {
      handleUrlSubmit(null, { overrideUrl: job.url, syntheticJobId: job.id, scope });
      return;
    }
    if (typeof job.id === "string" && job.id.startsWith("manual-") && job.description) {
      manualTailor.tailorPosting(null, { overridePosting: job.description, syntheticJobId: job.id, scope });
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

  // The user hand-edited a generated document and closed the preview: scan the
  // ADDED text for vocabulary their library lacks and offer it through the same
  // permission dialog. Deduped per distinct edit, silent on any failure (signed
  // out, empty scan, network) — learning must never interrupt the edit flow.
  async function handleDocumentEdited({ jobId, addedText }) {
    const fingerprint = `edit:${jobId}:${editFingerprint(addedText)}`;
    if (libraryPromptSeenRef.current.has(fingerprint)) return;
    libraryPromptSeenRef.current.add(fingerprint);
    try {
      const res = await fetch("/api/library/extract", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ posting: addedText }),
      });
      if (!res.ok) return;
      const data = await res.json().catch(() => null);
      if (!data?.buzzwords?.length) return;
      setLibraryPrompt({
        promptId: `edit-${Date.now()}`,
        jobId,
        match: null,
        suggestions: { ...data, buzzwords: annotateAndRank(data.buzzwords) },
        source: "edit",
      });
    } catch {
      // best-effort only
    }
  }

  // Manual "Scan posting" from the document previewer: run the buzzword scrape
  // on the previewed job's posting and open the review dialog (same permission
  // flow as the automatic prompts — nothing is saved without approval).
  // Returns { ok, message? } for inline feedback; message is set only when the
  // dialog does NOT open (nothing new, signed out, or a failure).
  async function scrapePreviewPosting() {
    const { jobId, posting, url } = preview.resumePreview;
    const body = {};
    if (posting && posting.trim()) body.posting = posting;
    else if (url) body.url = url;
    else return { ok: false, message: "No posting is attached to this document." };
    try {
      const res = await fetch("/api/library/extract", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (res.status === 401) return { ok: false, message: "Sign in to scan postings into your library." };
      const data = await res.json().catch(() => null);
      if (!res.ok) return { ok: false, message: data?.error || "Couldn't scan the posting." };
      if (!data?.buzzwords?.length) {
        return { ok: true, message: "Your library already covers this posting's vocabulary — nothing new to add." };
      }
      setLibraryPrompt({
        promptId: `manual-${Date.now()}`,
        jobId,
        match: null,
        suggestions: { ...data, buzzwords: annotateAndRank(data.buzzwords) },
        source: "manual",
      });
      return { ok: true };
    } catch (err) {
      return { ok: false, message: err?.message || "Couldn't scan the posting." };
    }
  }

  // Offer the library-update prompt when a tailor response carries suggestions
  // (embedded engine, match below threshold, signed in). Once per job. Every
  // run's gaps are counted locally first, so terms that recur across DIFFERENT
  // postings rank first in the prompt with a "seen in N postings" badge.
  function maybeOfferLibraryUpdate(payload, jobId) {
    // Shared post-tailor hook (all four generate flows call it): record which
    // focus area and extracted keywords drove this generation so the
    // previewer's focus/buzzword controls are truthful, and count coverage
    // gaps for the cross-posting memory.
    if (payload?.report) {
      updateTailoringJob(jobId, {
        focusInfo: payload.report.meta?.focus || null,
        keywordsInfo: payload.report.keywords || null,
        ...(payload.coverVariant !== undefined ? { coverVariantInfo: payload.coverVariant || null } : {}),
      });
    }
    if (payload?.match) recordMatchGaps(payload.match);
    if (!payload?.librarySuggestions?.buzzwords?.length) return;
    if (libraryPromptSeenRef.current.has(jobId)) return;
    libraryPromptSeenRef.current.add(jobId);
    setLibraryPrompt({
      promptId: `match-${jobId}`,
      jobId,
      match: payload.match || null,
      suggestions: {
        ...payload.librarySuggestions,
        buzzwords: annotateAndRank(payload.librarySuggestions.buzzwords),
      },
      source: "match",
    });
  }

  // The user approved some suggested buzzwords: commit them to the per-user
  // library via the existing import endpoint, then optionally re-tailor the job
  // so the new vocabulary immediately improves the documents.
  async function commitLibrarySuggestions(entries, { retailor = false } = {}) {
    let data;
    try {
      const res = await fetch("/api/library/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ taxonomy: entries }),
      });
      data = await res.json().catch(() => ({}));
      if (!res.ok) return { ok: false, error: data?.error || "Couldn't save to your library." };
    } catch (err) {
      return { ok: false, error: err.message || "Couldn't save to your library." };
    }
    const jobId = libraryPrompt?.jobId;
    setLibraryPrompt(null);
    if (retailor && jobId) {
      const job = trackedJobs.find((j) => j.id === jobId);
      if (job) handleTailorJob(job, { skipDownload: true });
    }
    return { ok: true, added: data?.added };
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
      // Promoted recurring hand-edits (localStorage) — the embedded engine
      // applies them document-wide so consistent fixes are pre-made.
      if (tailorEngine === "embedded") {
        const editRules = promotedEditRules();
        if (editRules.length > 0) formData.append("editRules", JSON.stringify(editRules));
        // A focus area and buzzword toggles the user pinned for this job (the
        // previewer's focus modal) stick across re-tailors.
        const focusOverride = tailoringMap[job.id]?.focusAreaOverride;
        if (focusOverride) formData.append("focusArea", focusOverride);
        const kwEdits = tailoringMap[job.id]?.keywordEditsOverride;
        if (kwEdits && (kwEdits.boost?.length || kwEdits.exclude?.length)) {
          formData.append("keywordEdits", JSON.stringify(kwEdits));
        }
        const variantOverride = tailoringMap[job.id]?.coverVariantOverride;
        if (variantOverride) formData.append("coverVariant", variantOverride);
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

      if (!response.ok) throw new Error(payload.error || "Failed to generate.");
      maybeOfferLibraryUpdate(payload, job.id);

      const result = payload.result?.trim() || "";
      const resultLines = Array.isArray(payload.resultLines) ? payload.resultLines : [];
      const generatedJobTitle = typeof payload.jobTitle === "string" ? payload.jobTitle.trim() : "";
      const coverLetterResultLines = Array.isArray(payload.coverLetterResultLines)
        ? payload.coverLetterResultLines
        : [];
      const coverLetterResult =
        typeof payload.coverLetterResult === "string" && payload.coverLetterResult
          ? payload.coverLetterResult
          : coverLetterResultLines.join("\n");
      const coverLetterError = typeof payload.coverLetterError === "string" ? payload.coverLetterError : "";
      const engineUsed = typeof payload.engine === "string" ? payload.engine : "";
      const docxB64 = typeof payload.docxB64 === "string" ? payload.docxB64 : "";
      const coverLetterDocxB64 = typeof payload.coverLetterDocxB64 === "string" ? payload.coverLetterDocxB64 : "";
      // Hiring-team email (session state only — see AC-8 note in route.js; no
      // persistence yet). Not scoped to applyResume/applyCover: it's a third,
      // independent document the engine generates on every run.
      const emailSubject = typeof payload.emailSubject === "string" ? payload.emailSubject : "";
      const emailResultLines = Array.isArray(payload.emailResultLines) ? payload.emailResultLines : [];

      updateTailoringJob(job.id, (entry) => ({
        ...entry,
        status: "done",
        generatedJobTitle,
        engine: engineUsed,
        // AC-3: clear only the scope(s) this run actually regenerated.
        edited: withClearedEditedScopes(entry, [
          ...(applyResume ? ["resume"] : []),
          ...(applyCover ? ["cover"] : []),
        ]),
        error: coverLetterError || "",
        emailSubject,
        emailResultLines,
        ...(applyResume ? { result, resultLines, docxB64 } : {}),
        ...(applyCover ? { coverLetterResultLines, coverLetterDocxB64 } : {}),
      }));

      // Persist the generated resume + cover letter and link them to the application.
      if (currentUser) {
        const supabase = createClient();
        // Use upsertPosition (not just getPositionId) so a position row is
        // created on the fly if the user tailored a job they hadn't tracked.
        const positionId = await upsertPosition(supabase, job);
        if (!positionId) {
          console.error("[handleTailorJob] upsertPosition returned null for job", job?.id, job?.title);
        }
        const { resumeId: generatedResumeId, coverLetterId: generatedCoverLetterId } = await persistGeneratedDocuments(supabase, {
          userId: currentUser.id,
          positionId,
          resume: applyResume ? { content: result, contentLines: resultLines, docxB64 } : null,
          coverLetter:
            applyCover && coverLetterResultLines.length > 0
              ? { content: coverLetterResult, contentLines: coverLetterResultLines }
              : null,
          sourceResumePath: `${currentUser.id}/resume`,
          additionalContext: additionalContext || null,
        });
        if (applyResume && !generatedResumeId) {
          console.error("[handleTailorJob] saveGeneratedResume returned null", { userId: currentUser.id, positionId });
        }
        if (applyCover && coverLetterResultLines.length > 0 && !generatedCoverLetterId) {
          console.error("[handleTailorJob] saveGeneratedCoverLetter returned null", { userId: currentUser.id, positionId });
        }
        if (generatedResumeId && positionId) {
          // ONE call now creates the row (if it doesn't exist yet) AND
          // promotes it — never demoting a row already at an applied-or-
          // later status. The row this used to be a separate upsertApplication
          // ("tracking") followed by a NOT-IN-guarded UPDATE: that guard ran
          // AFTER the upsert had already overwritten the very status column
          // it filtered on, so it never protected anything — see
          // test/repro/appliedStatusDataLoss.test.js REPRO D3.
          // "auto_tailored" (vs. "tailored") routes the row to the dedicated
          // Auto Tailor tab instead of the Interviewing tab.
          const targetStatus = opts.markAsAutoTailor ? STATUS.AUTO_TAILORED : STATUS.TAILORED;
          const promotion = await writeApplicationStatus(supabase, {
            userId: currentUser.id,
            positionId,
            status: targetStatus,
          });
          if (!promotion.id) {
            console.error("[handleTailorJob] writeApplicationStatus returned no id", {
              userId: currentUser.id,
              positionId,
              promotion,
            });
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
      await runWithConcurrency(
        chosen,
        3,
        (job) => handleTailorJob(job, { skipDownload, markAsAutoTailor: true }),
        () => setBatchTailorState((s) => ({ ...s, completed: s.completed + 1 })),
      );
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
      // Promoted recurring hand-edits (localStorage) — the embedded engine
      // applies them document-wide so consistent fixes are pre-made.
      if (tailorEngine === "embedded") {
        const editRules = promotedEditRules();
        if (editRules.length > 0) formData.append("editRules", JSON.stringify(editRules));
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
      maybeOfferLibraryUpdate(payload, syntheticJobId);

      const nextResult = payload.result?.trim() || "No output returned from Gemini.";
      const nextResultLines = Array.isArray(payload.resultLines) ? payload.resultLines : [];
      const nextJobTitle = typeof payload.jobTitle === "string" ? payload.jobTitle.trim() : "";
      const nextJobDescription = typeof payload.jobDescription === "string" ? payload.jobDescription.trim() : "";
      const nextCompany = typeof payload.company === "string" ? payload.company.trim() : "";
      const nextCoverLetterResultLines = Array.isArray(payload.coverLetterResultLines)
        ? payload.coverLetterResultLines
        : [];
      const nextCoverLetterResult =
        typeof payload.coverLetterResult === "string" && payload.coverLetterResult
          ? payload.coverLetterResult
          : nextCoverLetterResultLines.join("\n");
      const nextCoverLetterError = typeof payload.coverLetterError === "string" ? payload.coverLetterError : "";
      const nextEngine = typeof payload.engine === "string" ? payload.engine : "";
      const nextDocxB64 = typeof payload.docxB64 === "string" ? payload.docxB64 : "";
      const nextCoverLetterDocxB64 = typeof payload.coverLetterDocxB64 === "string" ? payload.coverLetterDocxB64 : "";
      // Hiring-team email (session state only — see AC-8 note in route.js).
      const nextEmailSubject = typeof payload.emailSubject === "string" ? payload.emailSubject : "";
      const nextEmailResultLines = Array.isArray(payload.emailResultLines) ? payload.emailResultLines : [];

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
      updateTailoringJob(syntheticJobId, (entry) => ({
        ...entry,
        status: "done",
        generatedJobTitle: nextJobTitle,
        engine: nextEngine,
        // AC-3: clear only the scope(s) this run actually regenerated.
        edited: withClearedEditedScopes(entry, [
          ...(applyResume ? ["resume"] : []),
          ...(applyCover ? ["cover"] : []),
        ]),
        emailSubject: nextEmailSubject,
        emailResultLines: nextEmailResultLines,
        ...(applyResume ? { result: nextResult, resultLines: nextResultLines, docxB64: nextDocxB64 } : {}),
        ...(applyCover ? { coverLetterResultLines: nextCoverLetterResultLines, coverLetterDocxB64: nextCoverLetterDocxB64 } : {}),
      }));

      // Persist the generated resume + cover letter and link them to an application.
      if (currentUser) {
        const supabase = createClient();
        const positionId = await upsertPosition(supabase, syntheticJob);
        if (positionId) {
          // Tailoring is not applying (P-1): the user has generated a
          // document, not submitted anything. Promote to "tailored" — a
          // PRE-APPLY status, same target handleTailorJob uses — never
          // "applied". upsertApplication's own guard (writeApplicationStatus's
          // C1 allow-list UPDATE) only refuses to demote when the row's
          // CURRENT status is pre-apply; it does not care what the target is,
          // so writing "applied" here would have let a brand-new row be
          // created already "applied" with a fabricated applied_at, and — for
          // an existing row already at some OTHER applied-or-later status
          // (e.g. "offer") — have been ready to overwrite it with "applied"
          // the moment that row ever went back through a pre-apply status.
          // Targeting "tailored" instead means the promote can never carry an
          // applied-or-later value, so the guard actually protects.
          await upsertApplication(supabase, { userId: currentUser.id, positionId, status: STATUS.TAILORED });
        }
        await persistGeneratedDocuments(supabase, {
          userId: currentUser.id,
          positionId,
          resume: applyResume ? { content: nextResult, contentLines: nextResultLines, docxB64: nextDocxB64 } : null,
          coverLetter:
            applyCover && nextCoverLetterResultLines.length > 0
              ? { content: nextCoverLetterResult, contentLines: nextCoverLetterResultLines }
              : null,
          sourceResumePath: `${currentUser.id}/resume`,
          additionalContext: additionalContext || null,
        });
        setApplicationsRefreshKey((k) => k + 1);
      }

      preview.finishByOpeningPreview({
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
      manualTailor.setError("Please provide a job posting first.");
      return;
    }
    // Stash the reviewed posting's text so generateWithReviewedValues can
    // pass it through as overridePosting -- the tab may hold several posting
    // boxes by the time the user clicks Generate, so there is no single
    // "the current posting" state to fall back on anymore.
    setSlotReview({ open: true, loading: true, error: "", slots: [], posting });
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
    manualTailor.tailorPosting(null, { values, overridePosting: slotReview.posting });
  }

  // Tailor a résumé + cover letter for a Live Feed posting. Mirrors
  // handleUrlSubmit/manualTailor.tailorPosting so the shared StatusBar chip and the
  // tailoring pipeline behave identically. Prefers the posting URL; falls back
  // to the posting description text when no URL is available. Returns an error
  // message string on failure (or null on success) so the caller can surface it.
  async function handleTailorFeedPosting(posting) {
    if (!posting) return "Missing posting.";
    if (!resumeFile) return "Please upload a resume file first.";

    const postingUrl = (posting.url || "").trim();
    // The feed LIST query omits `raw_data` on purpose (it holds whole job
    // descriptions and that query returns a page of postings at a time), so
    // everything a posting object carries here is `description_snippet` -- a
    // 400-character truncation. Fetch the stored full description on demand,
    // one single-row read made only now that the user has actually clicked
    // Tailor, so this path feeds the engine the same text the apply /
    // auto-apply-queue / cron paths already use.
    const snippetText = (posting.description || posting.description_snippet || "").trim();
    if (!postingUrl && !snippetText) {
      return "This posting has no URL or description to tailor against.";
    }

    const fullDescription = await fetchFullPostingDescription(posting);
    const postingText = fullDescription.text || snippetText;
    const postingTextIsFull = !!(fullDescription.full && fullDescription.text);

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
      // Exactly one of the two: sending both makes the URL win for Gemini
      // (lib/llm/tailorResume.js) and discard the full text we just fetched.
      const { jobPosting, jobPostingUrl } = tailorPostingFields({
        text: postingText,
        full: postingTextIsFull,
        url: postingUrl,
      });
      if (jobPostingUrl) formData.append("jobPostingUrl", jobPostingUrl);
      if (jobPosting) formData.append("jobPosting", jobPosting);
      formData.append("additionalContext", additionalContext);
      formData.append("aggressiveness", String(aggressiveness));
      formData.append("engine", tailorEngine);
      // Promoted recurring hand-edits (localStorage) — the embedded engine
      // applies them document-wide so consistent fixes are pre-made.
      if (tailorEngine === "embedded") {
        const editRules = promotedEditRules();
        if (editRules.length > 0) formData.append("editRules", JSON.stringify(editRules));
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
      maybeOfferLibraryUpdate(payload, syntheticJobId);

      const nextResult = payload.result?.trim() || "No output returned from Gemini.";
      const nextResultLines = Array.isArray(payload.resultLines) ? payload.resultLines : [];
      const nextJobTitle = typeof payload.jobTitle === "string" ? payload.jobTitle.trim() : "";
      const nextJobDescription = typeof payload.jobDescription === "string" ? payload.jobDescription.trim() : "";
      const nextCompany = typeof payload.company === "string" ? payload.company.trim() : "";
      const nextCoverLetterResultLines = Array.isArray(payload.coverLetterResultLines)
        ? payload.coverLetterResultLines
        : [];
      const nextCoverLetterResult =
        typeof payload.coverLetterResult === "string" && payload.coverLetterResult
          ? payload.coverLetterResult
          : nextCoverLetterResultLines.join("\n");
      const nextCoverLetterError = typeof payload.coverLetterError === "string" ? payload.coverLetterError : "";
      const nextEngine = typeof payload.engine === "string" ? payload.engine : "";
      const nextDocxB64 = typeof payload.docxB64 === "string" ? payload.docxB64 : "";
      const nextCoverLetterDocxB64 = typeof payload.coverLetterDocxB64 === "string" ? payload.coverLetterDocxB64 : "";
      // Hiring-team email (session state only — see AC-8 note in route.js).
      const nextEmailSubject = typeof payload.emailSubject === "string" ? payload.emailSubject : "";
      const nextEmailResultLines = Array.isArray(payload.emailResultLines) ? payload.emailResultLines : [];

      // Only reached when the full description was unavailable AND the server's
      // own scrape of the posting URL came back empty too -- i.e. the engine
      // genuinely never saw more than the 400-character preview. "" otherwise.
      const truncationNotice = truncatedDescriptionNotice({
        full: postingTextIsFull,
        scrapedDescription: nextJobDescription,
        reason: fullDescription.reason,
      });
      if (truncationNotice) console.warn("[handleTailorFeedPosting]", truncationNotice);

      const syntheticJob = {
        id: syntheticJobId,
        title: nextJobTitle || posting.title || "Untitled role",
        company: nextCompany || posting.company || "",
        url: postingUrl,
        // upsertPosition writes this straight into positions.description. The
        // full text wins when we have it; otherwise the server's scrape beats
        // the truncation, and the truncation is the last resort.
        description: postingTextIsFull ? postingText : nextJobDescription || postingText,
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
        emailSubject: nextEmailSubject,
        emailResultLines: nextEmailResultLines,
        // This call unconditionally overwrites both result/resultLines and
        // coverLetterResultLines above (no applyResume/applyCover scoping
        // here, see the comment below) — both scopes' content is genuinely
        // fresh, so both edited flags are cleared.
        edited: { resume: false, cover: false },
      });

      // Persist the generated resume + cover letter and link them to an
      // application. Unlike the other three generate sites, this one has no
      // applyResume/applyCover scoping concept (handleTailorFeedPosting takes
      // no `opts.scope`) — it always treats a produced resume as generated,
      // and a cover letter as generated whenever the engine returned lines.
      // This is safe: a Live Feed posting only ever reaches this handler via
      // its single "tailor" action (onTailor below has no separate scoped
      // regenerate entry point), so every call here is a first-time generate
      // with no pre-existing partial-scope edit state to protect.
      if (currentUser) {
        const supabase = createClient();
        const positionId = await upsertPosition(supabase, syntheticJob);
        if (positionId) {
          // Tailoring is not applying (P-1) — see the matching comment in
          // handleUrlSubmit above. Promote to "tailored", never "applied".
          await upsertApplication(supabase, { userId: currentUser.id, positionId, status: STATUS.TAILORED });
        }
        await persistGeneratedDocuments(supabase, {
          userId: currentUser.id,
          positionId,
          resume: { content: nextResult, contentLines: nextResultLines, docxB64: nextDocxB64 },
          coverLetter:
            nextCoverLetterResultLines.length > 0
              ? { content: nextCoverLetterResult, contentLines: nextCoverLetterResultLines }
              : null,
          sourceResumePath: `${currentUser.id}/resume`,
          additionalContext: additionalContext || null,
        });
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

      // Both are surfaced through the same channel the download error already
      // uses: LiveFeedTab renders whatever this returns in its Alert. A
      // truncated tailor that reported nothing would be indistinguishable from
      // a good one.
      return [truncationNotice, dlError].filter(Boolean).join(" ") || null;
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
            { value: "copilot", label: "Interview Copilot" },
            { value: "library", label: "Library" },
            { value: "experience", label: "Professional Experience" },
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
        <TabHeader
          title="Tailor to a posting"
          description="Paste a posting URL, a job description, or screenshots to generate a tailored resume and cover letter."
        />

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
            entries={manualPostings.entries}
            // A4: split, rather than the old single `running` that combined
            // both -- `running` is this tab's own queue (the only thing
            // completed/total are meaningful for); `busy` is anything that
            // should disable controls, including a StatusBar chip's
            // "Regenerate" running through manualTailor alone. Reading the
            // combined flag as if it always meant "this queue is running"
            // was what let a chip regenerate make the Generate button read
            // a stale "Tailoring 3 of 3…" for one unrelated job.
            running={manualPostings.running}
            busy={manualTailor.submitting || manualPostings.running}
            completed={manualPostings.completed}
            total={manualPostings.total}
            lastRun={manualPostings.lastRun}
            error={manualTailor.error || manualPostings.error}
            onAddPosting={manualPostings.addPosting}
            onRemovePosting={manualPostings.removePosting}
            onChangePosting={manualPostings.setPostingText}
            onSubmit={manualPostings.submitAll}
            onRetryFailed={manualPostings.retryFailed}
            onPreviewEntry={manualPostings.previewEntry}
            askAiAbout={chat.askAiAbout}
            tailorEngine={tailorEngine}
            onReviewFields={openSlotReview}
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
            askAiAbout={chat.askAiAbout}
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
            openAddApplicationDialog={appDialogs.openAddApplicationDialog}
            toggleInterviewSort={toggleInterviewSort}
            sortLabelSx={sortLabelSx}
            startColResize={startColResize}
            askAiAbout={chat.askAiAbout}
            buildApplicationContextString={buildApplicationContextString}
            buildStageContextString={buildStageContextString}
            openCommsInAppDialog={appDialogs.openCommsInAppDialog}
            openAddCommunicationDialog={appDialogs.openAddCommunicationDialog}
            openEditApplicationDialog={appDialogs.openEditApplicationDialog}
            handleDeleteApplication={appDialogs.handleDeleteApplication}
            setAppDialog={appDialogs.setAppDialog}
            setStageError={appDialogs.setStageError}
            setStageDialog={appDialogs.setStageDialog}
            isDocxResume={isDocxResume}
            downloadDocxFiles={downloadDocxFiles}
            getDownloadFileNameForTitle={getDownloadFileNameForTitle}
            stageDialog={appDialogs.stageDialog}
            stageError={appDialogs.stageError}
            stageSaving={appDialogs.stageSaving}
            handleSaveStage={appDialogs.handleSaveStage}
            communicationsDialog={appDialogs.communicationsDialog}
            setCommunicationsDialog={appDialogs.setCommunicationsDialog}
            addCommunicationDialog={appDialogs.addCommunicationDialog}
            setAddCommunicationDialog={appDialogs.setAddCommunicationDialog}
            communicationError={appDialogs.communicationError}
            setCommunicationError={appDialogs.setCommunicationError}
            communicationSaving={appDialogs.communicationSaving}
            handleSaveCommunication={appDialogs.handleSaveCommunication}
            editAppDialog={appDialogs.editAppDialog}
            setEditAppDialog={appDialogs.setEditAppDialog}
            editAppSaving={appDialogs.editAppSaving}
            editAppError={appDialogs.editAppError}
            editAppResumeFile={appDialogs.editAppResumeFile}
            setEditAppResumeFile={appDialogs.setEditAppResumeFile}
            handleSaveEditApplication={appDialogs.handleSaveEditApplication}
            addAppDialog={appDialogs.addAppDialog}
            setAddAppDialog={appDialogs.setAddAppDialog}
            addAppSaving={appDialogs.addAppSaving}
            addAppError={appDialogs.addAppError}
            addAppResumeFile={appDialogs.addAppResumeFile}
            setAddAppResumeFile={appDialogs.setAddAppResumeFile}
            handleSaveAddApplication={appDialogs.handleSaveAddApplication}
            appDialog={appDialogs.appDialog}
            loadCommunicationsForApp={appDialogs.loadCommunicationsForApp}
            highlightedAppId={highlightedAppId}
            digestsById={applicationDigests.digestsById}
            researchingIds={applicationDigests.researchingIds}
            researchOne={applicationDigests.researchOne}
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

        {mainTab === "copilot" && <CopilotClient />}
        {mainTab === "library" && <LibraryEditor />}
        {mainTab === "experience" && (
          <ExperienceTab askAiAbout={chat.askAiAbout} addChatAttachments={chat.addChatAttachments} />
        )}

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
          chat.setChatOpen((v) => !v);
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
        {chat.chatOpen ? "Close" : "AI Help"}
      </Fab>

      {chat.chatOpen ? (
        <ChatPanel
          chatPanelRef={chat.chatPanelRef}
          chatScrollRef={chat.chatScrollRef}
          chatInputRef={chat.chatInputRef}
          chatDragActive={chat.chatDragActive}
          setChatDragActive={chat.setChatDragActive}
          addChatAttachments={chat.addChatAttachments}
          fabPos={fabPos}
          chatSize={chat.chatSize}
          startChatResize={chat.startChatResize}
          chatMessages={chat.chatMessages}
          setChatMessages={chat.setChatMessages}
          chatError={chat.chatError}
          setChatError={chat.setChatError}
          chatPinnedContext={chat.chatPinnedContext}
          setChatPinnedContext={chat.setChatPinnedContext}
          chatSending={chat.chatSending}
          chatProgress={chat.chatProgress}
          chatCopiedIndex={chat.chatCopiedIndex}
          setChatCopiedIndex={chat.setChatCopiedIndex}
          resendUserMessage={chat.resendUserMessage}
          chatAttachedFiles={chat.chatAttachedFiles}
          setChatAttachedFiles={chat.setChatAttachedFiles}
          chatAttachError={chat.chatAttachError}
          setChatAttachError={chat.setChatAttachError}
          chatInput={chat.chatInput}
          setChatInput={chat.setChatInput}
          sendChatMessage={chat.sendChatMessage}
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
        getDownloadFileNameForTitle={getDownloadFileNameForTitle}
        askAiAbout={chat.askAiAbout}
        buildJobContextString={buildJobContextString}
        setMainTab={setMainTab}
        setActiveSection={setActiveSection}
        setHighlightedJobId={setHighlightedJobId}
        downloadResumeForChipJob={downloadResumeForChipJob}
        onRegenerate={onRegenerateChipJob}
        handleToggleApplied={handleToggleApplied}
        handleIgnoreJob={handleIgnoreJob}
        handleUntrackJob={handleUntrackJob}
        openResumePreview={preview.openResumePreview}
        openCompanyResearch={research.openCompanyResearch}
        appliedByExternalId={appliedByExternalId}
      />

      <DocumentPreviewMount
        preview={preview}
        tailoringMap={tailoringMap}
        research={research}
        chat={chat}
        tailorEngine={tailorEngine}
        previewReloadKey={previewReloadKey}
        scrapePreviewPosting={scrapePreviewPosting}
        currentUser={currentUser}
        resumeFile={resumeFile}
        coverLetterFile={coverLetterFile}
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
        busy={manualTailor.submitting}
      />

      <LibraryUpdateDialog
        key={libraryPrompt?.promptId || "library-prompt-idle"}
        prompt={libraryPrompt}
        onClose={() => setLibraryPrompt(null)}
        onCommit={commitLibrarySuggestions}
      />
    </div>
  );
}
