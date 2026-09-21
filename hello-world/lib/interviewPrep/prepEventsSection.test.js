// ---------------------------------------------------------------------------
// AC-LOG.1 / AC-LOG.2 -- per-section telemetry. N45 step S8's store half.
// ---------------------------------------------------------------------------
//
// TWO MECHANICAL, SILENT FAILURES THIS FILE EXISTS TO CATCH, both named in
// plan risk R6:
//
//   1. `recordPrepEvent` (prepStore.js:864-883) builds its INSERT payload from
//      a fixed destructured list. A `section` that is not in that list is
//      dropped on the floor -- no error, no warning, and the row is written
//      without it.
//   2. `listPrepEvents` (prepStore.js:893-899) projects an EXPLICIT column
//      list, never `select("*")`. Adding a column to the table therefore does
//      NOT surface it here. Per-section telemetry can be written correctly and
//      still never reach the candidate's downloaded prep log, which reads this
//      projection and nothing else (route.js:697 -> AppViewDialog.js's own
//      downloadPrepLog).
//
// And one in finishAttempt: its ctx is destructured as
// `{applicationId, userId, leaseToken, triggerClass, engine, restore, ...payload}`
// and `payload` is forwarded WHOLESALE to `writePrepPackResult`
// (finishAttempt.js:114,121). So a `section` or `attemptOutcome` added to ctx
// without being destructured out lands in the packs-row UPDATE as an unknown
// column -- a 42703 from a real Postgres, invisible against supabaseFake.
// The assertions below read the write payload directly for exactly that
// reason.
//
// RED ON HEAD: `section` appears nowhere in prepStore.js's event functions and
// `attemptOutcome` appears nowhere in finishAttempt.js (both verified by
// direct read this round). The projection literal is
// `"id, application_id, event_type, trigger_class, engine, outcome, reason, at"`.
//
// NOT COVERED HERE, stated rather than implied: the MIGRATION that adds
// `interview_prep_events.section`. `20260923000000_prep_section_revisions.sql`
// mentions `interview_prep_events` zero times (verified), so the column does
// not exist yet; these tests prove the code writes and reads the field, not
// that the table can hold it. A shape test on the new migration is the
// implementer's, and it is the only instrument that can close that gap.

import { describe, it, expect, vi } from "vitest";
import { makeStatefulSupabase } from "@/test/helpers/supabaseFake.js";
import { recordPrepEvent, listPrepEvents } from "./prepStore.js";
import { finishAttempt } from "./finishAttempt.js";

const EVENTS_TABLE = "interview_prep_events";
const APP_ID = "app-log-1";
const USER_ID = "user-log-1";

function fake(seed = {}) {
  return makeStatefulSupabase({ [EVENTS_TABLE]: [], ...seed }, { user: { id: USER_ID } });
}

/** finishAttempt with all three prepStore calls injected, so this file never
 *  needs a database and can read both payloads exactly as they are built. */
function harness({ written = true, reason = null } = {}) {
  const writePrepPackResult = vi.fn().mockResolvedValue({ written, reason, error: null, code: null });
  const recorded = vi.fn().mockResolvedValue({ recorded: true, error: null });
  return {
    writePrepPackResult,
    recordPrepEvent: recorded,
    isCheckViolation: () => false,
    deps: { writePrepPackResult, recordPrepEvent: recorded, isCheckViolation: () => false },
  };
}

const BASE_CTX = {
  applicationId: APP_ID,
  userId: USER_ID,
  leaseToken: "lease-1",
  triggerClass: "B2",
  engine: "gemini",
};

// ---------------------------------------------------------------------------

