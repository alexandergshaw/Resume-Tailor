// Pure customization model for the study-plan knobs (N157 SC-D wave D-a): the
// area option list, the per-area Focus / Skip / Include state, the days and
// new-vs-review setters, the "Focus on these" suggestion, the per-engine
// honesty selector and the closed-panel summary. No React, no IO, no clock.
// NEVER throws: null or garbage input degrades to the schema defaults.
//
// THE PROPERTIES THIS FILE EXISTS TO HOLD:
//
//  * Every knob object this module returns is built by the REAL
//    normalizeKnobs, so normalizeKnobs(out) deep-equals out and the key set is
//    exactly the four the schema owns. A setter never emits a field the
//    normalizer would drop (the controls would look saved and persist
//    nothing), and never hands the normalizer a value it would silently
//    rewrite (a days value of 0 or -3 or 91 would show one number while the
//    stored knob became 7).
//
//  * The returned object is always a FRESH clone. DEFAULT_KNOBS is frozen and
//    is never returned, aliased or mutated.
//
//  * `weakTopicIds` carries AREA LABELS (free text, the same vocabulary as
//    `topicScope.excludedAreas`), never topic ids. A topic id is a
//    content-derived hash the model cannot read and that moves when a rebuild
//    re-titles a topic. The key name stays (renaming it is a schema migration
//    for every stored row); the name/content mismatch is deliberate.
//
//  * One state per area. Focus and Skip are mutually exclusive by
//    construction (setAreaState removes the area from BOTH lists before adding
//    it to the target), and Skip wins when a foreign write left a label in
//    both. Labels compare trimmed and case-insensitively.
//
// The seed area list for a build with no plan yet (DIGEST_SECTIONS) is NOT
// imported here: the caller passes it in as `seedAreas`.

import { normalizeKnobs } from "./studyPlanSchema.js";
import { GRADE, flattenPlan } from "./studyWalkthroughModel.js";
import { STUDY_COPY } from "./studyPlanCopy.js";

// Retunable, and every test pins the CONSTANT, never a literal. The values are
// guesses for the owner to tune: the schema bounds none of them.
export const MIN_PLAN_DAYS = 1;
export const MAX_PLAN_DAYS = 90;
export const MAX_AREA_OPTIONS = 24;
export const MAX_AREA_LABEL = 80;

/** The three new-vs-review presets. Ids are stable; values are valid ratios. */
export const RATIO_PRESETS = Object.freeze([
  Object.freeze({ id: "mostly-new", value: 0.75 }),
  Object.freeze({ id: "even", value: 0.5 }),
  Object.freeze({ id: "mostly-review", value: 0.25 }),
]);

/** The one state an area is in. INCLUDE (the default) is in neither list. */
export const AREA_STATE = Object.freeze({ INCLUDE: "include", FOCUS: "focus", SKIP: "skip" });

const MIX_LABEL = Object.freeze({
  "mostly-new": STUDY_COPY.knobs.mixMostlyNew,
  even: STUDY_COPY.knobs.mixEven,
  "mostly-review": STUDY_COPY.knobs.mixMostlyReview,
});

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

// A label: a trimmed string cut to MAX_AREA_LABEL, so a model-supplied
// 400-character area cannot wreck the column or the request. Anything that is
// not a string has no label.
function labelOf(value) {
  if (typeof value !== "string") return "";
  return value.trim().slice(0, MAX_AREA_LABEL).trimEnd();
}

// The comparison key of a label: trimmed, cut, lower-cased.
function keyOf(value) {
  return labelOf(value).toLowerCase();
}

function keySet(list) {
  return new Set(asArray(list).map(keyOf).filter((key) => key !== ""));
}

// Every topic of a plan, in module -> topic order.
function topicsOf(plan) {
  const out = [];
  for (const entry of asArray(plan?.modules)) {
    if (!isObject(entry)) continue;
    for (const topic of asArray(entry.topics)) {
      if (isObject(topic)) out.push(topic);
    }
  }
  return out;
}

/**
 * The area LABEL of a plan topic: its trimmed `area`, else its trimmed
 * `title`, else "". Never the topic id.
 */
export function areaOf(topic) {
  return labelOf(topic?.area) || labelOf(topic?.title);
}

