// Which observed voice is the user, on a single shared microphone
// (AC-M1.3). A NEW pure module: the only import allowed is `detectQuestion`
// from ./questions, no React, no DOM, no browser globals, no timers — every
// function here is a straight function of its arguments, importable and
// testable from this repo's node-only vitest config the same way
// answerWindow.js and livePace.js already are.
//
// *** READ THIS BEFORE TOUCHING THE CONFIDENCE GATE (AC-M1.3.4) ***
// An earlier version of this module scored `youScore = wordShare` alone and
// called "high" confidence as soon as one speaker had noticeably more word
// share than the other. Run against two ordinary interview openings — not
// imagined, actually run — it elected the INTERVIEWER as the user at "high"
// confidence both times, after which the copilot stopped evaluating their
// speech for questions and went silently deaf for the rest of the
// interview: the worst failure mode this feature has, because the user has
// no way to notice it happened. The two scenarios that broke it are
// reproduced as comments on the clauses inside scoreSpeakers below, and are
// pinned as tests in speakerIdentity.test.js under "the two counterexamples
// that broke v1". Do not delete a clause because it looks redundant with
// another one — both counterexamples were produced by RUNNING the formula,
// and each is blocked by a SPECIFIC clause, named below. Removing the
// "wrong" one un-blocks a real counterexample, not a hypothetical one.

import { detectQuestion } from "./questions";

// AC-M1.3.4, clause 6: the minimum lead the argmax speaker must hold over
// the runner-up before the ranking is trusted at all.
const MARGIN_THRESHOLD = 0.15;

// AC-M1.3.4, clause 5: the absolute word-COUNT floor the argmax speaker
// must clear. Deliberately a count, not a share — see the "ordinary
// politeness" counterexample on the clause below for why a share-based
// test cannot stand in for this one.
const MIN_ARGMAX_WORDS = 40;

// AC-M1.3.4, clause 2: total turns, summed across every observed tag, that
// must have accumulated before confidence can leave "low".
const MIN_TOTAL_TURNS = 4;

// Evidence objects arrive with STRING keys — object literals coerce
// integer-like keys to strings, and `Object.keys` always returns strings —
// but every consumer of a tag (scoreSpeakers' return value, this module's
// own `userTag`) is asserted against with strict `toBe(<number>)`. Every
// tag this module hands back to a caller is funnelled through this
// coercion so that never fails on type instead of on logic.
function toTagNumber(tag) {
  if (tag === undefined || tag === null) return null;
  const n = Number(tag);
  return Number.isFinite(n) ? n : null;
}

// Simple whitespace word count. Deliberately NOT imported from
// answerMetrics.js's countWords — this module may import nothing beyond
// ./questions (see the header comment), so a second, local, trivial
// splitter is the correct call here rather than widening the import list.
function countWords(text) {
  const trimmed = String(text || "").trim();
  return trimmed ? trimmed.split(/\s+/).length : 0;
}

