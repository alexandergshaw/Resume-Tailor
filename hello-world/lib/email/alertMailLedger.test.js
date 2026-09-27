// N60 S4 -- AC-E2: a DURABLE, ATOMIC per-UTC-day ceiling on outbound alert
// mail, per recipient address (4) AND per account across all addresses (10).
//
// Same owner ruling as the tailor counter: the cap decision is a single atomic
// server-side reserve, not a read-modify-write. Two overlapping cron runs must
// not both spend against one read count, for EITHER ceiling.
//
// CONTRACT:
//   reserveMailSend(admin, userId, recipient, { perAddressCap, perAccountCap, now }) ->
//     { ok:true,  reserved:true }
//     { ok:true,  reserved:false, reason:"address_day_ceiling" }
//     { ok:true,  reserved:false, reason:"account_day_ceiling" }
//     { ok:false, reason:"counter_unreadable" }              (rpc errored)
//
// NOT PROVEN HERE (PGlite absent -- see n60SpendLedgerMigrationShape.test.js):
// that Postgres serialises the reserve. This proves the application code uses a
// single atomic reserve rather than read-then-write; the migration-shape test
// is the witness that the reserve function is cap-guarded.

import { describe, it, expect } from "vitest";
import {
  MAX_ALERT_MAILS_PER_ADDRESS_PER_UTC_DAY,
  MAX_ALERT_MAILS_PER_ACCOUNT_PER_UTC_DAY,
} from "@/lib/email/alertMailBounds.js";
import { makeAtomicLedgerFake } from "@/test/helpers/atomicLedgerFake.js";

const USER = "22222222-2222-2222-2222-222222222222";
const ADDR = "someone@example.com";
const now = () => new Date("2026-09-27T12:00:00.000Z");
const DAY = "2026-09-27";

let mod = null;
let loadErr = null;
async function load() {
  if (mod || loadErr) return mod;
  try {
    mod = await import("./alertMailLedger.js");
  } catch (err) {
    loadErr = err;
  }
  return mod;
}
async function reserveMail(admin, recipient, o) {
  const m = await load();
  if (!m?.reserveMailSend) {
    throw new Error(`reserveMailSend unavailable: ${loadErr?.message || "not exported"}`);
  }
  return m.reserveMailSend(admin, USER, recipient, o);
}

const caps = {
  perAddressCap: MAX_ALERT_MAILS_PER_ADDRESS_PER_UTC_DAY,
  perAccountCap: MAX_ALERT_MAILS_PER_ACCOUNT_PER_UTC_DAY,
  now,
};

describe("the bounds are the reasoned numbers (second witness on the constants this file enforces)", () => {
  it("per-address ceiling is 4, per-account is 10", () => {
    expect(MAX_ALERT_MAILS_PER_ADDRESS_PER_UTC_DAY).toBe(4);
    expect(MAX_ALERT_MAILS_PER_ACCOUNT_PER_UTC_DAY).toBe(10);
  });
});

describe("reserveMailSend -- per-address ceiling (permit + refuse, paired)", () => {
  it("PERMITS the 4th message to an address and REFUSES the 5th", async () => {
    const { admin, store, addrKey, autoKey } = makeAtomicLedgerFake();
    store.mailAddress.set(addrKey(USER, DAY, ADDR), 3);
    store.mailAccount.set(autoKey(USER, DAY), 3);
    const fourth = await reserveMail(admin, ADDR, caps);
    expect(fourth).toEqual({ ok: true, reserved: true });

    const fifth = await reserveMail(admin, ADDR, caps);
    expect(fifth.ok).toBe(true);
    expect(fifth.reserved).toBe(false);
    expect(fifth.reason).toBe("address_day_ceiling");
  });

  it("PERMITS an idle address -- the control against 'refuses everything'", async () => {
    const { admin } = makeAtomicLedgerFake();
    const r = await reserveMail(admin, ADDR, caps);
    expect(r).toEqual({ ok: true, reserved: true });
  });
});

describe("reserveMailSend -- per-account ceiling bounds the multi-address path", () => {
  it("REFUSES once the account total hits 10 even though THIS address is far under its own 4", async () => {
    const { admin, store, addrKey, autoKey } = makeAtomicLedgerFake();
    // Account already at 10 across other addresses; this address has sent 0.
    store.mailAccount.set(autoKey(USER, DAY), 10);
    store.mailAddress.set(addrKey(USER, DAY, ADDR), 0);
    const r = await reserveMail(admin, ADDR, caps);
    expect(r.ok).toBe(true);
    expect(r.reserved).toBe(false);
    expect(r.reason).toBe("account_day_ceiling");
  });

  it("PERMITS when the account is at 9 (control -- the account cap is not off-by-one strict)", async () => {
    const { admin, store, autoKey } = makeAtomicLedgerFake();
    store.mailAccount.set(autoKey(USER, DAY), 9);
    const r = await reserveMail(admin, ADDR, caps);
    expect(r).toEqual({ ok: true, reserved: true });
  });
});

