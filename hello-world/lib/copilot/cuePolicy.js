// AC-V2. The policy that decides whether a spoken voice cue may act at all,
// and if so what it may do — extracted out of app/copilot/useVoiceCues.js so
// it can be exercised directly (this module has zero React in it) and, more
// importantly, so its two consumers cannot drift apart: useLiveSession.js
// ENFORCES this policy, VoiceCueSidebar.js STATES it to the user (V2.6). If
// the decision lived only inside the hook, the sidebar's sentence would be a
// hand-copied restatement of it, and the failure mode is the sidebar telling
// the user release still works after someone widens the hook's own gate.
// lib/copilot/groundingNotice.js's `companyResearchDestination` is the
// precedent for this shape: the component states no fact about behaviour on
// its own, it renders what a shared module says.
//
// THE DEFECT THIS EXISTS TO FIX, read off a real session the user recorded on
// 2026-08-25: ElevenLabs Scribe v2 Realtime has no realtime diarization, so
// session.js resolved EVERY frame's speaker to "them" for the whole session —
// including the candidate's own speech. The OLD useVoiceCues.js refused any
// frame where `speaker !== "you"`, so in that session not one voice cue could
// ever fire, and the downloaded log contained zero cue events of any kind.
// The feature was not misfiring; it was unreachable, and unreachable
// silently — there was no way for the user to tell "the phrase didn't match"
// apart from "cues don't work on this provider at all".
//
// *** THE ATTRIBUTION AXIS HAS FIVE VALUES, NOT TWO — READ BEFORE TOUCHING ***
// The naive fix is `attributeSpeakers && !dg.diarizationActive` computed as a
// single boolean. That breaks two things at once: `attributeSpeakers`
// defaults to true on EVERY source (tab/system never even look at it), and
// only "inperson" can ever set `dg.diarizationActive` in the first place. A
// two-value flag computed anywhere but inside session.js's own in-person
// start path reports tab/system sessions as "unavailable" too — and this
// module's whole job for "unavailable" is to relax the speaker gate, which on
// tab/system would let the INTERVIEWER's own audio (their tab, their system
// mix) hold and release the candidate's dashboard. That is a direct reversal
// of the tab/system separation this codebase already has for free. Separately,
// the meeting copilot (app/meeting/useMeetingSession.js) passes
// `attributeSpeakers: false` — "nobody asked", not "asked and refused" — and
// must not take the relaxed branch either.
//
// So the axis is five values, assigned by WHO can know them and WHEN:
//   - "not-applicable" and "off" are known at construction (tab/system never
//     have an identity to ask about; a meeting never requested one).
//   - "pending" is the in-person default until the socket reports back —
//     defaulting an unknown session to the relaxed arm would open the gate on
//     every session for its first seconds, before anyone knows whether
//     diarization actually worked.
//   - "active"/"unavailable" are learned by session.js's own in-person start
//     path, at the exact point it already checks `dg.diarizationActive`.
// qualifiesForCue below branches on `=== UNAVAILABLE` and nothing else, so
// every other value — active, off, not-applicable, and pending — falls
// through to exactly today's behaviour, byte-for-byte (V2.5).
export const SPEAKER_ATTRIBUTION = {
  ACTIVE: "active", // in-person, diarization requested AND earned
  UNAVAILABLE: "unavailable", // in-person, requested and NOT available
  OFF: "off", // in-person, never requested (the meeting copilot)
  NOT_APPLICABLE: "not-applicable", // tab/system: structural separation, no guess to make
  PENDING: "pending", // in-person, before the socket has reported back
};

