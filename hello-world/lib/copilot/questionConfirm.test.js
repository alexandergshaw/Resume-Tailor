import { describe, it, expect } from "vitest";
import {
  resolveConfirmedView,
  nextConfirmTarget,
  confirmQuestionId,
  unconfirmQuestionId,
} from "./questionConfirm.js";

// AC-N18.1..N18.5. The confirm gate: a newly detected question must not take
// the panel until the candidate explicitly confirms it, and confirmed
// questions are never evicted — they collapse into a re-openable list.
//
// Unlike ./questionPin.js, this module owns no clock at all (AC-N18.2): the
// only thing that ever changes `current` once something is confirmed is a
// confirm. There is no `now`, no deadline, nothing to expire.

const q = (id, extra = {}) => ({ id, question: `Q${id}`, status: "done", ...extra });

describe("resolveConfirmedView — the seed rule (AC-N18.1)", () => {
  // m6 (adversarial delta review): this title used to say "tracks
  // latestQuestionEntry" — the pre-F2 behaviour this module's own header
  // documents having replaced with "oldest unconfirmed entry" — and a
  // single-entry fixture cannot tell the two apart anyway (latest and
  // oldest are the same entry when there is only one). The next test below
  // is what actually distinguishes them; this one's real point, per its own
  // comment, is the provisional cold-start case.
  it("seeds on the sole entry even when it is provisional — arriving is not gated, only advancing is", () => {
    // Cold start: the interviewer's genuine opening question is the ONLY
    // entry and is (wrongly) flagged provisional by the word-count argmax.
    // The gate must not blank the panel over this — it governs advancing,
    // not arriving.
    const questions = [q(1, { provisional: true })];
    const out = resolveConfirmedView({ questions, confirmedIds: [] });
    expect(out.current.id).toBe(1);
    expect(out.currentIsSeed).toBe(true);
    expect(out.history).toEqual([]);
    expect(out.waiting).toEqual([]);
  });

  it("keeps current pinned to the OLDEST entry as more arrive, right up to the first confirm (F2)", () => {
    // Before the F2 fix, `current` tracked the LATEST entry here (2, not 1),
    // and `waiting` stayed unconditionally empty — so a second question
    // detected before any confirm silently became "current" with no click
    // and no way to reach the first one at all.
    const questions = [q(1), q(2)];
    const out = resolveConfirmedView({ questions, confirmedIds: [] });
    expect(out.current.id).toBe(1);
    expect(out.currentIsSeed).toBe(true);
    expect(out.waiting.map((e) => e.id)).toEqual([2]);
  });

  it("no-op control: one entry, nothing confirmed, is current with empty waiting/history", () => {
    const out = resolveConfirmedView({ questions: [q(1)], confirmedIds: [] });
    expect(out.current.id).toBe(1);
    expect(out.currentIsSeed).toBe(true);
    expect(out.waiting).toEqual([]);
    expect(out.history).toEqual([]);
  });
});

describe("resolveConfirmedView — no clock (AC-N18.2)", () => {
  it("does not move current to a newly detected entry once anything is confirmed", () => {
    const before = [q(1), q(2)];
    const confirmedIds = confirmQuestionId([], 2);
    const first = resolveConfirmedView({ questions: before, confirmedIds });
    expect(first.current.id).toBe(2);
    expect(first.currentIsSeed).toBe(false);

    // A brand new question arrives. Nothing about elapsed time or count
    // changes `current` — only an explicit confirm can.
    const after = [...before, q(3)];
    const second = resolveConfirmedView({ questions: after, confirmedIds });
    expect(second.current.id).toBe(2);
    // Used to assert `[3]` only, silently relying on q1 being excluded by
    // the old boundary-index rule (id 2's index) — q1 was never confirmed
    // and is non-provisional, so per B1 it must still be waiting too.
    expect(second.waiting.map((e) => e.id)).toEqual([1, 3]);
  });
});

