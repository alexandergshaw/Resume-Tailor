import { describe, it, expect } from "vitest";
import { resolvePin, PIN_SUPERSEDED_MAX_MS } from "./questionPin.js";

// AC-T1.16..T1.16.3. The bounded hold, as a pure reducer over (pin state,
// questions, now) so it needs no timers and no rendering to test.
//
// Why it is bounded at all. The pin vocabulary is made of reflexive stalling
// tics said at the start of most answers ("good question", "let me think");
// the release vocabulary is a deliberate hand-back many candidates never say.
// Capture rate exceeds release rate, so an unbounded hold's steady state is a
// dashboard stuck on question 1 while the candidate answers question 3.
//
// Why the clock starts at the SUPERSEDE and not at the pin. A hold with
// nothing behind it is hiding nothing, so expiring it could only yank the
// panel out from under a long answer. The hold only becomes a liability once
// a newer question exists that the candidate cannot see.
//
// The 120s bound is not arbitrary: IEC 60601-1-8 time-bounds an audio-paused
// alarm at 120s without operator intervention for critical-care ventilators,
// on exactly this reasoning — a human may suspend monitoring, but not
// indefinitely and not without a visible marker.

const q = (id, extra = {}) => ({ id, question: `Q${id}`, status: "done", ...extra });
const T0 = 1_000_000;

describe("PIN_SUPERSEDED_MAX_MS", () => {
  it("is two minutes", () => {
    expect(PIN_SUPERSEDED_MAX_MS).toBe(120000);
  });
});

describe("resolvePin — nothing held (AC-T1.10)", () => {
  const questions = [q(1), q(2), q(3, { provisional: true })];

  it("shows the current question and reports no hold", () => {
    const out = resolvePin({ pinnedId: null, supersededAt: null, questions, now: T0 });
    expect(out.held).toBe(false);
    expect(out.pinnedId).toBeNull();
    // Degrades through latestQuestionEntry, so the provisional tail is skipped.
    expect(out.entry.id).toBe(2);
    expect(out.newerCount).toBe(0);
    expect(out.expired).toBe(false);
    expect(out.supersededAt).toBeNull();
  });

  it("reports no hold for an empty feed", () => {
    const out = resolvePin({ pinnedId: null, supersededAt: null, questions: [], now: T0 });
    expect(out.held).toBe(false);
    expect(out.entry).toBeNull();
    expect(out.newerCount).toBe(0);
  });
});

describe("resolvePin — held with nothing behind it (AC-T1.16.3)", () => {
  const questions = [q(1), q(2)];

  it("holds the pinned entry", () => {
    const out = resolvePin({ pinnedId: 2, supersededAt: null, questions, now: T0 });
    expect(out.held).toBe(true);
    expect(out.entry.id).toBe(2);
    expect(out.newerCount).toBe(0);
  });

  it("never starts the expiry clock", () => {
    const out = resolvePin({ pinnedId: 2, supersededAt: null, questions, now: T0 });
    expect(out.supersededAt).toBeNull();
  });

  it("NEVER expires, however long it is held", () => {
    // A day later, still nothing behind it, still held. Expiring here would
    // yank the panel out from under a long answer for no benefit at all.
    const out = resolvePin({
      pinnedId: 2,
      supersededAt: null,
      questions,
      now: T0 + 24 * 60 * 60 * 1000,
    });
    expect(out.held).toBe(true);
    expect(out.expired).toBe(false);
    expect(out.entry.id).toBe(2);
  });
});

describe("resolvePin — held with newer questions behind it (AC-T1.16.2)", () => {
  const questions = [q(1), q(2), q(3)];

  it("starts the expiry clock at the FIRST supersede", () => {
    const out = resolvePin({ pinnedId: 1, supersededAt: null, questions, now: T0 });
    expect(out.held).toBe(true);
    expect(out.newerCount).toBe(2);
    expect(out.supersededAt).toBe(T0);
    expect(out.expired).toBe(false);
  });

  it("does not restart the clock when a further question arrives", () => {
    // The clock is anchored to when the candidate first had something hidden
    // from them, not to the most recent arrival — otherwise a talkative
    // interviewer keeps the hold alive indefinitely.
    const later = resolvePin({
      pinnedId: 1,
      supersededAt: T0,
      questions: [...questions, q(4)],
      now: T0 + 60_000,
    });
    expect(later.supersededAt).toBe(T0);
    expect(later.newerCount).toBe(3);
    expect(later.expired).toBe(false);
  });

  it("still holds one millisecond before the bound", () => {
    const out = resolvePin({
      pinnedId: 1,
      supersededAt: T0,
      questions,
      now: T0 + PIN_SUPERSEDED_MAX_MS - 1,
    });
    expect(out.held).toBe(true);
    expect(out.expired).toBe(false);
    expect(out.entry.id).toBe(1);
  });

  it("releases exactly at the bound", () => {
    const out = resolvePin({
      pinnedId: 1,
      supersededAt: T0,
      questions,
      now: T0 + PIN_SUPERSEDED_MAX_MS,
    });
    expect(out.expired).toBe(true);
    expect(out.held).toBe(false);
    expect(out.pinnedId).toBeNull();
    expect(out.supersededAt).toBeNull();
    // ...and lands on the current question, not on nothing.
    expect(out.entry.id).toBe(3);
    expect(out.newerCount).toBe(0);
  });

  it("stays released after the bound", () => {
    const out = resolvePin({
      pinnedId: 1,
      supersededAt: T0,
      questions,
      now: T0 + PIN_SUPERSEDED_MAX_MS * 10,
    });
    expect(out.expired).toBe(true);
    expect(out.held).toBe(false);
  });
});