// AC-V2.8. "Can this session tell voices apart?" — asked and answered ONCE,
// here, from the strongest evidence available, and read by every other export
// in this module. Nothing below branches on the raw `speakerAttribution`
// value; they all branch on what this returns.
//
// *** WHY THIS EXISTS AT ALL — THE SEAM BETWEEN A WARNING AND A PERMISSION ***
// `speakerAttribution` is derived from lib/copilot/stt/index.js's
// `diarizationActive = tokenFetchSucceeded && diarize && supportsDiarization`.
// The `tokenFetchSucceeded` term is deliberate and correct — R-151's rule that
// this app never claims a capability it has not confirmed — and it makes the
// flag UNDER-claim: the stream is still constructed with `diarize: true` and
// DeepgramStream.connect() fetches its OWN token, so a session whose token
// route blipped can genuinely diarize. It fills `speakerSnapshot.tags`, reaches
// confidence "high" and renders a working "Who's talking" correction bar, while
// this axis still reads "unavailable".
//
// A flag chosen to under-claim is a fine input to a WARNING — the user-facing
// sentence about what was CONFIGURED stays honest, and that is a different and
// still-true fact from what the session turned out to be able to do, which is
// why `speakerAttribution` itself and the session/STT layer are NOT changed by
// this. It is the wrong input to a PERMISSION decision, in BOTH directions:
//   - too permissive: the relaxed cue arm hands the INTERVIEWER's own
//     correctly-attributed speech the power to hold the candidate's dashboard;
//   - too restrictive, and the half that made this its own criterion: the same
//     session refuses the CANDIDATE's release and company cues with the reason
//     "cannot tell voices apart this session", and the sidebar tells them those
//     cues are button-only — in a session that demonstrably can tell voices
//     apart. Three consumers of one question, giving two different answers.
//
// Deriving it here rather than adding a tags check to each consumer is the
// whole point: the same rule written four times is four places to widen, and
// the fifth consumer added either repeats it or forgets it. The anti-drift
// invariant in cuePolicy.test.js ("a row carries a note iff the policy refuses
// it") then holds by CONSTRUCTION rather than by care, in the evidence
// dimension as well as the state one.
//
// The rule, exactly:
//   - UNAVAILABLE + at least one observed speaker tag -> ACTIVE. The evidence
//     outranks the flag: a tag is proof a voice was separated.
//   - every other state passes through untouched. Tags on a meeting session
//     (attribution deliberately OFF) or on tab/system must never promote either
//     into the in-person identity regime, and PENDING must not resolve itself.
//   - a missing or malformed snapshot is NO evidence, never an accidental
//     promotion — so a caller that passes no snapshot at all gets the
//     conservative answer (backward compatibility that fails SAFE).
export function effectiveAttribution(speakerAttribution, snapshot) {
  if (speakerAttribution !== SPEAKER_ATTRIBUTION.UNAVAILABLE) return speakerAttribution;
  // `Array.isArray` and nothing looser: `{ tags: "two" }` has a truthy
  // `.length` of 3 and is not evidence of anything.
  const tagsObserved = Array.isArray(snapshot?.tags) ? snapshot.tags.length : 0;
  return tagsObserved > 0 ? SPEAKER_ATTRIBUTION.ACTIVE : SPEAKER_ATTRIBUTION.UNAVAILABLE;
}

// AC-V2.4: a session must never again be unable to answer "why did nothing
// happen when I said the phrase". Every refusal path below gets its OWN
// string, checked distinct in cuePolicy.test.js, for two independent
// reasons: an aria-live region does not re-announce text that is unchanged
// from the last announcement (so two different refusals sharing one string
// would go silent the second time), and a downloaded session log with one
// reason standing for four different causes cannot answer the question this
// log exists to answer.
export const CUE_IGNORED_REASONS = {
  AMBIGUOUS: "ambiguous",
  IDENTITY: "speaker identity has not settled yet",
  ATTRIBUTION_UNAVAILABLE: "cannot tell voices apart this session",
  NO_QUESTION: "no question detected yet to hold",
  // AC-V2.4: the mirror of NO_QUESTION on the RELEASE side. A matched release
  // with nothing held used to fall through to no action and no log line at
  // all, so the session log showed a bare `cue.matched` and could not answer
  // "why did nothing happen when I said the phrase" — the one remaining case
  // where it could not. Deliberately worded as a DIFFERENT cause from
  // NO_QUESTION rather than reusing it: "there is no question to hold" and
  // "no question is being held" are two different situations for the person
  // reading the log back, and the distinctness case below is what keeps them
  // that way.
  NOTHING_HELD: "no question is being held",
  // AC-V2.3.1: the pin-side mirror of ATTRIBUTION_UNAVAILABLE, and the one
  // refusal in this list that this module cannot itself decide — whether a
  // hold is already in force is question state, which never enters this
  // file (see resolveCueAction's own note). The reason lives here anyway
  // because that is where every OTHER cause the session log can carry is
  // named, and a log with one cause missing from the enumeration is exactly
  // what AC-V2.4 exists to prevent. Worded as a DIFFERENT cause from
  // NOTHING_HELD: "a question is already being held" (so a second hold cue
  // may not move it) and "no question is being held" (so a release cue has
  // nothing to act on) are opposite situations, and the distinctness case
  // below is what keeps them readable as such.
  HOLD_ALREADY_IN_FORCE: "a question is already being held",
  COMPANY_UNAVAILABLE: "company brief unavailable",
};

