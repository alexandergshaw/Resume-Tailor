// N60 S6 (4b/TDD) -- AC-E4: the account-level alert-mail pause READER.
//
// A single per-account row (public.user_alert_settings.alerts_paused, S4
// migration) is read by the cron (as service_role) and by the status route (as
// the user's own client) to decide whether to send any alert mail. This file
// pins the read's contract. It deliberately mirrors lib/feed/killSwitch.js's
// settled posture, because the failure directions are the same:
//
//   * a MISSING row reads as NOT paused -- absence of an explicit pause is not
//     a refusal (Part C direction is "don't send when unwanted", but a user
//     who never touched the control has not asked to be paused; the safe
//     default here is "mail flows, subject to the ceilings"), and it must NOT
//     error (RLS select-own returns zero rows for a user who never wrote one).
//   * a READ ERROR FAILS CLOSED -- treat the account as paused rather than
//     sending, and make that distinguishable from a genuine not-paused, exactly
//     as a broken kill switch is distinguishable from a live one (ok:false vs
//     ok:true). A run that could not read the setting must never send as if the
//     user had not paused.
//
// CONTRACT (readAlertsPaused(client, userId)):
//   { ok:true,  paused:false }                                  (row absent, or alerts_paused=false)
//   { ok:true,  paused:true  }                                  (alerts_paused=true)
//   { ok:false, paused:true, reason:"alert_settings_unreadable" }  (read errored: FAIL CLOSED)
//
// STRUCTURAL CALL (flagged for the architect): neither the design nor the plan
// named the reader's module; §6.3 only says "S6 supplies the reader". I place
// it at lib/email/alertPause.js (the mail/account concern, beside
// alertMailBounds/alertMailLedger). If the architect moves it, re-point the
// three importers (this test, the cron test, the status route) -- the contract
// is what matters, not the path.
//
// RED on HEAD: lib/email/alertPause.js does not exist -> collection failure (a
// real Cannot-find-module import error, never a vacuous assertion).
//
// NON-VACUITY: the paused-true and not-paused cases are each other's control --
// a reader that always returns paused (or never) fails one of the two.

import { describe, it, expect } from "vitest";
import { makeSupabase } from "@/test/helpers/supabaseMock.js";
import { readAlertsPaused } from "./alertPause.js";

const USER = "user-1";

describe("readAlertsPaused -- the paused / not-paused states (both directions)", () => {
  it("a row with alerts_paused=true reports paused", async () => {
    const client = makeSupabase({ user_alert_settings: { data: { alerts_paused: true } } });
    const r = await readAlertsPaused(client, USER);
    expect(r).toEqual({ ok: true, paused: true });
  });

  it("a row with alerts_paused=false reports NOT paused (idle control)", async () => {
    const client = makeSupabase({ user_alert_settings: { data: { alerts_paused: false } } });
    const r = await readAlertsPaused(client, USER);
    expect(r).toEqual({ ok: true, paused: false });
  });

  it("an ABSENT row reads as NOT paused -- a user who never wrote the control is not paused, and it does not error", async () => {
    // RLS select-own yields zero rows for a user who never wrote user_alert_settings.
    const client = makeSupabase({ user_alert_settings: { data: null } });
    const r = await readAlertsPaused(client, USER);
    expect(r.ok).toBe(true);
    expect(r.paused).toBe(false);
  });
});

describe("readAlertsPaused -- FAILS CLOSED on a read error", () => {
  it("a read error returns paused:true, NOT paused:false", async () => {
    const client = makeSupabase({ user_alert_settings: { error: { message: "settings read failed" } } });
    const r = await readAlertsPaused(client, USER);
    expect(r.paused).toBe(true);
    // The defect this guards: an unreadable setting read as paused:false would
    // send alert mail exactly when the app could not confirm the user had not
    // paused -- the fail-OPEN direction Part C forbids.
    expect(r.paused).not.toBe(false);
  });

  it("an unreadable setting is DISTINGUISHABLE from a genuine not-paused", async () => {
    const notPaused = await readAlertsPaused(
      makeSupabase({ user_alert_settings: { data: { alerts_paused: false } } }),
      USER,
    );
    const unreadable = await readAlertsPaused(
      makeSupabase({ user_alert_settings: { error: { message: "boom" } } }),
      USER,
    );
    // A broken counter is distinguishable from an idle one: both are safe
    // (the unreadable one refuses), but ok differs so AC-R4 can report the
    // right reason rather than silently mislabelling an outage as "fine".
    expect(notPaused).toEqual({ ok: true, paused: false });
    expect(unreadable.ok).toBe(false);
    expect(unreadable.paused).toBe(true);
    expect(unreadable.reason).toBe("alert_settings_unreadable");
  });
});

describe("readAlertsPaused -- reads only the requested account's row (RLS reachability)", () => {
  it("filters the read on the requested user_id, not a shared/global decision", async () => {
    const client = makeSupabase({ user_alert_settings: { data: { alerts_paused: true } } });
    await readAlertsPaused(client, USER);
    // The row is per-account (user_alert_settings PK user_id). The read must be
    // scoped to that user -- a global read would let one account's pause affect
    // another's mail.
    expect(client.calls.user_alert_settings.eq).toContainEqual(["user_id", USER]);
  });
});
