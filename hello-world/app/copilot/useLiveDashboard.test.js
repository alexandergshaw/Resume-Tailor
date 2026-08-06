import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  predictionSignatureFor,
  resolvePrediction,
  resolvePredraft,
  resolveDashboardState,
} from "./useLiveDashboard.js";

// The source file itself, read as raw bytes -- not imported, so this check
// runs regardless of how the module above happens to be transformed by the
// test runner. See the "source file has no literal NUL byte" block below.
const SOURCE_PATH = fileURLToPath(new URL("./useLiveDashboard.js", import.meta.url));

// The real delimiter predictionSignatureFor puts between the asked-question
// text and the posting key: the NUL code point (0), built here via
// String.fromCharCode rather than typed as an escape sequence, so this test
// file's own expected-value strings never have to embed that notation as
// literal text.
const NUL = String.fromCharCode(0);

describe("predictionSignatureFor", () => {
  it("returns an empty string when there are no questions and no posting", () => {
    expect(predictionSignatureFor([], null)).toBe("");
    expect(predictionSignatureFor(undefined, null)).toBe("");
    expect(predictionSignatureFor([], undefined)).toBe("");
  });

  it("builds a signature from questions alone, with an empty posting key after the delimiter", () => {
    const questions = [{ question: "Tell me about yourself" }, { question: "Why this role?" }];
    const signature = predictionSignatureFor(questions, null);
    expect(signature).toBe("Tell me about yourself\nWhy this role?" + NUL);
  });

  it("builds a signature from a posting alone, with an empty asked-questions segment before the delimiter", () => {
    const posting = { title: "Backend Engineer", company: "Acme", description: "Build things" };
    const signature = predictionSignatureFor([], posting);
    expect(signature).toBe(NUL + "Backend Engineer|Acme|Build things");
  });

  it("treats a posting with an individually missing title as an empty field, not a thrown error", () => {
    const posting = { company: "Acme", description: "Build things" };
    const signature = predictionSignatureFor([], posting);
    expect(signature).toBe(NUL + "|Acme|Build things");
  });

  it("treats a posting with an individually missing company as an empty field", () => {
    const posting = { title: "Backend Engineer", description: "Build things" };
    const signature = predictionSignatureFor([], posting);
    expect(signature).toBe(NUL + "Backend Engineer||Build things");
  });

  it("treats a posting with an individually missing description as an empty field", () => {
    const posting = { title: "Backend Engineer", company: "Acme" };
    const signature = predictionSignatureFor([], posting);
    expect(signature).toBe(NUL + "Backend Engineer|Acme|");
  });

  it("carries newline characters embedded in a single question's text through untouched", () => {
    const questions = [{ question: "Describe a time you\nhandled conflict." }];
    const signature = predictionSignatureFor(questions, null);
    expect(signature).toBe("Describe a time you\nhandled conflict." + NUL);
  });

  it("is deterministic: the same inputs always produce the same signature", () => {
    const questions = [{ question: "Tell me about yourself" }, { question: "Why this role?" }];
    const posting = { title: "Backend Engineer", company: "Acme", description: "Build things" };
    const first = predictionSignatureFor(questions, posting);
    const second = predictionSignatureFor(questions, posting);
    const third = predictionSignatureFor(
      [{ question: "Tell me about yourself" }, { question: "Why this role?" }],
      { title: "Backend Engineer", company: "Acme", description: "Build things" }
    );
    expect(first).toBe(second);
    expect(first).toBe(third);
  });

  describe("the NUL delimiter prevents a collision a naive '|' delimiter would produce", () => {
    // The naive re-implementation below must NOT be imported from the
    // source file -- it is a hand-rolled stand-in for what
    // predictionSignatureFor would do if someone "simplified" the
    // delimiter to a printable character such as "|".
    function naiveSignatureFor(questions, posting) {
      const asked = (Array.isArray(questions) ? questions : [])
        .map((q) => (q && typeof q.question === "string" ? q.question.trim() : ""))
        .filter(Boolean);
      if (asked.length === 0 && !posting) return "";
      const postingKey = posting
        ? `${posting.title || ""}|${posting.company || ""}|${posting.description || ""}`
        : "";
      return `${asked.join("\n")}|${postingKey}`;
    }

    // Input A: one asked question whose OWN text contains a literal pipe,
    // paired with a posting whose fields are clean.
    const questionsA = [{ question: "What is your experience|with Docker?" }];
    const postingA = { title: "Senior Engineer", company: "Acme", description: "Remote role" };

    // Input B: a genuinely different (questions, posting) pair -- the asked
    // list has different text, and the posting has different fields -- built
    // by moving the characters that were inside A's question text
    // ("with Docker?") into B's posting title, and moving A's posting title
    // ("Senior Engineer") into B's posting company, with the remainder
    // landing in B's description.
    const questionsB = [{ question: "What is your experience" }];
    const postingB = { title: "with Docker?", company: "Senior Engineer", description: "Acme|Remote role" };

    it("sanity check: these two inputs really are different (questions, posting) pairs", () => {
      expect(questionsA).not.toEqual(questionsB);
      expect(postingA).not.toEqual(postingB);
    });

    it("would collide into the identical string under a naive '|' delimiter", () => {
      const naiveA = naiveSignatureFor(questionsA, postingA);
      const naiveB = naiveSignatureFor(questionsB, postingB);
      expect(naiveA).toBe("What is your experience|with Docker?|Senior Engineer|Acme|Remote role");
      expect(naiveB).toBe("What is your experience|with Docker?|Senior Engineer|Acme|Remote role");
      expect(naiveA).toBe(naiveB);
    });

    it("produces genuinely different signatures for the same two inputs with the real NUL delimiter", () => {
      const realA = predictionSignatureFor(questionsA, postingA);
      const realB = predictionSignatureFor(questionsB, postingB);
      expect(realA).toBe("What is your experience|with Docker?" + NUL + "Senior Engineer|Acme|Remote role");
      expect(realB).toBe("What is your experience" + NUL + "with Docker?|Senior Engineer|Acme|Remote role");
      expect(realA).not.toBe(realB);
    });
  });

  describe("source file has no literal NUL byte", () => {
    // The delimiter above must be built at RUNTIME (the escape sequence in
    // the source text -- six printable characters: backslash, u, four
    // zeros), never sit in the file as an actual NUL byte (code point 0). A
    // literal NUL makes git treat the file as binary, which makes every
    // future diff of it unreviewable. This reads the file's raw bytes
    // directly, so it catches the regression regardless of what any editor
    // or transform does to the in-memory module.
    it("contains no literal NUL byte", () => {
      const raw = readFileSync(SOURCE_PATH);
      expect(raw.indexOf(0)).toBe(-1);
    });
  });
});

