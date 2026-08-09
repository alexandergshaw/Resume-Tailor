import { describe, expect, it } from "vitest";
import { createUtteranceAssembly } from "./utteranceAssembly";

// Written from AC-M1.6 BEFORE the module existed.
//
// Why this is a pure lib/ module rather than logic inside the live-session hook:
// vitest.config.js sets `environment: "node"` and this repo has no jsdom and no
// React testing library, so anything living in a component or a hook cannot be
// exercised by a test at all. Per-tag utterance assembly is the most fragile new
// logic in this feature, so it lives here where it can actually be pinned.
//
// The rule this file exists to protect, and how it was nearly shipped broken:
// an earlier draft said `speechFinal` rides on the LAST run of a Deepgram frame,
// AND that each speaker drains on "its own speechFinal". Those two deadlock.
// With endpointing=300 a frame that carries speech_final routinely also carries
// the NEXT speaker's opening words, so the first speaker's run is not last, never
// receives speechFinal, and its buffer never drains - the interviewer's question
// is silently lost and its text is later glued onto an utterance from minutes
// afterwards. Hence: a speaker also drains when a DIFFERENT speaker starts, and
// everything drains on stop.

describe("utteranceAssembly buffering", () => {
  it("accumulates consecutive segments from one speaker into a single utterance", () => {
    const asm = createUtteranceAssembly();
    asm.push(0, "So tell me");
    asm.push(0, "about a project");
    asm.push(0, "you are proud of");

    expect(asm.pending(0)).toBe("So tell me about a project you are proud of");
  });

  it("does not complete an utterance while the same speaker keeps talking", () => {
    const asm = createUtteranceAssembly();

    expect(asm.push(0, "So tell me")).toBeNull();
    expect(asm.push(0, "about yourself")).toBeNull();
  });

  it("collapses whitespace and trims when joining segments", () => {
    const asm = createUtteranceAssembly();
    asm.push(0, "  So   tell  ");
    asm.push(0, " me about it ");

    expect(asm.pending(0)).toBe("So tell me about it");
  });

  it("ignores a blank segment instead of buffering an empty turn", () => {
    const asm = createUtteranceAssembly();
    asm.push(0, "   ");

    expect(asm.pending(0)).toBe("");
    expect(asm.drain(0)).toBeNull();
  });

  it("reports nothing pending for a speaker it has never heard", () => {
    const asm = createUtteranceAssembly();

    expect(asm.pending(4)).toBe("");
  });
});

describe("utteranceAssembly draining", () => {
  it("completes the previous speaker's utterance when a different speaker starts", () => {
    // This is the rule that breaks the deadlock. Without it, a speaker whose run
    // is not last in its frame never drains at all.
    const asm = createUtteranceAssembly();
    asm.push(0, "So tell me about yourself");
    const completed = asm.push(1, "Sure, absolutely");

    expect(completed).toEqual({ tag: 0, text: "So tell me about yourself" });
  });

  it("clears the previous speaker's buffer once the speaker change completes it", () => {
    const asm = createUtteranceAssembly();
    asm.push(0, "So tell me about yourself");
    asm.push(1, "Sure");

    expect(asm.pending(0)).toBe("");
  });

  it("does not complete anything when the first speaker of the session starts", () => {
    const asm = createUtteranceAssembly();

    expect(asm.push(0, "So tell me about yourself")).toBeNull();
  });

  it("drain returns the speaker's utterance and empties the buffer", () => {
    const asm = createUtteranceAssembly();
    asm.push(1, "I led the billing migration");

    expect(asm.drain(1)).toEqual({ tag: 1, text: "I led the billing migration" });
    expect(asm.pending(1)).toBe("");
  });

  it("drain returns null for a speaker with nothing buffered", () => {
    const asm = createUtteranceAssembly();

    expect(asm.drain(0)).toBeNull();
  });

  it("draining the same speaker twice does not re-deliver the utterance", () => {
    const asm = createUtteranceAssembly();
    asm.push(0, "How did the team react?");
    asm.drain(0);

    expect(asm.drain(0)).toBeNull();
  });

  it("BOTH speakers' utterances survive a frame that mixes them and ends in speech_final", () => {
    // The exact shape that deadlocked the earlier design: the interviewer's
    // question and the candidate's first words arrive in one frame, and only the
    // candidate's run carries speech_final. The question must NOT be stranded.
    const asm = createUtteranceAssembly();
    const completedByChange = asm.push(0, "So what drew you to this role?");
    const completedByChange2 = asm.push(1, "Honestly the platform work");
    const completedByFinal = asm.drain(1);

    expect(completedByChange).toBeNull();
    expect(completedByChange2).toEqual({ tag: 0, text: "So what drew you to this role?" });
    expect(completedByFinal).toEqual({ tag: 1, text: "Honestly the platform work" });
  });

  it("a speaker who stops talking is completed by the next speaker, not stranded forever", () => {
    const asm = createUtteranceAssembly();
    asm.push(2, "And from my side, what does success look like at six months?");
    // Speaker 2 never speaks again and never gets its own speech_final.
    const completed = asm.push(1, "Great question");

    expect(completed).toEqual({
      tag: 2,
      text: "And from my side, what does success look like at six months?",
    });
  });
});

describe("utteranceAssembly drainAll", () => {
  it("returns every speaker still holding buffered text", () => {
    const asm = createUtteranceAssembly();
    asm.push(0, "Thanks for your time");
    asm.push(1, "Likewise, this was great");

    // Pushing tag 1 completed tag 0, so only tag 1 should remain.
    expect(asm.drainAll()).toEqual([{ tag: 1, text: "Likewise, this was great" }]);
  });

  it("empties every buffer so nothing leaks past the end of a session", () => {
    const asm = createUtteranceAssembly();
    asm.push(0, "One last thing");
    asm.drainAll();

    expect(asm.pending(0)).toBe("");
    expect(asm.drainAll()).toEqual([]);
  });

  it("returns an empty list when nothing is buffered", () => {
    const asm = createUtteranceAssembly();

    expect(asm.drainAll()).toEqual([]);
  });
});