// AC-M1.3.3 — the ranking. `youScore(tag) = wordShare(tag) - 2 *
// questionRate(tag)`: the candidate talks the most and asks the fewest
// questions; the interviewer does the opposite. The 2x weight on
// questionRate is load-bearing, not decorative — deleting the term (or
// weighting it at 1x) flips the winner on several scoreSpeakers tests; see
// "weights the question-rate penalty at 2x, not 1x" in
// speakerIdentity.test.js for a worked example where 1x and 2x disagree.
//
// This ranking ALONE is not safe to act on — that is the entire point of
// the confidence gate below. It is only a pre-selection hint: which tag
// would be crowned IF the evidence were trustworthy enough, never a claim
// that it already is.
export function scoreSpeakers(evidence) {
  const tags = Object.keys(evidence || {}).map((key) => ({ key, tag: toTagNumber(key) }));
  const totalWords = tags.reduce((sum, { key }) => sum + ((evidence[key] || {}).words || 0), 0);

  const scores = {};
  const perTag = tags
    .map(({ key, tag }) => {
      const { turns = 0, words = 0, questionTurns = 0 } = evidence[key] || {};
      const wordShare = totalWords > 0 ? words / totalWords : 0;
      const questionRate = turns > 0 ? questionTurns / turns : 0;
      const score = wordShare - 2 * questionRate;
      scores[tag] = score;
      return { tag, turns, words, questionTurns, score };
    })
    // Deterministic tie-break (AC-M1.3.3: "ties resolve to the lowest tag
    // id"). Sorting ascending by tag id first means the argmax loop below
    // keeps whichever entry it saw FIRST — the lower tag id — whenever two
    // scores compare equal, rather than whichever happened to be scanned
    // last. For a plain object with integer-like keys JS already iterates
    // ascending, so this is belt-and-braces determinism, not a behavior
    // change from "first encountered wins".
    .sort((a, b) => a.tag - b.tag);

  if (perTag.length === 0) {
    return { userTag: null, confidence: "unknown", scores };
  }

  let argmax = perTag[0];
  for (let i = 1; i < perTag.length; i += 1) {
    if (perTag[i].score > argmax.score) argmax = perTag[i];
  }

  const totalTurns = perTag.reduce((sum, entry) => sum + entry.turns, 0);
  const runnerUpScore = perTag
    .filter((entry) => entry !== argmax)
    .reduce((max, entry) => Math.max(max, entry.score), -Infinity);
  const margin = argmax.score - runnerUpScore;

  // AC-M1.3.4 — six clauses, ALL required for "high". Every one of these
  // exists because a real, ordinary interview opening satisfied every OTHER
  // clause and still would have elected the wrong speaker as the user.
  const atLeastTwoVoices = perTag.length >= 2;
  // Clause 1. Blocks crowning a user from a single voice, however much it
  // says: one speaker talking is not evidence about who the OTHER voice is.
  // See speakerIdentity.test.js "never reports high from a single voice".

  const enoughTurns = totalTurns >= MIN_TOTAL_TURNS;
  // Clause 2. Blocks resolving identity in the first couple of seconds,
  // before there has been enough back-and-forth to say anything at all.

  const someoneAsked = perTag.some((entry) => entry.questionTurns >= 1);
  // Clause 3. Blocks the "interviewer preamble" counterexample: interviewer
  // gives a 3-turn, 29-word, ZERO-question opening ("Thanks for making the
  // time." / "I'll give you a quick overview…" / "We're about twelve
  // engineers…"); candidate replies "Sounds good." (2 words). Word share
  // alone is ~0.94 vs ~0.06 — nobody has asked anything yet, so there is no
  // basis to call identity "resolved" regardless of how lopsided the word
  // count is.

  const argmaxAskedNothing = argmax.questionTurns === 0;
  // Clause 4. Blocks crowning a speaker who has THEMSELVES asked a question
  // as the user — a voice that asks questions reads, on its face, as the
  // interviewer's role, however much it also happens to be talking.

  const argmaxWordFloor = argmax.words >= MIN_ARGMAX_WORDS;
  // Clause 5. Blocks the "ordinary politeness" counterexample, which
  // clauses 3 and 4 above do NOT catch: interviewer says "Hi, thanks for
  // joining." / "Good, thanks." (6 words, 0 questions); candidate replies
  // "Thanks for having me, how are you?" / "Great, shall we start?" (11
  // words, BOTH trip detectQuestion on the trailing "?", so the candidate's
  // questionRate is 1.0). On this evidence the conversation genuinely LOOKS
  // inverted — the interviewer really did ask zero questions and the
  // candidate really did ask two — so clauses 3 and 4 both pass for the
  // WRONG speaker. Only the absolute word floor stops it: the argmax (the
  // interviewer) has 6 words, nowhere near 40. This is why the floor is a
  // raw count and must never be swapped for another share-based test — a
  // share can look decisive when both sides have said almost nothing.

  const marginClearsThreshold = margin >= MARGIN_THRESHOLD;
  // Clause 6. Blocks a near-tie from being treated as resolved — see
  // speakerIdentity.test.js "requires a margin over the runner-up - 0.13 is
  // too close to call".

  const isHighConfidence =
    atLeastTwoVoices &&
    enoughTurns &&
    someoneAsked &&
    argmaxAskedNothing &&
    argmaxWordFloor &&
    marginClearsThreshold;

  let confidence;
  if (totalTurns === 0) confidence = "unknown";
  else if (isHighConfidence) confidence = "high";
  else confidence = "low";

  return { userTag: argmax.tag, confidence, scores };
}

