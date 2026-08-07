import { describe, it, expect } from "vitest";
import { critiqueAnswerLocal, buildDeliveryNotes, normalizeMetrics } from "./critiqueLocal.js";
import { computeAnswerMetrics, MAX_PLAUSIBLE_WPM } from "./answerMetrics.js";
import { MIN_LUMA_SAMPLES, MIN_MOTION_SAMPLES } from "./videoStats.js";

// Covers the fixes documented inline in critiqueLocal.js: BUG-7 (the
// numeric Result-beat alternatives were unmatchable), BUG-8 (a 3-of-4 STAR
// answer claimed completeness it didn't earn), and BUG-9 (the Situation and
// trade-off cues fired on ordinary prose with no real cue in it).

describe("detectStar via critiqueAnswerLocal — result beat (BUG-7)", () => {
  it("credits a percentage-only result sentence", () => {
    const result = critiqueAnswerLocal({
      question: "Tell me about a time you improved a process.",
      type: "behavioral",
      answer: "Support tickets fell by 40% after the change.",
    });
    expect(result.star).toEqual({ situation: false, task: false, action: false, result: true });
  });

  it("credits a dollar-figure result sentence", () => {
    const result = critiqueAnswerLocal({
      question: "Tell me about a time you increased revenue.",
      type: "behavioral",
      answer: "It generated $250,000 in new revenue.",
    });
    expect(result.star).toEqual({ situation: false, task: false, action: false, result: true });
  });
});

describe("STAR completeness claim matches the booleans (BUG-8)", () => {
  it("does not claim a complete STAR story with only three of four beats present, and does not contradict the missing list", () => {
    const answer =
      "During my time at Acme, my task was to improve onboarding for new hires. " +
      "I built a new training program and rolled it out to the team. " +
      "Everyone seemed to like the new process quite a bit.";
    const result = critiqueAnswerLocal({
      question: "Tell me about a time you improved a process.",
      type: "behavioral",
      answer,
    });

    expect(result.star).toEqual({ situation: true, task: true, action: true, result: false });

    const strengthsText = result.strengths.join(" ");
    expect(strengthsText).toMatch(/situation, task, action/);
    expect(strengthsText).not.toMatch(/a complete STAR story/i);

    // The same response must name the missing beat rather than praise
    // completeness while silently leaving it off the list (or vice versa).
    expect(result.missing).toContain(
      "The question calls for a STAR answer, and this one never establishes a measurable result.",
    );
  });

  it("claims a complete STAR story only once all four beats are actually present", () => {
    const answer =
      "During my time at Acme, my task was to improve onboarding for new hires. " +
      "I built a new training program and rolled it out to the team. " +
      "Support tickets fell by 40% after the change.";
    const result = critiqueAnswerLocal({
      question: "Tell me about a time you improved a process.",
      type: "behavioral",
      answer,
    });

    expect(result.star).toEqual({ situation: true, task: true, action: true, result: true });
    expect(result.strengths).toContain(
      "You covered situation, task, action, and result clearly — a complete STAR story.",
    );
    expect(result.missing).toEqual([]);
  });
});

describe("cue regexes do not fire on ordinary sentences (BUG-9)", () => {
  it("does not credit a Situation beat for 'I looked at the logs'", () => {
    const result = critiqueAnswerLocal({
      question: "Tell me about a time you debugged an issue.",
      type: "behavioral",
      answer: "I looked at the logs.",
    });
    expect(result.star).toEqual({ situation: false, task: false, action: false, result: false });
  });

  it("does not credit a trade-off for a bare 'however' with no comparison or cost named", () => {
    const answer =
      "The problem is our search was slow. I would add a cache in front of the database. " +
      "However, most users did not seem to mind the current speed.";
    const result = critiqueAnswerLocal({
      question: "How would you speed up search?",
      type: "technical",
      answer,
    });
    expect(result.missing).toContain("No trade-off is acknowledged.");
  });

  it("does not credit a trade-off for a bare 'although' with no comparison or cost named", () => {
    const answer =
      "The problem is our search was slow. I would add a cache in front of the database. " +
      "Although the cache adds complexity to the system.";
    const result = critiqueAnswerLocal({
      question: "How would you speed up search?",
      type: "technical",
      answer,
    });
    expect(result.missing).toContain("No trade-off is acknowledged.");
  });
});

describe("star is populated for behavioral questions and null otherwise", () => {
  it("returns a populated star object for a behavioral question", () => {
    const result = critiqueAnswerLocal({
      question: "Tell me about a time you led a project.",
      type: "behavioral",
      answer: "I led the project from start to finish.",
    });
    expect(result.star).not.toBeNull();
    expect(Object.keys(result.star).sort()).toEqual(["action", "result", "situation", "task"]);
  });

  it("returns a null star for a technical question", () => {
    const result = critiqueAnswerLocal({
      question: "How would you design a URL shortener?",
      type: "technical",
      answer: "I would use a hash function to map long URLs to short codes.",
    });
    expect(result.star).toBeNull();
  });

  it("returns a null star for a general question", () => {
    const result = critiqueAnswerLocal({
      question: "Why do you want to work here?",
      type: "general",
      answer: "I admire the company's mission and want to contribute.",
    });
    expect(result.star).toBeNull();
  });

  it("falls back to general (null star) for an unrecognized type", () => {
    const result = critiqueAnswerLocal({
      question: "Random question?",
      type: "not-a-real-type",
      answer: "Some answer text here that is reasonably long.",
    });
    expect(result.star).toBeNull();
  });
});