describe("resolveConfirmedView — waiting excludes provisional entries (AC-N18.3)", () => {
  // Negative control: two fixtures differing ONLY in the provisional flag of
  // the sole newer entry. This is what proves the filter is load-bearing
  // rather than incidentally true (the fixtures otherwise normalize to the
  // same shape).
  it("counts a provisional newer entry as 0 waiting", () => {
    const questions = [q(1), q(2, { provisional: true })];
    const confirmedIds = [1];
    const out = resolveConfirmedView({ questions, confirmedIds });
    expect(out.waiting.length).toBe(0);
  });

  it("counts the same-shaped non-provisional entry as 1 waiting", () => {
    const questions = [q(1), q(2)];
    const confirmedIds = [1];
    const out = resolveConfirmedView({ questions, confirmedIds });
    expect(out.waiting.length).toBe(1);
  });

  it("filters on the CURRENT provisional value, not a cached one", () => {
    // A retroactive speaker remap clears `provisional` on an entry already
    // in the array — the same object identity, a different flag value. The
    // very next call must reflect that, since this module caches nothing.
    const entry = q(2, { provisional: true });
    const questions = [q(1), entry];
    const confirmedIds = [1];
    expect(resolveConfirmedView({ questions, confirmedIds }).waiting.length).toBe(0);

    entry.provisional = false;
    expect(resolveConfirmedView({ questions, confirmedIds }).waiting.length).toBe(1);
  });
});

describe("resolveConfirmedView — nothing confirmed is ever evicted (AC-N18.5, B1)", () => {
  // B1: a previous version of this function computed `boundaryIndex` as the
  // EARLIEST confirmed entry's index and started `waiting` after it — so
  // confirming anything but the very first (oldest) entry made every entry
  // before that confirm permanently unreachable: not `current`, not
  // `history`, not `waiting`. This is the ORDINARY path, not an edge case:
  // during seed, `current` is latest-wins, so the "Show answer" button
  // confirms whichever entry is latest at click time, which is almost never
  // the oldest one. These cases prove `waiting` is membership-based now —
  // "every non-provisional, not-confirmed entry in `questions`" — with no
  // position-derived cutoff at all.

  it("confirming the NEWEST of three leaves both older entries in waiting, oldest first", () => {
    const questions = [q(1), q(2), q(3)];
    const out = resolveConfirmedView({ questions, confirmedIds: [3] });
    expect(out.current.id).toBe(3);
    expect(out.currentIsSeed).toBe(false);
    expect(out.history).toEqual([]);
    expect(out.waiting.map((e) => e.id)).toEqual([1, 2]);
    expect(nextConfirmTarget({ questions, confirmedIds: [3] })).toBe(1);
  });

  it("confirming the MIDDLE of three leaves both the older and the newer entries in waiting", () => {
    const questions = [q(1), q(2), q(3)];
    const out = resolveConfirmedView({ questions, confirmedIds: [2] });
    expect(out.current.id).toBe(2);
    expect(out.waiting.map((e) => e.id)).toEqual([1, 3]);
  });

  it("still leaves earlier unconfirmed entries in waiting when a later one is confirmed (the oldest-first case)", () => {
    const questions = [q(1), q(2), q(3), q(4)];
    const afterFirstConfirm = resolveConfirmedView({ questions, confirmedIds: [1] });
    expect(afterFirstConfirm.waiting.map((e) => e.id)).toEqual([2, 3, 4]);

    // Confirm the THIRD waiting entry (id 4), skipping over 2 and 3.
    const confirmedIds = confirmQuestionId([1], 4);
    const out = resolveConfirmedView({ questions, confirmedIds });
    expect(out.current.id).toBe(4);
    expect(out.history.map((e) => e.id)).toEqual([1]);
    // 3 -> 2, non-monotonically, and the skipped entries are still there.
    expect(out.waiting.map((e) => e.id)).toEqual([2, 3]);
  });

  it("F2: with several entries and nothing confirmed yet, current is the OLDEST entry and the other two are reachable through waiting", () => {
    // REPLACES a no-op control that asserted the defect as correct: before
    // the F2 fix, `current` tracked latestQuestionEntry (the NEWEST entry)
    // while nothing was confirmed, and `waiting` stayed unconditionally
    // empty — so with three questions detected and nothing confirmed, the
    // panel silently advanced 1 -> 2 -> 3 with no confirm at all, and 1 and
    // 2 were reachable from neither `current`, `history`, nor `waiting`.
    // The seed gate governs advancing, not arriving (AC-N18.1) — but every
    // entry after the very first must still wait for an explicit confirm,
    // exactly like every entry does once something has been confirmed.
    const questions = [q(1), q(2), q(3)];
    const out = resolveConfirmedView({ questions, confirmedIds: [] });
    expect(out.currentIsSeed).toBe(true);
    expect(out.current.id).toBe(1);
    expect(out.waiting.map((e) => e.id)).toEqual([2, 3]);
  });

  it("the provisional filter (AC-N18.3) still holds now that the boundary is gone", () => {
    // Under the old boundary-index version this fixture could not even
    // discriminate: confirming id 3 (the newest) set boundaryIndex to 2, so
    // `waiting` started past the end of a 3-entry list regardless of id 1's
    // provisional flag. With the boundary gone, id 1 is reachable through
    // `waiting` the instant it stops being provisional, and not before.
    const entry1 = q(1, { provisional: true });
    const questions = [entry1, q(2), q(3)];
    const withProvisional = resolveConfirmedView({ questions, confirmedIds: [3] });
    expect(withProvisional.waiting.map((e) => e.id)).toEqual([2]);

    entry1.provisional = false;
    const cleared = resolveConfirmedView({ questions, confirmedIds: [3] });
    expect(cleared.waiting.map((e) => e.id)).toEqual([1, 2]);
  });
});

