import { describe, it, expect, vi } from "vitest";
import {
  normalizeManualQuestion,
  submitPracticeQuestion,
  MAX_MANUAL_QUESTION_CHARS,
} from "./manualQuestion.js";

// AC-O1.1: the one decision behind "the user typed a question" — what counts
// as submittable, and what exact string gets submitted. It lives here rather
// than inside the input component or either hook because THREE callers make
// it (the component's own disabled state, useLiveSession's addManualQuestion,
// useRoomQuestions' addManualQuestion) and three copies of a predicate is how
// they drift. Everything below is the observable contract those three share.

describe("normalizeManualQuestion", () => {
  it("accepts an ordinary typed question and returns it verbatim", () => {
    const result = normalizeManualQuestion("Tell me about a time you handled conflict.");
    expect(result.ok).toBe(true);
    expect(result.question).toBe("Tell me about a time you handled conflict.");
  });

  it("trims surrounding whitespace", () => {
    expect(normalizeManualQuestion("   Why this role?  ").question).toBe("Why this role?");
  });

  it("collapses internal whitespace runs, including newlines and tabs", () => {
    // A paste out of a job posting or a chat window arrives with hard wraps in
    // it. The question is sent to a model and rendered on a card; the line
    // structure carries no meaning and hurts both.
    expect(normalizeManualQuestion("What is\n\nyour   greatest\tweakness?").question).toBe(
      "What is your greatest weakness?",
    );
  });

  it("never rewrites the user's own wording beyond whitespace", () => {
    // Deliberately NOT cleanQuestion() (lib/copilot/questions.js), which
    // exists to repair SPEECH — dropping leading filler, fixing transcription
    // artifacts, appending a question mark. Typed text has none of those
    // problems, and silently editing what someone typed is its own defect:
    // they would see a different question on the card than the one they
    // entered.
    const typed = "so, uh, walk me through your resume";
    expect(normalizeManualQuestion(typed).question).toBe(typed);
  });

  it("rejects an empty or whitespace-only entry", () => {
    for (const raw of ["", "   ", "\n\t  \r\n"]) {
      const result = normalizeManualQuestion(raw);
      expect(result.ok).toBe(false);
      expect(result.question).toBe("");
    }
  });

  it("rejects an entry with no letter or digit in it", () => {
    // "?" alone is the realistic accident here — a stray keystroke plus
    // Enter. Submitting it costs a model call and puts a meaningless card at
    // the top of the feed, which in live mode is the panel the candidate is
    // reading mid-interview.
    for (const raw of ["?", "???", "-- ...", "!!!"]) {
      const result = normalizeManualQuestion(raw);
      expect(result.ok).toBe(false);
      expect(result.question).toBe("");
    }
  });

  it("accepts a single real word", () => {
    // The floor is "has actual content", not "looks like a sentence" — a
    // one-word prompt ("Why?" is punctuation-plus-a-word) is a legitimate
    // thing an interviewer says, and the user typing it has already made the
    // is-this-a-question call that detection has to guess at.
    expect(normalizeManualQuestion("Why?").ok).toBe(true);
    expect(normalizeManualQuestion("Scalability").ok).toBe(true);
  });

  it("rejects a non-string input instead of throwing", () => {
    for (const raw of [null, undefined, 0, {}, []]) {
      expect(normalizeManualQuestion(raw).ok).toBe(false);
    }
  });

  it("caps the question at MAX_MANUAL_QUESTION_CHARS", () => {
    // The input control enforces the same cap via maxLength, so this is the
    // belt to that braces — the contract has to hold for any caller, not only
    // the one component that happens to guard its own field today.
    const long = "a".repeat(MAX_MANUAL_QUESTION_CHARS + 250);
    const result = normalizeManualQuestion(long);
    expect(result.ok).toBe(true);
    expect(result.question.length).toBe(MAX_MANUAL_QUESTION_CHARS);
  });

  it("is the ONLY bound on a typed question's length", () => {
    // Worth stating precisely, because the obvious rationale is wrong. A
    // typed question never reaches app/api/copilot/detect/route.js — skipping
    // that route is the whole feature — so its own 1200-char truncation does
    // not apply. The route a typed question DOES reach is
    // app/api/copilot/answer/route.js, which trims `question` and applies no
    // length cap to it at all. So this constant is not a mirror of a server
    // limit; it is the only thing standing between a pasted wall of text and
    // a model request, and it has to be a sane bound on its own merits.
    expect(MAX_MANUAL_QUESTION_CHARS).toBeGreaterThan(200);
    expect(MAX_MANUAL_QUESTION_CHARS).toBeLessThanOrEqual(2000);
  });

  it("is idempotent", () => {
    const once = normalizeManualQuestion("  Describe   a\nfailure. ");
    const twice = normalizeManualQuestion(once.question);
    expect(twice).toEqual(once);
  });
});