// The AC-C4-1 score contract, checked at the input extremes: whatever the
// answer looks like, `score` must stay a whole number on [0, 100] — never
// NaN (a bad division), never negative, never over 100, never a float.
describe("critiqueAnswerLocal — score stays an integer in [0, 100] at input extremes", () => {
  function expectValidScore(score) {
    expect(Number.isInteger(score)).toBe(true);
    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThanOrEqual(100);
  }

  it("scores an empty answer as exactly 0", () => {
    const result = critiqueAnswerLocal({
      question: "Tell me about a time you led a project.",
      type: "behavioral",
      answer: "",
    });
    expectValidScore(result.score);
    expect(result.score).toBe(0);
  });

  it("scores a one-word answer as a valid, low integer", () => {
    const result = critiqueAnswerLocal({
      question: "Tell me about a time you led a project.",
      type: "behavioral",
      answer: "Yes.",
    });
    expectValidScore(result.score);
    // No STAR beat, no specificity, no relevant keyword, and far short of
    // the ideal length band — a bare "Yes." earns nothing.
    expect(result.score).toBe(0);
  });

  it("scores a 2000-word answer as a valid integer, heavily penalized for excessive length", () => {
    const answer = `${Array.from({ length: 2000 }, () => "word").join(" ")}.`;
    const result = critiqueAnswerLocal({
      question: "Tell me about a time you led a project.",
      type: "general",
      answer,
    });
    expectValidScore(result.score);
    // 2000 words is ~1780 words past the 220-word ideal ceiling — the length
    // component alone bottoms out at 0, dragging the composite well below a
    // passing score even though the answer trivially clears the "opens with
    // a claim" word-count bar.
    expect(result.score).toBe(19);
    expect(result.score).toBeLessThan(50);
  });

  it("scores an answer that is entirely filler as a valid integer, below a substantive answer to the same question", () => {
    const fillerText = Array(20).fill("Um, uh, you know, sort of, kind of, I mean.").join(" ");
    const fillerMetrics = computeAnswerMetrics({ text: fillerText, durationMs: 60000, speechDurationMs: 60000 });
    const fillerResult = critiqueAnswerLocal({
      question: "Tell me about a time you led a project.",
      type: "general",
      answer: fillerText,
      metrics: fillerMetrics,
    });
    expectValidScore(fillerResult.score);

    const substantiveAnswer =
      "At Acme, my task was to modernize our deployment pipeline. " +
      "I built a new CI/CD system, migrated the team's services onto it, and coordinated the rollout. " +
      "As a result, deploy time dropped by 60% and the team shipped twice as often.";
    const substantiveMetrics = computeAnswerMetrics({
      text: substantiveAnswer,
      durationMs: 30000,
      speechDurationMs: 30000,
    });
    const substantiveResult = critiqueAnswerLocal({
      question: "Tell me about a time you led a project.",
      type: "behavioral",
      answer: substantiveAnswer,
      metrics: substantiveMetrics,
    });
    expectValidScore(substantiveResult.score);

    expect(fillerResult.score).toBe(34);
    expect(substantiveResult.score).toBe(54);
    expect(fillerResult.score).toBeLessThan(substantiveResult.score);
  });
});

// No Date.now(), no randomness, no reliance on object/Map iteration order
// that could vary between two calls: the same inputs must produce the same
// score AND the same wording, every time, across every field the contract
// returns (score, verdict, strengths, improvements, missing, star, delivery,
// source) — not just the numeric score.
describe("critiqueAnswerLocal — fully deterministic", () => {
  it("returns byte-for-byte identical results for identical inputs, including delivery/video branches", () => {
    const posting = {
      title: "Backend Engineer",
      company: "Acme",
      description: "Experience with SQL and AWS required.",
    };
    const metrics = computeAnswerMetrics({
      text: "I built and led a project that reduced costs by 40%.",
      durationMs: 20000,
      speechDurationMs: 20000,
      video: {
        hadVideo: true,
        frames: 6,
        motionSamples: 5,
        meanLuma: 120,
        contrast: 30,
        motion: 5,
        tooDark: false,
        tooBright: false,
        veryStill: false,
        fidgety: false,
        partiallyOff: false,
      },
    });
    const inputs = {
      question: "Tell me about a time you led a project.",
      type: "behavioral",
      answer: "I built and led a project that reduced costs by 40%.",
      posting,
      profile: "Senior Engineer at Acme.",
      metrics,
    };

    const first = critiqueAnswerLocal(inputs);
    const second = critiqueAnswerLocal(inputs);
    const third = critiqueAnswerLocal({ ...inputs });

    expect(second).toEqual(first);
    expect(third).toEqual(first);
    // Guard the determinism check itself against a vacuous pass (e.g. every
    // field defaulting to the same empty/zero value regardless of input).
    expect(first.score).toBe(62);
    expect(first.strengths.length).toBeGreaterThan(0);
  });
});

// BUG-10: a bare String.includes would match "Go" inside "going" or "C"
// inside "Cathy" and manufacture posting-vocabulary overlap the answer never
// earned. containsTerm requires a real word boundary, and MIN_POSTING_TERM_LENGTH
// skips canonicals shorter than 3 characters entirely (too likely to
// coincide with an ordinary short word to safely credit).
describe("critiqueAnswerLocal — posting-vocabulary overlap respects word boundaries and a minimum length", () => {
  it("does not credit a posting term found only as a substring of another word", () => {
    const posting = { title: "Software Engineer", company: "Acme", description: "Experience with SQL required." };
    const question = "Tell me about a time you improved a system.";
    const base = "I improved our reporting pipeline significantly by rewriting the";

    // "NoSQL" contains the substring "sql" but is a different word entirely.
    const embedded = critiqueAnswerLocal({
      question,
      type: "general",
      answer: `${base} NoSQL queries.`,
      posting,
    });
    // The standalone word "SQL" is a real, word-bounded posting-term hit.
    const standalone = critiqueAnswerLocal({
      question,
      type: "general",
      answer: `${base} SQL queries.`,
      posting,
    });

    expect(embedded.score).toBe(33);
    expect(standalone.score).toBe(37);
    expect(standalone.score).toBeGreaterThan(embedded.score);
  });

  it("never manufactures a strength or a missing-term callout from short taxonomy entries like 'Go' and 'C', even when the answer is full of lookalike words", () => {
    const posting = {
      title: "Software Engineer",
      company: "Acme",
      // Mentions Go and C prominently (via their taxonomy aliases), both
      // canonicals shorter than MIN_POSTING_TERM_LENGTH.
      description: "Looking for Go and C experience. Golang and C programming a must.",
    };
    const question = "Tell me about a time you improved a system.";
    const answer =
      "During my time at Acme, my task was to improve reliability. " +
      // "going" and "Cathy" are the exact kind of lookalike substrings a
      // boundary-less match against "Go"/"C" would have falsely credited.
      "I was going through incident reports with Cathy and rewriting the alerting logic. " +
      "As a result, incidents dropped by 40%.";

    const result = critiqueAnswerLocal({ question, type: "behavioral", answer, posting });

    // Only the real STAR gap is reported — no posting-term callout for "Go"
    // or "C" (there is nothing else in this posting to name).
    expect(result.missing).toEqual([
      "The question calls for a STAR answer, and this one never establishes the specific actions taken.",
    ]);
    expect(result.missing.join(" ")).not.toMatch(/"Go"|"C"/);
    expect(result.strengths.join(" ")).not.toMatch(/term.*straight from the posting/);
  });
});