describe("resolveConfirmedView — stale-id fallback never re-enters the seed state (F2)", () => {
  it("a stale-id fallback after a REAL confirm keeps currentIsSeed false, so a revealed panel is never re-hidden", () => {
    const firstList = [q(1), q(2)];
    const confirmedIds = confirmQuestionId([], 2);
    const before = resolveConfirmedView({ questions: firstList, confirmedIds });
    expect(before.current.id).toBe(2);
    expect(before.currentIsSeed).toBe(false);

    // q2 — the confirmed entry — ages out of the live list entirely. Every
    // id in confirmedIds is now stale, but a real confirm DID happen, so
    // this must not degrade back to the seed view (which would flip
    // currentIsSeed back to true and, via CopilotClient's
    // answerHidden={currentIsSeed} wiring, re-hide an already-revealed
    // panel behind "Show answer").
    const prunedList = [q(1)];
    const out = resolveConfirmedView({ questions: prunedList, confirmedIds });
    expect(out.currentIsSeed).toBe(false);
    expect(out.current.id).toBe(1);
  });

  it("stays currentIsSeed:false even when every entry in questions goes stale (empty list)", () => {
    const confirmedIds = confirmQuestionId([], 1);
    const before = resolveConfirmedView({ questions: [q(1)], confirmedIds });
    expect(before.currentIsSeed).toBe(false);

    const out = resolveConfirmedView({ questions: [], confirmedIds });
    expect(out.current).toBeNull();
    expect(out.currentIsSeed).toBe(false);
    expect(out.waiting).toEqual([]);
  });
});

describe("resolveConfirmedView — duplicate confirmed ids never render one entry twice (F8)", () => {
  it("a re-confirmed id (a, b, a) surfaces once as current, not again inside history", () => {
    const questions = [q("a"), q("b")];
    const out = resolveConfirmedView({ questions, confirmedIds: ["a", "b", "a"] });
    expect(out.current.id).toBe("a");
    expect(out.history.map((e) => e.id)).toEqual(["b"]);
  });

  it("a duplicate that is not the tail still collapses to one occurrence", () => {
    const questions = [q("a"), q("b"), q("c")];
    // "a" confirmed, then "b", then "a" again, then "c" — "a"'s effective
    // position is its LAST occurrence (index 2), ahead of "b" and behind "c".
    const out = resolveConfirmedView({ questions, confirmedIds: ["a", "b", "a", "c"] });
    expect(out.current.id).toBe("c");
    expect(out.history.map((e) => e.id)).toEqual(["a", "b"]);
  });
});

