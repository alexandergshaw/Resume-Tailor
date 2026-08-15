import { describe, it, expect } from "vitest";
import { hearingState, HEARD_NOTHING_AFTER_MS } from "./liveHearing.js";

// AC-S3: while a live session is running, the user must be able to tell — at
// a glance, with no extra click — whether the copilot is hearing anything.
//
// The bug this exists for: a live session went to "Live" and transcribed
// nothing, and the transcript was behind a collapsed disclosure, so the
// screen looked identical to a session that was working perfectly. The user
// reported it as "it doesn't recognize questions", because from the outside
// a deaf copilot and a copilot that hears but detects nothing are the same
// picture.
//
// This module is the pure decision behind an always-visible strip: what the
// session has heard most recently, and — critically — an explicit statement
// when it has heard nothing at all for long enough that something is wrong.

const T0 = 1_000_000;

function final(text, speaker = "them", at = T0 + 1_000) {
  return { id: 1, speaker, text, at };
}

describe("before a session is running (AC-S3.1)", () => {
  it("says nothing at all when not live", () => {
    const s = hearingState({ live: false, finals: [], interims: {}, startedAt: null, now: T0 });
    expect(s.status).toBe("off");
    expect(s.text).toBe("");
  });
});

describe("a session that has just started (AC-S3.2)", () => {
  it("waits quietly rather than crying wolf", () => {
    const s = hearingState({
      live: true,
      finals: [],
      interims: { them: "", you: "" },
      startedAt: T0,
      now: T0 + 2_000,
    });
    expect(s.status).toBe("waiting");
    expect(s.text).toMatch(/\S/);
  });

  it("counts an interim as hearing something, immediately", () => {
    // An interim is the earliest possible proof that audio is flowing. It is
    // exactly what distinguishes "connected but deaf" from "working".
    const s = hearingState({
      live: true,
      finals: [],
      interims: { them: "So tell me a", you: "" },
      startedAt: T0,
      now: T0 + 2_000,
    });
    expect(s.status).toBe("heard");
    expect(s.text).toContain("So tell me a");
  });
});

describe("a session that has heard nothing for too long (AC-S3.3)", () => {
  it("says so explicitly once the threshold passes", () => {
    const s = hearingState({
      live: true,
      finals: [],
      interims: { them: "", you: "" },
      startedAt: T0,
      now: T0 + HEARD_NOTHING_AFTER_MS + 1,
    });
    expect(s.status).toBe("silent");
    // The whole point is that this line tells the user something they can
    // act on, not that it merely exists.
    expect(s.text.length).toBeGreaterThan(20);
  });

  it("does not fire one millisecond early (boundary)", () => {
    const s = hearingState({
      live: true,
      finals: [],
      interims: { them: "", you: "" },
      startedAt: T0,
      now: T0 + HEARD_NOTHING_AFTER_MS - 1,
    });
    expect(s.status).toBe("waiting");
  });

  it("goes silent again after a long gap following real speech", () => {
    const s = hearingState({
      live: true,
      finals: [final("Tell me about yourself.", "them", T0 + 5_000)],
      interims: { them: "", you: "" },
      startedAt: T0,
      now: T0 + 5_000 + HEARD_NOTHING_AFTER_MS + 1,
    });
    expect(s.status).toBe("silent");
  });

  it("never goes silent while it is still hearing (positive control)", () => {
    const s = hearingState({
      live: true,
      finals: [final("Tell me about yourself.", "them", T0 + 5_000)],
      interims: { them: "and then", you: "" },
      startedAt: T0,
      now: T0 + 5_000 + HEARD_NOTHING_AFTER_MS + 1,
    });
    expect(s.status).toBe("heard");
  });
});