/**
 * The areas the controls list: the distinct areas of the CURRENT plan (first
 * casing, first-seen order), then every label currently selected (Focus or
 * Skip) that is not already listed, so a selection can always be undone even
 * after a rebuild dropped its topic. With no plan area at all (no plan yet),
 * `seedAreas` comes first. At most MAX_AREA_OPTIONS rows are listed, but a
 * selected label past that window is never dropped.
 */
export function areaOptions({ plan, knobs, seedAreas } = {}) {
  const norm = normalizeKnobs(knobs);
  const picked = [...norm.weakTopicIds, ...norm.topicScope.excludedAreas];
  const selected = keySet(picked);
  const seen = new Set();
  const labels = [];
  const add = (label) => {
    const key = label.toLowerCase();
    if (label === "" || seen.has(key)) return;
    seen.add(key);
    labels.push(label);
  };
  for (const topic of topicsOf(plan)) add(areaOf(topic));
  if (labels.length === 0) {
    for (const seed of asArray(seedAreas)) add(labelOf(seed));
  }
  for (const label of picked) add(labelOf(label));
  return labels.filter((label, index) => index < MAX_AREA_OPTIONS || selected.has(label.toLowerCase()));
}

/** Skip wins over Focus when a label is in both lists; case-insensitive. */
export function areaState(knobs, area) {
  const key = keyOf(area);
  const norm = normalizeKnobs(knobs);
  if (keySet(norm.topicScope.excludedAreas).has(key)) return AREA_STATE.SKIP;
  if (keySet(norm.weakTopicIds).has(key)) return AREA_STATE.FOCUS;
  return AREA_STATE.INCLUDE;
}

/**
 * False iff `optionLabels` is non-empty and every one of them is skipped (a
 * plan with every area left out cannot be built). True for an empty list.
 */
export function isBuildableKnobs(knobs, optionLabels) {
  const options = keySet(optionLabels);
  if (options.size === 0) return true;
  const skipped = keySet(normalizeKnobs(knobs).topicScope.excludedAreas);
  return [...options].some((key) => !skipped.has(key));
}

/**
 * Puts `area` in one state: removes it from BOTH lists, then adds it to the
 * target (INCLUDE leaves it in neither). Returns { knobs, ok }. Refuses, with
 * ok:false and the knobs unchanged, to Skip the last non-skipped option of
 * `optionLabels`, to act on a blank label, and to apply an unknown state.
 */
export function setAreaState(knobs, area, state, optionLabels) {
  const base = normalizeKnobs(knobs);
  const label = labelOf(area);
  if (label === "") return { knobs: base, ok: false };
  const key = label.toLowerCase();
  const without = (list) => list.filter((entry) => keyOf(entry) !== key);
  const weak = without(base.weakTopicIds);
  const excluded = without(base.topicScope.excludedAreas);
  if (state === AREA_STATE.FOCUS) weak.push(label);
  else if (state === AREA_STATE.SKIP) excluded.push(label);
  else if (state !== AREA_STATE.INCLUDE) return { knobs: base, ok: false };
  const next = normalizeKnobs({ ...base, weakTopicIds: weak, topicScope: { excludedAreas: excluded } });
  if (state === AREA_STATE.SKIP && !isBuildableKnobs(next, optionLabels)) return { knobs: base, ok: false };
  return { knobs: next, ok: true };
}

/** Sets the new-vs-review ratio (clamped by the schema); a non-number changes nothing. */
export function setNewReviewRatio(knobs, value) {
  const base = normalizeKnobs(knobs);
  if (typeof value !== "number" || !Number.isFinite(value)) return base;
  return normalizeKnobs({ ...base, newReviewRatio: value });
}

/** The id of the preset whose value EQUALS the ratio exactly, else null. */
export function ratioPresetId(knobs) {
  const ratio = normalizeKnobs(knobs).newReviewRatio;
  return RATIO_PRESETS.find((preset) => preset.value === ratio)?.id ?? null;
}

/**
 * Commits a days-until value typed as a string or number. Only a whole number
 * of digits from MIN_PLAN_DAYS to MAX_PLAN_DAYS commits ({ knobs, ok: true });
 * anything else (empty, 0, negative, decimal, text, over the cap, NaN, null)
 * returns { knobs, ok: false } with the knobs unchanged, so the schema never
 * silently rewrites a bad value to its default.
 */