describe("unconfirmQuestionId — the inverse of confirmQuestionId, pure (M7)", () => {
  it("removes the id", () => {
    expect(unconfirmQuestionId([1, 2, 3], 2)).toEqual([1, 3]);
  });

  it("is a no-op for an id that was never confirmed", () => {
    expect(unconfirmQuestionId([1, 2], 5)).toEqual([1, 2]);
  });

  it("does not mutate the array it is given", () => {
    const original = [1, 2, 3];
    const snapshot = [...original];
    unconfirmQuestionId(original, 2);
    expect(original).toEqual(snapshot);
  });

  it("survives a non-array input", () => {
    expect(unconfirmQuestionId(null, 1)).toEqual([]);
    expect(unconfirmQuestionId(undefined, 1)).toEqual([]);
  });
});

describe("resolveConfirmedView — un-confirming (M7)", () => {
  it("returns the current entry to waiting and makes the previously-confirmed entry current again", () => {
    let confirmedIds = confirmQuestionId([], 1);
    confirmedIds = confirmQuestionId(confirmedIds, 2);
    const questions = [q(1), q(2), q(3)];
    const before = resolveConfirmedView({ questions, confirmedIds });
    expect(before.current.id).toBe(2);
    expect(before.waiting.map((e) => e.id)).toEqual([3]);

    const afterUnconfirm = unconfirmQuestionId(confirmedIds, 2);
    const out = resolveConfirmedView({ questions, confirmedIds: afterUnconfirm });
    expect(out.current.id).toBe(1);
    expect(out.history).toEqual([]);
    expect(out.waiting.map((e) => e.id)).toEqual([2, 3]);
  });

  it("un-confirming an id that was never confirmed changes nothing", () => {
    const confirmedIds = confirmQuestionId([], 1);
    const questions = [q(1), q(2)];
    const before = resolveConfirmedView({ questions, confirmedIds });
    const afterUnconfirm = unconfirmQuestionId(confirmedIds, 99);
    const out = resolveConfirmedView({ questions, confirmedIds: afterUnconfirm });
    expect(out).toEqual(before);
  });
});

describe("nextConfirmTarget (AC-N18.5 rule 5)", () => {
  it("returns the oldest unconfirmed non-provisional entry's id", () => {
    const questions = [q(1), q(2), q(3)];
    expect(nextConfirmTarget({ questions, confirmedIds: [1] })).toBe(2);
  });

  it("skips a provisional entry to find the next real one", () => {
    const questions = [q(1), q(2, { provisional: true }), q(3)];
    expect(nextConfirmTarget({ questions, confirmedIds: [1] })).toBe(3);
  });

  it("returns null when nothing is waiting", () => {
    expect(nextConfirmTarget({ questions: [q(1)], confirmedIds: [1] })).toBeNull();
    expect(nextConfirmTarget({ questions: [], confirmedIds: [] })).toBeNull();
  });
});

