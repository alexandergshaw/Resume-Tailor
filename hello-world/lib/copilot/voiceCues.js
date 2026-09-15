// AC-T1.1..T1.8. The registry of spoken cues a candidate can say during a
// LIVE interview to control the copilot without touching the keyboard.
// `title`, `summary` and `phrases` are rendered verbatim by the cue sidebar
// (VoiceCueSidebar.js, T3) — they are user-facing copy, not internal labels.
//
// N18 delta review F1, OWNER RULING: full retirement of the "hold" ("pin")
// and "release" ("unpin") cues. This registry used to carry three actions —
// hold the current question and its drafted answer on screen, release that
// hold, and pull up company research for the selected posting — but the
// hold's only surviving behavioural effects were harmful with no offsetting
// benefit: an "aria-busy" that suppressed genuine draft-status announcements
// for the duration of a hold, and a stale "Held on screen" region and
// "Currently held" chip that never reflected what the confirm gate
// (questionConfirm.js) actually shows. The confirm gate is now the ONLY
// surface that decides which question is current — see that module's own
// header. `lib/copilot/questionPin.js` and its React half
// (app/copilot/useQuestionPin.js) are deleted; nothing in this module names
// them any more. Company research remains the one action this registry
// still recognizes.
//
// What this module deliberately does NOT do: it does not decide WHEN to run
// (that is useLiveSession.js's job, gated to final transcript frames only —
// AC-T1.13); it does not know what a "posting" is, or mutate any state; it
// has no opinion on whether a matched cue could actually be acted on (no
// posting selected), and it does not decide whether an AMBIGUOUS match
// should be acted on either — see matchVoiceCue below, the caller
// (useLiveSession.js, AC-T1.2.1) refuses to act when `ambiguous` is true.
// The ambiguity check itself is unchanged and still generic (it fires
// whenever two DIFFERENT actions match one utterance) even though this
// registry currently ships only one action, exactly as it was before hold
// and release existed. It is a pure text-in, cue-out function, matching
// localDetection.js's own boundary.
//
// Reuses `normalizeQuestion` from ./questions.js for the exact same
// lowercase/whitespace-collapse normalization the question detector already
// applies to live speech, rather than inventing a second normalizer. That
// function deliberately does NOT strip punctuation, so every pattern below
// tolerates commas, periods and question marks sitting next to the words it
// cares about. It also does NOT normalize apostrophes, so a contraction can
// arrive as `'`, `’`, or nothing at all (STT dependent) — every pattern
// below that touches a contraction is built from a shared fragment that
// accepts all three.
import { normalizeQuestion } from "./questions.js";

// Shared fragment for a first-person contraction that can arrive spelled
// three ways depending on the STT provider: "I've" (straight apostrophe),
// "I’ve" (curly), or "Ive" (dropped entirely), OR spoken out in full as
// "I have". Embedded into a larger pattern via `new RegExp` rather than
// exposed as its own RegExp, so it is never accidentally handed to `exec`
// on its own.
const IVE_SRC = "i(?:['’]?ve|\\s+have)";

// AC-T1.7, REDESIGNED, then narrowed AGAIN after a second adversarial pass
// found two independent problems. The original noun-phrase and command-verb
// patterns ("company info/research/news/background", "pull up/bring up/show
// me the company", "remind me about this company", "what do we know about
// them") are gone, not narrowed — the first for firing on ordinary interview
// English ("My company background is in fintech and payments", "I did
// company research before every single call"), the second and third for
// being commands nobody actually says out loud. Do not re-add a bare
// noun-phrase pattern here; it was the worst false positive in this module.
//
// The replacements are the natural bridges a candidate says when they are
// ABOUT to reference something they know about the company. Saying one buys
// the couple of seconds the panel needs to load, which is the point: the
// cue is useful speech in its own right, not an incantation. Company spends
// a real outbound request carrying the posting's details, so it gets the
// tightest guard this module has.
//
// Problem 1, a boundary bug: `\bthe company\b` alone matches inside "the
// company's competitor" (an apostrophe satisfies `\b` just as well as a
// space does) and inside "the company culture conversation" (nothing
// stopped "company" from being read as the front half of a DIFFERENT
// compound noun). Both were confirmed to fire. Fixed below by requiring the
// match to END at "the company" — followed by end-of-utterance, closing
// punctuation, the preposition "for" ("following the company for a while"),
// or an adverb ("reading about the company recently/closely") — never by a
// possessive or a bare noun that would extend "company" into a longer noun
// phrase it doesn't mean here. COMPANY_END_SRC below is that guard, shared
// by every pattern that ends in "the company" so none of them can drift
// out of sync with it.
//
// Problem 2, cut entirely: "what I've read about the company" was pulled
// after the same pass produced "From what I've read about the company you
// used to work for, that was a hard migration" — an INTERVIEWER asking
// about the candidate's PREVIOUS employer, not the posting's company. The
// boundary fix alone could not save this one: "the company you used to work
// for" is a grammatically ordinary continuation (a reduced relative
// clause), not a possessive or a bare compound noun, so there is no cheap
// guard that keeps this phrase pointed at the RIGHT company. Do not re-add
// it without solving that.
//
// KNOWN, ACCEPTED LIMIT of COMPANY_END_SRC: it only looks at what is
// grammatically adjacent to "the company", not at what the rest of the
// sentence goes on to say. "I've been following the company closely, well,
// mostly its competitors really" still fires — "closely" already satisfied
// the guard before the trailing clause retracts it. This is a structural
// limit, not a bug in the guard: no regex can know that a later clause takes
// back an earlier one. Accepted as-is; do not spend a round trying to close
// it with more lookahead.
const COMPANY_END_SRC = "the company(?=$|[.,!?]|\\s+for\\b|\\s+\\w+ly\\b)";