// AC-M1.3.2 — `observe` must be called once per ASSEMBLED UTTERANCE (see
// utteranceAssembly.js), never once per raw transcript frame. With
// `endpointing=300` Deepgram emits many `is_final` frames per utterance;
// feeding each one here would inflate `turns` (the >= 4 gate would clear in
// about two seconds of ordinary back-and-forth) and would destroy
// `questionRate`, since only an utterance's FINAL frame typically carries
// the "?". Getting that assembly right is the caller's job, not this
// module's — this module just trusts whatever `observe` is called with.
export function createSpeakerIdentity() {
  let evidence = {};
  let userTag = null;
  let confidence = "unknown";
  let overridden = false;

  function recompute() {
    const result = scoreSpeakers(evidence);
    userTag = result.userTag;
    confidence = result.confidence;
  }

  function observe({ speakerTag, text } = {}) {
    const tag = toTagNumber(speakerTag);
    if (tag === null) {
      // AC-M1.3.8: no speakerTag at all means diarization is inactive for
      // this observation — there is nothing to attribute it to, so it
      // contributes NO evidence for anyone. Without this early return, a
      // single undiarized utterance would read as "one tag, one turn" and
      // resolve to "low" confidence (AC-M1.3.4's >=1-turn rule) instead of
      // staying "unknown" — see speakerIdentity.test.js "labels an
      // undiarized frame unknown rather than guessing".
      return;
    }

    const entry = evidence[tag] || { turns: 0, words: 0, questionTurns: 0 };
    entry.turns += 1;
    entry.words += countWords(text);
    if (detectQuestion(text).isQuestion) entry.questionTurns += 1;
    evidence[tag] = entry;

    if (overridden) {
      // AC-M1.3.6: a manual correction is permanent for the session.
      // Evidence keeps accumulating — swap() below needs to know what tags
      // have actually been observed — but it must never be allowed to move
      // userTag/confidence again once a human has pinned them.
      return;
    }

    recompute();
  }

  function labelFor(tag) {
    const t = toTagNumber(tag);
    if (t === null) return "unknown";

    if (userTag !== null && t === userTag) {
      if (overridden) return "you";
      // AC-M1.3.7: never say "you" from a single observed voice — a lone
      // speaker is not evidence about who the OTHER one is, and doing so on
      // an interviewer's opening line is the visible form of the
      // catastrophic mislabel this whole module exists to prevent.
      if (Object.keys(evidence).length >= 2) return "you";
    }

    return t in evidence ? "them" : "unknown";
  }

  function shouldEvaluateAsQuestion(tag) {
    const t = toTagNumber(tag);
    // AC-M1.3.5: false ONLY when this tag IS the resolved user tag AND
    // identity is either overridden or genuinely "high" confidence. Every
    // other case — including every tag during cold start, and the resolved
    // user's own tag while confidence is merely "low" — evaluates true.
    //
    // The asymmetry is deliberate. Missing the interviewer's question is
    // silent and permanent: the copilot goes deaf mid-interview with no way
    // for the user to notice. Mislabeling the user as the interviewer just
    // means over-evaluating their own speech, which is visible and bounded
    // elsewhere — the caller (session.js, AC-M1.4.9) marks such detections
    // "provisional" per AC-M1.3.5 rather than letting one evict a settled
    // question from the dashboard. That bookkeeping lives outside this pure
    // module; this function only ever answers "should detection run", never
    // "how should the result be treated".
    if (userTag === null || t === null || t !== userTag) return true;

    // AC-S2.5 — PROPERTY: identity may suppress a tag only while some OTHER
    // tag remains observed to carry the evaluation. Suppressing userTag is
    // only ever a claim of the form "skip this one, the other voice is
    // covered" — and that claim is false whenever userTag is the ONLY tag
    // evidence has ever seen. On a shared room mic diarization very often
    // resolves everyone to a single tag; if that lone tag also happens to be
    // userTag (a user correction, or even scoreSpeakers' single-voice
    // argmax), honoring overridden/"high" here would suppress the only voice
    // there is — not "the interviewer minus the user", but everyone,
    // permanently, with no way for the user to notice. That is strictly
    // worse than the failure mode this whole module exists to avoid (see the
    // module header and speakerIdentity.deafness.test.js), so evaluation has
    // to win whenever no other tag is there to pick up the slack.
    const anotherTagObserved = Object.keys(evidence).some((key) => toTagNumber(key) !== userTag);
    if (!anotherTagObserved) return true;

    return !(overridden || confidence === "high");
  }

  function setUserTag(tag) {
    userTag = toTagNumber(tag);
    confidence = "high";
    overridden = true;
  }

  function swap() {
    // AC-M1.3.6: a two-tag convenience — move the user tag to whichever
    // OTHER observed tag exists. Not "the second tag ever seen": the tag
    // that currently is not userTag, so this stays correct even if called
    // more than once.
    const other = Object.keys(evidence)
      .map(Number)
      .find((t) => t !== userTag);

    // AC-S2.6: do not claim a correction that could not actually be made. If
    // there is no other observed tag, there is nothing to swap TO — leave
    // userTag and the override state exactly as they were and let the caller
    // discover nothing changed. Setting confidence/overridden anyway would
    // pin a belief nobody expressed, and — per the AC-S2.5 property above —
    // userTag would then be the only tag in evidence, so
    // shouldEvaluateAsQuestion would suppress it and go deaf for the rest of
    // the session for no reason at all.
    if (other === undefined) return;

    userTag = other;
    confidence = "high";
    overridden = true;
  }

  function snapshot() {
    // AC-M1.5.6: the sorted list of every tag actually observed, as NUMBERS
    // — `speakerDisplayLabel` below needs this (alongside `userTag`) to tell
    // "exactly two voices heard" (-> "Them") apart from "a third voice has
    // joined" (-> numbered "Speaker N"), and a UI correction control needs
    // it to know which tags even exist to offer. `Object.keys` returns
    // strings; every tag leaving this module is coerced back to a number,
    // same discipline as `userTag` above.
    const tags = Object.keys(evidence)
      .map(Number)
      .sort((a, b) => a - b);
    return { userTag, confidence, overridden, tags };
  }

  function reset() {
    evidence = {};
    userTag = null;
    confidence = "unknown";
    overridden = false;
  }

  return { observe, labelFor, shouldEvaluateAsQuestion, setUserTag, swap, snapshot, reset };
}

