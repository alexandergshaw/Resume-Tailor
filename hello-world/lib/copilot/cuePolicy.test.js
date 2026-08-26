import { describe, expect, it } from "vitest";
import {
  SPEAKER_ATTRIBUTION,
  CUE_IGNORED_REASONS,
  qualifiesForCue,
  resolveCueAction,
  cueAvailabilityNotice,
  cueRowNote,
} from "./cuePolicy";

// AC-V2. The policy that decides whether a spoken cue may act, extracted out
// of app/copilot/useVoiceCues.js so it can be exercised at all and so its two
// consumers — the hook that ENFORCES it and the sidebar that STATES it to the
// user — cannot drift apart.
//
// The defect this exists to fix, read off a real session the user recorded on
// 2026-08-25: ElevenLabs Scribe v2 Realtime has no realtime diarization, so
// session.js resolves EVERY frame's speaker to "them" — including the
// candidate's own speech. useVoiceCues refuses any frame where
// `speaker !== "you"`, so in that session not one cue could fire, and the
// downloaded log contained zero cue events of any kind. The feature was not
// misfiring; it was unreachable, and unreachable silently.
//
// The asymmetry this policy is built on is voiceCues.js's own, and it must
// not be quietly reversed by the fix: a false HOLD holds the question the
// candidate is already looking at and expires by itself in 120s; a false
// RELEASE yanks away a hold set deliberately, mid-answer; a false COMPANY
// spends an outbound request carrying the posting's details. So when nobody
// can tell who spoke, hold is allowed and the other two are not.

const FINAL_FROM_THEM = {
  isFinal: true,
  speaker: "them",
  transcript: "That's a great question.",
};

const SETTLED = { overridden: false, confidence: "high", userTag: 1, tags: [] };
const UNSETTLED = { overridden: false, confidence: "unknown", userTag: null, tags: [] };

describe("qualifiesForCue — frame shape gates (unchanged by V2)", () => {
  it("refuses an interim frame whatever the attribution is", () => {
    // An interim is rewritten several times a second as the provider refines
    // it, so matching against interims fires once per rewrite for one spoken
    // phrase. True in every attribution state, which is why this is asserted
    // in the one where every other gate is relaxed.
    for (const speakerAttribution of Object.values(SPEAKER_ATTRIBUTION)) {
      expect(
        qualifiesForCue({
          frame: { ...FINAL_FROM_THEM, isFinal: false },
          snapshot: SETTLED,
          source: "inperson",
          speakerAttribution,
        }),
      ).toBeNull();
    }
  });

  it("refuses a frame whose text was already delivered, whatever the attribution is", () => {
    // R-127 / AC-V1: a provider re-delivering a final's exact text purely to
    // carry speechFinal must not fire the cue a second time. On ElevenLabs
    // that is EVERY final (see the commit-pair defect), so without this an
    // unavailable-attribution session would double-fire every cue it newly
    // becomes able to see.
    for (const speakerAttribution of Object.values(SPEAKER_ATTRIBUTION)) {
      expect(
        qualifiesForCue({
          frame: { ...FINAL_FROM_THEM, textAlreadyDelivered: true },
          snapshot: SETTLED,
          source: "inperson",
          speakerAttribution,
        }),
      ).toBeNull();
    }
  });
});

describe("qualifiesForCue — attribution unavailable (AC-V2.2)", () => {
  it("evaluates a frame the current code refuses, because nobody can say whose voice it is", () => {
    expect(
      qualifiesForCue({
        frame: FINAL_FROM_THEM,
        snapshot: UNSETTLED,
        source: "inperson",
        speakerAttribution: SPEAKER_ATTRIBUTION.UNAVAILABLE,
      }),
    ).toEqual({ evaluate: true });
  });

  it("skips the identity gate too, not only the speaker gate", () => {
    // The single most likely way to implement V2.2 and still ship a dead
    // feature. Without diarization there are no speaker tags at all, so
    // confidence can never leave "unknown" and there is no tag for a manual
    // override to name — the in-person identity gate is unsatisfiable by
    // construction in exactly the sessions this change exists to rescue.
    // Relaxing only `speaker !== "you"` returns { blocked: "identity" } for
    // every frame and nothing changes on screen.
    const result = qualifiesForCue({
      frame: { ...FINAL_FROM_THEM, speaker: "them" },
      snapshot: UNSETTLED,
      source: "inperson",
      speakerAttribution: SPEAKER_ATTRIBUTION.UNAVAILABLE,
    });
    expect(result).not.toBeNull();
    expect(result.blocked).toBeUndefined();
    expect(result.evaluate).toBe(true);
  });
});