// "I was reading about the company" — no contraction involved.
const COMPANY_READING_WAS_RE = new RegExp(`\\bi was reading about ${COMPANY_END_SRC}`);
// "I've/I have been reading about the company".
const COMPANY_READING_BEEN_RE = new RegExp(`\\b${IVE_SRC} been reading about ${COMPANY_END_SRC}`);
// "I've/I have been following the company". Covers the apostrophe-tolerance
// test directly: "I've been following the company" / "I’ve been following
// the company" / "Ive been following the company" all resolve through
// IVE_SRC.
const COMPANY_FOLLOWING_RE = new RegExp(`\\b${IVE_SRC} been following ${COMPANY_END_SRC}`);
// "Tell me more about the company" — the candidate asking the interviewer,
// the one direction of "tell me" that is unambiguously the candidate's own
// line, not the interviewer's ("tell me" alone is a STARTERS entry in
// questions.js precisely because interviewers say it constantly; requiring
// "more about the company" contiguous is what keeps this pattern off of
// that). The negative control "Tell me if you want more detail on the
// company I worked for" contains "tell me" and, much later, "the company",
// but never "tell me more about the company" as one run of words, so this
// does not fire on it.
const COMPANY_TELL_ME_MORE_RE = new RegExp(`\\btell me more about ${COMPANY_END_SRC}`);

// Ordered, one entry per action. Order only matters as the tie-break in
// matchVoiceCue (AC-T1.2: equal-index matches keep the earlier-declared
// cue) — with a single entry left it has no observable effect today, but
// stays in place rather than being collapsed away, since a future cue would
// need it again immediately.
const CUES = [
  {
    id: "company-brief",
    action: "company",
    title: "Reference the company",
    summary:
      "Opens recent research on this company.",
    phrases: [
      "I was reading about the company recently.",
      "I've been following the company closely.",
      "Tell me more about the company.",
    ],
    patterns: [
      COMPANY_READING_WAS_RE,
      COMPANY_READING_BEEN_RE,
      COMPANY_FOLLOWING_RE,
      COMPANY_TELL_ME_MORE_RE,
    ],
  },
];

// AC-T1.1: frozen so no caller can mutate the shared registry, and frozen
// one level deeper (each cue object, and its phrases/patterns arrays) for
// the same reason — a caller holding a reference to `VOICE_CUES[0].phrases`
// should not be able to push into it either.
for (const cue of CUES) {
  Object.freeze(cue.phrases);
  Object.freeze(cue.patterns);
  Object.freeze(cue);
}
export const VOICE_CUES = Object.freeze(CUES);

// Finds the LAST match of `pattern` in `text`, or -1 when it does not match
// at all. Deliberately does not run `pattern` (a shared, module-level
// RegExp) directly with the `/g` flag: a global RegExp keeps `lastIndex` on
// the object between calls, so the very same pattern would answer
// differently on a second call against the same input (see this file's
// "repeat calls are independent" test). Instead this builds a brand-new
// RegExp from `pattern`'s source every call — a fresh object has no state to
// leak between calls, no matter how many times matchVoiceCue runs.
function lastMatchIndex(pattern, text) {
  const flags = pattern.flags.includes("g") ? pattern.flags : `${pattern.flags}g`;
  const globalPattern = new RegExp(pattern.source, flags);
  let match = globalPattern.exec(text);
  let index = -1;
  while (match !== null) {
    index = match.index;
    // A zero-length match (a pattern with only optional pieces) would never
    // advance lastIndex on its own and loop forever; nothing above actually
    // produces one, but the guard costs nothing and removes the failure
    // mode entirely.
    if (match[0].length === 0) globalPattern.lastIndex += 1;
    match = globalPattern.exec(text);
  }
  return index;
}

// AC-T1.2, amended after the adversarial review (AC-T1.2.1). Matches `text`
// against every cue and reports:
//   - `id`/`action`/`matchedAt` — the cue whose pattern matches LATEST in the
//     utterance, same as before: speech is sequential, so when a candidate
//     says two cues in one utterance, the thing they said last is the
//     operative intent. Ties on index fall to whichever cue is declared
//     earlier in VOICE_CUES (the comparison below only replaces the current
//     winner on a STRICTLY greater index).
//   - `actions` — the distinct actions that matched ANYWHERE in the
//     utterance, not just the winner's.
//   - `ambiguous` — true when `actions` has more than one member. A single
//     provider-final frame carrying two DIFFERENT actions is far more likely
//     to be narrative speech than sequential candidate intent, since finals
//     arrive only every few seconds. The caller (useLiveSession.js) MUST NOT
//     act on an ambiguous match — it still logs `id`/`action`/`matchedAt` so
//     the frame is traceable, it just doesn't change any state on it.
//     Repeating the SAME action twice is NOT ambiguous: only one action is
//     present in `actions` either way. This check stays generic even though
//     the registry above currently ships only one action — see this file's
//     own module doc.
export function matchVoiceCue(text) {
  if (typeof text !== "string") return null;
  const normalized = normalizeQuestion(text);
  if (!normalized) return null;

  let winner = null;
  const actions = new Set();

  for (const cue of VOICE_CUES) {
    let cueLatest = -1;
    for (const pattern of cue.patterns) {
      const index = lastMatchIndex(pattern, normalized);
      if (index > cueLatest) cueLatest = index;
    }
    if (cueLatest === -1) continue;
    actions.add(cue.action);
    if (!winner || cueLatest > winner.matchedAt) {
      winner = { id: cue.id, action: cue.action, matchedAt: cueLatest };
    }
  }

  if (!winner) return null;
  return { ...winner, actions, ambiguous: actions.size > 1 };
}