// May this frame carry a cue at all? Returns one of:
//   null                    -> no: interim, a re-delivery, or the wrong voice
//   { blocked: "identity" } -> in-person, diarization is active but identity
//                              has not settled on this frame's speaker yet
//   { evaluate: true }      -> yes; the caller runs matchVoiceCue on the
//                              frame's own transcript text
//
// Does NOT match text, does not know what a question or a pin is, does not
// read a clock, and does not decide what happens once a match comes back —
// see resolveCueAction below for the second half of that decision.
export function qualifiesForCue({ frame, snapshot, source, speakerAttribution }) {
  const { isFinal, textAlreadyDelivered, speaker } = frame || {};

  // An interim is rewritten several times a second as the provider refines
  // it — matching a cue against interims fires once per rewrite for one
  // spoken phrase, not once for the phrase itself. True regardless of
  // attribution, so this (and the re-delivery check below) run BEFORE the
  // UNAVAILABLE branch, not inside its "otherwise" arm.
  if (isFinal !== true) return null;

  // R-127: a provider final whose TEXT was already delivered on an earlier
  // final — the second member of an ElevenLabs commit pair. It is not a
  // duplicate frame and it does not repeat the earlier one's span; it
  // usually carries a span the earlier one did not have (see
  // lib/copilot/stt/index.js's onTranscript contract). What matters HERE is
  // only the text, because text is the entire input to a cue match: matching
  // the same words again would fire the same cue twice. On ElevenLabs this
  // is EVERY final, so without this check an UNAVAILABLE session newly able
  // to see a cue at all would fire every one of them twice — a duplicate
  // "does that answer your question" would release a hold it already
  // released, and a duplicate pin would re-pin FORWARD a second time to
  // whatever is latest by then.
  //
  // This is one of the few consumers for which "skip the flagged frame
  // wholesale" is genuinely right, and it is right because this function
  // reads NOTHING but the text. A consumer that also wants the timing must
  // not copy this shape — see AC-V1.8 and the pace samplers in
  // useLiveSession.js / usePracticeCaptureSession.js, which gate on the span
  // instead and had exactly this defect.
  if (textAlreadyDelivered === true) return null;

  // *** AC-V2.2/C2 — SKIP BOTH GATES, NOT ONLY THE SPEAKER ONE ***
  // The single most likely way to implement V2.2 and still ship a dead
  // feature: relaxing only `speaker !== "you"` below leaves the in-person
  // identity gate (`overridden || confidence === "high"`) standing, and that
  // gate is UNSATISFIABLE in exactly the sessions this branch exists to
  // rescue. Without diarization there are no speaker tags at all, so
  // `speakerIdentity` never observes a second voice, confidence never leaves
  // "unknown", and there is no tag for a manual override to name. Implement
  // this literally as "only relax the speaker check" and every frame still
  // returns `{ blocked: "identity" }` — the log fills with cue.ignored and
  // the feature is exactly as unreachable as it was before this file existed.
  //
  // Skipping both is safe because the identity gate exists to stop a DISPLAY
  // GUESS from acting (an argmax that might be looking at the wrong tag) —
  // where there is no guess being made at all, there is nothing for that gate
  // to protect against. The protection that remains for this state is
  // resolveCueAction's action filter below (V2.3): only `pin` may act, and a
  // false hold is the cheap side of voiceCues.js's own documented asymmetry.
  // *** AC-V2.2.1/C2 — THE GATE NEEDS A STRONGER INPUT THAN THE FLAG ***
  // The arm opens on EVIDENCE, not on the raw flag: only while no speaker tag
  // has ever been observed. That is precisely the session it was written for
  // (no diarization means no tags, ever — which is also why the identity gate
  // below is unsatisfiable there), and the moment a tag proves otherwise this
  // falls straight through to today's gates, with no new state to keep and
  // nothing to un-stick by hand. Under-claiming HERE would cost the candidate
  // their panel: it would hand the INTERVIEWER's own correctly-attributed
  // speech the power to hold their dashboard, on a session that could have
  // told the two voices apart perfectly well.
  //
  // AC-V2.8: the tags check that used to sit inline right here now lives in
  // `effectiveAttribution` above, because three other consumers were asking
  // the same question and two of them were getting a different answer. Read
  // that function's header for the full argument; nothing in this file
  // branches on the raw `speakerAttribution` value any more.
  const effective = effectiveAttribution(speakerAttribution, snapshot);
  if (effective === SPEAKER_ATTRIBUTION.UNAVAILABLE) {
    return { evaluate: true };
  }

  // Everything below is today's behaviour, unchanged, for every OTHER
  // attribution value — active (a diarizing in-person session), off (the
  // meeting copilot), not-applicable (tab/system), and pending (before the
  // socket has reported back). None of these four ever reach the branch
  // above, so none of them can be swept into the relaxed rule meant for
  // exactly one of the five (V2.5) — and since C2, nor does the fifth once
  // its own session has produced evidence that identity works after all.
  if (speaker !== "you") return null;

  if (source === "inperson") {
    const snap = snapshot || {};
    if (!(snap.overridden === true || snap.confidence === "high")) {
      return { blocked: "identity" };
    }
  }

  return { evaluate: true };
}

