import { describe, it, expect } from "vitest";
import {
  latestQuestionEntry,
  pinnedQuestionEntry,
  newerQuestionCount,
} from "./currentQuestion.js";

// AC-T1.9..T1.12. `latestQuestionEntry` MOVES here from
// app/copilot/dashboard/CopilotDashboard.js; the first block below is the
// behaviour it must keep, restated from its own documented contract rather
// than copied from any existing test (there was none).

const q = (id, extra = {}) => ({ id, question: `Q${id}`, status: "done", ...extra });

describe("latestQuestionEntry — unchanged contract after the move (AC-T1.9)", () => {
  it("returns null for an empty, missing or non-array input", () => {
    expect(latestQuestionEntry([])).toBeNull();
    expect(latestQuestionEntry(null)).toBeNull();
    expect(latestQuestionEntry(undefined)).toBeNull();
    expect(latestQuestionEntry("nope")).toBeNull();
  });

  it("returns the last entry when nothing is provisional", () => {
    expect(latestQuestionEntry([q(1), q(2), q(3)]).id).toBe(3);
  });

  it("prefers the last NON-provisional entry over a later provisional one", () => {
    const list = [q(1), q(2), q(3, { provisional: true })];
    expect(latestQuestionEntry(list).id).toBe(2);
  });

  it("falls back to the true last entry when every entry is provisional", () => {
    const list = [q(1, { provisional: true }), q(2, { provisional: true })];
    expect(latestQuestionEntry(list).id).toBe(2);
  });

  it("survives null elements in the array", () => {
    expect(latestQuestionEntry([null, q(1), null]).id).toBe(1);
    expect(latestQuestionEntry([null, null])).toBeNull();
  });
});

describe("pinnedQuestionEntry (AC-T1.10)", () => {
  // F2: the first version of this block used [q(1), q(2), q(3)] — a list with
  // NO provisional entry, where latestQuestionEntry(list) and
  // list[list.length - 1] are the identical object. `toBe(latestQuestionEntry(
  // list))` therefore proved nothing about which decision was used, and a raw
  // `list[list.length - 1]` implementation passed the whole file. The
  // provisional tail is what makes the two sides distinguishable: a correct
  // implementation answers 2, a raw-last one answers 3. Without it, this is
  // the "fixture whose two sides normalize to the same thing" trap.
  const list = [q(1), q(2), q(3, { provisional: true })];

  it("degrades to latestQuestionEntry when nothing is pinned", () => {
    expect(pinnedQuestionEntry(list, null).id).toBe(2);
    expect(pinnedQuestionEntry(list, undefined).id).toBe(2);
    expect(pinnedQuestionEntry(list, null)).toBe(latestQuestionEntry(list));
  });

  it("holds the pinned entry even once newer questions have arrived", () => {
    expect(pinnedQuestionEntry(list, 1).id).toBe(1);
    expect(pinnedQuestionEntry(list, 2).id).toBe(2);
  });

  it("holds a pinned entry that is itself provisional", () => {
    expect(pinnedQuestionEntry(list, 3).id).toBe(3);
  });

  // A stale pin must never blank the panel the candidate is reading — and it
  // must fall back through the SAME decision, not to the raw last entry (F2
  // again: 2, not 3).
  it("falls back to latestQuestionEntry when the pinned id is gone", () => {
    expect(pinnedQuestionEntry(list, 99).id).toBe(2);
  });

  it("returns null when the list is empty, whatever the pin says", () => {
    expect(pinnedQuestionEntry([], 1)).toBeNull();
    expect(pinnedQuestionEntry(null, 1)).toBeNull();
  });

  it("survives null elements in the array (AC-T1.12)", () => {
    expect(pinnedQuestionEntry([null, q(1), null, q(2)], 1).id).toBe(1);
  });
});

describe("newerQuestionCount (AC-T1.11)", () => {
  const list = [q(1), q(2), q(3), q(4)];

  it("is 0 when nothing is pinned", () => {
    expect(newerQuestionCount(list, null)).toBe(0);
    expect(newerQuestionCount(list, undefined)).toBe(0);
  });

  it("counts the entries that arrived after the pinned one", () => {
    expect(newerQuestionCount(list, 1)).toBe(3);
    expect(newerQuestionCount(list, 3)).toBe(1);
  });

  it("is 0 when the pinned entry is the last one", () => {
    expect(newerQuestionCount(list, 4)).toBe(0);
  });

  it("is 0 when the pinned id is not in the list", () => {
    expect(newerQuestionCount(list, 99)).toBe(0);
  });

  it("is 0 for an empty, missing or non-array input (AC-T1.12)", () => {
    expect(newerQuestionCount([], 1)).toBe(0);
    expect(newerQuestionCount(null, 1)).toBe(0);
    expect(newerQuestionCount("nope", 1)).toBe(0);
  });

  // F4: this used to assert 2, which forced holes to COUNT as questions — so
  // [q1, null, null, q2] would render "3 newer questions detected" when one
  // actually arrived. Null elements are skipped, matching latestQuestionEntry's
  // own BUG-4 guard.
  it("skips null elements rather than counting them as questions (AC-T1.12)", () => {
    expect(newerQuestionCount([q(1), null, q(2)], 1)).toBe(1);
    expect(newerQuestionCount([q(1), null, null, q(2)], 1)).toBe(1);
    expect(newerQuestionCount([q(1), null, q(2), q(3)], 1)).toBe(2);
  });
});

// F13: the two assertions that used to live here — proving
// CopilotDashboard.js re-exports this function rather than keeping a private
// copy — moved to app/copilot/dashboard/CopilotDashboard.reexport.test.js.
// They imported an `app/` COMPONENT from a `lib/` test, inverting the exact
// layering AC-T1.9 gives as the reason for the move in the first place.