describe("resolvePin — the clock resets when the hold is no longer superseded", () => {
  it("clears supersededAt if the newer questions go away", () => {
    // Reachable via Clear, or a redraft that rebuilds the list. A stale
    // supersededAt left behind would expire a hold that has nothing behind it,
    // contradicting AC-T1.16.3.
    const out = resolvePin({ pinnedId: 1, supersededAt: T0, questions: [q(1)], now: T0 + 60_000 });
    expect(out.newerCount).toBe(0);
    expect(out.supersededAt).toBeNull();
    expect(out.expired).toBe(false);
    expect(out.held).toBe(true);
  });
});

describe("resolvePin — a stale pin never blanks the panel (AC-T1.10)", () => {
  const questions = [q(1), q(2), q(3, { provisional: true })];

  it("falls back through latestQuestionEntry when the pinned id is gone", () => {
    const out = resolvePin({ pinnedId: 99, supersededAt: null, questions, now: T0 });
    // 2, not 3: the fallback goes through the SAME decision, so the
    // provisional tail is still skipped.
    expect(out.entry.id).toBe(2);
    expect(out.newerCount).toBe(0);
  });
});

describe("resolvePin — defensive inputs (AC-T1.12)", () => {
  it("survives a missing, null or non-array questions list", () => {
    for (const questions of [undefined, null, "nope", {}]) {
      const out = resolvePin({ pinnedId: 1, supersededAt: T0, questions, now: T0 });
      expect(out.entry).toBeNull();
      expect(out.newerCount).toBe(0);
      expect(out.held).toBe(false);
    }
  });

  it("survives null elements in the list", () => {
    const out = resolvePin({
      pinnedId: 1,
      supersededAt: null,
      questions: [null, q(1), null, q(2)],
      now: T0,
    });
    expect(out.entry.id).toBe(1);
    // Holes are not questions — a badge reading "3 newer questions" when one
    // arrived is worse than no badge.
    expect(out.newerCount).toBe(1);
  });

  it("survives being called with no argument at all", () => {
    const out = resolvePin();
    expect(out.held).toBe(false);
    expect(out.entry).toBeNull();
    expect(out.expired).toBe(false);
  });

  it("treats a missing `now` as no expiry rather than as time zero", () => {
    // `now: undefined` arithmetic yields NaN, and NaN >= bound is false, which
    // happens to be the safe answer — but it must be the DELIBERATE answer.
    const out = resolvePin({ pinnedId: 1, supersededAt: T0, questions: [q(1), q(2)] });
    expect(out.expired).toBe(false);
    expect(out.held).toBe(true);
  });
});

describe("resolvePin is pure (AC-T1.16)", () => {
  it("reaches for no clock of its own", async () => {
    const { readFileSync } = await import("node:fs");
    const src = readFileSync(new URL("./questionPin.js", import.meta.url), "utf8");
    expect(src).not.toMatch(/Date\.now|new Date\(|setTimeout|setInterval|Math\.random/);
  });

  it("does not mutate the questions array it is given", () => {
    const questions = [q(1), q(2)];
    const snapshot = JSON.stringify(questions);
    resolvePin({ pinnedId: 1, supersededAt: T0, questions, now: T0 + 5000 });
    expect(JSON.stringify(questions)).toBe(snapshot);
  });

  it("gives the same answer for the same input every time", () => {
    const args = { pinnedId: 1, supersededAt: T0, questions: [q(1), q(2)], now: T0 + 5000 };
    expect(resolvePin(args)).toEqual(resolvePin(args));
  });
});
