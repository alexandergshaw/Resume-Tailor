// The meeting copilot's shared contract.
//
// This defines what an "insight" IS, how the same point is recognised across
// repeated reads of a live meeting, and — the part with real teeth — what a
// generated insight is allowed to claim about where it came from.
//
// It is the first module of the copilot to exist, deliberately, and it stays
// pure (no DOM, no React, no network, no framework imports) because three
// separate call sites normalize every insight through these functions before
// it reaches a user: the Gemini-backed insights route, the deterministic
// no-LLM ("embedded") path, and the client that renders the result. If any
// one of those three grew its own copy of "is this attribution allowed" or
// "is this the same point as last time", they would drift, and the drift
// would show up as either false attributions or duplicate insights flooding
// the screen mid-meeting. Routing all three through one module is what makes
// "drift" structurally impossible instead of merely discouraged.

// Closed vocabulary for what kind of thing an insight is. Asserted exactly by
// the contract test — an insight kind is never widened by inference, only by
// deliberately editing this list.
export const INSIGHT_KINDS = ["point", "question", "gap"];

// Closed vocabulary for where an insight's text is claimed to have come from.
// Also asserted exactly. Adding a source kind here is the one direction this
// contract can go wrong in silently (a new kind that skips the downgrade
// logic below), so treat any change to this list as touching the
// attribution rule, not as a harmless enum edit.
export const SOURCE_KINDS = ["page", "attachment", "transcript", "model"];

// Render-boundary labels for the two STRUCTURAL capture streams a meeting can
// have: the user's own mic ("you") and the call's shared audio ("them"). A
// single in-person room mic ("room") has no such split — there is no signal
// telling you who is talking — so it deliberately maps to no label at all
// rather than a guessed one. Keyed by the internal routing values the
// capture layer emits and this repo's session code branches on; the
// translation to user-facing copy happens here, once, at the boundary.
export const MEETING_LABELS = { them: "Others", you: "You", room: "" };

// Ceiling on how many insights one read of the model (or the embedded path)
// may hand the client at once. A live meeting screen that suddenly gains a
// dozen new bullets is not "more helpful", it is unreadable — this exists to
// protect attention, not to save tokens.
export const MAX_INSIGHTS_PER_READ = 8;

const CONFIDENCE_LEVELS = ["high", "medium", "low"];

/**
 * Translate an internal speaker-routing key to display copy. Never invents a
 * label for a value it does not recognise — an unknown speaker degrades to
 * no chip, not to a guessed one or the raw routing string leaking onto the
 * screen.
 */
export function meetingSpeakerLabel(speaker) {
  if (!Object.prototype.hasOwnProperty.call(MEETING_LABELS, speaker)) return "";
  return MEETING_LABELS[speaker];
}

// Collapses text down to the form used both to compare two topics and to
// derive an insight's id: lowercased, outer whitespace trimmed, internal
// runs of whitespace collapsed to one space, and a single run of trailing
// punctuation stripped. This exists because a model asked the same thing
// twice does not repeat itself verbatim — it rephrases trivially, adds a
// trailing period, doubles a space. None of that is a new point, so none of
// it may change the identity we derive from the text.
function normalizeForIdentity(value) {
  if (typeof value !== "string") return "";
  const trimmed = value.trim();
  if (!trimmed) return "";
  return trimmed
    .toLowerCase()
    .replace(/\s+/g, " ")
    .replace(/[.!?,;:]+$/, "");
}

// FNV-1a, 32-bit, rendered as hex. Chosen over `crypto.randomUUID`,
// `Math.random` or a timestamp for the one property that actually matters
// here: it is a pure function of the input bytes. Same normalized text in,
// same id out — in this call, in the next read, in a different process
// entirely — which is exactly what lets the client de-duplicate insights
// across a whole meeting and what lets `knownInsightIds` mean anything when
// sent back to the server. `Math.random`/`Date.now`/`crypto.randomUUID` are
// all disqualified on that property alone (each varies call to call), and
// `Math.random`/`Date.now` are also simply unavailable in some of the
// execution contexts this module runs in.
function fnv1aHex(str) {
  let hash = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    hash ^= str.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16);
}

/**
 * Deterministic, rephrasing-tolerant id for an insight's text. Same text (up
 * to case, surrounding whitespace and trailing punctuation) always yields
 * the same id, across separate reads and separate processes.
 */
export function insightId(text) {
  const normalized = normalizeForIdentity(typeof text === "string" ? text : "");
  return `i_${fnv1aHex(normalized)}`;
}