describe("resolveDashboardState", () => {
  const IDLE_PREDICTION_STATE = { status: "idle", question: "", type: "general", error: "" };
  const IDLE_PREDRAFT_STATE = { status: "idle", points: [], type: "general", error: "" };

  it("forces the idle state when active is false, even though the stored result holds a completed prediction", () => {
    const result = {
      forSignature: "sig-1",
      outcome: "done",
      question: "What is your greatest strength?",
      type: "behavioral",
      error: "",
    };
    const state = resolveDashboardState(result, "sig-1", false, resolvePrediction, IDLE_PREDICTION_STATE);
    expect(state).toEqual(IDLE_PREDICTION_STATE);
  });

  it("forces the idle state when active is false even though the stored result also holds a completed pre-draft", () => {
    const result = {
      forQuestion: "What is your greatest strength?",
      outcome: "done",
      points: ["Point A", "Point B"],
      type: "behavioral",
      error: "",
    };
    const state = resolveDashboardState(
      result,
      "What is your greatest strength?",
      false,
      resolvePredraft,
      IDLE_PREDRAFT_STATE
    );
    expect(state).toEqual(IDLE_PREDRAFT_STATE);
  });

  it("does not surface a stored result whose signature does not match the current one, even while active", () => {
    // The stored result is a COMPLETED prediction, but for a different
    // (older) signature than the one currently being asked about.
    const result = {
      forSignature: "sig-old",
      outcome: "done",
      question: "Stale predicted question",
      type: "general",
      error: "",
    };
    const state = resolveDashboardState(result, "sig-new", true, resolvePrediction, IDLE_PREDICTION_STATE);
    expect(state).toEqual({ status: "loading", question: "", type: "general", error: "" });
  });

  it("surfaces the stored status, question, and type when the signature matches and active is true", () => {
    const result = {
      forSignature: "sig-1",
      outcome: "done",
      question: "Tell me about yourself",
      type: "behavioral",
      error: "",
    };
    const state = resolveDashboardState(result, "sig-1", true, resolvePrediction, IDLE_PREDICTION_STATE);
    expect(state).toEqual({ status: "done", question: "Tell me about yourself", type: "behavioral", error: "" });
  });

  it("surfaces the stored error when the signature matches, active is true, and the outcome was an error", () => {
    const result = {
      forSignature: "sig-1",
      outcome: "error",
      question: "",
      type: "general",
      error: "Could not predict the next question.",
    };
    const state = resolveDashboardState(result, "sig-1", true, resolvePrediction, IDLE_PREDICTION_STATE);
    expect(state).toEqual({
      status: "error",
      question: "",
      type: "general",
      error: "Could not predict the next question.",
    });
  });
});
