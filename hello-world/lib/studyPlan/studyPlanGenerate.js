// Study-plan GENERATION (N157): the evidence set and the learner's knobs in, a
// persisted plan out. Orchestration only -- every side effect is injected, the
// same stance as studyPlanStore.js, so the whole flow is unit-testable with
// fakes. NEVER THROWS: a failure at any step becomes a result object and a
// persisted `unavailable` row, never a rejection.
//
// FLOW
//   normalizeKnobs -> gatherEvidence (SC-A, reads the already-persisted digest,
//   issues no grounded call) -> one of two producers:
//
//     embedded  buildEmbeddedStudyPlan: deterministic, ZERO model calls. The
//               digest research is split into cards mechanically.
//     gemini    ONE NON-GROUNDED generateContent call. No `tools`, no
//               `googleSearch`, no Interactions API: this call consumes
//               evidence that was already grounded elsewhere, so attaching a
//               tool would spend a second search, bring the grounding-redirect
//               citation problem back, and risk the platform duration limit a
//               grounded search plus a generation cannot fit inside together
//               (rulings R-IP3-21). The timeout rides config.httpOptions, where
//               this transport reads it; a bare second argument is discarded.
//
//   -> shape the model output (WITHOUT assigning any id) -> normalizePlan, which
//   derives the content keys -> compute the status -> writeStudyPlan, EXCEPT
//   that an `unavailable` result is first checked against the stored row (see
//   PRESERVE-LAST-GOOD below).
//
// IDS ARE NEVER ASSIGNED HERE. normalizePlan derives them from content
// (itemKey et al.), so a rebuild that reorders cards leaves every surviving
// key alone and a resume cursor still points at the right card. The only
// identity work this file does is DEDUPING cards that would collide on one key,
// which the schema leaves to the generator.
//
// STATUS (every branch yields a non-empty member of {ready, partial,
// unavailable}; writeStudyPlan silently drops an empty one, which would leave a
// stale status standing on a rebuild):
//
//   gemini,   evidence complete,   >=1 module -> "ready"
//   gemini,   evidence incomplete, >=1 module -> "partial"
//   embedded,                      >=1 module -> "partial" (it did no synthesis,
//                                                 so it never claims "ready")
//   anything else (model reject, unparseable reply, no module, no evidence on
//   the embedded path)                         -> "unavailable"
//
// PRESERVE-LAST-GOOD (PD-1, design r2 section 4.3). A failed attempt writes its
// row, with an empty-but-valid plan, ONLY when the stored row is positively
// known to hold no good plan (no row, an `unavailable` row, or zero modules).
// A good stored plan, or a stored row the injected `readExistingPlan` seam could
// not confirm (a read error, a rejecting seam, an absent seam), is left alone:
// the write is skipped and the result says so (`preserved`). The guard runs only
// for a computed `unavailable`; a `ready` or `partial` result never reads and
// always writes. A browser cannot make this decision, because by the time any
// response arrives the row is already overwritten.

import { gatherEvidence } from "./studyPlanEvidence.js";
import { STUDY_PLAN_SYSTEM, buildStudyPlanUserTurn } from "./studyPlanPrompt.js";
import { itemKey, normalizeKnobs, normalizePlan } from "./studyPlanSchema.js";
import { writeStudyPlan } from "./studyPlanStore.js";

/** Per-attempt model timeout. Passed as config.httpOptions.timeout. */
const STUDY_PLAN_GENERATION_TIMEOUT_MS = 60_000;

/** Bound on the cards the embedded builder will emit, so one very long digest cannot bloat the row. */
const EMBEDDED_MAX_ITEMS = 60;

const EMBEDDED_MODULE_TITLE = "Company and role research";
const EMBEDDED_FALLBACK_TOPIC = "Research notes";

const NO_TEXT_ERROR = "The model returned no text.";
const NOT_JSON_ERROR = "The model's reply was not valid JSON.";
const NOT_OBJECT_ERROR = "The model's reply was not a plan object.";
const NO_CARDS_ERROR = "The plan contained no usable study cards.";
const CALL_FAILED_ERROR = "The model call did not complete.";

