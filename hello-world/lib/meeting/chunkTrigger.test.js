// When a meeting copilot should spend a model call.
//
// This is a pure decision on purpose. The alternative — a few `>=` comparisons
// buried in a React hook — is the shape this repo has repeatedly extracted
// out: lib/copilot/liveHearing.js's `hearingState({ live, finals, interims,
// startedAt, liveSince, now })` is the same thing for the same reason, and
// vitest.config.js states the standing rule outright ("Extracting the DECISION
// into lib/ remains the first choice, not the fallback").
//
// `now` is an argument, never read from the clock inside. Every threshold is
// exported so no caller can hold a second, drifting copy.

import { describe, it, expect } from "vitest";
import {
  insightTrigger,
  MIN_NEW_WORDS,
  SETTLE_MS,
  MIN_INTERVAL_MS,
} from "./chunkTrigger.js";

// A meeting that has been running a while, with a chunk of new speech that
// has just come to a natural pause. Each test moves ONE thing away from this.
const READY = {
  now: 100_000,
  newWords: MIN_NEW_WORDS,
  lastFinalAt: 100_000 - SETTLE_MS,
  lastReadAt: 100_000 - MIN_INTERVAL_MS,
  inFlight: false,
  nudge: false,
};

const at = (over = {}) => insightTrigger({ ...READY, ...over });

describe("the automatic trigger", () => {
  it("fires once a real chunk of speech has landed and the room has paused", () => {
    const result = at();
    expect(result.fire).toBe(true);
    expect(result.reason).toBe("chunk");
  });

  it("does not fire on a handful of words", () => {
    // A word count, not a turn count: one long turn is a chunk, three "yeah"s
    // are not. Three short turns would satisfy any turn-based rule.
    const result = at({ newWords: MIN_NEW_WORDS - 1 });
    expect(result.fire).toBe(false);
    expect(result.why).toBe("no-new-speech");
  });

  it("does not fire while people are still talking", () => {
    // THE DEBOUNCE, and the reason a burst costs one call rather than ten:
    // every new final resets this clock, so nothing fires until the room
    // actually pauses.
    const result = at({ lastFinalAt: READY.now - (SETTLE_MS - 1) });
    expect(result.fire).toBe(false);
    expect(result.why).toBe("quiet");
  });

  it("does not fire again immediately after the last read", () => {
    // The floor. Without it, a long monologue with natural breath-pauses
    // would fire every few seconds.
    const result = at({ lastReadAt: READY.now - (MIN_INTERVAL_MS - 1) });
    expect(result.fire).toBe(false);
    expect(result.why).toBe("too-soon");
  });

  it("does not fire while a read is already running", () => {
    const result = at({ inFlight: true });
    expect(result.fire).toBe(false);
    expect(result.why).toBe("in-flight");
  });

  it("costs nothing at all during a silence", () => {
    // Falls out of the word count rather than needing its own rule: with no
    // new speech the condition can never pass, however long the meeting sits
    // idle, so no timer has to do anything.
    for (const minutes of [1, 5, 30]) {
      const result = at({ newWords: 0, now: READY.now + minutes * 60_000 });
      expect(result.fire).toBe(false);
      expect(result.why).toBe("no-new-speech");
    }
  });
});

describe("the nudge", () => {
  it("fires even when nothing else would", () => {
    // The user pressed a button. It is their explicit ask, and it overrides
    // every heuristic - the same reasoning the interview copilot's manual
    // question path uses to skip its own detection gate.
    const result = at({ nudge: true, newWords: 0, lastFinalAt: READY.now, lastReadAt: READY.now });
    expect(result.fire).toBe(true);
    expect(result.reason).toBe("nudge");
  });

  it("still refuses to stack on top of a read already in flight", () => {
    // The one thing a nudge does not override. Two concurrent reads would
    // race to write the same list, and the generation counter would discard
    // one of them anyway - so this spends nothing to achieve nothing.
    const result = at({ nudge: true, inFlight: true });
    expect(result.fire).toBe(false);
    expect(result.why).toBe("in-flight");
  });
});

describe("the shape of the answer", () => {
  it("says WHY it declined, not just that it did", () => {
    // `why` exists so a test can assert which condition blocked - a bare
    // boolean makes every one of the tests above pass for the wrong reason -
    // and so the UI can honestly say "waiting for a pause in the
    // conversation" instead of looking broken.
    expect(at().why).toBe("");
    expect(at({ inFlight: true }).why).toBeTruthy();
  });

  it("reports no reason when it is not firing", () => {
    expect(at({ inFlight: true }).reason).toBeNull();
  });

  it("takes `now` as an argument and never reads the clock itself", () => {
    // Called twice with identical input, including `now`, it must answer
    // identically. A function that consulted Date.now() would drift between
    // these two calls and could not be tested at all.
    const input = { ...READY };
    expect(insightTrigger(input)).toEqual(insightTrigger(input));
  });

  it("treats missing bookkeeping as the start of a meeting, not as an error", () => {
    // The very first evaluation has no lastReadAt and no lastFinalAt. It must
    // not throw, and it must not fire on zero words either.
    const first = insightTrigger({ now: 1000, newWords: 0 });
    expect(first.fire).toBe(false);
    expect(() => insightTrigger({})).not.toThrow();
  });

  it("exposes thresholds that are actually distinct", () => {
    // Guards against the fixture above being degenerate: if SETTLE_MS and
    // MIN_INTERVAL_MS were equal, two of the tests above would be testing the
    // same boundary without saying so.
    expect(MIN_INTERVAL_MS).toBeGreaterThan(SETTLE_MS);
    expect(MIN_NEW_WORDS).toBeGreaterThan(0);
  });
});