// AC-V2.2.1 / C2. The relaxed arm above is keyed on a flag that was chosen to
// UNDER-claim. `lib/copilot/stt/index.js` computes
// `diarizationActive = tokenFetchSucceeded && diarize && supportsDiarization`,
// and the `tokenFetchSucceeded` term is R-151's deliberate anti-overclaim
// rule — but the stream is still constructed with `diarize: true` and
// `DeepgramStream.connect()` fetches its OWN token, so a session whose token
// route blipped can genuinely diarize, fill `speakerSnapshot.tags`, reach
// `confidence: "high"` and render a working "Who's talking" correction bar
// while `speakerAttribution()` still reports "unavailable". A flag chosen to
// under-claim is a safe input for a WARNING and the wrong input for a
// PERMISSION gate: in that session the relaxed arm would switch both identity
// checks off for a provider that demonstrably has identity, letting the
// INTERVIEWER's own correctly-attributed speech drive the candidate's panel.
//
// So the arm is evidence-based, not flag-based: it opens only while no
// speaker tag has ever been observed. That is the state the arm was written
// for (no diarization means no tags, ever — see the UNSETTLED fixture) and it
// self-corrects the instant evidence to the contrary arrives, with no new
// state anywhere.
const TAGGED_SETTLED = { overridden: false, confidence: "high", userTag: 1, tags: [1, 2] };
const TAGGED_UNSETTLED = { overridden: false, confidence: "unknown", userTag: null, tags: [1] };

describe("qualifiesForCue — the relaxed arm needs evidence, not just the flag (AC-V2.2.1)", () => {
  it("falls back to today's gates when speaker tags have actually been observed", () => {
    // Identity is demonstrably working on this session whatever the flag
    // says, so a frame labelled "them" is the INTERVIEWER — refused exactly
    // as it is when attribution reads "active".
    expect(
      qualifiesForCue({
        frame: FINAL_FROM_THEM,
        snapshot: TAGGED_SETTLED,
        source: "inperson",
        speakerAttribution: SPEAKER_ATTRIBUTION.UNAVAILABLE,
      }),
    ).toBeNull();
  });

  it("still runs the in-person identity gate once tags exist", () => {
    // The other half of "fall through to today's gates": a candidate frame
    // whose identity has not settled blocks, rather than being waved through
    // by an arm that exists for sessions with no identity at all.
    expect(
      qualifiesForCue({
        frame: { ...FINAL_FROM_THEM, speaker: "you" },
        snapshot: TAGGED_UNSETTLED,
        source: "inperson",
        speakerAttribution: SPEAKER_ATTRIBUTION.UNAVAILABLE,
      }),
    ).toEqual({ blocked: "identity" });
  });

  it("lets the candidate's own settled speech through once tags exist", () => {
    expect(
      qualifiesForCue({
        frame: { ...FINAL_FROM_THEM, speaker: "you" },
        snapshot: TAGGED_SETTLED,
        source: "inperson",
        speakerAttribution: SPEAKER_ATTRIBUTION.UNAVAILABLE,
      }),
    ).toEqual({ evaluate: true });
  });

  it("keeps the relaxed arm for the session it was written for — no tags, ever", () => {
    // The direction that must NOT regress: the recorded ElevenLabs session
    // has no tags at all, and its interviewer-labelled frames are the only
    // frames it will ever produce. This is the same claim the AC-V2.2 block
    // above makes, restated as the negative control for the new condition.
    expect(
      qualifiesForCue({
        frame: FINAL_FROM_THEM,
        snapshot: UNSETTLED,
        source: "inperson",
        speakerAttribution: SPEAKER_ATTRIBUTION.UNAVAILABLE,
      }),
    ).toEqual({ evaluate: true });
  });
});