describe("AC-LOG.1 -- finishAttempt carries `section` to the event write, and ONLY there", () => {
  it("the event row records the section the attempt was for", async () => {
    const h = harness();
    await finishAttempt({}, { ...BASE_CTX, status: "ready", section: "askThem" }, h.deps);
    expect(h.recordPrepEvent).toHaveBeenCalledTimes(1);
    expect(h.recordPrepEvent.mock.calls[0][1].section).toBe("askThem");
  });

  it("`section` NEVER reaches writePrepPackResult -- the packs row has no such column", async () => {
    // finishAttempt forwards `...payload` wholesale. An un-destructured field
    // becomes a column name in the UPDATE, which a real Postgres answers with
    // 42703 and supabaseFake answers with nothing at all.
    const h = harness();
    await finishAttempt({}, { ...BASE_CTX, status: "ready", section: "askThem" }, h.deps);
    const writePayload = h.writePrepPackResult.mock.calls[0][1];
    expect(Object.prototype.hasOwnProperty.call(writePayload, "section")).toBe(false);
  });

  it("`attemptOutcome` overrides the event's outcome WITHOUT changing the pack's own status", async () => {
    // The telemetry lie this closes: a section-scoped attempt that produced
    // nothing still leaves a 'ready' pack (the other three sections are
    // intact), so an event row mirroring the pack status reports a success for
    // an attempt that failed.
    const h = harness();
    await finishAttempt(
      {},
      { ...BASE_CTX, status: "ready", section: "askThem", attemptOutcome: "failed" },
      h.deps,
    );
    expect(h.recordPrepEvent.mock.calls[0][1].outcome).toBe("failed");
    expect(h.writePrepPackResult.mock.calls[0][1].status).toBe("ready");
    expect(Object.prototype.hasOwnProperty.call(h.writePrepPackResult.mock.calls[0][1], "attemptOutcome")).toBe(false);
  });

  it("[no-op control] with no attemptOutcome the event outcome still mirrors the pack status", async () => {
    // GREEN ON HEAD BY DESIGN. Without it, "always write 'failed'" satisfies
    // the case above and every successful attempt is logged as a failure.
    const h = harness();
    await finishAttempt({}, { ...BASE_CTX, status: "partial" }, h.deps);
    expect(h.recordPrepEvent.mock.calls[0][1].outcome).toBe("partial");
  });

  it("[no-op control] a whole-pack attempt records a null section, never a leftover value", async () => {
    const h = harness();
    await finishAttempt({}, { ...BASE_CTX, status: "ready" }, h.deps);
    expect(h.recordPrepEvent.mock.calls[0][1].section ?? null).toBeNull();
  });

  it("the stale-token branch carries the section too -- a refused write is still that section's event", async () => {
    const h = harness({ written: false, reason: "stale-token" });
    await finishAttempt({}, { ...BASE_CTX, status: "ready", section: "stages" }, h.deps);
    expect(h.recordPrepEvent).toHaveBeenCalledTimes(1);
    const event = h.recordPrepEvent.mock.calls[0][1];
    expect(event.outcome).toBe("stale-token");
    expect(event.section).toBe("stages");
  });
});

describe("AC-LOG.2 -- the store writes and reads the column", () => {
  it("recordPrepEvent puts `section` in the INSERT payload", async () => {
    const sb = fake();
    await recordPrepEvent(sb, {
      applicationId: APP_ID,
      userId: USER_ID,
      eventType: "attempt",
      outcome: "failed",
      section: "askThem",
    });
    const row = sb.rows(EVENTS_TABLE)[0];
    expect(row, "no event row was inserted at all").toBeTruthy();
    expect(row.section, "recordPrepEvent dropped `section` on the floor").toBe("askThem");
  });

  it("[no-op control] an event with no section inserts null, not undefined or a stale value", async () => {
    const sb = fake();
    await recordPrepEvent(sb, {
      applicationId: APP_ID,
      userId: USER_ID,
      eventType: "delete",
      outcome: "deleted",
    });
    expect(sb.rows(EVENTS_TABLE)[0].section ?? null).toBeNull();
  });

  it("listPrepEvents' EXPLICIT projection names `section`, so the column is not silently dropped on read", async () => {
    // A projection-literal assertion, deliberately: this list is explicit, so
    // the column existing in the table and being written correctly still
    // leaves it invisible to every consumer if this one string is not touched.
    const sb = fake();
    await listPrepEvents(sb, { applicationId: APP_ID, userId: USER_ID });
    const select = sb.calls.find((c) => c.table === EVENTS_TABLE && c.verb === "select");
    expect(select, "listPrepEvents issued no select against the events table").toBeTruthy();
    // CANARY: the recorded projection really is the explicit list, so the
    // assertion below is about a real string and not about `undefined`.
    expect(select.select).toContain("event_type");
    expect(select.select, `projection is still: ${select.select}`).toContain("section");
  });

  it("an event row's section survives the round trip to the candidate's log", async () => {
    const sb = fake({
      [EVENTS_TABLE]: [
        {
          id: 1,
          application_id: APP_ID,
          user_id: USER_ID,
          event_type: "attempt",
          trigger_class: "B2",
          engine: "gemini",
          outcome: "failed",
          reason: "provider-error",
          section: "askThem",
          at: "2026-09-20T00:00:00.000Z",
        },
      ],
    });
    const { events } = await listPrepEvents(sb, { applicationId: APP_ID, userId: USER_ID });
    expect(events).toHaveLength(1);
    expect(events[0].section).toBe("askThem");
  });
});
