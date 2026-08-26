// The interviewer's own vocabulary, mined from the question the live session
// is answering right now — and the honesty checks that keep it from turning
// into a claim.
//
// WHY THIS MODULE EXISTS. A live interview asked a four-part Workday
// HR-systems question and the app answered "I haven't directly designed
// Workday reports, but I have extensive experience with complex data
// challenges…" — four bullets about unrelated work, not one of them saying
// "Workday", and the compliance half of the question never answered. The
// question ("Can you describe a particularly complex Workday report you
// designed? ...") was already the first thing in both prompt builders
// (answerPrompts.js:141, :273); what was missing was permission to use its
// own words to NAME the subject. This module is that permission's gate, and
// — because "permission to use their words" is one edit away from
// "permission to claim their experience" — also the two checks that keep the
// two apart after the model has drafted an answer.
//
// THE GATE (`roleTerms`). Reuses `extractKeywords` (lib/llm/engines/
// tailor-lite/keywords.js), the SAME deterministic, no-LLM extractor
// lib/copilot/postingBuzzwords.js already runs over a job posting — pointed
// here at the question instead. Restricted to `ROLE_TERM_CATEGORIES` (below),
// which is what keeps the gate closed on a content-free question like "Tell
// me about a time you failed." — no taxonomy canonical there, so nothing is
// returned (measured: extractKeywords returns {} for it). A RAKE `topic`
// phrase (e.g. "tight deadline") is advisory, not a term of art, and is never
// a role term either, because `topic` is not in `ROLE_TERM_CATEGORIES`.
//
// `ROLE_TERM_CATEGORIES` is a NARROWER, DERIVED subset of
// postingBuzzwords.js's exported `BUZZWORD_CATEGORIES` — imported, not
// copied, so the two can no longer drift silently (adversarial review item 7:
// this used to be a private, byte-identical second copy of that array, and
// adding or reordering a category in one left the other stale with nothing
// asserting they agreed). It excludes `domain` and `soft_skill` on purpose
// (item 5): `POINTS_SYSTEM`'s own instruction below scopes itself to "a
// system, tool, process, or standard", and neither category is one of those —
// `domain` names an INDUSTRY ("Healthcare", "Insurance"), `soft_skill` names a
// PERSONAL TRAIT ("Mentoring"), and granting the gate on either produced false
// positives measured against the instruction it exists to serve: "Why do you
// want to work in healthcare?" -> ["Healthcare"], "Describe your experience
// mentoring junior engineers." -> ["Mentoring"]. `technology`, `tool_platform`,
// `methodology` and `certification` all survive: each one genuinely is a
// system, tool, process or standard a candidate could be asked to name.
//
// Every surviving canonical is also required to literally occur in the
// question (`literallyMentioned`, re-used from lib/copilot/answerLocal.js
// rather than re-derived): the taxonomy can canonicalize a word the
// interviewer never said into a name they never said either (the recorded
// "team" -> "Microsoft Teams" mining hazard, answerLocal.js:213-221), and
// telling a candidate to say a word back to the interviewer who never said it
// puts a word in their mouth mid-interview. This is the same guard that also
// costs coverage on purpose: "Tell me about a time you used Kafka." resolves
// to the taxonomy canonical "Apache Kafka", which the question never said, so
// nothing survives. Widen that by ALIASING in the taxonomy, never by loosening
// this filter — loosening it is exactly how "team" would start matching
// "Microsoft Teams" again.
//
// THE HONESTY CHECKS, once a draft exists. Two DIFFERENT questions, on
// purpose (design §5c):
//   unsupportedRoleTerms   "did the draft USE a role term the material
//                           doesn't back?" — true even for the HONEST framing,
//                           because naming the subject is the entire point of
//                           the feature. This is topicality, not an accusation.
//   claimedWithoutBacking  "did the draft CLAIM to have DONE something with
//                           an unbacked role term?" — a much narrower, much
//                           higher-precision, lexical screen for the actual
//                           fabrication shape: a role term sitting inside a
//                           first-person past-tense construction. This is the
//                           one that would have caught "Action: I designed
//                           the Workday reports."
// Collapsing the two into one check breaks whichever one it happens to
// answer: see the "not the same check" cases in questionVocabulary.test.js.
//
// `question` IS UNTRUSTED, THIRD-PARTY INPUT. In live mode it is
// machine-transcribed interviewer speech; over the API it is caller-supplied.
// route.js:358 had no `.slice()` on it at all — the only unbudgeted string on
// this path, sitting at character 0 of both prompts ahead of a
// 12,000-character knowledge base and a 12,000-character résumé. Every
// export below that derives anything from `question` caps it first
// (MAX_QUESTION_CHARS), so a caller cannot reach the gate — or the
// downstream `roleTermsUnbacked` flag — by burying a term past the cap.
//
// PURE, NO FETCH, NEVER THROWS. No Supabase client, no Gemini client, no
// network. Every export is a straight function of its arguments so it can run
// on every request, on every engine, with no new `await` (AC-5.1).

