import { describe, expect, it } from "vitest";
import { createSpeakerIdentity, scoreSpeakers, speakerDisplayLabel } from "./speakerIdentity";

// Written from AC-M1.3 BEFORE the module existed. Assertions are on observable
// behaviour only: which tag comes back as the user, what confidence is reported,
// and whether a tag's speech is still worth evaluating as a question.
//
// Read this before changing anything here. An earlier version of both the AC and
// this file was reviewed adversarially and two counterexamples were produced by
// RUNNING the scoring formula, not by imagining it. In both, the formula elected
// the INTERVIEWER as the user at "high" confidence, after which the copilot
// stopped evaluating their speech and went permanently deaf in a live interview.
// The `interviewer preamble` and `ordinary politeness` cases below are those two
// counterexamples. They are the whole reason the confidence gate has six clauses
// instead of two. Do not relax a clause to make an implementation simpler.
//
// The same review found that the old tests pinned nothing about the scoring
// formula: `youScore = wordShare` with the question-rate term deleted outright
// passed every one of them. The two "term is load-bearing" tests exist so that
// can never be true again.

function evidence(entries) {
  const out = {};
  for (const [tag, [turns, words, questionTurns]] of Object.entries(entries)) {
    out[tag] = { turns, words, questionTurns };
  }
  return out;
}

describe("scoreSpeakers ranking", () => {
  it("picks the speaker who says the most words and asks the fewest questions", () => {
    expect(scoreSpeakers(evidence({ 0: [3, 30, 3], 1: [3, 120, 0] })).userTag).toBe(1);
  });

  it("returns the tag as a number, not the string key the evidence object carries", () => {
    // Object literals coerce integer-like keys to strings. Every assertion here
    // is strict equality against a number, so the module must coerce on the way
    // out or fail every one of these on type rather than on logic.
    expect(scoreSpeakers(evidence({ 0: [3, 30, 3], 1: [3, 120, 0] })).userTag).not.toBe("1");
  });

  it("lets question-asking outrank word count - the term is load-bearing", () => {
    // Word share alone says tag 0 (0.6 vs 0.4). The question-rate penalty is the
    // only thing that flips it. Delete the term and this test goes red, which is
    // exactly what the previous version of this file failed to guarantee.
    expect(scoreSpeakers(evidence({ 0: [4, 120, 4], 1: [4, 80, 0] })).userTag).toBe(1);
  });

  it("weights the question-rate penalty at 2x, not 1x", () => {
    // Shares 0.65 / 0.35, questionRate 0.25 on tag 0.
    //   at 2x: 0.65 - 0.50 = 0.15  ->  loses to 0.35
    //   at 1x: 0.65 - 0.25 = 0.40  ->  beats 0.35
    expect(scoreSpeakers(evidence({ 0: [4, 104, 1], 1: [4, 56, 0] })).userTag).toBe(1);
  });

  it("returns a deterministic winner when two speakers score identically", () => {
    const ev = evidence({ 1: [2, 50, 1], 0: [2, 50, 1] });

    expect(scoreSpeakers(ev).userTag).toBe(0);
    expect(scoreSpeakers(ev).userTag).toBe(scoreSpeakers(ev).userTag);
  });

  it("generalizes past two voices: on a panel, everyone who is not the candidate is an interviewer", () => {
    const result = scoreSpeakers(evidence({ 0: [2, 20, 2], 1: [2, 15, 2], 2: [4, 200, 0] }));

    expect(result.userTag).toBe(2);
    expect(result.confidence).toBe("high");
  });
});

describe("scoreSpeakers confidence - the two counterexamples that broke v1", () => {
  it("stays low through an interviewer's opening preamble", () => {
    // Interviewer: "Thanks for making the time." / "I'll give you a quick
    // overview of the team and then we can dig in." / "We're about twelve
    // engineers split across ingest and serving."  (29 words, 3 turns)
    // Candidate: "Sounds good."  (2 words, 1 turn)
    // Nobody has asked anything yet. Word share alone is 0.94 vs 0.06, and v1
    // returned "high" with the INTERVIEWER as the user.
    const result = scoreSpeakers(evidence({ 0: [3, 29, 0], 1: [1, 2, 0] }));

    expect(result.confidence).toBe("low");
  });

  it("stays low when the candidate opens with ordinary politeness", () => {
    // Interviewer: "Hi, thanks for joining." / "Good, thanks."  (6 w, 0 questions)
    // Candidate: "Thanks for having me, how are you?" / "Great, shall we start?"
    //   (11 w, both tripping detectQuestion on the trailing "?")
    // On this evidence the conversation genuinely LOOKS inverted, so the
    // "somebody asked" and "the argmax asked nothing" clauses do NOT save it.
    // Only the absolute word floor does: the argmax has 6 words.
    const result = scoreSpeakers(evidence({ 0: [2, 6, 0], 1: [2, 11, 2] }));

    expect(result.confidence).toBe("low");
  });

  it("still resolves a real interview, or the gate is useless rather than safe", () => {
    // Interviewer asks twice (12 w, 2 turns, 2 questions); candidate answers at
    // length twice (240 w, 2 turns, 0 questions).
    const result = scoreSpeakers(evidence({ 0: [2, 12, 2], 1: [2, 240, 0] }));

    expect(result.confidence).toBe("high");
    expect(result.userTag).toBe(1);
  });
});