describe("reserveMailSend -- REFUSE WHEN IT CANNOT COUNT (broken != idle)", () => {
  it("an rpc error returns counter_unreadable, never a silent reserved:true", async () => {
    const { admin } = makeAtomicLedgerFake({ failRpc: new Set(["reserve_alert_mail_slot"]) });
    const r = await reserveMail(admin, ADDR, caps);
    expect(r.ok).toBe(false);
    expect(r.reason).toBe("counter_unreadable");
    expect(r.reserved).not.toBe(true);
  });

  it("broken and idle are distinguishable", async () => {
    const idle = await reserveMail(makeAtomicLedgerFake().admin, ADDR, caps);
    const broken = await reserveMail(
      makeAtomicLedgerFake({ failRpc: new Set(["reserve_alert_mail_slot"]) }).admin,
      ADDR,
      caps,
    );
    expect(idle.ok).toBe(true);
    expect(broken.ok).toBe(false);
    expect(idle).not.toEqual(broken);
  });
});

describe("reserveMailSend -- it is ATOMIC, not read-modify-write", () => {
  it("issues exactly ONE db operation per reserve, the atomic rpc, never select+write", async () => {
    const { admin, calls } = makeAtomicLedgerFake();
    await reserveMail(admin, ADDR, caps);
    expect(calls).toHaveLength(1);
    expect(calls[0].verb).toBe("rpc");
    expect(calls[0].fn).toBe("reserve_alert_mail_slot");
    expect(calls.some((c) => c.verb === "select")).toBe(false);
  });

  it("passes both caps, the recipient and the UTC day into the single atomic call", async () => {
    const { admin, calls } = makeAtomicLedgerFake();
    await reserveMail(admin, ADDR, caps);
    expect(calls[0].args).toMatchObject({
      p_user_id: USER,
      p_day: DAY,
      p_recipient: ADDR,
      p_address_cap: 4,
      p_account_cap: 10,
    });
  });
});

describe("reserveMailSend -- two overlapping runs share one count (genuine interleave)", () => {
  it("the per-account ceiling holds across two racing runs to DIFFERENT addresses", async () => {
    const ACCT = 3;
    const { admin, store, autoKey } = makeAtomicLedgerFake();
    const localCaps = { perAddressCap: 100, perAccountCap: ACCT, now };
    // Two runs, each to its own address (so the address cap never binds) --
    // only the shared account counter can stop them.
    async function run(addr) {
      const outcomes = [];
      for (let i = 0; i < ACCT; i += 1) {
        outcomes.push(await reserveMail(admin, addr, localCaps));
      }
      return outcomes;
    }
    const [a, b] = await Promise.all([run("a@example.com"), run("b@example.com")]);
    const all = [...a, ...b];
    const reserved = all.filter((r) => r.ok && r.reserved).length;
    expect(all).toHaveLength(2 * ACCT);
    expect(2 * ACCT).toBeGreaterThan(ACCT);
    expect(reserved).toBe(ACCT);
    expect(store.mailAccount.get(autoKey(USER, DAY))).toBe(ACCT);
  });
});

describe("reserveMailSend -- UTC-day boundary", () => {
  it("a send at 23:59:59.999Z counts against that UTC day", async () => {
    const { admin, calls } = makeAtomicLedgerFake();
    await reserveMail(admin, ADDR, { ...caps, now: () => new Date("2026-09-27T23:59:59.999Z") });
    expect(calls[0].args.p_day).toBe("2026-09-27");
  });

  it("the next UTC day starts a fresh address count", async () => {
    const { admin, store, addrKey } = makeAtomicLedgerFake();
    store.mailAddress.set(addrKey(USER, DAY, ADDR), 4); // 27th is full for this address
    const late = await reserveMail(admin, ADDR, { ...caps, now: () => new Date("2026-09-27T23:59:59.999Z") });
    expect(late.reserved).toBe(false);
    const fresh = await reserveMail(admin, ADDR, { ...caps, now: () => new Date("2026-09-28T00:00:00.000Z") });
    expect(fresh.reserved).toBe(true);
  });
});
