// Pure, no-IO status predicate over an already-`normalizePack`-normalized
// `Pack` (lib/interviewPrep/prepParse.js). Derived directly from
// `interview_prep_packs_ready_is_complete`
// (supabase/migrations/20260914000000_interview_prep.sql ~:194-211), which
// requires all four of `sections.{aboutYou,whyRole,askThem,stages}` to carry
// a non-empty array at the exact nested path that CHECK names -- not merely
// a truthy section object. `completeSections`/`packStatus` re-derive that
// same "non-empty array" test in JS so a caller can decide `status` BEFORE
// writing, without racing the database's own CHECK or duplicating its four
// branches by hand.
//
// Callers are expected to pass a pack that has already been through
// `normalizePack` -- these two functions do not repair shape themselves
// (that choke point lives in prepParse.js, deliberately singular), they
// only observe it. Passed a raw, un-normalized pack, a section whose
// `sections,stages,stages` path is malformed reads as empty rather than
// throwing, matching the database CHECK's own `case ... else false` guard
// against a non-array `#>` result.
//
// `buildEmbeddedPack` (below) also lives here, not in
// app/api/interview-prep/route.js -- moved so a test can run the REAL
// producer through the REAL `normalizePack`/`packStatus` at runtime instead
// of a hand-mirrored copy of its literal that can silently drift from it (a
// prior revision's own regression: a source-text check pinning only the
// pack's KEY STRUCTURE, never its string content or non-emptiness, let
// `lines: [{text: ...}]` mutate to `lines: []` -- or the aboutYou sentence
// rewritten entirely -- and stay green). route.js already imports
// `packStatus` from this same module, so importing `buildEmbeddedPack`
// alongside it adds no new export to route.js and no
// lib/sourceScan/exportReachability.sweep.test.js churn.

import { containsDetectedName, EMBEDDED_TEMPLATE_ORIGIN } from "./prepParse.js";
import { PREP_SECTION_NAMES } from "./prepContract.js";

// N45/N46 plan §S1: this constant now lives in prepContract.js (as
// PREP_SECTION_NAMES) so lib/interviewPrep/prepClaims.js and
// lib/interviewPrep/prepMerge.js can share it without importing this module
// or prepParse.js. Re-bound to the old local name so nothing below this line
// changes.
const SECTION_NAMES = PREP_SECTION_NAMES;

function asPlainObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

/**
 * Does one Stage carry any content worth reading -- a non-empty
 * `questions[]` (at least one non-empty string) or a non-empty
 * `recommendedAnswer`? `normalizeStage` (prepParse.js) deliberately KEEPS a
 * Stage entry even when refusal nulled its `name`/`recommendedAnswer` and
 * emptied its `questions[]` -- that is correct for normalization (removing
 * unsafe content is not the same as deleting structure a renderer may still
 * want; a landed prepParse.test.js case pins exactly this: a stage with a
 * nulled name, an empty `questions[]`, and a null `recommendedAnswer` still
 * survives as a length-1 array). But that means a `stages` array can be
 * structurally non-empty while every entry on it is contentless, and
 * `packStatus` counting mere array length would call such a pack "ready"
 * with nothing in that section a candidate could actually read. This
 * predicate is what keeps that distinction from leaking into "ready".
 */
function stageHasUsableContent(stage) {
  if (!stage || typeof stage !== "object" || Array.isArray(stage)) return false;
  const hasQuestions =
    Array.isArray(stage.questions) && stage.questions.some((q) => typeof q === "string" && q.trim().length > 0);
  const hasAnswer = typeof stage.recommendedAnswer === "string" && stage.recommendedAnswer.trim().length > 0;
  return hasQuestions || hasAnswer;
}

/** Does one named section carry a non-empty array at the exact path
 *  `interview_prep_packs_ready_is_complete` checks -- and, for `stages`
 *  specifically, does at least one entry in that array carry usable content
 *  (see `stageHasUsableContent`)? The other three sections already require
 *  a usable-text entry via prepParse.js's `isUsableTextEntry` (normalizePack
 *  drops anything less), so this makes `stages` consistent with them rather
 *  than trusting mere array length the way this function used to. */
function sectionIsNonEmpty(sections, name) {
  const section = asPlainObject(sections[name]);
  if (name === "askThem") return Array.isArray(section.questions) && section.questions.length > 0;
  if (name === "stages") return Array.isArray(section.stages) && section.stages.some(stageHasUsableContent);
  const answer = asPlainObject(section.answer);
  return Array.isArray(answer.lines) && answer.lines.length > 0;
}

