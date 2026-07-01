// Interview-stage constants and small helpers shared by the tracking UI
// (page.js, TrackingTab, StageDialog). Pure data/formatting — no React.

export const STAGE_TYPE_OPTIONS = [
  ["phone_screen", "Phone Screen"],
  ["technical", "Technical"],
  ["behavioral", "Behavioral"],
  ["system_design", "System Design"],
  ["hiring_manager", "Hiring Manager"],
  ["panel", "Panel"],
  ["offer_call", "Offer Call"],
  ["other", "Other"],
];

export const STAGE_TYPE_LABELS = Object.fromEntries(STAGE_TYPE_OPTIONS);

export const STAGE_OUTCOME_OPTIONS = [
  ["pending", "Pending"],
  ["passed", "Passed"],
  ["failed", "Failed"],
  ["cancelled", "Cancelled"],
];

export function createStageDialogState(overrides = {}) {
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

export function formatDateTimeLocalInputValue(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (part) => String(part).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function normalizeInterviewValue(value) {
  return (value || "").trim().toLowerCase();
}