import { extractKeywords } from "@/lib/llm/engines/tailor-lite/keywords";
import { defaultLibraryData } from "@/lib/llm/engines/tailor-lite/library/defaults";
import { literallyMentioned } from "./answerLocal.js";
// The single source for the taxonomy categories worth saying out loud in an
// interview (item 7) — see this file's own header for why a private second
// copy of this array used to live here instead, and ROLE_TERM_CATEGORIES
// below for the narrower subset this module actually gates on.
import { BUZZWORD_CATEGORIES } from "./postingBuzzwords.js";

// AC-4.1/§8.7: the smallest budget on this request path (MAX_CONTEXT_CHARS,
// route.js, is 4000) — a spoken interview question is a sentence, and 2000 is
// already generous for one. Chosen over a larger number specifically so the
// question can never out-weigh the context/profile/résumé/pages budgets that
// sit below it in the same prompt.
export const MAX_QUESTION_CHARS = 2000;

// AC-4.2: caps how many terms are ever handed forward to a prompt or a
// downstream check, independent of how many the question happens to name —
// a candidate reading a "words to work in" style surface cannot usefully
// absorb more than a handful mid-interview, and an unbounded list is also an
// unbounded amount of text a single question could inject into a prompt.
export const MAX_ROLE_TERMS = 10;

// AC-1.1/item 5: the gate's actual category list — every BUZZWORD_CATEGORIES
// entry EXCEPT `domain` (an industry, not a system/tool/process/standard) and
// `soft_skill` (a personal trait, not one either). Derived from the imported
// array rather than hand-listed a second time, so a category BUZZWORD_
// CATEGORIES ever adds shows up here automatically — included by default,
// excluded only by explicit name, which is the direction that fails safe: a
// new category silently missing from an explicit include-list would fail
// closed and nobody would notice, where a new category silently INCLUDED here
// is at least something `roleTerms` would start granting on, loudly, the
// first time it fires on an unexpected question.
const EXCLUDED_ROLE_TERM_CATEGORIES = new Set(["domain", "soft_skill"]);
const ROLE_TERM_CATEGORIES = BUZZWORD_CATEGORIES.filter((category) => !EXCLUDED_ROLE_TERM_CATEGORIES.has(category));

// The first-person past-tense verbs that make a sentence read as a claim to
// have personally done something, per AC-3.3's lexical screen. Deliberately
// the same list the design specifies, not a larger one: this is a
// high-precision, low-recall screen on purpose (§5c) — it exists to catch the
// shape of the actual incident ("Action: I designed the Workday reports"),
// not to parse general English tense.
const CLAIM_VERBS = new Set([
  "designed",
  "built",
  "used",
  "managed",
  "developed",
  "ran",
  "owned",
  "implemented",
  "led",
  "created",
  "maintained",
]);

