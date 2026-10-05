// N105 Step 8-UI - the presentation tables behind the reviewer-flag panel, the
// removed-claims list and the Ideal result band, plus the few pure helpers that
// turn raw review data into the rows those components draw. PURE: no React, no
// IO. N103/N104 add rows to these tables; they do not grow a second one.
//
// What lives here, and why it is data and not JSX:
//   FLAG_PRESENTATION  (draft, category) -> label and tier (UX 5.2). The label is
//                      the stable vocabulary; the reviewer's own `message` is the
//                      specific detail rendered under it.
//   CHECK_LABELS       plain names for the seven checks, used by the partial
//                      notice so it can say what was and was not checked.
//   REMOVAL_REASONS    the closed table the gate's reason codes are shown with.
//
// A category or draft this table does not know is shown anyway, under a generic
// label and the most cautious tier for its draft: a flag that vanishes because the
// vocabulary drifted would be a hidden risk, a generic label is only a rough edge.

import { CATEGORY, ORIGIN } from "./contract.js";
import { GATE_REASON } from "../llm/ideal/applicationReadyGate.js";

export const DRAFT_KIND = Object.freeze({
  APPLICATION_READY: "applicationReady",
  HYPOTHETICAL: "hypothetical",
});

// Confirm = a truth risk to the user before sending (application-ready only).
// Improve = quality. Note = information about the hypothetical, nothing is sent
// from it.
export const TIER = Object.freeze({
  CONFIRM: "confirm",
  IMPROVE: "improve",
  NOTE: "note",
});

const TIER_RANK = Object.freeze({ [TIER.CONFIRM]: 0, [TIER.IMPROVE]: 1, [TIER.NOTE]: 2 });

// A group lists at most this many rows before "Show all (n)".
export const GROUP_ROW_CAP = 8;

const entry = (label, tier) => Object.freeze({ label, tier });

export const FLAG_PRESENTATION = Object.freeze({
  [DRAFT_KIND.APPLICATION_READY]: Object.freeze({
    [CATEGORY.UNSUPPORTED_AUTHORITY]: entry("Role or seniority not in your resume", TIER.CONFIRM),
    [CATEGORY.UNVERIFIABLE_METRIC]: entry("Figure cannot be checked", TIER.CONFIRM),
    [CATEGORY.CONSISTENCY]: entry("Does not line up", TIER.CONFIRM),
    [CATEGORY.EMPLOYER_PLAUSIBILITY]: entry("Unlikely for this employer", TIER.CONFIRM),
    [CATEGORY.VAGUE_UNSUPPORTED]: entry("Vague claim", TIER.IMPROVE),
    [CATEGORY.REPETITION]: entry("Repeats another line", TIER.IMPROVE),
    [CATEGORY.MISSING_KEYWORD]: entry("Posting keyword missing", TIER.IMPROVE),
  }),
  [DRAFT_KIND.HYPOTHETICAL]: Object.freeze({
    [CATEGORY.UNSUPPORTED_AUTHORITY]: entry("Seniority does not add up", TIER.NOTE),
    [CATEGORY.UNVERIFIABLE_METRIC]: entry("Unsourced figure", TIER.NOTE),
    [CATEGORY.CONSISTENCY]: entry("Does not line up", TIER.NOTE),
    [CATEGORY.EMPLOYER_PLAUSIBILITY]: entry("Unlikely for this employer", TIER.NOTE),
    [CATEGORY.VAGUE_UNSUPPORTED]: entry("Vague claim", TIER.NOTE),
    [CATEGORY.REPETITION]: entry("Repeats another line", TIER.NOTE),
    [CATEGORY.MISSING_KEYWORD]: entry("Posting keyword missing", TIER.NOTE),
  }),
});

const UNKNOWN_CATEGORY_LABEL = "Needs a look";

// Plain names for the seven checks, phrased to follow "Checked:" and "Not fully
// checked:" in the partial notice.
export const CHECK_LABELS = Object.freeze({
  [CATEGORY.MISSING_KEYWORD]: "posting keywords",
  [CATEGORY.REPETITION]: "repeated phrasing",
  [CATEGORY.UNVERIFIABLE_METRIC]: "figures with no baseline",
  [CATEGORY.VAGUE_UNSUPPORTED]: "vague wording",
  [CATEGORY.CONSISTENCY]: "dates and titles lining up",
  [CATEGORY.UNSUPPORTED_AUTHORITY]: "role and seniority claims",
  [CATEGORY.EMPLOYER_PLAUSIBILITY]: "whether claims fit the employer",
});

