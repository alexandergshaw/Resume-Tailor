// N60 S2 (4b) -- the ONE shared saved-search sanitizer module (plan 6.2).
//
// Today `sanitizeStringArray`, `sanitizeCap`, `sanitizeEmail`, `DEFAULT_DAILY_CAP`,
// `MIN_DAILY_CAP`, `MAX_DAILY_CAP` exist VERBATIM in both
// app/api/saved-searches/route.js and .../[id]/route.js (AC 0.9). S2 moves them to
// `lib/savedSearch/savedSearchFields.js`, DELETES the recipient override
// (`sanitizeEmail` and every `notify_email`), and adds the account count cap.
//
// It imports ONLY the module's PUBLIC surface that the routes also consume
// (sanitizeSavedSearchCreate / sanitizeSavedSearchPatch / MAX_SAVED_SEARCHES_PER_ACCOUNT)
// and exercises the internal helpers (sanitizeStringArray / sanitizeCap / name /
// clamp) THROUGH that surface -- importing an internal helper the routes do not use
// would create a test-only export and move exportReachability.sweep's pinned 363
// (brief hard constraint / [[loop-traps-tests]] rule 6). The clamp is asserted as a
// MECHANISM (out-of-range in -> bounded out) without pinning the ceiling value,
// which is a later step's (S3/S4) decision.
//
// RED ON HEAD: the module does not exist; the import fails collection.

import { describe, it, expect } from "vitest";
import {
  sanitizeSavedSearchCreate,
  sanitizeSavedSearchPatch,
  MAX_SAVED_SEARCHES_PER_ACCOUNT,
} from "./savedSearchFields.js";

const TODAY_VOCAB = [
  "name",
  "job_keywords",
  "max_years_exp",
  "selected_categories",
  "selected_companies",
  "excluded_companies",
  "excluded_title_keywords",
  "auto_tailor_enabled",
  "auto_tailor_daily_cap",
  "email_on_new_jobs",
];

describe("the account count cap constant (AC-E5 tail)", () => {
  it("is 25", () => {
    expect(MAX_SAVED_SEARCHES_PER_ACCOUNT).toBe(25);
  });
});

describe("sanitizeSavedSearchCreate: full row, NO recipient override", () => {
  it("returns null when name is missing or blank", () => {
    expect(sanitizeSavedSearchCreate({})).toBeNull();
    expect(sanitizeSavedSearchCreate({ name: "   " })).toBeNull();
  });

  it("produces the saved-search vocabulary and coerces the flags", () => {
    const out = sanitizeSavedSearchCreate({
      name: "  Backend  ",
      jobKeywords: [" React ", "react", 5, ""],
      autoTailorEnabled: 1,
      emailOnNewJobs: 0,
    });
    expect(Object.keys(out)).toEqual(expect.arrayContaining(TODAY_VOCAB));
    expect(out.name).toBe("Backend"); // trimmed (sanitizeName)
    expect(out.job_keywords).toEqual(["React"]); // trimmed + de-duped + non-strings dropped
    expect(out.auto_tailor_enabled).toBe(true);
    expect(out.email_on_new_jobs).toBe(false);
  });

  it("clamps an out-of-range daily cap to a bounded integer (mechanism, not value)", () => {
    const high = sanitizeSavedSearchCreate({ name: "x", autoTailorDailyCap: 10000 });
    expect(high.auto_tailor_daily_cap).toBeLessThan(10000);
    expect(high.auto_tailor_daily_cap).toBeGreaterThanOrEqual(1);
    expect(Number.isInteger(high.auto_tailor_daily_cap)).toBe(true);
    const low = sanitizeSavedSearchCreate({ name: "x", autoTailorDailyCap: -5 });
    expect(low.auto_tailor_daily_cap).toBeGreaterThanOrEqual(1);
  });

  it("caps an over-long name at 200 characters", () => {
    expect(sanitizeSavedSearchCreate({ name: "z".repeat(500) }).name).toHaveLength(200);
  });

  it("NEVER carries a notify_email / recipient override (owner ruling 1)", () => {
    const out = sanitizeSavedSearchCreate({
      name: "Backend",
      notifyEmail: "stranger@evil.com",
      notify_email: "stranger@evil.com",
    });
    expect(out).not.toHaveProperty("notify_email");
    expect(JSON.stringify(out)).not.toContain("stranger@evil.com");
  });
});

describe("sanitizeSavedSearchPatch: partial, still no recipient override", () => {
  it("only emits keys present in the body", () => {
    const out = sanitizeSavedSearchPatch({ emailOnNewJobs: true });
    expect(out).toHaveProperty("email_on_new_jobs", true);
    expect(out).not.toHaveProperty("name");
    expect(out).not.toHaveProperty("auto_tailor_enabled");
  });
  it("maps markViewed to a last_viewed_at timestamp", () => {
    const out = sanitizeSavedSearchPatch({ markViewed: true });
    expect(typeof out.last_viewed_at).toBe("string");
  });
  it("drops any notify_email the caller sends", () => {
    const out = sanitizeSavedSearchPatch({ notifyEmail: "stranger@evil.com", notify_email: "stranger@evil.com" });
    expect(out).not.toHaveProperty("notify_email");
    expect(JSON.stringify(out)).not.toContain("stranger@evil.com");
  });
});
