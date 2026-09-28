// N60 SECOND CHUNK -- Step B (4b TDD) -- AC2-C3 part (i) + AC2-C5 + owner ruling 2.
//
// SCOPE: the chat-derived sanitizer `sanitizeChatDerivedSavedSearch`, to be added
// to the SHARED lib/savedSearch/savedSearchFields.js. This is the SHAPE half of the
// structural exclusion: the object the chat write path hands to the DB can never
// carry `auto_tailor_enabled`, so a chat turn is structurally incapable of enabling
// unattended paid work. The apply-route half (the insert body IS this return value,
// and the route never calls the permissive sanitizers) lives in
// app/api/feed-config/apply/route.test.js + route.guards.test.js.
//
// WHY KEY-ABSENCE, NOT `=== false` (brief item, AC2-C3, plan R7): a sanitizer that
// SET `auto_tailor_enabled: false` still "carries" the field -- a downstream route
// that spread the object, or a later merge, could flip it to true. The only shape a
// convenience-adding round cannot quietly defeat is one where the KEY DOES NOT
// EXIST. So every assertion below is `not.toHaveProperty(...)`, never a value check.
//
// RED ON HEAD: `sanitizeChatDerivedSavedSearch` does not exist in the shared module
// (MEASURED at HEAD f4c03e6: the module defines only sanitizeSavedSearchCreate /
// sanitizeSavedSearchPatch, both of which DO carry the flag at :77 and :113-114).
// The import below resolves, but the symbol is `undefined`, so every `describe`
// throws "is not a function" -- RED for the honest reason (subject absent).
//
// HELPER OWED BY STEP A: the interval-clamp property (a below-floor request is
// stored clamped to >= 15, a nonsense request maps to a finite default) is pinned
// as a PROPERTY here. The implementation clamps via `clampIntervalMinutes` /
// `DEFAULT_AUTO_TAILOR_INTERVAL_MINUTES` from lib/feed/cronSchedule.js, which Step A
// owns and which is ABSENT at HEAD. These tests do NOT import cronSchedule -- they
// assert the delivered value only -- so they are decoupled from Step A's export
// names; but the sanitizer cannot be BUILT green until Step A's module lands. Said
// plainly so the implementer sequences B after A.

import { describe, it, expect } from "vitest";
import { sanitizeChatDerivedSavedSearch } from "./savedSearchFields.js";

// The platform cadence floor == the vercel.json */15 cron period (AC2-C4a). Pinned
// here as the PROPERTY the sanitizer must deliver, not imported from Step A's
// module, so this suite does not couple to a symbol that does not exist yet.
const CADENCE_FLOOR_MINUTES = 15;

describe("AC2-C3 part (i): the chat sanitizer's return can NEVER carry auto_tailor_enabled", () => {
  // The adversarial input the whole structural exclusion exists to defeat: a body
  // that sets the flag in BOTH camel and snake case, true. sanitizeSavedSearchCreate
  // would return `auto_tailor_enabled: true` for this exact body (:77). The chat
  // sanitizer must return an object with NO such key.
  const flagBearing = {
    name: "Senior backend, Boston",
    jobKeywords: ["backend", "golang"],
    autoTailorEnabled: true,
    auto_tailor_enabled: true,
  };

  it("omits the auto_tailor_enabled KEY entirely for a flag-bearing body (not === false)", () => {
    const out = sanitizeChatDerivedSavedSearch(flagBearing);
    expect(out).not.toBeNull();
    // The load-bearing assertion: key ABSENCE. A `=== false` build passes a value
    // check and still ships the field; only this fails it. (plan R7 / brief.)
    expect(out).not.toHaveProperty("auto_tailor_enabled");
    expect(out).not.toHaveProperty("autoTailorEnabled");
  });

  it("[non-vacuity control] the SAME call DID sanitize and keep the legitimate fields", () => {
    // Guards against a vacuous pass: "no flag key" is meaningless if the sanitizer
    // returned an empty object (or null) for this body. The flag is absent BECAUSE
    // it is excluded, not because nothing was produced -- prove real fields landed.
    const out = sanitizeChatDerivedSavedSearch(flagBearing);
    expect(out.name).toBe("Senior backend, Boston");
    expect(out.job_keywords).toContain("backend");
    expect(out.job_keywords).toContain("golang");
  });

  it("omits the flag key even for a body that ONLY sets it (no other enabling vocab)", () => {
    // Closes the surface, not the instance: any input, including the minimal
    // flag-only body, must not produce the key. name is present so the sanitizer
    // does not null out for a missing name (that is a different refusal, below).
    const out = sanitizeChatDerivedSavedSearch({ name: "x", auto_tailor_enabled: true });
    expect(out).not.toBeNull();
    expect(out).not.toHaveProperty("auto_tailor_enabled");
  });

  it("omits the flag key for a benign body that never mentions it (default state is OFF-by-absence)", () => {
    const out = sanitizeChatDerivedSavedSearch({ name: "Frontend roles" });
    expect(out).not.toHaveProperty("auto_tailor_enabled");
  });
});

