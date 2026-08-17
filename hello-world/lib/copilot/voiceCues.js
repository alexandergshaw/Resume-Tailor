// AC-T1.1..T1.8. The registry of spoken cues a candidate can say during a
// LIVE interview to control the copilot without touching the keyboard: hold
// ("pin") the current question and its drafted answer on screen so a later
// detection cannot evict what the candidate is mid-sentence reading, release
// that hold, or pull up company research for the selected posting. `title`,
// `summary` and `phrases` are rendered verbatim by the cue sidebar
// (VoiceCueSidebar.js, T3) — they are user-facing copy, not internal labels.
//
// What this module deliberately does NOT do: it does not decide WHEN to run
// (that is useLiveSession.js's job, gated to final transcript frames only —
// AC-T1.13); it does not know what a "pinned question" or a "posting" is,
// or mutate any state; it has no opinion on whether a matched cue could
// actually be acted on (no question yet, no posting selected), and it does
// not decide whether an AMBIGUOUS match should be acted on either — see
// matchVoiceCue below, the caller (useLiveSession.js, AC-T1.2.1) refuses to
// act when `ambiguous` is true. It is a pure text-in, cue-out function,
// matching localDetection.js's own boundary.
//
// Reuses `normalizeQuestion` from ./questions.js for the exact same
// lowercase/whitespace-collapse normalization the question detector already
// applies to live speech, rather than inventing a second normalizer. That
// function deliberately does NOT strip punctuation, so every pattern below
// tolerates commas, periods and question marks sitting next to the words it
// cares about — and the sentence-boundary anchors below (SENTENCE_START_SRC)
// depend on that punctuation still being present. It also does NOT normalize
// apostrophes, so a contraction can arrive as `'`, `’`, or nothing at all
// (STT dependent) — every pattern below that touches a contraction is built
// from a shared fragment that accepts all three.
//
// VOCABULARY, REDESIGNED against two constraints the user stated directly
// after the first shipped vocabulary violated both:
//
//   1. A cue must sound NATURAL said out loud in a real interview. "Unpin",
//      "pull up the company", "bring up the company", "show me the company",
//      "remind me about this company", "what do we know about them" are
//      commands addressed to an app. Nobody says them in a job interview. A
//      cue nobody will actually say is a cue that does not exist. All of
//      them are gone, not narrowed.
//
//   2. A cue must be something only the CANDIDATE would say. The copilot
//      listens on a microphone, and on two of the three sources the
//      interviewer's voice can reach that microphone, so any phrase an
//      interviewer might plausibly utter is a phrase the interviewer can use
//      to drive the candidate's own dashboard. Cut for this reason: "hold
//      that thought" (what an interviewer says to interrupt you), "give me a
//      second/moment/minute" ("give me a second while I pull up your
//      resume" is interviewer speech), and "let's move on" / "moving on" /
//      "next question" — the last three already appeared in questions.js's
//      LEAD_IN_RE as INTERVIEWER lead-ins, this codebase's own evidence
//      about who says them.
//
// The replacement vocabulary organises around DIRECTION: an interviewer says
// "walk me through", a candidate says "let me walk you through". The pronoun
// is what assigns a phrase to a speaker, and it is what most of the new
// patterns rely on instead of an anchor or a rare word.
//
// THE MISFIRE COST IS NOT SYMMETRIC ACROSS THE THREE ACTIONS, and every
// judgment call below about which interviewer-risk cues to keep and which to
// cut follows from this:
//   - An interviewer accidentally triggering HOLD merely holds the question
//     the candidate is already on. Near-harmless, often what you'd want
//     anyway.
//   - An interviewer accidentally triggering RELEASE yanks away a hold the
//     candidate set deliberately, mid-answer. Harmful.
//   - Anything triggering COMPANY spends an outbound request carrying the
//     posting's details and pops a panel. The most expensive of the three.
//
// So this file is TOLERANT on hold and STRICT on release and company. The
// pin cues below ("let me give you an example…", "let me take a step
// back…", "let me walk you through…", "off the top of my head…") all have a
// confirmed natural interviewer utterance an adversarial pass produced for
// them (an interviewer clarifying their own question with an example, or
// framing it with context, or explaining the interview's agenda, or
// caveating a quick answer). They are kept anyway, deliberately, BECAUSE the
// worst outcome of an interviewer tripping one is a hold the candidate
// almost certainly wants anyway. Do not read their presence in that
// adversarial pass as a defect to fix — the fix already happened, in the
// unpin and company vocabularies below, which do not get the same latitude.
import { normalizeQuestion } from "./questions.js";