// Given a matchVoiceCue result for a frame that qualified (or the
// `{ blocked: "identity" }` marker qualifiesForCue can also produce), what
// may actually be done? Returns `{ act, ignoredReason }`, where `act` is one
// of "pin" | "unpin" | "company" | null.
//
// Deliberately does not decide what happens when `act` is "pin" but there is
// nothing to pin — that stays useQuestionPin's own `null` return, turned into
// CUE_IGNORED_REASONS.NO_QUESTION by the caller, because the caller is the
// one that actually attempted the pin and knows it came back empty; this
// module never touches question state at all.
//
// AC-V2.8: takes the session's `snapshot` alongside the attribution flag, and
// asks `effectiveAttribution` the one question rather than re-reading the flag.
// A caller that passes no snapshot gets the conservative answer — today's
// behaviour, unchanged — so this stays backward compatible and fails SAFE.
export function resolveCueAction({ match, speakerAttribution, snapshot }) {
  if (match?.blocked === "identity") {
    return { act: null, ignoredReason: CUE_IGNORED_REASONS.IDENTITY };
  }

  // Two intents in one provider-final frame ("Good question, and I hope that
  // answers it.") reads as narrative speech, not sequential candidate
  // intent — finals arrive only every few seconds, so a genuine "pin, then
  // later unpin" would almost never land in the SAME frame. Decided ahead of
  // the attribution arm below: whether nobody can tell voices apart has
  // nothing to do with why a single frame carrying two actions is refused.
  if (match?.ambiguous) {
    return { act: null, ignoredReason: CUE_IGNORED_REASONS.AMBIGUOUS };
  }

  // AC-V2.3: this is the asymmetry voiceCues.js's own header already
  // documents, applied to the one state where nobody can say whose voice a
  // frame carries. A false HOLD holds the question the candidate is already
  // reading and expires on its own in 120s — cheap, often even wanted. A
  // false RELEASE yanks away a hold the candidate set deliberately, mid-
  // answer. A false COMPANY spends a real outbound request carrying the
  // posting's details. So when attribution is unavailable, `pin` is the only
  // action allowed through; `unpin` and `company` are refused with a reason
  // that names the actual cause, not a generic "ignored".
  //
  // *** AC-V2.3.1 — THE ASYMMETRY ABOVE HOLDS ONLY WHILE NOTHING IS HELD ***
  // "A false hold is cheap because it holds the question the candidate is
  // already reading" is true when there is no hold to disturb. It is FALSE
  // for a SECOND pin cue: useQuestionPin.pinCurrentQuestion always pins
  // `latestQuestionEntry` and clears `supersededAt` (AC-T1.16.1's deliberate
  // "re-pin FORWARD"), so a second cue MOVES an existing hold onto the newest
  // question — the same harm the unpin refusal below exists to prevent,
  // through the other door. That refusal is NOT made here: this module is
  // pure and cannot see whether a hold exists, and teaching it would put
  // question state into a policy module. It is made at the action site,
  // app/copilot/useCueActions.js's pin branch, which owns `pinnedIdRef`, and
  // it logs CUE_IGNORED_REASONS.HOLD_ALREADY_IN_FORCE above. `pin` therefore
  // still passes this gate: the policy's answer is "a hold cue may act", and
  // "may it act THIS time" is the caller's question.
  //
  // AC-V2.8: this refusal used to read the raw flag, so a token-blip session
  // that could demonstrably tell voices apart still had the candidate's own
  // release and company cues refused with the reason "cannot tell voices apart
  // this session" — a refusal whose stated cause was simply false, written
  // into the downloaded log AC-V2.4 exists to make answerable.
  if (
    effectiveAttribution(speakerAttribution, snapshot) === SPEAKER_ATTRIBUTION.UNAVAILABLE &&
    match?.action !== "pin"
  ) {
    return { act: null, ignoredReason: CUE_IGNORED_REASONS.ATTRIBUTION_UNAVAILABLE };
  }

  return { act: match?.action ?? null, ignoredReason: null };
}