/**
 * The set of the four section names (`aboutYou`, `whyRole`, `askThem`,
 * `stages`) that are non-empty AFTER normalization -- i.e. the same test
 * `interview_prep_packs_ready_is_complete` applies, one name per clause.
 *
 * @param {*} pack
 * @returns {Set<string>}
 */
export function completeSections(pack) {
  const sections = asPlainObject(pack && typeof pack === "object" ? pack.sections : null);
  const complete = new Set();
  for (const name of SECTION_NAMES) {
    if (sectionIsNonEmpty(sections, name)) complete.add(name);
  }
  return complete;
}

/**
 * Derives the `status` a pack qualifies for from how many of the four
 * sections are complete: all four -> `"ready"` (matches the database CHECK
 * exactly, so a write gated on this never trips
 * `interview_prep_packs_ready_is_complete`); one to three -> `"partial"`;
 * zero -> `null`, signalling the caller should write `'failed'` instead
 * (this module makes no `'failed'` determination itself -- that is a
 * caller decision outside this pure predicate's scope).
 *
 * @param {*} pack
 * @returns {"ready" | "partial" | null}
 */
export function packStatus(pack) {
  const count = completeSections(pack).size;
  if (count === 4) return "ready";
  if (count === 0) return null;
  return "partial";
}

// E: `position.title`/`position.company` are interpolated from `positions`,
// a row merged from EXTERNAL job feeds keyed on `external_id`
// (lib/supabase/writePosition.js) -- not this template's own fixed wording.
// A prior revision's own justification for exempting this pack from
// K1-SHAPE ("our own fixed template ... never model text, and it cannot
// name a real person") was FALSE for these two fields specifically: the
// exemption is right for the template's OWN authored sentences, which can
// never name anyone, but it must never be stretched to cover a feed-supplied
// value just because that value happens to get interpolated into the same
// sentence. A feed row can carry anything, including a string shaped like a
// real person's name (`"Jane Doe"` as a title or company), and this
// function's own pack sets `templateOrigin` unconditionally, which would
// otherwise exempt that value from ever needing a citation.
//
// The fix applied here: `title`/`company` are BOTH screened with the SAME
// `containsDetectedName` heuristic K1-SHAPE uses everywhere else, BEFORE
// interpolation, uniformly -- no per-field exception of any kind. A value
// that reads as a detected name is never interpolated at all --
// `safeInterpolationValue` returns `null` rather than a fallback string, and
// `buildEmbeddedPack` (below) chooses a grammatical sentence variant per
// field instead of splicing a fixed noun phrase into a hole the template's
// own wording already supplies an article for (N16-E1: the prior fallback
// strings "this position"/"the company" produced "the this position role"
// once both a hardcoded "the" and the fallback's own article collided -- no
// output may read that way again).
//
// N16 WAVE G -- THE ALLOW-LIST IS DELETED, NOT PATCHED A THIRD TIME. `title`
// used to get a narrow carve-out (`looksLikeJobTitle`, a small job-noun
// allow-list) so an ordinary title like "Software Engineer" would not read
// as a detected name. Measured against the real file, that carve-out failed
// in both directions it was meant to serve:
//
//   - It still let uncited real names through. Its pair scan was
//     non-overlapping, so an odd-length run of Title-Case words left the
//     final word screened by nothing; and it overrode the verdict when
//     EITHER word of a pair was a job noun, so the job noun itself (e.g.
//     "Director" in "Director Maria") satisfied its own override. Executed
//     leaks included "Director Maria Garcia", "Lead Software Engineer Jane
//     Doe", "Engineer Jane Doe", "Nurse Maria Garcia", and "Analyst Robert
//     Klein" -- each rendering a real name uncited.
//   - It also broke the modal title shape: over a corpus of ordinary clean
//     titles it introduced dozens of new fallbacks of its own, for any
//     odd-length title whose job noun happened to land last in its run.
//
// A leaked uncited name violates O-15; a generic fallback is only a quality
// loss. The owner ruling was to cut the allow-list rather than patch it
// again: `title` is now screened EXACTLY like `company` always was -- see
// `safeInterpolationValue` below, which takes no per-field option any more.
//
// The measured cost: most ordinary multi-word job titles ("Senior Data
// Scientist", "Machine Learning Engineer", "Site Reliability Engineer") and
// most multi-word employers without a recognized `ORG_SUFFIX_WORDS` suffix
// (prepParse.js) now render generically ("this role" / "this company")
// instead of by name. That is deliberate and accepted until backlog N26
// replaces `containsDetectedName` with a corpus-measured detector that can
// actually tell a job title from a person's name -- prepPack.test.js pins
// this fixture-by-fixture (including an explicit "Senior Data Scientist"
// fallback case) rather than as a number in this comment, so nothing here
// can go stale the way the deleted allow-list's own claims did.
//
// K1-PROHIBITION is NOT affected by any of this -- it is not exempted for
// this pack (prepParse.js's own header), and does not depend on where a
// word came from.

