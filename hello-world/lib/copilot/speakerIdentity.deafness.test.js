import { describe, it, expect } from "vitest";
import { createSpeakerIdentity } from "./speakerIdentity.js";

// AC-S2: a manual correction must never be able to make the copilot deaf.
//
// The hazard this file exists for: on a shared room mic the provider often
// resolves BOTH voices to a single tag. The transcript still offers that row
// as a correctable one, so a user who sees their own words labelled
// "Speaker 1" clicks "that's me". `setUserTag(0)` then pins
// overridden = true, and `shouldEvaluateAsQuestion(0)` answers false from
// then on — for the only tag that exists. Every subsequent utterance,
// including every question the interviewer asks, is skipped, permanently and
// with no way for the user to notice. One click, silent deafness for the
// rest of the interview.
//
// The rule the module already states for itself is the one to hold onto:
// missing the interviewer is silent and permanent; over-evaluating the
// user's own speech is visible and bounded. So when suppressing a tag would
// suppress EVERYTHING, evaluation has to win.

function speak(identity, speakerTag, text) {
  identity.observe({ speakerTag, text });
}

describe("marking yourself on a single-voice session (AC-S2.1)", () => {
  it("keeps evaluating when the corrected tag is the only tag there is", () => {
    const id = createSpeakerIdentity();
    speak(id, 0, "Thanks for joining, let me tell you about the team.");
    speak(id, 0, "So tell me about a time you led a project.");

    id.setUserTag(0);

    // There is no other voice. Refusing to evaluate tag 0 refuses to
    // evaluate the interview.
    expect(id.shouldEvaluateAsQuestion(0)).toBe(true);
  });

  it("records the correction even though it keeps listening", () => {
    const id = createSpeakerIdentity();
    speak(id, 0, "Tell me about yourself.");
    id.setUserTag(0);

    const snap = id.snapshot();
    expect(snap.userTag).toBe(0);
    expect(snap.overridden).toBe(true);
    expect(snap.tags).toEqual([0]);
  });

  it("starts suppressing the moment a second voice actually appears", () => {
    const id = createSpeakerIdentity();
    speak(id, 0, "Tell me about yourself.");
    id.setUserTag(0);
    expect(id.shouldEvaluateAsQuestion(0)).toBe(true);

    speak(id, 1, "Sure, I started out as a backend engineer.");

    // Now the correction can mean something: tag 0 is the user, tag 1 is
    // somebody else. This is the positive control for the case above — if a
    // fix simply made shouldEvaluateAsQuestion always true, this fails.
    expect(id.shouldEvaluateAsQuestion(0)).toBe(false);
    expect(id.shouldEvaluateAsQuestion(1)).toBe(true);
  });
});

describe("marking yourself on a two-voice session still works (AC-S2.2)", () => {
  it("suppresses only the corrected tag", () => {
    const id = createSpeakerIdentity();
    speak(id, 0, "So tell me about a time you shipped something hard.");
    speak(id, 1, "Sure, last year I led a migration off a legacy queue.");

    id.setUserTag(1);

    expect(id.shouldEvaluateAsQuestion(1)).toBe(false);
    expect(id.shouldEvaluateAsQuestion(0)).toBe(true);
  });

  it("keeps evaluating a third voice that joins later", () => {
    const id = createSpeakerIdentity();
    speak(id, 0, "So tell me about a time you shipped something hard.");
    speak(id, 1, "Sure, last year I led a migration off a legacy queue.");
    id.setUserTag(1);

    speak(id, 2, "And how did the rest of the team take that?");
    expect(id.shouldEvaluateAsQuestion(2)).toBe(true);
  });
});

describe("swap on a single-voice session (AC-S2.3)", () => {
  it("does not pin a correction it could not actually make", () => {
    const id = createSpeakerIdentity();
    speak(id, 0, "Tell me about yourself.");
    const before = id.snapshot();

    id.swap();

    const after = id.snapshot();
    // There was no other tag to swap to. Claiming "high, overridden"
    // anyway pins a belief nobody expressed — and, via
    // shouldEvaluateAsQuestion, goes deaf for the rest of the session.
    expect(after.userTag).toBe(before.userTag);
    expect(id.shouldEvaluateAsQuestion(0)).toBe(true);
  });

  it("still swaps when there genuinely is another voice (positive control)", () => {
    const id = createSpeakerIdentity();
    speak(id, 0, "So walk me through your resume.");
    speak(id, 1, "Happy to. I started in support and moved into platform work.");
    id.setUserTag(0);

    id.swap();

    expect(id.snapshot().userTag).toBe(1);
    expect(id.snapshot().overridden).toBe(true);
    expect(id.shouldEvaluateAsQuestion(1)).toBe(false);
    expect(id.shouldEvaluateAsQuestion(0)).toBe(true);
  });
});

describe("nothing here weakens the uncorrected path (AC-S2.4)", () => {
  it("still evaluates every tag while identity is merely inferred", () => {
    const id = createSpeakerIdentity();
    speak(id, 0, "So tell me about a time you disagreed with a manager.");
    speak(id, 1, "Sure, I once pushed back on a deadline that would have cost us quality.");

    const snap = id.snapshot();
    expect(snap.overridden).toBe(false);
    if (snap.confidence !== "high") {
      for (const tag of snap.tags) {
        expect(id.shouldEvaluateAsQuestion(tag)).toBe(true);
      }
    }
  });

  it("never suppresses an untagged utterance", () => {
    const id = createSpeakerIdentity();
    speak(id, 0, "Tell me about yourself.");
    id.setUserTag(0);
    expect(id.shouldEvaluateAsQuestion(undefined)).toBe(true);
    expect(id.shouldEvaluateAsQuestion(null)).toBe(true);
  });
});