describe("nextConfirmTarget — the seed itself, untested until now (M1)", () => {
  // M1 (adversarial delta review): every test above passes a non-empty
  // `confirmedIds`, so none of them ever exercised the seed. Executed
  // against the real module before this fix: with [a, b, c] and nothing
  // confirmed, `current` is `a` (AC-N18.1's oldest-unconfirmed rule), but
  // `waiting` deliberately EXCLUDES `current` (it IS current, not waiting —
  // see firstUnconfirmedView above), so this returned `b` — past the
  // question already on screen. Three "Show next" presses then confirmed
  // b, then a, then c: past the question being read, then backwards to it,
  // contradicting this module's own doc (`nextConfirmTarget`'s header) and
  // CopilotDashboard.js's ("the OLDEST waiting entry — the order the
  // interviewer actually asked them in").
  it("returns the seed's own current id first, not the next waiting entry", () => {
    const questions = [q("a"), q("b"), q("c")];
    expect(nextConfirmTarget({ questions, confirmedIds: [] })).toBe("a");
  });

  it("confirms in the interviewer's actual order across three successive calls: a, then b, then c", () => {
    const questions = [q("a"), q("b"), q("c")];
    let confirmedIds = [];

    const first = nextConfirmTarget({ questions, confirmedIds });
    expect(first).toBe("a");
    confirmedIds = confirmQuestionId(confirmedIds, first);

    const second = nextConfirmTarget({ questions, confirmedIds });
    expect(second).toBe("b");
    confirmedIds = confirmQuestionId(confirmedIds, second);

    const third = nextConfirmTarget({ questions, confirmedIds });
    expect(third).toBe("c");
  });

  it("skips a provisional seed current and returns the oldest real entry instead", () => {
    // A cold-start opening question can itself be flagged provisional (the
    // word-count argmax with no candidate turn yet to compare against) —
    // confirming it via "Show next" would lock in the candidate's own
    // sentence, which is exactly what M7's separate undo control exists
    // for, not this one.
    const questions = [q("a", { provisional: true }), q("b"), q("c")];
    expect(nextConfirmTarget({ questions, confirmedIds: [] })).toBe("b");
  });

  it("returns null when the seed's only entry is provisional, with nothing else waiting", () => {
    const questions = [q("a", { provisional: true })];
    expect(nextConfirmTarget({ questions, confirmedIds: [] })).toBeNull();
  });
});

describe("resolveConfirmedView — history is newest-first (rule 6)", () => {
  it("orders entries confirmed before current from most to least recently confirmed", () => {
    const questions = [q(1), q(2), q(3)];
    let confirmedIds = confirmQuestionId([], 1);
    confirmedIds = confirmQuestionId(confirmedIds, 2);
    confirmedIds = confirmQuestionId(confirmedIds, 3);
    const out = resolveConfirmedView({ questions, confirmedIds });
    expect(out.current.id).toBe(3);
    expect(out.history.map((e) => e.id)).toEqual([2, 1]);
  });
});

