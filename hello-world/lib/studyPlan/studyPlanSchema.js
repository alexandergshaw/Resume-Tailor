// Pure, no-IO schema module for the study plan (N157): the shapes of the four
// jsonb columns on `study_plans` (plan / progress / knobs; cached_research is
// SC-A's EvidenceSet and is not normalized here), their never-throwing
// normalizers, the content-derived item key, and the progress-delta contract.
// Every reader normalizes, and unknown or malformed input degrades to an
// empty-but-valid shape, so a legacy or corrupt row never crashes a read
// (the same stance as the interview-prep pack normalizer).
//
// TWO PROPERTIES THIS FILE EXISTS TO HOLD:
//
//  * Item keys are CONTENT-DERIVED, never array indices (itemKey below). The
//    walkthrough cursor and the per-card `seen` history address cards by this
//    key, so a plan rebuild that reorders or inserts items must not move a
//    key, or resume silently lands on the wrong card.
//
//  * A progress write carries ONE seen entry (buildProgressDelta /
//    isSingleItemSeenDelta below), never the whole `seen` map. The
//    merge_study_plan_progress RPC merges that single entry server-side, which
//    is what lets two devices record different cards without clobbering each
//    other. `seen` therefore stays keyed by itemId at the top level.
//
// DELIBERATELY NOT FROZEN HERE: the inside of a citation. `citations` on an
// item passes through unchanged (only "is it an array of objects" is checked),
// because the per-citation element shape belongs to SC-A's evidence module and
// guessing it now would hand that module a wrong inheritance.

/** Bump = a shape migration event. Stamped into `progress.v` and `plan.v`. */
export const STUDY_PLAN_VERSION = 1;

/**
 * The four user-facing knobs and what a user who touches none of them gets,
 * so "set nothing, still get a usable plan" has one source of truth. Deep
 * frozen: take a copy via normalizeKnobs(), never mutate this.
 */
export const DEFAULT_KNOBS = Object.freeze({
  newReviewRatio: 0.5,
  weakTopicIds: Object.freeze([]),
  pace: Object.freeze({ daysUntil: 7 }),
  topicScope: Object.freeze({ excludedAreas: Object.freeze([]) }),
});

function isPlainObject(value) {
  return Object.prototype.toString.call(value) === "[object Object]";
}

/** The plain objects of an array; anything else (including a non-array) is []. */
function asObjects(value) {
  return Array.isArray(value) ? value.filter(isPlainObject) : [];
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim() !== "";
}

/** A non-empty string, or null (ids and timestamps both degrade to null). */
function stringOrNull(value) {
  return isNonEmptyString(value) ? value : null;
}

/** Strings and finite numbers, coerced to non-empty strings; the rest dropped. */
function toStringArray(value) {
  if (!Array.isArray(value)) return [];
  return value
    .filter((v) => typeof v === "string" || (typeof v === "number" && Number.isFinite(v)))
    .map((v) => String(v))
    .filter((v) => v.trim() !== "");
}

function firstString(...values) {
  return values.find(isNonEmptyString) ?? "";
}

function squash(text) {
  return String(text).replace(/\s+/g, " ").trim();
}