// BUG-11: interview-question boilerplate ("tell", "me", "about", "a",
// "time"...) is stripped from the QUESTION side before computing overlap, so
// a directly responsive answer that never echoes the question's own
// scaffolding back is not told it drifted from what was asked.
describe("critiqueAnswerLocal — relevance strips interview-question boilerplate before scoring overlap", () => {
  it("credits full relevance for an answer that engages the question's real terms without repeating its boilerplate phrasing", () => {
    const question = "Tell me about a time you handled a difficult stakeholder.";
    const answer =
      "I handled a very difficult stakeholder who kept changing requirements. " +
      "I aligned with them on scope early and kept them updated weekly.";

    const result = critiqueAnswerLocal({ question, type: "general", answer });

    // "handled", "difficult", "stakeholder" are the question's only real
    // (non-boilerplate) terms, and the answer hits all three.
    expect(result.strengths).toContain(
      "You stayed on-topic — 3/3 of the question's key terms showed up in your answer.",
    );
    // It must not also be told it drifted from the question.
    expect(result.improvements.join(" ")).not.toMatch(/drifts from what was actually asked/);
  });
});

// BUG-12: an empty or whitespace-only answer never throws, and never
// critiques the style/relevance/structure of prose that was never actually
// said — it returns a low score, an honest verdict that nothing was
// captured, no strengths, and improvements that say plainly that nothing was
// recorded.
describe("critiqueAnswerLocal — empty or whitespace-only answer", () => {
  it("does not throw for an empty string", () => {
    expect(() =>
      critiqueAnswerLocal({
        question: "Tell me about a time you led a project.",
        type: "behavioral",
        answer: "",
      }),
    ).not.toThrow();
  });

  it("does not throw for a whitespace-only string", () => {
    expect(() =>
      critiqueAnswerLocal({
        question: "Tell me about a time you led a project.",
        type: "behavioral",
        answer: "   \n\t  ",
      }),
    ).not.toThrow();
  });

  it("returns a low score, an honest verdict, no strengths, and a plain no-speech improvement — for both empty and whitespace-only text", () => {
    const question = "Tell me about a time you led a project.";
    for (const answer of ["", "   \n\t  "]) {
      const result = critiqueAnswerLocal({ question, type: "behavioral", answer });

      expect(result.score).toBe(0);
      expect(result.verdict).toBe("No answer was captured for this question, so there is nothing to evaluate.");
      // No praise for silence, and no critique of prose that was never said.
      expect(result.strengths).toEqual([]);
      expect(result.improvements).toEqual([
        "No speech was captured for this answer — there is nothing to improve on until you record one.",
      ]);
      expect(result.star).toEqual({ situation: false, task: false, action: false, result: false });
      expect(result.source).toBe("embedded");
    }
  });
});

// Builds normalized metrics the same way callers (route.js) do: raw input
// through normalizeMetrics, then straight into buildDeliveryNotes.
function notesFor(raw) {
  return buildDeliveryNotes(normalizeMetrics(raw));
}

describe("buildDeliveryNotes — visual claims are sample-gated", () => {
  it("makes no visual claim of any kind when video.hadVideo is false, even when the other video fields look already measured", () => {
    const notes = notesFor({
      wordCount: 10,
      speechDurationSec: 5,
      video: { hadVideo: false, frames: 5, motionSamples: 5, tooDark: true, veryStill: true },
    });
    expect(notes).toEqual([
      "You spoke for 5 seconds at 0 words per minute (conversational).",
      "No filler words were heard.",
      "The camera was off for this answer, so there are no visual delivery notes.",
    ]);
  });

  it("reports only the generic gate message, phrased for whether the camera was off for part of the answer, when neither luma nor motion samples clear their gates — even with the flags themselves set true", () => {
    const underGate = (partiallyOff) =>
      notesFor({
        wordCount: 10,
        speechDurationSec: 5,
        video: {
          hadVideo: true,
          frames: MIN_LUMA_SAMPLES - 1,
          motionSamples: MIN_MOTION_SAMPLES - 1,
          tooDark: true,
          veryStill: true,
          partiallyOff,
        },
      })[2];

    // Under-gate: no "dark"/"still" wording leaks through even though the
    // (unreliable) flags say so — a false-from-too-few-samples reading must
    // never be worded as a real measurement, positive or negative.
    expect(underGate(false)).toBe("Not enough camera data was captured for lighting or steadiness notes.");
    expect(underGate(true)).toBe(
      "The camera was off for part of this answer — not enough on-camera data for lighting or steadiness notes.",
    );
  });

  it("claims lighting (dark, bright, or fine) only once luma samples clear the gate, with no steadiness wording while motion is still under-sampled", () => {
    const dark = notesFor({
      wordCount: 10,
      speechDurationSec: 5,
      video: { hadVideo: true, frames: MIN_LUMA_SAMPLES, motionSamples: MIN_MOTION_SAMPLES - 1, tooDark: true },
    })[2];
    expect(dark).toBe("Camera: lighting looked dark.");

    // Same under-sampled motion, but nothing wrong with the lighting this
    // time — "fine" must be just as gated as "dark"/"bright" is.
    const fine = notesFor({
      wordCount: 10,
      speechDurationSec: 5,
      video: { hadVideo: true, frames: MIN_LUMA_SAMPLES, motionSamples: MIN_MOTION_SAMPLES - 1 },
    })[2];
    expect(fine).toBe("Camera: lighting looked fine.");
  });

  it("claims steadiness only once motion samples clear the gate, with no lighting wording while luma is still under-sampled", () => {
    const notes = notesFor({
      wordCount: 10,
      speechDurationSec: 5,
      video: { hadVideo: true, frames: MIN_LUMA_SAMPLES - 1, motionSamples: MIN_MOTION_SAMPLES, veryStill: true },
    });
    expect(notes[2]).toBe("Camera: very little movement in frame.");
  });

  it("claims both lighting and steadiness together once both gates clear", () => {
    const notes = notesFor({
      wordCount: 10,
      speechDurationSec: 5,
      video: { hadVideo: true, frames: MIN_LUMA_SAMPLES, motionSamples: MIN_MOTION_SAMPLES },
    });
    expect(notes[2]).toBe("Camera: lighting looked fine; motion looked steady.");
  });
});