describe("scoreSpeakers confidence clauses", () => {
  it("reports unknown with no turns observed at all", () => {
    const result = scoreSpeakers(evidence({}));

    expect(result.userTag).toBeNull();
    expect(result.confidence).toBe("unknown");
  });

  it("never reports high from a single voice, however much it says", () => {
    // One speaker is not evidence about who the OTHER one is.
    expect(scoreSpeakers(evidence({ 0: [10, 500, 3] })).confidence).toBe("low");
  });

  it("requires at least four turns - three is not enough", () => {
    expect(scoreSpeakers(evidence({ 0: [2, 100, 0], 1: [1, 5, 1] })).confidence).toBe("low");
  });

  it("resolves at exactly four turns when everything else is satisfied", () => {
    expect(scoreSpeakers(evidence({ 0: [2, 100, 0], 1: [2, 5, 2] })).confidence).toBe("high");
  });

  it("requires that somebody has actually asked a question", () => {
    expect(scoreSpeakers(evidence({ 0: [2, 100, 0], 1: [2, 5, 0] })).confidence).toBe("low");
  });

  it("resolves once a single question has been asked by anyone", () => {
    expect(scoreSpeakers(evidence({ 0: [2, 100, 0], 1: [2, 5, 1] })).confidence).toBe("high");
  });

  it("refuses to crown a speaker who has asked a question", () => {
    // A voice that asks questions is not the candidate, however much it talks.
    expect(scoreSpeakers(evidence({ 0: [4, 100, 1], 1: [2, 5, 1] })).confidence).toBe("low");
  });

  it("requires the presumed candidate to have said something substantial - 39 words is not enough", () => {
    expect(scoreSpeakers(evidence({ 0: [2, 39, 0], 1: [2, 5, 2] })).confidence).toBe("low");
  });

  it("accepts the presumed candidate at the 40-word floor", () => {
    expect(scoreSpeakers(evidence({ 0: [2, 40, 0], 1: [2, 5, 2] })).confidence).toBe("high");
  });

  it("requires a margin over the runner-up - 0.13 is too close to call", () => {
    // Tags 0 and 1 neither asked anything and are close on share; tag 2 supplies
    // the "somebody asked" clause without disturbing the margin.
    const result = scoreSpeakers(evidence({ 0: [2, 57, 0], 1: [2, 43, 0], 2: [1, 5, 1] }));

    expect(result.confidence).toBe("low");
  });

  it("resolves once the margin clears 0.15", () => {
    const result = scoreSpeakers(evidence({ 0: [2, 60, 0], 1: [2, 40, 0], 2: [1, 5, 1] }));

    expect(result.confidence).toBe("high");
    expect(result.userTag).toBe(0);
  });
});