// Keyed by the gate's reason codes (GATE_REASON), never by retyped literals.
export const REMOVAL_REASONS = Object.freeze({
  [GATE_REASON.PARTIAL_MATCH]: "Part of this could not be matched to your resume",
  [GATE_REASON.NO_MATCH]: "No matching fact in your resume",
  [GATE_REASON.MEMBERSHIP]: "Belongs to a different employer",
});

const REMOVAL_REASON_FALLBACK = "Could not be matched to your resume";

// Group titles and the one-sentence hints under them.
export const PANEL_COPY = Object.freeze({
  confirmTitle: "Confirm before you send",
  improveTitle: "Could be stronger",
  noteTitle: "Reviewer notes",
  // N104 class hints: one sentence under a group title saying what KIND of finding
  // the group holds. They describe the class, never a control, so they stay true on
  // every engine; a surface shows them only when it opts in (ReviewFlagsPanel's
  // `classHints`), so the other surfaces' panels read exactly as they did.
  improveHint: "Rewording can address these.",
  confirmHint: "Only you can check these - they depend on what is true of you.",
  unresolvedTitle: "Requirements your resume cannot meet by rewording",
  unresolvedHint: "Rewording cannot supply these - they need real experience or a different story.",
  removedHint:
    "These lines were in the best-case draft and partly match your resume, so they were taken out of your file. If a line is true and you can support it, add it back.",
  // The band's two standing sentences: Revise re-runs the standard route and would
  // replace this file with an ungated resume, so it is off for an Ideal result; and
  // the lists are session-only while the file is not.
  reviseOff: "Revise is off for Ideal-level results. Edit the resume directly, or run again.",
  sessionFooter:
    "These notes, and the lists of removed and left-out lines, are kept for this session only. Your file is already complete and does not depend on them.",
});

export const removedTitle = (n) => `Removed - verify and add back (${n})`;
export const leftOutTitle = (n) => `Left out because your resume does not support them (${n})`;

// The announcer strings for the removed-line Copy action, in the {polite, alert,
// visible, persist} shape the preview's existing live-region pair consumes.
const REMOVED_COPY_MESSAGES = Object.freeze({
  copied: "Copied the removed line.",
  failed: "Couldn't copy. Select the line and copy it.",
});

export function removedCopyOutcome(result) {
  if (result?.ok) {
    const message = REMOVED_COPY_MESSAGES.copied;
    return { polite: message, alert: "", visible: message, persist: false };
  }
  const message = REMOVED_COPY_MESSAGES.failed;
  return { polite: "", alert: message, visible: message, persist: true };
}

const own = (table, key) =>
  (typeof key === "string" || typeof key === "number") && Object.prototype.hasOwnProperty.call(table, key)
    ? table[key]
    : undefined;

export function checkLabel(category) {
  return own(CHECK_LABELS, category) ?? String(category ?? "");
}

export function removalReason(code) {
  return own(REMOVAL_REASONS, code) ?? REMOVAL_REASON_FALLBACK;
}

// The label and tier a flag is shown with. An unknown draft reads as the
// application-ready draft (the stricter one); an unknown category gets the generic
// label at that draft's most cautious tier.
export function presentFlag(draftKind, category) {
  const draft = own(FLAG_PRESENTATION, draftKind) ?? FLAG_PRESENTATION[DRAFT_KIND.APPLICATION_READY];
  const found = own(draft, category);
  if (found) return found;
  const tier = draftKind === DRAFT_KIND.HYPOTHETICAL ? TIER.NOTE : TIER.CONFIRM;
  return entry(UNKNOWN_CATEGORY_LABEL, tier);
}

export function tierTitle(tier) {
  if (tier === TIER.CONFIRM) return PANEL_COPY.confirmTitle;
  if (tier === TIER.IMPROVE) return PANEL_COPY.improveTitle;
  return PANEL_COPY.noteTitle;
}

// The prefix an evidence quote is shown under, by where the evidence lives.
function evidencePrefix(ref) {
  switch (ref.origin) {
    case ORIGIN.POSTING:
      return "From the posting: ";
    case ORIGIN.REAL_MATERIAL:
      return "In your resume: ";
    case ORIGIN.DRAFT:
      if (ref.draftKind === DRAFT_KIND.HYPOTHETICAL) return "In the HYPOTHETICAL draft: ";
      if (ref.draftKind === DRAFT_KIND.APPLICATION_READY) return "In the Application-ready draft: ";
      return "In the other draft: ";
    default:
      return null;
  }
}

