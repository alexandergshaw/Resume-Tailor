// Client-side helpers and constants for the Live Feed tab: localStorage-backed
// filter persistence, the feed query-string builder, and small formatters.
// Kept free of React so they can be unit-tested and reused.

export const FILTERS_STORAGE_KEY = "feedFilters";
export const ADVANCED_STORAGE_KEY = "feedAdvancedFilters";
export const PANEL_OPEN_STORAGE_KEY = "feedFiltersPanelOpen";
export const AUTO_REFRESH_MS = 60000; // 60s, matches the cron cadence
export const STALE_THRESHOLD_MS = 5 * 60 * 1000; // warn if data is older than 5 minutes

export const DEFAULT_FILTERS = {
  q: "",
  location: "",
  remote: "",
  source: "",
  since: "",
  sort: "newest",
};

// Advanced filters ported from Job Search. Companies are stored as {slug,name}
// objects (or freeform strings) to match the shared JobFilterControls shape.
export const DEFAULT_ADVANCED = {
  jobKeywords: [],
  maxYearsExp: "any",
  selectedCategories: [],
  selectedCompanies: [],
  excludedCompanies: [],
  excludedTitleKeywords: [],
};

// Human-readable labels for the quick-filter summary chips.
export const REMOTE_LABELS = {
  remote: "Remote",
  hybrid: "Hybrid",
  onsite: "On-site",
};
export const SINCE_LABELS = {
  1: "Last 24h",
  3: "Last 3 days",
  7: "Last 7 days",
  30: "Last 30 days",
};

export function loadFilters() {
  if (typeof window === "undefined") return DEFAULT_FILTERS;
  try {
    const raw = window.localStorage.getItem(FILTERS_STORAGE_KEY);
    if (!raw) return DEFAULT_FILTERS;
    const parsed = JSON.parse(raw);
    return { ...DEFAULT_FILTERS, ...parsed };
  } catch {
    return DEFAULT_FILTERS;
  }
}

export function loadAdvanced() {
  if (typeof window === "undefined") return DEFAULT_ADVANCED;
  try {
    const raw = window.localStorage.getItem(ADVANCED_STORAGE_KEY);
    if (!raw) return DEFAULT_ADVANCED;
    const parsed = JSON.parse(raw);
    return { ...DEFAULT_ADVANCED, ...parsed };
  } catch {
    return DEFAULT_ADVANCED;
  }
}

// Resolve a company entry ({slug,name} | string) to its display name, which is
// what feed_postings.company stores.
export function companyName(entry) {
  if (!entry) return "";
  return typeof entry === "string" ? entry : entry.name || "";
}

// Remember whether the filter panel was left open between visits.
export function loadPanelOpen() {
  if (typeof window === "undefined") return false;
  try {
    return window.localStorage.getItem(PANEL_OPEN_STORAGE_KEY) === "true";
  } catch {
    return false;
  }
}

export function buildQueryString(active, cursor) {
  const params = new URLSearchParams();
  if (active.q) params.set("q", active.q);
  if (active.location) params.set("location", active.location);
  if (active.remote) params.set("remote", active.remote);
  if (active.source) params.set("source", active.source);
  if (active.since) params.set("since", active.since);
  if (active.sort) params.set("sort", active.sort);

  const keywords = (active.jobKeywords || []).filter(Boolean);
  if (keywords.length > 0) params.set("keywords", keywords.join(","));

  if (active.maxYearsExp && active.maxYearsExp !== "any") {
    params.set("maxYears", active.maxYearsExp);
  }

  const companies = (active.selectedCompanies || []).map(companyName).filter(Boolean);
  if (companies.length > 0) params.set("companies", companies.join(","));

  const excludeCompanies = (active.excludedCompanies || []).map(companyName).filter(Boolean);
  if (excludeCompanies.length > 0) params.set("excludeCompanies", excludeCompanies.join(","));

  const excludeTitle = (active.excludedTitleKeywords || []).filter(Boolean);
  if (excludeTitle.length > 0) params.set("excludeTitleKeywords", excludeTitle.join(","));

  if (cursor != null) params.set("cursor", String(cursor));
  return params.toString();
}

export function formatRelative(value, now) {
  if (!value) return "";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  const base = now || d.getTime();
  const diff = base - d.getTime();
  const mins = Math.round(diff / 60000);
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  const days = Math.round(hrs / 24);
  if (days < 30) return `${days}d ago`;
  return d.toLocaleDateString();
}
