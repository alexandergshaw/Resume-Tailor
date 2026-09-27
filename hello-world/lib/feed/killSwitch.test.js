// N60 S4 -- the feature kill switch, and the owner ruling that it FAILS CLOSED.
//
// OWNER RULING: "The alert_mail kill switch FAILS CLOSED, like auto_tailor's: a
// read failure on its own switch key must refuse mail, not fall through to the
// counter check." And per plan 7.4: the switch is read PER KEY, and a read
// failure refuses THAT feature only -- no shared decision (AC-R6).
//
// CONTRACT:
//   isFeatureDisabled(admin, key) ->
//     { ok:true,  disabled:false }                              (row absent, or disabled=false: idle/enabled)
//     { ok:true,  disabled:true }                               (row disabled=true: switched off)
//     { ok:false, disabled:true, reason:"kill_switch_unreadable" }  (read errored: FAIL CLOSED)
//
// The read-error case returns disabled:TRUE (so the feature refuses) and ok:false
// (so the caller can tell a deliberate off-switch from an unreadable one, and
// report the right reason -- a broken switch must not read as a live one).

import { describe, it, expect } from "vitest";
import { makeAtomicLedgerFake } from "@/test/helpers/atomicLedgerFake.js";

let mod = null;
let loadErr = null;
async function load() {
  if (mod || loadErr) return mod;
  try {
    mod = await import("./killSwitch.js");
  } catch (err) {
    loadErr = err;
  }
  return mod;
}
async function isDisabled(admin, key) {
  const m = await load();
  if (!m?.isFeatureDisabled) {
    throw new Error(`isFeatureDisabled unavailable: ${loadErr?.message || "not exported"}`);
  }
  return m.isFeatureDisabled(admin, key);
}

describe("isFeatureDisabled -- the enabled/disabled states (both directions)", () => {
  it("a switch row with disabled=false leaves the feature ENABLED (idle control)", async () => {
    const { admin } = makeAtomicLedgerFake({ killSwitches: { auto_tailor: { disabled: false } } });
    const r = await isDisabled(admin, "auto_tailor");
    expect(r).toEqual({ ok: true, disabled: false });
  });

  it("an ABSENT switch row leaves the feature ENABLED -- absence is not a refusal", async () => {
    const { admin } = makeAtomicLedgerFake();
    const r = await isDisabled(admin, "auto_tailor");
    expect(r.ok).toBe(true);
    expect(r.disabled).toBe(false);
  });

  it("a switch row with disabled=true DISABLES the feature", async () => {
    const { admin } = makeAtomicLedgerFake({ killSwitches: { auto_tailor: { disabled: true } } });
    const r = await isDisabled(admin, "auto_tailor");
    expect(r.ok).toBe(true);
    expect(r.disabled).toBe(true);
  });
});

describe("isFeatureDisabled -- FAILS CLOSED on a read error", () => {
  it("a read error returns disabled:true, NOT disabled:false", async () => {
    const { admin } = makeAtomicLedgerFake({ failTable: new Set(["feature_kill_switches"]) });
    const r = await isDisabled(admin, "alert_mail");
    expect(r.disabled).toBe(true);
    // The defect this guards: a broken switch read returning disabled:false
    // (fail-open) would let unattended spend proceed with no guard at all.
    expect(r.disabled).not.toBe(false);
  });

  it("a broken switch (read error) is DISTINGUISHABLE from a deliberate off-switch", async () => {
    const off = await isDisabled(
      makeAtomicLedgerFake({ killSwitches: { alert_mail: { disabled: true } } }).admin,
      "alert_mail",
    );
    const broken = await isDisabled(
      makeAtomicLedgerFake({ failTable: new Set(["feature_kill_switches"]) }).admin,
      "alert_mail",
    );
    // Both refuse (disabled:true), but the reason differs so AC-R4 can report
    // "disabled_by_kill_switch" apart from "kill switch unreadable".
    expect(off.disabled).toBe(true);
    expect(broken.disabled).toBe(true);
    expect(off.ok).toBe(true);
    expect(broken.ok).toBe(false);
    expect(broken.reason).toBe("kill_switch_unreadable");
  });
});

describe("isFeatureDisabled -- read is PER KEY, no shared decision (AC-R6)", () => {
  it("reads only the requested key's row", async () => {
    const { admin, calls } = makeAtomicLedgerFake({
      killSwitches: { auto_tailor: { disabled: true }, alert_mail: { disabled: false } },
    });
    const r = await isDisabled(admin, "alert_mail");
    expect(r).toEqual({ ok: true, disabled: false });
    // The single read filtered on the requested key -- it did not read or
    // combine the other feature's switch.
    const reads = calls.filter((c) => c.verb === "select" && c.table === "feature_kill_switches");
    expect(reads).toHaveLength(1);
    expect(reads[0].filters.key).toBe("alert_mail");
  });

  it("one feature's switch being off does not disable the other", async () => {
    const { admin } = makeAtomicLedgerFake({
      killSwitches: { auto_tailor: { disabled: true }, alert_mail: { disabled: false } },
    });
    const auto = await isDisabled(admin, "auto_tailor");
    const mail = await isDisabled(admin, "alert_mail");
    expect(auto.disabled).toBe(true);
    expect(mail.disabled).toBe(false);
  });
});
