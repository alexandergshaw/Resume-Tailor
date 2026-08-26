import { describe, expect, it } from "vitest";
import { localDetection } from "./localDetection";
import { hasStarterOpener } from "./questions";

// AC-V5.6. The other measured second in the recorded session of 2026-08-25.
//
// From the log: the interviewer's first question was "Talk to me about what
// appealed to you about Purple Wave and why you applied." The utterance
// finalized at t=9799 and the card appeared at t=11192 — **1.4 seconds of pure
// detection latency**, spent on a network round trip to /api/copilot/detect,
// because the local heuristic missed it. Every other question in that session
// was detected in 0 ms.
//
// It missed for one reason: STARTERS already contains "talk about", "talk me
// through" and "talk us through", but not "talk to me". That gap cost the
// round trip AND the question's own wording — the remote confirm rewrote it to
// "Tell me what appealed to you about Purple Wave and why you applied", which
// is a different sentence from the one that was asked, and (because the
// duplicate frame took the same path and got a DIFFERENT rewrite) is how one
// spoken question became two cards with two different texts.
//
// This is not a new heuristic. It is one missing member of a family the module
// already has, and localDetection.js exists precisely so that the client-side
// decision and the server's embedded decision cannot disagree about it.

describe("the interviewer openers the heuristic already almost has (AC-V5.6)", () => {
  it("detects 'talk to me about ...' locally, with no round trip", () => {
    const result = localDetection(
      "Talk to me about what appealed to you about Purple Wave and why you applied.",
    );
    expect(result.decided).toBe(true);
    // And the question it decides on is the sentence that was actually asked —
    // not a model's paraphrase of it.
    expect(result.question).toBe(
      "Talk to me about what appealed to you about Purple Wave and why you applied.",
    );
  });

  it("detects the same opener with a lead-in in front of it", () => {
    // "Okay, so talk to me about ..." — the lead-in strip already runs before
    // the retry, so this must work for free once the opener exists.
    const result = localDetection("Okay, so talk to me about your last role.");
    expect(result.decided).toBe(true);
  });

  it("treats it as a starter, the same way its siblings are treated", () => {
    // Asserted through hasStarterOpener directly rather than only through
    // localDetection: routing back through detectQuestion would report
    // "punctuation" for any cleaned sentence that gained a synthesized "?",
    // which is exactly why localDetection.js asks this narrower question.
    expect(hasStarterOpener("talk to me about your last role")).toBe(true);
    // Its already-present siblings, asserted alongside so a change that adds
    // the new one by breaking the family fails here.
    expect(hasStarterOpener("talk me through your approach")).toBe(true);
    expect(hasStarterOpener("talk us through the design")).toBe(true);
    expect(hasStarterOpener("talk about a project you led")).toBe(true);
  });

  it("does not fire on a bare statement that merely contains the words", () => {
    // The negative control. STARTERS is an OPENER list — matching mid-sentence
    // would make half of ordinary speech a question.
    expect(hasStarterOpener("i would talk to me about it if i could")).toBe(false);
    expect(localDetection("She asked me to talk to my manager about it.").decided).toBe(false);
  });

  it("still leaves a genuine non-question undecided", () => {
    // The two utterances the recorded session correctly rejected. A widened
    // opener list that starts accepting these would put a card and a model
    // call behind every filler noise the room makes.
    expect(localDetection("That's a great question.").decided).toBe(false);
    expect(localDetection("Um, so I would say...").decided).toBe(false);
  });
});
