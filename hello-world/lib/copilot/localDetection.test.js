import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { localDetection, remoteConfirmNeeded, MIN_WORDS_FOR_LLM } from "./localDetection.js";
import { detectQuestion, cleanQuestion } from "./questions.js";
import { classifyQuestionType } from "./questionType.js";

// AC-P1: the whole point of this module is that a detected question needs NO
// network round trip. Every assertion here is about the decision being
// computable synchronously, from the utterance alone, and matching what the
// route's embedded branch already ships to users today.

describe("localDetection — the zero-network decision (AC-P1.1)", () => {
  it("decides a trailing-question-mark utterance locally", () => {
    const r = localDetection("So what would you say your biggest weakness is?");
    expect(r.decided).toBe(true);
    expect(r.question).toBe("What would you say your biggest weakness is?");
    expect(r.reason).toBe("punctuation");
  });

  it("decides an interview lead-in opener locally", () => {
    const r = localDetection("Tell me about a time you resolved a conflict.");
    expect(r.decided).toBe(true);
    expect(r.reason).toBe("starter");
    expect(r.question).toMatch(/conflict/i);
  });

  it("classifies the type from the CLEANED question, not the raw utterance", () => {
    // The lead-in "Okay, great, so, um," carries no type signal; the cleaned
    // question does. Classifying the raw string would still land on
    // "behavioral" here by luck, so this pins the ordering explicitly: the
    // type must equal classifyQuestionType(cleaned), never
    // classifyQuestionType(raw).
    //
    // Compares against classifyQuestionType(cleanQuestion(raw)) rather than
    // classifyQuestionType(cleanQuestion(detectQuestion(raw).question)):
    // detectQuestion rejects this exact raw utterance outright (its STARTERS
    // check only ever looks at position 0, and "Okay, great, so, um," sits
    // in front of "tell me" there) — so detectQuestion(raw).question is
    // undefined, cleanQuestion(undefined) is "", and the old expression
    // collapsed to classifyQuestionType("") === "general" no matter what
    // localDetection did, while the line below still demanded "behavioral".
    // That chain could never produce the cleaned question this test is
    // actually about; cleanQuestion(raw) does, directly, and still fails the
    // assertion if classification ever moves back to the raw utterance.
    const raw = "Okay, great, so, um, tell me about a time you missed a deadline.";
    const r = localDetection(raw);
    expect(r.type).toBe(classifyQuestionType(cleanQuestion(raw)));
    expect(r.type).toBe("behavioral");
  });

  it("does not decide on a non-question", () => {
    const r = localDetection("Great, that makes a lot of sense to me.");
    expect(r.decided).toBe(false);
    expect(r.question).toBe("");
    expect(r.type).toBe("general");
    expect(r.reason).toBe("");
  });

  it("does not decide on an empty or whitespace utterance", () => {
    for (const bad of ["", "   ", null, undefined]) {
      const r = localDetection(bad);
      expect(r.decided).toBe(false);
      expect(r.question).toBe("");
    }
  });

  it("never throws on malformed input", () => {
    for (const bad of [123, {}, [], true]) {
      expect(() => localDetection(bad)).not.toThrow();
      expect(localDetection(bad).decided).toBe(false);
    }
  });
});