function isObject(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function objects(value) {
  return Array.isArray(value) ? value.filter(isObject) : [];
}

function str(value) {
  return typeof value === "string" ? value.trim() : "";
}

function errorText(err, fallback) {
  return typeof err?.message === "string" && err.message !== "" ? err.message : fallback;
}

/**
 * Reads the model's reply as a plan object. Mirrors the interview-prep pack
 * parser: total (it never throws), and a non-object or an array is refused
 * rather than coerced. The object is returned RAW; shaping and normalizing
 * happen after.
 *
 * @param {{ text?: unknown } | null | undefined} response
 * @returns {{ ok: true, plan: object } | { ok: false, error: string }}
 */
export function parseGeneratedPlan(response) {
  const raw = response?.text;
  if (typeof raw !== "string" || raw.trim() === "") return { ok: false, error: NO_TEXT_ERROR };
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { ok: false, error: NOT_JSON_ERROR };
  }
  if (!isObject(parsed)) return { ok: false, error: NOT_OBJECT_ERROR };
  return { ok: true, plan: parsed };
}

// --- shaping a model reply ---------------------------------------------------

// Every citation URL the evidence carries. A model-supplied citation survives
// only if it is one of these, verbatim: the prompt asks the model not to invent
// a URL, and this is what holds when it does anyway.
function evidenceUrls(evidence) {
  const urls = new Set();
  for (const item of objects(evidence?.items)) {
    for (const citation of objects(item.citations)) {
      if (typeof citation.url === "string") urls.add(citation.url);
    }
  }
  return urls;
}

function shapeCitations(raw, allowed) {
  const out = [];
  const seen = new Set();
  for (const entry of Array.isArray(raw) ? raw : []) {
    const url = typeof entry === "string" ? entry : entry?.url;
    if (typeof url !== "string" || !allowed.has(url) || seen.has(url)) continue;
    seen.add(url);
    out.push({ url });
  }
  return out;
}

// One card, or null when it has no text. No `id` is set: normalizePlan derives
// it from topicHint + text.
function shapeItem(raw, allowed) {
  const text = str(raw.text);
  if (text === "") return null;
  const citations = shapeCitations(raw.citations, allowed);
  const item = {
    text,
    topicHint: str(raw.topicHint),
    kind: raw.kind === "review" ? "review" : "new",
    citations,
    sourced: citations.length > 0,
  };
  const reveal = str(raw.reveal);
  if (reveal !== "") item.reveal = reveal;
  return item;
}

// modules -> topics -> items, pruning anything empty so "has a module" means
// "has a module with a card". `seenKeys` is shared across the whole plan: two
// cards with one content key would collide on every resume address.
function shapeModules(rawModules, allowed) {
  const seenKeys = new Set();
  const modules = [];
  for (const rawModule of objects(rawModules)) {
    const topics = [];
    for (const rawTopic of objects(rawModule.topics)) {
      const items = [];
      for (const rawItem of objects(rawTopic.items)) {
        const item = shapeItem(rawItem, allowed);
        if (!item) continue;
        const key = itemKey(item);
        if (seenKeys.has(key)) continue;
        seenKeys.add(key);
        items.push(item);
      }
      if (items.length > 0) {
        // A topic id is derived from its title and area, so an untitled topic
        // borrows a CONTENT-derived title (never its position) or every
        // untitled topic in the plan would share one id.
        const title = str(rawTopic.title) || str(rawTopic.area) || items[0].topicHint || items[0].text.slice(0, 60);
        topics.push({ title, area: str(rawTopic.area), weak: rawTopic.weak === true, items });
      }
    }
    if (topics.length > 0) modules.push({ title: str(rawModule.title) || topics[0].title, topics });
  }
  return modules;
}

// The plan object for a set of shaped modules: engine, the research provenance
// taken from the EVIDENCE (never from anything the model claimed), and the
// topics none of whose cards carries a surviving citation. Normalized twice
// because the unsourced topic ids are the schema's own derived keys.
function assemblePlan({ engine, evidence, modules }) {
  const research = evidence?.complete === true ? "complete" : "partial";
  const base = normalizePlan({ engine, provenance: { research }, modules });
  const unsourcedTopicIds = base.modules
    .flatMap((m) => m.topics)
    .filter((t) => t.items.every((i) => i.citations.length === 0))
    .map((t) => t.id);
  return normalizePlan({ ...base, provenance: { research, unsourcedTopicIds } });
}

// --- the embedded (deterministic) producer -----------------------------------

const HEADING_RE = /^#{1,6}\s+(.*)$/;
const LIST_MARKER_RE = /^\s*(?:[-*+]|\d+[.)])\s+/;