describe("qualifiesForCue — every other attribution state is untouched (AC-V2.5)", () => {
  // The negative controls for the change above. Each of these four states
  // must behave exactly as the shipped code behaves today; a fix that relaxes
  // the gate for all of them would let an INTERVIEWER drive the candidate's
  // dashboard on a source where the two voices really are separable.

  it("refuses the interviewer's own speech when diarization is active", () => {
    expect(
      qualifiesForCue({
        frame: FINAL_FROM_THEM,
        snapshot: SETTLED,
        source: "inperson",
        speakerAttribution: SPEAKER_ATTRIBUTION.ACTIVE,
      }),
    ).toBeNull();
  });

  it("blocks on identity when diarization is active but identity has not settled", () => {
    expect(
      qualifiesForCue({
        frame: { ...FINAL_FROM_THEM, speaker: "you" },
        snapshot: UNSETTLED,
        source: "inperson",
        speakerAttribution: SPEAKER_ATTRIBUTION.ACTIVE,
      }),
    ).toEqual({ blocked: "identity" });
  });

  it("accepts the candidate's own settled speech when diarization is active", () => {
    expect(
      qualifiesForCue({
        frame: { ...FINAL_FROM_THEM, speaker: "you" },
        snapshot: SETTLED,
        source: "inperson",
        speakerAttribution: SPEAKER_ATTRIBUTION.ACTIVE,
      }),
    ).toEqual({ evaluate: true });
  });

  it("leaves tab and system on their structural separation, with no identity gate", () => {
    // These two get "you" from a physically separate microphone socket. They
    // have no identity to wait on and must never acquire one — and, just as
    // importantly, must never be swept into the relaxed arm: NOT_APPLICABLE
    // is not UNAVAILABLE.
    for (const source of ["tab", "system"]) {
      expect(
        qualifiesForCue({
          frame: { ...FINAL_FROM_THEM, speaker: "you" },
          snapshot: UNSETTLED,
          source,
          speakerAttribution: SPEAKER_ATTRIBUTION.NOT_APPLICABLE,
        }),
      ).toEqual({ evaluate: true });
      expect(
        qualifiesForCue({
          frame: FINAL_FROM_THEM,
          snapshot: UNSETTLED,
          source,
          speakerAttribution: SPEAKER_ATTRIBUTION.NOT_APPLICABLE,
        }),
      ).toBeNull();
    }
  });

  it("leaves the meeting copilot inert, where attribution was never requested", () => {
    // A meeting session passes attributeSpeakers:false and its frames resolve
    // to speaker "room". "Off" is a different fact from "unavailable" — the
    // user asked for one undivided voice — and must not be read as licence to
    // let any voice in the room drive the dashboard.
    expect(
      qualifiesForCue({
        frame: { ...FINAL_FROM_THEM, speaker: "room" },
        snapshot: UNSETTLED,
        source: "inperson",
        speakerAttribution: SPEAKER_ATTRIBUTION.OFF,
      }),
    ).toBeNull();
  });

  it("stays closed while attribution is still pending", () => {
    // Between the session starting and the socket reporting, nothing is known
    // yet. Defaulting an unknown to the relaxed arm would open the gate on
    // every session for its first seconds.
    expect(
      qualifiesForCue({
        frame: FINAL_FROM_THEM,
        snapshot: UNSETTLED,
        source: "inperson",
        speakerAttribution: SPEAKER_ATTRIBUTION.PENDING,
      }),
    ).toBeNull();
  });
});