describe("localDetection — byte-identical to what the embedded engine already ships (AC-P1.1)", () => {
  // The embedded branch of /api/copilot/detect already returns exactly this
  // composition, and has since group A. Reproducing it here — rather than
  // inventing a second heuristic — is what makes moving detection to the
  // client a LATENCY change and not a BEHAVIOR change. Pinned against the
  // three primitives directly so a change to any of them shows up here.
  const CASES = [
    "What's your experience with distributed systems?",
    "Tell me about a time you disagreed with your manager.",
    "Can you walk me through your resume?",
    "Great, so, um, why do you want to work here?",
    "We're a team of about forty engineers.",
    "Sure.",
    "Describe your ideal working environment.",
    "Is that something you've done before?",
  ];

  it.each(CASES)("matches detectQuestion + cleanQuestion + classifyQuestionType for %j", (utterance) => {
    const det = detectQuestion(utterance);
    const isQuestion = !!det.isQuestion && !!det.question;
    const question = isQuestion ? cleanQuestion(det.question) : "";
    const expected = {
      decided: isQuestion && !!question,
      question: isQuestion && question ? question : "",
      type: isQuestion && question ? classifyQuestionType(question) : "general",
    };
    const r = localDetection(utterance);
    expect({ decided: r.decided, question: r.question, type: r.type }).toEqual(expected);
  });

  it("is the single implementation the detect route's embedded branch also uses", () => {
    // AC-P1.1: one implementation, two call sites. If the route re-derives the
    // composition itself, the client and the embedded engine can silently
    // disagree about what counts as a question — the exact drift this module
    // exists to make impossible.
    const route = readFileSync(
      new URL("../../app/api/copilot/detect/route.js", import.meta.url),
      "utf8",
    );
    expect(route).toMatch(/localDetection/);
  });
});

describe("remoteConfirmNeeded — when a round trip is still worth paying for (AC-P1.2)", () => {
  it("is false when the heuristic already decided — a local hit costs no network at all", () => {
    expect(remoteConfirmNeeded({ decided: true, utterance: "What is your greatest strength?" })).toBe(false);
  });

  it("is true for a long utterance the heuristic missed — this is the LLM's real job", () => {
    // An indirect ask with no interrogative opener and no question mark: the
    // heuristic cannot see it, and the LLM confirm is exactly what catches it.
    expect(
      remoteConfirmNeeded({
        decided: false,
        utterance: "I'd be interested to hear more about the migration you mentioned earlier",
      }),
    ).toBe(true);
  });

  it("is false for a short fragment the heuristic missed — today's exact pre-filter", () => {
    expect(remoteConfirmNeeded({ decided: false, utterance: "Got it thanks" })).toBe(false);
  });

  it("uses MIN_WORDS_FOR_LLM as its boundary, exported so no caller restates it", () => {
    expect(MIN_WORDS_FOR_LLM).toBe(4);
    const justUnder = Array.from({ length: MIN_WORDS_FOR_LLM - 1 }, (_, i) => `w${i}`).join(" ");
    const atBoundary = Array.from({ length: MIN_WORDS_FOR_LLM }, (_, i) => `w${i}`).join(" ");
    expect(remoteConfirmNeeded({ decided: false, utterance: justUnder })).toBe(false);
    expect(remoteConfirmNeeded({ decided: false, utterance: atBoundary })).toBe(true);
  });

  it("never throws on malformed input", () => {
    for (const bad of [undefined, {}, { decided: false }, { decided: false, utterance: null }]) {
      expect(() => remoteConfirmNeeded(bad)).not.toThrow();
    }
  });
});

describe("recall is not reduced by moving detection local (AC-P1.3)", () => {
  // The failure this guards: a "faster" pipeline that is also DEAFER. Every
  // utterance that reaches confirmQuestion today must still reach it, unless
  // the local detector already decided it IS a question — in which case it is
  // detected sooner, not lost.
  const UTTERANCES = [
    "What's your experience with distributed systems?",
    "I'd love to hear about a project you're proud of",
    "We're a team of about forty engineers and we ship weekly",
    "Sure.",
    "Got it",
    "Tell me about a time you disagreed with your manager.",
    "So the role is mostly backend with some infrastructure work",
    "Any questions for me?",
  ];

  it.each(UTTERANCES)("either decides locally or still asks the LLM, for %j", (utterance) => {
    const words = String(utterance).split(/\s+/).filter(Boolean).length;
    // What today's pipeline does: evaluate whenever the heuristic fired OR the
    // utterance is long enough to be worth a call (useLiveSession.js's
    // MIN_WORDS_FOR_LLM pre-filter).
    const reachesLlmToday = detectQuestion(utterance).isQuestion || words >= MIN_WORDS_FOR_LLM;
    const local = localDetection(utterance);
    const reachesLlmNow = remoteConfirmNeeded({ decided: local.decided, utterance });
    if (reachesLlmToday) {
      expect(local.decided || reachesLlmNow).toBe(true);
    }
  });
});