describe("buildDeliveryNotes — pace note", () => {
  it("says no speech was captured when wordCount is 0 — not the same message as an untimed-speech gap", () => {
    const notes = notesFor({ wordCount: 0 });
    expect(notes).toEqual([
      "No speech was captured for this answer.",
      "The camera was off for this answer, so there are no visual delivery notes.",
    ]);
  });

  it("distinguishes real speech with no timing data from silence, and pluralizes the word count correctly", () => {
    const plural = notesFor({ wordCount: 12, speechDurationSec: 0 })[0];
    expect(plural).toBe("12 words were captured, but there wasn't enough timing data to measure pace.");

    const singular = notesFor({ wordCount: 1, speechDurationSec: 0 })[0];
    expect(singular).toBe("1 word was captured, but there wasn't enough timing data to measure pace.");
  });

  it("reports seconds, words per minute, and pace label once speech was both captured and timed", () => {
    const note = notesFor({
      wordCount: 40,
      speechDurationSec: 20,
      wordsPerMinute: 120,
      paceLabel: "conversational",
    })[0];
    expect(note).toBe("You spoke for 20 seconds at 120 words per minute (conversational).");
  });
});

describe("buildDeliveryNotes — mic muted", () => {
  it("surfaces the mic-muted note as its own explicit line rather than folding it silently into the (already-gapped) pace and camera lines", () => {
    const notes = notesFor({ wordCount: 0, video: { hadVideo: false }, micMuted: true });
    expect(notes).toEqual([
      "No speech was captured for this answer.",
      "The camera was off for this answer, so there are no visual delivery notes.",
      "The mic was muted for part of this answer, so word count and pace may be understated.",
    ]);
  });

  it("omits the mic-muted note entirely when the mic was never muted", () => {
    const notes = notesFor({ wordCount: 0, video: { hadVideo: false }, micMuted: false });
    expect(notes).toEqual([
      "No speech was captured for this answer.",
      "The camera was off for this answer, so there are no visual delivery notes.",
    ]);
  });
});