export function setDaysUntil(knobs, raw) {
  const base = normalizeKnobs(knobs);
  const text = typeof raw === "string" || typeof raw === "number" ? String(raw).trim() : "";
  if (!/^\d+$/.test(text)) return { knobs: base, ok: false };
  const days = Number(text);
  if (days < MIN_PLAN_DAYS || days > MAX_PLAN_DAYS) return { knobs: base, ok: false };
  return { knobs: normalizeKnobs({ ...base, pace: { daysUntil: days } }), ok: true };
}

function sameKeys(a, b) {
  const left = keySet(a);
  const right = keySet(b);
  return left.size === right.size && [...left].every((key) => right.has(key));
}

/**
 * Whether two knob objects mean the same thing: the arrays compare without
 * regard to order or label case; the ratio and the days compare exactly.
 */
export function knobsEqual(a, b) {
  const left = normalizeKnobs(a);
  const right = normalizeKnobs(b);
  return (
    left.newReviewRatio === right.newReviewRatio &&
    left.pace.daysUntil === right.pace.daysUntil &&
    sameKeys(left.weakTopicIds, right.weakTopicIds) &&
    sameKeys(left.topicScope.excludedAreas, right.topicScope.excludedAreas)
  );
}

/**
 * The "Focus on these" suggestion: [{ area, missed }] counting ONLY cards of
 * the CURRENT plan (flattenPlan ids) graded GRADE.AGAIN, grouped by the topic's
 * area LABEL, most missed first with ties in plan order. Orphan `seen` keys,
 * got-it grades and reveal-only entries count for nothing; no plan or no
 * grades gives [].
 */
export function suggestFocusAreas({ plan, seen } = {}) {
  const areaByTopic = new Map();
  const groups = new Map();
  for (const topic of topicsOf(plan)) {
    const area = areaOf(topic);
    if (area === "") continue;
    if (typeof topic.id === "string" && !areaByTopic.has(topic.id)) areaByTopic.set(topic.id, area);
    if (!groups.has(area.toLowerCase())) groups.set(area.toLowerCase(), { area, missed: 0 });
  }
  for (const card of flattenPlan(plan)) {
    if (seen?.[card.id]?.grade !== GRADE.AGAIN) continue;
    const area = areaByTopic.get(card.topicId);
    if (area !== undefined) groups.get(area.toLowerCase()).missed += 1;
  }
  return [...groups.values()].filter((group) => group.missed > 0).sort((a, b) => b.missed - a.missed);
}

/**
 * Which knobs the engine actually honours: the embedded engine uses the mix
 * and the skipped areas only; every other value (gemini, external, unknown)
 * reads as Gemini, the over-state direction the notices already take.
 */
export function knobEffects(engine) {
  const embedded = engine === "embedded";
  return { newReviewRatio: true, weakAreas: !embedded, pace: !embedded, topicScope: true };
}

/**
 * The closed-panel one-liner, "<days> days. <mix>. <areas>." (defaults read
 * "7 days. Even mix. All areas."). It describes the settings, not the engine,
 * so it takes no engine argument: the per-engine caption lives in the open
 * panel. A single day reads "1 day". Focus counts exclude skipped labels.
 */
export function summarizeKnobs(knobs) {
  const copy = STUDY_COPY.knobs;
  const norm = normalizeKnobs(knobs);
  const days = norm.pace.daysUntil;
  const daysText = days === 1 ? copy.summaryOneDay : copy.summaryDays.replace("<n>", () => String(days));
  const presetId = ratioPresetId(norm);
  const mixText = presetId === null ? copy.summaryCustomMix : MIX_LABEL[presetId];
  const skipped = keySet(norm.topicScope.excludedAreas);
  const focus = [...keySet(norm.weakTopicIds)].filter((key) => !skipped.has(key)).length;
  const areasText =
    focus === 0 && skipped.size === 0
      ? copy.summaryAllAreas
      : copy.summaryAreas.replace("<focus>", () => String(focus)).replace("<skipped>", () => String(skipped.size));
  return `${daysText}. ${mixText}. ${areasText}.`;
}
