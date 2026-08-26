import { describe, expect, it } from "vitest";
import {
  SPEAKER_ATTRIBUTION,
  CUE_IGNORED_REASONS,
  effectiveAttribution,
  qualifiesForCue,
  resolveCueAction,
  cueAvailabilityNotice,
  cueRowNote,
} from "./cuePolicy";

// AC-V2.8. ONE derivation of "can this session tell voices apart", consumed by
// every part of the policy, so no two of them can answer it differently.
//
// THE DEFECT THIS CLOSES. `diarizationActive` carries a deliberate
// `tokenFetchSucceeded` term so it never over-claims (R-151). But the stream is
// still constructed with `diarize: true` and Deepgram fetches its OWN token
// inside connect(), so a transient blip on our token route yields a session
// that genuinely diarizes — real speaker tags, identity reaching "high"
// confidence, a working correction bar — while `speakerAttribution()` reports
// `unavailable`.
//
// The first fix gated only `qualifiesForCue` on observed tags. That closed the
// dangerous half (the interviewer could no longer drive the dashboard) and left
// the dishonest half wide open: the same session then refused the CANDIDATE's
// release and company cues with the reason "cannot tell voices apart", and the
// sidebar told them those cues were button-only — in a session that demonstrably
// could tell voices apart. Three consumers, one question, two answers.
//
// Patching each consumer with its own tags check is the wrong shape: it is the
// same rule written three times, and the next consumer added will make it four,
// or forget. So the rule moves up. `effectiveAttribution` answers the question
// ONCE from the strongest available evidence, and everything downstream reads
// that. A flag chosen to under-claim is a fine input to a WARNING and the wrong
// input to a PERMISSION; this is the seam where the two part company.
//
// `speakerAttribution` itself is deliberately NOT changed — the user-facing
// warning is still honest about what was CONFIGURED, which is a different
// (and still true) fact from what the session turned out to be able to do.

const TAGS = { userTag: 1, confidence: "high", overridden: false, tags: [0, 1] };
const NO_TAGS = { userTag: null, confidence: "unknown", overridden: false, tags: [] };

describe("effectiveAttribution (AC-V2.8)", () => {
  it("downgrades to unavailable only while no voice has ever been separated", () => {
    expect(effectiveAttribution(SPEAKER_ATTRIBUTION.UNAVAILABLE, NO_TAGS)).toBe(
      SPEAKER_ATTRIBUTION.UNAVAILABLE,
    );
  });

  it("reports active once tags prove the session really does separate voices", () => {
    // The evidence outranks the flag. This is the token-blip session.
    expect(effectiveAttribution(SPEAKER_ATTRIBUTION.UNAVAILABLE, TAGS)).toBe(
      SPEAKER_ATTRIBUTION.ACTIVE,
    );
  });

  it("never upgrades a state that was not claiming unavailability", () => {
    // Tags on a meeting session (attribution deliberately OFF) or on tab/system
    // must not silently promote either into the in-person identity regime.
    for (const state of [
      SPEAKER_ATTRIBUTION.ACTIVE,
      SPEAKER_ATTRIBUTION.OFF,
      SPEAKER_ATTRIBUTION.NOT_APPLICABLE,
      SPEAKER_ATTRIBUTION.PENDING,
    ]) {
      expect(effectiveAttribution(state, TAGS)).toBe(state);
      expect(effectiveAttribution(state, NO_TAGS)).toBe(state);
    }
  });

  it("treats a missing or malformed snapshot as no evidence", () => {
    for (const snap of [undefined, null, {}, { tags: null }, { tags: "two" }]) {
      expect(effectiveAttribution(SPEAKER_ATTRIBUTION.UNAVAILABLE, snap)).toBe(
        SPEAKER_ATTRIBUTION.UNAVAILABLE,
      );
    }
  });
});