// AC-M1.5.6 — the string the transcript actually renders for a turn, given
// the CURRENT identity snapshot. Lives here rather than inside
// TranscriptView.js (which `speakerLabelFor` calls into) purely so it is
// reachable from this repo's node-only vitest config — same reasoning as
// every other function in this module.
//
// Two voices read as "You"/"Them" — today's vocabulary everywhere else in
// this UI (`labelFor` above already returns lowercase "you"/"them" for
// exactly this reason). A third voice cannot be "Them" without implying
// there is only one other person, so anything past two voices falls back to
// Otter's neutral "Speaker N" placeholder, numbered from the tag itself
// (`tag + 1`) so a label never renumbers as later voices are observed —
// see "keeps a voice's number stable when another voice joins later" in
// speakerIdentity.test.js.
//
// Two independent reviewers flagged this function as a confirmed BLOCKER:
// it returned "You" for ANY tag === snapshot.userTag, with no confidence
// guard at all. scoreSpeakers sets userTag as soon as ANY evidence exists —
// including a single observed voice at "low" confidence (see scoreSpeakers
// above and its `atLeastTwoVoices` clause) — so after the very first
// utterance the snapshot was `{ userTag: 0, confidence: "low", tags: [0] }`
// and this function said "You" for it. In an in-person interview the
// interviewer almost always speaks first, so their opening question rendered
// under a "You" chip and the candidate read their interviewer's words as
// their own. That is the exact catastrophic mislabel `labelFor` above
// already guards against (AC-M1.3.7) — this function's header comment
// claimed it enforced "the same rule `labelFor` enforces" while actually
// enforcing a strictly weaker one. It now requires the identity to be
// genuinely settled before saying "You": either a human correction
// (`overridden === true`, which is authoritative regardless of confidence —
// see createSpeakerIdentity.setUserTag/swap), or the scoring gate itself
// having reached "high" confidence with at least two voices heard. A
// presumed-user tag that is merely `userTag` at "low" confidence — a guess,
// not a resolution — falls through to the neutral numbered `Speaker N` form
// below instead.
export function speakerDisplayLabel(tag, snapshot = {}) {
  const t = toTagNumber(tag);
  const userTag = toTagNumber(snapshot?.userTag ?? null);
  const tags = Array.isArray(snapshot?.tags) ? snapshot.tags : [];
  const overridden = snapshot?.overridden === true;
  const confidence = snapshot?.confidence;

  const identitySettled = overridden || (confidence === "high" && tags.length >= 2);

  if (t !== null && userTag !== null && t === userTag && identitySettled) return "You";

  // "Them" only when exactly two voices have EVER been observed and this
  // tag is one of them (and, per the guard above, is not the user) — a tag
  // outside that pair (e.g. a correction naming a not-yet-heard tag) falls
  // through to the numbered form below instead of being misclassified as
  // "the other one" of a pair it was never part of.
  if (t !== null && tags.length === 2 && tags.includes(t) && t !== userTag) {
    return "Them";
  }

  if (t === null) return "unknown";

  return `Speaker ${t + 1}`;
}