// How many words apart a role term and a claim verb may sit and still count
// as the same claim ("I designed the Workday reports" — "Workday" is three
// words from "designed"). Generous enough for a short spoken sentence,
// nowhere near enough to reach across an unrelated clause.
const CLAIM_PROXIMITY_WORDS = 8;

// A Situation:/Task:/Action:/Result: label, the same four POINTS_SYSTEM and
// ANSWER_SYSTEM both mandate — checked case-sensitively on the label word
// itself the way the model is actually instructed to write it, but the regex
// below is case-insensitive so a differently-cased echo still counts.
const STAR_LABEL_RE = /^\s*(situation|task|action|result)\s*:/i;
const FIRST_PERSON_RE = /\bI\b/;

// AC-3.3, item 4's fix: condition (b) below used to be "STAR label + a bare
// first-person 'I' anywhere in the point", with no check on what surrounds
// the "I" — so it fired on every one of these honest hedges, all measured
// false positives against the actual instruction POINTS_SYSTEM now gives a
// model with a real gap to fill:
//   "Situation: I have not built a Workday report, but the reconciliation
//    reporting is the closest thing." (a NEGATION — "have not")
//   "Result: I would need a few weeks on Workday to be productive."
//    (a HYPOTHETICAL — a future need, not a past-tense claim)
//   "Action: I am comfortable saying Workday is new to me."
//    (an explicit disclaimer of the experience, no negation word at all)
// A point matching any of these is a candidate SAYING they have not done the
// thing, which is the opposite of the fabrication condition (b) exists to
// catch — so it now disqualifies (b) outright rather than counting toward it.
// Condition (a)'s claim-verb proximity check is unaffected: none of the three
// examples above puts "I" immediately before a CLAIM_VERBS entry, so (a) was
// never the source of this false-positive class.
const HEDGE_OR_NEGATION_RE =
  /\b(?:not|n't|never|no experience|lack(?:s|ing)?|new to me|would need|would have to|comfortable saying|nothing to (?:add|say))\b/i;

// `question` is untrusted and may be anything at all (route.js reads it
// straight off a request body, and in live mode it is machine-transcribed
// speech) — a non-string is treated as empty rather than coerced, so a
// caller cannot smuggle an object with a hostile `toString` into the
// extractor.
function normalizeQuestion(question) {
  const raw = typeof question === "string" ? question : "";
  return raw.trim().slice(0, MAX_QUESTION_CHARS);
}

// The exact text of a point, tolerating anything junk input throws at it —
// used by both honesty checks below so neither has to special-case a
// non-array `points` or a non-string element.
function pointText(point) {
  return typeof point === "string" ? point : "";
}

// AC-3.1/item 6: a deliberately dumb plural fold, mirroring
// lib/copilot/postingBuzzwords.js's own `foldPlural` line for line (not
// imported — this change's allowed edits to that file are limited to
// exporting `BUZZWORD_CATEGORIES`, item 7, so a second small copy is the
// honest cost of the restriction rather than a design choice). Strips a
// trailing "es" or "s" so the taxonomy's singular canonical ("CRM") and a
// candidate's own, perfectly ordinary plural phrasing of it ("Managed CRMs
// across three regional offices") are recognised as the same word.
function foldPlural(word) {
  if (word.length > 4 && word.endsWith("es")) return word.slice(0, -2);
  if (word.length > 3 && word.endsWith("s")) return word.slice(0, -1);
  return word;
}

// Every word of `text` at least 3 characters long, lowercased and plural-
// folded. Deliberately a looser floor than significantTerms' 4-char one
// (projectStories.js) — this is not that shared ranking contract, it is a
// private fallback for one honesty check, and "CRM" itself is 3 characters.
function significantWordsOf(text) {
  return (String(text || "").toLowerCase().match(/[a-z0-9]{3,}/g) || []).map(foldPlural);
}

// AC-3.1/item 6: does `material` back `term`? Tried in two passes, in order:
// literallyMentioned FIRST — the exact, word-bounded check, still what proves
// a multi-word term ("Report Writer") or an exact echo is really there — and
// only when that fails, whether EVERY one of `term`'s own significant words
// shows up among `material`'s, both plural-folded. That second pass is what
// closes the gap `literallyMentioned` alone cannot: measured, a candidate
// whose material says "Managed CRMs across three regional offices" was
// reported as not backing a question's "CRM" (the exact taxonomy canonical),
// even though the material is a full, honest match — the same "CRM"/"CRMs"
// example postingBuzzwords.js's own header already uses for the identical
// hazard on the posting side. A term with zero significant words of its own
// never clears this second pass, which never arises for a taxonomy canonical
// but costs nothing to guard.
function materialBacksTerm(term, material) {
  if (literallyMentioned(term, material)) return true;
  const termWords = significantWordsOf(term);
  if (termWords.length === 0) return false;
  const materialWords = new Set(significantWordsOf(material));
  return termWords.every((word) => materialWords.has(word));
}

// AC-1.1 to AC-1.4: the gate. `extractKeywords` grouped by category ->
// restricted to the categories worth saying out loud -> restricted again to
// canonicals the question actually said -> deduped -> capped. Never throws:
// a bad taxonomy or a pathological question degrades to "no terms", the same
// posture postingBuzzwords.js takes on its own extractor call.
export function roleTerms(question) {
  const capped = normalizeQuestion(question);
  if (!capped) return [];

  let grouped;
  try {
    grouped = extractKeywords(capped, defaultLibraryData.taxonomy);
  } catch {
    return [];
  }

  const seen = new Set();
  const out = [];
  for (const category of ROLE_TERM_CATEGORIES) {
    for (const item of grouped[category] || []) {
      const canonical = item?.canonical;
      if (typeof canonical !== "string" || !canonical) continue;
      const key = canonical.toLowerCase();
      if (seen.has(key)) continue;
      // AC-1.1's literal-mention guard — see this file's own header for the
      // "team" -> "Microsoft Teams" hazard it exists to stop.
      if (!literallyMentioned(canonical, capped)) continue;
      seen.add(key);
      out.push(canonical);
      if (out.length >= MAX_ROLE_TERMS) return out;
    }
  }
  return out;
}

// AC-3.1/AC-3.2: which of `terms` did the draft actually use (per
// `literallyMentioned`) that `material` does not support? Question-derived
// terms get NO exemption — a term the interviewer supplied for free carries
// no evidence, the same rule storyMatchHonesty.test.js already states for
// page selection, applied here to the drafted sentence instead. This is
// TOPICALITY, not a verdict: it also flags the honest framing, which
// correctly names the subject without ever claiming it — see
// `claimedWithoutBacking` for the narrower, per-claim check.
export function unsupportedRoleTerms(points, material, terms) {
  if (!Array.isArray(terms) || terms.length === 0) return [];
  const draftText = Array.isArray(points) ? points.map(pointText).join("\n") : "";
  if (!draftText) return [];
  const mat = typeof material === "string" ? material : "";

  const out = [];
  for (const term of terms) {
    if (typeof term !== "string" || !term) continue;
    if (!literallyMentioned(term, draftText)) continue; // never used at all
    if (materialBacksTerm(term, mat)) continue; // the material backs it — exact, or a plural fold (item 6)
    out.push(term);
  }
  return out;
}

// Index of the word immediately after a standalone "I" that is one of
// CLAIM_VERBS, or -1. Equivalent to testing
// /\bI\s+(?:designed|built|...)\b/i against the point, but returns a WORD
// index so the proximity check below can measure distance in words rather
// than characters.
function findClaimVerbWordIndex(words) {
  for (let i = 0; i < words.length - 1; i += 1) {
    const w = words[i].toLowerCase().replace(/[^a-z]/g, "");
    if (w !== "i") continue;
    const next = words[i + 1].toLowerCase().replace(/[^a-z]/g, "");
    if (CLAIM_VERBS.has(next)) return i;
  }
  return -1;
}

// Word index of the first occurrence of `term` (which may itself be more
// than one word, e.g. "Report Writer") inside `words`, or -1.
function findTermWordIndex(words, term) {
  const termWords = term
    .toLowerCase()
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => w.replace(/[^a-z0-9+#.]/g, ""));
  if (termWords.length === 0) return -1;
  const norm = words.map((w) => w.toLowerCase().replace(/[^a-z0-9+#.]/g, ""));
  for (let i = 0; i <= norm.length - termWords.length; i += 1) {
    let matched = true;
    for (let j = 0; j < termWords.length; j += 1) {
      if (norm[i + j] !== termWords[j]) {
        matched = false;
        break;
      }
    }
    if (matched) return i;
  }
  return -1;
}

// AC-3.3/AC-3.4: per-point indices where an unbacked role term appears inside
// a first-person past-tense construction — the shape that would have caught
// "Action: I designed the Workday reports using Report Writer." Two
// disjunctive conditions, per the design's lexical screen:
//   (a) the term sits within CLAIM_PROXIMITY_WORDS of an "I <claim verb>"
//       construction anywhere in the same point, or
//   (b) the point carries a STAR label AND contains a bare first-person "I"
//       anywhere in it, AND that "I" is not part of a negated or hypothetical
//       construction (HEDGE_OR_NEGATION_RE, item 4's fix — see that
//       constant's own comment for the three measured false positives this
//       excludes). A STAR "Action:" point with none of those hedges is a
//       first-person account of what the candidate did by construction, so no
//       separate proximity check is required once both hold.
// High precision, deliberately low recall (§5c): it does NOT fire on a hedge
// like "I haven't directly designed Workday reports" — "I" is not immediately
// followed by a claim verb there (disqualifying (a)), and that particular
// sentence carries no STAR label in the recorded failure either (disqualifying
// (b) independently) — which is why the check is silent on the answer that
// actually shipped; the hedge itself is POINTS_SYSTEM's prompt-text problem to
// fix, not this lexical screen's. `materialBacksTerm` (item 6), not the bare
// `literallyMentioned`, decides whether the material backs a term here too, so
// this check and `unsupportedRoleTerms` can never disagree about what "backed"
// means for the same plural/singular mismatch.
export function claimedWithoutBacking(points, options) {
  if (!Array.isArray(points)) return [];
  const roleTermsList = Array.isArray(options?.roleTerms) ? options.roleTerms : [];
  if (roleTermsList.length === 0) return [];
  const material = typeof options?.material === "string" ? options.material : "";

  const flagged = [];
  points.forEach((rawPoint, index) => {
    const point = pointText(rawPoint);
    if (!point) return;

    const unbackedHere = roleTermsList.filter(
      (term) => typeof term === "string" && term && literallyMentioned(term, point) && !materialBacksTerm(term, material),
    );
    if (unbackedHere.length === 0) return;

    const words = point.split(/\s+/).filter(Boolean);
    const verbIndex = findClaimVerbWordIndex(words);
    const hasStarFirstPerson =
      STAR_LABEL_RE.test(point) && FIRST_PERSON_RE.test(point) && !HEDGE_OR_NEGATION_RE.test(point);

    for (const term of unbackedHere) {
      const termIndex = findTermWordIndex(words, term);
      if (termIndex === -1) continue;
      const nearClaimVerb = verbIndex !== -1 && Math.abs(termIndex - verbIndex) <= CLAIM_PROXIMITY_WORDS;
      if (nearClaimVerb || hasStarFirstPerson) {
        flagged.push(index);
        break;
      }
    }
  });
  return flagged;
}