describe("resolveConfirmedView — defensive inputs", () => {
  it("survives being called with no argument at all", () => {
    const out = resolveConfirmedView();
    expect(out.current).toBeNull();
    expect(out.currentIsSeed).toBe(true);
    expect(out.waiting).toEqual([]);
    expect(out.history).toEqual([]);
  });

  it("survives a null questions list", () => {
    const out = resolveConfirmedView({ questions: null, confirmedIds: [1] });
    expect(out.current).toBeNull();
    // F2: confirmedIds is non-empty (id 1 WAS confirmed at some point), so
    // even though nothing resolves against an empty list this is the
    // stale-fallback case, not a re-entry into the genuine seed state — see
    // the stale-fallback tests below for why currentIsSeed must stay false.
    expect(out.currentIsSeed).toBe(false);
    expect(out.waiting).toEqual([]);
  });

  it("survives a null element in the questions array", () => {
    const questions = [null, q(1), null, q(2)];
    const out = resolveConfirmedView({ questions, confirmedIds: [1] });
    expect(out.current.id).toBe(1);
    expect(out.waiting.map((e) => e.id)).toEqual([2]);
  });

  it("survives a confirmedIds entry naming an id not present in questions", () => {
    const questions = [q(1), q(2)];
    const out = resolveConfirmedView({ questions, confirmedIds: [99] });
    // F2: the stale id resolves to nothing confirmed, but confirmedIds is
    // non-empty — a real confirm happened, just against an id no longer in
    // `questions` — so this degrades to the stale-fallback view (oldest
    // unconfirmed entry, currentIsSeed false), never back into the genuine
    // seed state, and never by crashing or fabricating a `current`.
    expect(out.current.id).toBe(1);
    expect(out.currentIsSeed).toBe(false);
  });

  it("ignores a stale id mixed in with a real one rather than failing entirely", () => {
    const questions = [q(1), q(2), q(3)];
    const out = resolveConfirmedView({ questions, confirmedIds: [1, 99] });
    expect(out.current.id).toBe(1);
    expect(out.currentIsSeed).toBe(false);
    expect(out.waiting.map((e) => e.id)).toEqual([2, 3]);
  });

  it("survives a non-array confirmedIds", () => {
    const out = resolveConfirmedView({ questions: [q(1)], confirmedIds: "nope" });
    expect(out.current.id).toBe(1);
    expect(out.currentIsSeed).toBe(true);
  });

  it("handles a confirmed id that falls out of `questions` when the array changes, without throwing or dropping a live entry", () => {
    const firstList = [q(1), q(2), q(3)];
    const confirmedIds = confirmQuestionId(confirmQuestionId([], 1), 2);
    const before = resolveConfirmedView({ questions: firstList, confirmedIds });
    expect(before.current.id).toBe(2);

    // q2 is pruned from the live list entirely (e.g. expired/trimmed) while
    // confirmedIds still names it — a stale id, not merely a stale array
    // reference. This must degrade gracefully, not throw or fabricate.
    const prunedList = [q(1), q(3)];
    expect(() => resolveConfirmedView({ questions: prunedList, confirmedIds })).not.toThrow();
    const out = resolveConfirmedView({ questions: prunedList, confirmedIds });
    // id 2 no longer resolves, so confirmedEntries falls back to [q1] alone.
    expect(out.current.id).toBe(1);
    expect(out.currentIsSeed).toBe(false);
    // q3 is live, non-provisional and never confirmed — it must still
    // surface in waiting rather than being silently dropped because a
    // stale id (2) is still sitting in confirmedIds.
    expect(out.waiting.map((e) => e.id)).toEqual([3]);
  });
});

describe("resolveConfirmedView is pure", () => {
  it("reaches for no clock of its own", async () => {
    const { readFileSync } = await import("node:fs");
    const src = readFileSync(new URL("./questionConfirm.js", import.meta.url), "utf8");
    expect(src).not.toMatch(/Date\.now|new Date\(|setTimeout|setInterval|Math\.random/);
  });

  it("does not mutate the questions or confirmedIds arrays it is given", () => {
    const questions = [q(1), q(2), q(3)];
    const confirmedIds = [1];
    const questionsSnapshot = JSON.stringify(questions);
    const confirmedSnapshot = JSON.stringify(confirmedIds);
    resolveConfirmedView({ questions, confirmedIds });
    expect(JSON.stringify(questions)).toBe(questionsSnapshot);
    expect(JSON.stringify(confirmedIds)).toBe(confirmedSnapshot);
  });

  it("gives the same answer for the same input every time", () => {
    const args = { questions: [q(1), q(2), q(3)], confirmedIds: [1] };
    expect(resolveConfirmedView(args)).toEqual(resolveConfirmedView(args));
  });
});

describe("confirmQuestionId — append with dedupe, pure", () => {
  it("appends a new id", () => {
    expect(confirmQuestionId([1, 2], 3)).toEqual([1, 2, 3]);
  });

  it("dedupes an id already present", () => {
    expect(confirmQuestionId([1, 2], 2)).toEqual([1, 2]);
  });

  it("does not mutate the array it is given", () => {
    const original = [1, 2];
    const snapshot = [...original];
    confirmQuestionId(original, 3);
    expect(original).toEqual(snapshot);
  });

  it("survives a non-array input", () => {
    expect(confirmQuestionId(null, 1)).toEqual([1]);
    expect(confirmQuestionId(undefined, 1)).toEqual([1]);
  });
});