describe("createSpeakerIdentity labelling", () => {
  it("labels the resolved user tag you and every other known tag them", () => {
    const id = createSpeakerIdentity();
    id.observe({ speakerTag: 0, text: "So tell me about a time you shipped something hard?" });
    id.observe({
      speakerTag: 1,
      text: "I led the migration of our billing pipeline over two quarters and we cut reconciliation time from three days to under an hour by rebuilding the ingest step and adding a replay path for the failures we could not avoid",
    });
    id.observe({ speakerTag: 0, text: "What was the hardest part of that?" });
    id.observe({
      speakerTag: 1,
      text: "The hardest part was the dual write window because we could not take downtime, so we ran both paths and compared them for a full month before cutting over and only then deleted the old job",
    });

    expect(id.labelFor(1)).toBe("you");
    expect(id.labelFor(0)).toBe("them");
  });

  it("never claims a single observed voice is you", () => {
    // Claiming "You" on the interviewer's opening line is the visible form of
    // the catastrophic mislabel.
    const id = createSpeakerIdentity();
    id.observe({ speakerTag: 0, text: "So, tell me a bit about your background and what you have been working on" });

    expect(id.labelFor(0)).not.toBe("you");
  });

  it("labels an undiarized frame unknown rather than guessing", () => {
    const id = createSpeakerIdentity();
    id.observe({ speakerTag: undefined, text: "hello there, thanks for making the time" });

    expect(id.labelFor(undefined)).toBe("unknown");
    expect(id.snapshot().confidence).toBe("unknown");
  });

  it("labels a tag it has never seen unknown", () => {
    const id = createSpeakerIdentity();
    id.observe({ speakerTag: 0, text: "how did you approach that?" });

    expect(id.labelFor(7)).toBe("unknown");
  });
});

describe("createSpeakerIdentity question gating", () => {
  it("evaluates EVERY speaker as a possible questioner while identity is unsettled", () => {
    const id = createSpeakerIdentity();
    id.observe({ speakerTag: 0, text: "thanks so much for making the time today" });

    expect(id.snapshot().confidence).not.toBe("high");
    expect(id.shouldEvaluateAsQuestion(0)).toBe(true);
    expect(id.shouldEvaluateAsQuestion(1)).toBe(true);
  });

  it("keeps evaluating everyone through an interviewer's opening preamble", () => {
    // Counterexample 1, driven through the real observe path. v1 stopped
    // evaluating tag 0 here - the interviewer - and never recovered.
    const id = createSpeakerIdentity();
    id.observe({ speakerTag: 0, text: "Thanks for making the time." });
    id.observe({
      speakerTag: 0,
      text: "I'll give you a quick overview of the team and then we can dig in.",
    });
    id.observe({ speakerTag: 0, text: "We're about twelve engineers split across ingest and serving." });
    id.observe({ speakerTag: 1, text: "Sounds good." });

    expect(id.shouldEvaluateAsQuestion(0)).toBe(true);
    expect(id.shouldEvaluateAsQuestion(1)).toBe(true);
  });

  it("keeps evaluating everyone when the candidate opens with ordinary politeness", () => {
    // Counterexample 2. The candidate's two polite questions make the
    // conversation look inverted; v1 crowned the interviewer within seconds.
    const id = createSpeakerIdentity();
    id.observe({ speakerTag: 0, text: "Hi, thanks for joining." });
    id.observe({ speakerTag: 1, text: "Thanks for having me, how are you?" });
    id.observe({ speakerTag: 0, text: "Good, thanks." });
    id.observe({ speakerTag: 1, text: "Great, shall we start?" });

    expect(id.shouldEvaluateAsQuestion(0)).toBe(true);
    expect(id.shouldEvaluateAsQuestion(1)).toBe(true);
  });

  it("stops evaluating the user's own speech once identity is genuinely settled", () => {
    const id = createSpeakerIdentity();
    id.observe({ speakerTag: 0, text: "Why do you want to work here?" });
    id.observe({
      speakerTag: 1,
      text: "I have followed the platform team's work on incremental builds for a while and the problem space lines up closely with what I spent the last two years doing at my current company, which was mostly build performance",
    });
    id.observe({ speakerTag: 0, text: "And what are you looking for in your next role?" });
    id.observe({
      speakerTag: 1,
      text: "Somewhere I can own a service end to end rather than handing designs across a wall, which is the thing I have been missing lately in my current setup and the reason I started looking at all",
    });

    expect(id.snapshot().confidence).toBe("high");
    expect(id.shouldEvaluateAsQuestion(1)).toBe(false);
    expect(id.shouldEvaluateAsQuestion(0)).toBe(true);
  });
});