// AC-O5: practice mode does TWO things with one submit — the typed question
// becomes the drill question on the card AND joins the detected-question
// feed with a drafted answer. That is a sequence of side effects across
// three different hooks, so it is composed here, as an ordered call list
// over injected callbacks, rather than inlined into PracticeClient where the
// order would be unfalsifiable. Two individually-correct halves wired
// together in the wrong order is precisely the defect class R-166 exists
// for; here the wrong order silently loses a question from the asked list.
describe("submitPracticeQuestion", () => {
  function spies() {
    return {
      advanceAsked: vi.fn(),
      abandonAnswer: vi.fn(),
      resetAnswer: vi.fn(),
      setDrillQuestion: vi.fn(),
      addToFeed: vi.fn(),
    };
  }

  it("refuses a blank entry without touching anything", () => {
    const actions = spies();
    expect(submitPracticeQuestion("   ", actions)).toBe(false);
    for (const fn of Object.values(actions)) expect(fn).not.toHaveBeenCalled();
  });

  it("runs every step exactly once for an accepted question", () => {
    const actions = spies();
    expect(submitPracticeQuestion("Describe your ideal team.", actions)).toBe(true);
    for (const fn of Object.values(actions)) expect(fn).toHaveBeenCalledTimes(1);
  });

  it("runs the five steps in exactly this order", () => {
    // Asserted as the whole sequence, not as a set of pairwise
    // `indexOf(a) < indexOf(b)` comparisons. Those are degenerate: `indexOf`
    // returns -1 for a step that never ran, and -1 is less than everything,
    // so an implementation that DROPPED advanceAsked entirely — the exact
    // "silently loses a question from the asked list" failure this test is
    // named for — satisfied every one of them.
    //
    // What each position is doing:
    //  - advanceAsked first, because it reads whatever is currently on the
    //    card and pushes it onto the asked list. After the replacement it
    //    would bank the question just typed and lose the outgoing one, which
    //    the generator would then hand back later as if it had never been
    //    asked.
    //  - abandon before reset, the same order "Next question" already uses:
    //    a recording still running belongs to the question being left, and
    //    must be dropped before the state describing it is cleared.
    //  - addToFeed last, so the drill card is already showing the typed
    //    question by the time its feed entry starts drafting.
    const order = [];
    submitPracticeQuestion("Describe your ideal team.", {
      advanceAsked: () => order.push("advanceAsked"),
      abandonAnswer: () => order.push("abandonAnswer"),
      resetAnswer: () => order.push("resetAnswer"),
      setDrillQuestion: () => order.push("setDrillQuestion"),
      addToFeed: () => order.push("addToFeed"),
    });
    expect(order).toEqual([
      "advanceAsked",
      "abandonAnswer",
      "resetAnswer",
      "setDrillQuestion",
      "addToFeed",
    ]);
  });

  it("hands both halves the same normalized question", () => {
    const actions = spies();
    submitPracticeQuestion("  Describe your\n ideal   team. ", actions);
    expect(actions.setDrillQuestion.mock.calls[0][0]).toBe("Describe your ideal team.");
    expect(actions.addToFeed).toHaveBeenCalledWith("Describe your ideal team.");
  });

  it("classifies the drill question locally, since nothing else will", () => {
    // The feed entry gets its type from the drafted answer, but the card
    // renders a type chip the moment the question appears and no request
    // stands between the two. classifyQuestionType (lib/copilot/questionType.js)
    // is the zero-cost classifier the embedded engine already uses for this.
    const behavioral = spies();
    submitPracticeQuestion("Tell me about a time you handled conflict.", behavioral);
    expect(behavioral.setDrillQuestion.mock.calls[0][1]).toBe("behavioral");

    const technical = spies();
    submitPracticeQuestion("How would you design a system for this?", technical);
    expect(technical.setDrillQuestion.mock.calls[0][1]).toBe("technical");

    const general = spies();
    submitPracticeQuestion("Why this company?", general);
    expect(general.setDrillQuestion.mock.calls[0][1]).toBe("general");
  });
});