// ============================================================================
// ACCEPTED RESIDUALS, consolidated. Every KNOWN interviewer exposure left in
// this file on purpose, gathered in one place so they can be read — and
// re-argued, if the calculus ever changes — together, instead of being
// rediscovered piecemeal one cue at a time. Each entry below also has a
// short pointer next to its cue; this block is the canonical explanation.
//
// 1. PIN — the "good question" family (PIN_QUESTION_RE). An interviewer DOES
//    say "good question" when the CANDIDATE asks THEM one, usually near the
//    end of an interview. Accepted: a false HOLD is the cheap side of the
//    asymmetry documented above (it only holds the question already on
//    screen), it is one click to undo, and the in-person identity gate plus
//    the tab/system channel separation cover most of the remaining exposure.
//
// 2. UNPIN — "does that answer" / "hope that answers"
//    (UNPIN_ANSWERS_QUESTION_RE, UNPIN_HOPE_THAT_ANSWERS_RE). Both fire when
//    the INTERVIEWER answers a question the CANDIDATE asked them. Accepted:
//    that exchange is confined to the end-of-interview "any questions for
//    us?" stretch, and a release there costs nothing — there is no held
//    answer left to protect by then.
//
// 3. UNPIN — "that's how I'd approach it" (UNPIN_APPROACH_RE), the
//    unprompted-peer-opinion case that survives its own "too"/"as well"/
//    "either" guard (see that pattern's comment for the guard itself):
//    "Funny enough, that's how I'd approach it if I were still writing code
//    day to day" has no trailing agreement marker for the guard to catch.
//    Accepted: this needs the interviewer to volunteer their own take,
//    unprompted, peer to peer — a narrow stretch of an interview — and a
//    false release there costs little: there is rarely a hold worth
//    protecting during a peer-to-peer technical aside.
// ============================================================================

// Shared fragment for a first-person contraction that can arrive spelled
// three ways depending on the STT provider: "I've" (straight apostrophe),
// "I’ve" (curly), or "Ive" (dropped entirely), OR spoken out in full as
// "I have". Embedded into a larger pattern via `new RegExp` rather than
// exposed as its own RegExp, so it is never accidentally handed to `exec`
// on its own.
const IVE_SRC = "i(?:['’]?ve|\\s+have)";
// Same idea for "that's" / "that’s" / "thats".
const THATS_SRC = "that['’]?s";
// Same idea again for "I'd" / "I’d" / "Id" / "I would".
const ID_SRC = "i(?:['’]?d|\\s+would)";

// AC-T1.5. "Good/great/interesting/tough/fair/excellent question" in any
// natural framing ("Good question", "That's a great question", "What a
// great question"). Deliberately matches the adjective immediately before
// "question" and nothing else — NOT a leading "that's"/"that is"/"what a" —
// so the pattern needs no apostrophe handling at all (STT renders "that's"
// as "'", "'" or nothing; matching on the invariant tail of the phrase sidesteps
// that variance entirely instead of enumerating every contraction spelling).
//
// ACCEPTED RESIDUAL #1 (see the consolidated block above import for the
// reasoning): kept at the user's explicit request even though it is a known
// exposure. Do not remove this as an oversight, and do not treat it as
// license to re-add its now-deleted siblings ("hold that thought", "give me
// a second", "let's move on", "moving on", "next question") as a consistency
// fix — those were cut because an interviewer says them UNPROMPTED,
// mid-interview, about their own agenda, which is a materially worse
// exposure than an interviewer echoing "question" back at the candidate.
const PIN_QUESTION_RE = /\b(?:good|great|interesting|tough|fair|excellent)\s+question\b/;
// "Let me think" (about that / for a second / …) — a stall only the person
// about to ANSWER says. Match the stable core, ignore whatever trails it.
const PIN_LET_ME_THINK_RE = /\blet me think\b/;
// "Let me take a step back" — an opener for reframing before answering.
const PIN_STEP_BACK_RE = /\blet me take a step back\b/;
// "Let me give you an example" / "Let me give you a concrete example".
// `an?` matches the bare "a" or "an", so one pattern covers both the plain
// and "concrete" framings without enumerating them separately.
const PIN_EXAMPLE_RE = /\blet me give you an? (?:concrete )?example\b/;
// "Let me walk you through …" — the candidate's own direction. Its mirror,
// "walk me through …", is the interviewer's direction (see questions.js's
// STARTERS, which lists "walk me" as an interviewer opener) and is a hard
// negative control below: the pronoun is the entire distinction, so this
// pattern must never loosen to match "walk me through" on its own.
const PIN_WALK_THROUGH_RE = /\blet me walk you through\b/;
// "Off the top of my head" — a hedge before an unprepared answer.
const PIN_TOP_OF_HEAD_RE = /\boff the top of my head\b/;