describe("createSpeakerIdentity: labelling and gating are separate thresholds", () => {
  // The implementer reported, honestly and unprompted, that nothing pinned this
  // divergence: every other test that touches both functions happens to have
  // reached "high" confidence by the time it checks a label, so an
  // implementation that collapsed the two would have passed the whole suite.
  // This is the case where they MUST disagree - two voices heard, confidence
  // still low - and it is the shape of the very first minute of every in-person
  // interview.
  function preamble() {
    const id = createSpeakerIdentity();
    id.observe({ speakerTag: 0, text: "Thanks for making the time." });
    id.observe({
      speakerTag: 0,
      text: "I'll give you a quick overview of the team and then we can dig in.",
    });
    id.observe({ speakerTag: 0, text: "We're about twelve engineers split across ingest and serving." });
    id.observe({ speakerTag: 1, text: "Sounds good." });
    return id;
  }

  it("shows a best-guess label as soon as two voices have been heard", () => {
    const id = preamble();

    expect(id.snapshot().confidence).toBe("low");
    expect(id.labelFor(0)).toBe("you");
    expect(id.labelFor(1)).toBe("them");
  });

  it("still evaluates BOTH voices for questions at that same moment", () => {
    // Gating on the display label instead of on confidence is precisely how the
    // copilot goes deaf: the interviewer is provisionally labelled "you" here,
    // purely because they have said the most so far.
    const id = preamble();

    expect(id.shouldEvaluateAsQuestion(0)).toBe(true);
    expect(id.shouldEvaluateAsQuestion(1)).toBe(true);
  });
});

describe("speakerDisplayLabel", () => {
  // The strings the transcript actually shows. Kept here, next to the identity
  // logic and reachable from a node test, rather than inside a React component
  // where this repo could not test it at all. TranscriptView calls this through
  // its `speakerLabelFor` prop.
  //
  // Two voices read as "You"/"Them" - today's vocabulary everywhere else in this
  // UI. A third voice cannot be "Them" without implying there is only one other
  // person, so panels fall back to Otter's neutral "Speaker N" placeholder.

  it("names the resolved user You", () => {
    // `confidence: "high"` is not decoration. This literal originally omitted
    // it, which made the test assert against a snapshot the system can never
    // produce - `snapshot()` always carries confidence - and so it passed while
    // `speakerDisplayLabel` was missing the settled-identity guard entirely.
    // That is the same defect this file already calls out for the
    // `{ userTag: null }` case, committed a second time by the same hand.
    // Prefer the real-snapshot-derived cases below to hand-written literals.
    expect(
      speakerDisplayLabel(1, { userTag: 1, confidence: "high", tags: [0, 1] }),
    ).toBe("You");
  });

  it("names the only other voice Them", () => {
    expect(speakerDisplayLabel(0, { userTag: 1, tags: [0, 1] })).toBe("Them");
  });

  it("numbers additional voices rather than calling them Them", () => {
    const snap = { userTag: 1, tags: [0, 1, 2] };

    expect(speakerDisplayLabel(0, snap)).toBe("Speaker 1");
    expect(speakerDisplayLabel(2, snap)).toBe("Speaker 3");
  });

  it("keeps a voice's number stable when another voice joins later", () => {
    // A label that renumbers mid-session makes the transcript unreadable and
    // makes a correction the user already made look like it moved.
    expect(speakerDisplayLabel(2, { userTag: 1, tags: [0, 1] })).toBe("Speaker 3");
    expect(speakerDisplayLabel(2, { userTag: 1, tags: [0, 1, 2, 5] })).toBe("Speaker 3");
  });

  it("falls back to a neutral placeholder when nobody is resolved yet", () => {
    expect(speakerDisplayLabel(0, { userTag: null, tags: [0] })).toBe("Speaker 1");
  });

  it("never returns You for a voice that is not the resolved user", () => {
    // The whole point: "You" on the interviewer's line is the visible form of
    // the mislabel this feature exists to prevent.
    for (const snap of [
      { userTag: null, tags: [0, 1] },
      { userTag: 1, tags: [0, 1] },
      { userTag: 1, tags: [0, 1, 2] },
    ]) {
      expect(speakerDisplayLabel(0, snap)).not.toBe("You");
    }
  });
});