describe("every consumer answers the question the same way (AC-V2.8)", () => {
  const frameFromThem = { isFinal: true, speaker: "them", transcript: "That's a great question." };
  const frameFromYou = { ...frameFromThem, speaker: "you" };

  it("refuses the interviewer once tags exist, as an active session would", () => {
    expect(
      qualifiesForCue({
        frame: frameFromThem,
        snapshot: TAGS,
        source: "inperson",
        speakerAttribution: SPEAKER_ATTRIBUTION.UNAVAILABLE,
      }),
    ).toBeNull();
  });

  it("accepts the candidate's settled speech once tags exist", () => {
    expect(
      qualifiesForCue({
        frame: frameFromYou,
        snapshot: TAGS,
        source: "inperson",
        speakerAttribution: SPEAKER_ATTRIBUTION.UNAVAILABLE,
      }),
    ).toEqual({ evaluate: true });
  });

  it("stops refusing release and company with a reason that is false", () => {
    // The honesty half, and the whole reason this criterion exists. In this
    // session the candidate's voice IS separable, so "cannot tell voices apart
    // this session" is simply untrue — and it was being used to refuse them.
    for (const action of ["unpin", "company"]) {
      expect(
        resolveCueAction({
          match: { action, ambiguous: false },
          speakerAttribution: SPEAKER_ATTRIBUTION.UNAVAILABLE,
          snapshot: TAGS,
        }),
      ).toEqual({ act: action, ignoredReason: null });
    }
  });

  it("still refuses them when there is genuinely no evidence", () => {
    // The negative control. Without it the case above is satisfied by simply
    // deleting the refusal, which is the harm the whole policy exists for.
    for (const action of ["unpin", "company"]) {
      expect(
        resolveCueAction({
          match: { action, ambiguous: false },
          speakerAttribution: SPEAKER_ATTRIBUTION.UNAVAILABLE,
          snapshot: NO_TAGS,
        }),
      ).toEqual({ act: null, ignoredReason: CUE_IGNORED_REASONS.ATTRIBUTION_UNAVAILABLE });
    }
  });

  it("stops telling the user those cues are button-only", () => {
    // The sidebar must not contradict what the policy now permits — that
    // contradiction is the same class of defect as a privacy notice that
    // describes a transfer which does not happen.
    expect(cueAvailabilityNotice(SPEAKER_ATTRIBUTION.UNAVAILABLE, { snapshot: TAGS })).toBe("");
    expect(cueRowNote("unpin", SPEAKER_ATTRIBUTION.UNAVAILABLE, { snapshot: TAGS })).toBe("");
    expect(cueRowNote("company", SPEAKER_ATTRIBUTION.UNAVAILABLE, { snapshot: TAGS })).toBe("");
  });

  it("still says it when there is no evidence", () => {
    expect(
      cueAvailabilityNotice(SPEAKER_ATTRIBUTION.UNAVAILABLE, { snapshot: NO_TAGS }).trim(),
    ).not.toBe("");
    expect(cueRowNote("unpin", SPEAKER_ATTRIBUTION.UNAVAILABLE, { snapshot: NO_TAGS }).trim()).not.toBe("");
  });

  it("keeps the notice and the refusal agreeing in every state, in both directions", () => {
    // The anti-drift invariant, widened to carry the evidence dimension: a row
    // carries a note if and only if the policy refuses that action. One
    // derivation is what makes this hold by construction rather than by care.
    for (const speakerAttribution of Object.values(SPEAKER_ATTRIBUTION)) {
      for (const snapshot of [TAGS, NO_TAGS]) {
        for (const action of ["pin", "unpin", "company"]) {
          const { act } = resolveCueAction({
            match: { action, ambiguous: false },
            speakerAttribution,
            snapshot,
          });
          expect(cueRowNote(action, speakerAttribution, { snapshot }) !== "").toBe(act === null);
        }
      }
    }
  });
});

describe("callers that pass no snapshot keep today's behaviour (AC-V2.8)", () => {
  it("treats an omitted snapshot as no evidence, never as evidence", () => {
    // Backward compatibility that fails SAFE: a caller not yet updated must get
    // the conservative answer, not an accidental promotion to active.
    expect(
      resolveCueAction({
        match: { action: "unpin", ambiguous: false },
        speakerAttribution: SPEAKER_ATTRIBUTION.UNAVAILABLE,
      }),
    ).toEqual({ act: null, ignoredReason: CUE_IGNORED_REASONS.ATTRIBUTION_UNAVAILABLE });
    expect(cueRowNote("unpin", SPEAKER_ATTRIBUTION.UNAVAILABLE).trim()).not.toBe("");
  });
});