describe("a session still connecting (AC-S3.6)", () => {
  // `live` is true from the moment Start is pressed, but `startedAt` is only
  // set once status reaches "live" — so a session whose socket hangs at
  // "connecting" has live === true and startedAt === null. With no clock to
  // measure from, the silence threshold was unreachable and the strip
  // reassured the user with "listening" indefinitely. That is the exact
  // class of failure this module exists to eliminate, reappearing inside the
  // fix for it.
  it("still goes silent when the session never finished connecting", () => {
    const s = hearingState({
      live: true,
      finals: [],
      interims: { them: "", you: "" },
      startedAt: null,
      liveSince: T0,
      now: T0 + HEARD_NOTHING_AFTER_MS + 1,
    });
    expect(s.status).toBe("silent");
  });

  it("waits quietly before the threshold, measuring from when Start was pressed", () => {
    const s = hearingState({
      live: true,
      finals: [],
      interims: { them: "", you: "" },
      startedAt: null,
      liveSince: T0,
      now: T0 + 2_000,
    });
    expect(s.status).toBe("waiting");
  });

  it("prefers the session's own start time once it exists", () => {
    // startedAt lands later than liveSince (connecting takes a moment). The
    // silence clock must run from the LATER of the two, or a slow connect
    // would make the strip cry wolf the instant the session goes live.
    const s = hearingState({
      live: true,
      finals: [],
      interims: { them: "", you: "" },
      liveSince: T0,
      startedAt: T0 + HEARD_NOTHING_AFTER_MS,
      now: T0 + HEARD_NOTHING_AFTER_MS + 1_000,
    });
    expect(s.status).toBe("waiting");
  });

  it("does not go silent when there is no clock at all", () => {
    // Nothing to measure from is not evidence of silence.
    const s = hearingState({
      live: true,
      finals: [],
      interims: { them: "", you: "" },
      startedAt: null,
      now: T0 + HEARD_NOTHING_AFTER_MS + 1,
    });
    expect(s.status).toBe("waiting");
  });
});

describe("what the strip shows while it is working (AC-S3.4)", () => {
  it("shows the most recent turn, with who said it", () => {
    const s = hearingState({
      live: true,
      finals: [
        final("Thanks for joining.", "them", T0 + 2_000),
        final("Happy to be here.", "you", T0 + 4_000),
      ],
      interims: { them: "", you: "" },
      startedAt: T0,
      now: T0 + 5_000,
    });
    expect(s.status).toBe("heard");
    expect(s.text).toContain("Happy to be here.");
    expect(s.label).toMatch(/\S/);
    expect(s.text).not.toContain("Thanks for joining.");
  });

  it("prefers a live interim over the last completed turn", () => {
    const s = hearingState({
      live: true,
      finals: [final("Thanks for joining.", "them", T0 + 2_000)],
      interims: { them: "So my first question is", you: "" },
      startedAt: T0,
      now: T0 + 3_000,
    });
    expect(s.text).toContain("So my first question is");
  });

  it("resolves the speaker label through the identity snapshot", () => {
    const withTag = (tag) => ({
      id: 1,
      speaker: "them",
      text: "Tell me about yourself.",
      at: T0 + 2_000,
      speakerTag: tag,
    });
    const them = hearingState({
      live: true,
      finals: [withTag(0)],
      interims: {},
      startedAt: T0,
      now: T0 + 3_000,
      speakerSnapshot: { userTag: 1, confidence: "high", overridden: true, tags: [0, 1] },
    });
    const you = hearingState({
      live: true,
      finals: [withTag(1)],
      interims: {},
      startedAt: T0,
      now: T0 + 3_000,
      speakerSnapshot: { userTag: 1, confidence: "high", overridden: true, tags: [0, 1] },
    });
    expect(them.label).not.toBe(you.label);
    expect(/you/i.test(you.label)).toBe(true);
  });
});

describe("it never breaks the page (AC-S3.5)", () => {
  it("survives being called with nothing", () => {
    expect(() => hearingState()).not.toThrow();
    expect(() => hearingState({})).not.toThrow();
    expect(typeof hearingState().text).toBe("string");
    expect(typeof hearingState().status).toBe("string");
  });

  it("survives malformed turns", () => {
    expect(() =>
      hearingState({
        live: true,
        finals: [null, { text: null }, 7],
        interims: null,
        startedAt: T0,
        now: T0 + 1_000,
      }),
    ).not.toThrow();
  });

  it("truncates a very long turn rather than growing the strip", () => {
    const long = "word ".repeat(400).trim();
    const s = hearingState({
      live: true,
      finals: [final(long)],
      interims: {},
      startedAt: T0,
      now: T0 + 2_000,
    });
    expect(s.text.length).toBeLessThan(long.length);
    expect(s.text.length).toBeGreaterThan(40);
  });
});