// Evidence is shown only when the flag has an evidenceRef AND the caller resolved
// its text into `evidenceExcerpt` (a reviewer flag carries ids, never text).
export function evidenceNote(flag) {
  const ref = flag?.evidenceRef;
  const text = typeof flag?.evidenceExcerpt === "string" ? flag.evidenceExcerpt.trim() : "";
  if (ref === null || typeof ref !== "object" || text === "") return null;
  const prefix = evidencePrefix(ref);
  return prefix === null ? null : { prefix, text };
}

// Span ids are "s1", "s2", ... in document order, but the reviewer sorts its
// flags by id as a STRING ("s10" before "s2"), so the document position comes from
// the numeric suffix. An id with none has no position and sorts after the rest.
function documentPosition(spanId) {
  const match = typeof spanId === "string" ? /(\d+)$/.exec(spanId) : null;
  return match ? Number(match[1]) : null;
}

function comparePosition(a, b) {
  if (a.position !== null && b.position !== null) return a.position - b.position;
  if (a.position !== null) return -1;
  if (b.position !== null) return 1;
  return 0;
}

// One row per SPAN: several flags on the same span merge into one row carrying
// several items. Rows sort by tier (Confirm, then Improve, then Note), then by
// document position, then by where the span first appeared in the input. A row
// takes the strictest tier among its items.
//
//   => [{ key, spanId, excerpt, tier, items: [{ category, label, tier, message,
//         evidence }] }]
export function groupFlagsBySpan(flags, draftKind) {
  const rows = new Map();
  (Array.isArray(flags) ? flags : []).forEach((flag, index) => {
    if (flag === null || typeof flag !== "object") return;
    // A flag with no usable span id cannot merge with anything: its own row.
    const mergeKey = typeof flag.spanId === "string" ? flag.spanId : index;
    const { label, tier } = presentFlag(draftKind, flag.category);
    const item = {
      category: flag.category,
      label,
      tier,
      message: typeof flag.message === "string" ? flag.message.trim() : "",
      evidence: evidenceNote(flag),
    };
    const excerpt = typeof flag.excerpt === "string" ? flag.excerpt.trim() : "";
    const existing = rows.get(mergeKey);
    if (existing) {
      existing.items.push(item);
      if (existing.excerpt === "") existing.excerpt = excerpt;
      return;
    }
    rows.set(mergeKey, {
      key: typeof flag.spanId === "string" ? `span-${flag.spanId}` : `flag-${index}`,
      spanId: typeof flag.spanId === "string" ? flag.spanId : null,
      excerpt,
      items: [item],
      appearance: index,
      position: documentPosition(flag.spanId),
    });
  });

  return [...rows.values()]
    .map((row) => {
      const items = [...row.items].sort((a, b) => TIER_RANK[a.tier] - TIER_RANK[b.tier]);
      return { ...row, items, tier: items[0].tier };
    })
    .sort(
      (a, b) =>
        TIER_RANK[a.tier] - TIER_RANK[b.tier] || comparePosition(a, b) || a.appearance - b.appearance,
    )
    .map(({ key, spanId, excerpt, tier, items }) => ({ key, spanId, excerpt, tier, items }));
}

// The entries of a removed / left-out / unresolved list that have text to show.
// Text-less entries are dropped HERE, once, so a group's count, its summary and
// its rows can never disagree.
export function textRows(list) {
  return (Array.isArray(list) ? list : []).filter(
    (item) => item !== null && typeof item === "object" && typeof item.text === "string" && item.text.trim() !== "",
  );
}

// The band's one-line summary: only NON-ZERO counts are named, so a zero can never
// read as a clean bill (UX P2).
export function bandSummary({ removed = 0, confirm = 0, requirements = 0, suggestions = 0 } = {}) {
  const parts = [];
  if (removed > 0) parts.push(`${removed} removed to verify`);
  if (confirm > 0) parts.push(`${confirm} to confirm`);
  if (requirements > 0) {
    parts.push(`${requirements} ${requirements === 1 ? "requirement" : "requirements"} wording cannot cover`);
  }
  if (suggestions > 0) parts.push(`${suggestions} ${suggestions === 1 ? "suggestion" : "suggestions"}`);
  return parts.join(", ");
}
