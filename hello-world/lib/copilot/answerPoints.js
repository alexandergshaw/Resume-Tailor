// Shared sanitiser for a drafted answer's bullet points, used by both
// CopilotDashboard.js (CurrentAnswerPanel and PredictedAnswerPanel) and
// practice mode's SampleAnswer.js. Both call sites guard the exact same
// failure: a `points` array carrying a blank, whitespace-only, or otherwise
// malformed entry rendering as an empty `<li>` that a candidate cannot tell
// apart from a real bullet. The most concrete way that reaches the render
// layer is lib/copilot/sampleAnswerState.js's cachedSampleAnswerFor, which
// returns its cache entry's `points` array UNFILTERED on a hit — by design
// (see that function's own doc comment) — because the cleaning is meant to
// happen here, at the render boundary, not in the cache.
//
// This sanitiser used to be two separate module-local copies —
// CopilotDashboard.js's `cleanAnswerPoints` and SampleAnswer.js's
// `cleanPoints` — and they had already drifted from each other:
// SampleAnswer.js's copy also `.trim()`ed each surviving entry; the
// dashboard's copy did not. Two copies of the same guard is exactly how they
// drift apart unnoticed; this module exists so there is exactly one copy
// left to drift.
//
// Deliberately no React, no MUI, no DOM. This repo's vitest config
// (vitest.config.js) runs with `environment: "node"` — no jsdom, no
// testing-library anywhere in the suite — so a sanitiser defined inside a
// component module is permanently unreachable from a test. Pulling it out
// into its own pure module is what makes it testable at all.
//
// Trimming: chosen deliberately, not inherited by accident from whichever
// copy happened to be ported first. A surviving entry that keeps its
// leading/trailing whitespace renders with a ragged indent inside the `<ul>`
// both call sites build, which is a real (if minor) rendering defect the
// dashboard's un-trimmed copy was previously letting through. Trimming here
// is a small, intentional behaviour change for the dashboard's two panels —
// see the callers for confirmation this is safe.

import { STAR_LABEL_RE } from "./answerLocal.js";
import { pointWordCount } from "./pointLength.js";

export function cleanAnswerPoints(points) {
  return (Array.isArray(points) ? points : [])
    .filter((p) => typeof p === "string" && p.trim())
    .map((p) => p.trim());
}

