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
//      completed; `null` until then, and `null` forever in a session whose
//      provider does not diarize. While it is `null` no turn is the room's -
//      a tag alone says someone spoke, not that it was someone else.
//
// *** THE ASYMMETRY WITH LIVE MODE - DO NOT "FIX" THIS TO MATCH IT ***
// Whenever this cannot tell a voice apart from the candidate's - no speaker
// tag at all, or a tag with no learned `myTag` to compare it against - this
// returns false and nothing is sent. Live mode's equivalent
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
  // `null` for the entire window before the candidate's first answer of the
  // session completes (and forever, in a session whose provider never
  // diarizes). This USED to return true there, on the argument that the LLM
  // confirmation step downstream would catch a false positive anyway. That
  // argument was wrong twice over, and the second way is the serious one:
  //   - A tag on the frame says only that SOMEONE spoke. With no myTag to
  //     compare it against, the candidate's own voice is indistinguishable
  //     from the room's, so the commonest case in that window - the
  //     candidate thinking out loud between questions, in a session where
  //     they are the only person present - was classified as the room.
  //   - "The LLM confirms it" is not a filter placed BEFORE the transfer. It
  //     IS the transfer: confirmQuestion posts the raw utterance to
  //     /api/copilot/detect (useRoomQuestions.js -> detectClient.js), and a
  //     confirmed one then posts the question text and the prep profile to
  //     /api/copilot/answer. The candidate's own words had already left the
  //     machine by the time anything "caught" them.
  // The disclosure this feature renders (app/copilot/practice/
  // practiceRoomQuestionPrivacy.js) promises egress only for what someone
  // ELSE in the room says. So an unattributable turn is silent, which also
  // makes this consistent with the untagged case just above: the app speaks
  // only about voices it can actually tell apart from the candidate's.
  //
  // The cost is real and deliberate: the first question a rehearsal partner
  // asks, before the candidate has answered anything, is not detected. That
  // is the same trade the untagged branch above already makes, and manual
  // entry (useRoomQuestions.js's addManualQuestion, which deliberately does
  // NOT come through here) is the route for it - an explicit statement about
  // someone else's question, rather than a guess about a voice.
  if (myTag === null || myTag === undefined) return false;

  // Both tags known: the room is whoever is NOT the candidate. Strict
  // inequality, not a truthiness check - see isUntagged's comment on why
  // tag 0 must be compared as a real value.
  return speakerTag !== myTag;
}