describe("resolveCueAction (AC-V2.3)", () => {
  const pin = { id: "pin-question", action: "pin", ambiguous: false };
  const unpin = { id: "unpin-question", action: "unpin", ambiguous: false };
  const company = { id: "company-brief", action: "company", ambiguous: false };

  it("lets a hold through when nobody can tell voices apart", () => {
    expect(
      resolveCueAction({ match: pin, speakerAttribution: SPEAKER_ATTRIBUTION.UNAVAILABLE }),
    ).toEqual({ act: "pin", ignoredReason: null });
  });

  it("refuses release and company in that state, each with a reason that names the cause", () => {
    // The cost is not symmetric. A hold the interviewer accidentally triggers
    // is the question the candidate is already reading and expires on its
    // own; a release they accidentally trigger takes away a deliberate hold
    // mid-answer, and a company match spends a real outbound request.
    for (const match of [unpin, company]) {
      expect(
        resolveCueAction({ match, speakerAttribution: SPEAKER_ATTRIBUTION.UNAVAILABLE }),
      ).toEqual({
        act: null,
        ignoredReason: CUE_IGNORED_REASONS.ATTRIBUTION_UNAVAILABLE,
      });
    }
  });

  it("allows all three when attribution is active", () => {
    for (const match of [pin, unpin, company]) {
      expect(
        resolveCueAction({ match, speakerAttribution: SPEAKER_ATTRIBUTION.ACTIVE }),
      ).toEqual({ act: match.action, ignoredReason: null });
    }
  });

  it("refuses an ambiguous match before it ever considers the attribution", () => {
    // Two intents in one provider-final frame is narrative speech, not
    // sequential intent — true regardless of who is speaking, so it must be
    // decided ahead of the attribution arm rather than inside it.
    const ambiguous = { id: "pin-question", action: "pin", ambiguous: true };
    for (const speakerAttribution of Object.values(SPEAKER_ATTRIBUTION)) {
      expect(resolveCueAction({ match: ambiguous, speakerAttribution })).toEqual({
        act: null,
        ignoredReason: CUE_IGNORED_REASONS.AMBIGUOUS,
      });
    }
  });

  it("carries an identity block through as its own reason", () => {
    expect(
      resolveCueAction({
        match: { blocked: "identity" },
        speakerAttribution: SPEAKER_ATTRIBUTION.ACTIVE,
      }),
    ).toEqual({ act: null, ignoredReason: CUE_IGNORED_REASONS.IDENTITY });
  });

  it("gives every refusal a distinct reason", () => {
    // AC-V2.4. A live region and a diagnostic log both go silent when two
    // states share a string — React does not re-announce unchanged text, and
    // a log with one reason for four causes cannot answer "why did nothing
    // happen when I said the phrase", which is the entire question this
    // session's log could not answer.
    const reasons = Object.values(CUE_IGNORED_REASONS);
    expect(new Set(reasons).size).toBe(reasons.length);
    for (const reason of reasons) {
      expect(reason.trim()).not.toBe("");
    }
    // Named individually, not just counted: the loop above passes whether or
    // not a given cause has a reason at all, so a missing member is exactly
    // the failure it cannot see. NOTHING_HELD is the one that was missing —
    // a matched RELEASE with no question held fell through to nothing and
    // logged only `cue.matched`, leaving the session log unable to answer
    // "why did nothing happen when I said the phrase" for that one case,
    // which is the whole of AC-V2.4. NO_QUESTION is its mirror on the pin
    // side and has always been logged; the two are separate causes ("there
    // is no question to hold" vs "no question is being held") and must read
    // as separate causes.
    expect(CUE_IGNORED_REASONS.NOTHING_HELD).toBeTruthy();
    expect(CUE_IGNORED_REASONS.NOTHING_HELD).not.toBe(CUE_IGNORED_REASONS.NO_QUESTION);
  });
});