// Non-cryptographic 53-bit string hash (cyrb53). It only has to be stable and
// well spread: two equal strings always hash equal, which is the whole
// contract. It is an identity, not a secret.
function hashContent(text) {
  let h1 = 0xdeadbeef;
  let h2 = 0x41c6ce57;
  for (let i = 0; i < text.length; i += 1) {
    const ch = text.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return 4294967296 * (2097151 & h2) + (h1 >>> 0);
}

function derivedId(prefix, ...parts) {
  return `${prefix}_${hashContent(parts.map(squash).join("\u0000")).toString(36)}`;
}

// --- knobs ----------------------------------------------------------------

function cloneDefaultKnobs() {
  return {
    newReviewRatio: DEFAULT_KNOBS.newReviewRatio,
    weakTopicIds: [...DEFAULT_KNOBS.weakTopicIds],
    pace: { daysUntil: DEFAULT_KNOBS.pace.daysUntil },
    topicScope: { excludedAreas: [...DEFAULT_KNOBS.topicScope.excludedAreas] },
  };
}

/**
 * Fills every default, clamps newReviewRatio to [0, 1], coerces weakTopicIds
 * and topicScope.excludedAreas to string arrays, and coerces pace.daysUntil to
 * a positive integer. NEVER throws; a null or garbage input returns a fresh
 * copy of DEFAULT_KNOBS.
 */
export function normalizeKnobs(input) {
  const out = cloneDefaultKnobs();
  if (!isPlainObject(input)) return out;
  if (typeof input.newReviewRatio === "number" && Number.isFinite(input.newReviewRatio)) {
    out.newReviewRatio = Math.min(1, Math.max(0, input.newReviewRatio));
  }
  if (Array.isArray(input.weakTopicIds)) out.weakTopicIds = toStringArray(input.weakTopicIds);
  if (isPlainObject(input.pace)) {
    const days = input.pace.daysUntil;
    if (typeof days === "number" && Number.isFinite(days) && days > 0) {
      out.pace.daysUntil = Math.max(1, Math.floor(days));
    }
  }
  if (isPlainObject(input.topicScope) && Array.isArray(input.topicScope.excludedAreas)) {
    out.topicScope.excludedAreas = toStringArray(input.topicScope.excludedAreas);
  }
  return out;
}

// --- plan -----------------------------------------------------------------

/**
 * The stable identity of a plan item: a deterministic function of its CONTENT
 * (topicHint and text), never of where it sits in an array. Equal content
 * gives an equal key, so a rebuilt plan that reorders or inserts items leaves
 * every surviving item's key alone and `seen`/cursor still point at the right
 * card. Whitespace runs are collapsed so a regen that only re-wraps a line
 * does not move the key. An item with no `text` falls back to its `prompt`
 * (the drill-front field in the arch r1 §5.1 item shape), so an item written
 * in that vocabulary never collapses to a bare topicHint key. Collisions
 * inside one plan (two identical cards) are the generator's concern.
 */
export function itemKey(item) {
  const src = isPlainObject(item) ? item : {};
  const hint = typeof src.topicHint === "string" ? src.topicHint : "";
  return derivedId("i", hint, firstString(src.text, src.prompt));
}

function normalizeItem(item) {
  const text = typeof item.text === "string" ? item.text : "";
  const topicHint = typeof item.topicHint === "string" ? item.topicHint : "";
  return {
    ...item,
    // A caller-supplied stable id wins (a plan that already carries ids keeps
    // them); otherwise the id is the content-derived key.
    id: stringOrNull(item.id) ?? itemKey(item),
    topicHint,
    text,
    kind: item.kind === "review" ? "review" : "new",
    // Pass-through: only "an array of objects" is enforced, never the inside.
    citations: asObjects(item.citations),
  };
}

function normalizeTopic(topic) {
  return {
    ...topic,
    id: stringOrNull(topic.id) ?? derivedId("t", firstString(topic.title), firstString(topic.area)),
    items: asObjects(topic.items).map(normalizeItem),
  };
}

function normalizeModule(entry) {
  return {
    ...entry,
    id: stringOrNull(entry.id) ?? derivedId("m", firstString(entry.title)),
    topics: asObjects(entry.topics).map(normalizeTopic),
  };
}

/**
 * Normalizes a plan: modules[] -> topics[] -> items[], every id a stable
 * content-derived key when the input carries none, plus the plan-level honesty
 * fields (engine, provenance.research, provenance.unsourcedTopicIds). A plan
 * with missing or garbage provenance is flagged "partial", never silently
 * "complete". NEVER throws.
 */
export function normalizePlan(input) {
  const src = isPlainObject(input) ? input : {};
  const provenance = isPlainObject(src.provenance) ? src.provenance : {};
  return {
    v: STUDY_PLAN_VERSION,
    engine: typeof src.engine === "string" ? src.engine : "",
    provenance: {
      research: provenance.research === "complete" ? "complete" : "partial",
      unsourcedTopicIds: toStringArray(provenance.unsourcedTopicIds),
    },
    modules: asObjects(src.modules).map(normalizeModule),
  };
}

/** True unless the plan explicitly says its research was complete. */
export function isPartialPlan(plan) {
  return plan?.provenance?.research !== "complete";
}

/** The topics a plan flags as having no corroborated evidence (a copy). */
export function unsourcedTopicIds(plan) {
  return toStringArray(plan?.provenance?.unsourcedTopicIds);
}

// --- progress -------------------------------------------------------------

function validGrade(value) {
  return isNonEmptyString(value) || (typeof value === "number" && Number.isFinite(value));
}

// A seen entry is { revealedAt?, grade?, dueAt? }: a plain object whose
// PRESENT fields have the right type. null counts as present-and-wrong, so a
// null that would be forwarded to the merge is refused rather than stored.
function isSeenEntry(entry) {
  return (
    isPlainObject(entry) &&
    (entry.revealedAt === undefined || isNonEmptyString(entry.revealedAt)) &&
    (entry.grade === undefined || validGrade(entry.grade)) &&
    (entry.dueAt === undefined || isNonEmptyString(entry.dueAt))
  );
}

// Only the known, valid fields, with absent ones omitted (so the object
// serializes to exactly what the RPC should merge).
function pickSeenEntry(entry) {
  const out = {};
  if (isNonEmptyString(entry.revealedAt)) out.revealedAt = entry.revealedAt;
  if (validGrade(entry.grade)) out.grade = entry.grade;
  if (isNonEmptyString(entry.dueAt)) out.dueAt = entry.dueAt;
  return out;
}

/**
 * Progress: { v, cursor: { moduleId, topicId, itemId }, seen: { [itemId]:
 * { revealedAt, grade?, dueAt? } }, startedAt, updatedAt }. `seen` stays keyed
 * by itemId at the top level so the single-statement server merge can express
 * a write. NEVER throws.
 */
export function normalizeProgress(input) {
  const src = isPlainObject(input) ? input : {};
  const cursor = isPlainObject(src.cursor) ? src.cursor : {};
  const seen = isPlainObject(src.seen)
    ? Object.fromEntries(
        Object.entries(src.seen)
          .filter(([key, entry]) => key !== "" && isPlainObject(entry))
          .map(([key, entry]) => [key, pickSeenEntry(entry)]),
      )
    : {};
  return {
    v: STUDY_PLAN_VERSION,
    cursor: {
      moduleId: stringOrNull(cursor.moduleId),
      topicId: stringOrNull(cursor.topicId),
      itemId: stringOrNull(cursor.itemId),
    },
    seen,
    startedAt: stringOrNull(src.startedAt),
    updatedAt: stringOrNull(src.updatedAt),
  };
}

/**
 * THE DELTA CONTRACT. Produces the exact { cursor, seenDelta } pair a progress
 * write hands to merge_study_plan_progress. `seenDelta` carries EXACTLY ONE
 * key -- the itemId just revealed or graded -- never the whole seen map. That
 * bound is what keeps two devices non-clobbering. An input with no usable
 * itemId yields an EMPTY seenDelta, which isSingleItemSeenDelta refuses, so a
 * bad call fails closed instead of writing a key named "undefined". Pure: the
 * caller supplies revealedAt.
 */
export function buildProgressDelta(args) {
  const { moduleId, topicId, itemId, revealedAt, grade, dueAt } = isPlainObject(args) ? args : {};
  const cursor = { moduleId: stringOrNull(moduleId), topicId: stringOrNull(topicId), itemId: stringOrNull(itemId) };
  if (cursor.itemId === null) return { cursor, seenDelta: {} };
  return {
    cursor,
    seenDelta: { [cursor.itemId]: pickSeenEntry({ revealedAt, grade, dueAt }) },
  };
}

/**
 * The guard a store or route asserts before the RPC call: true iff the delta
 * has exactly one own key and its value has the seen-entry shape. False for a
 * two-key map (the whole-map clobber), an empty map, and any non-object.
 */
export function isSingleItemSeenDelta(seenDelta) {
  if (!isPlainObject(seenDelta)) return false;
  const keys = Object.keys(seenDelta);
  return keys.length === 1 && keys[0] !== "" && isSeenEntry(seenDelta[keys[0]]);
}
