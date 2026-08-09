// Pure decision rule (AC-M2) for practice mode: given one assembled turn
// from the single-microphone stream, is this someone ELSE in the room
// asking a question that deserves live drafting - as opposed to the
// candidate's own answer, or the candidate thinking out loud between
// questions? No imports, no React, no DOM, no browser globals - a straight
// function of its arguments, importable from this repo's node-only vitest
// config the same way answerSpeakers.js and utteranceAssembly.js already
// are. roomQuestions.test.js pins the exact semantics; read it before
// changing anything here.
//
// Two signals, and the order they are checked in is load-bearing:
//
//   1. `collecting` - is an answer currently being recorded? While it is,
//      EVERY turn is the candidate's answer by definition: pressing "Start
//      answering" IS the statement that what follows belongs to that
//      answer, no matter whose voice it actually is. This needs no
//      diarization at all, which is why it is checked first and why the
//      feature works before any speaker has been identified.
//   2. `myTag` - which speaker tag is the candidate's, learned from the
//      dominant tag of the previous completed answer (see
//      answerSpeakers.js's dominantTag). Only usable ONCE an answer has
//      completed; `null` until then.
//
// *** THE ASYMMETRY WITH LIVE MODE - DO NOT "FIX" THIS TO MATCH IT ***
// With NO speaker tag at all, this returns false. Live mode's equivalent
// gate (session.js / speakerIdentity.js) makes the OPPOSITE call and
// evaluates everything when it has no diarization at all. That is
// deliberate in both directions, not an inconsistency to reconcile:
//   - Live mode: the interviewer IS the other party on the call, so missing
//     their question is the catastrophic direction. Evaluating an untagged
//     turn there costs a wasted model call at worst.
//   - Practice mode: the drill already supplies its own question, and the
//     population is overwhelmingly solo (no second person in the room at
//     all). Every "detection" from an untagged frame in a solo session
//     would be a false positive - a spent model call and a question NOBODY
//     ASKED landing on the user's screen while they are mid-drill.
// A future reader who notices these two modules disagree and "aligns" them
// will reintroduce exactly the false-positive flood this rule exists to
// prevent.

// Deepgram/ElevenLabs speaker tags are small integers starting at 0, so a
// truthiness check on the tag itself would treat speaker 0 as "no tag" and
// make the first voice a provider numbers either always or never "the
// room" depending on which side of the comparison it landed on. `undefined`
// (the field omitted entirely) and `null` both mean "no tag"; only those
// two count as untagged.
function isUntagged(tag) {
  return tag === undefined || tag === null;
}

// { speakerTag, myTag, collecting } describes one assembled turn:
//   speakerTag - the diarized tag on this turn, or undefined/null if the
//                provider could not diarize it (or diarization is off).
//   myTag      - the candidate's tag as learned from the previous completed
//                answer's dominant speaker, or null before any answer has
//                completed (see answerSpeakers.js's dominantTag).
//   collecting - true while an answer is actively being recorded.
export function shouldTreatAsRoomQuestion({ speakerTag, myTag, collecting } = {}) {
  // Signal 1: mid-answer, everything is the candidate's by definition.
  // Evaluating here would also evict the very question the candidate is in
  // the middle of answering - an interviewer's "mhm" or interjection is not
  // a new question to draft.
  if (collecting) return false;

  // No tag at all: stay silent. See the header for why this is the
  // opposite of live mode's call in the same situation.
  if (isUntagged(speakerTag)) return false;

  // Signal 2: myTag is only learnable from a finished answer, so it is
  // `null` for the entire first turn (and any turn before the first answer
  // completes). A tagged voice in that window is still worth evaluating -
  // the LLM confirmation step downstream still has to agree it is actually
  // a question before anything reaches the screen.
  if (myTag === null || myTag === undefined) return true;

  // Both tags known: the room is whoever is NOT the candidate. Strict
  // inequality, not a truthiness check - see isUntagged's comment on why
  // tag 0 must be compared as a real value.
  return speakerTag !== myTag;
}