describe("speakerDisplayLabel confidence gate - the BLOCKER two reviewers found", () => {
  // speakerDisplayLabel used to return "You" for any tag === snapshot.userTag,
  // full stop. scoreSpeakers sets userTag as soon as ANY evidence exists at all
  // - including a single observed voice at "low" confidence (see scoreSpeakers'
  // `atLeastTwoVoices` clause above) - so the snapshot after the very first
  // utterance of an interview is `{ userTag: 0, confidence: "low", tags: [0] }`.
  // Since the interviewer almost always speaks first in an in-person interview,
  // their opening question rendered under a "You" chip and the candidate read
  // their interviewer's words as their own: the worst failure this feature can
  // produce. `labelFor` already refused to do this (AC-M1.3.7); this gate makes
  // speakerDisplayLabel refuse it too, which is what its own header comment
  // already claimed - falsely - that it did.
  //
  // This is the reachable counterpart to the module's R-143 trap: a snapshot
  // with userTag non-null but confidence anything other than "high" (or a
  // human override) is exactly what the system produces for most of an
  // interview's runtime, right up until enough evidence has accumulated.

  it("does not say You from a single low-confidence voice - this is the bug", () => {
    expect(speakerDisplayLabel(0, { userTag: 0, confidence: "low", tags: [0] })).not.toBe("You");
  });

  it("does not say You at low confidence even once a second voice has been heard", () => {
    // Two voices heard is enough for labelFor's "you"/"them" best-guess
    // (AC-M1.3.7), but speakerDisplayLabel's "You" chip requires the scoring
    // gate itself to have reached "high" - two voices alone is still a guess.
    expect(speakerDisplayLabel(0, { userTag: 0, confidence: "low", tags: [0, 1] })).not.toBe("You");
  });

  it("says You once confidence genuinely reaches high, and Them for the other voice", () => {
    const snap = { userTag: 1, confidence: "high", tags: [0, 1] };

    expect(speakerDisplayLabel(1, snap)).toBe("You");
    expect(speakerDisplayLabel(0, snap)).toBe("Them");
  });

  it("says You on a human override even though confidence never reached high", () => {
    // A manual correction (setUserTag/swap) is authoritative for the session -
    // see createSpeakerIdentity's AC-M1.3.6 comment - and must not be held
    // hostage by a confidence value the override deliberately supersedes.
    const snap = { userTag: 0, confidence: "low", overridden: true, tags: [0, 1] };

    expect(speakerDisplayLabel(0, snap)).toBe("You");
  });

  it("does not say You for the presumed user after one real observed utterance", () => {
    // Driven through the real observe/snapshot path rather than a hand-written
    // literal, so this fails the way production actually fails: an
    // interviewer's opening line, alone, is not enough to resolve identity.
    const id = createSpeakerIdentity();
    id.observe({ speakerTag: 0, text: "So, tell me a bit about your background." });

    const snap = id.snapshot();
    expect(snap.userTag).toBe(0);
    expect(snap.confidence).toBe("low");

    expect(speakerDisplayLabel(0, snap)).not.toBe("You");
  });
});

describe("createSpeakerIdentity manual correction", () => {
  it("setUserTag takes effect immediately and outranks the evidence", () => {
    const id = createSpeakerIdentity();
    id.observe({ speakerTag: 0, text: "Tell me about yourself?" });
    id.observe({
      speakerTag: 1,
      text: "I am a backend engineer with six years across payments and infrastructure and most recently I have been leading the reliability work on our checkout path",
    });

    id.setUserTag(0);

    expect(id.labelFor(0)).toBe("you");
    expect(id.labelFor(1)).toBe("them");
    expect(id.snapshot().confidence).toBe("high");
    expect(id.snapshot().overridden).toBe(true);
    expect(id.shouldEvaluateAsQuestion(0)).toBe(false);
  });

  it("a correction is permanent - later evidence never overturns it", () => {
    const id = createSpeakerIdentity();
    id.setUserTag(0);

    // Pile on exactly the evidence that would otherwise elect tag 1, including
    // questions from tag 0 itself.
    for (let i = 0; i < 6; i += 1) {
      id.observe({ speakerTag: 0, text: "What happened next?" });
      id.observe({
        speakerTag: 1,
        text: "We rolled the change out region by region and watched the error budget the whole way through, holding at ten percent for a full day before going wider",
      });
    }

    expect(id.snapshot().userTag).toBe(0);
    expect(id.labelFor(0)).toBe("you");
    expect(id.snapshot().overridden).toBe(true);
    expect(id.shouldEvaluateAsQuestion(0)).toBe(false);
  });

  it("swap moves the user tag to the other observed voice", () => {
    const id = createSpeakerIdentity();
    id.observe({ speakerTag: 0, text: "Walk me through your last project?" });
    id.observe({
      speakerTag: 1,
      text: "We replaced a nightly batch job with a streaming pipeline and the freshness went from twelve hours to about ninety seconds end to end across every downstream consumer",
    });
    id.observe({ speakerTag: 0, text: "How big was the team?" });
    id.observe({
      speakerTag: 1,
      text: "Four engineers and a product manager, and I was the tech lead for the second half of it after our staff engineer moved teams partway through",
    });

    expect(id.snapshot().userTag).toBe(1);
    id.swap();

    expect(id.snapshot().userTag).toBe(0);
    expect(id.snapshot().overridden).toBe(true);
  });
});