// BUG-1: buildDeliveryNotes reserves the body-language note its own slot
// instead of letting it compete with pace/filler/camera/mic for the same
// MAX_LIST (4) cap. Before the fix, the body-language note was appended
// last and then sliced away by notes.slice(0, MAX_LIST) whenever the other
// four notes already filled every slot — so a fully measured, fully scored
// body-language summary silently vanished from the response the moment the
// mic had also been muted for part of the answer.
describe("buildDeliveryNotes — body language note is never dropped by MAX_LIST (BUG-1 regression)", () => {
  // Fills all four of the non-body-language note slots: pace, filler,
  // camera, and mic-muted.
  const fourOtherNotesRaw = {
    wordCount: 40,
    speechDurationSec: 20,
    wordsPerMinute: 120,
    paceLabel: "conversational",
    fillerCount: 2,
    fillerRate: 5,
    fillers: [{ phrase: "um", count: 2 }],
    video: {
      hadVideo: true,
      frames: MIN_LUMA_SAMPLES,
      motionSamples: MIN_MOTION_SAMPLES,
      tooDark: false,
      tooBright: false,
      veryStill: false,
      fidgety: false,
      partiallyOff: false,
    },
    micMuted: true,
  };

  const fullyMeasuredBodyLanguage = {
    available: true,
    eyeContactRatio: 0.82,
    gestureRate: 0.4,
    handsVisibleRatio: 0.9,
  };
  const expectedBodyLanguageNote =
    "Body language: Head orientation: facing the camera 82% of the time your face was visible to the camera " +
    "(head orientation, not eye contact). Gestures: hand movement measured 0.40 (normalized wrist movement per " +
    "sample) (hands visible 90% of the time).";

  it("without body language, pace/filler/camera/mic all four fit under MAX_LIST untouched", () => {
    // Baseline for the regression case below: confirms these four notes
    // really do fill every slot on their own, with nothing trimmed.
    expect(notesFor(fourOtherNotesRaw)).toEqual([
      "You spoke for 20 seconds at 120 words per minute (conversational).",
      '2 filler words (5.0% of words) — mostly "um" x2.',
      "Camera: lighting looked fine; motion looked steady.",
      "The mic was muted for part of this answer, so word count and pace may be understated.",
    ]);
  });

  it("keeps the body-language note when a fully measured summary is added on top of an already-full mic-muted note list, evicting the mic note instead", () => {
    const notes = notesFor({ ...fourOtherNotesRaw, bodyLanguage: fullyMeasuredBodyLanguage });

    // The regression: the body-language note must survive even though the
    // mic was also muted and the other four notes already filled every
    // MAX_LIST slot.
    expect(notes).toContain(expectedBodyLanguageNote);
    // MAX_LIST (4) is still respected — adding body language does not grow
    // the list past its existing cap.
    expect(notes).toHaveLength(4);
    // Pace, filler, and camera survive unchanged; the mic-muted note is what
    // gets evicted to make room, not the body-language note.
    expect(notes).toEqual([
      "You spoke for 20 seconds at 120 words per minute (conversational).",
      '2 filler words (5.0% of words) — mostly "um" x2.',
      "Camera: lighting looked fine; motion looked steady.",
      expectedBodyLanguageNote,
    ]);
    expect(notes).not.toContain(
      "The mic was muted for part of this answer, so word count and pace may be understated.",
    );
  });

  it("does not evict anything when there is room under MAX_LIST for both the other notes and the body-language note", () => {
    const notes = notesFor({
      wordCount: 0,
      video: { hadVideo: false },
      bodyLanguage: { available: true, eyeContactRatio: 0.5 },
    });
    expect(notes).toEqual([
      "No speech was captured for this answer.",
      "The camera was off for this answer, so there are no visual delivery notes.",
      "Body language: Head orientation: facing the camera 50% of the time your face was visible to the camera " +
        "(head orientation, not eye contact).",
    ]);
  });

  it("leaves the other notes at the full MAX_LIST budget when there is no body-language note at all", () => {
    // available: false is D2's own "not measured" shape — must behave
    // identically to the field being omitted entirely.
    const notes = notesFor({ ...fourOtherNotesRaw, bodyLanguage: { available: false } });
    expect(notes).toEqual([
      "You spoke for 20 seconds at 120 words per minute (conversational).",
      '2 filler words (5.0% of words) — mostly "um" x2.',
      "Camera: lighting looked fine; motion looked steady.",
      "The mic was muted for part of this answer, so word count and pace may be understated.",
    ]);
    expect(notes.some((note) => note.startsWith("Body language:"))).toBe(false);
  });

  it("is identifiable by its 'Body language:' prefix so a caller can split it back out of the list", () => {
    const notes = notesFor({ ...fourOtherNotesRaw, bodyLanguage: fullyMeasuredBodyLanguage });
    const bodyLanguageNotes = notes.filter((note) => note.startsWith("Body language:"));
    const otherNotes = notes.filter((note) => !note.startsWith("Body language:"));

    expect(bodyLanguageNotes).toEqual([expectedBodyLanguageNote]);
    expect(otherNotes).toEqual([
      "You spoke for 20 seconds at 120 words per minute (conversational).",
      '2 filler words (5.0% of words) — mostly "um" x2.',
      "Camera: lighting looked fine; motion looked steady.",
    ]);
  });
});

describe("critiqueAnswerLocal — delivery weighting when nothing is measurable", () => {
  // A real, well-structured behavioral answer, deliberately paired with
  // metrics = null (no speech/video signal at all): the answer's own
  // content is judged on its merits, while every delivery sub-score
  // (pace/filler/video) comes back null because nothing was measured.
  const question = "Tell me about a time you migrated a database using Postgres and Kubernetes.";
  const answer = [
    "A few months ago, I was responsible for scaling our database after signups doubled in a single quarter.",
    "I migrated the primary database to a sharded architecture using Postgres, spending several weeks planning the cutover carefully with the infrastructure team.",
    "I used Kubernetes and Jenkins to support the rollout, working closely with Salesforce integration partners to keep everything online during the migration window.",
    "As a result, query times dropped and the on-call pager stayed quiet for the rest of the quarter, which freed up time for other roadmap work across the team.",
  ].join(" ");

  it("excludes delivery from the composite score (renormalizing the remaining weights) and never blames it in the verdict, instead of scoring it zero", () => {
    const result = critiqueAnswerLocal({ question, type: "behavioral", answer, posting: null, metrics: null });

    // Structure is a full STAR story (100), relevance is a full 4/4 term
    // overlap (100), and length lands in the ideal band (100); specificity
    // has no hasMetric credit here (30, from proper nouns alone). Weighted
    // over only those four components' weights (0.3+0.2+0.2+0.1=0.8), with
    // delivery dropped out entirely rather than averaged in as a 0:
    //   (100*0.3 + 30*0.2 + 100*0.2 + 100*0.1) / 0.8 = 66 / 0.8 = 82.5 -> 83
    // If delivery had instead been scored 0 and kept in the denominator,
    // this would come out to 66, not 83.
    expect(result.score).toBe(83);
    expect(result.verdict).toBe("Solid answer at 83/100, though it stays generic instead of citing specifics.");
    expect(result.verdict).not.toContain("delivery");

    // The delivery notes themselves are still produced (they're independent
    // of the composite score) and honestly report that nothing was captured.
    expect(result.delivery).toEqual([
      "No speech was captured for this answer.",
      "The camera was off for this answer, so there are no visual delivery notes.",
    ]);
  });
});

describe("normalizeMetrics — paceLabel whitelist", () => {
  it("passes the three real pace labels through unchanged", () => {
    expect(normalizeMetrics({ paceLabel: "slow" }).paceLabel).toBe("slow");
    expect(normalizeMetrics({ paceLabel: "rushed" }).paceLabel).toBe("rushed");
    expect(normalizeMetrics({ paceLabel: "conversational" }).paceLabel).toBe("conversational");
  });

  it("falls back a missing, invalid, or prototype-shaped paceLabel to conversational rather than passing it through", () => {
    expect(normalizeMetrics({}).paceLabel).toBe("conversational");
    expect(normalizeMetrics({ paceLabel: "fast" }).paceLabel).toBe("conversational");
    for (const hostile of ["constructor", "__proto__", "prototype", "toString", "hasOwnProperty", "valueOf"]) {
      expect(normalizeMetrics({ paceLabel: hostile }).paceLabel).toBe("conversational");
    }
  });

  it("keeps a hostile paceLabel from producing NaN anywhere in critiqueAnswerLocal's score or verdict", () => {
    const result = critiqueAnswerLocal({
      question: "Tell me about a time you led a project.",
      type: "general",
      answer: "I led a project and it went well for the whole team over several months.",
      metrics: { paceLabel: "constructor", wordCount: 50, speechDurationSec: 20, wordsPerMinute: 150 },
    });

    expect(Number.isFinite(result.score)).toBe(true);
    expect(result.score).toBe(57);
    expect(result.verdict).toBe(
      "This needs work — 57/100, mainly because it stays generic instead of citing specifics.",
    );
    expect(result.verdict).not.toContain("NaN");
    // The hostile label resolved to the conversational default rather than
    // an unresolved lookup (e.g. Object's real `constructor` function),
    // which is what would have driven the wpm math to NaN.
    expect(result.delivery[0]).toBe("You spoke for 20 seconds at 150 words per minute (conversational).");
  });
});