/**
 * Normalize a raw topic string into `{ text, changed, confidence }`.
 *
 * `changed` is computed HERE, by comparing the normalized current topic
 * against the normalized previous one — it is never taken from the model's
 * own opinion of whether the topic changed. A model asked "did the topic
 * change?" says yes far too often (every rephrase of the same subject reads
 * to it as movement), and the UI uses this flag to decide whether to
 * interrupt the user's attention mid-meeting. Asking the model would turn an
 * attention cue into noise.
 */
export function normalizeTopic(raw, previous, confidence) {
  const text = (() => {
    if (typeof raw !== "string") return "";
    const trimmed = raw.trim();
    if (!trimmed) return "";
    return trimmed.replace(/\s+/g, " ");
  })();

  const currentKey = normalizeForIdentity(raw);
  const previousKey = normalizeForIdentity(previous);
  const changed = currentKey !== "" && currentKey !== previousKey;

  const normalizedConfidence = CONFIDENCE_LEVELS.includes(confidence) ? confidence : "low";

  return { text, changed, confidence: normalizedConfidence };
}

// Applies the attribution downgrade to a single raw `source`. This is THE
// load-bearing rule of the whole module.
//
// A model is handed a bounded set of pages as context for one read (the ones
// in `includedPageIds`). Nothing stops it from citing a page outside that
// set anyway — one it remembers from earlier in the conversation, or one it
// simply invents a plausible-looking id for. If that citation were shown
// as-is, the UI would render "your page X says…" for a page that contributed
// nothing at all to this insight, and the user has no way to tell their own
// notes from the model's invention — which defeats the entire reason a
// source is displayed in the first place: it is a claim of provenance, and
// an unverifiable claim of provenance is worse than no claim.
//
// So: a `page` source is only honoured when its `pageId` is one this read
// actually included. Anything else — an id outside the set, a missing id, an
// unrecognised source kind entirely — downgrades to the model's own claim,
// `{ kind: "model", pageId: null, pageTitle: null }`. The insight's text is
// kept; only the false provenance is stripped, because a mis-attributed
// point can still be worth saying.
//
// The same logic closes the back door of a non-page source smuggling a page
// id through (e.g. `{ kind: "transcript", pageId: "p-1" }`) — that is the
// identical claim in different clothing, so a non-page source NEVER carries
// a pageId or pageTitle, regardless of what the raw value contained.
function normalizeSource(rawSource, includedPageIds) {
  const kind =
    rawSource && SOURCE_KINDS.includes(rawSource.kind) ? rawSource.kind : "model";

  if (kind === "page") {
    const pageId = rawSource.pageId;
    const isIncluded = typeof pageId === "string" && includedPageIds.includes(pageId);
    if (isIncluded) {
      const pageTitle = typeof rawSource.pageTitle === "string" ? rawSource.pageTitle : null;
      return { kind: "page", pageId, pageTitle };
    }
    return { kind: "model", pageId: null, pageTitle: null };
  }

  return { kind, pageId: null, pageTitle: null };
}

/**
 * Validate and normalize a raw list of insights from either generation path
 * (the Gemini route or the deterministic embedded path) into the shape the
 * client is allowed to render.
 *
 * Defensive by design: this runs against live model output during a live
 * meeting, so it must survive any shape without throwing — drop entries with
 * no usable text, drop unrecognised insight kinds rather than guessing one,
 * de-duplicate within this read (first occurrence wins), drop ids the client
 * already has on screen, cap the total, and treat a non-array `raw` (or an
 * array of junk) as an empty read rather than an error.
 */
export function normalizeInsights(raw, options = {}) {
  const includedPageIds = Array.isArray(options.includedPageIds) ? options.includedPageIds : [];
  const knownInsightIds = new Set(
    Array.isArray(options.knownInsightIds) ? options.knownInsightIds : [],
  );
  const cap =
    typeof options.cap === "number" && options.cap >= 0 ? options.cap : MAX_INSIGHTS_PER_READ;

  if (!Array.isArray(raw)) return [];

  const seenInThisRead = new Set();
  const result = [];

  for (const entry of raw) {
    if (!entry || typeof entry !== "object") continue;

    const text = typeof entry.text === "string" ? entry.text.trim() : "";
    if (!text) continue;

    if (!INSIGHT_KINDS.includes(entry.kind)) continue;

    const id = insightId(text);
    if (seenInThisRead.has(id)) continue;
    if (knownInsightIds.has(id)) continue;
    seenInThisRead.add(id);

    const source = normalizeSource(entry.source, includedPageIds);

    result.push({ id, text, kind: entry.kind, source });

    if (result.length >= cap) break;
  }

  return result;
}