// AC-K1.1 / AC-L1: what a drafted answer actually RENDERS. This used to be
// answerBullets(cues, points), which returned the CUES ALONE — the few-word
// prompts from lib/copilot/answerCues.js — with the full `points` sentences
// used only as a fallback when there were no cues at all. That was the
// reported bug: a three-point answer rendered in full as
//
//   Product Curriculum Lead / Tech covered: SQL, APIs / Familiar with platforms
//
// which are the CUES. The complete sentences they head were drafted by the
// model, cached, and derived into `answer` (deriveAnswerFromPoints,
// answerLocal.js) — and then never shown to anyone. The cue is a glanceable
// head, read in the two seconds between hearing a question and starting to
// talk; the point behind it is the actual substance a candidate can speak
// from. Neither one replaces the other, so a render needs both, not a
// choice between them.
//
// `points` is the source of truth for how many lines there are: a point with
// nothing behind it isn't a line worth showing, but a cue with no point to
// sit in front of makes no sense either (a cue for WHAT?), so the cleaned
// `points` array alone decides the output length, and cues are attached to
// it — never the other way round.
//
// Cues pair with points POSITIONALLY — cues[i] is presumed to head points[i]
// — and that presumption is trusted only when the two arrays are the exact
// same length. This is the same all-or-nothing rule resolveCues
// (lib/copilot/answerCues.js) already applies to model-supplied cues, and for
// the same reason: a cue sitting against the wrong beat sends a candidate
// down the wrong line of their own answer, which reads as more broken than a
// beat with no cue at all. So any count mismatch — including the "a draft
// cached before cues existed" case, where cues is empty or absent entirely —
// drops every cue and falls back to the point's full sentence alone. That is
// a worse read than a cue would have been, but a correct one; showing
// nothing would look like the draft had failed.
//
// The length check is against the RAW cues array (type-filtered, trimmed —
// see the local `rawCues` below), never cleanAnswerPoints(cues). cues[i]
// being "" is not malformed input the way an empty POINT is: deriveCues and
// resolveCues (answerCues.js) deliberately emit "" at position i for a point
// too terse to shorten, precisely so that one absence stays local to line i
// instead of shrinking the array and knocking every subsequent cue out of
// alignment with its point. Running cleanAnswerPoints(cues) here — which
// drops blank entries the same way it drops blank points — would strip that
// placeholder back out, shift the count, and reproduce the exact
// whole-draft-loses-its-cues defect this module exists to prevent. A blank
// entry means "no cue for this line"; that line renders its sentence alone,
// which is already what an empty `cue` does below.
//
// A STAR label ("Situation:", "Task:", "Action:", "Result:") is carried
// exactly once per line, on `label`, so the UI never has to decide which of
// two copies to render. STAR_LABEL_RE is imported rather than re-declared
// here for the same reason answerCues.js imports it instead of copying it:
// a second copy of the pattern the prompts actually emit is free to drift
// from the first.
//
// A cue is dropped back to "" — falling through to the point alone for that
// one line — when, after its own label is stripped, it is empty, when it
// reads as the point itself modulo case and trailing punctuation, or when it
// is not strictly shorter (by word count) than the point it heads. A model
// that hands back the sentence as its own "cue" must not produce "X — X" on
// screen; that is worse than showing X once.
//
// `pageSources` is the THIRD positional array (ARCH §3.5 + §7.5): which
// knowledge-base page, if any, each rendered line came from
// (lib/copilot/pageCitations.js's resolvePageSources return value). It pairs
// with the CLEANED points exactly the way `cues` already does — positionally,
// all-or-nothing, resolved inside the same `.map` against the same `i`,
// BEFORE the trailing `.filter` drops label-only points — because a page
// citation against the wrong beat is worse than a cue against the wrong one:
// it attributes a claim to a project that did not produce it, and the
// candidate says so out loud. The comment on that ordering above (cues) now
// covers both positional arrays; this is not a second copy of it.
//
// Each entry is shape-validated, not passed through: it becomes a
// `pageSource` only when it is a non-null object carrying a non-empty string
// `id` AND a non-empty string `title` — both halves of the shape a citation
// is rendered from (ARCH §7.5) — `pageSources[i] ?? null` is not enough, because a stray
// number or a malformed object is exactly the kind of raw-corruption input
// the cue filter two paragraphs up already guards against on its own array.
// Every existing two-argument call site keeps working unchanged: an absent
// `pageSources` never satisfies the length gate, so every line's
// `pageSource` is simply `null`.
//
// `emphasis` — `{ start, end }` or `null` — is the FOURTH field, and it is
// what closes the duplication this module's cue rules did not have a rule for.
// resolveLineCue below already drops a cue IDENTICAL to its point and one no
// shorter than it; it had no rule for a cue that is a verbatim FRAGMENT of its
// point, which is the case that actually occurs — measured over the whole
// embedded corpus, 3,137 of 3,137 cued lines carry their cue's tokens as a
// contiguous run inside their own point, and ZERO cues anywhere add a word the
// point does not already contain. Every cued line therefore renders its own
// words twice, which is where the long rendered lines came from.
//
// So a cue whose normalised tokens ARE such a run is dropped, and the run's
// position is reported instead: `emphasis` carries CHARACTER OFFSETS into
// `point` (not into the raw point, which still carries its STAR label)
// delimiting the run TIGHTLY — from the first character of its first token to
// the last character of its last. Tight rather than word-wise because widening
// to whole whitespace words drags the punctuation that follows the run into
// the emphasis: a bolded trailing comma on 394 lines and a bolded trailing
// colon on 30 more.
//
// `cue` and `emphasis` are MUTUALLY EXCLUSIVE by construction — there is never
// more than one thing for the render layer to emphasise. A genuinely
// paraphrasing cue (which is what the Gemini path supplies) has no run to
// locate, keeps its `cue`, and renders exactly as it does today.
//
// A run equal to the WHOLE point is not emphasis, it is the identity case
// wearing different punctuation ("Cut CI time in-half" against "Cut CI time in
// half" — four whitespace words against five, so the length rule lets it
// through while the token run covers everything). That drops the cue with NO
// span rather than rendering an entire bolded line.
export function answerLines(cues, points, pageSources = []) {
  const cleanPoints = cleanAnswerPoints(points);
  if (!cleanPoints.length) return [];

  // Deliberately NOT cleanAnswerPoints(cues) — see the doc comment above.
  // Only a non-string entry (a stray number, `null`, an object — the kind of
  // thing that shows up as raw API/cache corruption, never something
  // deriveCues/resolveCues themselves produce) is dropped here; a blank
  // string is left exactly where it is, trimmed but present, so it still
  // occupies its own index and the length comparison below sees it.
  const rawCues = (Array.isArray(cues) ? cues : [])
    .filter((c) => typeof c === "string")
    .map((c) => c.trim());
  const paired = rawCues.length === cleanPoints.length;

  const rawPageSources = Array.isArray(pageSources) ? pageSources : [];
  const pageSourcesPaired = rawPageSources.length === cleanPoints.length;

  // A point that is nothing but its own STAR label ("Situation:" with no
  // sentence after it) survives cleanAnswerPoints above — it isn't blank —
  // and only turns up empty once its label is stripped off below, one step
  // later than cleaning. A label with nothing behind it is a bulleted line
  // with a caption and no content, which is worse than not rendering that
  // line at all — the same call cleanAnswerPoints already makes for a point
  // that is blank outright, just made here, one step later.
  //
  // The `.filter` below that drops such lines runs AFTER `.map`, and that
  // order is load-bearing, not incidental: cue pairing is resolved inside
  // the map, against `i` — the index into the cleaned `cleanPoints`/
  // `rawCues` arrays, decided before any line is dropped. If the filter ran
  // first and cue lookup used a post-filter index instead, every cue after a
  // dropped point would shift onto the wrong point — the exact
  // mis-attachment the all-or-nothing pairing rule above exists to prevent.
  // Filtering only after every cue is already paired to its point is what
  // keeps that from happening.
  return cleanPoints
    .map((rawPoint, i) => {
      const pointLabelMatch = STAR_LABEL_RE.exec(rawPoint);
      const label = pointLabelMatch ? pointLabelMatch[1] : "";
      const point = pointLabelMatch ? rawPoint.slice(pointLabelMatch[0].length).trim() : rawPoint;

      const resolvedCue = paired ? resolveLineCue(rawCues[i], point) : "";
      const run = resolvedCue ? locateCueRun(resolvedCue, point) : null;

      return {
        label,
        cue: run ? "" : resolvedCue,
        point,
        pageSource: pageSourcesPaired ? resolvePageSource(rawPageSources[i]) : null,
        emphasis: run ? run.span : null,
      };
    })
    .filter((line) => line.point);
}