// AC-V2.6. The user-facing half of this same policy, read by
// VoiceCueSidebar.js so its sentence can never drift from what
// resolveCueAction actually does. Both return "" (render nothing) in every
// state except UNAVAILABLE — the only state where any cue's availability
// differs from what the sidebar's existing copy already promises.

// One sentence describing the degraded state as a whole. Rendered by
// VoiceCueSidebar in BOTH its collapsed and expanded branches — V2.6 says
// this "must not depend on the panel being open", and collapsed is the state
// a LIVE session is actually in, which is the only state any of this matters
// in at all (mirrors that file's own BL-2 reasoning for its mic/delay note).
//
// AC-V2.6.2/C4 (accessibility audit). WCAG 3.3.2 Labels or Instructions: an
// instruction that is false is worse than no instruction. This sentence used
// to end "…only from their buttons below" in BOTH branches. That is true of
// the expanded rail and false of the collapsed one, whose whole tree holds a
// single button — the expand toggle — sitting ABOVE this notice. Collapsed is
// the state a live session is actually in, so the wrong half was the half
// that mattered.
//
// The variant lives here rather than in the component for the same reason
// every other sentence on this axis does: VoiceCueSidebar.js states the
// policy, it does not restate it. That file already solved this exact problem
// once for its own copy and left the note — MIC_NOTE_SHORT drops "the buttons
// above" "on purpose: collapsed renders no buttons" — and the shared string
// simply never got the same treatment. Only the "how to reach them" clause
// differs; the fact being disclosed is identical in both, which
// cuePolicy.test.js asserts directly so the two cannot drift into two
// different claims about what works.
const AVAILABILITY_NOTICE_LEAD =
  "Your speech-to-text provider can't tell voices apart this session, so only holding a question works from a spoken cue — releasing it and referencing the company still work, but only from their buttons";

//
// AC-V2.8: `snapshot` rides in the options bag beside `collapsed`, and the
// state test goes through `effectiveAttribution`. Without it this sentence told
// the user their release and company cues were button-only in a session where
// the policy had just started permitting them — the same class of defect as a
// privacy notice describing a transfer that does not happen. Omitting the
// snapshot keeps today's (conservative) wording.
export function cueAvailabilityNotice(speakerAttribution, { collapsed = false, snapshot } = {}) {
  if (effectiveAttribution(speakerAttribution, snapshot) !== SPEAKER_ATTRIBUTION.UNAVAILABLE) return "";
  // Defaults to the expanded wording on a bare one-argument call: a caller
  // that has not been taught about the rail's collapse state is, by
  // definition, not the collapsed rail.
  if (collapsed) return `${AVAILABILITY_NOTICE_LEAD}: expand this rail to reach them.`;
  return `${AVAILABILITY_NOTICE_LEAD} below.`;
}

// A short per-row note for exactly the rows resolveCueAction refuses in this
// state — never the pin row, always the other two while UNAVAILABLE. Kept in
// lockstep with resolveCueAction by construction (see the anti-drift test in
// cuePolicy.test.js, which checks every action against every attribution
// value): a row carries a note if and only if the policy would refuse a
// spoken match for it.
//
// AC-V2.8: same `snapshot`, same single derivation. Because both this and
// resolveCueAction now ask `effectiveAttribution` rather than each testing the
// flag themselves, the anti-drift invariant holds across the evidence dimension
// too — cuePolicy.effective.test.js walks every state against both a
// tags-present and a tags-absent snapshot to prove it.
export function cueRowNote(action, speakerAttribution, { snapshot } = {}) {
  if (effectiveAttribution(speakerAttribution, snapshot) !== SPEAKER_ATTRIBUTION.UNAVAILABLE) return "";
  if (action === "pin") return "";
  return "Button only this session — this provider can't tell whose voice said it.";
}