describe("the sidebar states the policy rather than restating it (AC-V2.6)", () => {
  it("says nothing extra when every cue works", () => {
    for (const state of [
      SPEAKER_ATTRIBUTION.ACTIVE,
      SPEAKER_ATTRIBUTION.NOT_APPLICABLE,
      SPEAKER_ATTRIBUTION.PENDING,
      SPEAKER_ATTRIBUTION.OFF,
    ]) {
      expect(cueAvailabilityNotice(state)).toBe("");
      expect(cueRowNote("unpin", state)).toBe("");
      expect(cueRowNote("company", state)).toBe("");
    }
  });

  it("tells the user which cues are unavailable and why", () => {
    const notice = cueAvailabilityNotice(SPEAKER_ATTRIBUTION.UNAVAILABLE);
    expect(notice.trim()).not.toBe("");
    // Stated as a real sentence a person can act on, not a status token.
    expect(notice).toMatch(/[.!]$/);
  });

  // AC-V2.6.2 / C4 (accessibility audit). WCAG 3.3.2 Labels or Instructions:
  // an instruction that is false is worse than none. The one sentence ended
  // "…still work, but only from their buttons below", which is true of the
  // EXPANDED rail and false of the collapsed one — and collapsed is the state
  // a live session is actually in, which is the only state a spoken cue can
  // fire in at all, so the instruction was wrong exactly when it was
  // load-bearing. The collapsed tree contains one button, the expand toggle,
  // and it is above the notice, not below it.
  //
  // VoiceCueSidebar.js already hit this once and says so: MIC_NOTE_SHORT
  // drops "the buttons above" "on purpose: collapsed renders no buttons". The
  // variant belongs HERE and not in the component, for the same anti-drift
  // reason cueRowNote exists — a component that hand-writes its own version
  // of a policy sentence is the failure this module was created to remove.
  describe("the collapsed rail gets its own wording (AC-V2.6.2)", () => {
    it("does not tell a collapsed rail to use buttons that are not rendered", () => {
      const collapsed = cueAvailabilityNotice(SPEAKER_ATTRIBUTION.UNAVAILABLE, { collapsed: true });
      expect(collapsed.trim()).not.toBe("");
      expect(collapsed).not.toMatch(/below/i);
    });

    it("points the collapsed rail at the one control it actually has", () => {
      // The instruction has to be actionable from where the user is standing:
      // the only thing on screen is the expand toggle, so that is what it
      // names.
      const collapsed = cueAvailabilityNotice(SPEAKER_ATTRIBUTION.UNAVAILABLE, { collapsed: true });
      expect(collapsed).toMatch(/expand/i);
    });

    it("keeps the expanded wording, where the buttons really are below", () => {
      const expanded = cueAvailabilityNotice(SPEAKER_ATTRIBUTION.UNAVAILABLE, { collapsed: false });
      expect(expanded).toMatch(/below/i);
      expect(expanded).toBe(cueAvailabilityNotice(SPEAKER_ATTRIBUTION.UNAVAILABLE));
    });

    it("says the same thing about WHICH cues work, whichever rail state it is in", () => {
      // Only the "how to reach them" clause differs. The fact being disclosed
      // — this provider cannot tell voices apart, so hold is the only spoken
      // cue — must not become two different claims.
      const collapsed = cueAvailabilityNotice(SPEAKER_ATTRIBUTION.UNAVAILABLE, { collapsed: true });
      const expanded = cueAvailabilityNotice(SPEAKER_ATTRIBUTION.UNAVAILABLE, { collapsed: false });
      expect(collapsed).not.toBe(expanded);
      for (const notice of [collapsed, expanded]) {
        expect(notice).toMatch(/can't tell voices apart/i);
        expect(notice).toMatch(/[.!]$/);
      }
    });

    it("stays silent in every non-degraded state, collapsed or not", () => {
      for (const state of [
        SPEAKER_ATTRIBUTION.ACTIVE,
        SPEAKER_ATTRIBUTION.NOT_APPLICABLE,
        SPEAKER_ATTRIBUTION.PENDING,
        SPEAKER_ATTRIBUTION.OFF,
      ]) {
        expect(cueAvailabilityNotice(state, { collapsed: true })).toBe("");
        expect(cueAvailabilityNotice(state, { collapsed: false })).toBe("");
      }
    });
  });

  it("marks exactly the rows the policy refuses, and only those", () => {
    // The reason this function exists at all: if the sidebar hand-writes its
    // own sentence, someone widening resolveCueAction leaves the panel
    // telling the user release is unavailable when it works, or worse, that
    // it works when it does not. Both consumers read the same module.
    const state = SPEAKER_ATTRIBUTION.UNAVAILABLE;
    expect(cueRowNote("pin", state)).toBe("");
    expect(cueRowNote("unpin", state).trim()).not.toBe("");
    expect(cueRowNote("company", state).trim()).not.toBe("");
  });

  it("agrees with resolveCueAction for every action in every state", () => {
    // The anti-drift assertion, exhaustive in both directions rather than a
    // spot check: a row carries a note if and only if the policy refuses it.
    for (const speakerAttribution of Object.values(SPEAKER_ATTRIBUTION)) {
      for (const action of ["pin", "unpin", "company"]) {
        const { act } = resolveCueAction({
          match: { action, ambiguous: false },
          speakerAttribution,
        });
        const noted = cueRowNote(action, speakerAttribution) !== "";
        expect(noted).toBe(act === null);
      }
    }
  });
});