// Maximal alphanumeric runs of `text`, each with its own character offsets
// into that same string. Tokenising the ORIGINAL rather than a lowercased copy
// keeps the offsets exact; only the comparison is case-folded.
function emphasisTokens(text) {
  const s = String(text || "");
  const out = [];
  let start = -1;
  for (let i = 0; i <= s.length; i += 1) {
    const alnum = i < s.length && /[A-Za-z0-9]/.test(s[i]);
    if (alnum && start === -1) start = i;
    else if (!alnum && start !== -1) {
      out.push({ t: s.slice(start, i).toLowerCase(), start, end: i });
      start = -1;
    }
  }
  return out;
}

// Where a cue's tokens sit inside its own point, if they sit there at all.
//
// Returns `null` when the cue is not a contiguous run of the point (a real
// paraphrase — keep the cue and render it in front, as today);
// `{ span: null }` when the run IS the whole point (drop the cue, emphasise
// nothing — a fully bolded line is not emphasis); and `{ span: {start, end} }`
// otherwise, the TIGHT character range the render layer wraps in `<strong>`.
function locateCueRun(cue, point) {
  const cueTokens = emphasisTokens(cue);
  const pointTokens = emphasisTokens(point);
  if (!cueTokens.length || !pointTokens.length) return null;
  if (cueTokens.length > pointTokens.length) return null;

  for (let i = 0; i + cueTokens.length <= pointTokens.length; i += 1) {
    if (!cueTokens.every((tok, j) => pointTokens[i + j].t === tok.t)) continue;
    if (cueTokens.length === pointTokens.length) return { span: null };
    return { span: { start: pointTokens[i].start, end: pointTokens[i + cueTokens.length - 1].end } };
  }
  return null;
}

// A single pageSources[i] entry, vetted before it is trusted as a
// `pageSource` — see answerLines' own doc comment (ARC §7.5) for why this is
// a shape check, not a pass-through.
function resolvePageSource(entry) {
  if (!entry || typeof entry !== "object") return null;
  if (typeof entry.id !== "string" || entry.id.trim() === "") return null;
  // The `title` half of the same shape check. Every producer satisfies it
  // today (both the route's resolvePageSources and selectBestStory fall back
  // to a readable name rather than ""), so this closes a latent hole rather
  // than fixing a live bug — but the hole is the one UNTITLED_PROJECT_TITLE
  // exists for: AnswerLines renders "From your {title} page.", and a missing
  // or blank title puts a sentence with its subject missing in front of
  // someone about to read it out loud mid-interview.
  if (typeof entry.title !== "string" || entry.title.trim() === "") return null;
  return entry;
}

// A single cue vetted against the point it is about to sit in front of. See
// answerLines above for why each of these three checks exists.
function resolveLineCue(rawCue, point) {
  const cueLabelMatch = STAR_LABEL_RE.exec(rawCue);
  const cue = cueLabelMatch ? rawCue.slice(cueLabelMatch[0].length).trim() : rawCue;
  if (!cue) return "";
  if (normalizeForComparison(cue) === normalizeForComparison(point)) return "";
  // pointWordCount is the module-local `wordCount` this file used to declare,
  // moved to pointLength.js so the ONE definition of "how many words is this?"
  // is shared with every gate that compares against it (AC-D.1). It is still a
  // WHITESPACE word count, which is why it can disagree with the normalised
  // TOKEN run locateCueRun looks for — see AC-C.3's punctuation case above.
  if (pointWordCount(cue) >= pointWordCount(point)) return "";
  return cue;
}

function normalizeForComparison(text) {
  return String(text || "").trim().toLowerCase().replace(/[.,;:!?…]+$/u, "");
}