// R-127: normalizeMetrics must independently RE-DERIVE plausibility from the
// numeric wordsPerMinute it just normalized, never trust a client-supplied
// `paceIsPlausible` field — a client that lies (or one from before this
// field existed, which never sends it at all) must not be able to assert an
// impossible wpm as ground truth to the critique prompt.
describe("normalizeMetrics — paceIsPlausible (R-127)", () => {
  it("is true for an ordinary, physically-possible wpm", () => {
    expect(normalizeMetrics({ wordsPerMinute: 150 }).paceIsPlausible).toBe(true);
  });

  it(`is true at exactly the ${MAX_PLAUSIBLE_WPM} wpm ceiling and false just past it`, () => {
    expect(normalizeMetrics({ wordsPerMinute: MAX_PLAUSIBLE_WPM }).paceIsPlausible).toBe(true);
    expect(normalizeMetrics({ wordsPerMinute: MAX_PLAUSIBLE_WPM + 1 }).paceIsPlausible).toBe(false);
  });

  it("is true (not implausible) when no wpm was supplied at all — 0 is trivially plausible", () => {
    expect(normalizeMetrics({}).paceIsPlausible).toBe(true);
  });

  it("reproduces the diagnosed production case: 367 wpm (a doubled 196-word transcript over the true, undoubled speech span) is flagged implausible", () => {
    expect(normalizeMetrics({ wordsPerMinute: 367 }).paceIsPlausible).toBe(false);
  });

  it("IGNORES a client payload's own paceIsPlausible claim and recomputes from wordsPerMinute regardless — this is the actual defensive check", () => {
    // A lying (or merely stale) client claims everything is fine at an
    // impossible wpm — normalizeMetrics must not take its word for it.
    expect(normalizeMetrics({ wordsPerMinute: 500, paceIsPlausible: true }).paceIsPlausible).toBe(false);
    // And the reverse: a client that (incorrectly) flags a perfectly
    // plausible wpm as implausible does not get to suppress a real, honest
    // pace reading either — the server's own math is the only source of
    // truth here, in both directions.
    expect(normalizeMetrics({ wordsPerMinute: 140, paceIsPlausible: false }).paceIsPlausible).toBe(true);
  });
});

// R-127: computeAnswerMetrics is the client-side, honest-client copy of the
// same rule — proves the two independent computations (client and server)
// agree, and that the flag never depends on speechDurationSec/wordCount in
// a way that could fabricate a false positive from an unmeasured answer.
describe("computeAnswerMetrics — paceIsPlausible (R-127)", () => {
  it("is true for a normal pace and false for a doubled-transcript-shaped pace", () => {
    // 40 words over 20s = 120 wpm — ordinary.
    const normal = computeAnswerMetrics({ text: Array(40).fill("word").join(" "), durationMs: 20000, speechDurationMs: 20000 });
    expect(normal.wordsPerMinute).toBe(120);
    expect(normal.paceIsPlausible).toBe(true);

    // Same speech span, but wordCount doubled (exactly what an ElevenLabs
    // committed_transcript re-delivery did before the FIX 1 dedup) — 80
    // words over the SAME 20s speech span the true 40 words actually took,
    // since deriveSpeechSpan is a min/max over spans and is idempotent
    // under exact duplication (unlike the word-count SUM).
    const doubled = computeAnswerMetrics({ text: Array(80).fill("word").join(" "), durationMs: 20000, speechDurationMs: 20000 });
    expect(doubled.wordsPerMinute).toBe(240);
    expect(doubled.paceIsPlausible).toBe(true); // still under 300 — not every double is implausible

    // Push wordCount high enough that even a real doubling clears the
    // ceiling, matching the production report (196 words over ~32s -> 367
    // wpm true value ~184).
    const productionShaped = computeAnswerMetrics({
      text: Array(196).fill("word").join(" "),
      durationMs: 32000,
      speechDurationMs: 32000,
    });
    expect(Math.round(productionShaped.wordsPerMinute)).toBe(368);
    expect(productionShaped.paceIsPlausible).toBe(false);
  });

  it("stays plausible when nothing was measured at all (0 wpm)", () => {
    expect(computeAnswerMetrics({ text: "", durationMs: 5000, speechDurationMs: 5000 }).paceIsPlausible).toBe(true);
  });
});

// R-127: when the pace is implausible, buildDeliveryNotes must say so as a
// DATA problem, never cite the number as ground truth the way the normal
// pace note does — that citation is exactly what handed the Gemini prompt
// "367 wpm, rushed" as fact under BASE_SYSTEM's "treat those numbers as
// ground truth" instruction (app/api/copilot/critique/route.js).
describe("buildDeliveryNotes — implausible pace is reported as a measurement fault, not a delivery fact (R-127)", () => {
  it("does not emit the normal 'You spoke for... words per minute' sentence when paceIsPlausible is false", () => {
    const notes = notesFor({ wordCount: 196, speechDurationSec: 32, wordsPerMinute: 367, paceLabel: "rushed" });
    expect(notes[0]).not.toContain("words per minute");
    expect(notes[0]).not.toContain("367");
  });

  it("still reports that speech was captured, honestly, without asserting the impossible number as fact", () => {
    const notes = notesFor({ wordCount: 196, speechDurationSec: 32, wordsPerMinute: 367, paceLabel: "rushed" });
    expect(notes[0]).toContain("196 words");
    expect(notes[0]).toContain("32 seconds");
    expect(notes[0].toLowerCase()).toMatch(/measurement|physically/);
  });

  it("still emits the normal pace sentence, citing the number, once wpm is back under the ceiling", () => {
    const notes = notesFor({ wordCount: 40, speechDurationSec: 20, wordsPerMinute: 120, paceLabel: "conversational" });
    expect(notes[0]).toBe("You spoke for 20 seconds at 120 words per minute (conversational).");
  });
});