// Markdown -> [{ title, lines }]: a section per heading, a line per non-empty
// paragraph or list entry. Lines with no letter or digit (rules, fences) drop.
function splitSections(markdown, fallbackTitle) {
  const sections = [];
  let current = { title: fallbackTitle, lines: [] };
  const flush = () => {
    if (current.lines.length > 0) sections.push(current);
  };
  for (const rawLine of String(markdown).split(/\r?\n/)) {
    const heading = HEADING_RE.exec(rawLine.trim());
    if (heading) {
      flush();
      current = { title: heading[1].replace(/[*_`#]/g, "").trim() || fallbackTitle, lines: [] };
      continue;
    }
    const line = rawLine.replace(LIST_MARKER_RE, "").trim();
    if (/[\p{L}\p{N}]/u.test(line)) current.lines.push(line);
  }
  flush();
  return sections;
}

// Spreads "review" evenly through the cards so the plan matches the ratio
// without bunching: card i is a review when the running review quota crosses a
// whole number. Pure in (index, ratio); ratio 1 is all new, ratio 0 all review.
function kindAt(index, newReviewRatio) {
  const reviewShare = 1 - newReviewRatio;
  return Math.floor((index + 1) * reviewShare + 1e-9) > Math.floor(index * reviewShare + 1e-9) ? "review" : "new";
}

/**
 * The offline plan: no model, no network. One module; one topic per section of
 * each evidence item's text; one card per line. Honours newReviewRatio and
 * topicScope.excludedAreas; weak-topic weighting needs judgement and is not
 * applied. Cards inherit the citations of the evidence item they came from and
 * are marked sourced only when that item was.
 *
 * A plain function over (evidence, knobs) so later knobs can extend it. Returns
 * a normalized plan, with zero modules when the evidence carries nothing usable.
 *
 * @param {object} evidence an EvidenceSet (studyPlanEvidence.js)
 * @param {object} [knobs]
 */
export function buildEmbeddedStudyPlan(evidence, knobs) {
  const k = normalizeKnobs(knobs);
  const excluded = k.topicScope.excludedAreas.map((a) => a.trim().toLowerCase()).filter((a) => a !== "");
  const seenKeys = new Set();
  const topics = [];
  let emitted = 0;

  for (const entry of objects(evidence?.items)) {
    // The item's own citations, filtered through the same shaper as a model's.
    const citations = shapeCitations(entry.citations, evidenceUrls({ items: [entry] }));
    const fallbackTitle = str(entry.topicHint) || EMBEDDED_FALLBACK_TOPIC;
    for (const sectionEntry of splitSections(typeof entry.text === "string" ? entry.text : "", fallbackTitle)) {
      if (excluded.some((term) => sectionEntry.title.toLowerCase().includes(term))) continue;
      const items = [];
      for (const line of sectionEntry.lines) {
        if (emitted >= EMBEDDED_MAX_ITEMS) break;
        const item = {
          text: line,
          topicHint: sectionEntry.title,
          kind: kindAt(emitted, k.newReviewRatio),
          citations,
          sourced: entry.sourced === true && citations.length > 0,
        };
        const key = itemKey(item);
        if (seenKeys.has(key)) continue;
        seenKeys.add(key);
        items.push(item);
        emitted += 1;
      }
      if (items.length > 0) topics.push({ title: sectionEntry.title, area: sectionEntry.title, weak: false, items });
    }
  }

  const modules = topics.length > 0 ? [{ title: EMBEDDED_MODULE_TITLE, topics }] : [];
  return assemblePlan({ engine: "embedded", evidence, modules });
}

// --- orchestration -------------------------------------------------------------

function statusFor({ engine, evidence, plan }) {
  if (plan.modules.length === 0) return "unavailable";
  if (engine === "embedded") return "partial";
  return evidence?.complete === true ? "ready" : "partial";
}

// The producers return { plan, error }. A null plan means "nothing came back";
// the caller substitutes an empty-but-valid one.
async function produce({ engine, evidence, knobs, generateContent, model, company, role }) {
  if (engine === "embedded") {
    const plan = buildEmbeddedStudyPlan(evidence, knobs);
    return { plan, error: plan.modules.length > 0 ? null : NO_CARDS_ERROR };
  }

  let response;
  try {
    response = await generateContent({
      model,
      contents: buildStudyPlanUserTurn({ evidence, knobs, company, role }),
      config: {
        systemInstruction: STUDY_PLAN_SYSTEM,
        responseMimeType: "application/json",
        httpOptions: { timeout: STUDY_PLAN_GENERATION_TIMEOUT_MS },
      },
    });
  } catch (err) {
    return { plan: null, error: errorText(err, CALL_FAILED_ERROR) };
  }

  const parsed = parseGeneratedPlan(response);
  if (!parsed.ok) return { plan: null, error: parsed.error };
  const modules = shapeModules(parsed.plan.modules, evidenceUrls(evidence));
  const plan = assemblePlan({ engine, evidence, modules });
  return { plan, error: plan.modules.length > 0 ? null : NO_CARDS_ERROR };
}

// --- preserve-last-good guard --------------------------------------------------

// A stored record (the shape readStudyPlan returns) that holds a plan worth
// protecting: a clean read of a ready or partial row with at least one module.
function hasGoodPlan(existing) {
  return (
    isObject(existing) &&
    existing.error === null &&
    (existing.status === "ready" || existing.status === "partial") &&
    isObject(existing.plan) &&
    Array.isArray(existing.plan.modules) &&
    existing.plan.modules.length >= 1
  );
}

// The stored record, or null when it cannot be had. readStudyPlan never throws,
// but the seam is injected, so a rejection or an absent seam must not escape.
async function readExisting(readExistingPlan, ids) {
  if (typeof readExistingPlan !== "function") return null;
  try {
    return await readExistingPlan(ids);
  } catch {
    return null;
  }
}

// Why an `unavailable` write must be withheld, or null when it may proceed.
// PRESERVE ON UNCERTAINTY: the write proceeds only on a POSITIVE absence (a clean
// read, `error === null`, that finds no good plan). A read error, a non-object
// record and a missing seam all leave the stored row alone.
function preserveReason(existing) {
  if (hasGoodPlan(existing)) return "good-plan";
  if (isObject(existing) && existing.error === null) return null;
  return "unconfirmed";
}

/**
 * Builds and persists the study plan for one application.
 *
 * `engine` is already resolved by the route ("embedded" or anything else, which
 * is the model path). `generateContent`, `readDigest` and `readExistingPlan`
 * are injected; `readExistingPlan` is ({ applicationId, userId }) =>
 * Promise<{ status, plan, error }>, the shape readStudyPlan returns. `supabase`
 * goes straight to writeStudyPlan. The row is written on every outcome EXCEPT a computed
 * `unavailable` over a stored plan that is good or unconfirmed (see
 * PRESERVE-LAST-GOOD above), which returns `written: false, preserved: true`.
 * Every other result carries `preserved: false`.
 *
 * @returns {Promise<{ status: string, plan: object, evidence: object, written: boolean, preserved: boolean, preservedReason?: "good-plan" | "unconfirmed", error: string | null }>}
 */
export async function generateStudyPlan(args) {
  const a = isObject(args) ? args : {};
  const engine = a.engine === "embedded" ? "embedded" : "gemini";
  const knobs = normalizeKnobs(a.knobs);
  const evidence = await gatherEvidence(
    { readDigest: a.readDigest },
    { applicationId: a.applicationId, userId: a.userId, postingFingerprint: a.postingFingerprint },
  );

  let made;
  try {
    made = await produce({
      engine,
      evidence,
      knobs,
      generateContent: a.generateContent,
      model: a.model,
      company: a.company,
      role: a.role,
    });
  } catch (err) {
    made = { plan: null, error: errorText(err, CALL_FAILED_ERROR) };
  }

  const plan = made.plan ?? assemblePlan({ engine, evidence, modules: [] });
  const status = statusFor({ engine, evidence, plan });

  // Only an `unavailable` result can destroy a good plan, so only it consults
  // the stored row; a successful rebuild pays no extra read.
  if (status === "unavailable") {
    const existing = await readExisting(a.readExistingPlan, { applicationId: a.applicationId, userId: a.userId });
    const preservedReason = preserveReason(existing);
    if (preservedReason !== null) {
      return { status, plan, evidence, written: false, preserved: true, preservedReason, error: made.error };
    }
  }

  const write = await writeStudyPlan(a.supabase, {
    applicationId: a.applicationId,
    userId: a.userId,
    status,
    plan,
    knobs,
    engine,
    postingFingerprint: a.postingFingerprint,
    researchedAt: evidence.researchedAt,
    cachedResearch: evidence,
  });

  return {
    status,
    plan,
    evidence,
    written: write.written === true,
    preserved: false,
    error: write.written === true ? made.error : write.error || made.error,
  };
}