function safeInterpolationValue(rawValue) {
  const trimmed = String(rawValue || "").trim();
  if (!trimmed) return null;
  if (containsDetectedName(trimmed)) return null;
  return trimmed;
}

// The deterministic, zero-outbound path (engine: "embedded"). No model call,
// so no spend gate applies -- matches app/api/copilot/glossary/route.js's own
// GATE 14 posture: zero outbound, zero client.
//
// Shaped to this file's own Pack contract (lib/interviewPrep/prepParse.js's
// normalizePack header): `sections.{aboutYou,whyRole,askThem,stages}`, the
// exact nested paths interview_prep_packs_ready_is_complete
// (supabase/migrations/20260914000000_interview_prep.sql:194-211) reads, with
// `stages` one level deeper than the other three (`{ stages: [...] }`, since
// "stages" names both the section key and its one field).
//
// Written for status 'partial', never 'ready', by route.js's own caller,
// REGARDLESS of this shape now carrying content at all four paths -- an
// owner ruling, not an oversight: a deterministic, no-LLM backend produces
// templated filler, never a real, cited pack, so 'ready' would overstate
// what this path actually researched. 'partial' never evaluates
// interview_prep_packs_ready_is_complete at all (it only fires for status =
// 'ready'), so this shape change cannot trip it either way. `claims` is
// still a real array, not an object map -- interview_prep_packs_claims_is_array
// (:219-220) applies to 'partial' too, and a producer should be correct at
// the source rather than leaning on prepParse.js's normalizePack to rescue
// it downstream.
//
// F-1: this pack's own `templateOrigin: EMBEDDED_TEMPLATE_ORIGIN` field
// exempts its content from K1-SHAPE (the citation requirement) ONLY, inside
// normalizePack -- see that file's own header for the full rationale (our
// own fixed template, never model text, cannot name a real person) and for
// why the exemption cannot be reached from the generation path (route.js
// strips this exact field before normalizing a model reply).
// K1-PROHIBITION still applies here unconditionally, same as every other
// path.
//
// N16-E1(a): `title`/`company` no longer splice a noun-phrase fallback into
// a sentence that already supplies its own article -- that produced "the
// this position role" once the caller's hardcoded "the" collided with the
// fallback string's own "this position". Instead each field resolves to
// `null` (via `safeInterpolationValue`) or a real value, and the sentence
// picks its OWN grammatical variant per field: `the ${title} role` vs
// `this role`, and `${company}` vs `this company` -- so a fallback and a
// resolved value can mix (title known, company unknown, or vice versa)
// without ever re-creating the double-article defect.
//
// @param {{ position?: object, digest?: object }} args
export function buildEmbeddedPack({ position, digest }) {
  const title = safeInterpolationValue(position?.title);
  const company = safeInterpolationValue(position?.company);
  const hasTitle = title != null;
  const hasCompany = company != null;
  const titlePhrase = hasTitle ? `the ${title} role` : "this role";
  const companyPhrase = hasCompany ? company : "this company";
  const roleAtCompany = `${titlePhrase} at ${companyPhrase}`;
  // E-F7: "as a ${title}" -- a candidate reads this question aloud to a
  // recruiter, and the bare noun phrase ("as Software Engineer?") is not
  // grammatical English.
  const asTitlePhrase = hasTitle ? `as a ${title}` : "in this role";
  const hasDigest = digest?.status === "ready" && typeof digest.markdown === "string" && digest.markdown.trim();
  const digestNote = hasDigest
    ? "Company research is already on file in the tracking table's digest -- read it for specifics before your interview."
    : "No company research is on file yet for this posting.";

  return {
    version: 1,
    templateOrigin: EMBEDDED_TEMPLATE_ORIGIN,
    sections: {
      aboutYou: {
        answer: {
          lines: [{ text: `Lead with the experience most relevant to ${roleAtCompany}.` }],
        },
      },
      whyRole: {
        answer: {
          lines: [
            {
              text: `Explain what draws you to ${roleAtCompany} specifically, not to the field in general.`,
            },
          ],
        },
      },
      askThem: {
        questions: [
          { text: `What does success look like in the first 90 days ${asTitlePhrase}?` },
          { text: "How is this team's work measured?" },
        ],
      },
      stages: {
        stages: [
          {
            name: "Overview",
            questions: ["Tell me about yourself.", `Why ${companyPhrase}?`],
            recommendedAnswer: digestNote,
            support: null,
          },
        ],
      },
    },
    claims: [],
  };
}
