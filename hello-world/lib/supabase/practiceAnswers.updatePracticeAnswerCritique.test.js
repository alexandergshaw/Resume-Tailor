import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("@/lib/supabase/client", () => ({
  createClient: vi.fn(),
}));

import { updatePracticeAnswerCritique } from "./practiceAnswers";
import { createClient } from "@/lib/supabase/client";

// Minimal chainable double for `supabase.from("practice_answers").update(...).eq(...).eq(...)`,
// mirroring the fake in lib/copilot/postings.test.js. Records the update payload and
// every filter so tests can assert the query actually scopes to id + user_id, not
// just that it resolved without throwing.
function makeFakeSupabase({ user = null, userError = null, updateError = null } = {}) {
  const calls = { from: [], update: [], eq: [] };
  const builder = {
    update: vi.fn((...args) => {
      calls.update.push(args);
      return builder;
    }),
    eq: vi.fn((...args) => {
      calls.eq.push(args);
      return builder;
    }),
    // Lets `await supabase.from(...).update(...).eq(...).eq(...)` resolve without
    // a terminal `.single()`, same as the real query builder.
    then: (resolve, reject) => Promise.resolve({ error: updateError }).then(resolve, reject),
  };
  return {
    calls,
    auth: {
      getUser: vi.fn(async () => ({ data: { user }, error: userError })),
    },
    from: vi.fn((table) => {
      calls.from.push(table);
      return builder;
    }),
  };
}

describe("updatePracticeAnswerCritique", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("updates the critique on the given row scoped to the signed-in user's id, carrying the new critique", async () => {
    const fake = makeFakeSupabase({ user: { id: "u1" } });
    createClient.mockReturnValue(fake);
    const critique = { score: 8, notes: "Strong structure, trim the intro." };

    const result = await updatePracticeAnswerCritique("row-1", critique);

    expect(result).toEqual({ error: null });
    expect(fake.from).toHaveBeenCalledWith("practice_answers");
    expect(fake.calls.update).toEqual([[{ critique }]]);
    expect(fake.calls.eq).toContainEqual(["id", "row-1"]);
    expect(fake.calls.eq).toContainEqual(["user_id", "u1"]);
  });

  it("scopes the update to the signed-in user's own id, never a caller-supplied one, so one user can't patch another's row", async () => {
    const fake = makeFakeSupabase({ user: { id: "attacker" } });
    createClient.mockReturnValue(fake);

    await updatePracticeAnswerCritique("someone-elses-row", { score: 1 });

    // The user_id filter comes only from the resolved session — the caller has
    // no way to pass a different user_id in, so this is the only value it can be.
    expect(fake.calls.eq).toContainEqual(["user_id", "attacker"]);
    expect(fake.calls.eq.filter(([col]) => col === "user_id")).toHaveLength(1);
  });

  it("returns an error for a missing id without ever touching Supabase", async () => {
    const result = await updatePracticeAnswerCritique("", { score: 5 });

    expect(result).toEqual({ error: "Missing recording id." });
    expect(createClient).not.toHaveBeenCalled();
  });

  it("returns an error instead of throwing when the caller is signed out", async () => {
    const fake = makeFakeSupabase({ user: null });
    createClient.mockReturnValue(fake);

    const result = await updatePracticeAnswerCritique("row-1", { score: 5 });

    expect(result).toEqual({ error: "You must be signed in to update a practice answer." });
    expect(fake.from).not.toHaveBeenCalled();
  });

  it("returns the database error message instead of throwing when the update fails", async () => {
    const fake = makeFakeSupabase({
      user: { id: "u1" },
      updateError: { message: "constraint boom" },
    });
    createClient.mockReturnValue(fake);

    const result = await updatePracticeAnswerCritique("row-1", { score: 5 });

    expect(result).toEqual({ error: "constraint boom" });
  });

  it("falls back to a default message instead of throwing when the database error has no message", async () => {
    const fake = makeFakeSupabase({ user: { id: "u1" }, updateError: {} });
    createClient.mockReturnValue(fake);

    const result = await updatePracticeAnswerCritique("row-1", { score: 5 });

    expect(result).toEqual({ error: "Could not update this answer." });
  });

  it("carries a freshly retried critique through so a retry-after-failure never leaves the row empty", async () => {
    const fake = makeFakeSupabase({ user: { id: "u1" } });
    createClient.mockReturnValue(fake);
    const retriedCritique = {
      score: 9,
      strengths: ["Clear STAR structure"],
      attempt: "second",
    };

    await updatePracticeAnswerCritique("row-1", retriedCritique);

    const [[payload]] = fake.calls.update;
    expect(payload.critique).toEqual(retriedCritique);
    expect(payload.critique).not.toEqual({});
  });
});