// R-127: the whole point of a FLAG instead of a clamp is that a measurement
// fault stops being REPORTED as a delivery fault without any SCORE moving —
// computePaceScore/computeDeliveryScore key off paceLabel alone and were
// never touched by this fix. Proven by holding paceLabel (and therefore the
// pace sub-score) fixed while flipping only wordsPerMinute/paceIsPlausible
// across the ceiling, and confirming critiqueAnswerLocal's overall score is
// byte-identical either way.
describe("critiqueAnswerLocal — an implausible wpm does not move the score (R-127)", () => {
  it("scores identically whether wordsPerMinute is a plausible 165 or an implausible 900, given the same paceLabel", () => {
    const inputs = (wordsPerMinute) => ({
      question: "Tell me about a time you led a project.",
      type: "general",
      answer: "I led a project and it went well for the whole team over several months.",
      metrics: { paceLabel: "rushed", wordCount: 50, speechDurationSec: 20, wordsPerMinute },
    });

    const plausible = critiqueAnswerLocal(inputs(165));
    const implausible = critiqueAnswerLocal(inputs(900));

    expect(implausible.score).toBe(plausible.score);
  });
});

// G2: `interviewType` (lib/copilot/interviewTypes.js) governs the ideal
// length band, appends format-specific expectation notes to `missing`, and
// names the format in the verdict — but only once a caller actually opts
// into a non-"general" format. AC-G2-B-7 requires that omitting
// `interviewType` and passing "general" explicitly stay byte-for-byte
// identical to each other (and to today's pre-G2 output) across a strong
// answer, a short vague answer, and an empty answer.
describe("critiqueAnswerLocal — interviewType omitted vs \"general\" is behavior-preserving (AC-G2-B-7)", () => {
  it("is identical for a strong behavioral answer with a metric", () => {
    const inputs = {
      question: "Tell me about a time you led a project.",
      type: "behavioral",
      answer:
        "During my time at Acme, my task was to modernize the deployment pipeline. " +
        "I built a new CI/CD system and coordinated the rollout. " +
        "As a result, deploy time dropped by 60%.",
    };
    const omitted = critiqueAnswerLocal(inputs);
    const general = critiqueAnswerLocal({ ...inputs, interviewType: "general" });

    expect(omitted).toEqual(general);
    // Grounded in the actual computed values, not just mutual equality: a
    // complete STAR story, no format phrase in the verdict, and a length
    // note keyed to the 80-220 default band.
    expect(omitted.score).toBe(45);
    expect(omitted.star).toEqual({ situation: true, task: true, action: true, result: true });
    expect(omitted.verdict).toBe("This answer falls short at 45/100 — it doesn't fully engage what was actually asked.");
    expect(omitted.improvements).toContain(
      "At 31 words, this is short for the 80-220 word range interviewers expect — add more detail.",
    );
  });

  it("is identical for a short vague answer", () => {
    const inputs = {
      question: "Tell me about a time you led a project.",
      type: "general",
      answer: "It went okay I guess.",
    };
    const omitted = critiqueAnswerLocal(inputs);
    const general = critiqueAnswerLocal({ ...inputs, interviewType: "general" });

    expect(omitted).toEqual(general);
    expect(omitted.score).toBe(1);
    expect(omitted.verdict).toBe("This answer falls short at 1/100 — the structure is thin.");
    expect(omitted.missing).toEqual([
      "The answer never opens with a clear claim.",
      "The claim is never backed with a specific example or number.",
    ]);
  });

  it("is identical for an empty answer", () => {
    const inputs = {
      question: "Tell me about a time you led a project.",
      type: "behavioral",
      answer: "",
    };
    const omitted = critiqueAnswerLocal(inputs);
    const general = critiqueAnswerLocal({ ...inputs, interviewType: "general" });

    expect(omitted).toEqual(general);
    expect(omitted.score).toBe(0);
    expect(omitted.verdict).toBe("No answer was captured for this question, so there is nothing to evaluate.");
    expect(omitted.strengths).toEqual([]);
  });
});

// The ideal word-count band now comes from the selected interview type's
// own lengthTarget rather than a fixed 80/220 window. Same question, same
// type, same 60-word answer — only interviewType changes — so any
// difference in the length-related output is attributable solely to the
// descriptor's lengthTarget, not to anything else about the answer.
describe("critiqueAnswerLocal — length band comes from the selected interviewType's lengthTarget", () => {
  const question = "Describe your background.";
  const sixtyWords = `${Array.from({ length: 60 }, (_, i) => `word${i}`).join(" ")}.`;

  it("scores a 60-word answer inside phone-screen's 50-130 band as well-calibrated", () => {
    const result = critiqueAnswerLocal({
      question,
      type: "general",
      answer: sixtyWords,
      interviewType: "phone-screen",
    });
    expect(result.strengths).toContain("Length was well-calibrated at 60 words.");
    expect(result.improvements.join(" ")).not.toMatch(/this is short/);
    expect(result.score).toBe(31);
  });

  it("scores the same 60-word answer as short under system-design's 150-320 band", () => {
    const result = critiqueAnswerLocal({
      question,
      type: "general",
      answer: sixtyWords,
      interviewType: "system-design",
    });
    expect(result.strengths).not.toContain("Length was well-calibrated at 60 words.");
    expect(result.improvements).toContain(
      "At 60 words, this is short for the 150-320 word range interviewers expect — add more detail.",
    );
    expect(result.score).toBe(24);
  });
});

