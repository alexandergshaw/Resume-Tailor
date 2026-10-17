import { clampIntervalMinutes } from "@/lib/feed/cronSchedule";
import { normalizeDocumentMode } from "@/lib/feed/documentSelection";

const ARRAY_FIELDS = ["jobKeywords", "selectedCategories", "selectedCompanies", "excludedCompanies", "excludedTitleKeywords"];
const owns = (object, key) => Object.hasOwn(object, key);
const defaults = () => ({ name: null, jobKeywords: [], maxYearsExp: "any", selectedCategories: [], selectedCompanies: [], excludedCompanies: [], excludedTitleKeywords: [], autoTailorMinIntervalMinutes: 60, emailOnNewJobs: false, tailoringDocumentMode: null, needsDocumentChoice: false });

// Only the declared configuration vocabulary may cross the conversation boundary.
export function mergeConversationConfig(current = {}, patch = {}) {
  const out = defaults();
  for (const input of [current, patch]) {
    if (!input || typeof input !== "object" || Array.isArray(input)) continue;
    for (const key of ARRAY_FIELDS) if (owns(input, key)) {
      if (!Array.isArray(input[key])) continue;
      out[key] = [...new Set(input[key].filter(x => typeof x === "string").map(x => x.trim().slice(0, 200)).filter(Boolean))].slice(0, 50);
    }
    if (owns(input, "name")) out.name = typeof input.name === "string" ? input.name.trim().slice(0, 200) || null : null;
    if (owns(input, "maxYearsExp") && typeof input.maxYearsExp === "string") out.maxYearsExp = input.maxYearsExp.slice(0, 20);
    if (owns(input, "autoTailorMinIntervalMinutes")) out.autoTailorMinIntervalMinutes = clampIntervalMinutes(input.autoTailorMinIntervalMinutes);
    if (owns(input, "emailOnNewJobs") && typeof input.emailOnNewJobs === "boolean") out.emailOnNewJobs = input.emailOnNewJobs;
    if (owns(input, "tailoringDocumentMode")) {
      out.tailoringDocumentMode = normalizeDocumentMode(input.tailoringDocumentMode);
      out.needsDocumentChoice = false;
    }
    if (owns(input, "needsDocumentChoice") && typeof input.needsDocumentChoice === "boolean") out.needsDocumentChoice = input.needsDocumentChoice;
  }
  return out;
}

export function normalizeConversationRequest(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new Error("Invalid conversation request.");
  const message = typeof body.message === "string" ? body.message.trim() : "";
  if (!message || message.length > 2000) throw new Error("Enter a message of 1–2000 characters.");
  const history = body.history ?? [];
  if (!Array.isArray(history) || history.length > 12) throw new Error("Conversation history is too long.");
  let total = 0;
  const normalized = history.map(turn => {
    if (!turn || !["user", "assistant"].includes(turn.role) || typeof turn.content !== "string" || turn.content.length > 2000 || Object.keys(turn).some(k => !["role", "content"].includes(k))) throw new Error("Invalid conversation history.");
    total += turn.content.length;
    return { role: turn.role, content: turn.content };
  });
  if (total > 12000) throw new Error("Conversation history is too long.");
  return { message, history: normalized, currentConfig: mergeConversationConfig(body.currentConfig) };
}

export function summarizeConversationConfig(config) {
  const c = mergeConversationConfig(config);
  const documents = c.tailoringDocumentMode === "resume_only" ? "Resume only" : c.tailoringDocumentMode === "resume_cover" ? "Resume + cover letter (both required)" : "Resume + cover letter if available";
  return `Proposed search: ${c.name || "Untitled"}. Jobs: ${c.jobKeywords.join(", ") || "all matching jobs"}. Companies: ${c.selectedCompanies.join(", ") || "any"}. Auto-tailoring checks: every ${c.autoTailorMinIntervalMinutes} minutes; eligibility depends on the existing schedule. Documents: ${documents}. Email alerts: ${c.emailOnNewJobs ? "on, on the service's existing email schedule" : "off"}. Save this proposal to create a new search; automatic tailoring stays off until you enable it separately.${c.needsDocumentChoice ? " Cover-only is unavailable; choose a supported document option before saving." : ""}`;
}