describe("owner ruling 2: the chat MAY set email_on_new_jobs (account-only recipient, bounded by AC-E2)", () => {
  it("carries email_on_new_jobs === true when the body asks for it", () => {
    const out = sanitizeChatDerivedSavedSearch({ name: "x", emailOnNewJobs: true });
    // Diverges from plan.r1.md §6.2 (which forced it false); owner ruling settled it
    // to allowed. This assertion is what makes the divergence a tested contract.
    expect(out.email_on_new_jobs).toBe(true);
  });

  it("[control] carries email_on_new_jobs === false when the body does not ask", () => {
    // Over-fire control: a build that HARDWIRES email on would pass the true case
    // above; this fails it. Distinguishes "honours the request" from "always on".
    const out = sanitizeChatDerivedSavedSearch({ name: "x" });
    expect(out.email_on_new_jobs).toBe(false);
  });

  it("accepts the snake_case spelling too (email_on_new_jobs)", () => {
    const out = sanitizeChatDerivedSavedSearch({ name: "x", email_on_new_jobs: true });
    expect(out.email_on_new_jobs).toBe(true);
  });
});

describe("AC2-C4 (Step A helper owed): the delivered interval is CLAMPED, never the raw request", () => {
  // CLAMP-OR-REFUSE DECISION for the cadence value: CLAMP (owner ruling settled --
  // a requested interval is clamped to the floor and the DELIVERED value stored).
  // Pinned as a property: the stored value is never below the floor and a nonsense
  // value maps to a finite default -- no assertion of the exact Step A constant.
  it("clamps a below-floor requested interval up to at least the floor (15)", () => {
    const out = sanitizeChatDerivedSavedSearch({ name: "x", autoTailorMinIntervalMinutes: 5 });
    expect(out.auto_tailor_min_interval_minutes).toBeGreaterThanOrEqual(CADENCE_FLOOR_MINUTES);
    // And specifically NOT the raw request -- a "store what you were given" build
    // would write 5, which is the AC-C4 lie (surface says 5, cron runs at 15).
    expect(out.auto_tailor_min_interval_minutes).not.toBe(5);
  });

  it("[control] leaves an above-floor requested interval as an integer >= floor", () => {
    const out = sanitizeChatDerivedSavedSearch({ name: "x", autoTailorMinIntervalMinutes: 120 });
    expect(Number.isInteger(out.auto_tailor_min_interval_minutes)).toBe(true);
    expect(out.auto_tailor_min_interval_minutes).toBeGreaterThanOrEqual(CADENCE_FLOOR_MINUTES);
    // Could pass for the wrong reason (a clamp that pins everything to 15 would also
    // satisfy >= 15). This control only proves the field is a finite integer >=
    // floor; the "does not floor a large value" property is Step A's cronSchedule
    // unit test, not this seat's -- disclosed rather than duplicated here.
  });

  it("maps a nonsense/absent interval to a finite integer >= floor (default), never NaN/undefined", () => {
    const nonsense = sanitizeChatDerivedSavedSearch({ name: "x", autoTailorMinIntervalMinutes: "banana" });
    expect(Number.isInteger(nonsense.auto_tailor_min_interval_minutes)).toBe(true);
    expect(nonsense.auto_tailor_min_interval_minutes).toBeGreaterThanOrEqual(CADENCE_FLOOR_MINUTES);

    const absent = sanitizeChatDerivedSavedSearch({ name: "x" });
    expect(Number.isInteger(absent.auto_tailor_min_interval_minutes)).toBe(true);
    expect(absent.auto_tailor_min_interval_minutes).toBeGreaterThanOrEqual(CADENCE_FLOOR_MINUTES);
  });
});

describe("AC2-C6 tail: the per-day cap keeps a bounded server default, never a chat-raised value", () => {
  // The cap is NOT a chat-derived field (AC Part E item 6): the user describes
  // "jobs, frequency", not spend limits. Whatever a body claims, the stored cap must
  // be within the server clamp -- so a message asking for "500 a day" cannot lift it.
  it("clamps an over-max requested cap down to a bounded integer", () => {
    const out = sanitizeChatDerivedSavedSearch({ name: "x", autoTailorDailyCap: 10000 });
    expect(Number.isInteger(out.auto_tailor_daily_cap)).toBe(true);
    expect(out.auto_tailor_daily_cap).toBeLessThan(10000);
    expect(out.auto_tailor_daily_cap).toBeGreaterThanOrEqual(1);
  });

  it("[control] supplies a bounded default cap when the body names none", () => {
    const out = sanitizeChatDerivedSavedSearch({ name: "x" });
    expect(Number.isInteger(out.auto_tailor_daily_cap)).toBe(true);
    expect(out.auto_tailor_daily_cap).toBeGreaterThanOrEqual(1);
  });
});

describe("AC2-C5: the sanitizer refuses (returns null) when there is nothing to key a search on", () => {
  // CLAMP-OR-REFUSE for the WHOLE config: a body with no derivable name has nothing
  // to store, so REFUSE (return null, mirroring sanitizeSavedSearchCreate) -- the
  // apply route turns this into a 400. Numeric out-of-range fields are CLAMPED
  // (above); a missing name is REFUSED. The split is deliberate and stated.
  it("returns null for a nameless body", () => {
    expect(sanitizeChatDerivedSavedSearch({ jobKeywords: ["x"] })).toBeNull();
  });

  it("returns null for a non-object input", () => {
    expect(sanitizeChatDerivedSavedSearch(null)).toBeNull();
    expect(sanitizeChatDerivedSavedSearch("nope")).toBeNull();
  });
});