// AC-G2-B-5: each of the selected interview type's own `expectations`
// (lib/copilot/interviewTypes.js) that the answer does NOT hit appends its
// note to `missing`, on top of whatever the base rubric already found — and
// an expectation the answer DOES hit contributes nothing. The existing
// MAX_LIST (4) cap still applies once expectation notes are appended.
describe("critiqueAnswerLocal — interviewType expectations append to missing (AC-G2-B-5)", () => {
  const question = "Design a URL shortener that scales to millions of users.";
  const baseAnswer =
    "I would start by breaking the system into a write path and a read path. " +
    "I would use a hash function to generate short codes and store the mapping in a distributed key-value store. " +
    "I would add caching in front of the database to handle read-heavy traffic at scale, " +
    "and I would shard the data by key to keep the system fast as usage grows across many servers worldwide.";

  it("appends the tradeoff expectation note when a system-design answer names no trade-off", () => {
    const result = critiqueAnswerLocal({
      question,
      type: "technical",
      answer: baseAnswer,
      interviewType: "system-design",
    });
    expect(result.missing).toEqual([
      "The answer never restates the problem before diving in.",
      "No trade-off is acknowledged.",
      "Weigh at least one real trade-off, such as consistency versus availability or cost versus latency, instead of presenting your design as the only option.",
    ]);
  });

  it("does not append the tradeoff expectation note once the answer names a trade-off", () => {
    const answerWithTradeoff =
      `${baseAnswer} There is a trade-off between consistency and availability here, ` +
      "and I chose availability for this use case.";
    const result = critiqueAnswerLocal({
      question,
      type: "technical",
      answer: answerWithTradeoff,
      interviewType: "system-design",
    });
    expect(result.missing).toEqual(["The answer never restates the problem before diving in."]);
    expect(result.missing.join(" ")).not.toMatch(/trade-off/i);
  });

  it("still caps the combined missing list at MAX_LIST (4) once structure, posting, and expectation notes are all combined", () => {
    const result = critiqueAnswerLocal({
      question,
      type: "technical",
      answer:
        "Our system needs to handle a lot of traffic every day. " +
        "We have many users hitting the service constantly throughout the week.",
      posting: {
        title: "Backend Engineer",
        company: "Acme",
        description: "Experience with Kubernetes and PostgreSQL required.",
      },
      interviewType: "system-design",
    });

    expect(result.missing).toHaveLength(4);
    expect(result.missing).toEqual([
      "The answer never restates the problem before diving in.",
      "No concrete approach is named.",
      "No trade-off is acknowledged.",
      'The posting emphasizes "PostgreSQL" — this answer never brings it up.',
    ]);
    // The system-design expectation notes (approach/trade-off) exist and
    // would otherwise have been appended, but the structure and posting
    // gaps alone already filled every MAX_LIST slot first.
    expect(result.missing.join(" ")).not.toMatch(/Walk through your approach/);
    expect(result.missing.join(" ")).not.toMatch(/Weigh at least one real trade-off/);
  });
});

// AC-G2-B-6: once there's a real score to attach it to, a non-"general"
// interviewType names the format being judged in the verdict; "general"
// (and the wordCount === 0 case, regardless of interviewType) never does.
describe("critiqueAnswerLocal — verdict names the format for a non-general interviewType (AC-G2-B-6)", () => {
  it("names the format in the verdict for a recognized non-general interviewType", () => {
    const result = critiqueAnswerLocal({
      question: "Tell me about yourself.",
      type: "general",
      answer: "I have worked in software for five years, mostly on backend systems at small startups.",
      interviewType: "phone-screen",
    });
    expect(result.score).toBe(48);
    expect(result.verdict).toBe(
      "This answer falls short at 48/100 for a recruiter phone screen interview — it stays generic instead of citing specifics.",
    );
  });

  it("names no format for the default \"general\" interviewType", () => {
    const result = critiqueAnswerLocal({
      question: "Tell me about yourself.",
      type: "general",
      answer: "I have worked in software for five years, mostly on backend systems at small startups.",
      interviewType: "general",
    });
    expect(result.verdict).not.toMatch(/for a .* interview/);
  });

  it("names no format when wordCount is 0, even for a recognized non-general interviewType", () => {
    const result = critiqueAnswerLocal({
      question: "Tell me about a time you led a project.",
      type: "behavioral",
      answer: "",
      interviewType: "system-design",
    });
    expect(result.verdict).toBe("No answer was captured for this question, so there is nothing to evaluate.");
    expect(result.verdict).not.toMatch(/for a .* interview/);
  });
});

// AC-G2-B-8: `star` is gated purely on the QUESTION's own `type`
// (behavioral/technical/general) — the selected practice-session
// `interviewType` never overrides that, in either direction.
describe("critiqueAnswerLocal — star is gated on question type, not interviewType (AC-G2-B-8)", () => {
  it("keeps star null for a technical QUESTION even when interviewType is behavioral", () => {
    const result = critiqueAnswerLocal({
      question: "How would you design a URL shortener?",
      type: "technical",
      answer: "I would use a hash function to map long URLs to short codes.",
      interviewType: "behavioral",
    });
    expect(result.star).toBeNull();
  });

  it("still populates star for a behavioral QUESTION even when interviewType is technical", () => {
    const result = critiqueAnswerLocal({
      question: "Tell me about a time you led a project.",
      type: "behavioral",
      answer: "I led the project from start to finish and it went well.",
      interviewType: "technical",
    });
    expect(result.star).toEqual({ situation: false, task: false, action: true, result: false });
  });
});

// AC-H5.22's submitted-documents grounding note has its own test file
// (critiqueLocalDocsGrounding.test.js) rather than a describe block here —
// this file was already close to the project's 1000-line-per-file cap.