// AC-T1.6, REDESIGNED, then narrowed TWICE after adversarial passes each
// found a natural interviewer utterance for phrases that had been in this
// list. Release is the STRICT side of the asymmetry documented at the top
// of this file — an interviewer accidentally releasing a hold the candidate
// set deliberately, mid-answer, is a real harm, not a shrug — so unlike the
// pin cues above, a confirmed interviewer sentence here is grounds to cut,
// not to keep. Cut, each with the interviewer line that sank it:
//   - "let me know if you want more detail" — "Let me know if you want more
//     detail on the comp package."
//   - "happy to go deeper" — "We're happy to go deeper on comp later if
//     you'd like."
//   - "back to you" — the sharpest of the first round: it has no pronoun
//     asymmetry at all ("back to you" is exactly what an interviewer says to
//     open a NEW question and hand the candidate the floor — "Okay, back to
//     you, tell me about your experience" — the opposite of a candidate
//     signing off), so there was no narrowing that could have saved it.
//   - "that's the short version" — cut in the second round. Interviewers
//     condense the role, the comp and the process constantly, and this is
//     exactly the phrase they use to signal it: "That's the short version of
//     how our team is structured, happy to get into specifics later."
// Each of the above is now a hard negative control instead of a cue.
//
// What survives is the phrases said by the person who has just FINISHED
// answering, handing the conversation back, that no adversarial pass could
// find an interviewer saying. "That's how I'd approach it" replaced "that's
// the short version" as the third: only the person who was ASKED a question
// has an approach of their own to close on — an interviewer has no answer to
// sign off. "Unpin" — a command addressed to the app — was already gone from
// the first redesign for a different reason: nobody says it out loud.
//
// ACCEPTED RESIDUAL #2 on the two "answer" phrases below (see the
// consolidated block above import for the reasoning): both DO fire when the
// interviewer answers a question the CANDIDATE asked them.

// "Does that answer your/the question". Requires the full phrase
// contiguous, not just "answer" and "question" appearing somewhere in the
// same sentence (see the negative control "So I own the answer to that end
// to end", which contains "answer" with no "does that answer" anywhere).
const UNPIN_ANSWERS_QUESTION_RE = /\bdoes that answer (?:your|the) question\b/;
// "(I) hope that answers (it/your question/…)". "answers?" tolerates the
// singular "answer" some speakers use here too.
const UNPIN_HOPE_THAT_ANSWERS_RE = /\bhope that answers?\b/;
// "That's how I'd/I would approach it" — closing an answer by naming it as
// your own take. ID_SRC covers "I'd"/"I’d"/"Id"/"I would" the same way
// IVE_SRC covers "I've" above.
//
// Excludes a trailing "too" / "as well" / "either" (allowing punctuation and
// up to a couple of filler words in between, e.g. "approach it as well, for
// what it's worth"): that trailing word is the tell of an INTERVIEWER
// AGREEING with an approach the candidate just described, peer to peer — a
// person closing their OWN answer never appends it, because at that moment
// there is nothing yet to agree with. Confirmed against "If I were in your
// seat, that's how I'd approach it too." and "...as well, for what it's
// worth.", both of which fire without this guard. What survives past the
// guard is ACCEPTED RESIDUAL #3, documented in the consolidated block above
// import: the narrower case of an interviewer volunteering an unprompted
// peer opinion with no agreement marker to catch.
const UNPIN_APPROACH_RE = new RegExp(
  `\\b${THATS_SRC} how ${ID_SRC} approach it\\b(?!\\s*(?:,\\s*)?(?:\\w+\\s+){0,2}(?:too|as well|either)\\b)`
);

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
// cue is useful speech in its own right, not an incantation. Company is the
// STRICT, expensive side of the asymmetry documented at the top of this
// file — a match spends a real outbound request carrying the posting's
// details — so it gets the tightest guard of the three actions.
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
// cue), so pin/unpin/company here simply follows the order they are
// introduced in the acceptance criteria (T1, then T2).
const CUES = [
  {
    id: "pin-question",
    action: "pin",
    title: "Hold the question",
    summary:
      "Keeps this question on screen while you answer.",
    phrases: [
      "That's a great question.",
      "Let me think about that for a moment.",
      "Let me take a step back.",
      "Let me give you an example.",
      "Let me walk you through it.",
      "Off the top of my head, we ran about forty services.",
    ],
    patterns: [
      PIN_QUESTION_RE,
      PIN_LET_ME_THINK_RE,
      PIN_STEP_BACK_RE,
      PIN_EXAMPLE_RE,
      PIN_WALK_THROUGH_RE,
      PIN_TOP_OF_HEAD_RE,
    ],
  },
  {
    id: "unpin-question",
    action: "unpin",
    title: "Release the question",
    summary:
      "Follows new questions again when you are done.",
    phrases: ["Does that answer your question?", "I hope that answers it.", "That's how I'd approach it."],
    patterns: [UNPIN_ANSWERS_QUESTION_RE, UNPIN_HOPE_THAT_ANSWERS_RE, UNPIN_APPROACH_RE],
  },
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
//     says "Good question. ... Does that answer your question?" the thing
//     they said last is the operative intent. Ties on index fall to
//     whichever cue is declared earlier in VOICE_CUES (the comparison below
//     only replaces the current winner on a STRICTLY greater index).
//   - `actions` — the distinct actions that matched ANYWHERE in the
//     utterance, not just the winner's.
//   - `ambiguous` — true when `actions` has more than one member. A single
//     provider-final frame carrying both a pin cue and a release cue
//     ("Good question, and I hope that answers it.") is far more likely to
//     be narrative speech than sequential candidate intent, since finals
//     arrive only every few seconds. The caller
//     (useLiveSession.js) MUST NOT act on an ambiguous match — it still logs
//     `id`/`action`/`matchedAt` so the frame is traceable, it just doesn't
//     change any state on it. Repeating the SAME action twice ("Good
//     question, that's a really good question") is NOT ambiguous: only one
//     action is present in `actions` either way.
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
