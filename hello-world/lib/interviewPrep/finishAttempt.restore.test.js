// ---------------------------------------------------------------------------
// P2 (plan §2.7) -- finishAttempt's CHECK-safe fallback retry must carry the
// restore payload too, and it is the ONE write site route.js cannot reach.
//
// Additive, alongside finishAttempt.test.js: nothing here edits, weakens or
// replaces a landed assertion in that file.
//
// WHY THE RETRY MATTERS AT ALL. When the ordinary terminal write violates a
// CHECK, finishAttempt retries once with a minimal payload. That payload is
// built INSIDE finishAttempt (finishAttempt.js:114-121), so route.js cannot
// spread anything into it. Today it carries no `pack`, which used to be
// justified as "the CHECK that could reject a real pack cannot reject this
// one" -- true, and beside the point once a restore exists: the restore pack
// is a document that was ALREADY stored successfully, so it has already
// passed checkPackByteBudget and every table CHECK. Leaving it out means the
// one path that recovers from a CHECK violation is also the one path that
// still destroys the candidate's document.
//
// A STALE COMMENT THIS FILE DOES NOT FIX, recorded so nobody trusts it:
// finishAttempt.js:19-27's header states that a pack-less payload writes
// `pack = NULL` and raises 23502, so the fallback "cannot currently succeed".
// prepStore.js:429 has since guarded that (`if (pack !== undefined)`), so a
// pack-less payload OMITS the column rather than nulling it. The described
// behaviour no longer exists. Rewriting that header is plan step S7b's, not
// a test's.

import { describe, it, expect, vi } from "vitest";
import { finishAttempt } from "./finishAttempt.js";

const APP_ID = "11111111-1111-1111-1111-111111111111";
const USER_ID = "22222222-2222-2222-2222-222222222222";
const LEASE_TOKEN = "33333333-3333-3333-3333-333333333333";

const CHECK_VIOLATION = { written: false, reason: "error", code: "23514", error: "pack is 300000 bytes, 37856 over the 262144-byte limit" };
const WRITTEN = { written: true, reason: null, error: null, code: null };

function restorePayloadFixture() {
  return {
    pack: {
      version: 1,
      sections: { aboutYou: { answer: { lines: [{ text: "The document that was already stored.", support: null }] } } },
      claims: [],
    },
    liveRevisions: { aboutYou: 4, whyRole: 2, askThem: 1, stages: 3 },
  };
}

function deps(...results) {
  const writePrepPackResult = vi.fn();
  for (const result of results) writePrepPackResult.mockResolvedValueOnce(result);
  return { writePrepPackResult, recordPrepEvent: vi.fn().mockResolvedValue({ recorded: true, error: null }) };
}

describe("P2 -- the CHECK-safe fallback retry restores the prior document", () => {
  it("[RED on HEAD: `restore` is not a ctx field and the retry payload is hardcoded] the RETRY carries both `pack` and `liveRevisions`", async () => {
    // MUTANT THIS KILLS: delete the `...restore` spread from the retry's own
    // payload. Nothing else in the suite observes that payload's contents.
    const restore = restorePayloadFixture();
    const { writePrepPackResult, recordPrepEvent } = deps(CHECK_VIOLATION, WRITTEN);

    await finishAttempt(
      {},
      {
        applicationId: APP_ID,
        userId: USER_ID,
        leaseToken: LEASE_TOKEN,
        triggerClass: "B1",
        engine: "gemini",
        status: "failed",
        reason: "provider-error",
        restore,
        ...restore,
      },
      { writePrepPackResult, recordPrepEvent },
    );

    expect(writePrepPackResult).toHaveBeenCalledTimes(2);
    const retryPayload = writePrepPackResult.mock.calls[1][1];
    expect(retryPayload).toMatchObject({ status: "failed", reason: "check-violation" });
    expect(JSON.stringify(retryPayload.pack)).toBe(JSON.stringify(restore.pack));
    expect(retryPayload.liveRevisions).toEqual(restore.liveRevisions);
  });

  it("[RED on HEAD: `restore` rides through `...payload` into the store call] `restore` is destructured OUT of ctx and never reaches writePrepPackResult as a field of its own", async () => {
    // R-N45-CLAIMS' premise: writePrepPackResult must be handed exactly the
    // columns it is meant to write. A finishAttempt that forwarded an
    // unrecognized `restore` object into the store call would be relying on
    // that function to ignore a field it never declared -- and the day it
    // stops ignoring it, `pack` is written by a value the caller never asked
    // for, which is a second, hidden writer of interview_prep_packs.pack.
    const restore = restorePayloadFixture();
    const { writePrepPackResult, recordPrepEvent } = deps(WRITTEN);

    await finishAttempt(
      {},
      {
        applicationId: APP_ID,
        userId: USER_ID,
        leaseToken: LEASE_TOKEN,
        status: "failed",
        reason: "provider-error",
        restore,
        ...restore,
      },
      { writePrepPackResult, recordPrepEvent },
    );

    const firstPayload = writePrepPackResult.mock.calls[0][1];
    expect(Object.hasOwn(firstPayload, "restore")).toBe(false);
    // The caller's OWN explicit spread is what puts the content there, and it
    // still must arrive.
    expect(JSON.stringify(firstPayload.pack)).toBe(JSON.stringify(restore.pack));
    expect(firstPayload.liveRevisions).toEqual(restore.liveRevisions);
  });

  it("[no-op control -- HEAD-GREEN] with NO `restore` in ctx, the retry payload is byte-identical to today's", async () => {
    // Every existing call site omits `restore`, so this pins the default:
    // additive, with today's behaviour unchanged. Without it, an
    // implementation that injects a pack unconditionally would look correct.
    const { writePrepPackResult, recordPrepEvent } = deps(CHECK_VIOLATION, WRITTEN);

    await finishAttempt(
      {},
      {
        applicationId: APP_ID,
        userId: USER_ID,
        leaseToken: LEASE_TOKEN,
        status: "ready",
        pack: { sections: {}, claims: {} },
      },
      { writePrepPackResult, recordPrepEvent },
    );

    const retryPayload = writePrepPackResult.mock.calls[1][1];
    expect(retryPayload).not.toHaveProperty("pack");
    expect(retryPayload).not.toHaveProperty("liveRevisions");
    expect(Object.keys(retryPayload).sort()).toEqual(
      ["applicationId", "error", "leaseToken", "reason", "status", "userId"].sort(),
    );
  });

  it("[control] a restore-bearing ctx that never hits a CHECK violation issues exactly ONE write", async () => {
    const restore = restorePayloadFixture();
    const { writePrepPackResult, recordPrepEvent } = deps(WRITTEN);
    await finishAttempt(
      {},
      { applicationId: APP_ID, userId: USER_ID, leaseToken: LEASE_TOKEN, status: "failed", reason: "provider-error", restore, ...restore },
      { writePrepPackResult, recordPrepEvent },
    );
    expect(writePrepPackResult).toHaveBeenCalledTimes(1);
    expect(recordPrepEvent).toHaveBeenCalledTimes(1);
  });
});
